// 临时诊断：从"素材库插入图片"到"画布上真的显示出来"全链路
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
  const DATA_DIR = resolve(tmpdir(), 'bc-diag-img2');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const assetsDir = join(DATA_DIR, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  // 一张 40x20 的纯色 PNG（宽高比 2:1，方便看有没有变形）
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAYAAAD/Rn+7AAAAJUlEQVR42u3OMQEAAAgDoC251a3gLwSgOXLVkiRJkiRJkiRJ0iN7AZ0BAQGvBhkKAAAAAElFTkSuQmCC',
    'base64'
  );
  writeFileSync(join(assetsDir, 'pic.png'), png);

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  win.setDefaultTimeout(14000);
  await sleep(1500);
  await win.evaluate(() => { const st = window.__tabStore.getState(); if (!st.tabs.length) st.newTab(); });
  await sleep(600);

  // 素材库能看到这张图吗
  const list = await win.evaluate(() => window.bc.listAssets());
  console.log('A 素材列表：', JSON.stringify(Array.isArray(list) ? list.map((x) => ({ name: x.name, url: x.url, kind: x.kind })) : list));

  // 直接按素材库的写法插入：addElement('img') + updateAttr('src', url)
  const inserted = await win.evaluate((url) => {
    const st = window.__sceneStore.getState();
    st.addElement('img');
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    const fresh = kids[kids.length - 1];
    s2.updateAttr(fresh.id, 'src', url);
    s2.selectElement(fresh.id);
    return { id: fresh.id, attrs: window.__sceneStore.getState().scene.root.children.slice(-1)[0].attrs, style: window.__sceneStore.getState().scene.root.children.slice(-1)[0].style };
  }, Array.isArray(list) && list[0] ? list[0].url : 'bc-img://asset/pic.png');
  console.log('B 插入后：', JSON.stringify(inserted, null, 1));

  await sleep(1200);
  const dom = await win.evaluate((id) => {
    const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      found: true,
      tag: el.tagName,
      srcAttr: el.getAttribute('src'),
      currentSrc: el.currentSrc || null,
      complete: el.complete,
      naturalW: el.naturalWidth,
      naturalH: el.naturalHeight,
      rect: { w: Math.round(r.width), h: Math.round(r.height) },
      cssWidth: cs.width, cssHeight: cs.height, minHeight: cs.minHeight,
      display: cs.display, objectFit: cs.objectFit
    };
  }, inserted.id);
  console.log('C 画布 DOM：', JSON.stringify(dom, null, 1));

  // 再直接建一个 img 加载同一个 url，看协议到底通不通
  const probe = await win.evaluate((url) => new Promise((res) => {
    const img = new Image();
    const t = setTimeout(() => res({ ok: false, why: 'timeout', url }), 4000);
    img.onload = () => { clearTimeout(t); res({ ok: true, url, w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = (e) => { clearTimeout(t); res({ ok: false, why: 'error', url, msg: String(e) }); };
    img.src = url;
  }), Array.isArray(list) && list[0] ? list[0].url : 'bc-img://asset/pic.png');
  console.log('D 裸 img 加载：', JSON.stringify(probe));

  await win.screenshot({ path: 'tests/e2e/shots-diag/img-insert.png' }).catch(() => {});
  await app.close();
};
main().catch((e) => { console.error(e); process.exit(1); });
