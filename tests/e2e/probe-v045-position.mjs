// v0.4.5 定位可视化验收（B3 / B4 / B6）
// 用法：node tests/e2e/probe-v045-position.mjs
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

/** 按住 Alt 悬停到某个元素上 —— 盒模型浮层在悬停时就该出现 */
async function altHoverOn(win, id) {
  const rect = await win.evaluate((tid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${tid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, id);
  if (!rect) return false;
  await win.keyboard.down('Alt');
  await win.mouse.move(rect.x, rect.y);
  await win.mouse.move(rect.x + 1, rect.y + 1);
  await sleep(500);
  return true;
}

async function altUp(win) {
  await win.keyboard.up('Alt');
  await sleep(250);
}

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-pos');
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

  // ---------- B4：relative 显示原文档流位置 ----------
  const rel = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const before = new Set((st.scene.root.children || []).map((c) => c.id));
    st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    // 用"新增了谁"来定位，别信 addElement 的返回值
    const fresh = kids.find((c) => !before.has(c.id)) || kids[kids.length - 1];
    if (!fresh) return null;
    s2.updateStyle(fresh.id, {
      position: 'relative', left: '48px', top: '32px',
      width: '220px', height: '90px', backgroundColor: '#dbeafe'
    });
    window.__sceneStore.getState().selectElement(fresh.id);
    return fresh.id;
  });
  await sleep(700);

  const hovered = await altHoverOn(win, rel);
  // 一次快照同时取"幽灵框"和"元素矩形" —— 分两次 evaluate 中间浮层可能已被清掉
  const ghost = await win.evaluate((tid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${tid}"]`);
    const g = document.querySelector('.bc-boxm-ghost');
    const er = el ? el.getBoundingClientRect() : null;
    const gr = g ? g.getBoundingClientRect() : null;
    return {
      ghost: !!g,
      boxm: !!document.querySelector('.bc-boxm'),
      label: g ? (g.querySelector('em')?.textContent || '').trim() : '',
      dx: gr && er ? Math.round(er.left - gr.left) : null,
      dy: gr && er ? Math.round(er.top - gr.top) : null
    };
  }, rel);
  console.log('DEBUG relative:', JSON.stringify(ghost));
  check('relative 元素显示"原文档流位置"幽灵框', hovered && ghost.ghost, ghost.ghost ? `标签=${ghost.label}` : `未找到（boxm=${ghost.boxm}）`);
  check('幽灵框位置 = 当前位置减去偏移（left 48 / top 32）',
    ghost.ghost && Math.abs(ghost.dx - 48) <= 2 && Math.abs(ghost.dy - 32) <= 2,
    ghost.ghost ? `dx=${ghost.dx} dy=${ghost.dy}` : '');

  // ---------- B6：margin:auto 显示 auto ----------
  // 放在 fixed 元素上测：fixed + margin:auto 同样会被 computed 算成像素，能验证"回场景读 auto"
  await altUp(win);

  // ---------- B3：fixed 显示四边偏移 ----------
  const fix = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const before = new Set((st.scene.root.children || []).map((c) => c.id));
    st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    const fresh = kids.find((c) => !before.has(c.id)) || kids[kids.length - 1];
    if (!fresh) return null;
    s2.updateStyle(fresh.id, {
      position: 'fixed', top: '24px', left: '36px',
      width: '180px', height: '70px', backgroundColor: '#fde68a',
      marginLeft: 'auto', marginRight: 'auto'
    });
    window.__sceneStore.getState().selectElement(fresh.id);
    return fresh.id;
  });
  await sleep(700);
  await altHoverOn(win, fix);
  const insets = await win.evaluate(() =>
    [...document.querySelectorAll('.bc-boxm-inset')].map((e) => (e.textContent || '').trim())
  );
  check('fixed 元素在画布上显示四边偏移', insets.length >= 2, insets.join(' | ') || '未找到 .bc-boxm-inset');
  // 拖动会改掉 6px 左右，所以用容差判断
  const topOk = insets.some((t) => { const m = /top\s+(-?\d+)px/.exec(t); return m && Math.abs(Number(m[1]) - 24) <= 12; });
  const leftOk = insets.some((t) => { const m = /left\s+(-?\d+)px/.exec(t); return m && Math.abs(Number(m[1]) - 36) <= 12; });
  check('偏移标签带真实数值（top≈24px / left≈36px）', topOk && leftOk, insets.join(' | '));

  const autoLabel = await win.evaluate(() =>
    [...document.querySelectorAll('.bc-boxm-num')].map((e) => (e.textContent || '').trim())
  );
  check('margin:auto 在画布上显示 auto（而不是算出来的像素）',
    autoLabel.some((t) => t === 'auto'), autoLabel.join(' | ') || '无数字标签');
  await altUp(win);

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
