// 窄窗口下的页面设置面板：复现"色标卡片前面一大片空白"。
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-layout-narrow');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox', '--force-device-scale-factor=2'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(960, 700); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);

  await win.locator('.eh-gear').click();
  await sleep(300);
  await win.locator('.eh-tab', { hasText: '渐变' }).click();
  await sleep(400);

  const dump = await win.evaluate(() => {
    const sels = ['.eh-panel', '.grad-editor', '.grad-stops', '.grad-stop', '.grad-stop-top', '.grad-stop-grip', '.grad-stop .color-text-input'];
    const out = {};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) { out[s] = 'NOT FOUND'; continue; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[s] = {
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        display: cs.display, flexDirection: cs.flexDirection, flex: cs.flex, padding: cs.padding, gap: cs.gap,
        justify: cs.justifyContent, align: cs.alignItems, width: cs.width, minWidth: cs.minWidth
      };
    }
    return out;
  });
  console.log(JSON.stringify(dump, null, 2));

  await win.locator('.eh-panel').screenshot({ path: resolve(OUT, 'gradient-narrow.png') });
  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
