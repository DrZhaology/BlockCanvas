// 首页媒体背景探针（v0.4.4）：视频能播 / 图片视频缩略图 / 文字自动反色
// 视频由 Chromium 的 canvas.captureStream + MediaRecorder 现场录一段 webm，落到临时 data 目录，
// 再当首页背景加载 —— 不依赖仓库里带二进制视频。
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + '  [' + (extra ?? '') + ']'); }
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-home-media');
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  // v0.4.5：加载页（最短 520ms + 淡出 300ms）期间会拦住点击，先等它退场
  await win.waitForSelector('.bc-loading', { state: 'detached', timeout: 15000 }).catch(() => {});
  await sleep(600);

  // 1. 现场录一段 1 秒 webm
  const b64 = await win.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    const ctx = c.getContext('2d');
    const stream = c.captureStream(24);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start();
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = i % 2 ? '#1e3a8a' : '#0f172a';
      ctx.fillRect(0, 0, 160, 90);
      ctx.fillStyle = '#fff';
      ctx.fillText('BlockCanvas', 20, 50);
      await new Promise((r) => setTimeout(r, 40));
    }
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  });
  const videoPath = resolve(DATA_DIR, 'bg.webm');
  writeFileSync(videoPath, Buffer.from(b64, 'base64'));
  ok('现场生成测试视频（webm）', b64.length > 500, 'bytes=' + Buffer.from(b64, 'base64').length);

  // 2. 设成首页视频背景
  await win.locator('.eh-gear').click();
  await sleep(300);
  await win.locator('.eh-tab', { hasText: '视频' }).click();
  await sleep(300);
  await win.locator('.eh-panel .eh-input').first().fill(videoPath);
  await sleep(2200);

  const vstate = await win.evaluate(() => {
    const v = document.querySelector('.empty-home video.eh-video');
    if (!v) return null;
    return {
      readyState: v.readyState,
      paused: v.paused,
      width: v.videoWidth,
      height: v.videoHeight,
      currentTime: v.currentTime,
      src: v.getAttribute('src') || ''
    };
  });
  ok('视频元素被渲染出来', !!vstate, JSON.stringify(vstate));
  ok('视频解码成功（有真实尺寸）', !!vstate && vstate.width > 0 && vstate.height > 0, JSON.stringify(vstate));
  ok('视频在自动播放（未暂停、时间在走）', !!vstate && !vstate.paused && vstate.currentTime > 0, JSON.stringify(vstate));

  // 3. 深色视频 → 文字自动转白
  await sleep(1200);
  ok('深色视频背景 → 首页进入 is-dark-bg（文字转白）',
    (await win.locator('.empty-home.is-dark-bg').count()) === 1);

  // 4. 保存视频背景 → 预设页出现缩略图（带播放角标）
  await win.locator('.eh-save-row .eh-input').fill('视频背景');
  await win.locator('.eh-save-row .eh-mini').click();
  await sleep(300);
  await win.locator('.eh-tab', { hasText: '预设' }).click();
  await sleep(400);
  const thumb = await win.evaluate(() => {
    const el = document.querySelector('.eh-saved');
    return el ? {
      video: el.querySelectorAll('video').length,
      play: el.querySelectorAll('.eh-saved-play').length
    } : null;
  });
  ok('保存的视频背景在「我的背景」里显示缩略图 + 播放角标', !!thumb && thumb.video === 1 && thumb.play === 1, JSON.stringify(thumb));

  // 5. 浅色图片 → 文字自动转黑（is-dark-bg 移除）
  const lightPng = await win.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 32, 32);
    return c.toDataURL('image/png');
  });
  await win.locator('.eh-tab', { hasText: '图片' }).click();
  await sleep(250);
  await win.locator('.eh-panel .eh-input').first().fill(lightPng);
  await sleep(1500);
  ok('浅色图片背景 → 自动回到深色文字（不再 is-dark-bg）',
    (await win.locator('.empty-home.is-dark-bg').count()) === 0);

  // 6. 模糊 / 遮罩滑块实时生效
  // v0.4.5：以前按"第 2 个 .eh-range"取模糊滑块 —— 面板结构一变（多/少一个滑块）就取错，
  // 表现为偶发 `blur(0px)`。现在按**标签文字**找，并重试到值真的生效为止。
  const setBlur = async (value) => {
    return win.evaluate((v) => {
      const rows = [...document.querySelectorAll('.eh-panel .eh-range-row, .eh-panel label, .eh-panel .eh-field')];
      let range = null;
      for (const r of rows) {
        if (!/模糊/.test(r.textContent || '')) continue;
        range = r.querySelector('input[type="range"]');
        if (range) break;
      }
      // 兜底：老结构里没有包行，就退回"第 2 个滑块"
      if (!range) range = document.querySelectorAll('.eh-panel .eh-range')[1];
      if (!range) return { found: false };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(range, String(v));
      range.dispatchEvent(new Event('input', { bubbles: true }));
      range.dispatchEvent(new Event('change', { bubbles: true }));
      return { found: true, now: range.value };
    }, value);
  };
  let blurState = null;
  for (let i = 0; i < 8; i += 1) {
    await setBlur(8);
    await sleep(320);
    blurState = await win.evaluate(() => {
      const m = document.querySelector('.empty-home .eh-media');
      return {
        filter: m ? getComputedStyle(m).filter : '',
        saved: JSON.parse(localStorage.getItem('bc-empty-home-bg') || 'null')
      };
    });
    if (/blur\(8px\)/.test(blurState.filter || '') && blurState.saved?.blur === 8) break;
  }
  ok('模糊滑块实时写进背景样式并保存', /blur\(8px\)/.test(blurState?.filter || '') && blurState?.saved?.blur === 8,
    JSON.stringify(blurState));

  const realErrs = errs.filter((t) => !/Failed to load resource/.test(t));
  ok('无 console / page 错误', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));
  await app.close();
  console.log(`\n===== 首页媒体背景探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
