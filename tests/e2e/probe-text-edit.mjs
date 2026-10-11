// 画布文字编辑 / 样式互通 / 局部富文本 探针（v0.4.4d）
// 覆盖：
//  1. 双击文字 → 就地编辑用的是多行 textarea（长文本不再被压成一条）
//  2. 改完点别处即保存（不必按 Esc）
//  3. 右键文字改字重 → 写进 node.style（与右侧「CSS 样式属性」互通）
//  4. 编辑态里选中一段文字再右键 → 只给这一段套内联样式（导出成 <span style="…">）
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';
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

const LONG = '这是一段很长很长很长很长很长很长很长很长很长的文字，用来验证就地编辑能不能完整显示，而不是被压成一小条只看得到最后几个字。';

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-textedit-probe');
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  mkdirSync(DATA_DIR, { recursive: true });
  for (const rel of [resolve(ROOT, 'extensions'), resolve(ROOT, 'data', 'extensions')]) {
    if (existsSync(rel)) cpSync(rel, resolve(DATA_DIR, 'extensions'), { recursive: true });
  }
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1500);

  // 造一个 p 元素
  const id = await win.evaluate((txt) => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'seed-p', type: 'p', text: txt, style: {}, children: [] }, null);
    return window.__sceneStore.getState().scene.selectedId;
  }, LONG);
  await sleep(400);

  // 1. 双击进入编辑 → textarea（多行、高度能撑开）
  await win.dblclick(`.canvas [data-bc-id="${id}"]`);
  await sleep(300);
  const taInfo = await win.evaluate(() => {
    const ta = document.querySelector('.canvas textarea.canvas-inline-text-input');
    if (!ta) return null;
    return { tag: ta.tagName, h: ta.offsetHeight, w: ta.offsetWidth, val: ta.value.length };
  });
  ok('双击进入就地编辑（textarea，多行）', !!taInfo && taInfo.tag === 'TEXTAREA', JSON.stringify(taInfo));
  ok('编辑框能完整显示长文本（高度 > 单行）', !!taInfo && taInfo.h > 30, taInfo && String(taInfo.h));

  // 2. 改文字 → 点别处即保存（不按 Esc）
  await win.fill('.canvas textarea.canvas-inline-text-input', '点别处就保存的新文字');
  await win.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await sleep(400);
  const saved = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n ? n.text : null;
  }, id);
  ok('点别处即保存（无需 Esc）', saved === '点别处就保存的新文字', String(saved));
  ok('编辑框已退出', (await win.locator('.canvas textarea.canvas-inline-text-input').count()) === 0);

  // 3. 右键文字 → 改字重 → 写进 node.style（与右侧面板互通）
  await win.click(`.canvas [data-bc-id="${id}"]`);
  await win.click(`.canvas [data-bc-id="${id}"]`, { button: 'right' });
  await sleep(300);
  ok('右键文字弹出菜单', (await win.locator('.bc-text-menu').count()) === 1);
  await win.click('.bc-text-menu .bc-weight-btn:has-text("加粗")');
  await sleep(300);
  const fw = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n && n.style ? n.style.fontWeight : null;
  }, id);
  ok('字重写进 node.style（互通，不是另一套数据）', fw === '700', String(fw));
  // 右侧属性面板里应该出现「字重」这一行（先展开「CSS 样式属性」板块）
  await win.locator('[title="点击展开或收起 CSS 样式属性"]').click().catch(() => {});
  await sleep(400);
  const inspHasWeight = await win.evaluate(() => {
    const el = document.querySelector('.right-pane');
    return el ?  /字体粗细/.test(el.innerText || '') : false;
  });
  ok('右侧属性面板显示出「字体粗细」', inspHasWeight === true, String(inspHasWeight));
  await win.keyboard.press('Escape');
  await sleep(200);

  // 4. 编辑态里选中一段文字 → 右键 → 只给这一段套内联样式
  await win.dblclick(`.canvas [data-bc-id="${id}"]`);
  await sleep(300);
  await win.evaluate(() => {
    const ta = document.querySelector('.canvas textarea.canvas-inline-text-input');
    ta.focus();
    ta.setSelectionRange(0, 2);
    const r = ta.getBoundingClientRect();
    ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 }));
  });
  await sleep(300);
  ok('选中一段文字后右键弹出菜单（局部模式）', (await win.locator('.bc-text-menu').count()) === 1);
  await win.click('.bc-text-menu .bc-weight-btn:has-text("加粗")');
  await sleep(300);
  const runInfo = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n ? { runs: n.runs, text: n.text } : null;
  }, id);
  ok('生成了富文本片段（runs）', !!runInfo && Array.isArray(runInfo.runs) && runInfo.runs.length >= 2, JSON.stringify(runInfo && runInfo.runs));
  ok('第一段带内联 font-weight', !!runInfo && runInfo.runs[0].style && runInfo.runs[0].style.fontWeight === '700', JSON.stringify(runInfo && runInfo.runs[0]));

  // 画布上应该渲染出带内联样式的 <span>（画布与导出同源）
  const spanOk = await win.evaluate((eid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    if (!el) return { n: 0 };
    const sp = Array.from(el.querySelectorAll('span'));
    return { n: sp.length, styled: sp.filter((s) => /font-weight/.test(s.getAttribute('style') || '')).length };
  }, id);
  ok('画布上渲染出内联 <span style="font-weight…">', spanOk.styled >= 1, JSON.stringify(spanOk));

  // 导出产物里也要有内联 span（用户要求：内联 HTML，不用选择器）
  const exported = await win.evaluate((eid) => {
    const st = window.__sceneStore.getState();
    const n = st.scene.root.children.find((c) => c.id === eid);
    const graph = { ...st.scene, root: { ...st.scene.root, id: 'root', children: [n] } };
    const fn = window.__bcExportHTML;
    return fn ? fn(graph).html : '';
  }, id);
  ok('导出 HTML 含内联 <span style="…font-weight…">', /<span style="[^"]*font-weight/i.test(exported), exported ? 'len=' + exported.length : 'no-hook');

  // ============ 5. Enter = 换行（自动生成 <br>）、Esc = 保存 ============
  await win.keyboard.press('Escape');
  await sleep(250);
  await win.dblclick(`.canvas [data-bc-id="${id}"]`);
  await sleep(300);
  await win.fill('.canvas textarea.canvas-inline-text-input', '第一行');
  await win.locator('.canvas textarea.canvas-inline-text-input').press('Enter');
  await win.locator('.canvas textarea.canvas-inline-text-input').type('第二行');
  ok('Enter 不退出编辑（用于换行）', (await win.locator('.canvas textarea.canvas-inline-text-input').count()) === 1);
  await win.keyboard.press('Escape');
  await sleep(350);
  const t2 = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n ? n.text : null;
  }, id);
  ok('Esc 也会保存（不再是取消）', t2 === '第一行\n第二行', JSON.stringify(t2));
  ok('编辑框已退出', (await win.locator('.canvas textarea.canvas-inline-text-input').count()) === 0);
  const exported2 = await win.evaluate((eid) => {
    const st = window.__sceneStore.getState();
    const n = st.scene.root.children.find((c) => c.id === eid);
    const fn = window.__bcExportHTML;
    return fn ? fn({ ...st.scene, root: { ...st.scene.root, id: 'root', children: [n] } }).html : '';
  }, id);
  ok('换行导出成 <br>', /第一行<br>第二行/.test(exported2), exported2 ? 'ok' : 'no-hook');

  // ============ 6. 选中"整段"→ 走整段 CSS（不生成 runs） ============
  const id2 = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'seed-p2', type: 'p', text: '整段测试文字', style: {}, children: [] }, null);
    return window.__sceneStore.getState().scene.selectedId;
  });
  await sleep(300);
  await win.dblclick(`.canvas [data-bc-id="${id2}"]`);
  await sleep(300);
  await win.evaluate(() => {
    const ta = document.querySelector('.canvas textarea.canvas-inline-text-input');
    ta.focus();
    ta.setSelectionRange(0, ta.value.length); // 选中全部
    const r = ta.getBoundingClientRect();
    ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 }));
  });
  await sleep(300);
  await win.click('.bc-text-menu .bc-weight-btn:has-text("加粗")');
  await sleep(300);
  const whole = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return { runs: n.runs, fw: n.style.fontWeight };
  }, id2);
  ok('选中整段 → 走整段 CSS（不生成 runs）', (!whole.runs || whole.runs.length === 0) && whole.fw === '700', JSON.stringify(whole));

  // 下划线 / 删除线 / 斜体
  await win.click('.bc-text-menu .bc-style-btn[title="下划线"]');
  await sleep(200);
  const deco = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n.style.textDecoration;
  }, id2);
  ok('下划线写进 textDecoration', /underline/.test(String(deco)), String(deco));

  ok('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  console.log(`\n===== 文字编辑探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
