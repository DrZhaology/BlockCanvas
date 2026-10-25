// v0.4.5 大图降采样 + 布局修复验收
// 用法：node tests/e2e/probe-v045-downscale.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

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

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-downscale');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);

  // ---------- 图片1：媒体卡开关不再把文字挤成竖排 ----------
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });
  await win.evaluate(() => window.__sceneStore.getState().addElement('video'));
  await sleep(700);
  await win.locator('.tab-btn', { hasText: '属性' }).click();
  await sleep(700);
  const toggles = await win.evaluate(() => {
    const els = [...document.querySelectorAll('.media-props-toggle')];
    return els.map((e) => {
      const r = e.getBoundingClientRect();
      return { text: (e.textContent || '').trim(), h: Math.round(r.height), ws: getComputedStyle(e).whiteSpace };
    });
  });
  check('图片1 媒体卡 4 个开关不再被挤成竖排文字',
    toggles.length === 4 && toggles.every((t) => t.ws === 'nowrap' && t.h <= 24),
    toggles.map((t) => `${t.text}:${t.h}px`).join(' / '));

  // ---------- 大图降采样（性能核心）----------
  // 造一张 2000×1500 的真图（data URL），显示尺寸只有 200×150 → 应该被换成 blob 小副本
  const before = await win.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 2000; cv.height = 1500;
    const ctx = cv.getContext('2d');
    // 画点东西，避免全透明被压得极小
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `hsl(${i * 7 % 360}, 70%, 55%)`;
      ctx.fillRect((i * 97) % 2000, (i * 61) % 1500, 60, 60);
    }
    const dataUrl = cv.toDataURL('image/png');
    const st = window.__sceneStore.getState();
    const b = new Set((st.scene.root.children || []).map((c) => c.id));
    st.addElement('img');
    const s2 = window.__sceneStore.getState();
    const fresh = (s2.scene.root.children || []).find((c) => !b.has(c.id));
    if (!fresh) return null;
    s2.updateAttr(fresh.id, 'src', dataUrl);
    s2.updateStyle(fresh.id, { width: '200px', height: '150px' });
    return { id: fresh.id, dataLen: dataUrl.length };
  });
  console.log('准备大图:', JSON.stringify(before && { idLen: before.id.length, dataLen: before.dataLen }));
  await sleep(3000);   // 等降采样队列跑完（顺序执行，一张很快）

  const down = await win.evaluate(() => {
    const el = document.querySelector('.canvas img[data-bc-id]');
    if (!el) return null;
    const st = window.__sceneStore.getState();
    const node = (st.scene.root.children || []).find((c) => c.type === 'img');
    return {
      domSrc: (el.getAttribute('src') || '').slice(0, 24),
      isBlob: (el.getAttribute('src') || '').startsWith('blob:'),
      natural: `${el.naturalWidth}x${el.naturalHeight}`,
      shown: `${el.clientWidth}x${el.clientHeight}`,
      modelSrc: (node?.attrs?.src || '').slice(0, 24),
      modelIsOriginal: (node?.attrs?.src || '').startsWith('data:image/png')
    };
  });
  console.log('降采样结果:', JSON.stringify(down));
  check('画布大图被换成降采样副本（不再按 2000×1500 原始分辨率解码）',
    !!down && down.isBlob === true && down.natural !== '2000x1500',
    down ? `DOM src=${down.domSrc}… 解码后=${down.natural} 显示=${down.shown}` : '找不到图');
  check('数据层仍是原始地址（导出/换机器不受影响）',
    !!down && down.modelIsOriginal === true,
    down ? `模型 src=${down.modelSrc}…` : '');

  // ---------- 图片2：素材页在底部布局下要铺满，不再缩成一列 ----------
  await win.evaluate(() => {
    const btn = [...document.querySelectorAll('.inspector-tab')].find((b) => (b.textContent || '').trim() === '素材');
    if (btn) btn.click();
  });
  await sleep(900);
  const gallery = await win.evaluate(() => {
    const g = document.querySelector('.asset-gallery');
    const grid = document.querySelector('.asset-gallery-grid');
    const panel = document.querySelector('.element-panel');
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
    return {
      galleryW: g ? Math.round(g.getBoundingClientRect().width) : 0,
      panelW: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
      cols,
      layout: document.querySelector('.workspace')?.getAttribute('data-layout')
    };
  });
  check('图片2 素材页铺满面板宽度（不再缩成一条窄列）',
    gallery.galleryW > gallery.panelW * 0.6 && gallery.galleryW > 200,
    `素材区 ${gallery.galleryW}px / 面板 ${gallery.panelW}px · ${gallery.cols} 列 · 布局=${gallery.layout}`);

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