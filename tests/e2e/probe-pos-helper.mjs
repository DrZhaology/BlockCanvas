// v0.4.7 · 定位助手在 relative / sticky 下"偏移量"要真的显示出来
//
// 用户原话：`「position: relative; 的时候定位助手里面的偏移量全部不显示了」`
//
// 真因（真 BUG）：.pos-edges 是两列网格（为 absolute/fixed 的四条边设计），
// 而 relative 只渲染**一行** .pos-line（里面两个数字框）—— 它被塞进半格宽，
// 两个 .num-unit-row 各分到几十像素，数字框宽度被压到 0，屏幕上就是"整块消失"。
//
// 这份探针逐条量：
//   ① relative：偏移量那一行存在，且**跨满整行**（宽 ≈ 容器宽）
//   ② relative：两个数字框都可见（宽 ≥ 48px、高 ≥ 20px）
//   ③ relative：输入框真的能输入并写进样式
//   ④ sticky：吸附方向 + 距边多少 两个控件都在且可见
//   ⑤ absolute：仍然是四行（两列网格没被改坏）
//
// 用法：node tests/e2e/probe-pos-helper.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');

const ROOT = process.cwd();
let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-pos-helper');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env
  });
  const win = await app.firstWindow();
  win.setDefaultTimeout(12000);
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  await sleep(1300);
  await win.evaluate(() => {
    const st = window.__tabStore.getState();
    if (st.tabs.length === 0) st.newTab();
  });
  await sleep(500);
  // 选中一个 div
  const id = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const root = window.__sceneStore.getState().scene.root;
    const el = root.children[root.children.length - 1];
    st.selectElement(el.id);
    return el.id;
  });
  await sleep(700);

  /** 把「快捷助手」与「定位助手」都展开（点真实按钮/标题，不走 localStorage） */
  async function openHelper() {
    // ① 「快捷助手」是 ElementPropsBody 里的一个 .inspector-sec-head（title 里写了"快捷助手"）
    const qhHead = win.locator('.inspector-sec-head[title*="快捷助手"]').first();
    const qhVisible = await win.evaluate(() => !!document.querySelector('.quick-helper'));
    if (!qhVisible) {
      await qhHead.click().catch(() => {});
      await sleep(420);
    }
    // ② 定位助手是 .qh-block-toggle（第 2 个 = 定位助手；用文字兜底）
    const toggles = win.locator('.quick-helper .qh-block-toggle');
    const n = await toggles.count();
    for (let i = 0; i < n; i++) {
      const txt = (await toggles.nth(i).textContent()) || '';
      if (/定位/.test(txt)) { await toggles.nth(i).click().catch(() => {}); break; }
    }
    await sleep(460);
  }
  await openHelper();
  // 兜底：直接把两个持久化标记置真，然后重新点一次
  let hasEdges = await win.evaluate(() => !!document.querySelector('.quick-helper .pos-edges'));
  if (!hasEdges) {
    await win.evaluate(() => {
      localStorage.setItem('bc-flag:qh-layout-open', '1');
      localStorage.setItem('bc-flag:qh-position-open', '1');
    });
    await win.evaluate(() => {
      const head = [...document.querySelectorAll('.inspector-sec-head')].find((h) => (h.getAttribute('title') || '').includes('快捷助手'));
      if (!document.querySelector('.quick-helper')) head?.click();
    });
    await sleep(500);
    await win.evaluate(() => {
      const btns = [...document.querySelectorAll('.quick-helper .qh-block-toggle')];
      const b = btns.find((x) => /定位/.test(x.textContent || ''));
      b?.click();
    });
    await sleep(500);
    hasEdges = await win.evaluate(() => !!document.querySelector('.quick-helper .pos-edges'));
  }
  check('准备：定位助手可见（.pos-edges 存在）', hasEdges === true);

  const setPos = async (v) => {
    await win.evaluate((val) => {
      const st = window.__sceneStore.getState();
      const s = st.scene;
      st.updateStyle(s.selectedIds[0] ?? s.selectedId, {
        position: val,
        ...(val === 'relative' ? { left: '0px', top: '0px' } : {})
      });
    }, v);
    await sleep(500);
  };

  // ── ① relative：偏移量一行要跨满整行 ─────────────────────────────────────
  await setPos('relative');
  const rel = await win.evaluate(() => {
    const edges = document.querySelector('.quick-helper .pos-edges');
    const lines = [...document.querySelectorAll('.quick-helper .pos-edges .pos-line')];
    const rows = [...document.querySelectorAll('.quick-helper .pos-edges .num-unit-row')];
    const R = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      edgesW: edges ? Math.round(edges.getBoundingClientRect().width) : 0,
      cols: edges ? getComputedStyle(edges).gridTemplateColumns : null,
      lineCount: lines.length,
      lineText: lines[0]?.textContent?.trim() ?? null,
      lineRect: lines[0] ? R(lines[0]) : null,
      rows: rows.map(R),
      // 数字框本身（不是 .num-unit-row 容器）
      inputs: [...document.querySelectorAll('.quick-helper .pos-edges .num-unit-num')].map(R)
    };
  });
  check('① relative 只有一行（偏移量）', rel.lineCount === 1 && /偏移量/.test(rel.lineText || ''),
    `n=${rel.lineCount} text=${rel.lineText}`);
  check('① 这一行跨满整行（宽 ≈ 容器宽，不再只占半格）',
    Boolean(rel.lineRect) && rel.lineRect.w >= rel.edgesW - 24,
    `line=${rel.lineRect?.w} edges=${rel.edgesW} cols=${rel.cols}`);

  // ── ② 两个数字框都可见 ─────────────────────────────────────────────────
  check('② relative 有两个数字框', rel.rows.length === 2, `n=${rel.rows.length}`);
  check('② 两个数字框都真的可见（宽 ≥ 48、高 ≥ 20）',
    rel.inputs.length === 2 && rel.inputs.every((r) => r.w >= 48 && r.h >= 20),
    JSON.stringify(rel.inputs));

  // ── ③ 能输入并写进样式 ─────────────────────────────────────────────────
  const firstInput = win.locator('.quick-helper .pos-edges .num-unit-num').first();
  await firstInput.click();
  await firstInput.fill('24');
  await win.keyboard.press('Enter');
  await sleep(420);
  const wrote = await win.evaluate((eid) => {
    const node = (function find(n) {
      const st = window.__sceneStore.getState().scene;
      const walk = (x) => (x.id === eid ? x : (x.children || []).map(walk).find(Boolean));
      return walk(st.root);
    })(eid);
    return node?.style?.left ?? null;
  }, id);
  check('③ 输入 24 后真的写进了 left', /^24/.test(String(wrote || '')), `left=${wrote}`);

  // ── ④ sticky：两个控件都在 ─────────────────────────────────────────────
  await setPos('sticky');
  const sticky = await win.evaluate(() => {
    const box = document.querySelector('.quick-helper .pos-edges .pos-sticky-box');
    const lines = [...document.querySelectorAll('.quick-helper .pos-edges .pos-line')];
    const btn = [...document.querySelectorAll('.quick-helper .pos-edges .pos-corner-btn')];
    const inp = document.querySelector('.quick-helper .pos-edges .num-unit-num');
    const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
    return { boxExists: !!box, lineCount: lines.length, btns: btn.length, inp: R(inp) };
  });
  check('④ sticky 有「吸附方向 + 距边多少」两块', sticky.boxExists && sticky.lineCount === 2, JSON.stringify(sticky));
  check('④ sticky 的两个方向按钮 + 数字框都可见',
    sticky.btns === 2 && Boolean(sticky.inp) && sticky.inp.w >= 48 && sticky.inp.h >= 20,
    JSON.stringify(sticky));

  // ── ⑤ absolute：仍然四行（两列网格没被改坏）──────────────────────────────
  await setPos('absolute');
  const abs = await win.evaluate(() => {
    const lines = [...document.querySelectorAll('.quick-helper .pos-edges .pos-line')];
    const edges = document.querySelector('.quick-helper .pos-edges');
    const R = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width) }; };
    return {
      lineCount: lines.length,
      edgesW: edges ? Math.round(edges.getBoundingClientRect().width) : 0,
      cols: edges ? getComputedStyle(edges).gridTemplateColumns : null,
      widths: lines.map(R)
    };
  });
  check('⑤ absolute 仍是四行（上/右/下/左，一行一条边）', abs.lineCount === 4, `n=${abs.lineCount}`);
  check('⑤ absolute 每行都跨满整行（27 号分片定的"一根轴一行"模型没被改坏）',
    abs.widths.every((r) => r.w >= abs.edgesW - 24),
    `cols=${abs.cols} edges=${abs.edgesW} widths=${JSON.stringify(abs.widths)}`);

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
