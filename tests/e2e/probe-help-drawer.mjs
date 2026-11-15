// v0.4.6 第 45 批 · 竖屏手册侧边栏（往左滑关闭 / 退场动画 / 可打断）
//
// 用户原话：「使用手册右侧的菜单改成往左边滑动关闭，有退出动画和打断动画，
//   现在退出无动画。」
//
// 之前它是 `{sidebarOpen && …}` 条件渲染 → 关掉时整个卸载，退场动画没机会播。
// 这份探针逐条量五件事：
//   ① 打开：抽屉挂上 DOM，且从屏幕外滑到位（transform 收敛到 0）
//   ② 点 × 关闭：抽屉**不会立刻消失**，而是滑出去；260ms 后才卸载
//   ③ 可打断：退场途中按住 → 抽屉停住并回到"打开"态（不回起点、不卸载）
//   ④ 往左滑：位移跟手（≈ 手指位移），松手后关闭
//   ⑤ 轻微左滑 / 往右滑：松手弹回原位，不关闭
//
// 用法：node tests/e2e/probe-help-drawer.mjs
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

/** 抽屉当前的横向位移（px，0 = 完全展开，负 = 正在往左滑出） */
const drawerX = (win) => win.evaluate(() => {
  const el = document.querySelector('.help-drawer');
  if (!el) return null;
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  try { return Math.round(new DOMMatrixReadOnly(t).m41); } catch { return 0; }
});

const hasDrawer = (win) => win.evaluate(() => !!document.querySelector('.help-drawer'));

/** 在抽屉上模拟一次手指拖拽（PointerEvent 序列，React 走的是同一套） */
const drag = (win, { dx, steps = 6, holdMs = 0 }) => win.evaluate(async ({ dx, steps, holdMs }) => {
  const el = document.querySelector('.help-drawer');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const x0 = Math.round(r.left + Math.min(120, r.width / 2));
  const y0 = Math.round(r.top + 120);
  const fire = (type, x, y) => el.dispatchEvent(new PointerEvent(type, {
    pointerId: 77, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
    clientX: x, clientY: y
  }));
  fire('pointerdown', x0, y0);
  if (holdMs) await new Promise((res) => setTimeout(res, holdMs));
  for (let i = 1; i <= steps; i++) {
    fire('pointermove', x0 + (dx * i) / steps, y0);
    await new Promise((res) => requestAnimationFrame(res));
  }
  fire('pointerup', x0 + dx, y0);
  return true;
}, { dx, steps, holdMs });

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-help-drawer');
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

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(300, 400);
    w.setContentSize(412, 860);
    w.center();
  });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);

  // 进手册页（竖屏）：第一条栏最左那颗「侧边栏」
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:help')));
  await win.waitForSelector('.help-page', { timeout: 15000 });
  await sleep(500);
  const openBtn = win.locator('.pt-bar1 .pt-btn').first();
  await openBtn.click();
  await sleep(420);

  // —— ① 打开：滑到位 ——
  const opened = await hasDrawer(win);
  const xOpen = await drawerX(win);
  check('① 打开后抽屉挂上 DOM 且停在展开位（transform ≈ 0）', opened && xOpen === 0, `x=${xOpen}`);
  const w = await win.evaluate(() => Math.round(document.querySelector('.help-drawer')?.getBoundingClientRect().width ?? 0));
  check('① 抽屉宽度合理（竖屏 ≤ 342）', w > 200 && w <= 342, `${w}px`);

  // —— ② 点 × 关闭：有退场动画，260ms 后才卸载 ——
  await win.evaluate(() => {
    document.querySelector('.help-drawer-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(90);
  const midExists = await hasDrawer(win);
  const midX = await drawerX(win);
  check('② 关闭瞬间抽屉仍在 DOM（不是"啪一下消失"）', midExists === true, `exists=${midExists}`);
  check('② 关闭时抽屉正在滑出去（-width < x < 0）',
    midX !== null && midX < -4 && midX > -w, `x=${midX} / -${w}`);
  check('② 遮罩也在淡出（.is-closing）', await win.evaluate(() => {
    const s = document.querySelector('.help-drawer-scrim');
    return !!s && s.classList.contains('is-closing');
  }) === true);
  await sleep(420);
  const goneAfter = await hasDrawer(win);
  const xAfter = await drawerX(win);
  check('② 退场播完（>260ms）后抽屉卸载', goneAfter === false, `exists=${goneAfter} x=${xAfter}`);

  // —— ③ 可打断：退场途中按住 → 抽屉**停在半路**，往回拖能救回来 ——
  await openBtn.click();
  await sleep(400);
  const intr = await win.evaluate(async () => {
    const el0 = document.querySelector('.help-drawer');
    const readX = () => {
      const el = document.querySelector('.help-drawer');
      if (!el) return null;
      const t = getComputedStyle(el).transform;
      return t && t !== 'none' ? Math.round(new DOMMatrixReadOnly(t).m41) : 0;
    };
    // 先点 × 开始退场，等 90ms 让它滑出去一截
    document.querySelector('.help-drawer-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 90));
    const xMid = readX();
    const el = document.querySelector('.help-drawer');
    const r = el.getBoundingClientRect();
    const x0 = Math.round(r.left + 100);
    const y0 = Math.round(r.top + 160);
    const fire = (type, x, y) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: 79, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
      clientX: x, clientY: y
    }));
    // 按住不放 → 动画应当停在这一帧，并且回到打开态（is-closing 摘掉）
    fire('pointerdown', x0, y0);
    await new Promise((r2) => setTimeout(r2, 120));
    const heldX = readX();
    const heldClosing = document.querySelector('.help-drawer')?.classList.contains('is-closing') ?? null;
    const heldExists = !!document.querySelector('.help-drawer');
    // 往回（右）拖 200px：打断之后要能从当前位置抓回来，而不是跳回起点
    for (let i = 1; i <= 10; i++) {
      fire('pointermove', x0 + i * 20, y0);
      await new Promise((r2) => requestAnimationFrame(r2));
    }
    const draggedX = readX();
    fire('pointerup', x0 + 200, y0);
    await new Promise((r2) => setTimeout(r2, 320));
    return {
      xMid, heldX, heldClosing, heldExists, draggedX,
      xEnd: readX(),
      exists: !!document.querySelector('.help-drawer'),
      closing: document.querySelector('.help-drawer')?.classList.contains('is-closing') ?? null
    };
  });
  check('③ 退场途中按住 → 抽屉没有继续卸载（还在 DOM）', intr.heldExists === true, `exists=${intr.heldExists}`);
  check('③ 按住时动画停住（两次采样位移几乎不变，不是继续滑出）',
    intr.heldX !== null && intr.xMid !== null && Math.abs(intr.heldX - intr.xMid) < 24,
    `x 中途=${intr.xMid} → 按住 120ms 后=${intr.heldX}`);
  check('③ 打断后回到打开态（is-closing 已摘掉）', intr.heldClosing === false, `closing=${intr.heldClosing}`);
  check('③ 从当前位置往回拖能救回来（拖 200px 后位移明显变小）',
    intr.draggedX !== null && intr.heldX !== null && intr.draggedX > intr.heldX + 60,
    `${intr.heldX} → ${intr.draggedX}`);
  check('③ 松手后抽屉留在展开位、没有卸载', intr.exists === true && intr.closing === false && intr.xEnd === 0,
    `exists=${intr.exists} closing=${intr.closing} x=${intr.xEnd}`);

  // —— ④ 往左滑关闭：位移跟手 ——
  // ⚠ 必须在**松手前**采样：松手那一刻就进入退场动画了，再读就是正在滑出的值。
  await sleep(420);
  const swipe = await win.evaluate(async () => {
    const readX = () => {
      const el = document.querySelector('.help-drawer');
      if (!el) return null;
      const t = getComputedStyle(el).transform;
      return t && t !== 'none' ? Math.round(new DOMMatrixReadOnly(t).m41) : 0;
    };
    const el = document.querySelector('.help-drawer');
    const r = el.getBoundingClientRect();
    const x0 = Math.round(r.left + 100);
    const y0 = Math.round(r.top + 160);
    const fire = (type, x, y) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: 80, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
      clientX: x, clientY: y
    }));
    fire('pointerdown', x0, y0);
    for (let i = 1; i <= 8; i++) {
      fire('pointermove', x0 - i * 17.5, y0);
      await new Promise((res) => requestAnimationFrame(res));
    }
    const followX = readX();             // 松手前：应该 ≈ -140（跟手）
    fire('pointerup', x0 - 140, y0);
    await new Promise((res) => setTimeout(res, 420));
    return { followX, exists: !!document.querySelector('.help-drawer') };
  });
  check('④ 往左拖 140px → 抽屉跟手到 -140 附近（-200 < x < -70）',
    swipe.followX !== null && swipe.followX < -70 && swipe.followX > -200, `x=${swipe.followX}`);
  check('④ 左滑超过 30% 宽度 → 松手后关闭并卸载', swipe.exists === false, `exists=${swipe.exists}`);

  // —— ⑤ 轻微左滑 / 往右滑：弹回，不关闭 ——
  await openBtn.click();
  await sleep(400);
  const x0 = await drawerX(win);
  await drag(win, { dx: -30, steps: 4 });
  await sleep(420);
  const xSmall = await drawerX(win);
  const stillOpen = await hasDrawer(win);
  check('⑤ 只滑 30px → 松手弹回原位（不关闭）', stillOpen === true && xSmall === 0,
    `起 ${x0} → ${xSmall} exists=${stillOpen}`);

  await drag(win, { dx: 60, steps: 4 });
  await sleep(420);
  const xRight = await drawerX(win);
  const stillOpen2 = await hasDrawer(win);
  check('⑤ 往右滑只有阻尼（不会把抽屉拽出去，松手回位）',
    stillOpen2 === true && xRight === 0, `x=${xRight} exists=${stillOpen2}`);

  // 纵向划一下不应该被当成"滑动关闭"（目录很长，要能滚）
  const scrollBefore = await win.evaluate(() => document.querySelector('.help-drawer-toc')?.scrollTop ?? -1);
  await win.evaluate(async () => {
    const el = document.querySelector('.help-drawer');
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + 100);
    const y = Math.round(r.top + 200);
    const fire = (type, cy) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: 78, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
      clientX: x, clientY: cy
    }));
    fire('pointerdown', y);
    for (let i = 1; i <= 5; i++) { fire('pointermove', y - i * 20); await new Promise((res) => setTimeout(res, 16)); }
    fire('pointerup', y - 100);
  });
  await sleep(380);
  const afterVertical = await drawerX(win);
  const stillOpen3 = await hasDrawer(win);
  check('⑤ 纵向划 → 不当作滑动关闭（抽屉留在原位）',
    stillOpen3 === true && afterVertical === 0, `x=${afterVertical} exists=${stillOpen3} toc=${scrollBefore}`);

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
