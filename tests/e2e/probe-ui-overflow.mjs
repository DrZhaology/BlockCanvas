// v0.4.5 全界面溢出/挤压审计
// 用法：node tests/e2e/probe-ui-overflow.mjs
// 目的：不靠肉眼看截图，逐面扫"内容溢出容器 / 被裁掉 / 文字被挤成竖排"的地方，输出可修清单。
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 每张页面要扫的根容器
const SCAN = {
  '首页': ['.empty-home'],
  '首页设置面板': ['.eh-panel'],
};

const findings = [];

/** 在页面里跑的通用审计：找出"溢出/被裁/竖排"的元素 */
const AUDIT_FN = `(selectors) => {
  const out = [];
  const seen = new Set();
  const desc = (el) => {
    const cls = String(el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  for (const sel of selectors) {
    const roots = document.querySelectorAll(sel);
    for (const root of roots) {
      for (const el of root.querySelectorAll('*')) {
        if (seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;

        // ① 横向溢出容器（内容比容器宽，且不能滚）
        //    例外：带 text-overflow:ellipsis 的是**有意截断**（长文本省略号），不算问题
        const overX = el.scrollWidth - el.clientWidth;
        const canScrollX = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
        const intentionalEllipsis = cs.textOverflow === 'ellipsis' && cs.overflowX === 'hidden';
        if (overX > 3 && !canScrollX && !intentionalEllipsis && el.clientWidth > 0 && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
          out.push({ kind: '横向溢出', el: desc(el), detail: overX + 'px 超出', rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
        }
        // ② 纵向被裁（内容比容器高，且 hidden）
        const overY = el.scrollHeight - el.clientHeight;
        if (overY > 4 && cs.overflowY === 'hidden' && el.clientHeight > 0) {
          out.push({ kind: '纵向被裁', el: desc(el), detail: overY + 'px 被切', rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
        }
        // ③ 文字被挤成竖排：单行文字元素高度远超行高
        //    注意要扣掉上下内边距，否则带 padding 的单元格会被误判成"拆了好几行"
        const txt = (el.childElementCount === 0 ? (el.textContent || '').trim() : '');
        if (txt.length >= 2 && txt.length <= 8) {
          const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 12) * 1.4;
          const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
          const contentH = Math.max(0, r.height - padY);
          const lines = Math.round(contentH / lh);
          if (lines >= 3 && r.width < 120) {
            out.push({ kind: '文字竖排', el: desc(el), detail: txt + ' 被拆成 ' + lines + ' 行（内容高 ' + Math.round(contentH) + 'px / 行高 ' + Math.round(lh) + '）', rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
          }
        }
        // ⑤ 卡片"内容行"贴着左边框（用户反复反馈的问题）
        //    只查内容容器（-body / -row / -toggles / -controls），
        //    不查页签栏、图层行这类"本来就不该有内边距"的结构件，避免误报。
        const pl = parseFloat(cs.paddingLeft) || 0;
        const prr = parseFloat(cs.paddingRight) || 0;
        const clsName = String(el.className || '');
        const isBodyish = /(-body$|-row$|-toggles$|-controls$|-controls-grid$)/.test(clsName)
          || /(^|[\s])(props-body|prop-row-body|media-props-body|media-props-toggles)([\s]|$)/.test(clsName);
        //    还要求它**本身有可见底色/边框**（是卡片内容区），
        //    否则 .help-body / .tab-body 这类透明布局容器会被误报。
        const hasBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
        const hasBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
        if (isBodyish && (hasBg || hasBorder) && el.clientWidth > 120 && el.childElementCount > 0) {
          if (pl < 6) {
            out.push({ kind: '内容行贴左边', el: desc(el), detail: '左内边距只有 ' + pl + 'px', rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
          } else if (Math.abs(pl - prr) > 4) {
            out.push({ kind: '内容行左右不等距', el: desc(el), detail: '左 ' + pl + 'px / 右 ' + prr + 'px', rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
          }
        }
        // ④ 跑到窗口外（左右超出视口）
        if (r.left < -4 || r.right > window.innerWidth + 4) {
          out.push({ kind: '超出窗口', el: desc(el), detail: (r.left < -4 ? '左侧 ' + Math.round(r.left) : '右侧 ' + Math.round(r.right - window.innerWidth)) + 'px', rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
        }
      }
    }
  }
  // 同一元素同一种问题只留一条
  const uniq = new Map();
  for (const f of out) {
    const k = f.kind + '|' + f.el;
    if (!uniq.has(k)) uniq.set(k, f);
  }
  return [...uniq.values()].slice(0, 14);
}`;

async function audit(win, label, selectors) {
  const rows = await win.evaluate(new Function('return ' + AUDIT_FN)(), selectors);
  if (rows.length) {
    console.log(`\n—— ${label} ——`);
    for (const r of rows) console.log(`  [${r.kind}] ${r.el}  ${r.detail}  @${r.rect.join(',')}`);
    findings.push({ label, rows });
  } else {
    console.log(`\n—— ${label} —— 无问题`);
  }
}

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-overflow');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  // 预置几个素材，让素材页有内容可扫
  const cacheDir = resolve(DATA_DIR, 'cache', 'assets');
  mkdirSync(cacheDir, { recursive: true });
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  for (let i = 0; i < 6; i++) {
    const fs = await import('fs');
    fs.writeFileSync(resolve(cacheDir, `b${String(i).padStart(14, '0')}.png`), PNG);
  }

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(800);

  await audit(win, '首页', ['.empty-home']);
  await win.locator('.eh-gear').click();
  await sleep(400);
  await audit(win, '首页·页面设置面板', ['.eh-panel']);
  await win.keyboard.press('Escape');
  await sleep(400);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1200);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });
  await audit(win, '编辑器·工具条与标签栏', ['.toolbar', '.project-tab-bar']);

  // 造点内容：视频（媒体卡）+ 几个元素
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('video');
    st.addElement('img');
    const s2 = window.__sceneStore.getState();
    const v = (s2.scene.root.children || []).find((c) => c.type === 'video');
    if (v) s2.updateAttr(v.id, 'src', 'https://example.com/a.mp4');
  });
  await sleep(800);

  await win.locator('.tab-btn', { hasText: '属性' }).click();
  await sleep(800);
  await audit(win, '编辑器·右侧属性面板', ['.right-pane']);
  await audit(win, '编辑器·媒体属性卡', ['.media-props']);

  // 定位助手
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.qh-block-toggle')].find((x) => (x.textContent || '').includes('定位助手'));
    if (b) b.click();
  });
  await sleep(600);
  await audit(win, '编辑器·定位助手', ['.pos-helper']);

  await win.locator('.tab-btn', { hasText: '图层' }).click();
  await sleep(600);
  await audit(win, '编辑器·图层树', ['.layer-tree']);

  // 左侧三个页签
  for (const tab of ['元素', '模板', '素材']) {
    await win.evaluate((t) => {
      const b = [...document.querySelectorAll('.inspector-tab')].find((x) => (x.textContent || '').trim() === t);
      if (b) b.click();
    }, tab);
    await sleep(800);
    await audit(win, `编辑器·左侧「${tab}」`, ['.element-panel']);
  }

  // 项目中心 / 设置 / 更新中心
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:projects')));
  await sleep(1200);
  await audit(win, '项目中心', ['.pc-page']);

  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:settings')));
  await sleep(1200);
  await audit(win, '设置页', ['.settings-page, .fluent-layout, .fluent-content']);

  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:check-update')));
  await sleep(2500);
  await audit(win, '更新中心', ['.update-page']);

  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:help')));
  await sleep(1500);
  await audit(win, '帮助中心', ['.help-page']);

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const total = findings.reduce((n, f) => n + f.rows.length, 0);
  console.log(`\n===== 共发现 ${total} 处问题，涉及 ${findings.length} 个区域 =====`);
  const byKind = {};
  for (const f of findings) for (const r of f.rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  console.log('按类型：' + Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(' / '));
  // 审计是"发现清单"，本身不作为失败（避免阻塞质量门）；但把数量打出来便于追踪
}

main().catch((e) => { console.error(e); process.exit(1); });