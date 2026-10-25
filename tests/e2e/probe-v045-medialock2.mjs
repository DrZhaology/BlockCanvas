// v0.4.5 第十三批探针：媒体播放锁（定格帧 / 音频可见）+ 图片比例规则
// 用法：node tests/e2e/probe-v045-medialock2.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from 'fs';
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

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-medialock2');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 15000 });
  await sleep(900);

  // ==========================================================================
  // 准备：现场录一段 3 秒 webm（够长，能定位到第 30 帧）
  // ==========================================================================
  const b64 = await win.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const ctx = c.getContext('2d');
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start();
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = i % 2 ? '#1e3a8a' : '#b91c1c';
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#fff';
      ctx.font = '20px sans-serif';
      ctx.fillText('frame ' + i, 12, 100);
      await new Promise((r) => setTimeout(r, 33));
    }
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  });
  const videoPath = resolve(DATA_DIR, 'clip.webm');
  writeFileSync(videoPath, Buffer.from(b64, 'base64'));
  check('准备：现场生成 3 秒测试视频', b64.length > 1000, `${Buffer.from(b64, 'base64').length}B`);

  // ==========================================================================
  // A. 视频：先播起来 → 点锁死 → 必须停 + 停在某一帧（不是白屏）
  // ==========================================================================
  const vid = await win.evaluate((p) => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'v-lock', type: 'video', style: { width: '320px' }, children: [] }, null);
    const id = window.__sceneStore.getState().scene.selectedId;
    window.__sceneStore.getState().updateAttr(id, 'src', p);
    window.__sceneStore.getState().selectElement(id);
    return id;
  }, videoPath);
  await sleep(1500);

  // 先让它真的播起来（模拟"用户正在预览"）
  const playing = await win.evaluate(async (eid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    if (!el) return { noEl: true };
    el.muted = true;
    await el.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 900));
    return { paused: el.paused, t: el.currentTime, rs: el.readyState };
  }, vid);
  check('准备：视频确实在播放（锁死前的状态）',
    !playing.noEl && playing.paused === false && playing.t > 0, JSON.stringify(playing));

  // 点「锁死播放」
  await win.evaluate(() => document.querySelector('.media-lock-btn')?.click());
  await sleep(1800);

  const locked = await win.evaluate((eid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    if (!el) return { noEl: true };
    return {
      paused: el.paused,
      t: Math.round(el.currentTime * 100) / 100,
      readyState: el.readyState,
      videoWidth: el.videoWidth,
      videoHeight: el.videoHeight,
      controls: el.controls,
      attr: el.getAttribute('data-bc-play-lock')
    };
  }, vid);
  check('点锁死 → 正在播放的视频被立刻停住', locked.paused === true, JSON.stringify({ paused: locked.paused, t: locked.t }));
  check('锁死后画面停在某一帧（有真实尺寸、时间不在 0）',
    locked.readyState >= 2 && locked.videoWidth > 0 && locked.t > 0.3,
    JSON.stringify({ rs: locked.readyState, w: locked.videoWidth, t: locked.t }));

  // 锁死后无论如何都不能播：点播放 / 脚本 play() 都要被按回去
  const stillLocked = await win.evaluate(async (eid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    const tBefore = el.currentTime;
    await el.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    return { paused: el.paused, tBefore, tAfter: el.currentTime };
  }, vid);
  check('锁死后即使强行 play() 也立刻回到暂停（永远不播）',
    stillLocked.paused === true && Math.abs(stillLocked.tAfter - stillLocked.tBefore) < 0.3,
    JSON.stringify(stillLocked));

  // 锁死时视频不显示控制条（避免误点）
  check('锁死的视频不显示控制条', locked.controls === false, String(locked.controls));

  // 解锁 → 恢复可播
  await win.evaluate(() => document.querySelector('.media-lock-btn')?.click());
  await sleep(900);
  const unlocked = await win.evaluate(async (eid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    el.muted = true;
    await el.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    return { paused: el.paused, t: el.currentTime, controls: el.controls };
  }, vid);
  check('解锁后视频能重新播放（锁是可逆的）',
    unlocked.paused === false && unlocked.t > 0, JSON.stringify(unlocked));

  // ==========================================================================
  // B. 音频：锁死后仍然"看得见"（不能变成一条空白）
  // ==========================================================================
  const aud = await win.evaluate((p) => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'a-lock', type: 'audio', style: { width: '320px' }, children: [] }, null);
    const id = window.__sceneStore.getState().scene.selectedId;
    window.__sceneStore.getState().updateAttr(id, 'src', p);
    window.__sceneStore.getState().selectElement(id);
    return id;
  }, videoPath);
  await sleep(1200);
  // v0.4.5 第 15 批：音频在编辑器里由 `.bc-audio-slot` 外壳承载，
  // 真正的 <audio> 在外壳内部（未选中时外壳只显示"♪ 音频"占位条）。
  const audBefore = await win.evaluate((eid) => {
    const host = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    if (!host) return null;
    const inner = host.querySelector('audio');
    return {
      h: Math.round(host.getBoundingClientRect().height),
      hasSlot: host.classList.contains('bc-audio-slot'),
      controls: inner ? inner.controls : null
    };
  }, aud);
  await win.evaluate(() => document.querySelector('.media-lock-btn')?.click());
  await sleep(900);
  const audAfter = await win.evaluate((eid) => {
    const host = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    if (!host) return null;
    const inner = host.querySelector('audio');
    return {
      h: Math.round(host.getBoundingClientRect().height),
      hasSlot: host.classList.contains('bc-audio-slot'),
      controls: inner ? inner.controls : null,
      paused: inner ? inner.paused : null,
      attr: host.getAttribute('data-bc-play-lock')
    };
  }, aud);
  check('音频锁死后仍然占位可见（不是零高度空白）',
    !!audAfter && audAfter.h > 10 && audAfter.attr === '1' && audAfter.hasSlot === true,
    JSON.stringify({ before: audBefore, after: audAfter }));
  check('音频锁死后保留控制条（否则整块什么都看不到）且处于暂停',
    !!audAfter && audAfter.controls === true && audAfter.paused === true,
    JSON.stringify(audAfter));

  // ==========================================================================
  // C. 图片比例规则
  // ==========================================================================
  // C1. 从元素面板插入的空 img（无 src）→ 可以自由缩放（不锁比例）
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'img-ph', type: 'img', style: { width: '200px', height: '120px', backgroundColor: '#e2e8f0' }, children: [] }, null);
    window.__sceneStore.getState().selectElement(window.__sceneStore.getState().scene.selectedId);
  });
  await sleep(900);
  const placeholder = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const id = st.scene.selectedId;
    const n = st.scene.root.children.find((c) => c.id === id);
    const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
    if (!el) return { missing: true, id };
    const r = el.getBoundingClientRect();
    return { id, src: n?.attrs?.src ?? '', w: r.width, h: r.height, x: r.x, y: r.y };
  });
  check('准备：插入了一个没有 src 的 img 占位元素',
    !placeholder.missing && placeholder.src === '', JSON.stringify(placeholder));

  // 拖右下角改尺寸 → 宽高都应变化（不锁比例）
  await sleep(400);
  await win.keyboard.down('Alt');
  await win.mouse.move(placeholder.x + placeholder.w - 2, placeholder.y + placeholder.h - 2);
  await sleep(250);
  await win.mouse.down();
  await win.mouse.move(placeholder.x + placeholder.w + 60, placeholder.y + placeholder.h + 10, { steps: 8 });
  await win.mouse.up();
  await win.keyboard.up('Alt');
  await sleep(500);
  const placeholderAfter = await win.evaluate((eid) => {
    const st = window.__sceneStore.getState();
    const bp = st.activeBreakpoint;
    const n = st.scene.root.children.find((c) => c.id === eid);
    const m = { ...(n.style || {}), ...((bp !== 'desktop' && n.responsive && n.responsive[bp]) || {}) };
    return { w: parseFloat(m.width || '0'), h: parseFloat(m.height || '0') };
  }, placeholder.id);
  check('无 src 的 img 占位元素可以自由改宽高（比例不被锁）',
    placeholderAfter.w > 240 && placeholderAfter.h > 110,
    `改后 ${placeholderAfter.w}×${placeholderAfter.h}（原 ${Math.round(placeholder.w)}×${Math.round(placeholder.h)}）`);

  // C2. 有 src 的图片 → 外框自动校成真实比例，且缩放锁比例
  const imgEl = await win.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 100;   // 4:1 的宽图，明显不同于默认 200×120
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2f855a'; ctx.fillRect(0, 0, 400, 100);
    return c.toDataURL('image/png');
  });
  const withSrc = await win.evaluate((src) => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'img-src', type: 'img', style: { width: '200px', height: '120px' }, children: [] }, null);
    const id = window.__sceneStore.getState().scene.selectedId;
    window.__sceneStore.getState().updateAttr(id, 'src', src);
    window.__sceneStore.getState().selectElement(id);
    return id;
  }, imgEl);
  await sleep(1800);
  const autoRatio = await win.evaluate((eid) => {
    const st = window.__sceneStore.getState();
    const bp = st.activeBreakpoint;
    const n = st.scene.root.children.find((c) => c.id === eid);
    const m = { ...(n.style || {}), ...((bp !== 'desktop' && n.responsive && n.responsive[bp]) || {}) };
    const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    return {
      w: parseFloat(m.width || '0'), h: parseFloat(m.height || '0'),
      domW: Math.round(el?.getBoundingClientRect().width || 0),
      domH: Math.round(el?.getBoundingClientRect().height || 0)
    };
  }, withSrc);
  const ratio = autoRatio.h > 0 ? autoRatio.w / autoRatio.h : 0;
  check('有 src 的图片：外框自动校成真实比例（4:1，不再是默认 200×120）',
    Math.abs(ratio - 4) < 0.25, JSON.stringify({ ...autoRatio, ratio: Number(ratio.toFixed(2)) }));

  // 缩放它 → 比例必须保持（不允许拉变形）
  const r2 = await win.evaluate((eid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, withSrc);
  await sleep(400);
  await win.keyboard.down('Alt');
  await win.mouse.move(r2.x + r2.w - 2, r2.y + r2.h / 2);
  await sleep(250);
  await win.mouse.down();
  await win.mouse.move(r2.x + r2.w + 80, r2.y + r2.h / 2, { steps: 8 });
  await win.mouse.up();
  await win.keyboard.up('Alt');
  await sleep(500);
  const scaled = await win.evaluate((eid) => {
    const st = window.__sceneStore.getState();
    const bp = st.activeBreakpoint;
    const n = st.scene.root.children.find((c) => c.id === eid);
    const m = { ...(n.style || {}), ...((bp !== 'desktop' && n.responsive && n.responsive[bp]) || {}) };
    return { w: parseFloat(m.width || '0'), h: parseFloat(m.height || '0') };
  }, withSrc);
  const scaledRatio = scaled.h > 0 ? scaled.w / scaled.h : 0;
  check('有 src 的图片：拖拽缩放时比例被锁住（不会拉变形）',
    Math.abs(scaledRatio - ratio) < 0.2 && scaled.w > autoRatio.w,
    `原 ${Number(ratio.toFixed(2))} → 缩放后 ${Number(scaledRatio.toFixed(2))}（${scaled.w}×${scaled.h}）`);

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 第十三批探针（播放锁 + 图片比例）：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });