// v0.4.6 · Web 版验收（R6-12 / R6-13 / R6-14）
//
// 目标：证明同一份渲染层在**真实浏览器**里能跑起来，而且不是"空白页面"。
// 用的是构建产物 dist-web/index.html（单文件，2MB 上下），通过 file:// 打开 ——
// 那是最苛刻的场景（没有服务器、没有 preload、IndexedDB 在部分浏览器里受限）。
//
// 验证的四层：
//   ① 单文件产物存在，且**没有外部请求**（CSS/JS 全内联）；
//   ② 浏览器宿主装上来了（data-bc-host="browser"，window.bc 由 adapter 提供）；
//   ③ 核心链路可用：新建工程 → 加元素 → 改样式 → 导出（下载）
//   ④ 做不到的能力给出明确提示，而不是"点了没反应"
//
// 用法：node tests/e2e/probe-web.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { existsSync, statSync, readFileSync } from 'fs';

const require = createRequire(import.meta.url);

const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

const SINGLE = resolve(ROOT, 'dist-web/index.html');

/**
 * 打开"真实浏览器"跑 Web 版。
 *
 * 为什么不用 Playwright 的 chromium：本机没装它的浏览器包（`playwright install` 要下载
 * 130MB+）。但 Electron 自带一份完整的 Chromium —— 用 `_electron` 起一个纯壳窗口、
 * **不加载 preload**，加载的正是构建出来的 dist-web/index.html，
 * 那就是货真价实的"没有 preload 的浏览器环境"。
 *
 * 三个关键点缺一不可：
 *   · `contextIsolation: false` + 无 preload → window.bc 不存在，走的是浏览器适配层；
 *   · 显式删除环境里的 ELECTRON_RUN_AS_NODE（否则 electron 退化成纯 Node，起不来）；
 *   · file:// 加载单文件 HTML → 最苛刻的场景（无服务器 / 无 IndexedDB 特权的部分，
 *     Chromium 里 IndexedDB 在 file:// 下仍可用，正好能验证"双击即用"）。
 */
async function launchBrowserShell() {
  const { _electron: electron } = require('playwright');
  const electronPath = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // 一个最小的壳：只有 webPreferences，没有 preload
  const app = await electron.launch({
    args: [resolve(ROOT, 'tests/e2e/web-shell.cjs'), SINGLE.replace(/\\/g, '/')],
    cwd: ROOT,
    executablePath: electronPath,
    env
  });
  const page = await app.firstWindow();
  return { app, page };
}

async function main() {
  // ── ① 产物本身 ────────────────────────────────────────────────────
  if (!existsSync(SINGLE)) {
    console.log('FAIL  找不到 dist-web/index.html —— 先跑 `pnpm build:web`');
    process.exit(1);
  }
  const bytes = statSync(SINGLE).size;
  const html = readFileSync(SINGLE, 'utf-8');
  check('单文件产物存在', bytes > 500 * 1024, `${(bytes / 1024 / 1024).toFixed(2)} MB`);
  check('产物是**单个** html（没有外链 script/link）',
    !/<script[^>]+src=/.test(html) && !/<link[^>]+rel=["']stylesheet/.test(html),
    `script-src=${(html.match(/<script[^>]+src=/g) || []).length} link=${(html.match(/<link[^>]+stylesheet/g) || []).length}`);
  check('用相对路径（file:// 下也能找到资源）', !/src="\//.test(html), '');
  check('CSS 已内联（有 <style> 且有内容）',
    /<style[^>]*>[\s\S]{1000,}/.test(html), '');

  // ── ②③④ 真实浏览器里跑 ───────────────────────────────────────────
  const { app, page } = await launchBrowserShell();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const external = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });

  // 壳窗口自己会 loadFile(SINGLE)，这里只等首屏渲染
  // 浏览器宿主会比 Electron 慢一点（IndexedDB 首次打开）
  await page.waitForSelector('.empty-home, .app', { timeout: 30000 });
  await sleep(1800);

  check('页面真的渲染出来了（不是白屏）',
    await page.locator('.app').count() > 0, '');
  check('没有发起任何外部网络请求（完全离线可用）',
    external.length === 0, external.slice(0, 3).join(', '));

  const host = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-bc-host'),
    hasBc: typeof window.bc === 'object' && window.bc !== null,
    hasGetSession: typeof window.bc?.getSession === 'function',
    hasExport: typeof window.bc?.exportHTML === 'function',
    version: null
  }));
  check('浏览器宿主标记已挂上（data-bc-host="browser"）', host.attr === 'browser', String(host.attr));
  check('window.bc 由适配层提供（不是 undefined）', host.hasBc === true, String(host.hasBc));
  check('核心方法存在（getSession / exportHTML）',
    host.hasGetSession && host.hasExport, `getSession=${host.hasGetSession} export=${host.hasExport}`);

  const ver = await page.evaluate(() => window.bc.getLocalVersion());
  check('版本号从构建期注入（浏览器里没有 package.json）',
    /^\d+\.\d+/.test(String(ver)), String(ver));

  // ── ③ 核心链路：新建工程 → 加元素 → 改样式 ────────────────────────
  const newBtn = page.locator('.eh-btn', { hasText: '新建项目' });
  if (await newBtn.count()) {
    await newBtn.first().click();
    await sleep(1500);
  }
  const editorUp = await page.evaluate(() =>
    !!document.querySelector('.project-tab-bar') || !!document.querySelector('.toolbar'));
  check('能进入编辑器（新建工程成功）', editorUp, String(editorUp));

  const added = await page.evaluate(() => {
    const st = window.__sceneStore?.getState?.();
    if (!st) return { ok: false, reason: '没有 __sceneStore' };
    st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    const f = kids[kids.length - 1];
    if (!f) return { ok: false, reason: '没插进去' };
    s2.updateStyle(f.id, { height: '80px', width: '100%', backgroundColor: '#bfdbfe' });
    const after = (window.__sceneStore.getState().scene.root.children || [])[0];
    return { ok: true, id: f.id, style: after?.style ?? {} };
  });
  check('能在浏览器里插入元素并改样式',
    added.ok === true && added.style.backgroundColor === '#bfdbfe',
    added.ok ? `id=${String(added.id).slice(0, 8)} bg=${added.style.backgroundColor}` : added.reason);

  // ── ② 存储：工程能存进 IndexedDB 并读回来 ─────────────────────────
  const roundTrip = await page.evaluate(async () => {
    const st = window.__sceneStore.getState();
    const saved = await window.bc.saveProject({ name: '网页版探针工程', scene: st.scene });
    if (!saved?.ok) return { ok: false, step: 'save', saved };
    const list = await window.bc.listProjects();
    const found = (list || []).find((p) => p.name === '网页版探针工程');
    if (!found) return { ok: false, step: 'list', count: (list || []).length };
    const opened = await window.bc.openProjectFile(found.fileName);
    if (!opened?.ok) return { ok: false, step: 'open', opened };
    const kids = opened.project?.scene?.root?.children || [];
    return { ok: true, count: (list || []).length, elements: kids.length, fileName: found.fileName };
  });
  check('工程能存进 IndexedDB 并读回来（浏览器版的"文件系统"）',
    roundTrip.ok === true && roundTrip.elements >= 1,
    roundTrip.ok ? `${roundTrip.fileName} · ${roundTrip.elements} 个元素` : `${roundTrip.step}: ${JSON.stringify(roundTrip).slice(0, 80)}`);

  // ── ② 导出：浏览器里是"下载" ───────────────────────────────────────
  // 走**应用自己的导出路径**（工具栏「导出 HTML」按钮），而不是探针自己拼 HTML ——
  // 后者会绕过真正的链接（exporter → bc.exportHTML），测不出问题。
  // 壳里拦了 will-download（见 web-shell.cjs），记录落在 global.__bcDownloads。
  const exportBtn = page.locator('.toolbar button', { hasText: '导出 HTML' });
  const hasExportBtn = await exportBtn.count() > 0;
  if (hasExportBtn) {
    await exportBtn.first().click();
    await sleep(2500);
    // 可能有"导出前体检"向导，直接放行
    const goOn = page.locator('button', { hasText: /继续|跳过|直接导出/ });
    if (await goOn.count()) { await goOn.first().click(); await sleep(2000); }
  }
  const downloads = await app.evaluate(() => global.__bcDownloads ?? []);
  check('点「导出 HTML」在浏览器里触发文件下载（不是静默失败）',
    hasExportBtn && downloads.length >= 1,
    `按钮=${hasExportBtn} 下载=${downloads.map((d) => d.name).join(',') || '(没触发)'}`);

  if (downloads.length) {
    const done = downloads[downloads.length - 1];
    const exists = existsSync(done.path);
    const size = exists ? statSync(done.path).size : 0;
    /**
     * 断言"真的落盘且内容对"，但**不假定是 .html 还是 .zip**：
     * 浏览器版把"导出网站"也实现成下载（zip 里含 index.html），
     * 这符合网页版的存储现实（拿不到目录写权限）。两种都算通过 ——
     * 关键是"文件存在、有内容、里面确实是刚做的那一页"。
     */
    const isZip = /\.zip$/i.test(done.name);
    check('下载的文件真的落到磁盘且非空',
      exists && size > (isZip ? 400 : 1024), `${done.name} ${size}B state=${done.state}`);
    if (exists) {
      if (isZip) {
        const buf = readFileSync(done.path);
        check('下载的 zip 里含 index.html（网页版"导出网站"的正确形态）',
          buf.includes(Buffer.from('index.html')), `${size}B`);
      } else {
        const written = readFileSync(done.path, 'utf-8');
        check('下载的 HTML 内容正确（有 doctype + 我们刚插入的样式）',
          /<!doctype html/i.test(written) && /bfdbfe/i.test(written),
          `${written.length} 字符`);
      }
    }
  }

  // ── ④ 做不到的能力：明确说"不可用"，不能静默失败 ──────────────────
  const unavailableProbe = await page.evaluate(async () => {
    const out = {};
    try {
      const r = await window.bc.applyUpdate('https://example.com/x.zip', 'x.zip', '1.0.0', 'v1.0.0');
      out.update = { ok: r?.ok, unavailable: r?.unavailable === true, error: r?.error ?? '' };
    } catch (e) { out.update = { threw: String(e) }; }
    try {
      const r = await window.bc.openExtensionsDir();
      out.extDir = { ok: r?.ok, unavailable: r?.unavailable === true };
    } catch (e) { out.extDir = { threw: String(e) }; }
    try {
      const r = await window.bc.setAcceptanceSize('android');
      out.accept = { ok: r?.ok, unavailable: r?.unavailable === true };
    } catch (e) { out.accept = { threw: String(e) }; }
    return out;
  });
  check('自动更新在网页版明确返回"不可用"',
    unavailableProbe.update?.ok === false && unavailableProbe.update?.unavailable === true,
    JSON.stringify(unavailableProbe.update));
  check('打开扩展目录明确返回"不可用"',
    unavailableProbe.extDir?.ok === false && unavailableProbe.extDir?.unavailable === true,
    JSON.stringify(unavailableProbe.extDir));
  check('改窗口尺寸明确返回"不可用"（浏览器管不了窗口）',
    unavailableProbe.accept?.ok === false && unavailableProbe.accept?.unavailable === true,
    JSON.stringify(unavailableProbe.accept));

  // ── ⑤ 没有运行时错误 ──────────────────────────────────────────────
  const realErrs = errs.filter((e) => !/ResizeObserver|Script error/i.test(e));
  check('没有运行时 pageerror', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));

  await page.screenshot({ path: resolve(ROOT, 'tests/e2e/shots-v046/web-version.png') }).catch(() => null);
  await app.close();

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
