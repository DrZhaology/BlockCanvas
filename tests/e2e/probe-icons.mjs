// v0.4.6 · 图标系统探针（对应 R6-6）
// 目的：图标从"手写在 Icon.tsx 里的 JSX"改成"assets/icons/*.svg + 代码生成"之后，证明四件事：
//   ① 生成器与 svg 目录同步（改了 svg 忘了生成，能被拦住）；
//   ② 每个 svg 都符合图标规范（24×24 统一外壳、不自带尺寸/颜色、只用基础图形）；
//   ③ 生成的 Icon.tsx 里 140 个片段与 svg 源文件逐个一致（静态比对，全覆盖）；
//   ④ 界面里真正渲染出来的图标外壳正确、图形与源文件一致（运行时抽样，生产包里也做得到）。
// 用法：node tests/e2e/probe-icons.mjs
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync } from 'fs';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

const SVG_DIR = join(ROOT, 'src/renderer/assets/icons');
const ICON_TSX = join(ROOT, 'src/renderer/components/Icon.tsx');

/**
 * JSX 片段里的属性名是驼峰（strokeDasharray），.svg 源文件是连字符（stroke-dasharray）。
 * 只在"引号外面"做转换，避免动到属性值里的字符。
 */
function jsxAttrsToSvg(markup) {
  return markup
    .split('"')
    .map((chunk, i) => (i % 2 === 1 ? chunk : chunk.replace(/\b[a-z]+[A-Z][a-zA-Z]*\s*=/g,
      (w) => w.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()))))
    .join('"');
}

/** 把一段标记序列化成"标签 + 排序后的属性"签名，用于做逐图标的等价比较 */
function signature(markup, { jsx = false } = {}) {
  const src = jsx ? jsxAttrsToSvg(markup) : markup;
  const out = [];
  const re = /<([a-zA-Z]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*\/?>/g;
  let m;
  while ((m = re.exec(src))) {
    const attrs = {};
    const ar = /([a-zA-Z-]+)="([^"]*)"/g;
    let a;
    while ((a = ar.exec(m[2] || ''))) attrs[a[1]] = a[2];
    const keys = Object.keys(attrs).sort();
    out.push(m[1] + ' ' + keys.map((k) => `${k}=${attrs[k]}`).join(' '));
  }
  return out.join(' | ');
}

const norm = (s) => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
const toCamel = (b) => b.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const toKebab = (n) => n.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

async function main() {
  // ── ① 生成器同步 ────────────────────────────────────────────────
  let genOk = true;
  let genMsg = '';
  try {
    execFileSync(process.execPath, [join(ROOT, 'tools/gen-icons.mjs'), '--check'], { cwd: ROOT, encoding: 'utf-8' });
  } catch (e) {
    genOk = false;
    genMsg = String(e.stderr || e.stdout || e.message).trim().slice(0, 200);
  }
  check('生成器与 assets/icons 一致（改了图标必须重跑 pnpm icons:gen）', genOk, genOk ? '' : genMsg);

  // ── ② svg 规范 ──────────────────────────────────────────────────
  const files = existsSync(SVG_DIR) ? readdirSync(SVG_DIR).filter((f) => /\.svg$/i.test(f)).sort() : [];
  check('图标目录存在且非空', files.length > 0, `${files.length} 个 .svg`);
  check('图标数量 = 140（与 v0.4.5 手写集合一一对应）', files.length === 140, `${files.length}`);

  const badWrapper = [];
  const selfSize = [];
  const badTag = [];
  const badAttr = [];
  const ALLOWED_TAGS = new Set(['path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'g']);
  const ALLOWED_ATTRS = /^(d|cx|cy|r|rx|ry|x|y|width|height|points|x1|x2|y1|y2|transform|fill|stroke|stroke-width|stroke-dasharray|stroke-linecap|stroke-linejoin|opacity|fill-rule|clip-rule)$/;
  for (const f of files) {
    const raw = readFileSync(join(SVG_DIR, f), 'utf-8').replace(/^\uFEFF/, '');
    if (!raw.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"')) badWrapper.push(f);
    const head = raw.slice(0, raw.indexOf('>') + 1);
    if (/(?:^|\s)(width|height|class|style)\s*=/.test(head)) selfSize.push(f);
    const inner = raw.slice(raw.indexOf('>') + 1, raw.lastIndexOf('</svg>'));
    for (const m of inner.matchAll(/<([a-zA-Z]+)/g)) if (!ALLOWED_TAGS.has(m[1])) badTag.push(`${f}:${m[1]}`);
    for (const m of inner.matchAll(/(?<=<[a-zA-Z]+ )([a-zA-Z-]+)=/g)) if (!ALLOWED_ATTRS.test(m[1])) badAttr.push(`${f}:${m[1]}`);
  }
  check('所有 svg 用统一外壳（24×24 / fill:none / currentColor）', badWrapper.length === 0, badWrapper.slice(0, 3).join(', '));
  check('没有 svg 自带 width/height/class/style', selfSize.length === 0, selfSize.slice(0, 3).join(', '));
  check('只用到基础图形标签', badTag.length === 0, badTag.slice(0, 5).join(', '));
  check('属性名全在允许清单内（防拼错属性导致"画不出来"）', badAttr.length === 0, badAttr.slice(0, 5).join(', '));
  const badNames = files.filter((f) => f !== f.toLowerCase() || f.includes('_'));
  check('文件名全为 kebab-case 小写（避免跨平台大小写撞车）', badNames.length === 0, badNames.slice(0, 3).join(', '));

  // ── ③ 生成的 Icon.tsx 与 svg 源文件逐个一致（全覆盖，不需要跑界面）──
  const tsx = readFileSync(ICON_TSX, 'utf-8').replace(/^\uFEFF/, '');
  check('Icon.tsx 带"生成产物，勿手改"标记', /由 tools\/gen-icons\.mjs/.test(tsx.slice(0, 400)) && /请勿手改/.test(tsx.slice(0, 400)), '');

  const unionNames = [...tsx.slice(tsx.indexOf('export type IconName'), tsx.indexOf('const P: Record'))
    .matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]);
  check('IconName 联合类型含 140 个名字', unionNames.length === 140, `${unionNames.length}`);

  const pStart = tsx.indexOf('const P: Record');
  const pEnd = tsx.indexOf('export function Icon');
  const pBody = tsx.slice(pStart, pEnd);
  const frags = {};
  const fre = /^ {2}([A-Za-z][A-Za-z0-9]*): \(\r?\n([\s\S]*?)\r?\n {2}\),?\s*$/gm;
  let fm;
  while ((fm = fre.exec(pBody))) frags[fm[1]] = fm[2];
  check('P 映射表里有 140 个片段', Object.keys(frags).length === 140, `${Object.keys(frags).length}`);

  const mismatched = [];
  const missingFile = [];
  for (const name of Object.keys(frags)) {
    const file = join(SVG_DIR, toKebab(name) + '.svg');
    if (!existsSync(file)) { missingFile.push(name); continue; }
    const raw = readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
    const inner = raw.slice(raw.indexOf('>') + 1, raw.lastIndexOf('</svg>'));
    const want = norm(signature(inner));
    const got = norm(signature(frags[name], { jsx: true }));
    if (want !== got) mismatched.push(`${name}\n    svg : ${want}\n    tsx : ${got}`);
  }
  check('每个图标名都有同名 svg 文件', missingFile.length === 0, missingFile.slice(0, 5).join(', '));
  check('140 个片段的图形与 svg 源文件逐个一致', mismatched.length === 0,
    mismatched.length ? `${mismatched.length} 个不一致\n  ` + mismatched.slice(0, 2).join('\n  ') : '');

  // ── ④ 运行时：外壳 + 抽样比对 ───────────────────────────────────
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-icons');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(join(ROOT, 'builtin-extensions'))) cpSync(join(ROOT, 'builtin-extensions'), join(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);

  /**
   * 收集当前界面上所有图标的 DOM 签名。
   * 只认带 data-bc-icon 的（v0.4.6 起 <Icon> 会打这个标记），
   * 这样能知道"这个 svg 对应哪个源文件"，不会把用户网页里的 svg 算进来。
   */
  const collect = () => win.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg.bc-icon[data-bc-icon]')];
    const items = svgs.map((s) => {
      const inner = [...s.children].map((c) => {
        const attrs = {};
        for (const a of [...c.attributes]) attrs[a.name] = a.value;
        const keys = Object.keys(attrs).sort();
        return c.tagName.toLowerCase() + ' ' + keys.map((k) => `${k}=${attrs[k]}`).join(' ');
      }).join(' | ');
      return {
        name: s.getAttribute('data-bc-icon'),
        inner,
        viewBox: s.getAttribute('viewBox'),
        fill: s.getAttribute('fill'),
        stroke: s.getAttribute('stroke'),
        strokeWidth: s.getAttribute('stroke-width'),
        caps: s.getAttribute('stroke-linecap'),
        joins: s.getAttribute('stroke-linejoin'),
        ariaHidden: s.getAttribute('aria-hidden')
      };
    });
    return { count: svgs.length, items };
  });

  const shell1 = await collect();
  check('界面里有图标被渲染', shell1.count > 0, `${shell1.count} 个`);
  const badShell = shell1.items.filter((i) => i.viewBox !== '0 0 24 24' || i.fill !== 'none' || i.stroke !== 'currentColor'
    || i.strokeWidth !== '1.7' || i.caps !== 'round' || i.joins !== 'round' || i.ariaHidden !== 'true');
  check('渲染外壳统一（24×24 / fill none / currentColor / 1.7px / 圆头圆角 / 对读屏隐藏）',
    badShell.length === 0, badShell.length ? badShell.slice(0, 2).map((b) => b.name).join(', ') : '');
  check('没有"空壳"图标（外壳在但没图形）', shell1.items.filter((i) => i.inner === '').length === 0, '');

  // 运行时抽样比对：界面里出现的图标，图形必须与源文件一致
  const verifyRuntime = (items) => {
    const bad = [];
    for (const it of items) {
      const file = join(SVG_DIR, toKebab(it.name) + '.svg');
      if (!existsSync(file)) { bad.push(`${it.name}: 找不到 svg`); continue; }
      const raw = readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
      const inner = raw.slice(raw.indexOf('>') + 1, raw.lastIndexOf('</svg>'));
      if (norm(signature(inner)) !== norm(it.inner)) bad.push(it.name);
    }
    return bad;
  };

  const seen = new Map();
  for (const it of shell1.items) seen.set(it.name, it);

  // 空首页已经收过；先进编辑器（工具栏 / 图层面板 / 属性面板是一大批图标），
  // 再依次走设置页 / 帮助页 / 项目中心 —— 这几个界面用到的图标各不相同。
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1200);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });
  for (const it of (await collect()).items) seen.set(it.name, it);
  // 造一个元素，把属性面板的图标也带出来
  await win.evaluate(() => { window.__sceneStore.getState().addElement('div'); });
  await sleep(800);
  await win.locator('.tab-btn', { hasText: '属性' }).click().catch(() => null);
  await sleep(700);
  for (const it of (await collect()).items) seen.set(it.name, it);

  /** 发一个"打开某界面"的事件，等它渲染完，把图标收进来 */
  const visit = async (eventName, ms = 1000) => {
    await win.evaluate((ev) => window.dispatchEvent(new CustomEvent(ev)), eventName);
    await sleep(ms);
    const got = await collect();
    for (const it of got.items) seen.set(it.name, it);
    return got.count;
  };

  const setCount = await visit('bc:open-settings');
  await visit('bc:open-help');
  await visit('bc:open-projects');

  const all = [...seen.values()];
  const runtimeBad = verifyRuntime(all);
  check('运行时抽样：界面上出现的每类图标都与源文件一致', runtimeBad.length === 0,
    `${all.length} 类，错误 ${runtimeBad.length}${runtimeBad.length ? '：' + runtimeBad.slice(0, 3).join(', ') : ''}`);
  // 全量一致性已由上面的静态比对覆盖（140/140）；这里只验证"真渲染出来的东西也对"，
  // 所以要求的是代表性而非覆盖率 —— 40 类已横跨首页/编辑器/属性面板/设置/帮助/项目中心。
  check(`运行时抽样覆盖有代表性（≥30 类，实际 ${all.length} 类）`, all.length >= 30, `${all.length} 类`);
  console.log(`      设置页图标 ${setCount} 个`);

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
