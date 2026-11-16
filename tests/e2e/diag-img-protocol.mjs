// 临时诊断：bc-img 协议在 Windows 绝对路径下还能不能加载
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const DATA_DIR = resolve(tmpdir(), 'bc-diag-img');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  // 造一张 4x4 PNG 放在带中文/空格的路径里（真实场景更像）
  const imgDir = join(DATA_DIR, '我的 图片');
  mkdirSync(imgDir, { recursive: true });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC',
    'base64'
  );
  const imgPath = join(imgDir, '测试 图.png');
  writeFileSync(imgPath, png);

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  win.setDefaultTimeout(14000);
  await sleep(1400);

  const probes = await win.evaluate(async (abs) => {
    const norm = abs.replace(/\\/g, '/');
    const cases = {
      encodedFull: 'bc-img://file/' + encodeURIComponent(norm),
      rawFull: 'bc-img://file/' + norm,
      lowerDrive: 'bc-img://file/' + encodeURIComponent(norm.charAt(0).toLowerCase() + norm.slice(1))
    };
    const out = {};
    for (const [k, src] of Object.entries(cases)) {
      out[k] = await new Promise((res) => {
        const img = new Image();
        const t = setTimeout(() => res({ src, ok: false, why: 'timeout' }), 4000);
        img.onload = () => { clearTimeout(t); res({ src, ok: true, w: img.naturalWidth, h: img.naturalHeight }); };
        img.onerror = () => { clearTimeout(t); res({ src, ok: false, why: 'error' }); };
        img.src = src;
      });
    }
    // 再试直接 fetch，看状态码
    out.fetch = await (async () => {
      try {
        const r = await fetch('bc-img://file/' + encodeURIComponent(norm));
        return { status: r.status, type: r.headers.get('content-type') };
      } catch (e) {
        return { error: String(e) };
      }
    })();
    return out;
  }, imgPath);

  console.log(JSON.stringify(probes, null, 1));
  await app.close();
};
main().catch((e) => { console.error(e); process.exit(1); });
