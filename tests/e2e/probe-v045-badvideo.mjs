// v0.4.5 A9 验收：解不了的视频壁纸不再反复触发原生解码错误
// 用法：node tests/e2e/probe-v045-badvideo.mjs
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-badvideo');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);

  // 预置：一个不存在的视频文件当壁纸 + 已经它在黑名单里
  await win.evaluate(() => {
    localStorage.setItem('bc-empty-home-bg', JSON.stringify({
      kind: 'video', src: 'C:/__not_exist__/broken.mp4', dim: 30, blur: 0
    }));
    localStorage.setItem('bc-empty-home-bad-videos', JSON.stringify(['C:/__not_exist__/broken.mp4']));
  });
  await win.reload();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(2000);

  const after = await win.evaluate(() => ({
    videoEl: !!document.querySelector('.eh-video'),
    badList: JSON.parse(localStorage.getItem('bc-empty-home-bad-videos') || '[]')
  }));
  check('A9 黑名单里的视频壁纸**不再挂载** <video>（从根上不触发解码）',
    after.videoEl === false, `页面上有 video=${after.videoEl}`);

  // 第一次遇到坏视频 → 应该自动记进黑名单
  await win.evaluate(() => {
    localStorage.removeItem('bc-empty-home-bad-videos');
    localStorage.setItem('bc-empty-home-bg', JSON.stringify({
      kind: 'video', src: 'C:/__not_exist__/broken2.mp4', dim: 30, blur: 0
    }));
  });
  await win.reload();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(2500);
  const marked = await win.evaluate(() => ({
    badList: JSON.parse(localStorage.getItem('bc-empty-home-bad-videos') || '[]'),
    bg: JSON.parse(localStorage.getItem('bc-empty-home-bg') || 'null')
  }));
  check('A9 首次遇到解不了的视频会记进黑名单',
    marked.badList.includes('C:/__not_exist__/broken2.mp4'),
    `黑名单=${JSON.stringify(marked.badList)}`);
  check('A9 并自动回退到预设背景', marked.bg?.kind === 'preset', `当前背景 kind=${marked.bg?.kind}`);

  // 再次进入：黑名单生效，不应再挂 video
  await win.reload();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(1500);
  const second = await win.evaluate(() => ({
    videoEl: !!document.querySelector('.eh-video'),
    badList: JSON.parse(localStorage.getItem('bc-empty-home-bad-videos') || '[]')
  }));
  check('A9 之后每次进首页都不再尝试这个视频（错误不会再刷）',
    second.videoEl === false && second.badList.length >= 1,
    `video=${second.videoEl} 黑名单 ${second.badList.length} 条`);

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