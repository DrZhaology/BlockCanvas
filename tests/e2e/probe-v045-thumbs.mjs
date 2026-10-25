// v0.4.5 第十批探针：素材缩略图磁盘缓存（性能）
// 用法：node tests/e2e/probe-v045-thumbs.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync, writeFileSync } from 'fs';
import { ensureEditor } from './ensure-editor.mjs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

/** 造一张确定性的 PNG（纯色，避免依赖外部素材） */
function makePng(w, h, rgb) {
  // 最小 PNG 编码：用 zlib 手写太啰嗦，这里用 Electron 里生成再写盘
  return { w, h, rgb };
}

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-thumbs');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'cache', 'assets'), { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 15000 });
  await sleep(800);

  // 用渲染进程的 canvas 造两张"大图"，再由探针进程写进素材缓存（模拟 4K 素材）。
  // ⚠ 主进程 evaluate 里没有 require，写文件一律在探针进程里做。
  const pngs = await win.evaluate(async () => {
    const out = [];
    for (const [w, h, color] of [[2400, 1600, '#2b6cb0'], [1800, 1200, '#c05621']]) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      // 加点纹理，避免纯色图被压得过小导致"缩略图不比原图小"的误判
      for (let i = 0; i < 400; i += 1) {
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)';
        ctx.fillRect((i * 37) % w, (i * 61) % h, 60, 60);
      }
      out.push(c.toDataURL('image/png').split(',')[1]);
    }
    return out;
  });
  const assetDir = resolve(DATA_DIR, 'cache', 'assets');
  const names = ['aaaa1111.png', 'bbbb2222.png'];
  pngs.forEach((b64, i) => writeFileSync(resolve(assetDir, names[i]), Buffer.from(b64, 'base64')));
  const made = names.map((n) => ({ name: n, bytes: statSync(resolve(assetDir, n)).size }));
  check('准备：往素材缓存里放了两张大图（2400×1600 / 1800×1200）',
    made.length === 2 && made.every((m) => m.bytes > 2000), JSON.stringify(made));

  // 打开素材库（左侧「素材」页签，class 是 .inspector-tab）
  await win.evaluate(() => {
    const tab = [...document.querySelectorAll('.inspector-tab')].find((b) => /素材/.test(b.textContent || ''));
    if (tab) tab.click();
  });
  await sleep(1800);

  const list = await win.evaluate(() => window.bc.listAssets());
  const withThumb = (list || []).filter((a) => !!a.thumbUrl);
  check('listAssets 给图片返回了缩略图地址',
    withThumb.length >= 2 && withThumb.every((a) => /\?thumb=/.test(a.thumbUrl)),
    JSON.stringify(withThumb.map((a) => a.thumbUrl)));

  // 磁盘上真的生成了缩略图文件
  const thumbDir = resolve(DATA_DIR, 'cache', 'thumbs');
  const thumbFiles = existsSync(thumbDir) ? readdirSync(thumbDir) : [];
  check('缩略图落到了磁盘缓存 data/cache/thumbs/（只生成一次，之后复用）',
    thumbFiles.length >= 2 && thumbFiles.every((f) => /\.256\.jpg$/.test(f)),
    JSON.stringify(thumbFiles));

  // 缩略图文件必须比原图小得多（这才是"优化"的意义）
  const assetTotal = readdirSync(assetDir).reduce((a, f) => a + statSync(resolve(assetDir, f)).size, 0);
  const thumbTotal = readdirSync(thumbDir).reduce((a, f) => a + statSync(resolve(thumbDir, f)).size, 0);
  check('缩略图总字节数远小于原图（素材页不再解码全尺寸原图）',
    thumbTotal > 0 && thumbTotal * 4 < assetTotal,
    `原图 ${assetTotal}B → 缩略图 ${thumbTotal}B（${(thumbTotal / assetTotal * 100).toFixed(1)}%）`);

  // 网格里的 img 用的是缩略图地址
  const grid = await win.evaluate(() => {
    const imgs = [...document.querySelectorAll('.asset-thumb img')];
    return {
      count: imgs.length,
      srcs: imgs.map((i) => i.getAttribute('src') || ''),
      allThumb: imgs.length > 0 && imgs.every((i) => /\?thumb=/.test(i.getAttribute('src') || ''))
    };
  });
  check('素材库网格用的是缩略图地址（不是原图）', grid.allThumb, JSON.stringify({ n: grid.count, srcs: grid.specs || grid.srcs }));

  // 缩略图真的能显示出来（不是坏图）
  const painted = await win.evaluate(() => {
    const imgs = [...document.querySelectorAll('.asset-thumb img')];
    return imgs.map((i) => ({ complete: i.complete, w: i.naturalWidth, h: i.naturalHeight }));
  });
  check('缩略图真的解码出来了（有真实尺寸，不是坏图）',
    painted.length > 0 && painted.every((p) => p.complete && p.w > 0 && p.h > 0), JSON.stringify(painted));

  // 存储面板里能看到这一类
  const breakdown = await win.evaluate(() => window.bc.getStorageBreakdown());
  const thumbCat = (breakdown?.categories || []).find((c) => c.id === 'thumbs');
  check('存储面板把「素材缩略图缓存」单独列为一类（可清理）',
    !!thumbCat && thumbCat.cleanable === true && thumbCat.bytes > 0,
    JSON.stringify(thumbCat));

  // 清理后能真的删掉，并且素材本身不受影响
  const cleared = await win.evaluate(() => window.bc.clearStorageCategory('thumbs'));
  await sleep(400);
  const afterClear = existsSync(thumbDir) ? readdirSync(thumbDir).length : 0;
  const assetsStillThere = await win.evaluate(() => window.bc.listAssets());
  check('清理缩略图缓存：缓存文件被删、但素材本身一个不少',
    cleared?.ok === true && afterClear === 0 && (assetsStillThere || []).length >= 2,
    JSON.stringify({ freed: cleared?.freedBytes, files: afterClear, assets: (assetsStillThere || []).length }));

  // 清理后再次列素材 → 自动重建缩略图
  const rebuilt = await win.evaluate(() => window.bc.listAssets());
  const rebuiltThumbs = existsSync(thumbDir) ? readdirSync(thumbDir) : [];
  check('清掉后再打开素材库会自动重建缩略图（不会一直空着）',
    (rebuilt || []).filter((a) => !!a.thumbUrl).length >= 2 && rebuiltThumbs.length >= 2,
    JSON.stringify({ withThumb: (rebuilt || []).filter((a) => !!a.thumbUrl).length, files: rebuiltThumbs.length }));

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 第十批探针（素材缩略图缓存）：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });