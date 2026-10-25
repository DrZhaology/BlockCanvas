// v0.4.5 第二批：属性卡片与定位助手的专项验收
// 用法：node tests/e2e/probe-v045b-cards.mjs
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-cards');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // 造一个带颜色/背景/定位的 div 并选中
  const made = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const id = st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const target = id || (s2.scene.root.children || [])[(s2.scene.root.children || []).length - 1]?.id;
    if (!target) return { ok: false, children: (s2.scene.root.children || []).length };
    s2.updateStyle(target, {
      color: '#333333',
      backgroundColor: '#ffffff',
      position: 'relative',
      marginTop: '12px',
      marginLeft: '30px'
    });
    window.__sceneStore.getState().selectElement(target);
    return { ok: true, id: target, children: (window.__sceneStore.getState().scene.root.children || []).length };
  });
  console.log('元素准备:', JSON.stringify(made));
  await sleep(800);

  // 右侧面板默认停在「图层」，属性面板还没挂载 —— 先切到「属性」
  await win.locator('.tab-btn', { hasText: '属性' }).click();
  await sleep(700);

  // 「CSS 样式属性」可能是折叠状态：点它的标题展开
  const heads = await win.evaluate(() => {
    const hs = [...document.querySelectorAll('.inspector-sec > *')]
      .filter((e) => /CSS 样式属性/.test(e.textContent || '') && (e.textContent || '').length < 40)
      .map((e) => String(e.className || e.tagName));
    const btn = [...document.querySelectorAll('.inspector-sec button, .inspector-sec-head')]
      .find((b) => /CSS 样式属性/.test(b.textContent || ''));
    if (btn) btn.click();
    return hs;
  });
  console.log('section heads:', JSON.stringify(heads));
  await sleep(500);

  // 快捷助手（定位助手在它里面）也可能是折叠的
  await win.evaluate(() => {
    const btn = [...document.querySelectorAll('.inspector-sec-head')]
      .find((b) => /快捷助手/.test(b.textContent || ''));
    if (btn) btn.click();
  });
  await sleep(600);

  const dump = await win.evaluate(() => ({
    rows: [...document.querySelectorAll('.prop-row')].length,
    labels: [...document.querySelectorAll('.prop-label')].map((e) => (e.textContent || '').trim().slice(0, 12)),
    colorInputs: document.querySelectorAll('.color-text-input').length,
    varBtns: document.querySelectorAll('.color-var-btn').length,
    bgModes: [...document.querySelectorAll('.bg-mode-btn')].map((b) => b.textContent.trim()),
    qhToggles: [...document.querySelectorAll('.qh-block-toggle')].map((b) => (b.textContent || '').trim().slice(0, 8))
  }));
  console.log('DOM:', JSON.stringify(dump));

  check('颜色字段的 var 入口常显', dump.varBtns > 0, `找到 ${dump.varBtns} 个 .color-var-btn`);
  check('背景支持三种模式（纯色/渐变/图片）',
    dump.bgModes.length === 3 && dump.bgModes.includes('图片'), dump.bgModes.join(' / ') || '未找到');

  // 打开定位助手
  await win.evaluate(() => {
    const btn = [...document.querySelectorAll('.qh-block-toggle')].find((b) => b.textContent.includes('定位助手'));
    if (btn) btn.click();
  });
  await sleep(600);

  const pos = await win.evaluate(() => {
    const el = document.querySelector('.pos-edges');
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    const kids = [...el.children].map((c) => c.getBoundingClientRect());
    return {
      overflow: el.scrollWidth > el.clientWidth + 1,
      maxRight: Math.max(...kids.map((k) => Math.round(k.right))),
      containerRight: Math.round(r.right),
      count: el.children.length,
      disabled: el.classList.contains('is-disabled')
    };
  });
  check('定位助手四边输入不溢出面板',
    !pos.missing && !pos.overflow && pos.maxRight <= pos.containerRight + 1,
    pos.missing ? '未找到 .pos-edges' : `${pos.count} 行 · 溢出=${pos.overflow} · 最右=${pos.maxRight}/${pos.containerRight}`);
  check('relative 下四边偏移可用（不是禁用态）', !pos.missing && !pos.disabled, pos.missing ? '-' : `disabled=${pos.disabled}`);

  // margin 不规则 → 点"水平居中"应出现内联确认条，而不是直接改样式
  const before = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const n = st.scene.root.children.find((c) => c.style && c.style.position === 'relative');
    return n ? { marginLeft: n.style.marginLeft, marginRight: n.style.marginRight } : null;
  });
  await win.evaluate(() => {
    const btn = [...document.querySelectorAll('.pos-btn')].find((b) => b.textContent.includes('水平居中'));
    if (btn) btn.click();
  });
  await sleep(500);
  const confirm = await win.evaluate(() => {
    const el = document.querySelector('.pos-confirm');
    const st = window.__sceneStore.getState();
    const n = st.scene.root.children.find((c) => c.style && c.style.position === 'relative');
    return {
      shown: !!el,
      text: el ? (el.textContent || '').replace(/\s+/g, ' ').slice(0, 60) : '',
      marginLeft: n?.style.marginLeft,
      marginRight: n?.style.marginRight
    };
  });
  check('margin 不规则时先弹内联确认（不直接改样式）',
    confirm.shown && confirm.marginLeft === before.marginLeft && confirm.marginRight === before.marginRight,
    `确认条=${confirm.shown} marginLeft 未变=${confirm.marginLeft === before.marginLeft}`);

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
