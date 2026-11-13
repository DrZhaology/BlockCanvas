// v0.4.6 · 插件能力白名单验收（R6-22 / R6-23）
//
// 背景（v0.4.6 定稿的设计前提）：
//   **不做真沙箱**。插件仍用 `new Function('Bc', source)` 在渲染进程同上下文里跑。
//   能做的、成本最低的是"**少给参数**"：插件在 manifest 里声明要什么能力，
//   宿主只把声明过的方法放进 Bc，未声明的**根本不存在**（调用直接 TypeError）。
//
// 这个探针就是在证明"少给参数"真的生效了：
//   ① 没声明 permissions → 只给最小集（element + property），其它全无；
//   ② 越权调用必须抛 TypeError（不是静默成功）；
//   ③ apiVersion 过高 → 插件**根本不被执行**（比"跑到一半崩"好一百倍）；
//   ④ 内置 dark-mode 声明了 css+command → 它仍然正常工作（不能把正常插件误伤）。
//
// 用法：node tests/e2e/probe-plugin-perms.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

/** 把内置插件 + 探针插件一起放进临时扩展目录 */
function seedExtensions(dataDir) {
  const dest = resolve(dataDir, 'extensions');
  mkdirSync(resolve(dest, 'plugins'), { recursive: true });
  const builtin = resolve(ROOT, 'builtin-extensions', 'plugins');
  if (existsSync(builtin)) {
    for (const name of readdirSync(builtin)) {
      if (!statSync(resolve(builtin, name)).isDirectory()) continue;
      cpSync(resolve(builtin, name), resolve(dest, 'plugins', name), { recursive: true });
    }
  }
  const fixtures = resolve(ROOT, 'tests/e2e/fixtures/plugins');
  for (const name of readdirSync(fixtures)) {
    if (!statSync(resolve(fixtures, name)).isDirectory()) continue;
    cpSync(resolve(fixtures, name), resolve(dest, 'plugins', name), { recursive: true });
  }
  return dest;
}

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-plugin-perms');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const extDir = seedExtensions(DATA_DIR);
  console.log('  扩展目录:', extDir);
  console.log('  已放置:', readdirSync(resolve(extDir, 'plugins')).join(', '));

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const warns = [];
  win.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()); });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(2500);

  // ── ① 未声明能力的插件：只有最小集 ────────────────────────────────
  const access = await win.evaluate(() => window.__probePluginAccess ?? null);
  check('未声明 permissions 的插件被执行了（基线）', !!access, access ? 'ok' : '没跑起来');
  if (access) {
    check('最小集可用：registerElement 是 function', access.registerElement === 'function', access.registerElement);
    check('最小集可用：registerProperty 是 function', access.registerProperty === 'function', access.registerProperty);
    check('未声明的 registerCss 在 Bc 上**不存在**', access.registerCss === 'undefined', access.registerCss);
    check('未声明的 registerCommand 不存在', access.registerCommand === 'undefined', access.registerCommand);
    check('未声明的 registerExportHook 不存在', access.registerExportHook === 'undefined', access.registerExportHook);
    check('未声明的 hostApi（Bc.api）不存在 —— 插件拿不到文件/网络能力',
      access.api === 'undefined', access.api);
  }

  // ── ② 越权调用必须抛 TypeError（不是静默成功）────────────────────
  const throws = await win.evaluate(() => window.__probePluginThrows ?? null);
  check('越权调用的结果被记录下来', !!throws, throws ? 'ok' : '没有记录');
  if (throws) {
    check('调用未声明的 registerCss → TypeError', throws.css === 'TypeError', throws.css);
    check('调用未声明的 registerCommand → TypeError', throws.command === 'TypeError', throws.command);
    check('调用未声明的 registerExportHook → TypeError', throws.exportHook === 'TypeError', throws.exportHook);
    check('调用已声明的 registerElement → 正常（不误伤）', throws.element === 'no-throw', throws.element);
  }

  // ── ③ apiVersion 过高 → 插件根本不被执行 ────────────────────────
  const badRan = await win.evaluate(() => window.__probeBadVersionRan === true);
  check('apiVersion=99 的插件**没有被执行**（版本闸门生效）', badRan === false, `ran=${badRan}`);

  const refused = warns.some((w) => /已拒绝加载/.test(w) && /只支持到/.test(w));
  check('控制台给出"版本过高、已拒绝加载"的明确说明', refused,
    warns.filter((w) => /拒绝加载/.test(w)).slice(0, 1).join('') || warns.slice(-2).join(' | '));

  // ── ④ 内置 dark-mode（声明了 css+command）仍正常 ─────────────────
  // 先确认它注册进去了：工具栏 store 只在插件宿主的模块作用域里，探针拿不到，
  // 所以走 DOM —— 插件命令一律进「⋯更多」，点开它再找。
  await win.locator('.eh-btn', { hasText: '新建项目' }).click().catch(() => null);
  await sleep(1200);
  const toolbarState = await win.evaluate(() => {
    const more = document.querySelector('.tb-more-btn');
    if (more) more.click();
    return { hasMore: !!more };
  });
  await sleep(500);
  const dark = await win.evaluate(() => {
    const style = document.querySelector('#bc-plugin-css-dark-mode');
    // AnchoredPanel 是 Portal 到 body 的（.tb-more-panel 里的 .tb-more-item）
    const items = [...document.querySelectorAll('.tb-more-item')]
      .map((b) => (b.textContent || '').trim())
      .filter(Boolean);
    return {
      hasCss: !!style,
      cssLen: style ? (style.textContent || '').length : 0,
      items,
      itemCount: items.length
    };
  });
  check('声明了 css 能力的插件能注入样式（dark-mode 正常）',
    dark.hasCss && dark.cssLen > 100, `style=${dark.hasCss} len=${dark.cssLen}`);
  check('声明了 command 能力的插件命令出现在工具栏「⋯更多」里（dark-mode 正常）',
    dark.items.some((t) => /深色|暗色|dark/i.test(t)),
    `${dark.itemCount} 项：${dark.items.join(' | ').slice(0, 100)}`);

  // ── ⑤ 能力清单自检：宿主支持的权限与文档一致 ─────────────────────
  const meta = await win.evaluate(async () => {
    // 直接看渲染层模块导出的常量（生产构建里通过 window 拿不到，用模块缓存兜底）
    const list = window.__bcPermissionMeta;
    return list ?? null;
  });
  if (meta) {
    check('宿主支持的 API 版本是 1', meta.apiVersion === '1', meta.apiVersion);
    check('能力清单包含 6 项', Array.isArray(meta.permissions) && meta.permissions.length === 6,
      String(meta.permissions?.length));
  } else {
    console.log('SKIP  能力清单自检（未挂 window.__bcPermissionMeta）');
  }

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
