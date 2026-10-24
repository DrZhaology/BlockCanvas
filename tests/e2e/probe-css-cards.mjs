// CSS 属性卡片 / 伪类预览 / 新增元素定位 / 帮助气泡 / 更新页滚动 探针（v0.4.4 第四轮）
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
  const DATA_DIR = resolve(tmpdir(), 'bc-css-probe');
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

  const id = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    return window.__sceneStore.getState().scene.selectedId;
  });
  await sleep(400);
  /**
   * 读元素样式（**断点感知**）。
   *
   * v0.4.5：属性面板的写入是跟着**当前断点**走的 —— 画布宽度落在哪个断点，
   * 值就写在 `responsive[断点]` 里而不是 `style`。默认窗口（1280×800）下右侧面板占 456px，
   * 画布只剩 ~753px → 会落到 tablet 断点。以前这里只读 `style`，在窄窗口下必然读到空值
   *（断言本身写错了，不是功能坏了）。
   */
  const nodeStyle = () => win.evaluate((x) => {
    const st = window.__sceneStore.getState();
    const bp = st.activeBreakpoint;
    const find = (n, i) => (n.id === i ? n : (n.children || []).reduce((a, k) => a || find(k, i), null));
    const n = find(st.scene.root, x);
    const base = (n && n.style) || {};
    const resp = (n && n.responsive && n.responsive[bp]) || {};
    // 当前断点优先，其次回落到 base —— 这就是画布上"实际生效"的值
    return { ...base, ...resp, __bp: bp, __base: base, __resp: resp };
  }, id);

  // ============ 1. 帮助气泡不再被面板盖住 ============
  await win.locator('.inspector-sec-head .help-btn').first().click();
  await sleep(400);
  const helpState = await win.evaluate(() => {
    const pop = document.querySelector('.help-pop');
    if (!pop) return null;
    const r = pop.getBoundingClientRect();
    const z = getComputedStyle(pop).zIndex;
    // 气泡中心点上最顶层的元素必须属于气泡
    const el = document.elementFromPoint(r.left + Math.min(30, r.width / 2), r.top + 20);
    return { z, visible: r.width > 0 && r.height > 0, topmost: !!el && !!el.closest('.help-pop') };
  });
  ok('问号气泡能显示、层级高于面板、且不被遮挡',
    !!helpState && helpState.visible && Number(helpState.z) > 700 && helpState.topmost, JSON.stringify(helpState));
  await win.keyboard.press('Escape');
  await sleep(250);

  // ============ 2. 不适用属性也能添加（left） ============
  const cssSec = win.locator('.inspector-sec', { hasText: 'CSS 样式属性' }).first();
  await win.locator('.inspector-sec-head', { hasText: 'CSS 样式属性' }).first().click();
  await sleep(400);
  await cssSec.locator('.add-prop-trigger').first().click();
  await sleep(250);
  await win.locator('.add-prop-search input').fill('left');
  await sleep(350);
  const leftItem = win.locator('.add-prop-item', { hasText: '左偏移' }).first();
  ok('添加属性菜单里能搜到 left', (await leftItem.count()) === 1);
  await leftItem.click();
  await sleep(500);
  const leftRow = await win.evaluate(() => {
    const row = document.querySelector('[data-prop-key="left"]');
    return row ? { exists: true, warn: !!row.querySelector('.prop-warn-tag'), text: row.querySelector('.prop-warn-tag')?.textContent || '' } : null;
  });
  ok('left 能添加进来，并标「不生效」而不是点不动', !!leftRow && leftRow.exists && leftRow.warn && leftRow.text.includes('不生效'), JSON.stringify(leftRow));

  // ============ 3. 滤镜可视化卡片 ============
  await cssSec.locator('.add-prop-trigger').first().click();
  await sleep(250);
  await win.locator('.add-prop-search input').fill('filter');
  await sleep(350);
  await win.locator('.add-prop-item', { hasText: '滤镜' }).first().click();
  await sleep(500);
  ok('滤镜有可视化卡片（预设 + 滑杆）', (await win.locator('.fx-editor').count()) === 1);
  await win.locator('.fx-preset', { hasText: '模糊' }).first().click();
  await sleep(400);
  const fxStyle = await nodeStyle();
  ok('点「模糊」预设 → filter 写入 blur', /blur\(\d+px\)/.test(fxStyle.filter || ''), fxStyle.filter);

  // ============ 4. 外轮廓卡片 ============
  await cssSec.locator('.add-prop-trigger').first().click();
  await sleep(250);
  await win.locator('.add-prop-search input').fill('outline');
  await sleep(350);
  await win.locator('.add-prop-item', { hasText: '外轮廓' }).first().click();
  await sleep(500);
  ok('外轮廓有可视化卡片', (await win.locator('.outline-editor').count()) === 1);
  await win.locator('.outline-style-btn', { hasText: '虚线' }).first().click();
  await sleep(400);
  const olStyle = await nodeStyle();
  ok('点「虚线」→ outline 写入 dashed', /dashed/.test(olStyle.outline || ''), olStyle.outline);

  // ============ 5. 跨列卡片 ============
  await cssSec.locator('.add-prop-trigger').first().click();
  await sleep(250);
  await win.locator('.add-prop-search input').fill('grid-column');
  await sleep(350);
  await win.locator('.add-prop-item', { hasText: '跨列' }).first().click();
  await sleep(500);
  ok('跨列有可视化卡片', (await win.locator('.grid-span').count()) === 1);
  await win.locator('.grid-span-btn', { hasText: '跨 2' }).first().click();
  await sleep(400);
  const gsStyle = await nodeStyle();
  ok('点「跨 2」→ gridColumn = span 2', gsStyle.gridColumn === 'span 2', gsStyle.gridColumn);

  // ============ 6. 伪类实时预览（无类名元素） ============
  await win.evaluate((x) => {
    window.__sceneStore.getState().updatePseudoStyle(x, 'hover', { backgroundColor: '#ff0000' });
  }, id);
  await sleep(400);
  // 交互状态板块默认折叠：先展开，否则看不到伪类页签
  await win.locator('.inspector-sec-head', { hasText: '交互状态' }).first().click();
  await sleep(450);
  const pseudoTab = win.locator('.pseudo-tab', { hasText: '悬停' }).first();
  if (await pseudoTab.count()) await pseudoTab.click();
  await sleep(500);
  const preview = await win.evaluate((x) => {
    const el = document.querySelector(`.canvas [data-bc-id="${x}"]`);
    return el ? getComputedStyle(el).backgroundColor : '';
  }, id);
  ok('选中 :hover 时画布实时预览（背景变红）', preview === 'rgb(255, 0, 0)', preview);
  if (await pseudoTab.count()) await pseudoTab.click(); // 取消预览
  await sleep(400);

  // ============ 7. 新增元素自动定位（橙色定位环） ============
  await win.evaluate(() => { try { localStorage.setItem('bc-auto-locate-new', '1'); } catch { /* ignore */ } });
  await win.locator('.element-panel .element-btn').first().click();
  await sleep(700);
  const locate = await win.evaluate(() => {
    const el = document.querySelector('.canvas [data-bc-id][data-bc-sel]');
    const wrap = document.querySelector('.canvas-wrap');
    if (!el || !wrap) return null;
    const r = el.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    return { inside: r.top >= w.top - 2 && r.bottom <= w.bottom + 2, ring: document.querySelectorAll('.bc-reveal-ring').length };
  });
  ok('新增元素自动滚动到可视区（且不再画多余的闪烁环）',
    !!locate && locate.inside && locate.ring === 0, JSON.stringify(locate));

  // ============ 8. margin 滚轮调值不再清空 ============
  // 自动定位那一步插入了新元素并选中了它 → 先把选中切回原元素
  await win.evaluate((x) => window.__sceneStore.getState().selectElement(x), id);
  await sleep(500);
  // 每个元素有自己的折叠记忆：原元素此时可能是收起状态
  if ((await win.locator('.inspector-sec-body .props-list').count()) === 0) {
    await win.locator('.inspector-sec-head', { hasText: 'CSS 样式属性' }).first().click();
    await sleep(450);
  }
  await win.evaluate((x) => {
    const st = window.__sceneStore.getState();
    st.updateStyle(x, { marginTop: '10px', marginRight: '10px', marginBottom: '10px', marginLeft: '10px' });
  }, id);
  await sleep(400);
  // margin 卡片展开成四个分边输入框（.trbl4-num），以前探针找的是 .trbl4-input（不存在的类名）
  const mtInput = win.locator('[data-prop-key="margin"] .trbl4-num, [data-prop-key="margin"] .trbl4-input').first();
  if (await mtInput.count()) {
    await mtInput.click();
    await mtInput.dispatchEvent('wheel', { deltaY: -120 });
    await sleep(450);
    const v = await mtInput.inputValue();
    ok('margin 输入框滚轮调值后数字仍在（不清空）', v.trim() !== '', `value=${v}`);
  } else {
    ok('margin 输入框存在', false, 'no input');
  }

  // ============ 9. 更新中心整页可滚动 ============
  await win.evaluate(() => window.dispatchEvent(new Event('menu:check-update')));
  await win.waitForSelector('.update-page', { timeout: 8000 });
  await sleep(600);
  const up = await win.evaluate(() => {
    const p = document.querySelector('.update-page');
    const b = document.querySelector('.update-body');
    return {
      pageOverflow: p ? getComputedStyle(p).overflowY : '',
      bodyOverflow: b ? getComputedStyle(b).overflowY : ''
    };
  });
  ok('更新中心整页可滚动（page overflow-y: auto）', up.pageOverflow === 'auto', JSON.stringify(up));

  const realErrs = errs.filter((t) => !/Failed to load resource/.test(t));
  ok('无 console / page 错误', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));
  await app.close();
  console.log(`\n===== CSS 卡片探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
