// ============================================================================
// v0.4.6 · 竖屏二级菜单 / 抽屉覆盖 取证脚本
// ----------------------------------------------------------------------------
// 用法：node tests/e2e/shots-portrait-menus.mjs
// 产物：tests/e2e/shots-portrait-menus/*.png（生成物，不入库）
//
// 这一支专门回答三个只能靠"量 + 看"的问题：
//   1. 二级菜单是不是**紧贴按钮**打开（不许飘到屏幕上方）；
//   2. 菜单有没有盖住手指位置（菜单矩形不许和"点它的那个点"重叠太多）；
//   3. 左右面板打开时，**第二条操作栏是否真的被盖住**（面板底边 vs 栏顶边）。
// 数字全打印出来，截图逐张人眼看。
// ============================================================================
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const OUT = resolve(ROOT, 'tests/e2e/shots-portrait-menus');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const DATA_DIR = resolve(tmpdir(), 'bc-shots-ptmenus');
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
  await win.waitForFunction(() => !document.querySelector('.bc-loading'), { timeout: 15000 }).catch(() => {});
  await sleep(600);

  const shot = async (name) => { await win.screenshot({ path: resolve(OUT, name + '.png') }); };
  const rectOf = (sel) => win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) };
  }, sel);
  // 面板是 React 状态驱动的，个别时候比 sleep 慢一拍 → 轮询 1.2s，别用固定等待猜
  const waitRect = async (sel) => {
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      const r = await rectOf(sel);
      if (r) { console.log(`   (${sel} 出现于 ${Date.now() - t0}ms)`); return r; }
      await sleep(50);
    }
    return null;
  };

  // —— 建项目 → 进编辑器 ——
  await win.locator('.eh-actions .eh-btn', { hasText: '新建项目' }).first().click();
  await sleep(1400);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // —— 竖屏：先 unmaximize 再 setSize（最大化时 setSize 会被静默忽略）——
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); });
  await sleep(200);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(412, 860); w.center(); });
  await sleep(700);
  const shell = await win.evaluate(() => document.querySelector('.app')?.getAttribute('data-shell'));
  console.log('data-shell =', shell);

  /* ① 「更多」二级菜单 */
  const moreBtn = await rectOf('.tb-more-btn');
  await win.locator('.tb-more-btn').click();
  await sleep(320);
  const morePanel = await rectOf('.pt-menu-panel');
  await shot('01-more-menu');
  // 菜单底边应该贴着按钮顶边（gap 6px），并且整体在屏幕下半部
  const moreGap = morePanel && moreBtn ? moreBtn.y - morePanel.bottom : null;
  const moreInLowerHalf = morePanel ? morePanel.y > 200 : null;
  console.log('① 更多', JSON.stringify({ btn: moreBtn, panel: morePanel, gap: moreGap, lowerHalf: moreInLowerHalf }));

  await win.keyboard.press('Escape');
  await sleep(260);

  /* ② 「设备」二级菜单 */
  const devBtn = await rectOf('.tb-device-pt-btn');
  await win.locator('.tb-device-pt-btn').click();
  await sleep(320);
  const devPanel = await waitRect('.tb-device-panel');
  await shot('02-device-menu');
  const devGap = devPanel && devBtn ? devBtn.y - devPanel.bottom : null;
  console.log('② 设备', JSON.stringify({ btn: devBtn, panel: devPanel, gap: devGap }));
  if (!devPanel) {
    const diag = await win.evaluate(() => ({
      anchors: document.querySelectorAll('.tb-anchored-panel').length,
      menus: [...document.querySelectorAll('.tb-anchored-panel')].map((e) => e.className)
    }));
    console.log('   诊断', JSON.stringify(diag));
  }

  await win.keyboard.press('Escape');
  await sleep(260);

  /* ③ 入口「三」二级菜单 */
  const entryBtn = await rectOf('.pt-entry > .pt-btn');
  await win.locator('.pt-entry > .pt-btn').click();
  await sleep(320);
  const entryPanel = await rectOf('.pt-entry-menu');
  await shot('03-entry-menu');
  const bar1 = await rectOf('.pt-bar1');
  const entryGap = entryPanel ? bar1.y - entryPanel.bottom : null;
  console.log('③ 入口', JSON.stringify({ btn: entryBtn, panel: entryPanel, bar1Top: bar1.y, gap: entryGap }));

  await win.mouse.click(206, 300);
  await sleep(260);

  /* ④ 左面板（元素）打开：底边是否盖住第二条栏 */
  const bar2Before = await rectOf('.pt-bar2');
  await win.locator('.shell-drawer-btn.is-left').click();
  await sleep(420);
  const leftPane = await rectOf('.elem-pane-wrap');
  await shot('04-left-drawer');
  console.log('④ 左面板', JSON.stringify({
    bar2Top: bar2Before.y, bar2Bottom: bar2Before.bottom,
    pane: leftPane,
    coversBar2: leftPane ? leftPane.bottom > bar2Before.y + 4 : null
  }));
  // 面板里那颗按钮是否真的压在栏上面（点面板底部位置，看命中谁）
  const hitAtBar2 = await win.evaluate((y) => {
    const el = document.elementFromPoint(150, y);
    return el ? (el.closest('.pt-bar2') ? 'bar2' : (el.closest('.elem-pane-wrap') ? 'pane' : (el.className || el.tagName))) : 'none';
  }, bar2Before.y + 20);
  console.log('   栏上 20px 处命中 =', hitAtBar2);

  // 面板打开后把手被面板自己盖住了（抽屉 86vw 从 x=0 起），
  // 关抽屉只能点遮罩 —— 顺便验证遮罩真的盖住了第二条栏。
  await win.mouse.click(395, 300);
  await sleep(420);

  /* ⑤ 右面板（属性）打开 */
  await win.locator('.shell-drawer-btn.is-right').click();
  await sleep(420);
  const rightPane = await rectOf('.right-pane-wrap');
  await shot('05-right-drawer');
  const hitRight = await win.evaluate((y) => {
    const el = document.elementFromPoint(300, y);
    return el ? (el.closest('.pt-bar2') ? 'bar2' : (el.closest('.right-pane-wrap') ? 'pane' : (el.className || el.tagName))) : 'none';
  }, bar2Before.y + 20);
  console.log('⑤ 右面板', JSON.stringify({ bar2Top: bar2Before.y, pane: rightPane, coversBar2: rightPane ? rightPane.bottom > bar2Before.y + 4 : null, hit: hitRight }));

  console.log('页面错误', errs.length ? errs.join(' | ') : 'none');
  await app.close();
};

main().catch((e) => { console.error(e); process.exit(1); });
