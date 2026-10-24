// v0.4.5 首页专项验收（C1 视频解码失败回退 / C2 入场动画 / 滚动条抖动）
// 用法：node tests/e2e/probe-v045-home.mjs
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-home-v045');
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
  await sleep(900);

  // ---------- C2：入场动画是逐项错峰，不是整块跳一下 ----------
  const anim = await win.evaluate(() => {
    const kids = [...document.querySelectorAll('.empty-home .eh-center > *')];
    return {
      count: kids.length,
      names: [...new Set(kids.map((k) => getComputedStyle(k).animationName))],
      delays: kids.map((k) => parseFloat(getComputedStyle(k).animationDelay) || 0),
      durations: [...new Set(kids.map((k) => getComputedStyle(k).animationDuration))]
    };
  });
  check('首页内容是逐项入场动画（ehRiseIn）',
    anim.names.length === 1 && anim.names[0] === 'ehRiseIn',
    `项数=${anim.count} 动画=${anim.names.join(',')} 时长=${anim.durations.join(',')}`);
  const ascending = anim.delays.every((d, i) => i === 0 || d >= anim.delays[i - 1]);
  check('入场延迟逐项递增（有层次感）', ascending && anim.delays.some((d) => d > 0),
    anim.delays.map((d) => d + 's').join(' → '));

  // ---------- 滚动条抖动：首页整体裁切，不产生滚动 ----------
  const scroll = await win.evaluate(() => {
    const el = document.querySelector('.empty-home');
    return {
      overflow: getComputedStyle(el).overflowY,
      scrollable: el.scrollHeight > el.clientHeight + 1
    };
  });
  check('首页不产生纵向滚动（调模糊度不会抖）',
    scroll.overflow === 'hidden' && !scroll.scrollable,
    `overflow-y=${scroll.overflow} 可滚动=${scroll.scrollable}`);

  // ---------- C1：坏视频配置 → 自动回退，不再反复报错 ----------
  await win.evaluate(() => {
    localStorage.setItem('bc-empty-home-bg', JSON.stringify({
      kind: 'video',
      src: 'C:/__blockcanvas_not_exist__/nope.mp4',
      dim: 30,
      blur: 0
    }));
  });
  await win.reload();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(2500);
  const fallback = await win.evaluate(() => {
    let bg = null;
    try { bg = JSON.parse(localStorage.getItem('bc-empty-home-bg') || 'null'); } catch { bg = null; }
    return {
      kind: bg?.kind ?? null,
      videoEl: !!document.querySelector('.eh-video'),
      className: document.querySelector('.empty-home')?.className || ''
    };
  });
  check('解码失败的视频壁纸自动回退到预设背景',
    fallback.kind === 'preset' && !fallback.videoEl,
    `存储里 kind=${fallback.kind} 页面上还有 video=${fallback.videoEl}`);

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