// 找出导出页在 390px 宽下到底是谁撑出了横向滚动
import { createRequire } from 'module';
import { resolve } from 'path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 390, height: 844 });
  const file = resolve(ROOT, 'tests/e2e/shots-diag/promo-site/index.html');
  await page.goto('file:///' + file.replace(/\\/g, '/'));
  await sleep(1200);
  const bad = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.right > vw + 1 || r.left < -1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 40),
          left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
          over: Math.round(r.right - vw),
          text: (el.textContent || '').trim().slice(0, 18)
        });
      }
    });
    return { vw, count: out.length, list: out.slice(0, 14) };
  });
  console.log(JSON.stringify(bad, null, 1));
  await app.close();
};
main().catch((e) => { console.error(e); process.exit(1); });
