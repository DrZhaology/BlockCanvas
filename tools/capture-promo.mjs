import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');

const ROOT = resolve('E:/Develop/BlockCanvas');
const OUT_DIR = resolve('E:/Develop/promo-assets');
mkdirSync(OUT_DIR, { recursive: true });

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log('Launching BlockCanvas Electron for promo screenshots...');
  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    executablePath: electronPath,
    env: { ...process.env }
  });

  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 });

  // Wait for app load
  await win.waitForSelector('.app', { timeout: 10000 });
  await sleep(1000);

  // Enable Dark Mode via plugin toggle or evaluate
  await win.evaluate(() => {
    localStorage.setItem('bc-dm:mode', 'dark');
    document.documentElement.setAttribute('data-bc-dark', 'on');
    // If dark mode plugin object exists or trigger command
    const toggleBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('🌙') || b.title?.includes('深色'));
    if (toggleBtn) toggleBtn.click();
  });
  await sleep(500);

  // Take Shot 1: Initial Clean Dark Mode Workspace
  await win.screenshot({ path: resolve(OUT_DIR, '01-workspace-dark-empty.png') });
  console.log('Captured: 01-workspace-dark-empty.png');

  // Insert Templates: Go to Templates tab
  const tplTab = await win.$('.element-panel .inspector-tab:has-text("模板")');
  if (tplTab) {
    await tplTab.click();
    await sleep(800);
    // Take Shot 2: Template Library in Dark Mode
    await win.screenshot({ path: resolve(OUT_DIR, '02-template-library-dark.png') });
    console.log('Captured: 02-template-library-dark.png');

    // Click on a template, e.g. "左右分屏 Hero" or "深色大标题 Hero" or "首页大标题区"
    const heroCard = await win.$('.tpl-card:has-text("左右分屏 Hero")') || await win.$('.tpl-card:has-text("深色大标题 Hero")') || await win.$('.tpl-card');
    if (heroCard) {
      await heroCard.click();
      await sleep(600);
    }
  }

  // Switch back to "元素" tab to show main workspace with elements
  const elTab = await win.$('.element-panel .inspector-tab:has-text("元素")');
  if (elTab) await elTab.click();
  await sleep(400);

  // Take Shot 3: Workspace with Hero section rendered
  await win.screenshot({ path: resolve(OUT_DIR, '03-workspace-hero-dark.png') });
  console.log('Captured: 03-workspace-hero-dark.png');

  // Select an element in canvas to show inspector with detailed styles
  const btnInCanvas = await win.$('.canvas button') || await win.$('.canvas h1') || await win.$('.canvas > div');
  if (btnInCanvas) {
    await btnInCanvas.click();
    await sleep(400);
  }

  // Switch right inspector to "属性" tab
  const propTab = await win.$('.inspector .tab-btn:has-text("属性")');
  if (propTab) await propTab.click();
  await sleep(400);

  // Take Shot 4: Rich Properties Inspector & Canvas
  await win.screenshot({ path: resolve(OUT_DIR, '04-inspector-properties-dark.png') });
  console.log('Captured: 04-inspector-properties-dark.png');

  // Switch right inspector to "图层" tab
  const layerTab = await win.$('.inspector .tab-btn:has-text("图层")');
  if (layerTab) await layerTab.click();
  await sleep(400);

  // Take Shot 5: DOM Layer Tree
  await win.screenshot({ path: resolve(OUT_DIR, '05-layer-tree-dark.png') });
  console.log('Captured: 05-layer-tree-dark.png');

  // Open Settings Modal
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('menu:settings'));
  });
  await sleep(600);
  await win.screenshot({ path: resolve(OUT_DIR, '06-settings-modal-dark.png') });
  console.log('Captured: 06-settings-modal-dark.png');

  await win.keyboard.press('Escape');
  await sleep(400);

  // Open Extensions Modal
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('menu:ext'));
  });
  await sleep(600);
  await win.screenshot({ path: resolve(OUT_DIR, '07-extensions-modal-dark.png') });
  console.log('Captured: 07-extensions-modal-dark.png');

  await app.close();
  console.log('Finished capturing all promo shots successfully!');
}

run().catch(console.error);
