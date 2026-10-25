// 元素面板 + 中键搜索 + 快照抽屉的视觉留证（本轮改动人工复核用）
// 用法：node tests/e2e/shots-batch16.mjs
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
const OUT = resolve(ROOT, 'tests/e2e/shots-v045');

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-shots-b16');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'projects'), { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 15000 });
  await sleep(900);

  const shot = async (name, sel, pad = 8) => {
    const clip = await win.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height };
    }, sel);
    if (!clip) { console.log('skip', name, '(no element)'); return; }
    await win.screenshot({
      path: resolve(OUT, `${name}.png`),
      timeout: 20000,
      clip: {
        x: Math.max(0, clip.x - pad), y: Math.max(0, clip.y - pad),
        width: Math.min(clip.width + pad * 2, 1600), height: Math.min(clip.height + pad * 2, 900)
      }
    }).catch(() => {});
    console.log('shot', name);
  };

  // 1. 元素面板（布局回归的重点：不能挤到左边）
  await shot('16-element-panel', '.element-panel');
  // 2. 切到模板板块
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.element-panel .inspector-tab')].find((x) => /模板/.test(x.textContent || ''));
    b?.click();
  });
  await sleep(700);
  await shot('16-element-panel-templates', '.element-panel');
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.element-panel .inspector-tab')].find((x) => /元素/.test(x.textContent || ''));
    b?.click();
  });
  await sleep(600);

  // 3. 中键搜索（3 条结果 + 淡蓝选中）
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
  });
  await sleep(700);
  const opened = await win.evaluate(() => {
    const el = document.querySelector('.canvas [data-bc-id]');
    const r = el.getBoundingClientRect();
    window.dispatchEvent(new CustomEvent('bc:open-prop-search', {
      detail: { x: Math.round(r.left + 30), y: Math.round(r.top + 30) }
    }));
    return true;
  });
  await sleep(500);
  if (opened) {
    await win.evaluate(() => {
      const input = document.querySelector('.bc-prop-search-input');
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'color');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(500);
    await shot('16-prop-search', '.bc-prop-search');
    await win.keyboard.press('Escape');
    await sleep(300);
  }

  // 4. 首页「页面设置」面板（板块切换动画的另一处）
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:home')));
  await sleep(1200);
  const homeShot = await win.evaluate(() => {
    const gear = document.querySelector('.eh-gear');
    gear?.click();
    return !!gear;
  });
  await sleep(600);
  if (homeShot) await shot('16-home-panel', '.eh-panel');

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('\n输出目录：tests/e2e/shots-v045/');
}

main().catch((e) => { console.error(e); process.exit(1); });