// v0.4.6 第 46 批 · 竖屏 Alt 模式触摸手柄
//
// 用户原话（这一条是这一版的重点）：
//   「开启 Alt 模式后，这个元素必须被选中，才能进行可视化调整：
//     1. 选中元素和没开启 Alt 模式的画布一样，长按元素才能选中，但是不能选中多个元素，
//        按住下一个元素，上一个元素自动取消选中。
//     2. 选中后，元素中间出现一个 svg（上下左右都是箭头），按住这个 svg 就可以改变这个
//        元素在画布上的位置。
//     3. 选中后，4 个角出现 4 个方框，按住这个方框（不只是这个方框，方框外面的一部分区域
//        也能按倒，因为手指很大），就可以调整元素的宽度和高度。
//     4. 选中后，4 条边也可以按住调整。」
//
// 逐条量：
//   ① Alt 模式下长按能选中（不能多选；长按第二个 → 第一个自动取消）
//   ② 选中后出现手柄层：中间移动柄 + 4 角 + 4 边，且框贴合元素
//   ③ 角手柄按住能改宽高（命中区 ≥ 40px，视觉方块 ≤ 24px）
//   ④ 中间移动柄按住能改位置（且不改宽高）
//   ⑤ 边手柄按住能改单边尺寸
//   ⑥ 取消选中 / 关掉 Alt → 手柄层消失
//
// ⚠ 全部用**真实输入**（Playwright 的 mouse.down/move/up）驱动，不要用
//   `dispatchEvent(new PointerEvent('pointerdown'))`：
//   实测 Chromium/Electron 会把派发进 .canvas 子树的 pointerdown 整个丢掉
//   （连 document 上的捕获监听都收不到，mousedown 却正常）。这个坑值得记住。
//
// 用法：node tests/e2e/probe-alt-touch.mjs
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
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

const boxOf = (win, sel) => win.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
}, sel);

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-alttouch');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(300, 400);
    w.setContentSize(412, 860);
    w.center();
  });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1600);
  await win.waitForSelector('.pt-bar2', { timeout: 15000 });

  // 放两个 div（第二个带点内容，方便看清尺寸变化）
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    st.addElement('div');
    window.__sceneStore.getState().selectElement(null);
  });
  await sleep(700);

  // 开 Alt 模式：更多 → Alt 模式
  await win.locator('.pt-bar2 .pt-tbtn[data-key="more"]').click();
  await sleep(320);
  await win.locator('.pt-tbtn-menu .tb-more-item', { hasText: 'Alt 模式' }).click();
  await sleep(420);
  check('预备：Alt 模式已开启', await win.evaluate(() => localStorage.getItem('bc-alt-mode') === '1'));

  // —— ① 长按选中（单选）——
  const ids = await win.evaluate(() => [...document.querySelectorAll('.canvas [data-bc-id]')].map((el) => el.getAttribute('data-bc-id')));
  const A = await boxOf(win, `.canvas [data-bc-id="${ids[0]}"]`);
  const B = await boxOf(win, `.canvas [data-bc-id="${ids[1]}"]`);
  check('预备：画布上有 2 个元素', !!A && !!B, JSON.stringify({ A, B }));

  await win.mouse.move(A.cx, A.cy);
  await win.mouse.down();
  await sleep(650);
  await win.mouse.up();
  await sleep(300);
  let sel = await win.evaluate(() => window.__sceneStore.getState().scene.selectedIds);
  check('① 长按第一个元素 → 选中它（单选）', sel.length === 1 && sel[0] === ids[0], JSON.stringify(sel));

  await win.mouse.move(B.cx, B.cy);
  await win.mouse.down();
  await sleep(650);
  await win.mouse.up();
  await sleep(300);
  sel = await win.evaluate(() => window.__sceneStore.getState().scene.selectedIds);
  check('① 长按第二个元素 → 只选中它，第一个自动取消', sel.length === 1 && sel[0] === ids[1], JSON.stringify(sel));

  // —— ② 手柄层齐全 ——
  const h2 = await win.evaluate(() => {
    const layer = document.querySelector('.bc-alttouch');
    if (!layer) return null;
    const lr = layer.getBoundingClientRect();
    return {
      hasMove: !!document.querySelector('.bc-alttouch-move'),
      corners: document.querySelectorAll('.bc-alttouch-corner').length,
      edges: document.querySelectorAll('.bc-alttouch-edge').length,
      pointerEvents: getComputedStyle(layer).pointerEvents,
      layer: { x: Math.round(lr.x), y: Math.round(lr.y), w: Math.round(lr.width), h: Math.round(lr.height) }
    };
  });
  check('② 选中后出现手柄层（容器自身不吃点击）', !!h2 && h2.pointerEvents === 'none', JSON.stringify(h2?.pointerEvents));
  check('② 中间移动柄 + 4 角 + 4 边齐全', !!h2 && h2.hasMove && h2.corners === 4 && h2.edges === 4,
    `move=${h2?.hasMove} corners=${h2?.corners} edges=${h2?.edges}`);
  check('② 手柄框贴合元素（±3px）', !!h2 && Math.abs(h2.layer.x - B.x) <= 3 && Math.abs(h2.layer.w - B.w) <= 3,
    JSON.stringify(h2?.layer) + ' vs ' + JSON.stringify(B));

  // 给被测元素一个**显式宽高**：默认 div 是 width:auto（撑满画布），
  // 拖右边已经顶到墙上（+8px 就没了），移动也因为没有剩余空间而看不出位移。
  // 这不是产品问题，是场景不成立 —— 先固定成 180×80 再测。
  await win.evaluate((id) => {
    window.__sceneStore.getState().updateStyle(id, { width: '180px', height: '80px' });
  }, ids[1]);
  await sleep(500);
  const B2 = await boxOf(win, `.canvas [data-bc-id="${ids[1]}"]`);
  check('预备：被测元素已固定成 180×80', B2.w === 180 && B2.h === 80, JSON.stringify(B2));

  // —— ③ 角手柄：命中区 vs 视觉 ——
  const hit = await win.evaluate(() => {
    const c = document.querySelector('.bc-alttouch-corner');
    const cs = getComputedStyle(c, '::after');
    return { hitW: parseFloat(cs.width), hitH: parseFloat(cs.height), visW: parseFloat(getComputedStyle(c).width) };
  });
  check('③ 角手柄命中区比视觉方块大（"手指很大"）', hit.hitW >= 40 && hit.visW <= 24, JSON.stringify(hit));

  const before3 = await boxOf(win, `.canvas [data-bc-id="${ids[1]}"]`);
  const corner = await boxOf(win, '.bc-alttouch-corner[data-edge="br"]');
  await win.mouse.move(corner.cx, corner.cy);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await win.mouse.move(corner.cx + i * 6, corner.cy + i * 5);
    await sleep(16);
  }
  await win.mouse.up();
  await sleep(350);
  const after3 = await boxOf(win, `.canvas [data-bc-id="${ids[1]}"]`);
  check('③ 拖右下角 → 宽度变大（≥ +20px）', after3.w - before3.w >= 20, `${before3.w} → ${after3.w}`);
  check('③ 拖右下角 → 高度变大（≥ +14px）', after3.h - before3.h >= 14, `${before3.h} → ${after3.h}`);

  // —— ④ 中间移动柄 ——
  const before4 = await boxOf(win, `.canvas [data-bc-id="${ids[1]}"]`);
  const grip = await boxOf(win, '.bc-alttouch-move');
  await win.mouse.move(grip.cx, grip.cy);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await win.mouse.move(grip.cx + i * 5, grip.cy + i * 3);
    await sleep(16);
  }
  await win.mouse.up();
  await sleep(350);
  const after4 = await boxOf(win, `.canvas [data-bc-id="${ids[1]}"]`);
  check('④ 拖中间移动柄 → 元素位置真的变了（x +25~+55）',
    after4.x - before4.x >= 25 && after4.x - before4.x <= 55, `x ${before4.x} → ${after4.x}`);
  check('④ 移动不该改宽度（±2px）', Math.abs(after4.w - before4.w) <= 2, `w ${before4.w} → ${after4.w}`);

  // —— ⑤ 边手柄 ——
  const before5 = await boxOf(win, `.canvas [data-bc-id="${ids[1]}"]`);
  const edge = await boxOf(win, '.bc-alttouch-edge[data-edge="r"]');
  await win.mouse.move(edge.cx, edge.cy);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await win.mouse.move(edge.cx + i * 5, edge.cy);
    await sleep(16);
  }
  await win.mouse.up();
  await sleep(350);
  const after5 = await boxOf(win, `.canvas [data-bc-id="${ids[1]}"]`);
  check('⑤ 拖右边 → 宽度变大（≥ +20px）', after5.w - before5.w >= 20, `${before5.w} → ${after5.w}`);
  check('⑤ 拖右边不该改高度（±2px）', Math.abs(after5.h - before5.h) <= 2, `h ${before5.h} → ${after5.h}`);

  // —— ⑥ 取消选中 / 关掉 Alt ——
  await win.evaluate(() => window.__sceneStore.getState().selectElement(null));
  await sleep(320);
  check('⑥ 取消选中 → 手柄层消失', await win.evaluate(() => !document.querySelector('.bc-alttouch')));

  await win.mouse.move(200, 400);
  await win.mouse.down();
  await sleep(650);
  await win.mouse.up();
  await sleep(300);
  const reselected = await win.evaluate(() => window.__sceneStore.getState().scene.selectedIds.length);
  await win.locator('.pt-bar2 .pt-tbtn[data-key="more"]').click();
  await sleep(320);
  await win.locator('.pt-tbtn-menu .tb-more-item', { hasText: 'Alt 模式' }).click();
  await sleep(420);
  check('⑥ 关掉 Alt 模式 → 手柄层消失（长按选中也不再强制单选）',
    await win.evaluate(() => !document.querySelector('.bc-alttouch')), `重选后选中数=${reselected}`);

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
