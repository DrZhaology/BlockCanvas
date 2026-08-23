import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');

const app = await electron.launch({ args: ['.'], cwd: process.cwd(), executablePath: electronPath });
const win = await app.firstWindow();
await win.locator('.app').waitFor({ state: 'visible', timeout: 15000 });
const dump = () => win.evaluate(() => ({
  tabs: [...document.querySelectorAll('.tab-btn')].map((b) => ({ t: b.textContent, cls: b.className })),
  active: document.querySelector('.tab-btn.active')?.textContent ?? 'NONE',
  insp: !!document.querySelector('.inspector')
}));
console.log('initial:', JSON.stringify(await dump()));
await win.locator('.tab-btn:has-text("图层")').click();
await new Promise((r) => setTimeout(r, 300));
console.log('after 图层 click:', JSON.stringify(await dump()));
await win.locator('.tab-btn:has-text("属性")').click();
await new Promise((r) => setTimeout(r, 300));
console.log('after 属性 click:', JSON.stringify(await dump()));
await app.close();