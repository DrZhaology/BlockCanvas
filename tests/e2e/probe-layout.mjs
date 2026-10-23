// 布局体检：把指定选择器的盒子与关键 computed style 打出来，用于定位"莫名其妙的大空白"。
// 用法：node tests/e2e/probe-layout.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-layout');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);

  // 打开页面设置的渐变页
  await win.locator('.eh-gear').click();
  await sleep(300);
  await win.locator('.eh-tab', { hasText: '渐变' }).click();
  await sleep(400);

  const dump = await win.evaluate(() => {
    const sels = ['.eh-panel', '.grad-editor', '.grad-stops', '.grad-stop', '.grad-stop-top', '.grad-stop-grip', '.grad-stop .color-text-input', '.grad-stop .color-swatch-btn', '.grad-stop-del', '.grad-stop-bottom'];
    const out = {};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) { out[s] = 'NOT FOUND'; continue; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[s] = {
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        display: cs.display, flex: cs.flex, padding: cs.padding, margin: cs.margin, gap: cs.gap,
        justify: cs.justifyContent, align: cs.alignItems, width: cs.width, minWidth: cs.minWidth,
        border: cs.borderWidth, background: cs.backgroundColor
      };
    }
    return out;
  });
  console.log(JSON.stringify(dump, null, 2));

  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
