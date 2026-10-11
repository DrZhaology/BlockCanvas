// BlockCanvas · v0.4.4 UI 打磨轮视觉存证（只拍图，不断言）
// 产出到 tests/e2e/shots-v044/（已 gitignore）。跑法：
//   env -u ELECTRON_RUN_AS_NODE node tests/e2e/shots-v044.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const OUT = resolve(ROOT, 'tests/e2e/shots-v044');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const DATA_DIR = resolve(tmpdir(), 'bc-shots-v044');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1200);

  const shot = async (name, locator) => {
    try {
      if (locator) await win.locator(locator).first().screenshot({ path: resolve(OUT, name + '.png'), timeout: 8000 });
      else await win.screenshot({ path: resolve(OUT, name + '.png'), timeout: 8000 });
      console.log('  ✓', name);
    } catch (e) { console.log('  ✗', name, String(e.message).split('\n')[0]); }
  };

  // 1. 更新中心
  await win.evaluate(() => window.dispatchEvent(new Event('menu:check-update')));
  await win.waitForSelector('.update-page', { timeout: 8000 });
  await sleep(2500);
  await shot('01-更新中心-总览');
  const hist = win.locator('.update-sec', { hasText: '历史版本' }).first();
  if (await hist.count()) {
    await hist.click();
    await sleep(700);
    const noteBtn = win.locator('.update-history-acts .update-notes-toggle').first();
    if (await noteBtn.count()) { await noteBtn.click(); await sleep(700); }
    await shot('02-更新中心-历史版本与发行说明');
  }
  // 打桩：让"下载 zip"停在进行中，拍进度条（不弹全屏遮罩）
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('update:download-asset');
    ipcMain.handle('update:download-asset', async () => new Promise(() => {}));
  });
  const dlBtn = win.locator('.update-history-row').first().locator('button', { hasText: '下载 zip' });
  if (await dlBtn.count()) {
    await dlBtn.click();
    await sleep(350);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.webContents.send('update:progress', { msg: '已下载 1.2 / 4.8 MB', pct: 42 });
    });
    await sleep(500);
    await shot('03-更新中心-下载zip进度贴卡片（无全屏遮罩）');
  }
  await win.locator('.fluent-back-btn').first().click();
  await sleep(800);

  // 2. 「?」帮助气泡（悬停 0.5s）
  const help = win.locator('.element-panel .help-btn').first();
  if (await help.count()) {
    await help.hover();
    await sleep(1000);
    await shot('04-问号气泡悬停0.5s浮出');
  }
  await win.mouse.move(4, 4);
  await sleep(400);

  // 3. 设置 → 工具栏管理（＋ 插入按钮）
  await win.keyboard.press('Control+,');
  await sleep(900);
  await win.locator('.fluent-nav-item', { hasText: '工具栏' }).first().click().catch(() => {});
  await sleep(800);
  await shot('05-工具栏管理-三个区域各带＋插入按钮');
  const insBtn = win.locator('.tbman-insert-btn').first();
  if (await insBtn.count()) {
    await insBtn.click();
    await sleep(500);
    await shot('06-工具栏管理-插入按钮选择器');
    await win.locator('.tbman-picker-x').first().click().catch(() => {});
    await sleep(300);
  }
  await win.locator('.fluent-back-btn').first().click().catch(() => {});
  await sleep(700);

  // 4. 表格编辑器右侧面板
  await win.locator('.element-btn', { hasText: '表格' }).first().click();
  await sleep(700);
  await win.locator('.tab-btn', { hasText: '属性' }).first().click();
  await sleep(400);
  await win.locator('.tbl-entry button').first().click();
  await win.waitForSelector('.table-page', { timeout: 8000 });
  await sleep(700);
  await win.locator('.tbl-empty-state .tbl-btn', { hasText: '加 3 行' }).first().click().catch(() => {});
  await sleep(600);
  const cell = win.locator('.tbl-cell').first();
  if (await cell.count()) await cell.click({ position: { x: 6, y: 8 } });
  await sleep(500);
  await shot('07-表格-单元格设置面板', '.tbl-card:has-text("单元格设置")');
  const side = win.locator('.table-side').first();
  await side.evaluate((el) => { el.scrollTop = 1150; });
  await sleep(450);
  await shot('08-表格设置面板-数值与单位分离', '.tbl-card:has-text("表格设置")');

  await app.close();
  console.log('\n图已存到 tests/e2e/shots-v044/');
}
main().catch((e) => { console.error(e); process.exit(1); });
