// 模板子元素样式可编辑性探针（v0.4.4d）
// 背景：模板插入的元素（如 .cards-row 里的 .card-title）样式来自**父容器的 childStyles**
//      （`.cards-row .card-title { … }`），CSS 特异性高于子元素自己的 `.card-title` →
//      选中子元素改样式"改了没反应"。本探针验证：
//        · 改动确实写进子元素自身样式；
//        · 祖先 childStyles 里的同名声明被剔除；
//        · 画布上真实渲染值（computed style）真的变了。
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

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + '  [' + (extra ?? '') + ']'); }
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-tplstyle-probe');
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  mkdirSync(DATA_DIR, { recursive: true });
  for (const rel of [resolve(ROOT, 'builtin-extensions'), resolve(ROOT, 'data', 'extensions')]) {
    if (existsSync(rel)) cpSync(rel, resolve(DATA_DIR, 'extensions'), { recursive: true });
  }
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1500);

  // 1. 构造"容器带 childStyles + 子元素带类名"的结构（等价于模板插入结果）
  const ids = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({
      id: 'seed-row', type: 'div', attrs: { className: 'cards-row' }, style: {}, children: [
        { id: 'seed-h3', type: 'h3', text: '标题文字', attrs: { className: 'card-title' }, style: {}, children: [] }
      ]
    }, null);
    const s2 = window.__sceneStore.getState();
    const rowId = s2.scene.selectedId;
    const row = s2.scene.root.children.find((c) => c.id === rowId);
    const h3Id = row.children[0].id;
    s2.setChildStyles(rowId, [{ sel: '.card-title', css: 'font-size: 40px; color: rgb(255, 0, 0);' }]);
    return { rowId, h3Id };
  });
  await sleep(500);

  // 2. 基线：子元素应被容器规则染成 40px
  const before = await win.evaluate((id) => {
    const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
    return el ? getComputedStyle(el).fontSize : '';
  }, ids.h3Id);
  ok('基线：容器 childStyles 生效（子元素 40px）', before === '40px', before);

  // 3. 改子元素字号（走真实 updateStyle 路径）
  await win.evaluate((id) => {
    window.__sceneStore.getState().updateStyle(id, { fontSize: '12px' });
  }, ids.h3Id);
  await sleep(400);

  const after = await win.evaluate((id) => {
    const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
    return el ? getComputedStyle(el).fontSize : '';
  }, ids.h3Id);
  ok('改动后画布渲染真的变了（12px，不再被容器规则盖住）', after === '12px', after);

  const check = await win.evaluate((rowId) => {
    const row = window.__sceneStore.getState().scene.root.children.find((c) => c.id === rowId);
    const cs = row?.childStyles?.[0]?.css || '';
    return { css: cs, hasFontSize: /font-size/i.test(cs), hasColor: /color/i.test(cs) };
  }, ids.rowId);
  ok('祖先 childStyles 里 font-size 声明被剔除', check.hasFontSize === false, check.css);
  ok('未改动的 color 声明保留（不误删）', check.hasColor === true, check.css);

  ok('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  console.log(`\n===== 模板样式探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
