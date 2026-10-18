// 画布 Alt 交互探针（v0.4.4e）
// 覆盖：块级贴边改大小 / 行内元素不 resize（走改字号）/ 角光标方向 / fixed 被关在画布内 /
//      非 fixed 可以往下拖（不受画布底限制）/ Alt+滚轮缩放
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
  const DATA_DIR = resolve(tmpdir(), 'bc-alt-probe');
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  mkdirSync(DATA_DIR, { recursive: true });
  for (const rel of [resolve(ROOT, 'extensions'), resolve(ROOT, 'data', 'extensions')]) {
    if (existsSync(rel)) cpSync(rel, resolve(DATA_DIR, 'extensions'), { recursive: true });
  }
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1500);

  const rectOf = (id) => win.evaluate((eid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, id);

  // ============ 1. 块级元素：贴右边 → ew-resize；拖动 → 变宽 ============
  const id = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'd1', type: 'div', style: { width: '200px', height: '80px', backgroundColor: '#e8eefc' }, children: [] }, null);
    return window.__sceneStore.getState().scene.selectedId;
  });
  await sleep(400);
  const r1 = await rectOf(id);
  await win.keyboard.down('Alt');
  await win.mouse.move(r1.x + r1.w - 2, r1.y + r1.h / 2);
  await sleep(250);
  const attrX = await win.evaluate((eid) => document.querySelector(`.canvas [data-bc-id="${eid}"]`)?.getAttribute('data-bc-alt'), id);
  ok('块级贴右边 → 左右拉伸光标', attrX === 'x', String(attrX));

  await win.mouse.down();
  await win.mouse.move(r1.x + r1.w + 60, r1.y + r1.h / 2, { steps: 10 });
  await win.mouse.up();
  await sleep(300);
  const w2 = await win.evaluate((eid) => parseFloat(window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid).style.width), id);
  ok('贴右边拖动 → 宽度变大', w2 > 240, String(w2));

  // 左下角光标应是 nesw（右上-左下）
  const r1b = await rectOf(id);
  await win.mouse.move(r1b.x + 2, r1b.y + r1b.h - 2);
  await sleep(250);
  const attrBL = await win.evaluate((eid) => document.querySelector(`.canvas [data-bc-id="${eid}"]`)?.getAttribute('data-bc-alt'), id);
  ok('左下角光标 = nesw（右上-左下）', attrBL === 'nesw', String(attrBL));
  // 左上角 = nwse
  await win.mouse.move(r1b.x + 2, r1b.y + 2);
  await sleep(250);
  const attrTL = await win.evaluate((eid) => document.querySelector(`.canvas [data-bc-id="${eid}"]`)?.getAttribute('data-bc-alt'), id);
  ok('左上角光标 = nwse（左上-右下）', attrTL === 'nwse', String(attrTL));

  // ============ 2. 行内元素：不 resize（走改字号） ============
  const sid = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 's1', type: 'span', text: '行内文字', style: {}, children: [] }, null);
    return window.__sceneStore.getState().scene.selectedId;
  });
  await sleep(400);
  const rs = await rectOf(sid);
  await win.mouse.move(rs.x + 2, rs.y + rs.h / 2); // 贴左边
  await sleep(250);
  const attrSpan = await win.evaluate((eid) => document.querySelector(`.canvas [data-bc-id="${eid}"]`)?.getAttribute('data-bc-alt'), sid);
  ok('行内元素贴边也不进入 resize（是 font 模式）', attrSpan === 'font', String(attrSpan));

  // ============ 3. 非 fixed：可以一直往下拖（不受画布底限制） ============
  const r2 = await rectOf(id);
  const beforeTop = await win.evaluate((eid) => document.querySelector(`.canvas [data-bc-id="${eid}"]`).getBoundingClientRect().top, id);
  await win.mouse.move(r2.x + r2.w / 2, r2.y + r2.h / 2);
  await sleep(150);
  await win.mouse.down();
  await win.mouse.move(r2.x + r2.w / 2, r2.y + r2.h / 2 + 700, { steps: 12 });
  await win.mouse.up();
  await sleep(300);
  const afterTop = await win.evaluate((eid) => document.querySelector(`.canvas [data-bc-id="${eid}"]`).getBoundingClientRect().top, id);
  ok('常规流元素能一直往下拖（位移 ≈ 700）', Math.abs((afterTop - beforeTop) - 700) < 80, `${beforeTop} → ${afterTop}`);

  // ============ 4. fixed：被关在画布内 ============
  const fid = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'f1', type: 'div', style: { position: 'fixed', left: '20px', top: '20px', width: '120px', height: '60px', backgroundColor: '#ffe0e0' }, children: [] }, null);
    return window.__sceneStore.getState().scene.selectedId;
  });
  await sleep(400);
  const rf = await rectOf(fid);
  await win.mouse.move(rf.x + rf.w / 2, rf.y + rf.h / 2);
  await sleep(150);
  await win.mouse.down();
  await win.mouse.move(rf.x + 1600, rf.y + 1600, { steps: 14 });
  await win.mouse.up();
  await sleep(300);
  const confined = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    const c = document.querySelector('.canvas');
    const cr = c.getBoundingClientRect();
    const er = document.querySelector(`.canvas [data-bc-id="${eid}"]`).getBoundingClientRect();
    return {
      left: parseFloat(n.style.left), top: parseFloat(n.style.top),
      inside: er.right <= cr.right + 2 && er.bottom <= cr.bottom + 2 && er.left >= cr.left - 2 && er.top >= cr.top - 2,
      canvasW: c.clientWidth, canvasH: c.clientHeight
    };
  }, fid);
  ok('fixed 元素被关在画布内（不会飘到面板上）', confined.inside === true, JSON.stringify(confined));

  // ============ 4b. 外边距/内边距也算进"墙"里 ============
  const mid = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'm1', type: 'div', style: { width: '100px', height: '40px', marginLeft: '30px', marginTop: '10px', backgroundColor: '#dff2e6' }, children: [] }, null);
    return window.__sceneStore.getState().scene.selectedId;
  });
  await sleep(400);
  const rm = await rectOf(mid);
  await win.mouse.move(rm.x + rm.w / 2, rm.y + rm.h / 2);
  await sleep(150);
  await win.mouse.down();
  await win.mouse.move(rm.x - 900, rm.y - 600, { steps: 14 }); // 往左上猛拖
  await win.mouse.up();
  await sleep(300);
  const mv = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    const pr = el.parentElement.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return { ml: parseFloat(n.style.marginLeft || '0'), mt: parseFloat(n.style.marginTop || '0'), insideLeft: er.left >= pr.left - 2, insideTop: er.top >= pr.top - 2 };
  }, mid);
  ok('margin 被算进墙里（不会拖出父容器）', mv.insideLeft && mv.insideTop && mv.ml >= -1 && mv.mt >= -1, JSON.stringify(mv));

  await win.keyboard.up('Alt');

  // ============ 4c. 拖动时显示"可达边界"提示线（v0.4.4h）============
  await win.keyboard.down('Alt');
  // 前面的用例把元素拖到画布很下面了 → 先滚回可视区，否则鼠标移不过去
  await win.evaluate((eid) => {
    document.querySelector(`.canvas [data-bc-id="${eid}"]`)?.scrollIntoView({ block: 'center' });
  }, id);
  await sleep(400);
  const r3 = await rectOf(id);
  await win.mouse.move(r3.x + r3.w / 2, r3.y + r3.h / 2);
  await sleep(200);
  await win.mouse.down();
  await win.mouse.move(r3.x + r3.w / 2 - 8, r3.y + r3.h / 2 + 40, { steps: 6 });
  await sleep(220);
  const hints = await win.locator('.bc-wall-hint').count();
  ok('Alt 拖动时显示"可达边界"提示线（内边距/外边距）', hints > 0, 'count=' + hints);

  // v0.4.5：F12 式盒模型（四层盒 + 定位方式）
  const bm = await win.evaluate(() => ({
    count: document.querySelectorAll('.bc-boxm').length,
    layers: ['.is-margin', '.is-border', '.is-padding', '.is-content']
      .filter((s) => !!document.querySelector('.bc-boxm ' + s)).length,
    pos: (document.querySelector('.bc-boxm-pos')?.textContent || '').trim(),
    nums: document.querySelectorAll('.bc-boxm-num').length
  }));
  ok('Alt 拖动时显示 F12 式盒模型（四层）', bm.count === 1 && bm.layers === 4, JSON.stringify(bm));
  ok('盒模型中央显示定位方式', /常规流|相对定位|绝对定位|固定定位/.test(bm.pos), bm.pos);
  ok('盒模型标出了边距数值', bm.nums > 0, 'nums=' + bm.nums);

  await win.mouse.up();
  await sleep(250);
  const hintsGone = await win.locator('.bc-wall-hint').count();
  ok('松手后边界提示线消失', hintsGone === 0, 'count=' + hintsGone);
  ok('松手后盒模型消失', (await win.locator('.bc-boxm').count()) === 0);

  // ============ 4d. 「撞墙继续拖 → 改父子关系」已按用户要求停用（v0.4.5）============
  // 旧行为：撞墙后继续往外拖 56px 会进入"拿着元素"模式，悬停目标 1 秒后松开即换父级。
  // 新行为：ALT_REPARENT_ENABLED=false → 拖到墙边就停住，永远不进入该模式。
  const cid = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'c1', type: 'div', style: { width: '320px', height: '160px', padding: '20px', backgroundColor: '#eef7ff' }, children: [] }, null);
    return window.__sceneStore.getState().scene.selectedId;
  });
  await sleep(350);
  const e2 = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'e2', type: 'div', text: '待搬运', style: { width: '100px', height: '40px', backgroundColor: '#ffe9c9' }, children: [] }, null);
    return window.__sceneStore.getState().scene.selectedId;
  });
  await sleep(400);
  await win.evaluate((c) => {
    document.querySelector(`.canvas [data-bc-id="${c}"]`)?.scrollIntoView({ block: 'center' });
  }, cid);
  await sleep(400);
  const rc = await rectOf(cid);
  const re2 = await rectOf(e2);
  console.log('   [diag] viewport=' + JSON.stringify(win.viewportSize()) + ' c1=' + JSON.stringify(rc) + ' e2=' + JSON.stringify(re2));
  await win.mouse.move(re2.x + re2.w / 2, re2.y + re2.h / 2);
  await sleep(200);
  await win.mouse.down();
  await win.mouse.move(re2.x + re2.w / 2 - 130, re2.y + re2.h / 2, { steps: 8 }); // 撞墙后继续往外
  await sleep(250);
  const reparenting = await win.evaluate(() => document.body.classList.contains('bc-reparenting'));
  ok('撞墙后继续往外拖 → 不再进入"改父子关系"模式', reparenting === false, String(reparenting));
  const faded = await win.evaluate((eid) => !!document.querySelector(`.canvas [data-bc-id="${eid}"][data-bc-drag-src="1"]`), e2);
  ok('被拖元素不会淡化（不再有"拿在手上"状态）', faded === false, String(faded));

  await win.mouse.move(rc.x + rc.w / 2, rc.y + rc.h / 2, { steps: 8 });
  await sleep(300);
  const dropBox = await win.locator('.bc-drop-into').count();
  ok('移到容器上方也不会出现"放入此元素"高亮', dropBox === 0, 'count=' + dropBox);

  await win.mouse.up();
  await sleep(450);
  const parentOk = await win.evaluate(([eid, c]) => {
    const st = window.__sceneStore.getState();
    const find = (n, id) => (n.id === id ? n : (n.children || []).reduce((a, k) => a || find(k, id), null));
    const container = find(st.scene.root, c);
    return !!container && container.children.some((k) => k.id === eid);
  }, [e2, cid]);
  ok('松开后元素仍在原来的父级（不会偷偷改层级）', parentOk === false, String(parentOk));
  await win.keyboard.up('Alt');

  // ============ 4e. relative 元素：盒模型显示「相对定位」+ 偏移距离箭头（v0.4.5）============
  const rid = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    const id = window.__sceneStore.getState().scene.selectedId;
    st.updateStyle(id, {
      position: 'relative', left: '0px', top: '0px',
      width: '160px', height: '60px', backgroundColor: '#fff3cd'
    });
    return id;
  });
  await sleep(400);
  await win.evaluate((e) => {
    document.querySelector(`.canvas [data-bc-id="${e}"]`)?.scrollIntoView({ block: 'center' });
  }, rid);
  await sleep(300);
  const rRel = await rectOf(rid);
  await win.keyboard.down('Alt');
  await win.mouse.move(rRel.x + rRel.w / 2, rRel.y + rRel.h / 2);
  await sleep(220);
  await win.mouse.down();
  await win.mouse.move(rRel.x + rRel.w / 2 + 32, rRel.y + rRel.h / 2 + 18, { steps: 6 });
  await sleep(320);
  const relBm = await win.evaluate(() => ({
    pos: (document.querySelector('.bc-boxm-pos')?.textContent || '').trim(),
    dist: document.querySelectorAll('.bc-boxm-dist').length,
    distText: Array.from(document.querySelectorAll('.bc-boxm-dist em')).map((n) => n.textContent).join(' / ')
  }));
  ok('relative 拖动：盒模型中央显示「相对定位」', /相对定位/.test(relBm.pos), relBm.pos);
  ok('relative 拖动：出现偏移距离箭头', relBm.dist >= 1 && /left|top/.test(relBm.distText), JSON.stringify(relBm));
  await win.mouse.up();
  await win.keyboard.up('Alt');

  // ============ 4f. Alt 时隐藏"已选中"的橙色框（避免两个橙框混淆）============
  await win.evaluate((e) => window.__sceneStore.getState().selectElement(e), id);
  await sleep(300);
  await win.keyboard.down('Alt');
  await sleep(250);
  const selOutline = await win.evaluate(() => {
    const el = document.querySelector('.canvas [data-bc-sel="1"]');
    return el ? getComputedStyle(el).outlineStyle : 'none';
  });
  ok('按住 Alt：选中框隐藏（outline: none）', selOutline === 'none', String(selOutline));
  await win.keyboard.up('Alt');

  // ============ 4g. Alt 拖动自动加长画布、松手恢复 ============
  const tallId = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    const x = window.__sceneStore.getState().scene.selectedId;
    st.updateStyle(x, { minHeight: '1800px', backgroundColor: '#eef7ff' });
    return x;
  });
  await sleep(400);
  await win.evaluate((e) => document.querySelector(`.canvas [data-bc-id="${e}"]`)?.scrollIntoView({ block: 'start' }), tallId);
  await sleep(400);
  const rt = await rectOf(tallId);
  const pad0 = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas')).paddingBottom);
  await win.keyboard.down('Alt');
  await win.mouse.move(rt.x + rt.w / 2, rt.y + 30);
  await sleep(200);
  await win.mouse.down();
  await win.mouse.move(rt.x + rt.w / 2, rt.y + 30 + 620, { steps: 10 });
  await sleep(300);
  const padDuring = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas')).paddingBottom);
  ok('Alt 往下拖：画布自动加长（padding-bottom > 0）', parseFloat(padDuring) > 0, `${pad0} → ${padDuring}`);
  await win.mouse.up();
  await sleep(350);
  const padAfter = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas')).paddingBottom);
  ok('松手后画布长度恢复', Math.abs(parseFloat(padAfter) - parseFloat(pad0)) < 0.5, `${pad0} → ${padAfter}`);
  await win.keyboard.up('Alt');

  // ============ 4h. Alt 拖动中：滚轮改为上下滚动（不缩放）============
  await win.evaluate((e) => document.querySelector(`.canvas [data-bc-id="${e}"]`)?.scrollIntoView({ block: 'start' }), tallId);
  await sleep(300);
  const rt2 = await rectOf(tallId);
  await win.keyboard.down('Alt');
  await win.mouse.move(rt2.x + rt2.w / 2, rt2.y + 30);
  await sleep(200);
  await win.mouse.down();
  await win.mouse.move(rt2.x + rt2.w / 2 + 10, rt2.y + 50, { steps: 4 });
  await sleep(200);
  const wheel0 = await win.evaluate(() => ({
    top: document.querySelector('.canvas-wrap').scrollTop,
    width: document.querySelector('.canvas').getBoundingClientRect().width
  }));
  await win.mouse.wheel(0, 260);
  await sleep(350);
  const wheel1 = await win.evaluate(() => ({
    top: document.querySelector('.canvas-wrap').scrollTop,
    width: document.querySelector('.canvas').getBoundingClientRect().width
  }));
  ok('Alt 拖动中：滚轮上下滚动画布', wheel1.top > wheel0.top + 20, `${wheel0.top} → ${wheel1.top}`);
  ok('Alt 拖动中：滚轮不再缩放画布', Math.abs(wheel1.width - wheel0.width) < 0.5, `${wheel0.width} → ${wheel1.width}`);
  await win.mouse.up();
  await win.keyboard.up('Alt');

  // ============ 4i. fixed 贴到画布底边 → 归一化成 bottom: 0 ============
  const fid2 = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    const x = window.__sceneStore.getState().scene.selectedId;
    st.updateStyle(x, {
      position: 'fixed', left: '40px', top: '20px',
      width: '120px', height: '60px', backgroundColor: '#ffe0e0'
    });
    return x;
  });
  await sleep(400);
  // fixed 是相对画布视口定位的：先把画布滚回顶部，否则它可能不在可视区里
  await win.evaluate(() => { const w = document.querySelector('.canvas-wrap'); if (w) w.scrollTop = 0; });
  await sleep(350);
  const rf2 = await rectOf(fid2);
  const cvr = await win.evaluate(() => {
    const r = document.querySelector('.canvas').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
  await win.keyboard.down('Alt');
  await win.mouse.move(rf2.x + rf2.w / 2, rf2.y + rf2.h / 2);
  await sleep(200);
  await win.mouse.down();
  await win.mouse.move(rf2.x + rf2.w / 2, cvr.bottom - 10, { steps: 10 });
  await sleep(250);
  await win.mouse.up();
  await win.keyboard.up('Alt');
  await sleep(400);
  const fixedStyle = await win.evaluate((e) => {
    const find = (n, id) => (n.id === id ? n : (n.children || []).reduce((a, k) => a || find(k, id), null));
    return find(window.__sceneStore.getState().scene.root, e)?.style || {};
  }, fid2);
  ok('fixed 拖到画布底边 → 写成 bottom: 0（而不是 top 绝对值）',
    fixedStyle.bottom === '0px' && (fixedStyle.top === undefined || fixedStyle.top === ''),
    JSON.stringify({ top: fixedStyle.top, bottom: fixedStyle.bottom }));

  // ============ 4j. relative 拖到父容器中线 → margin-left/right: auto ============
  const rid2 = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    const x = window.__sceneStore.getState().scene.selectedId;
    st.updateStyle(x, {
      position: 'relative', left: '0px', top: '0px',
      width: '160px', height: '50px', backgroundColor: '#fff3cd'
    });
    return x;
  });
  await sleep(400);
  await win.evaluate((e) => document.querySelector(`.canvas [data-bc-id="${e}"]`)?.scrollIntoView({ block: 'center' }), rid2);
  await sleep(350);
  const rr2 = await rectOf(rid2);
  const parentBox = await win.evaluate(() => {
    const r = document.querySelector('.canvas').getBoundingClientRect();
    return { left: r.left, width: r.width };
  });
  const targetCenter = parentBox.left + parentBox.width / 2;
  const dx = targetCenter - (rr2.x + rr2.w / 2);
  await win.keyboard.down('Alt');
  await win.mouse.move(rr2.x + rr2.w / 2, rr2.y + rr2.h / 2);
  await sleep(200);
  await win.mouse.down();
  await win.mouse.move(rr2.x + rr2.w / 2 + dx, rr2.y + rr2.h / 2, { steps: 10 });
  await sleep(250);
  await win.mouse.up();
  await win.keyboard.up('Alt');
  await sleep(400);
  const relStyle = await win.evaluate((e) => {
    const find = (n, id) => (n.id === id ? n : (n.children || []).reduce((a, k) => a || find(k, id), null));
    return find(window.__sceneStore.getState().scene.root, e)?.style || {};
  }, rid2);
  ok('relative 拖到中线 → 自动用 margin-left/right: auto',
    relStyle.marginLeft === 'auto' && relStyle.marginRight === 'auto' && (relStyle.left === undefined || relStyle.left === ''),
    JSON.stringify({ left: relStyle.left, ml: relStyle.marginLeft, mr: relStyle.marginRight }));

  // ============ 5. Alt + 滚轮 = 缩放 ============
  const z0 = await win.evaluate(() => document.querySelector('.canvas').getBoundingClientRect().width);
  await win.keyboard.down('Alt');
  await win.mouse.move(rf.x + rf.w / 2, rf.y + rf.h / 2);
  await win.mouse.wheel(0, -120);
  await sleep(200);
  await win.mouse.wheel(0, -120);
  await sleep(300);
  await win.keyboard.up('Alt');
  const z1 = await win.evaluate(() => document.querySelector('.canvas').getBoundingClientRect().width);
  ok('Alt + 滚轮能缩放画布', z1 > z0 + 1, `${Math.round(z0)} → ${Math.round(z1)}`);

  ok('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  console.log(`\n===== Alt 交互探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
