// 局部高清截图：只拍某个选择器，deviceScaleFactor=2，便于逐像素挑毛病。
// 用法：node tests/e2e/shots-zoom.mjs <css-selector> <out-name> [额外步骤脚本]
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const OUT = resolve(ROOT, 'tests/e2e/shots-zoom');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = process.argv[2] || '.eh-panel';
const name = process.argv[3] || 'zoom';
const mode = process.argv[4] || 'gradient';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const DATA_DIR = resolve(tmpdir(), 'bc-shots-zoom');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', '--disable-gpu', '--no-sandbox', '--force-device-scale-factor=2'],
    cwd: ROOT, executablePath: electronPath, env
  });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(800);

  if (mode === 'gradient') {
    await win.locator('.eh-gear').click();
    await sleep(350);
    await win.locator('.eh-tab', { hasText: '渐变' }).click();
    await sleep(400);
  } else if (mode === 'editor') {
    await win.locator('.empty-home .eh-btn').nth(1).click();
    await win.waitForSelector('.toolbar', { timeout: 15000 });
    await sleep(800);
    await win.evaluate(() => {
      const st = window.__sceneStore.getState();
      st.addElement('div', null);
      const root = window.__sceneStore.getState().scene.root;
      const id = root.children[root.children.length - 1].id;
      st.updateStyle(id, { padding: '20px', border: '2px solid #1e88e5', outline: '3px dashed #4575de', width: '420px' });
      st.selectElement(id);
    });
    await sleep(600);
    const head = win.locator('.inspector-sec-head', { hasText: 'CSS 样式属性' }).first();
    if (await head.count()) { await head.click(); await sleep(400); }
  }

  const loc = win.locator(target).first();
  if (!(await loc.count())) { console.log('找不到', target); await app.close(); return; }
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(250);
  await loc.screenshot({ path: resolve(OUT, name + '.png') });
  console.log('✓', resolve(OUT, name + '.png'));
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
