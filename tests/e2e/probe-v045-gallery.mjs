// v0.4.5 素材库（图库面板）验收
// 用法：node tests/e2e/probe-v045-gallery.mjs
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from 'fs';

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

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-gallery');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  // 预先放一个素材进缓存目录（模拟"这个工程用过这张图"）
  const cacheDir = join(DATA_DIR, 'cache', 'assets');
  mkdirSync(cacheDir, { recursive: true });
  const assetName = 'deadbeefdeadbeef.png';
  writeFileSync(join(cacheDir, assetName), PNG_1X1);

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // IPC：列表能拿到这条素材
  const listed = await win.evaluate(() => window.bc.listAssets());
  const hit = (listed || []).find((a) => a.name === 'deadbeefdeadbeef.png');
  check('listAssets 能列出缓存里的素材', !!hit,
    hit ? `${hit.name} ${hit.kind} ${hit.bytes}B` : `共 ${(listed || []).length} 条`);
  check('素材条目带可直接用的 bc-img://asset 地址',
    !!hit && hit.url === 'bc-img://asset/deadbeefdeadbeef.png', hit ? hit.url : '');
  check('素材条目识别出图片类型', !!hit && hit.kind === 'image', hit ? hit.kind : '');

  // UI：左侧面板有「素材」页签，点开能看到缩略图
  const tabs = await win.evaluate(() =>
    [...document.querySelectorAll('.inspector-tab')].map((e) => (e.textContent || '').trim())
  );
  check('左侧面板有「素材」页签', tabs.includes('素材'), tabs.join('/'));

  await win.evaluate(() => {
    const btn = [...document.querySelectorAll('.inspector-tab')].find((b) => (b.textContent || '').trim() === '素材');
    if (btn) btn.click();
  });
  await sleep(900);

  const ui = await win.evaluate(() => ({
    gallery: !!document.querySelector('.asset-gallery'),
    items: document.querySelectorAll('.asset-item').length,
    imgOk: (() => {
      const img = document.querySelector('.asset-thumb img');
      return img ? { src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 } : null;
    })()
  }));
  check('素材面板能渲染出缩略图卡片', ui.gallery && ui.items >= 1, `卡片 ${ui.items} 个`);
  check('缩略图真的加载出来了（走 bc-img://asset 协议）',
    !!ui.imgOk && ui.imgOk.loaded && (ui.imgOk.src || '').includes('bc-img://asset/'),
    ui.imgOk ? `${ui.imgOk.src} loaded=${ui.imgOk.loaded}` : '没找到 img');

  // 点一下缩略图 → 应该插入一个 img 元素，src 指向该素材
  await win.evaluate(() => {
    const it = document.querySelector('.asset-item');
    if (it) it.click();
  });
  await sleep(800);
  const inserted = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const kids = st.scene.root.children || [];
    const img = kids.find((c) => c.type === 'img');
    const dom = document.querySelector('.canvas img');
    return {
      count: kids.length,
      attrSrc: img?.attrs?.src || '',
      domSrc: dom ? dom.getAttribute('src') : ''
    };
  });
  check('点缩略图会插入一个 img 元素', inserted.count >= 1 && !!inserted.attrSrc,
    `元素数=${inserted.count} src=${inserted.attrSrc}`);
  check('插入的 img 画布上能显示（src 一致）',
    inserted.domSrc.includes('bc-img://asset/') || inserted.domSrc.includes('/file/'),
    inserted.domSrc);

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });