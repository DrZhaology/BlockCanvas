// v0.4.6 · sticky 可视化验收（R6-17）
//
// 背景：sticky 的效果只在"页面滚动"时可见，而画布本身不滚（滚的是外层 .canvas-wrap），
// 所以编辑器里 sticky 元素和普通元素长得一模一样 —— 用户没法判断"我设的 top: 20px 生效了吗"。
//
// 本版的做法（把**生效条件**可视化，不做假的滚动预览）：
//   · data-bc-sticky="armed" —— 写了吸附距离，会挂住；角标「粘 距上 20px」+ 一条虚线
//   · data-bc-sticky="idle"  —— 没写 top/bottom → **永远不会吸附**；角标变警示色
//   · 快捷助手里有一条对应的解释（idle 时警告、armed 时说明会在哪一行挂住）
//
// 用法：node tests/e2e/probe-sticky.mjs
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
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-sticky');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1200);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // ── ① 没写吸附距离的 sticky → idle，并显示警示角标 ─────────────────
  const id = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.addElement('div');
    const kids = window.__sceneStore.getState().scene.root.children || [];
    const fresh = kids[kids.length - 1];
    if (!fresh) return null;
    window.__sceneStore.getState().updateStyle(fresh.id, {
      position: 'sticky', top: 'auto', bottom: 'auto',
      width: '100%', height: '80px', backgroundColor: '#ddd6fe'
    });
    window.__sceneStore.getState().endStyleEdit();
    window.__sceneStore.getState().selectElement(fresh.id);
    return fresh.id;
  });
  await sleep(900);

  const idle = await win.evaluate((tid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${tid}"]`);
    if (!el) return null;
    const before = getComputedStyle(el, '::before');
    return {
      state: el.getAttribute('data-bc-sticky'),
      label: el.getAttribute('data-bc-sticky-label'),
      pe: before.pointerEvents,
      pos: getComputedStyle(el).position
    };
  }, id);
  check('sticky 元素被识别（computed position 确实是 sticky）', idle && idle.pos === 'sticky', idle ? idle.pos : '找不到元素');
  check('没写吸附距离 → 标记为 idle（永远不会吸附）', idle && idle.state === 'idle', idle ? String(idle.state) : '');
  check('idle 的角标写明"未设距离"', idle && /未设距离/.test(idle.label ?? ''), idle ? String(idle.label) : '');
  check('角标不吃鼠标事件（不能挡点击/拖动）', idle && idle.pe === 'none', idle ? String(idle.pe) : '');

  // ── ② 装上吸附距离 → armed，角标给出方向与数值 ──────────────────────
  await win.evaluate((tid) => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.updateStyle(tid, { top: '20px' });
    st.endStyleEdit();
  }, id);
  await sleep(800);
  const armed = await win.evaluate((tid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${tid}"]`);
    if (!el) return null;
    const after = getComputedStyle(el, '::after');
    return {
      state: el.getAttribute('data-bc-sticky'),
      label: el.getAttribute('data-bc-sticky-label'),
      afterContent: after.content,
      afterPe: after.pointerEvents
    };
  }, id);
  check('写了 top: 20px → 标记为 armed（会吸附）', armed && armed.state === 'armed', armed ? String(armed.state) : '');
  check('角标写清"距上 20px"', armed && /距上\s*20px/.test(armed.label ?? ''), armed ? String(armed.label) : '');
  check('armed 时画出吸附线（::after 有内容）',
    armed && armed.afterContent && armed.afterContent !== 'none' && armed.afterContent !== 'normal',
    armed ? String(armed.afterContent) : '');
  check('吸附线也不吃鼠标事件', armed && armed.afterPe === 'none', armed ? String(armed.afterPe) : '');

  // ── ③ 快捷助手里的提示（idle 警告 / armed 说明）────────────────────
  await win.locator('.tab-btn', { hasText: '属性' }).click().catch(() => null);
  await sleep(500);
  // 展开「快捷助手」
  await win.evaluate(() => {
    const head = [...document.querySelectorAll('.inspector-sec-head')]
      .find((b) => /快捷助手/.test(b.textContent || ''));
    if (head) head.click();
  });
  await sleep(700);
  // 「定位助手」是快捷助手里再折叠一层（默认收起）—— 必须先展开才看得到 sticky 提示
  await win.evaluate(() => {
    const btn = [...document.querySelectorAll('.qh-block-toggle')]
      .find((b) => /定位助手/.test(b.textContent || ''));
    if (btn && !btn.querySelector('.page-advanced-caret.open')) btn.click();
  });
  await sleep(600);

  const hintArmed = await win.evaluate(() => {
    const ok = document.querySelector('.pos-sticky-ok');
    const heads = [...document.querySelectorAll('.inspector-sec-head')].map((b) => (b.textContent || '').trim());
    const posSel = document.querySelector('.qh-position, .quick-helper');
    return {
      text: ok ? (ok.textContent || '').trim().replace(/\s+/g, ' ') : null,
      heads,
      hasQuickHelper: !!posSel,
      activeTab: document.querySelector('.inspector-tab.active')?.textContent ?? null,
      selected: window.__sceneStore.getState().scene.selectedId
    };
  });
  console.log('  诊断:', JSON.stringify(hintArmed));
  check('快捷助手说明"会在哪一行挂住"（armed 提示）',
    !!hintArmed.text && /会吸附/.test(hintArmed.text), hintArmed.text ?? '没找到 .pos-sticky-ok');

  // 退回 idle 看警告
  await win.evaluate((tid) => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.updateStyle(tid, { top: 'auto' });
    st.endStyleEdit();
  }, id);
  await sleep(800);
  const hintIdle = await win.evaluate(() => {
    const warn = document.querySelector('.pos-sticky-warn');
    return warn ? (warn.textContent || '').trim().replace(/\s+/g, ' ') : null;
  });
  check('没设距离时给出警告（"永远不会吸附"）',
    !!hintIdle && /永远不会吸附/.test(hintIdle), hintIdle ?? '没找到 .pos-sticky-warn');

  // ── ④ 非 sticky 元素不被加标记（不能污染普通元素）──────────────────
  const plain = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.addElement('p');
    const kids = window.__sceneStore.getState().scene.root.children || [];
    const fresh = kids[kids.length - 1];
    window.__sceneStore.getState().endStyleEdit();
    return fresh ? fresh.id : null;
  });
  await sleep(800);
  const plainMark = await win.evaluate((tid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${tid}"]`);
    return el ? { state: el.getAttribute('data-bc-sticky'), label: el.getAttribute('data-bc-sticky-label') } : null;
  }, plain);
  check('普通元素不会被挂 sticky 标记（不污染）',
    plainMark && plainMark.state === null && plainMark.label === null,
    JSON.stringify(plainMark));

  // ── ⑤ 切回 static（用类名之外的写法）→ 标记消失 ─────────────────
  await win.evaluate((tid) => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.updateStyle(tid, { position: 'sticky', top: '12px' });
    st.endStyleEdit();
  }, id);
  await sleep(700);
  const back1 = await win.evaluate((tid) => document.querySelector(`.canvas [data-bc-id="${tid}"]`)?.getAttribute('data-bc-sticky') ?? null, id);
  await win.evaluate((tid) => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.updateStyle(tid, { position: 'static', top: undefined });
    st.endStyleEdit();
  }, id);
  await sleep(700);
  const back2 = await win.evaluate((tid) => document.querySelector(`.canvas [data-bc-id="${tid}"]`)?.getAttribute('data-bc-sticky') ?? null, id);
  check('设为 sticky 时出现标记，改回 static 后标记消失',
    back1 === 'armed' && back2 === null, `sticky=${back1} → static=${back2}`);

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
