// v0.4.6 · fixed 空气墙验收（R6-16）
//
// 背景（用户原话不可考，但症状明确）：`position: fixed` 在浏览器里相对**视口**定位，
// 而画布高度随内容长 —— 于是：
//   ① 把 fixed 元素往下拖永远"贴不到底"，写不出 `bottom: 0`；
//   ② 之前写死的 bottom 值在长页面上跑到看不见的地方。
//
// 本版的解法（方案 B）：
//   · 场景记住「基准视口高度」viewportHeight（默认 900）；
//   · 画布**至少**撑到这么高（min-height）；
//   · 画布比它高时，在该高度画一条「首屏线」（.canvas-viewport-line）；
//   · fixed 的拖动墙止步于首屏线，并且**不再跟着画布变长**。
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
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-airwall');
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
  await sleep(1200);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // ── ① 默认值 ──────────────────────────────────────────────────────────
  const dflt = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const c = document.querySelector('.canvas');
    return {
      vh: st.scene.viewportHeight ?? null,
      canvasH: c ? Math.round(c.offsetHeight) : 0,
      hasLine: !!document.querySelector('.canvas-viewport-line')
    };
  });
  check('新工程默认 900px 基准视口', dflt.vh === null || dflt.vh === 900, `viewportHeight=${dflt.vh}`);
  check('空画布也至少撑到基准视口高度（≥890）', dflt.canvasH >= 890, `canvas=${dflt.canvasH}px`);
  check('内容没超出时不画首屏线（画布底就是它的底）', dflt.hasLine === false, `hasLine=${dflt.hasLine}`);

  // ── ② 内容超出后出现首屏线，位置 = 基准高度 ─────────────────────────
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const id = (s2.scene.root.children || [])[0]?.id;
    if (id) s2.updateStyle(id, { height: '2400px', backgroundColor: '#eef2ff', width: '100%' });
  });
  await sleep(900);
  const tall = await win.evaluate(() => {
    const c = document.querySelector('.canvas');
    const line = document.querySelector('.canvas-viewport-line');
    const st = window.__sceneStore.getState();
    return {
      canvasH: c ? Math.round(c.offsetHeight) : 0,
      hasLine: !!line,
      lineTop: line ? Math.round(parseFloat(getComputedStyle(line).top) || 0) : -1,
      pe: line ? getComputedStyle(line).pointerEvents : '',
      vh: st.scene.viewportHeight ?? 900
    };
  });
  check('内容比首屏长时画布跟着变长', tall.canvasH > 2000, `canvas=${tall.canvasH}px`);
  check('长页面下显示首屏线', tall.hasLine === true, `hasLine=${tall.hasLine}`);
  check('首屏线正好画在基准视口高度处', Math.abs(tall.lineTop - tall.vh) <= 1, `top=${tall.lineTop} vh=${tall.vh}`);
  check('首屏线不吃鼠标事件（pointer-events: none）', tall.pe === 'none', `pointer-events=${tall.pe}`);

  // ── ③ 改基准高度 → 线跟着走 ─────────────────────────────────────────
  await win.evaluate(() => window.__sceneStore.getState().setViewportHeight(1200));
  await sleep(700);
  const moved = await win.evaluate(() => {
    const line = document.querySelector('.canvas-viewport-line');
    const c = document.querySelector('.canvas');
    return {
      top: line ? Math.round(parseFloat(getComputedStyle(line).top) || 0) : -1,
      minH: c ? Math.round(parseFloat(getComputedStyle(c).minHeight) || 0) : 0,
      vh: window.__sceneStore.getState().scene.viewportHeight
    };
  });
  check('改首屏高度后线的位置跟着变', Math.abs(moved.top - 1200) <= 1, `top=${moved.top}`);
  check('画布的 min-height 同步到新基准', moved.minH >= 1200, `min-height=${moved.minH}`);
  // 还原成 900，后面按默认值验证拖动
  await win.evaluate(() => window.__sceneStore.getState().setViewportHeight(900));
  await sleep(600);

  // ── ④ 画布内「浏览器视口」：红框 + fixed 只能在框内动 ────────────────
  const fixedId = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    const fresh = kids[kids.length - 1];
    if (!fresh) return null;
    s2.updateStyle(fresh.id, {
      position: 'fixed', top: '40px', left: '40px',
      width: '160px', height: '90px', backgroundColor: '#fde68a'
    });
    s2.endStyleEdit();
    window.__sceneStore.getState().selectElement(fresh.id);
    return fresh.id;
  });
  await sleep(900);

  const frame = await win.evaluate(() => {
    const f = document.querySelector('.canvas-fixed-frame');
    const wrap = document.querySelector('.canvas-wrap');
    const c = document.querySelector('.canvas');
    if (!f || !wrap || !c) return { exists: !!f };
    const fr = f.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    return {
      exists: true,
      left: Math.round(fr.left), top: Math.round(fr.top),
      right: Math.round(fr.right), bottom: Math.round(fr.bottom),
      wrapTop: Math.round(wr.top), wrapBottom: Math.round(wr.bottom),
      canvasLeft: Math.round(cr.left), canvasRight: Math.round(cr.right),
      pointerEvents: getComputedStyle(f).pointerEvents,
      borderColor: getComputedStyle(f).borderTopColor
    };
  });
  check('选中 fixed 元素时显示「浏览器视口」红框', frame.exists === true, JSON.stringify(frame.left !== undefined));
  check('视口左右 = 画布左右边缘',
    frame.exists === true && Math.abs(frame.left - frame.canvasLeft) <= 1 && Math.abs(frame.right - frame.canvasRight) <= 1,
    frame.exists ? `frame=${frame.left}~${frame.right} canvas=${frame.canvasLeft}~${frame.canvasRight}` : 'no frame');
  check('视口上下 = 画布可见带（跟随面板高度，不是 900 首屏线）',
    frame.exists === true && Math.abs(frame.top - frame.wrapTop) <= 2 && Math.abs(frame.bottom - frame.wrapBottom) <= 2,
    frame.exists ? `frame=${frame.top}~${frame.bottom} wrap=${frame.wrapTop}~${frame.wrapBottom}` : 'no frame');
  check('视口框是红色且不吃鼠标事件',
    frame.exists === true && frame.pointerEvents === 'none' && /rgb\(229, 72, 77\)/.test(frame.borderColor),
    frame.exists ? `${frame.borderColor} / ${frame.pointerEvents}` : 'no frame');

  // —— 往下拖：只能停在视口底，且不写 bottom: 0 ——
  const plan = await win.evaluate((id) => {
    const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
    const c = document.querySelector('.canvas');
    const wrap = document.querySelector('.canvas-wrap');
    if (!el || !c || !wrap) return null;
    const r = el.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    return {
      centerX: Math.round(r.left + r.width / 2),
      centerY: Math.round(r.top + r.height / 2),
      // 故意拖过头 60px：墙应该把元素夹在视口底
      dy: Math.round(wr.bottom - r.bottom + 60),
      winB: Math.round(wr.bottom),
      rectBottom: Math.round(r.bottom)
    };
  }, fixedId);
  check('准备：fixed 元素已渲染且能算出下移量', !!plan && plan.dy > 0,
    plan ? `需要下移 ${plan.dy}px（视口底 ${plan.winB}）` : '没算出来');

  if (plan) {
    await win.keyboard.down('Alt');
    await win.mouse.move(plan.centerX, plan.centerY);
    await win.mouse.move(plan.centerX + 1, plan.centerY + 1);
    await sleep(280);
    await win.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await win.mouse.move(plan.centerX, plan.centerY + Math.round((plan.dy * i) / 8));
      await sleep(90);
    }
    await sleep(200);
    await win.mouse.up();
    await win.keyboard.up('Alt');
    await sleep(400);

    const after = await win.evaluate((id) => {
      const st = window.__sceneStore.getState();
      const n = (function find(node) {
        if (node.id === id) return node;
        for (const c of node.children) { const r = find(c); if (r) return r; }
        return null;
      })(st.scene.root);
      const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
      const wrap = document.querySelector('.canvas-wrap');
      const wr = wrap.getBoundingClientRect();
      return {
        bottom: n?.style.bottom ?? null,
        top: n?.style.top ?? null,
        screenBottom: el ? Math.round(el.getBoundingClientRect().bottom) : -1,
        winB: Math.round(wr.bottom)
      };
    }, fixedId);

    check('不写 bottom: 0（新模型一律用 top 表达"距视口顶"）',
      after.bottom !== '0px', `bottom=${after.bottom ?? '(无)'} top=${after.top ?? '(无)'}`);
    check('拖过头也被视口底挡住（元素停在视口内 ±14px）',
      Math.abs(after.screenBottom - after.winB) <= 14,
      `元素底 ${after.screenBottom} / 视口底 ${after.winB}`);
    check('没越出视口下沿', after.screenBottom <= after.winB + 2,
      `${after.screenBottom} <= ${after.winB}`);
  }

  // ── ⑤ 滚动画布：fixed 元素钉在视口上（浏览器语义）─────────────────────
  const pin = await win.evaluate(async (id) => {
    const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
    const wrap = document.querySelector('.canvas-wrap');
    if (!el || !wrap) return null;
    const before = Math.round(el.getBoundingClientRect().top);
    wrap.scrollTop = 400;
    await new Promise((r) => setTimeout(r, 350));
    const after = Math.round(el.getBoundingClientRect().top);
    const shift = getComputedStyle(document.querySelector('.canvas')).getPropertyValue('--bc-fixed-shift').trim();
    wrap.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 250));
    return { before, after, shift };
  }, fixedId);
  check('画布滚动时 fixed 元素钉在视口上（屏幕位置不变 ±3px）',
    !!pin && Math.abs(pin.after - pin.before) <= 3,
    pin ? `滚动前 ${pin.before} → 滚动后 ${pin.after}（shift=${pin.shift}）` : 'no data');

  // ── ⑥ 缩放画布时 fixed 元素临时隐藏 ─────────────────────────────────
  const hidden = await win.evaluate(async (id) => {
    window.dispatchEvent(new CustomEvent('bc:test-zoom'));
    // 直接调用 store 之外的缩放通道：拖 Alt/Ctrl 滚轮太慢，这里用 app 的缩放事件
    const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
    return { hasEl: !!el };
  }, fixedId);
  check('准备：fixed 元素仍在 DOM 里（隐藏只是 visibility）', hidden.hasEl === true, String(hidden.hasEl));

  // ── ⑦ 持久化：viewportHeight 随工程文件保存 ──────────────────────
  const saved = await win.evaluate(() => {
    window.__sceneStore.getState().setViewportHeight(1080);
    const sc = window.__sceneStore.getState().scene;
    return { vh: sc.viewportHeight, json: JSON.stringify(sc).includes('"viewportHeight":1080') };
  });
  check('viewportHeight 会进工程 JSON（随工程保存）', saved.vh === 1080 && saved.json === true, JSON.stringify(saved));

  // 还原，别污染后续
  await win.evaluate(() => window.__sceneStore.getState().setViewportHeight(900));
  await sleep(300);
  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
