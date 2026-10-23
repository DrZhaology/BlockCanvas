// BlockCanvas · v0.4.5 全面 UI 巡检截图（只拍图，不断言）
// 目标：把每个页面 / 面板 / 弹窗都单独拍下来，便于逐张挑毛病。
// 跑法：node tests/e2e/shots-audit.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const OUT = resolve(ROOT, 'tests/e2e/shots-audit');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const DATA_DIR = resolve(tmpdir(), 'bc-shots-audit');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1440, 900);
    w.center();
  });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(900);

  let n = 0;
  const snap = async (name, selector) => {
    n += 1;
    const file = resolve(OUT, String(n).padStart(2, '0') + '-' + name + '.png');
    try {
      if (selector) {
        const loc = win.locator(selector).first();
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await loc.screenshot({ path: file, timeout: 8000 });
      } else {
        await win.screenshot({ path: file, timeout: 8000 });
      }
      console.log('  ✓', file.split('\\').pop());
    } catch (e) { console.log('  ✗', name, String(e.message).split('\n')[0]); }
  };
  const clickText = async (sel, text) => {
    const loc = win.locator(sel, { hasText: text }).first();
    if (await loc.count()) { await loc.click(); await sleep(350); return true; }
    console.log('  ! 找不到', sel, text);
    return false;
  };

  // ================= 首页 =================
  await snap('home-full');
  await win.locator('.eh-search input').click();
  await win.locator('.eh-search input').fill('渐变');
  await sleep(450);
  await snap('home-search');
  await win.locator('.eh-search input').fill('');
  await win.keyboard.press('Escape');
  await sleep(200);

  await win.locator('.eh-settings').click();
  await sleep(450);
  await snap('home-settings-preset');
  await clickText('.eh-tab', '渐变');
  await snap('home-settings-gradient');
  await snap('home-settings-gradient-panel', '.eh-panel');
  await clickText('.eh-tab', '图片');
  await snap('home-settings-image');
  await clickText('.eh-tab', '视频');
  await snap('home-settings-video');
  await win.keyboard.press('Escape');
  await sleep(300);

  // ================= 全部项目 =================
  await win.locator('.empty-home .eh-btn').nth(2).click();
  await sleep(700);
  await snap('projects-center');
  await win.locator('.pc-back-btn').click();
  await sleep(500);

  // ================= 编辑器 =================
  await win.locator('.empty-home .eh-btn').nth(1).click();
  await win.waitForSelector('.toolbar', { timeout: 15000 });
  await sleep(900);
  await snap('editor-empty');
  await snap('toolbar', '.toolbar');
  await snap('tabbar', '.project-tab-bar');
  await snap('left-panel', '.elem-pane-wrap');
  await snap('right-panel', '.right-pane');
  await snap('canvas', '.canvas-area');

  // 造内容：容器 + 标题 + 段落 + 按钮 + 图片
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    let root = window.__sceneStore.getState().scene.root;
    const boxId = root.children[root.children.length - 1].id;
    st.updateStyle(boxId, {
      padding: '24px 28px', margin: '24px auto', width: '520px',
      border: '1px solid #dbe4f0', borderRadius: '14px',
      backgroundColor: '#ffffff', boxShadow: '0 10px 30px rgba(15,35,70,.08)',
      display: 'flex', flexDirection: 'column', gap: '12px'
    });
    st.addElement('h1', boxId);
    root = window.__sceneStore.getState().scene.root;
    const h1 = findLast(root, boxId).children.slice(-1)[0].id;
    st.setText(h1, '把想法搭成网页');
    st.updateStyle(h1, { fontSize: '30px', color: '#12233f', fontWeight: '700', margin: '0' });
    st.addElement('p', boxId);
    root = window.__sceneStore.getState().scene.root;
    const p = findLast(root, boxId).children.slice(-1)[0].id;
    st.setText(p, '左侧拖入积木，右侧调整样式，随时导出成干净的 HTML。');
    st.updateStyle(p, { fontSize: '14px', lineHeight: '1.7', color: '#5b6b82', margin: '0' });
    st.addElement('button', boxId);
    root = window.__sceneStore.getState().scene.root;
    const btn = findLast(root, boxId).children.slice(-1)[0].id;
    st.setText(btn, '开始搭建');
    st.updateStyle(btn, {
      alignSelf: 'flex-start', padding: '10px 20px', borderRadius: '10px',
      backgroundColor: '#2f6fed', color: '#fff', border: 'none', fontSize: '14px',
      boxShadow: '0 6px 16px rgba(47,111,237,.28)'
    });
    st.selectElement(boxId);
    function findLast(node, id) {
      if (node.id === id) return node;
      for (const c of node.children) { const r = findLast(c, id); if (r) return r; }
      return null;
    }
  });
  await sleep(800);
  await snap('editor-content');
  await snap('inspector-element-top', '.right-pane');
  await snap('canvas-content', '.canvas-area');

  // 展开 CSS 样式区
  const cssHead = win.locator('.inspector-sec-head', { hasText: 'CSS 样式属性' }).first();
  if (await cssHead.count()) { await cssHead.click(); await sleep(500); }
  await snap('inspector-css-open', '.right-pane');
  const props = win.locator('.props-list');
  if (await props.count()) {
    await props.evaluate((el) => { el.scrollTop = 0; });
    await snap('props-list-top', '.props-list');
    await props.evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
    await snap('props-list-mid', '.props-list');
    await props.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await snap('props-list-bottom', '.props-list');
  }

  // 添加属性菜单
  const addTrigger = win.locator('.add-prop-trigger').first();
  if (await addTrigger.count()) {
    await addTrigger.click();
    await sleep(500);
    await snap('add-prop-menu');
    await win.keyboard.press('Escape');
    await sleep(250);
  }

  // 快捷助手
  const helperHead = win.locator('.inspector-sec-head', { hasText: '快捷助手' }).first();
  if (await helperHead.count()) { await helperHead.click(); await sleep(400); await snap('inspector-quick-helper', '.right-pane'); }

  // 伪类
  const pseudoHead = win.locator('.inspector-sec-head', { hasText: '交互状态' }).first();
  if (await pseudoHead.count()) {
    await pseudoHead.click(); await sleep(400);
    await snap('inspector-pseudo', '.right-pane');
    const hoverTab = win.locator('.pseudo-tab', { hasText: ':hover' }).first();
    if (await hoverTab.count()) { await hoverTab.click(); await sleep(400); await snap('inspector-pseudo-hover', '.right-pane'); }
  }

  // 选择器与标识
  const idHead = win.locator('.inspector-sec-head', { hasText: '选择器与标识' }).first();
  if (await idHead.count()) { await idHead.click(); await sleep(400); await snap('inspector-identity', '.right-pane'); }

  // 图层
  await clickText('.tab-btn', '图层');
  await sleep(400);
  await snap('layers-panel', '.right-pane');

  // 页面页签
  await clickText('.tab-btn', '属性');
  await sleep(300);
  await clickText('.inspector-tab', '页面');
  await sleep(500);
  await snap('inspector-page', '.right-pane');
  const globalHead = win.locator('.inspector-sec-head', { hasText: '全局样式' }).first();
  if (await globalHead.count()) { await globalHead.click(); await sleep(400); await snap('inspector-page-global', '.right-pane'); }

  // 类页签
  await clickText('.inspector-tab', '类');
  await sleep(400);
  await snap('inspector-class', '.right-pane');

  // 变量页签
  await clickText('.inspector-tab', '变量');
  await sleep(500);
  await snap('inspector-token', '.right-pane');

  // 左面板两个页签
  await clickText('.inspector-tabs .inspector-tab', '模板');
  await sleep(500);
  await snap('left-templates', '.elem-pane-wrap');

  // 断点：切到手机
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:set-device', { detail: { width: 390, breakpoint: 'mobile' } })));
  await sleep(800);
  await snap('editor-mobile');
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:set-device', { detail: { width: 'auto', breakpoint: 'desktop' } })));
  await sleep(600);

  // 设置
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-settings')));
  await sleep(800);
  await snap('settings-personalization');
  for (const label of ['编辑器与画布', '存储与自动备份', '工具栏管理', '扩展与插件中心', '关于与系统']) {
    await clickText('.fluent-nav-item', label);
    await sleep(450);
    await snap('settings-' + label);
  }
  await win.locator('.pc-back-btn, .fluent-back, .back-btn').first().click().catch(() => {});
  await win.keyboard.press('Escape').catch(() => {});
  await sleep(600);
  if (await win.locator('.fluent-side').count()) { await win.locator('.fluent-side').press('Escape').catch(() => {}); }
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-settings')));
  await sleep(300);
  // 用返回按钮回编辑器
  const back = win.locator('button', { hasText: '返回' }).first();
  if (await back.count()) { await back.click(); await sleep(700); }

  // 帮助中心
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-help')));
  await sleep(900);
  await snap('help-center');
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:help')));
  await sleep(300);

  // 关于 / 快捷键 / 类管理器 / 扩展管理器
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:about')));
  await sleep(700);
  await snap('modal-about');
  await win.keyboard.press('Escape');
  await sleep(400);
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:shortcuts')));
  await sleep(700);
  await snap('modal-shortcuts');
  await win.keyboard.press('Escape');
  await sleep(400);
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:class-manager')));
  await sleep(700);
  await snap('modal-class-manager');
  await win.keyboard.press('Escape');
  await sleep(400);
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:ext')));
  await sleep(800);
  await snap('modal-extensions');
  await win.keyboard.press('Escape');
  await sleep(400);

  // 画布右键菜单
  const canvasBox = await win.evaluate(() => {
    const el = document.querySelector('.canvas [data-bc-id]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + 20 };
  });
  if (canvasBox) {
    await win.mouse.click(canvasBox.x, canvasBox.y, { button: 'right' });
    await sleep(500);
    await snap('context-menu');
    await win.keyboard.press('Escape');
    await sleep(300);
  }

  // 深色
  await win.evaluate(() => document.documentElement.setAttribute('data-bc-dark', '1'));
  await sleep(700);
  await snap('dark-editor');
  await snap('dark-inspector', '.right-pane');
  await win.evaluate(() => document.documentElement.removeAttribute('data-bc-dark'));
  await sleep(400);

  // 窄窗口
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await sleep(900);
  await snap('narrow-960');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await sleep(600);

  await app.close();
  console.log('完成 →', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
