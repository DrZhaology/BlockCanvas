// v0.4.6 第 47 批 · 竖屏手册侧边栏（进场动画 / 往左滑关闭 / 退场 / 可打断）
//
// 用户原话（第 45 批）：
//   「使用手册右侧的菜单改成往左边滑动关闭，有退出动画和打断动画，现在退出无动画。」
// 第 47 批补充：
//   「使用手册左边的菜单进入动画没有了，而且左上角的×拿掉，因为是按住这个侧边栏，
//     往左边滑动就可以关闭菜单。现在滑动关闭不了，会会谈关闭不了（会回弹）。」
//
// 这一版全部用**真实输入**（playwright 的 mouse.down/move/up）驱动：
// 合成 pointerdown 打在 aside 上能过，但真机手指一离开抽屉就收不到事件 ——
// 之前的探针正是因此没抓到"拖不动"的 bug（已补 setPointerCapture）。
//
// 逐条量：
//   ① 打开：有进场动画（位移从负值收敛到 0）
//   ② 遮罩点一下关闭：先滑出去再卸载（有退场动画）
//   ③ 可打断：退场途中按住 → 停住并回到打开态
//   ④ 真机往左拖 150px → 关闭并卸载
//   ⑤ 只滑 28px / 往右滑 / 上下滑 → 弹回原位，不关闭
//   ⑥ 已经**没有**左上角那颗 ×（用户要求拿掉）
//
// 用法：node tests/e2e/probe-help-drawer.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';
import { ensureEditor } from './ensure-editor.mjs';

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

const drawerX = (win) => win.evaluate(() => {
  const el = document.querySelector('.help-drawer');
  if (!el) return null;
  const t = getComputedStyle(el).transform;
  return t && t !== 'none' ? Math.round(new DOMMatrixReadOnly(t).m41) : 0;
});
const hasDrawer = (win) => win.evaluate(() => !!document.querySelector('.help-drawer'));
const dragBox = (win) => win.evaluate(() => {
  const el = document.querySelector('.help-drawer');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), x: Math.round(r.left + Math.min(140, r.width / 2)), y: Math.round(r.top + 220) };
});

/** 真机拖拽（鼠标 = 可信输入，和手指走同一套 pointer 事件） */
async function drag(win, { dx, dy = 0, steps = 10 }) {
  const b = await dragBox(win);
  if (!b) return null;
  await win.mouse.move(b.x, b.y);
  await win.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await win.mouse.move(b.x + (dx * i) / steps, b.y + (dy * i) / steps);
    await sleep(14);
  }
  const mid = await drawerX(win);
  await win.mouse.up();
  return { mid, ...b };
}

async function openDrawer(win) {
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.pt-bar1 .pt-btn')][0];
    b?.click();
  });
  await sleep(420);
}

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
  win.setDefaultTimeout(8000);
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(300, 400);
    w.setContentSize(412, 860);
    w.center();
  });
  await ensureEditor(win);
  await sleep(600);
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:help')));
  await win.waitForSelector('.help-page', { timeout: 15000 });
  await sleep(600);

  // —— ① 打开 + 进场动画 ——
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.pt-bar1 .pt-btn')][0];
    b?.click();
  });
  await sleep(40);
  const x40 = await drawerX(win);
  await sleep(90);
  const x130 = await drawerX(win);
  await sleep(300);
  const xDone = await drawerX(win);
  check('① 打开后抽屉挂上 DOM', xDone !== null);
  check('① 有进场动画（40ms 还在屏幕外/半路，130ms 更靠内，最终 0）',
    x40 !== null && x40 < -20 && x130 !== null && x130 > x40 && xDone === 0,
    `40ms=${x40} 130ms=${x130} 390ms=${xDone}`);
  const w = (await dragBox(win))?.w ?? 0;
  check('① 抽屉宽度合理（竖屏 ≤ 342）', w > 200 && w <= 342, `${w}px`);

  // —— ⑥ 左上角的 × 已经拿掉 ——
  check('⑥ 抽屉里没有「×」关闭按钮（用户要求拿掉）',
    await win.evaluate(() => !document.querySelector('.help-drawer-close')));

  // —— ② 点遮罩关闭：有退场动画 ——
  await win.evaluate(() => {
    document.querySelector('.help-drawer-scrim')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(90);
  const midExists = await hasDrawer(win);
  const midX = await drawerX(win);
  check('② 关闭瞬间抽屉仍在 DOM（不是"啪一下消失"）', midExists === true);
  check('② 关闭时正在滑出去（-width < x < 0）', midX !== null && midX < -4 && midX > -w, `x=${midX} / -${w}`);
  await sleep(420);
  check('② 退场播完（>260ms）后卸载', (await hasDrawer(win)) === false);

  // —— ③ 可打断：退场途中按住 → 停住，再往回拖能救回来 ——
  await openDrawer(win);
  await win.evaluate(() => {
    document.querySelector('.help-drawer-scrim')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(60);
  // 退场时抽屉已滑出一截：只能按它还露在屏幕上的右半截（否则坐标是负的、点不到）
  const b3 = await win.evaluate(() => {
    const el = document.querySelector('.help-drawer');
    const r = el.getBoundingClientRect();
    return { x: Math.max(12, Math.round(r.right - 40)), y: Math.round(r.top + 220) };
  });
  await win.mouse.move(b3.x, b3.y);
  await win.mouse.down();
  await sleep(120);
  const heldX = await drawerX(win);
  const heldCls = await win.evaluate(() => document.querySelector('.help-drawer')?.classList.contains('is-closing'));
  // 往回（右）拖 220px：从当前这半路位置抓回来
  for (let i2 = 1; i2 <= 10; i2++) {
    await win.mouse.move(b3.x + i2 * 22, b3.y);
    await sleep(14);
  }
  await win.mouse.up();
  await sleep(420);
  const afterIntr = await win.evaluate(() => {
    const el = document.querySelector('.help-drawer');
    if (!el) return { exists: false, x: null, closing: null };
    const t = getComputedStyle(el).transform;
    return { exists: true, x: t && t !== 'none' ? Math.round(new DOMMatrixReadOnly(t).m41) : 0, closing: el.classList.contains('is-closing') };
  });
  check('③ 退场途中按住 → is-closing 摘掉（动画停住）', heldCls === false, );
  check('③ 往回拖 220px 能救回来 → 抽屉仍在且回到 0',
    afterIntr.exists === true && afterIntr.x === 0 && afterIntr.closing === false,
    JSON.stringify(afterIntr));
  // —— ④ 真机往左拖 → 关闭 ——
  await sleep(300);
  const before4 = await drawerX(win);
  const d4 = await drag(win, { dx: -150, steps: 10 });
  check('④ 拖动跟手（中途位移 ≈ -150）', d4 && d4.mid !== null && d4.mid < -90 && d4.mid > -280,
    `起 ${before4} → 中途 ${d4?.mid}`);
  await sleep(420);
  check('④ 松手后关闭并卸载', (await hasDrawer(win)) === false);

  // —— ⑤ 轻微 / 反向 / 纵向：都不关 ——
  await openDrawer(win);
  const d5 = await drag(win, { dx: -28, steps: 4 });
  await sleep(420);
  check('⑤ 只滑 28px → 弹回原位，不关闭',
    (await hasDrawer(win)) === true && (await drawerX(win)) === 0, `中途=${d5?.mid}`);

  await drag(win, { dx: 60, steps: 4 });
  await sleep(420);
  check('⑤ 往右滑只有阻尼，松手回位', (await hasDrawer(win)) === true && (await drawerX(win)) === 0);

  await drag(win, { dx: 0, dy: -120, steps: 6 });
  await sleep(420);
  check('⑤ 纵向划 → 不当作滑动关闭', (await hasDrawer(win)) === true && (await drawerX(win)) === 0);

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
