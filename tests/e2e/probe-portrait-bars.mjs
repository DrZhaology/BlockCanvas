// v0.4.6 · 竖屏底部两条操作栏契约（第二条的展开/折叠 + 入口菜单层级）
//
// 用户在意的四件事，逐条量：
//   ① 折叠态：第二条栏高度 ≤72，里面工具栏是**单行**（不换行）
//   ② 长按 380ms 后向上滑 ≥24px → 展开（栏变高、按钮换行铺开）
//   ③ 展开后向下滑 ≥24px → 收回去（高度回到折叠态）
//   ④ 入口「三」的菜单：fixed 定位、整块在第二条栏**上方**、点旁边会关
//      （用户原话："二级菜单的 z-index 不对，层级不对，菜单被覆盖了"）
//
// 用法：node tests/e2e/probe-portrait-bars.mjs
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-bars');
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
  await sleep(700);
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1500);
  await win.waitForSelector('.pt-bar2', { timeout: 15000 });
  await sleep(400);

  const m = () => win.evaluate(() => {
    const b2 = document.querySelector('.pt-bar2');
    const tb = document.querySelector('.pt-bar2 .toolbar');
    const main = document.querySelector('.pt-bar2 .tb-main');
    const r = b2?.getBoundingClientRect();
    return {
      bar2H: r ? Math.round(r.height) : 0,
      expanded: b2?.classList.contains('is-expanded') ?? null,
      toolbarH: tb ? Math.round(tb.getBoundingClientRect().height) : 0,
      // 折叠态应该是单行：主按钮区高度 < 两行
      mainH: main ? Math.round(main.getBoundingClientRect().height) : 0,
      btnCount: document.querySelectorAll('.pt-bar2 .toolbar button').length
    };
  });

  const collapsed = await m();
  check('① 折叠态：第二条栏高度 ≤72（Alt 开关抬高了一行抓手）',
    collapsed.bar2H > 0 && collapsed.bar2H <= 72, `bar2=${collapsed.bar2H}`);
  check('① 折叠态：工具栏是单行（主按钮区高度 ≤ 52）',
    collapsed.mainH > 0 && collapsed.mainH <= 52, `mainH=${collapsed.mainH} toolbar=${collapsed.toolbarH}`);

  /** 在第二条栏上做一次"长按 + 纵向滑动" */
  const holdSwipe = async (dy) => {
    await win.evaluate((delta) => {
      const bar = document.querySelector('.pt-bar2');
      if (!bar) return;
      const r = bar.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + 12);
      const ev = (type, cy) => bar.dispatchEvent(new PointerEvent(type, {
        pointerId: 31, pointerType: 'touch', isPrimary: true,
        clientX: x, clientY: cy, bubbles: true, cancelable: true
      }));
      ev('pointerdown', y);
      // 长按 380ms 之后才开始纵滑
      window.setTimeout(() => {
        for (let i = 1; i <= 6; i++) ev('pointermove', y + (delta * i) / 6);
        ev('pointerup', y + delta);
      }, 430);
    }, dy);
    await sleep(900);
  };

  await holdSwipe(-70);
  const expanded = await m();
  check('② 长按上滑 → 展开（is-expanded 且栏变高）',
    expanded.expanded === true && expanded.bar2H > collapsed.bar2H + 20,
    `expanded=${expanded.expanded} bar2 ${collapsed.bar2H} → ${expanded.bar2H}`);
  check('② 展开态按钮换行铺开（主按钮区高度 > 折叠态）',
    expanded.mainH > collapsed.mainH, `mainH ${collapsed.mainH} → ${expanded.mainH}`);

  await holdSwipe(70);
  const back = await m();
  check('③ 展开后下滑 → 收回折叠态',
    back.expanded === false && back.bar2H <= 72,
    `expanded=${back.expanded} bar2=${back.bar2H}`);

  // ④ 入口菜单：层级与位置
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.pt-bar1 .pt-btn')];
    btns[btns.length - 1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(400);
  const menu = await win.evaluate(() => {
    const el = document.querySelector('.pt-entry-menu');
    const b2 = document.querySelector('.pt-bar2');
    const b1 = document.querySelector('.pt-bar1');
    if (!el) return { exists: false };
    const r = el.getBoundingClientRect();
    const r2 = b2?.getBoundingClientRect();
    const r1 = b1?.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // 菜单中心点上最顶层的元素必须落在菜单里（没被栏盖住）
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      exists: true,
      position: cs.position,
      zIndex: cs.zIndex,
      bottom: Math.round(r.bottom),
      bar2Top: r2 ? Math.round(r2.top) : -1,
      bar1Top: r1 ? Math.round(r1.top) : -1,
      onTop: !!el.contains(top),
      topCls: top ? String(top.className || '').slice(0, 30) : null
    };
  });
  check('④ 入口菜单存在且是 fixed 定位', menu.exists && menu.position === 'fixed',
    JSON.stringify(menu));
  check('④ 菜单整块在第二条栏上方（bottom ≤ 第二栏顶）',
    menu.exists && menu.bottom <= menu.bar2Top + 2,
    `menuBottom=${menu.bottom} bar2Top=${menu.bar2Top}`);
  check('④ 菜单没被栏盖住（中心点命中的就是菜单自己）',
    menu.exists && menu.onTop === true, `命中=${menu.topCls}`);

  // 点旁边关闭
  await win.evaluate(() => {
    document.querySelector('.sess-page')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  });
  await sleep(300);
  const closed = await win.evaluate(() => !document.querySelector('.pt-entry-menu'));
  check('④ 点旁边 → 菜单关闭', closed === true, String(closed));

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
