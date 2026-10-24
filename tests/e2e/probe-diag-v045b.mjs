// v0.4.5 第二批问题 · 只读诊断探针
// 目的：把用户报的现象定位到具体 DOM/样式原因，便于在动工前确认方案。
// 用法：node tests/e2e/probe-diag-v045b.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-diag-b');
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
  await sleep(700);

  // ===== 1. 首页搜索框点不进去 =====
  const search = await win.evaluate(() => {
    const input = document.querySelector('.eh-search input');
    if (!input) return { missing: true };
    const r = input.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    const chain = [];
    let n = hit;
    while (n && chain.length < 5) {
      chain.push(n.tagName.toLowerCase() + '.' + String(n.className || '').split(' ').filter(Boolean).join('.'));
      n = n.parentElement;
    }
    const pe = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).pointerEvents : 'N/A'; };
    return {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      hitChain: chain,
      inputPE: getComputedStyle(input).pointerEvents,
      centerPE: pe('.eh-center'),
      homePE: pe('.empty-home'),
      mediaPE: pe('.eh-media'),
      dimPE: pe('.eh-dim'),
      hasMedia: !!document.querySelector('.eh-media'),
      hasDim: !!document.querySelector('.eh-dim')
    };
  });
  console.log('--- 1. 首页搜索框 ---');
  console.log(JSON.stringify(search, null, 2));

  try {
    await win.locator('.eh-search input').click({ timeout: 3000 });
    await sleep(200);
    const focused = await win.evaluate(() => document.activeElement?.tagName + '.' + String(document.activeElement?.className || ''));
    console.log('点击后 activeElement:', focused);
  } catch (e) {
    console.log('点击搜索框失败:', e.message.split('\n')[0]);
  }

  // ===== 进入编辑器 =====
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const id = st.addElement(st.scene.root.id, 'div');
    const after = window.__sceneStore.getState();
    const target = id || after.scene.root.children[after.scene.root.children.length - 1]?.id;
    after.selectElement(target);
    after.updateStyle(target, {
      outlineWidth: '8px', outlineStyle: 'dashed', outlineColor: '#2563eb',
      backgroundColor: '#ffffff',
      paddingTop: '10px', paddingRight: '10px', paddingBottom: '10px', paddingLeft: '10px',
      marginTop: '12px'
    });
  });
  await sleep(700);

  // ===== 2. 颜色行是否换行 / 是否有 var 入口 =====
  const colorRows = await win.evaluate(() => {
    const out = [];
    const rows = [...document.querySelectorAll('.inspector .prop-row')];
    for (const row of rows) {
      const label = row.querySelector('.prop-label')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 24) || '';
      const input = row.querySelector('.color-text-input');
      const swatch = row.querySelector('.color-swatch-btn');
      const varBtn = row.querySelector('.color-var-btn');
      if (!input) continue;
      const ir = input.getBoundingClientRect();
      const sr = swatch ? swatch.getBoundingClientRect() : null;
      out.push({
        label,
        inputTop: Math.round(ir.top),
        swatchTop: sr ? Math.round(sr.top) : null,
        wrapped: sr ? Math.abs(sr.top - ir.top) > 4 : null,
        inputW: Math.round(ir.width),
        hasVarBtn: !!varBtn,
        rowW: Math.round(row.getBoundingClientRect().width)
      });
    }
    return out;
  });
  console.log('\n--- 2. 颜色行（换行 / var 入口） ---');
  console.log(JSON.stringify(colorRows, null, 2));

  // ===== 3. 外轮廓卡片：线型按钮是否被挤到换行 =====
  const outline = await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.outline-style-btn')];
    const wrapRow = document.querySelector('.outline-row.is-wrap');
    return {
      count: btns.length,
      btns: btns.map((b) => {
        const r = b.getBoundingClientRect();
        const label = b.textContent.trim();
        // 文字是否折行：行高 * 行数 > 按钮内高
        const lh = parseFloat(getComputedStyle(b).lineHeight) || 16;
        return { label, w: Math.round(r.width), h: Math.round(r.height), lines: Math.round(r.height / lh) };
      }),
      rowW: wrapRow ? Math.round(wrapRow.getBoundingClientRect().width) : null
    };
  });
  console.log('\n--- 3. 外轮廓线型按钮 ---');
  console.log(JSON.stringify(outline, null, 2));

  // ===== 4. 定位助手：四边输入是否溢出 =====
  const pos = await win.evaluate(() => {
    const btn = [...document.querySelectorAll('.qh-block-toggle')].find((b) => b.textContent.includes('定位助手'));
    if (btn) btn.click();
    return !!btn;
  });
  await sleep(500);
  const posInfo = await win.evaluate(() => {
    const edges = document.querySelector('.pos-edges');
    if (!edges) return { missing: true };
    const er = edges.getBoundingClientRect();
    const kids = [...edges.children].map((c) => {
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right) };
    });
    return {
      containerW: Math.round(er.width),
      scrollW: edges.scrollWidth,
      overflow: edges.scrollWidth > edges.clientWidth + 1,
      children: kids,
      maxRight: Math.max(...kids.map((k) => k.right)),
      containerRight: Math.round(er.right)
    };
  });
  console.log('\n--- 4. 定位助手四边输入 ---');
  console.log(JSON.stringify(posInfo, null, 2));

  // ===== 5. "不生效"属性的黄色竖线来自哪个类 =====
  const disabledMarks = await win.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.inspector *')) {
      const cs = getComputedStyle(el);
      const hasYellowBorder =
        /^(rgb\(2[0-5][0-9],\s*1[0-9][0-9]|rgb\(25[0-5],\s*2[0-5][0-9])/.test(cs.borderLeftColor) &&
        parseFloat(cs.borderLeftWidth) >= 2;
      if (hasYellowBorder) {
        out.push({
          cls: String(el.className || '').slice(0, 60),
          tag: el.tagName.toLowerCase(),
          borderLeft: cs.borderLeftWidth + ' ' + cs.borderLeftColor,
          text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)
        });
      }
    }
    return out.slice(0, 12);
  });
  console.log('\n--- 5. 黄色竖线元素 ---');
  console.log(JSON.stringify(disabledMarks, null, 2));

  // ===== 6. "样式还没有名字"卡片实际布局 =====
  const warn = await win.evaluate(() => {
    const el = document.querySelector('.cls-warn-flash');
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    const line = el.querySelector('.cls-warn-line');
    const btns = [...el.querySelectorAll('.cls-warn-btn')].map((b) => Math.round(b.getBoundingClientRect().width));
    return {
      h: Math.round(r.height),
      w: Math.round(r.width),
      lineW: line ? Math.round(line.getBoundingClientRect().width) : null,
      lineScrollW: line ? line.scrollWidth : null,
      truncated: line ? line.scrollWidth > line.clientWidth + 1 : null,
      btnWidths: btns
    };
  });
  console.log('\n--- 6. 未命名提醒卡片 ---');
  console.log(JSON.stringify(warn, null, 2));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
