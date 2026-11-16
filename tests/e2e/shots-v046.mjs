// ============================================================================
// v0.4.6 · 截图验收（不是"看起来还行"，是逐屏取样 + 关键几何量）
// ----------------------------------------------------------------------------
// 用法：node tests/e2e/shots-v046.mjs
// 产物：tests/e2e/shots-v046/*.png（已被 .gitignore / .git/info/exclude 兜住）
// 同时打印每一屏要看的数字，方便和 docs/v0.4.6-截图验收.md 对照。
// ============================================================================
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const OUT = resolve(ROOT, 'tests/e2e/shots-v046');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const DATA_DIR = resolve(tmpdir(), 'bc-shots-v046');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push(String(e.message)));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  // 首页下面还压着开机加载屏（MIN_VISIBLE_MS 900ms），要等它退场再截
  await win.waitForFunction(() => !document.querySelector('.bc-loading'), { timeout: 15000 }).catch(() => {});
  await sleep(700);
  const shot = async (name) => { await win.screenshot({ path: resolve(OUT, name + '.png') }); };

  /* ① 首页：三个按钮必须是一行等高，不能是倒三角 */
  const home = await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.eh-actions .eh-btn')];
    return btns.map((b) => { const r = b.getBoundingClientRect(); return { t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
  });
  console.log('① 首页按钮', JSON.stringify(home));
  await shot('01-home');

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1500);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  /* ② 建一个长页面 + 一个 fixed 元素 */
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const r = window.__sceneStore.getState().scene.root;
    const tall = r.children[r.children.length - 1];
    window.__sceneStore.getState().updateStyle(tall.id, { minHeight: '2400px', background: '#f3f6fb' });
    st.addElement('div');
    const r2 = window.__sceneStore.getState().scene.root;
    const box = r2.children[r2.children.length - 1];
    window.__sceneStore.getState().updateStyle(box.id, { position: 'fixed', left: '40px', top: '40px', width: '240px', height: '120px', background: '#ef4444' });
    window.__sceneStore.getState().selectElement(box.id);
  });
  await sleep(800);

  /* ③ 编辑器主界面（圆角 / 标题栏 / 面板） */
  await shot('02-editor-wide');

  /* ④ Alt 悬停 fixed：只该标两条偏移 */
  const box = await win.evaluate(() => {
    const e = document.querySelector('.canvas-fixed-layer [data-bc-id]');
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await win.keyboard.down('Alt');
  await win.mouse.move(box.x, box.y);
  await sleep(450);
  const insetLabels = await win.evaluate(() => [...document.querySelectorAll('.bc-boxm-inset')].map((e) => e.textContent));
  console.log('④ Alt 偏移标签', JSON.stringify(insetLabels));
  await shot('03-alt-two-sides');
  await win.keyboard.up('Alt');
  await sleep(200);

  /* ⑤ 画布滚动：滑块长度必须恒定 */
  const sw = [];
  for (const y of [0, 800, 1600]) {
    await win.evaluate((v) => { const w = document.querySelector('.canvas-wrap'); if (w) w.scrollTop = v; }, y);
    await sleep(500);
    sw.push(await win.evaluate(() => {
      const w = document.querySelector('.canvas-wrap');
      const t = [...document.querySelectorAll('.bc-osb-thumb')].find((x) => x.classList.contains('is-visible'));
      return { st: Math.round(w.scrollTop), sh: w.scrollHeight, thumbH: t ? Math.round(t.getBoundingClientRect().height) : 0 };
    }));
  }
  console.log('⑤ 画布滚动', JSON.stringify(sw));
  await shot('04-canvas-scrolled');
  await win.evaluate(() => { const w = document.querySelector('.canvas-wrap'); if (w) w.scrollTop = 0; });
  await sleep(300);

  /* ⑥ 竖屏：画布铺满 + 两个小把手 */
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(320, 400); w.setResizable(true);
    // ⚠ 先取消最大化：窗口处于最大化状态时 setSize 会被忽略（实测偶发"竖屏那张图其实是宽屏"）
    if (w.isMaximized()) w.unmaximize();
    w.setSize(412, 860); w.center();
  });
  await sleep(900);
  const narrow = await win.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { y: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }; };
    const b = document.querySelector('.shell-drawer-btn.is-left');
    return { workspace: g('.workspace'), wrap: g('.canvas-wrap'), btn: b ? g('.shell-drawer-btn.is-left') : null, tabs: document.querySelectorAll('.tab-add-btn').length,
      // 诊断：画布右侧那块红色实心区域到底是谁
      // 诊断：第二条操作栏按钮的**视觉顺序**（按 x 排，DOM 顺序会被 flex order 打乱）
      bar2: [...document.querySelectorAll('.pt-bar2 .toolbar button')]
        .map((b) => ({
          t: (b.getAttribute('title') || b.textContent || '').trim().slice(0, 8),
          x: Math.round(b.getBoundingClientRect().left)
        }))
        .sort((a, b) => a.x - b.x)
        .map((b) => `${b.x}:${b.t}`),
      frame: (() => {
        const f = document.querySelector('.canvas-fixed-frame');
        if (!f) return null;
        const r = f.getBoundingClientRect();
        const cs = getComputedStyle(f);
        return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top), bg: cs.backgroundColor, border: cs.borderTopWidth, z: cs.zIndex };
      })(),
      wide: [...document.querySelectorAll('.app *')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 600 && r.left > 320;
      }).slice(0, 6).map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { cls: String(el.className || el.tagName).slice(0, 28), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), bg: cs.backgroundColor };
      }) };
  });
  console.log('⑥ 竖屏几何', JSON.stringify(narrow));
  await shot('05-narrow-closed');

  /* ⑦ 抽屉打开：元素面板从头开始 */
  await win.evaluate(() => document.querySelector('.shell-drawer-btn.is-left')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(800);
  const drawer = await win.evaluate(() => {
    const e = document.querySelector('.elem-pane-wrap .element-body');
    const firstTitle = document.querySelector('.elem-pane-wrap .group-title');
    return { h: e ? e.clientHeight : 0, sh: e ? e.scrollHeight : 0, firstTitle: firstTitle ? firstTitle.textContent : '' };
  });
  console.log('⑦ 抽屉', JSON.stringify(drawer));
  await shot('06-narrow-drawer-elem');
  await win.evaluate(() => document.querySelector('.shell-drawer-scrim')?.click());
  await sleep(700);

  /* ⑧ 属性抽屉 */
  await win.evaluate(() => document.querySelector('.shell-drawer-btn.is-right')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(800);
  await shot('07-narrow-drawer-props');
  await win.evaluate(() => document.querySelector('.shell-drawer-scrim')?.click());
  await sleep(600);

  console.log('页面错误', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'none');
  await app.close();
};

main().catch((e) => { console.error(e); process.exit(1); });
