// 画布 Alt 交互探针（v0.4.4e）
// 覆盖：块级贴边改大小 / 行内元素不 resize（走改字号）/ 角光标方向 / fixed 被关在画布内 /
//      非 fixed 可以往下拖（不受画布底限制）/ Alt+滚轮缩放
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';
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
  await win.mouse.up();
  await sleep(250);
  const hintsGone = await win.locator('.bc-wall-hint').count();
  ok('松手后边界提示线消失', hintsGone === 0, 'count=' + hintsGone);

  // ============ 4d. 撞墙后继续往外拖 → 快速改父子关系（v0.4.4h）============
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
  ok('撞墙后继续往外拖 → 进入"改父子关系"模式', reparenting === true, String(reparenting));
  const faded = await win.evaluate((eid) => !!document.querySelector(`.canvas [data-bc-id="${eid}"][data-bc-drag-src="1"]`), e2);
  ok('被拖元素进入淡化态', faded === true, String(faded));

  await win.mouse.move(rc.x + rc.w / 2, rc.y + rc.h / 2, { steps: 8 });
  await sleep(300);
  const dropBox = await win.locator('.bc-drop-into').count();
  ok('移到块级元素上方 → 出现"放入此元素"高亮', dropBox === 1, 'count=' + dropBox);

  await win.mouse.up();
  await sleep(450);
  const parentOk = await win.evaluate(([eid, c]) => {
    const st = window.__sceneStore.getState();
    const find = (n, id) => (n.id === id ? n : (n.children || []).reduce((a, k) => a || find(k, id), null));
    const container = find(st.scene.root, c);
    return !!container && container.children.some((k) => k.id === eid);
  }, [e2, cid]);
  ok('松开后元素真的被放进该容器', parentOk === true, String(parentOk));
  await win.keyboard.up('Alt');

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
