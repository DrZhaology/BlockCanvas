// BlockCanvas v0.4.1 视觉验证脚本
// 启动真实 Electron 窗口，逐个界面截图，便于人工核对 UI / 动画 / 布局。
// 运行：node tests/e2e/shots-v041.mjs
import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');

const ROOT = process.cwd();
const OUT = resolve(ROOT, 'tests/e2e/shots-v041');
mkdirSync(OUT, { recursive: true });

const logs = [];
let n = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(win, name) {
  n += 1;
  await win.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png` });
  logs.push(`shot ${n}: ${name}`);
}
async function focus(win, locator) {
  if (!(await locator.count())) return false;
  await locator.first().scrollIntoViewIfNeeded().catch(() => {});
  await sleep(350);
  return true;
}
async function park(win) {
  await win.mouse.move(4, 420);
  await sleep(320);
}

async function openSection(win, title) {
  const head = win.locator('.inspector-sec-head', { hasText: title }).first();
  if (!(await head.count())) return;
  const caret = head.locator('.sec-caret').first();
  const txt = (await caret.textContent().catch(() => '')) || '';
  if (txt.trim() !== '▾') {
    await head.click({ force: true }).catch(() => {});
    await sleep(420);
  }
}

async function main() {
  const app = await electron.launch({
    args: ['.', '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox', '--disable-dev-shm-usage'],
    cwd: ROOT,
    executablePath: electronPath
  });
  const win = await app.firstWindow();
  win.on('console', (m) => { if (m.type() === 'error') logs.push('[console.error] ' + m.text()); });
  win.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1400);

  await shot(win, 'editor-初始');

  // 选一个容器元素
  const pickContainer = () => win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const root = st.scene.root;
    const walk = (n) => {
      if (n !== root && n.type === 'div' && n.children.length > 0) return n;
      for (const c of n.children) { const r = walk(c); if (r) return r; }
      return null;
    };
    const el = walk(root) || root.children[0];
    if (el) st.selectElement(el.id);
    return el ? el.id : null;
  });

  await pickContainer();
  await sleep(300);
  const attrTab = win.locator('.tab-btn', { hasText: '属性' }).first();
  if (await attrTab.count()) { await attrTab.click({ force: true }); await sleep(400); }
  await park(win);
  await shot(win, '属性面板-默认折叠');

  for (const title of ['选择器与标识', '快捷助手', '交互状态', 'CSS 样式属性']) {
    await openSection(win, title);
  }
  await park(win);
  await shot(win, '属性面板-全展开');

  // 快捷助手内部
  await focus(win, win.locator('.quick-helper'));
  await shot(win, '快捷助手');

  // 伪类预制动效
  const hoverTab = win.locator('.pseudo-tab', { hasText: ':hover' }).first();
  if (await hoverTab.count()) { await hoverTab.click({ force: true }); await sleep(420); }
  const preset = win.locator('.pseudo-preset-btn', { hasText: '浮起放大' }).first();
  if (await focus(win, preset)) { await preset.click({ force: true }); await sleep(520); }
  await focus(win, win.locator('.pseudo-presets'));
  await shot(win, '伪类预制动效');

  // 三断点快捷按钮 hover（验证不再白字）
  const mobileBtn2 = win.locator('.bp-tab-btn', { hasText: '手机' }).first();
  if (await mobileBtn2.count()) { await mobileBtn2.click({ force: true }); await sleep(600); }
  const hideBtn = win.locator('.bp-quick-btn', { hasText: '在此设备隐藏' }).first();
  if (await focus(win, hideBtn)) { await hideBtn.hover(); await sleep(400); }
  await shot(win, '三断点-按钮hover');
  const backDesktop = win.locator('.bp-tab-btn', { hasText: '电脑' }).first();
  if (await backDesktop.count()) { await backDesktop.click({ force: true }); await sleep(600); }

  // 背景渐变
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const id = st.scene.selectedId;
    if (!id) return;
    st.addVisibleProp(id, 'backgroundColor');
    st.updateStyle(id, { backgroundColor: '#eaf2ff' });
  });
  await sleep(400);
  const bgGrad = win.locator('.bg-mode-btn', { hasText: '渐变' }).first();
  if (await focus(win, bgGrad)) { await bgGrad.click({ force: true }); await sleep(520); }
  const presetToggle = win.locator('.grad-presets-toggle').first();
  if (await presetToggle.count()) { await presetToggle.click({ force: true }); await sleep(520); }
  await focus(win, win.locator('.grad-editor'));
  await shot(win, '背景渐变编辑器');

  // 四值输入（margin / padding）
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const id = st.scene.selectedId;
    if (!id) return;
    st.addVisibleProp(id, 'margin');
    st.addVisibleProp(id, 'padding');
    st.updateStyle(id, {
      marginTop: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '0px',
      paddingTop: '16px', paddingRight: '20px', paddingBottom: '16px', paddingLeft: '20px'
    });
  });
  await sleep(500);
  await focus(win, win.locator('.trbl4'));
  await shot(win, '四值输入');

  // 文字渐变
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const walk = (n) => { if (n.type === 'h1' || n.type === 'h2') return n; for (const c of n.children) { const r = walk(c); if (r) return r; } return null; };
    const h = walk(st.scene.root);
    if (h) st.selectElement(h.id);
  });
  await sleep(700);
  await openSection(win, '快捷助手');
  await focus(win, win.locator('.text-grad-quick'));
  await shot(win, '文字渐变');
  const chip = win.locator('.text-grad-chip').first();
  if (await chip.count()) { await chip.click({ force: true }); await sleep(600); }
  await focus(win, win.locator('.grad-editor'));
  await shot(win, '文字渐变-已开启');

  // 设备切换（手机）
  const mobileBtn = win.locator('.device-btn', { hasText: '手机' }).first();
  if (await mobileBtn.count()) { await mobileBtn.click({ force: true }); await sleep(800); }
  await shot(win, '设备切换-手机');
  const desktopBtn = win.locator('.device-btn', { hasText: '电脑' }).first();
  if (await desktopBtn.count()) { await desktopBtn.click({ force: true }); await sleep(700); }

  // 类名总览 + 定位
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const first = st.scene.root.children[0];
    if (first) { st.updateAttr(first.id, 'className', 'hero'); st.selectElement(first.id); }
    window.dispatchEvent(new CustomEvent('bc:open-class'));
  });
  await sleep(700);
  await shot(win, '类名总览');
  const locate = win.locator('.cls-card-actions .btn-mini', { hasText: '定位' }).first();
  if (await locate.count()) { await locate.click({ force: true }); await sleep(500); }
  await shot(win, '类名定位-高亮');

  // 设置页
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-settings')));
  await sleep(1000);
  await shot(win, '设置-个性化');
  for (const [label, name] of [['编辑器与画布', '设置-编辑器'], ['存储与自动备份', '设置-存储'], ['工具栏管理', '设置-工具栏'], ['扩展与插件中心', '设置-扩展'], ['关于与系统', '设置-关于']]) {
    const nav = win.locator('.fluent-nav-item', { hasText: label }).first();
    if (await nav.count()) { await nav.click({ force: true }); await sleep(700); await shot(win, name); }
  }

  // 返回编辑器 + 快捷键面板
  await win.evaluate(() => { const b = document.querySelector('.fluent-back-btn'); if (b) b.click(); });
  await sleep(800);
  await win.keyboard.press('Shift+/');
  await sleep(800);
  await shot(win, '快捷键面板');

  await app.close();
  writeFileSync(resolve(OUT, 'log.txt'), logs.join('\n'), 'utf8');
  console.log(logs.join('\n'));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
