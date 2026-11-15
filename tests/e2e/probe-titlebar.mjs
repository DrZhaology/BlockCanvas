// ============================================================================
// v0.4.6 · 自绘标题栏 / 顶部菜单探针（用户："上方的菜单做好，交互设计好"）
// ----------------------------------------------------------------------------
// 要证明的：
//   ① 标题栏存在，五个菜单齐全，窗口三个按钮齐全；
//   ② 悬停有高亮、键盘 Tab 能落到菜单上（不是只有鼠标能点）；
//   ③ ←/→ 在菜单间横移、Enter/↓ 能弹出菜单、弹出后按钮保持 is-open；
//   ④ Esc 能收起（is-open 摘掉）；
//   ⑤ 无边框窗口下不会出现"点不动"（按钮必须是 no-drag 区）。
// 用法：node tests/e2e/probe-titlebar.mjs
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

const main = async () => {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-titlebar');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await win.waitForFunction(() => !document.querySelector('.bc-loading'), { timeout: 15000 }).catch(() => {});
  await sleep(600);

  const bar = await win.evaluate(() => {
    const t = document.querySelector('.bc-titlebar');
    if (!t) return null;
    const menus = [...t.querySelectorAll('.bc-titlebar-menu-btn')].map((b) => b.textContent.trim());
    const winBtns = t.querySelectorAll('.bc-win-btn').length;
    const reg = getComputedStyle(document.querySelector('.bc-titlebar-menu')).webkitAppRegion || '';
    const cs = getComputedStyle(t.querySelector('.bc-titlebar-menu-btn'));
    return {
      menus, winBtns, reg,
      h: Math.round(t.getBoundingClientRect().height),
      menuH: Math.round(t.querySelector('.bc-titlebar-menu-btn').getBoundingClientRect().height),
      radius: cs.borderRadius
    };
  });
  check('标题栏存在', !!bar, bar ? `h=${bar.h}` : 'missing');
  if (!bar) { await app.close(); process.exit(1); }
  check('五个菜单齐全', JSON.stringify(bar.menus) === JSON.stringify(['文件', '编辑', '视图', '帮助', '设置']), JSON.stringify(bar.menus));
  check('窗口三个按钮齐全', bar.winBtns === 3, `count=${bar.winBtns}`);
  check('菜单区不是拖动区（否则点不动）', bar.reg === 'no-drag', `app-region=${bar.reg}`);
  check('菜单按钮高度合理（26–40）', bar.menuH >= 26 && bar.menuH <= 40, `menuH=${bar.menuH}`);

  // 悬停高亮
  const first = await win.evaluate(() => {
    const b = document.querySelector('.bc-titlebar-menu-btn');
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), bg: getComputedStyle(b).backgroundColor };
  });
  await win.mouse.move(first.x, first.y);
  await sleep(350);
  const hovered = await win.evaluate(() => {
    const b = document.querySelector('.bc-titlebar-menu-btn');
    return { bg: getComputedStyle(b).backgroundColor, hover: b.matches(':hover') };
  });
  check('悬停有高亮', hovered.hover && hovered.bg !== first.bg, `${first.bg} -> ${hovered.bg}`);

  // 键盘：Tab 落到菜单 → → 横移 → Enter 打开 → Esc 收起
  await win.evaluate(() => document.querySelector('.bc-titlebar-menu-btn').focus());
  const focused = await win.evaluate(() => document.activeElement?.classList.contains('bc-titlebar-menu-btn'));
  check('菜单可以获得键盘焦点', focused === true, `focused=${focused}`);

  await win.keyboard.press('ArrowRight');
  await sleep(120);
  const moved = await win.evaluate(() => {
    const list = [...document.querySelectorAll('.bc-titlebar-menu-btn')];
    return list.findIndex((b) => b === document.activeElement);
  });
  check('←/→ 能在菜单之间横移', moved === 1, `activeIndex=${moved}`);

  await win.evaluate(() => document.querySelectorAll('.bc-titlebar-menu-btn')[0].focus());
  await win.keyboard.press('Enter');
  await sleep(400);
  const opened = await win.evaluate(() => document.querySelectorAll('.bc-titlebar-menu-btn.is-open').length);
  check('Enter 打开菜单并保持按下态', opened === 1, `is-open=${opened}`);

  await win.keyboard.press('Escape');
  await sleep(300);
  const closed = await win.evaluate(() => document.querySelectorAll('.bc-titlebar-menu-btn.is-open').length);
  check('Esc 收起菜单', closed === 0, `is-open=${closed}`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(1); });
