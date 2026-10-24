// v0.4.5 媒体元素验收：video / audio 能插入、能在画布渲染、带 src 与控件
// 用法：node tests/e2e/probe-v045-media.mjs
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-media');
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
  await sleep(600);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // 元素面板里应该能看到「视频」「音频」两个入口
  const panelLabels = await win.evaluate(() =>
    [...document.querySelectorAll('.elem-btn-name')].map((e) => (e.textContent || '').trim())
  );
  check('元素面板有「视频」入口', panelLabels.includes('视频'), panelLabels.join('/'));
  check('元素面板有「音频」入口', panelLabels.includes('音频'), '');

  // 插入 video + audio，并给它们 src
  const made = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const before = new Set((st.scene.root.children || []).map((c) => c.id));
    st.addElement('video');
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    const v = kids.find((c) => !before.has(c.id));
    if (!v) return { ok: false };
    s2.updateAttr(v.id, 'src', 'https://example.com/clip.mp4');
    s2.updateAttr(v.id, 'loop', '1');
    const st2 = window.__sceneStore.getState();
    const before2 = new Set((st2.scene.root.children || []).map((c) => c.id));
    st2.addElement('audio');
    const s3 = window.__sceneStore.getState();
    const kids3 = s3.scene.root.children || [];
    const a = kids3.find((c) => !before2.has(c.id));
    if (a) s3.updateAttr(a.id, 'src', 'https://example.com/tone.mp3');
    return { ok: true, videoId: v.id, audioId: a ? a.id : null };
  });
  console.log('插入:', JSON.stringify(made));
  await sleep(900);

  const dom = await win.evaluate(() => {
    const v = document.querySelector('.canvas video');
    const a = document.querySelector('.canvas audio');
    const pick = (el) => (el ? {
      src: el.getAttribute('src') || '',
      controls: el.hasAttribute('controls'),
      loop: el.hasAttribute('loop')
    } : null);
    return { video: pick(v), audio: pick(a) };
  });
  console.log('DOM:', JSON.stringify(dom));

  check('canvas 里真的渲染出了 <video> 且带 src', !!dom.video && dom.video.src.includes('clip.mp4'),
    dom.video ? dom.video.src : '没找到 video');
  check('video 带播放控件与 loop 属性', !!dom.video && dom.video.controls && dom.video.loop,
    dom.video ? `controls=${dom.video.controls} loop=${dom.video.loop}` : '');
  check('canvas 里真的渲染出了 <audio> 且带 src', !!dom.audio && dom.audio.src.includes('tone.mp3'),
    dom.audio ? dom.audio.src : '没找到 audio');
  check('audio 带播放控件', !!dom.audio && dom.audio.controls, dom.audio ? `controls=${dom.audio.controls}` : '');

  // 图层树能标出这两个元素（说明类型系统认得它们）
  await win.locator('.tab-btn', { hasText: '图层' }).click();
  await sleep(500);
  const layerNames = await win.evaluate(() =>
    [...document.querySelectorAll('.layer-name')].map((e) => (e.textContent || '').trim())
  );
  check('图层树能显示视频/音频节点', layerNames.some((n) => /video|audio|视频|音频/i.test(n)),
    layerNames.join('/'));

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