// v0.4.6 · 设置页「逐个设置项」全量截图
//
// 用户原话：「整个设置需要你写全量截图的脚本，然后慢慢看设置每个设置项的截图，
//   有些文字溢出，UI，盒子溢出，文字一行一个，需要修改。」
//
// 和 `shots-ui-full.mjs` 的区别：那个只拍"设置页"这一屏；这个会把**每一个分类页**
// 都点进去、并且**从头滚到尾**逐段截图，输出到 `tests/e2e/shots-settings/`，
// 文件名带序号，方便一张张看。
//
// 同时做一层机器体检（不靠肉眼也能发现 90% 的问题）：
//   · 横向溢出：页面上任何元素右边缘超出视口（> 1px）
//   · 文字竖排单字：某段文字的 clientWidth 小于 3 个字宽、但高度超过 3 行
//   · 盒子被裁：元素 scrollHeight > clientHeight + 2 但 overflow 是 hidden/clip
//
// 用法：
//   node tests/e2e/shots-settings-all.mjs            # 竖屏 412×860
//   node tests/e2e/shots-settings-all.mjs --wide     # 宽屏 1280×800 也拍一遍
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';
import { ensureEditor } from './ensure-editor.mjs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = resolve(ROOT, 'tests/e2e/shots-settings');
mkdirSync(OUT, { recursive: true });

const WIDE = process.argv.includes('--wide');
const issues = [];

/** 页面体检：横向溢出 / 竖排单字 / 内容被裁 */
const audit = (win) => win.evaluate(() => {
  const vw = window.innerWidth;
  const out = { overflow: [], squeezed: [], clipped: [] };
  const page = document.querySelector('.fluent-settings-page');
  if (!page) return out;
  const all = [...page.querySelectorAll('*')];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    // ① 横向溢出（不算那些自己就负责横滑的容器）
    const scrollableX = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
    if (!scrollableX && r.right > vw + 1) {
      out.overflow.push({
        cls: String(el.className || el.tagName).slice(0, 40),
        right: Math.round(r.right), vw,
        text: (el.textContent || '').trim().slice(0, 24)
      });
    }
    // ② 竖排单字：宽不到 3 个字，却高于 3 行
    const fs = parseFloat(cs.fontSize) || 14;
    const lineH = parseFloat(cs.lineHeight) || fs * 1.4;
    // 递归取文本：被挤成一列单字的往往是「包着一堆子元素的容器」，
    // 只看叶子节点会漏掉（存储总览 / 扩展资源包就是这么漏的）。
    const text = (el.textContent || '').trim();
    if (text.length >= 6 && r.width < fs * 3.2 && r.height > lineH * 3.2) {
      out.squeezed.push({ cls: String(el.className || el.tagName).slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), text: text.slice(0, 24) });
    }
    // ③ 内容被裁（纵向）
    if ((cs.overflowY === 'hidden' || cs.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) {
      out.clipped.push({ cls: String(el.className || el.tagName).slice(0, 40), sh: el.scrollHeight, ch: el.clientHeight, text: (el.textContent || '').trim().slice(0, 20) });
    }
  }
  return out;
});

async function shoot(win, name) {
  await sleep(260);
  await win.screenshot({ path: resolve(OUT, name + '.png') });
  const a = await audit(win);
  const total = a.overflow.length + a.squeezed.length + a.clipped.length;
  if (total) issues.push({ name, ...a });
  console.log(`  · ${name}  溢出=${a.overflow.length} 竖排=${a.squeezed.length} 被裁=${a.clipped.length}`);
}

async function run(win, tag) {
  // 进设置页
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:settings')));
  await win.waitForSelector('.fluent-settings-page', { timeout: 15000 });
  await sleep(600);
  await shoot(win, `${tag}-00-分类列表`);

  // 逐个分类点进去
  const cards = await win.locator('.set-list-card').count();
  for (let i = 0; i < cards; i++) {
    const card = win.locator('.set-list-card').nth(i);
    const label = ((await card.textContent()) || '').trim().replace(/\s+/g, '').slice(0, 12) || String(i);
    await card.click();
    await sleep(520);
    // 一屏一屏往下滚，直到滚不动
    const scroller = await win.evaluate(() => {
      const cands = [...document.querySelectorAll('.fluent-settings-page *')]
        .filter((el) => el.scrollHeight > el.clientHeight + 8);
      const el = cands.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      return el ? { ok: true } : { ok: false };
    });
    let shot = 0;
    for (;;) {
      await shoot(win, `${tag}-${String(i + 1).padStart(2, '0')}-${label}-${String(shot).padStart(2, '0')}`);
      shot++;
      const moved = await win.evaluate(() => {
        const cands = [...document.querySelectorAll('.fluent-settings-page *')]
          .filter((el) => el.scrollHeight > el.clientHeight + 8);
        const el = cands.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        if (!el) return false;
        const before = el.scrollTop;
        el.scrollTop = Math.min(el.scrollTop + Math.round(el.clientHeight * 0.82), el.scrollHeight);
        return el.scrollTop > before + 4;
      });
      if (!moved || shot > 8) break;
    }
    if (scroller.ok) {
      await win.evaluate(() => {
        const cands = [...document.querySelectorAll('.fluent-settings-page *')]
          .filter((el) => el.scrollHeight > el.clientHeight + 8);
        cands.forEach((el) => { el.scrollTop = 0; });
      });
    }
    // 返回分类列表
    await win.evaluate(() => {
      const b = document.querySelector('.set-detail-back') || document.querySelector('.fluent-back-btn');
      b?.click();
    });
    // 竖屏里返回 = 回列表（App 的 onBack 逻辑），这里兜底：还没回列表就点第一条栏的返回
    await sleep(420);
    if (!(await win.locator('.set-list-card').count())) {
      await win.evaluate(() => {
        const btns = [...document.querySelectorAll('.pt-bar1 .pt-btn')];
        btns.find((b) => (b.getAttribute('aria-label') || '').includes('返回'))?.click();
      });
      await sleep(420);
    }
  }
}

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-shots-settings');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  win.setDefaultTimeout(8000);
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(300, 400);
    w.setContentSize(412, 860);
    w.center();
  });
  await ensureEditor(win);
  await sleep(500);
  console.log('=== 竖屏 412×860 ===');
  await run(win, 'pt');

  if (WIDE) {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setContentSize(1280, 800);
      w.center();
    });
    await sleep(700);
    console.log('=== 宽屏 1280×800 ===');
    await run(win, 'pc');
  }

  console.log('\n===== 体检汇总 =====');
  if (issues.length === 0) console.log('  ✓ 没有发现溢出 / 竖排单字 / 裁剪');
  else {
    for (const it of issues) {
      console.log(`  ✗ ${it.name}`);
      for (const k of ['overflow', 'squeezed', 'clipped']) {
        for (const x of it[k].slice(0, 4)) console.log(`      [${k}] ${JSON.stringify(x)}`);
      }
    }
  }
  console.log(`\n截图目录：${OUT}`);
  console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');
  await app.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
