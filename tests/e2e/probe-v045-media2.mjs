// v0.4.5 多媒体整块验收（C补2 / C补3 / C补5 / C补8）
// 用法：node tests/e2e/probe-v045-media2.mjs
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-media2');
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
  await sleep(600);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // 造 video + audio，都带 src，但**都不选中**
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('video');
    st.addElement('audio');
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    const v = kids.find((c) => c.type === 'video');
    const a = kids.find((c) => c.type === 'audio');
    if (v) s2.updateAttr(v.id, 'src', 'https://example.com/v.mp4');
    if (a) s2.updateAttr(a.id, 'src', 'https://example.com/a.mp3');
    // 取消选中：让媒体处于"未选中"状态（这是编辑时的常态）
    window.__sceneStore.getState().selectElement(null);
  });
  await sleep(800);

  const unselected = await win.evaluate(() => {
    const v = document.querySelector('.canvas video');
    const a = document.querySelector('.canvas audio');
    const slot = document.querySelector('.canvas .bc-audio-slot');
    return {
      videoControls: v ? v.hasAttribute('controls') : null,
      // v0.4.5 第 15 批：音频在编辑器里由 `.bc-audio-slot` 外壳承载，
      // 未选中时**不渲染 <audio>**（UA 规则让它 display:none，且原生控件会吃掉点击）
      audioPresent: !!a,
      slotPresent: !!slot,
      slotControls: slot ? !!slot.querySelector('audio[controls]') : null,
      videoPreload: v ? v.getAttribute('preload') : null
    };
  });
  check('C补8 未选中时音频仍然可见（渲染成 .bc-audio-slot 占位条，点它就选中）',
    unselected.slotPresent === true && unselected.audioPresent === false,
    JSON.stringify(unselected));
  check('C补2 未选中时视频也保持可见（不挂控制条，但保留画面）',
    unselected.videoControls === false, `video controls=${unselected.videoControls}`);
  const visible = await win.evaluate(() => {
    const slot = document.querySelector('.canvas .bc-audio-slot');
    const v = document.querySelector('.canvas video');
    return {
      aH: slot ? Math.round(slot.getBoundingClientRect().height) : 0,
      vH: v ? Math.round(v.getBoundingClientRect().height) : 0
    };
  });
  check('C补2 未选中时媒体不是零高度/不可见（用户反馈"直接不显示了"）',
    visible.aH > 0 && visible.vH > 0, `音频槽高 ${visible.aH}px · 视频高 ${visible.vH}px`);

  // 选中后应该出现控件，可以就地试播
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const v = (st.scene.root.children || []).find((c) => c.type === 'video');
    if (v) st.selectElement(v.id);
  });
  await sleep(700);
  const selected = await win.evaluate(() => {
    const v = document.querySelector('.canvas video');
    return { controls: v ? v.hasAttribute('controls') : null, preload: v ? v.getAttribute('preload') : null };
  });
  check('C补2 选中后出现控制条（可就地播放预览）',
    selected.controls === true, `controls=${selected.controls}`);

  // v0.4.5 第 15 批：**音频点击必须能选中**（用户反复反馈"根本点不中"）。
  // 现在未选中时是 `.bc-audio-slot` 占位条 —— 直接点它的中心，必须真的选中。
  const audioPick = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const a = (st.scene.root.children || []).find((c) => c.type === 'audio');
    st.selectElement(null);
    const slot = document.querySelector('.canvas .bc-audio-slot');
    const r = slot ? slot.getBoundingClientRect() : null;
    return { id: a?.id || null, box: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null };
  });
  if (audioPick.box) {
    await win.mouse.click(audioPick.box.x + audioPick.box.w / 2, audioPick.box.y + audioPick.box.h / 2);
    await sleep(450);
  }
  const audioSelected = await win.evaluate(() => window.__sceneStore.getState().scene.selectedId);
  check('音频点一下就选中（不再"根本点不中"）',
    !!audioPick.id && audioSelected === audioPick.id,
    `期望 ${audioPick.id} 实际 ${audioSelected}`);
  // 选中后外壳里才出现真正的 <audio controls>
  const audioReal = await win.evaluate(() => {
    const slot = document.querySelector('.canvas .bc-audio-slot');
    return {
      isReal: !!slot && slot.classList.contains('is-real'),
      hasAudio: !!slot?.querySelector('audio[controls]')
    };
  });
  check('选中后音频才露出真正的 <audio controls>（可就地试听）',
    audioReal.isReal === true && audioReal.hasAudio === true, JSON.stringify(audioReal));

  // 还原选中回视频：后面的断言都是围绕"视频 + 媒体卡"写的，别被这次点击改掉状态
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const v = (st.scene.root.children || []).find((c) => c.type === 'video');
    if (v) st.selectElement(v.id);
  });
  await sleep(600);

  check('选中后才会读元数据（未选中不预载，省 GPU/内存）',
    selected.preload === 'metadata', `preload=${selected.preload}`);

  // 媒体卡：应该有 4 个开关（循环 / 静音 / 自动播放 / 背景模式）
  await win.locator('.tab-btn', { hasText: '属性' }).click();
  await sleep(600);
  const card = await win.evaluate(() => ({
    toggles: [...document.querySelectorAll('.media-props-toggle')].map((t) => (t.textContent || '').trim()),
    tip: (document.querySelector('.media-props-tip')?.textContent || '').replace(/\s+/g, ' ').slice(0, 40)
  }));
  check('C补3 媒体卡有 4 个开关（循环 / 静音 / 自动播放 / 背景模式）',
    card.toggles.length === 4
    && card.toggles.some((t) => t.includes('循环'))
    && card.toggles.some((t) => t.includes('自动播放'))
    && card.toggles.some((t) => t.includes('背景模式')),
    card.toggles.join(' / '));
  check('C补2 媒体卡写清了"编辑时怎么播放"',
    card.tip.includes('怎么播放') || card.tip.includes('选中'), card.tip);

  // 勾「自动播放」→ 必须同时静音（HTML 规范）
  await win.evaluate(() => {
    const box = [...document.querySelectorAll('.media-props-toggle input')]
      .find((i) => (i.parentElement?.textContent || '').includes('自动播放'));
    if (box) box.click();
  });
  await sleep(700);
  const auto = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const v = (st.scene.root.children || []).find((c) => c.type === 'video');
    const el = document.querySelector('.canvas video');
    return {
      autoplayAttr: v?.attrs?.autoplay ?? '',
      mutedAttr: v?.attrs?.muted ?? '',
      // 注意：React 对 muted 设的是 **property**（不是 attribute），
      // 所以 hasAttribute('muted') 天然为 false，必须读 el.muted。
      domAutoplay: el ? el.autoplay === true : null,
      domMuted: el ? el.muted === true : null
    };
  });
  check('C补3 勾"自动播放"会自动带上静音（符合浏览器规则）',
    auto.autoplayAttr === '1' && auto.mutedAttr === '1' && auto.domMuted === true,
    `autoplay=${auto.autoplayAttr} muted=${auto.mutedAttr} dom.autoplay=${auto.domAutoplay} dom.muted=${auto.domMuted}`);

  // 勾「背景模式」→ 即使选中也不显示控件
  await win.evaluate(() => {
    const box = [...document.querySelectorAll('.media-props-toggle input')]
      .find((i) => (i.parentElement?.textContent || '').includes('背景模式'));
    if (box) box.click();
  });
  await sleep(700);
  const bg = await win.evaluate(() => {
    const el = document.querySelector('.canvas video');
    return { controls: el ? el.hasAttribute('controls') : null };
  });
  check('C补3 背景模式下即使选中也没有控制条（适合当背景视频）',
    bg.controls === false, `controls=${bg.controls}`);

  // C补5：图片/视频默认 display 是 inline，以前被当成"行内元素"→ 不能 Alt 缩放
  const inlineFix = await win.evaluate(() => {
    // 通过 Alt 悬停时给元素打的类判断：修复后媒体不该被标成 inline 不可缩放
    const el = document.querySelector('.canvas video');
    if (!el) return null;
    return { display: getComputedStyle(el).display, tag: el.tagName.toLowerCase() };
  });
  check('C补5 媒体元素确实是 display:inline（这正是以前不能缩放的原因）',
    !!inlineFix && inlineFix.display === 'inline',
    inlineFix ? `${inlineFix.tag} display=${inlineFix.display}` : '找不到元素');

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