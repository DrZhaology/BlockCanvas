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

  // ── ④ fixed 往下拖：能贴到首屏线，写出 bottom: 0 ──────────────────
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

  // 计算"把元素底边拖到首屏线附近"需要移动多少
  const plan = await win.evaluate((id) => {
    const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
    const c = document.querySelector('.canvas');
    if (!el || !c) return null;
    const r = el.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    const vh = window.__sceneStore.getState().scene.viewportHeight ?? 900;
    const lineScreenY = cr.top + vh;
    return {
      centerX: Math.round(r.left + r.width / 2),
      centerY: Math.round(r.top + r.height / 2),
      // 故意**拖过头 40px**：让"墙"把元素夹在首屏线上。
      // 这样同时验证两件事：墙挡住了（不越界）+ 撞墙后松手归一化成 bottom:0。
      dy: Math.round(lineScreenY - r.bottom + 40),
      lineScreenY: Math.round(lineScreenY),
      rectBottom: Math.round(r.bottom),
      canvasH: Math.round(cr.height)
    };
  }, fixedId);
  check('准备：fixed 元素已渲染，首屏线在可视范围内的上方', !!plan && plan.dy > 0 && plan.canvasH > plan.lineScreenY,
    plan ? `需要下移 ${plan.dy}px（canvasH=${plan.canvasH} 线=${plan.lineScreenY}）` : '没算出来');

  if (plan) {
    // 分步移动（一次大跳会跳过 Alt 悬停判定）
    await win.keyboard.down('Alt');
    await win.mouse.move(plan.centerX, plan.centerY);
    await win.mouse.move(plan.centerX + 1, plan.centerY + 1);
    await sleep(280);
    await win.mouse.down();
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await win.mouse.move(plan.centerX, plan.centerY + Math.round((plan.dy * i) / steps));
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
      const c = document.querySelector('.canvas');
      const vh = st.scene.viewportHeight ?? 900;
      return {
        bottom: n?.style.bottom ?? null,
        top: n?.style.top ?? null,
        renderedBottom: el ? Math.round(el.getBoundingClientRect().bottom - c.getBoundingClientRect().top) : -1,
        canvasH: c ? Math.round(c.offsetHeight) : 0,
        vh
      };
    }, fixedId);

    /**
     * ⚠ 这里是最容易想错的一条：
     * 画布自己就是 fixed 的包含块，所以 `bottom: 0` 在长页面上解析成**画布底**（几千米外）。
     * 因此长页面上**不能**归一化成 bottom: 0 —— 那会让元素一松手就飞走。
     * 正确行为：墙把元素夹在首屏线上，写法保留数值（top: Npx），位置纹丝不动。
     * 短页面（画布高度 ≈ 基准视口）时 bottom: 0 恰好等于首屏底，那时才写它。
     */
    check('长页面上不写 bottom: 0（写了会让元素一松手跳到页面最底部）',
      after.bottom !== '0px',
      `bottom=${after.bottom ?? '(无)'} top=${after.top ?? '(无)'}`);
    check('位置稳在首屏线附近，没有被墙体夹住后跳走',
      Math.abs(after.renderedBottom - after.vh) <= 14,
      `底部在 ${after.renderedBottom}px / 首屏 ${after.vh}px（画布 ${after.canvasH}px）`);
    check('没越界：元素底边不越过首屏线', after.renderedBottom <= after.vh + 2,
      `底部 ${after.renderedBottom} / 线 ${after.vh}`);
  }

  // ── ⑤ 短页面：此时 bottom: 0 恰好等于首屏底，应该写得出来 ──────────
  // 先清掉撑高度的元素，让画布回到"刚好一屏"
  await win.evaluate((fid) => {
    const st = window.__sceneStore.getState();
    const rm = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (c.id !== fid) rm.push(c.id);
        walk(c);
      }
    };
    walk(st.scene.root);
    for (const id of rm) st.removeMany([id]);
  }, fixedId);
  await sleep(900);

  const shortAgain = await win.evaluate((id) => {
    const st = window.__sceneStore.getState();
    const c = document.querySelector('.canvas');
    const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
    return {
      canvasH: c ? Math.round(c.offsetHeight) : 0,
      hasLine: !!document.querySelector('.canvas-viewport-line'),
      exists: !!el,
      vh: st.scene.viewportHeight ?? 900
    };
  }, fixedId);
  check('清掉长内容后画布回到一屏高、首屏线隐藏',
    shortAgain.canvasH <= shortAgain.vh + 40 && shortAgain.hasLine === false,
    `canvas=${shortAgain.canvasH} hasLine=${shortAgain.hasLine}`);

  if (shortAgain.exists) {
    // 把元素放到**首屏中段**再往下拖到底 —— 起点必须留出鼠标下移的空间，
    // 否则起点本身就贴着窗口下沿，Playwright 的移动根本到不了墙（也就没有贴边吸附）。
    await win.evaluate((id) => {
      const st = window.__sceneStore.getState();
      st.beginStyleEdit();
      st.updateStyle(id, { top: '300px', bottom: undefined, left: '40px', right: undefined });
      st.endStyleEdit();
    }, fixedId);
    await sleep(700);
    const p2 = await win.evaluate((id) => {
      const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
      const c = document.querySelector('.canvas');
      if (!el || !c) return { cx: 0, cy: 0, dy: 0, missing: true };
      const r = el.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      const vh = window.__sceneStore.getState().scene.viewportHeight ?? 900;
      return {
        cx: Math.round(r.left + r.width / 2),
        cy: Math.round(r.top + r.height / 2),
        dy: Math.round((cr.top + vh) - r.bottom + 40),
        // 诊断：元素是否在可交互的视口内
        inView: r.top > 0 && r.bottom < window.innerHeight,
        rectTop: Math.round(r.top),
        rectBottom: Math.round(r.bottom),
        winH: window.innerHeight
      };
    }, fixedId);
    console.log('  短页面拖动计划:', JSON.stringify(p2));
    await win.keyboard.down('Alt');
    await win.mouse.move(p2.cx, p2.cy);
    await win.mouse.move(p2.cx + 1, p2.cy + 1);
    await sleep(280);
    await win.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await win.mouse.move(p2.cx, p2.cy + Math.round((p2.dy * i) / 8));
      await sleep(90);
    }
    await sleep(200);
    await win.mouse.up();
    await win.keyboard.up('Alt');
    await sleep(400);
    const shortAfter = await win.evaluate((id) => {
      const st = window.__sceneStore.getState();
      const n = (function find(node) {
        if (node.id === id) return node;
        for (const c of node.children) { const r = find(c); if (r) return r; }
        return null;
      })(st.scene.root);
      return { bottom: n?.style.bottom ?? null, top: n?.style.top ?? null };
    }, fixedId);
    check('短页面上拖到首屏底 → 归一化成 bottom: 0px（可读、可维护）',
      shortAfter.bottom === '0px', `bottom=${shortAfter.bottom ?? '(无)'} top=${shortAfter.top ?? '(无)'}`);
  }

  // ── ⑥ 持久化：viewportHeight 随工程文件保存 ──────────────────────
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
