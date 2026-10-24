// v0.4.5 媒体属性卡验收
// 用法：node tests/e2e/probe-v045-mediacard.mjs
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-mediacard');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
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

  // 插一个 video 并选中
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const before = new Set((st.scene.root.children || []).map((c) => c.id));
    st.addElement('video');
    const s2 = window.__sceneStore.getState();
    const fresh = (s2.scene.root.children || []).find((c) => !before.has(c.id));
    if (fresh) s2.selectElement(fresh.id);
  });
  await sleep(800);
  await win.locator('.tab-btn', { hasText: '属性' }).click();
  await sleep(700);

  const card = await win.evaluate(() => {
    const el = document.querySelector('.media-props');
    return {
      exists: !!el,
      title: (el?.querySelector('.media-props-title')?.textContent || '').trim(),
      hasSrcInput: !!el?.querySelector('.media-props-src'),
      toggles: [...(el?.querySelectorAll('.media-props-toggle') || [])].map((t) => (t.textContent || '').trim()),
      pickBtn: !!el?.querySelector('.media-props-pick')
    };
  });
  console.log('卡片:', JSON.stringify(card));

  check('选中 video 时出现媒体属性卡', card.exists, card.title);
  check('卡片里有媒体地址输入框与「本地文件…」按钮', card.hasSrcInput && card.pickBtn, '');
  check('卡片里有「循环播放」「默认静音」「自动播放」「背景模式」四个开关 + 播放锁',
    card.toggles.length >= 4 && card.toggles.some((t) => t.includes('循环')) && card.toggles.some((t) => t.includes('静音')),
    card.toggles.join(' / '));

  // 在输入框里写地址 → 元素 attrs.src 应该跟着变
  await win.evaluate(() => {
    const input = document.querySelector('.media-props-src');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'https://cdn.example.com/demo.mp4');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(600);
  const afterSrc = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const n = (st.scene.root.children || [])[0];
    const v = document.querySelector('.canvas video');
    return { attr: n?.attrs?.src || '', domSrc: v ? v.getAttribute('src') : '' };
  });
  check('输入地址会写进元素 src 并立刻反映到画布',
    afterSrc.attr.includes('demo.mp4') && afterSrc.domSrc.includes('demo.mp4'),
    `attrs=${afterSrc.attr} dom=${afterSrc.domSrc}`);

  // 勾上「循环播放」→ attrs.loop = '1'
  await win.evaluate(() => {
    const boxes = [...document.querySelectorAll('.media-props-toggle input')];
    const loop = boxes[0];
    if (loop) loop.click();
  });
  await sleep(500);
  const afterLoop = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const n = (st.scene.root.children || [])[0];
    const v = document.querySelector('.canvas video');
    return { attr: n?.attrs?.loop ?? '', domLoop: v ? v.hasAttribute('loop') : false };
  });
  check('勾选「循环播放」会写进属性并让画布上的 video 真的 loop',
    afterLoop.attr === '1' && afterLoop.domLoop === true,
    `attrs.loop=${afterLoop.attr} dom.loop=${afterLoop.domLoop}`);

  // audio 元素应显示「音频播放」标题
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const before = new Set((st.scene.root.children || []).map((c) => c.id));
    st.addElement('audio');
    const s2 = window.__sceneStore.getState();
    const fresh = (s2.scene.root.children || []).find((c) => !before.has(c.id));
    if (fresh) s2.selectElement(fresh.id);
  });
  await sleep(800);
  const audioCard = await win.evaluate(() => ({
    title: (document.querySelector('.media-props-title')?.textContent || '').trim(),
    hint: (document.querySelector('.media-props-hint')?.textContent || '').trim()
  }));
  check('选中 audio 时标题与标签切换为音频',
    audioCard.title.includes('音频') && audioCard.hint.includes('audio'),
    `${audioCard.title} ${audioCard.hint}`);

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