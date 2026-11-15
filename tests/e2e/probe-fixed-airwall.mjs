// ============================================================================
// v0.4.6 · fixed 定位「视口层」验收 + 元素进退场动画验收
// ----------------------------------------------------------------------------
// 这一版把 fixed 的参照面从"整张画布"换成了画布里的一层「浏览器视口层」
// （.canvas-fixed-layer，位置尺寸 = 红框）。本探针只认硬数字，不认"看着像"：
//
//   ① 视口层存在，且矩形 == 红框矩形（±2px）
//   ② 「首屏线」彻底不存在了（用户："原来的首屏幕 900px 还会显示"）
//   ③ 画布比视口高得多时，left/right/top/bottom 四条都相对**视口**解析
//      （bottom: 0 = 贴视口底，不是贴 3000px 的画布底）
//   ④ 滚动时 fixed 元素钉在视口上（画布滚 300，元素屏幕位置不变）
//   ⑤ Alt 拖到底 → 松手写 bottom: 0，且全元素最多两条偏移（面板是最高权限）
//   ⑥ 左下 / 右下角对齐不越出视口（用户实测会突破的那两个角）
//   ⑦ 新增元素有进场动画、删除元素有退场影子
//
// 用法：node tests/e2e/probe-fixed-airwall.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '   -> ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-fixedvp');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1400);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // ── 造一个"很高的页面" + 一个 fixed 元素 ────────────────────────────────
  const ids = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const root = window.__sceneStore.getState().scene.root;
    const tall = root.children[root.children.length - 1];
    window.__sceneStore.getState().updateStyle(tall.id, { minHeight: '2600px', background: '#eef2f7' });
    st.addElement('div');
    const root2 = window.__sceneStore.getState().scene.root;
    const box = root2.children[root2.children.length - 1];
    window.__sceneStore.getState().updateStyle(box.id, {
      position: 'fixed', left: '0px', top: '0px', width: '220px', height: '120px', background: '#ef4444'
    });
    window.__sceneStore.getState().selectElement(box.id);
    return { tall: tall.id, box: box.id };
  });
  await sleep(700);

  const geo = async (id) => win.evaluate((boxId) => {
    const layer = document.querySelector('.canvas-fixed-layer');
    const frame = document.querySelector('.canvas-fixed-frame');
    const el = document.querySelector(`.canvas [data-bc-id="${boxId}"]`);
    const canvas = document.querySelector('.canvas');
    const r = (n) => (n ? n.getBoundingClientRect() : null);
    const lr = r(layer); const fr = r(frame); const er = r(el); const cr = r(canvas);
    const st = window.__sceneStore.getState();
    const node = (function find(n) { if (n.id === boxId) return n; for (const c of n.children) { const f = find(c); if (f) return f; } return null; })(st.scene.root);
    const style = node ? node.style : {};
    const layerOf = layer ? getComputedStyle(layer) : null;
    return {
      layer: lr && { left: lr.left, top: lr.top, right: lr.right, bottom: lr.bottom, w: lr.width, h: lr.height },
      frame: fr && { left: fr.left, top: fr.top, right: fr.right, bottom: fr.bottom },
      el: er && { left: er.left, top: er.top, right: er.right, bottom: er.bottom, w: er.width, h: er.height },
      canvas: cr && { top: cr.top, bottom: cr.bottom, left: cr.left, right: cr.right, h: canvas.offsetHeight },
      layerCount: document.querySelectorAll('.canvas-fixed-layer').length,
      vpLine: document.querySelectorAll('.canvas-viewport-line').length,
      translate: layerOf ? layerOf.translate : '',
      style: { left: style.left, right: style.right, top: style.top, bottom: style.bottom }
    };
  }, id);

  const g0 = await geo(ids.box);
  check('视口层存在且只有一层', g0.layerCount === 1, `count=${g0.layerCount}`);
  check('视口层矩形 == 红框矩形（±2px）', !!g0.layer && !!g0.frame
    && near(g0.layer.left, g0.frame.left) && near(g0.layer.top, g0.frame.top)
    && near(g0.layer.right, g0.frame.right) && near(g0.layer.bottom, g0.frame.bottom),
    g0.layer && g0.frame ? `layer=${Math.round(g0.layer.left)},${Math.round(g0.layer.top)},${Math.round(g0.layer.right)},${Math.round(g0.layer.bottom)} frame=${Math.round(g0.frame.left)},${Math.round(g0.frame.top)},${Math.round(g0.frame.right)},${Math.round(g0.frame.bottom)}` : 'missing');
  check('视口层比画布矮（画布 2600+，视口只有一屏）', !!g0.layer && !!g0.canvas && g0.canvas.h > g0.layer.h + 400,
    g0.layer && g0.canvas ? `canvas=${g0.canvas.h} layer=${Math.round(g0.layer.h)}` : '');
  check('「首屏线」已删除（DOM 里一条都没有）', g0.vpLine === 0, `vpLine=${g0.vpLine}`);

  // ── ③ 四条偏移都相对视口 ─────────────────────────────────────────────────
  const setStyle = async (patch) => {
    await win.evaluate(([id, p]) => window.__sceneStore.getState().updateStyle(id, p), [ids.box, patch]);
    await sleep(320);
  };

  await setStyle({ left: '0px', top: '0px', right: 'auto', bottom: 'auto' });
  let g = await geo(ids.box);
  check('left:0 → 贴视口左边', near(g.el.left, g.layer.left), `el=${Math.round(g.el.left)} layer=${Math.round(g.layer.left)}`);

  await setStyle({ left: 'auto', top: 'auto', right: '0px', bottom: '0px' });
  g = await geo(ids.box);
  check('right:0 → 贴视口右边', near(g.el.right, g.layer.right), `el=${Math.round(g.el.right)} layer=${Math.round(g.layer.right)}`);
  check('bottom:0 → 贴视口底（不是 2600px 的画布底）', near(g.el.bottom, g.layer.bottom),
    `el=${Math.round(g.el.bottom)} layer=${Math.round(g.layer.bottom)} canvas=${Math.round(g.canvas.bottom)}`);
  check('bottom:0 时元素仍在画布可视范围内（没跑到页面最底）', g.el.bottom < g.canvas.bottom - 400,
    `el.bottom=${Math.round(g.el.bottom)} canvas.bottom=${Math.round(g.canvas.bottom)}`);
  check('右下角对齐后仍是两条偏移', (['left', 'right', 'top', 'bottom'].filter((k) => g.style[k] && g.style[k] !== 'auto')).length === 2,
    JSON.stringify(g.style));

  // ── ⑥ 左下角 / 右下角都不越界 ────────────────────────────────────────────
  await setStyle({ left: '0px', top: 'auto', right: 'auto', bottom: '0px' });
  g = await geo(ids.box);
  check('左下角对齐：left 不越界', g.el.left >= g.layer.left - 2, `el=${Math.round(g.el.left)} layer=${Math.round(g.layer.left)}`);
  check('左下角对齐：bottom 不越界', g.el.bottom <= g.layer.bottom + 2, `el=${Math.round(g.el.bottom)} layer=${Math.round(g.layer.bottom)}`);

  // ── ④ 滚动时钉在视口上 ──────────────────────────────────────────────────
  await setStyle({ left: '40px', top: '60px', right: 'auto', bottom: 'auto' });
  const beforeScroll = await geo(ids.box);
  await win.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap');
    if (wrap) wrap.scrollTop = 320;
  });
  await sleep(420);
  const afterScroll = await geo(ids.box);
  check('画布滚 320px 后 fixed 元素屏幕位置不变（钉在视口上）',
    near(beforeScroll.el.top, afterScroll.el.top, 3) && near(beforeScroll.el.left, afterScroll.el.left, 3),
    `top ${Math.round(beforeScroll.el.top)} -> ${Math.round(afterScroll.el.top)}；shift=${afterScroll.translate}`);
  await win.evaluate(() => { const w = document.querySelector('.canvas-wrap'); if (w) w.scrollTop = 0; });
  await sleep(420);

  // ── ⑤ Alt 拖到底 → bottom:0 + 最多两条偏移 ───────────────────────────────
  await setStyle({ left: '60px', top: '80px', right: 'auto', bottom: 'auto' });
  const g2 = await geo(ids.box);
  const cx = (g2.el.left + g2.el.right) / 2;
  const cy = (g2.el.top + g2.el.bottom) / 2;
  const targetY = g2.layer.bottom - 8;
  await win.keyboard.down('Alt');
  await win.mouse.move(cx, cy);
  await sleep(180);
  await win.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await win.mouse.move(cx, cy + ((targetY - cy) * i) / 12);
    await sleep(24);
  }
  await win.mouse.up();
  await win.keyboard.up('Alt');
  await sleep(520);
  const g3 = await geo(ids.box);
  const onCount = ['left', 'right', 'top', 'bottom'].filter((k) => g3.style[k] && g3.style[k] !== 'auto').length;
  check('Alt 拖到底：贴在视口底（±14px）或直接写 bottom:0',
    g3.style.bottom === '0px' || near(g3.el.bottom, g3.layer.bottom, 14),
    `style.bottom=${g3.style.bottom} el.bottom=${Math.round(g3.el.bottom)} layer.bottom=${Math.round(g3.layer.bottom)}`);
  check('Alt 拖动后全元素最多两条偏移（面板最高权限）', onCount <= 2, JSON.stringify(g3.style));
  check('Alt 拖动后没有把滚动量烘进 top（top 不该出现三位数大值）',
    !(g3.style.top && g3.style.top !== 'auto' && parseFloat(g3.style.top) > 200),
    `top=${g3.style.top}`);

  // ── ⑦ 进场 / 退场动画 ──────────────────────────────────────────────────
  const enter = await win.evaluate(async () => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const root = window.__sceneStore.getState().scene.root;
    const id = root.children[root.children.length - 1].id;
    await new Promise((r) => setTimeout(r, 60));
    const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
    const cs = el ? getComputedStyle(el) : null;
    const anims = el && el.getAnimations ? el.getAnimations() : [];
    return {
      id,
      marked: !!el && el.getAttribute('data-bc-new') === '1',
      anim: cs ? cs.animationName : '',
      // 进场动画走 Web Animations API（React 会重写 style/className，CSS 动画会被抹掉）
      waapi: anims.length,
      animMode: document.documentElement.getAttribute('data-bc-anim') || 'full'
    };
  });
  check('新增元素打了进场标记', enter.marked, `data-bc-new=${enter.marked}`);
  // 进场动画走 Web Animations API —— 用 getAnimations() 量，不看 animationName
  // （React 会重写画布节点的 style/className，CSS 动画在这里会被抹掉）。
  check('新增元素在播进场动画（Web Animations）', enter.waapi >= 1,
    `getAnimations=${enter.waapi} animationName=${enter.anim}`);

  const leave = await win.evaluate(async ([tallId]) => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const root = window.__sceneStore.getState().scene.root;
    const id = root.children[root.children.length - 1].id;
    await new Promise((r) => setTimeout(r, 60));
    window.__sceneStore.getState().removeElement(id);
    await new Promise((r) => setTimeout(r, 40));
    const ghost = document.querySelectorAll('.canvas .bc-node-leaving');
    const count = ghost.length;
    const anim = count ? getComputedStyle(ghost[0]).animationName : '';
    await new Promise((r) => setTimeout(r, 400));
    return { count, anim, after: document.querySelectorAll('.canvas .bc-node-leaving').length, tallOk: !!document.querySelector(`.canvas [data-bc-id="${tallId}"]`) };
  }, [ids.tall]);
  check('删除元素时留下退场影子', leave.count >= 1, `count=${leave.count}`);
  check('退场影子在播 bcNodeOut', leave.anim === 'bcNodeOut', `animationName=${leave.anim}`);
  check('退场影子 200ms 后自己清掉', leave.after === 0, `after=${leave.after}`);

  const nonzero = errs.filter((e) => !/ResizeObserver loop/.test(e));
  check('无未捕获页面错误', nonzero.length === 0, nonzero.slice(0, 2).join(' | '));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
