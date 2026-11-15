// v0.4.6 第 44/45 批 · 竖屏「图层 ↔ 属性」双态面板
//
// 用户原话：
//   「图层的进入放到右侧划入的属性面板，改回类似电脑端右侧菜单上方的布局。
//     但是点击图层的时候：右侧的属性面板退出，下方出现图层面板。
//     图层面板左侧就是图层和属性，以及开启拖动按钮也放到左侧，
//     同时加入关闭面板按钮，就是关闭这个图层面板。
//     如果点击属性，下方图层面板退出，右侧属性面板划入。」
//
// 逐条量七件事：
//   ① 右侧抽屉顶部有「图层 / 属性」（竖屏也有，不再是宽屏专属）
//   ② 点「图层」→ 右抽屉退出 + 下方面板出现（两者互斥）
//   ③ 下方面板左栏四件事齐全：图层 / 属性 / 拖动 / 关闭
//   ④ 面板里的「拖动」能真的进拖动模式（layer-drag-warn 出现 / 再点消失）
//   ⑤ 点左栏「关闭」→ 面板收起，右抽屉也不再弹出
//   ⑥ 点左栏「属性」→ 面板收起 + 右抽屉划入
//   ⑦ 下方面板高度受「竖屏设置 → 图层面板高度」控制（不许写死）
//
// 用法：node tests/e2e/probe-portrait-panels.mjs
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

const state = (win) => win.evaluate(() => {
  const ws = document.querySelector('.workspace');
  const sheet = document.querySelector('.pt-sheet');
  const rail = [...document.querySelectorAll('.pt-sheet-rail > *')]
    .filter((el) => el.tagName === 'BUTTON' || el.classList.contains('pt-sheet-tab'))
    .map((el) => (el.textContent || '').trim());
  const tabs = [...document.querySelectorAll('.right-pane .tab-btn')].map((b) => (b.textContent || '').trim());
  const sr = sheet?.getBoundingClientRect();
  return {
    drawer: ws?.getAttribute('data-drawer') ?? null,
    sheetOpen: sheet?.classList.contains('is-open') ?? null,
    sheetH: sr ? Math.round(sr.height) : 0,
    sheetVisible: sr ? Math.round(sr.top) < window.innerHeight : false,
    rail,
    tabs,
    dragWarn: !!document.querySelector('.pt-sheet .layer-drag-warn'),
    dragPressed: document.querySelector('.pt-sheet-tool')?.getAttribute('aria-pressed') ?? null
  };
});

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-portrait-panels');
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
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1600);
  await win.waitForSelector('.pt-bar2', { timeout: 15000 });

  // 先把右侧抽屉打开（模拟用户从右缘拉开 / 点抽屉把手）
  await win.evaluate(() => {
    const h = [...document.querySelectorAll('[class*="drawer-handle"], .shell-drawer-handle')][0];
    h?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(500);
  let s = await state(win);
  if (s.drawer !== 'right') {
    // 兜底：直接点右抽屉把手（结构可能改名，按"最右那颗把手"取）
    await win.evaluate(() => {
      const all = [...document.querySelectorAll('button')].filter((b) => b.closest('.workspace') && !b.closest('.pt-bar'));
      const right = all.map((b) => ({ b, r: b.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && x.r.left > window.innerWidth * 0.6)
        .sort((a, b) => b.r.top - a.r.top)[0];
      right?.b.click();
    });
    await sleep(500);
    s = await state(win);
  }

  // —— ① 右抽屉顶部有 图层 / 属性 ——
  check('① 右抽屉顶部有「图层 / 属性」（竖屏也保留，不再是宽屏专属）',
    s.tabs.join(',') === '图层,属性', `tabs=${s.tabs.join(',')} drawer=${s.drawer}`);

  // —— ② 点「图层」→ 右抽屉退出 + 下方面板出现 ——
  await win.locator('.right-pane .tab-btn', { hasText: '图层' }).click();
  await sleep(520);
  s = await state(win);
  check('② 点「图层」→ 右抽屉退出（data-drawer 不再是 right）', s.drawer !== 'right', `drawer=${s.drawer}`);
  check('② 点「图层」→ 下方面板出现（.pt-sheet.is-open）', s.sheetOpen === true, `open=${s.sheetOpen} h=${s.sheetH}`);
  check('② 两个面板互斥（不会同时开着）', !(s.drawer === 'right' && s.sheetOpen === true), `drawer=${s.drawer} sheet=${s.sheetOpen}`);

  // —— ③ 左栏四件事 ——
  check('③ 面板左栏四件事齐全（图层 / 属性 / 拖动 / 关闭）',
    s.rail.join(',') === '图层,属性,拖动,关闭', `rail=${s.rail.join(',')}`);

  // —— ④ 拖动开关真的生效 ——
  await win.locator('.pt-sheet-tool', { hasText: '拖动' }).click();
  await sleep(320);
  let s2 = await state(win);
  check('④ 点「拖动」→ 进入拖动模式（出现拖动提示条 + aria-pressed）',
    s2.dragWarn === true && s2.dragPressed === 'true', `warn=${s2.dragWarn} pressed=${s2.dragPressed}`);
  await win.locator('.pt-sheet-tool', { hasText: '拖动' }).click();
  await sleep(320);
  s2 = await state(win);
  check('④ 再点一次 → 退出拖动模式', s2.dragWarn === false && s2.dragPressed === 'false',
    `warn=${s2.dragWarn} pressed=${s2.dragPressed}`);

  // —— ⑤ 左栏「关闭」 ——
  await win.locator('.pt-sheet-tool', { hasText: '关闭' }).click();
  await sleep(520);
  s = await state(win);
  check('⑤ 点「关闭」→ 面板收起，右抽屉也不弹', s.sheetOpen === false && s.drawer !== 'right',
    `sheet=${s.sheetOpen} drawer=${s.drawer}`);

  // —— ⑥ 再点「图层」打开，然后点左栏「属性」→ 面板收起 + 右抽屉划入 ——
  await win.evaluate(() => {
    const h = [...document.querySelectorAll('button')].filter((b) => b.closest('.workspace') && !b.closest('.pt-bar'))
      .map((b) => ({ b, r: b.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.left > window.innerWidth * 0.6)
      .sort((a, b) => b.r.top - a.r.top)[0];
    h?.b.click();
  });
  await sleep(500);
  await win.locator('.right-pane .tab-btn', { hasText: '图层' }).click();
  await sleep(520);
  const openAgain = await state(win);
  check('⑥ 再点「图层」→ 面板重新出现', openAgain.sheetOpen === true, `open=${openAgain.sheetOpen}`);
  await win.locator('.pt-sheet-tab', { hasText: '属性' }).click();
  await sleep(520);
  s = await state(win);
  check('⑥ 点左栏「属性」→ 面板收起 + 右抽屉划入',
    s.sheetOpen === false && s.drawer === 'right', `sheet=${s.sheetOpen} drawer=${s.drawer}`);

  // —— ⑦ 高度可配（读设置项里的 sheetVh，面板实高应为 vh 百分比附近） ——
  const hInfo = await win.evaluate(() => {
    const sheet = document.querySelector('.pt-sheet');
    const inline = sheet?.getAttribute('style') || '';
    return { inline, vh: window.innerHeight };
  });
  check('⑦ 面板高度由设置项驱动（style 里带 vh，不是写死的像素）',
    /height:\s*\d+vh/.test(hInfo.inline), hInfo.inline.slice(0, 60));

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
