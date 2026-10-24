// 属性面板 / 全局样式 / 变量 / 断点条 修复探针（v0.4.4 第三轮）
// 覆盖：① 折叠状态按元素记忆并随选中切换 ② 全局样式能加属性 ③ 添加属性菜单不出屏
//      ④ 变量用同一个添加菜单 ⑤ 断点条 3+1 布局、设备高亮按画布宽度 ⑥ 层级纪律 ⑦ 中键定位在可视区
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
  const DATA_DIR = resolve(tmpdir(), 'bc-inspector-probe');
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(700);

  // 准备两个带类名的元素
  const ids = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    const a = window.__sceneStore.getState().scene.selectedId;
    st.setNodeAttr(a, 'className', 'sec-a');
    st.addElement('div', null);
    const b = window.__sceneStore.getState().scene.selectedId;
    st.setNodeAttr(b, 'className', 'sec-b');
    return { a, b };
  });
  await sleep(400);

  const selectEl = async (id) => {
    await win.evaluate((x) => window.__sceneStore.getState().selectElement(x), id);
    await sleep(450);
  };
  const cssSectionOpen = async () => (await win.locator('.inspector-sec-body .props-list').count()) > 0;

  // ============ 1. 折叠状态按元素记忆 ============
  await selectEl(ids.a);
  ok('默认：CSS 样式属性折叠（看不到属性列表）', !(await cssSectionOpen()));
  await win.locator('.inspector-sec-head', { hasText: 'CSS 样式属性' }).first().click();
  await sleep(450);
  ok('展开 A 的 CSS 板块', await cssSectionOpen());

  await selectEl(ids.b);
  ok('切到 B：CSS 板块回到 B 自己的折叠状态（收起）', !(await cssSectionOpen()));
  await win.locator('.inspector-sec-head', { hasText: 'CSS 样式属性' }).first().click();
  await sleep(450);

  await selectEl(ids.a);
  ok('切回 A：仍保持 A 展开的状态', await cssSectionOpen());
  await selectEl(ids.b);
  ok('再切到 B：保持 B 展开的状态', await cssSectionOpen());

  // ============ 2. 页面页签：全局样式能加属性 ============
  await win.locator('.panel.inspector .inspector-tabs .inspector-tab', { hasText: '页面' }).first().click();
  await sleep(400);
  const gsec = win.locator('.inspector-sec-head', { hasText: '全局样式' }).first();
  await gsec.click();
  await sleep(450);
  const globalTrigger = win.locator('.inspector-sec', { hasText: '全局样式' }).locator('.add-prop-trigger').first();
  await globalTrigger.click();
  await sleep(300);
  await win.locator('.add-prop-search input').fill('letter-spacing');
  await sleep(400);
  const itemCount = await win.locator('.add-prop-item').count();
  ok('全局样式：添加属性菜单能搜到 letter-spacing', itemCount > 0, 'items=' + itemCount);
  await win.locator('.add-prop-item').first().click();
  await sleep(500);
  const bodyExtra = await win.evaluate(() => window.__sceneStore.getState().scene.bodyExtra || {});
  ok('点属性后 bodyExtra 里真的写入了键（空值也算已添加）',
    Object.prototype.hasOwnProperty.call(bodyExtra, 'letter-spacing'), JSON.stringify(bodyExtra));
  ok('全局样式里出现这张属性卡片', (await win.locator('.page-prop-row').count()) >= 1);

  // ============ 3. 添加属性菜单靠近底部时不出屏 ============
  await win.evaluate(() => {
    const el = document.querySelector('.right-pane .panel') || document.querySelector('.right-pane .tab-body');
    if (el) el.scrollTop = el.scrollHeight;
  });
  await sleep(300);
  await globalTrigger.click();
  await sleep(500);
  const menuBox = await win.evaluate(() => {
    const m = document.querySelector('.add-prop-menu');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, vh: innerHeight, dropUp: m.classList.contains('drop-up') };
  });
  ok('菜单完整落在视口内（自动向上展开 / 滚动）',
    !!menuBox && menuBox.top >= -1 && menuBox.bottom <= menuBox.vh + 1,
    JSON.stringify(menuBox));
  await win.keyboard.press('Escape');
  await sleep(300);

  // ============ 4. 变量面板用同一个添加属性菜单 ============
  await win.locator('.panel.inspector .inspector-tabs .inspector-tab', { hasText: '变量' }).first().click();
  await sleep(400);
  const before = await win.evaluate(() => (window.__sceneStore.getState().scene.tokens || []).length);
  const tokenTrigger = win.locator('.token-panel .add-prop-trigger').first();
  ok('变量面板有「添加属性」按钮', (await tokenTrigger.count()) === 1);
  await tokenTrigger.click();
  await sleep(300);
  await win.locator('.add-prop-search input').fill('圆角');
  await sleep(400);
  const tokenItems = await win.locator('.add-prop-item').count();
  ok('变量：添加属性菜单能搜到「圆角」类属性', tokenItems > 0, 'items=' + tokenItems);
  await win.locator('.add-prop-item').first().click();
  await sleep(500);
  const after = await win.evaluate(() => (window.__sceneStore.getState().scene.tokens || []).length);
  ok('选中属性后真的新建了一个变量', after === before + 1, `${before} → ${after}`);

  // ============ 5. 断点条：3 个设备 + 1 个小自适应按钮 ============
  await win.locator('.panel.inspector .inspector-tabs .inspector-tab', { hasText: '元素' }).first().click();
  await selectEl(ids.a);
  const bp = await win.evaluate(() => ({
    tabs: document.querySelectorAll('.bp-tab-btn').length,
    auto: document.querySelectorAll('.bp-auto-btn').length,
    autoText: Array.from(document.querySelectorAll('.bp-tab-btn')).map((b) => b.textContent || '').join('|'),
    active: document.querySelector('.bp-tab-btn.active')?.textContent || ''
  }));
  ok('断点条 = 3 个设备分段 + 1 个小的自适应按钮', bp.tabs === 3 && bp.auto === 1, JSON.stringify(bp));
  ok('「自适应」不再是分段按钮（不会常亮）', !bp.autoText.includes('自适应'), bp.autoText);
  ok('默认高亮由画布宽度决定（电脑）', bp.active.includes('电脑'), bp.active);

  // 切到手机 → 手机分段高亮
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:set-device', { detail: 'mobile' })));
  await sleep(600);
  const activeMobile = await win.evaluate(() => document.querySelector('.bp-tab-btn.active')?.textContent || '');
  ok('切到手机宽度 → 手机分段高亮', activeMobile.includes('手机'), activeMobile);
  // 点自适应：按钮本身不加 active，高亮仍按实际宽度（手机 375px）
  await win.locator('.bp-auto-btn').click();
  await sleep(500);
  const autoState = await win.evaluate(() => ({
    autoActive: document.querySelector('.bp-auto-btn')?.classList.contains('active') || false,
    active: document.querySelector('.bp-tab-btn.active')?.textContent || '',
    width: document.querySelector('.canvas')?.clientWidth || 0
  }));
  // 自适应后画布铺满窗口（≈790px）→ 按宽度应识别为「电脑」，而不是停留在刚点的手机
  const expected = autoState.width <= 480 ? '手机' : autoState.width <= 768 ? '平板' : '电脑';
  ok('点自适应后按钮不亮，设备高亮按画布实际宽度判断',
    autoState.autoActive === false && autoState.active.includes(expected),
    JSON.stringify({ ...autoState, expected }));

  // ============ 6. 层级纪律：面板在画布覆盖层之上 ============
  const z = await win.evaluate(() => ({
    panel: Number(getComputedStyle(document.querySelector('.right-pane-wrap')).zIndex) || 0,
    toolbar: Number(getComputedStyle(document.querySelector('.toolbar')).zIndex) || 0,
    boxm: 402 // CSS 里盒模型覆盖层的层级
  }));
  ok('面板 / 工具栏层级高于画布覆盖层（700 > 402）', z.panel === 700 && z.toolbar === 700 && z.panel > z.boxm,
    JSON.stringify(z));

  // ============ 7. 中键定位：末尾属性也在可视区内 ============
  // 先把右侧切到「图层」，模拟"面板不在元素页签"的情况
  await win.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.right-pane .tab-btn, .right-pane [role="tab"]'))
      .find((b) => (b.textContent || '').includes('图层'));
    if (btn) btn.click();
  });
  await sleep(400);
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:focus-prop', { detail: { key: 'opacity', add: true } })));
  await sleep(900);
  const pos = await win.evaluate(() => {
    const row = document.querySelector('[data-prop-key="opacity"]');
    const sc = document.querySelector('.right-pane .panel') || document.querySelector('.right-pane .tab-body');
    if (!row || !sc) return null;
    const rr = row.getBoundingClientRect();
    const sr = sc.getBoundingClientRect();
    return { visible: rr.top >= sr.top - 2 && rr.bottom <= sr.bottom + 2, rr: [rr.top, rr.bottom], sr: [sr.top, sr.bottom] };
  });
  ok('面板在图层页时，中键定位也能切到元素页并落在可视区', !!pos && pos.visible, JSON.stringify(pos));

  ok('无 console / page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));
  await app.close();
  console.log(`\n===== 属性面板修复探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
