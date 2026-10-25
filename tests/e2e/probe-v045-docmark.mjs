// v0.4.5 第十批探针：文档搜索落点（黄色荧光笔 + 定位不偏）
// 用法：node tests/e2e/probe-v045-docmark.mjs
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

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-docmark');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await win.waitForSelector('.empty-home, .toolbar', { timeout: 20000 });
  await sleep(800);

  // 首页搜索「外边距」→ 点第一条文档结果
  const q = '外边距';
  await win.locator('.eh-search input').click();
  await sleep(300);
  await win.locator('.eh-search input').fill(q);
  await sleep(700);
  const docHitCount = await win.locator('.eh-hit-doc, .eh-doc-hit, .eh-result-doc').count().catch(() => 0);
  const anyHit = await win.evaluate((kw) => {
    const items = [...document.querySelectorAll('.eh-hit, .eh-result, .eh-panel button')];
    const t = items.find((x) => (x.textContent || '').includes(kw));
    if (!t) return null;
    t.click();
    return (t.textContent || '').slice(0, 40);
  }, q);
  check('首页搜索能点开一条文档结果', !!anyHit, anyHit || `docHits=${docHitCount}`);
  await sleep(1600);

  const landed = await win.evaluate(() => {
    const page = document.querySelector('.help-page, .help-center');
    const scroller = document.querySelector('.help-doc-scroll, .help-content, .help-scroll');
    const flash = document.querySelector('.help-doc .bc-doc-hit');
    const marks = [...document.querySelectorAll('.help-doc mark.hc-hit')];
    const docRoot = document.querySelector('.help-doc');
    let pos = null;
    if (flash && scroller) {
      const fr = flash.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      pos = {
        flashTop: Math.round(fr.top - sr.top),
        scrollerH: Math.round(sr.height),
        // "居中" = 落点在容器上半部且不贴边（旧实现会贴到最上/最下）
        inView: fr.top >= sr.top - 2 && fr.bottom <= sr.bottom + 2
      };
    }
    const style = flash ? getComputedStyle(flash) : null;
    const markStyle = marks[0] ? getComputedStyle(marks[0]) : null;
    return {
      onHelpPage: !!page,
      hasFlash: !!flash,
      flashBg: style ? style.backgroundImage || style.backgroundColor : '',
      flashLeftBar: style ? style.boxShadow : '',
      markCount: marks.length,
      markBg: markStyle ? markStyle.backgroundColor : '',
      markText: marks[0] ? (marks[0].textContent || '') : '',
      pos,
      docHasRelative: docRoot ? getComputedStyle(docRoot).position : ''
    };
  });

  check('跳转后进入帮助中心并命中目标标题', landed.onHelpPage && landed.hasFlash, JSON.stringify({ page: landed.onHelpPage, flash: landed.hasFlash }));
  check('命中标题有黄色荧光笔底（不再只是淡入）',
    landed.hasFlash && /rgba?\(255,\s*226,\s*128|255,\s*213,\s*79|rgb\(255,\s*2\d\d/.test(landed.flashBg),
    landed.flashBg);
  check('命中标题左侧还有一条荧光色条（一眼看到落点）',
    /rgba?\(255/.test(String(landed.flashLeftBar)), String(landed.flashLeftBar).slice(0, 60));
  check('小节正文里的关键词被逐处标成黄底 <mark>',
    landed.markCount > 0 && /rgb\(255,\s*229,\s*138\)/.test(landed.markBg) && landed.markText.includes(q),
    JSON.stringify({ count: landed.markCount, bg: landed.markBg, text: landed.markText }));
  check('落点滚到可视区内（不再落在屏幕边缘）',
    !!landed.pos && landed.pos.inView,
    JSON.stringify(landed.pos));
  check('落点位置与 offsetParent 无关（用 rect 差值计算，不受文档内定位祖先影响）',
    !!landed.pos && landed.pos.flashTop >= 0 && landed.pos.flashTop < landed.pos.scrollerH * 0.6,
    JSON.stringify({ ...landed.pos, docPosition: landed.docHasRelative }));

  // 重复点同一个结果：不应出现嵌套 mark（幂等）
  await win.evaluate(() => { window.dispatchEvent(new CustomEvent('bc:open-help-doc', { detail: { doc: 'manual', id: '', q: '外边距' } })); });
  await sleep(600);
  const nested = await win.evaluate(() => document.querySelectorAll('.help-doc mark.hc-hit mark').length);
  check('反复跳转不会产生嵌套 mark（幂等）', nested === 0, `嵌套=${nested}`);

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 第十批探针（文档落点标黄）：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });