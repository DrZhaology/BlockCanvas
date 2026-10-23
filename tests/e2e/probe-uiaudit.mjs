// v0.4.5 UI 整改验收探针
// 用途：把这一轮"看截图才能发现"的布局问题，变成可重复执行的断言。
// 用法：node tests/e2e/probe-uiaudit.mjs
// 输出：每条一行 PASS / FAIL + 实测值，最后汇总。
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-uiaudit');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);

  // ---------- 1. 首页垂直居中 ----------
  const home = await win.evaluate(() => {
    const el = document.querySelector('.empty-home');
    const c = document.querySelector('.eh-center');
    const cs = getComputedStyle(el);
    const hr = el.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    return {
      align: cs.alignItems,
      gapTop: Math.round(cr.top - hr.top),
      gapBottom: Math.round(hr.bottom - cr.bottom)
    };
  });
  check('首页内容垂直居中', home.align === 'center' && Math.abs(home.gapTop - home.gapBottom) < 120,
    `align-items=${home.align} 上留白=${home.gapTop} 下留白=${home.gapBottom}`);

  // ---------- 2. 渐变色标卡片：不再居中被压扁 + 有卡片底 ----------
  await win.locator('.eh-gear').click();
  await sleep(250);
  await win.locator('.eh-tab', { hasText: '渐变' }).click();
  await sleep(350);
  const stop = await win.evaluate(() => {
    const el = document.querySelector('.grad-stop');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const top = document.querySelector('.grad-stop-top');
    const tr = top ? top.getBoundingClientRect() : null;
    return {
      align: cs.alignItems,
      bg: cs.backgroundColor,
      w: Math.round(r.width),
      topW: tr ? Math.round(tr.width) : 0
    };
  });
  check('色标卡片 align-items=stretch（不再居中压扁）', !!stop && stop.align === 'stretch', stop && `align-items=${stop.align}`);
  check('色标卡片有可见底色（不是透明）', !!stop && stop.bg !== 'rgba(0, 0, 0, 0)' && stop.bg !== 'transparent', stop && `background=${stop.bg}`);
  check('色标第一行铺满卡片宽度', !!stop && stop.topW > stop.w - 24, stop && `行宽=${stop.topW} / 卡片宽=${stop.w}`);

  await win.keyboard.press('Escape');
  await sleep(200);

  // ---------- 3. 进入编辑器 ----------
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(900);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // 造一点内容：给根容器加一个 div
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement(st.scene.root.id, 'div');
  });
  await sleep(400);

  // ---------- 4. 技巧条不再是"输入框"外观 ----------
  const tips = await win.evaluate(() => {
    const el = document.querySelector('.tabbar-tips');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { border: cs.borderTopWidth + ' ' + cs.borderTopStyle, bg: cs.backgroundColor, maxW: cs.maxWidth };
  });
  check('技巧条无边框（不再像输入框）', !!tips && (tips.border.startsWith('0') || tips.border.includes('none')), tips && `border=${tips.border}`);

  // ---------- 5. 元素面板：整块一条滚动条 ----------
  const panel = await win.evaluate(() => {
    const body = document.querySelector('.element-body');
    const grid = document.querySelector('.element-group .element-grid');
    if (!body || !grid) return null;
    return {
      bodyOverflowY: getComputedStyle(body).overflowY,
      gridOverflowY: getComputedStyle(grid).overflowY
    };
  });
  check('元素面板外层统一滚动', !!panel && panel.bodyOverflowY === 'auto', panel && `element-body overflow-y=${panel.bodyOverflowY}`);
  check('元素分组内不再各自滚动', !!panel && panel.gridOverflowY === 'visible', panel && `element-grid overflow-y=${panel.gridOverflowY}`);

  // ---------- 6. 选中元素 → 未命名提醒压成一行 ----------
  const warn = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const child = st.scene.root.children[0];
    if (child) st.selectElement(child.id);
    return null;
  });
  void warn;
  await sleep(500);
  const warnInfo = await win.evaluate(() => {
    const el = document.querySelector('.cls-warn-flash');
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    const line = el.querySelector('.cls-warn-line');
    return { h: Math.round(r.height), hasLine: !!line, text: line ? line.textContent.trim() : '' };
  });
  check('未命名提醒压成一行（高度 < 46px）', !warnInfo.missing && warnInfo.h < 46, warnInfo.missing ? '未出现（该元素可能已有名字）' : `高=${warnInfo.h}px 文案=${warnInfo.text}`);

  // ---------- 7. 属性名前的"子/父"字形已清理 ----------
  // 只看「属性卡片标题行」里的标签：.prop-scope 在别处还有正当用途
  //（例如关系选择器的"父→子"、快捷助手的"排版 / 渐变"摘要），不算问题。
  const scopes = await win.evaluate(() => {
    const list = [...document.querySelectorAll('.inspector .prop-row .prop-scope, .inspector .prop-label .prop-scope')]
      .map((e) => e.textContent.trim());
    const bare = list.filter((t) => t === '子' || t === '父');
    return { count: list.length, texts: [...new Set(list)], bare };
  });
  check('属性标题行不再出现单独的"子/父"字形', scopes.bare.length === 0,
    `属性行标签 ${scopes.count} 个：${scopes.texts.join('/') || '无'}；裸字形 ${scopes.bare.length} 个`);

  // ---------- 8. 外轮廓预览：轮廓线留在卡片内 ----------
  const outline = await win.evaluate(() => {
    // 直接用真实 CSS 造一份预览结构，量"内盒 + outline"是否越过外框
    const wrap = document.createElement('div');
    wrap.className = 'outline-preview';
    const box = document.createElement('div');
    box.className = 'outline-preview-box';
    box.style.outline = '12px solid red';
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    const wr = wrap.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const cs = getComputedStyle(wrap);
    const res = {
      wrapH: Math.round(wr.height),
      padTop: parseInt(cs.paddingTop, 10),
      overflow: cs.overflow,
      inside: br.left >= wr.left && br.right <= wr.right && br.top >= wr.top && br.bottom <= wr.bottom
    };
    wrap.remove();
    return res;
  });
  check('外轮廓预览留出内边距且裁切溢出', outline.padTop >= 12 && outline.overflow === 'hidden', `padding-top=${outline.padTop} overflow=${outline.overflow}`);
  check('内盒（含 12px 轮廓）不越出卡片', outline.inside, `内盒在卡片内=${outline.inside}`);

  // ---------- 9. 添加属性菜单限高 ----------
  const menu = await win.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'add-prop-menu';
    document.body.appendChild(el);
    const mh = getComputedStyle(el).maxHeight;
    el.remove();
    return mh;
  });
  check('添加属性菜单限高 380px（不会顶出窗口）', menu === '380px', `max-height=${menu}`);

  // ---------- 10. 图层树：文字预览截断，不压操作按钮 ----------
  await win.locator('.tab-btn', { hasText: '图层' }).click();
  await sleep(500);
  // 先放一个带文字的段落，保证图层树里一定有 .layer-text-preview
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const id = st.addElement(st.scene.root.id, 'p');
    const after = window.__sceneStore.getState();
    const target = id || after.scene.root.children[after.scene.root.children.length - 1]?.id;
    if (target) after.setText(target, '这是一段很长的说明文字，用来验证图层树里的文字预览会不会压到右侧的操作按钮上');
  });
  await sleep(400);
  const layer = await win.evaluate(() => {
    const el = document.querySelector('.layer-text-preview');
    const actions = document.querySelector('.layer-actions');
    const tree = document.querySelector('.layer-tree');
    if (!tree) return null;
    return {
      hasPreview: !!el,
      maxW: el ? getComputedStyle(el).maxWidth : '',
      ellipsis: el ? getComputedStyle(el).textOverflow : '',
      actionsML: actions ? getComputedStyle(actions).marginLeft : '',
      treeOverflowX: getComputedStyle(tree).overflowX
    };
  });
  check('图层树文字预览截断（不压按钮）', !!layer && layer.hasPreview && layer.ellipsis === 'ellipsis',
    layer ? `max-width=${layer.maxW} text-overflow=${layer.ellipsis || '(无预览行)'}` : '未找到图层树');
  check('图层树不出现横向滚动条', !!layer && layer.treeOverflowX === 'hidden', layer && `overflow-x=${layer.treeOverflowX}`);

  // ---------- 11. 只读快照预览 ----------
  const snap = await win.evaluate(() => {
    const tabStore = window.__tabStore.getState();
    const scene = window.__sceneStore.getState().scene;
    const id = tabStore.newTab('演示项目 · 快照', scene, null, undefined, 'snapshot', {
      projectName: '演示项目',
      projectPath: 'C:/demo/demo.bcproj',
      snapshotPath: 'C:/demo/backups/demo-1.bcproj',
      takenAt: new Date().toISOString()
    });
    tabStore.switchTab(id);
    return id;
  });
  await sleep(700);
  const snapUi = await win.evaluate(() => {
    const bar = document.querySelector('.snapshot-bar');
    const notice = document.querySelector('.snapshot-notice');
    const info = document.querySelector('.snapshot-info');
    const canvas = document.querySelector('.canvas');
    const tab = document.querySelector('.tab-item.is-snapshot');
    const inspector = document.querySelector('.inspector');
    return {
      bar: !!bar,
      notice: !!notice,
      info: !!info,
      tabTint: !!tab,
      pointer: canvas ? getComputedStyle(canvas).pointerEvents : '',
      inspectorHidden: !inspector,
      barText: bar ? bar.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
    };
  });
  check('快照标签出现只读工具条', snapUi.bar, snapUi.barText);
  check('快照标签左侧显示只读说明', snapUi.notice);
  check('快照标签右侧显示快照信息（不显示属性面板）', snapUi.info && snapUi.inspectorHidden);
  check('快照标签在标签栏有独立配色', snapUi.tabTint);
  check('只读模式下画布不可编辑（pointer-events:none）', snapUi.pointer === 'none', `pointer-events=${snapUi.pointer}`);

  // 关闭快照标签，确认不弹"要不要保存"
  const closed = await win.evaluate(() => {
    const st = window.__tabStore.getState();
    const before = st.tabs.length;
    st.closeTab(st.activeTabId);
    return { before, after: window.__tabStore.getState().tabs.length };
  });
  check('关闭快照标签直接关（不提示保存）', closed.after === closed.before - 1, `${closed.before} → ${closed.after}`);

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    console.log('未通过：');
    for (const f of failed) console.log(' - ' + f.name + (f.detail ? ' → ' + f.detail : ''));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
