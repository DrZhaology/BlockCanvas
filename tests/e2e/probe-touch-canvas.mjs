// v0.4.6 · 竖屏画布触屏手势（用户：一滑就选中 / 选中只能长按 / 长按多选 / 单指平移 / 双指缩放）
//
// 这个探针全部用**合成 PointerEvent** 驱动（pointerType: 'touch'），不依赖真机：
// 手势层是纯 window 监听，合成的指针事件走的就是同一条路径。
//
// 七条契约：
//   ① 空白处横向滑动 → 不选中任何东西（旧行为会起框/点选）
//   ② 单指拖动 → 画布真的平移（scrollLeft/scrollTop 变化）
//   ③ 长按元素 420ms → 选中它
//   ④ 再长按另一个元素 → 变成多选（两个都在 selectedIds 里）
//   ⑤ 长按空白 → 清空选区
//   ⑥ 双指捏合/张开 → zoom 变化
//   ⑦ 已选中元素上单击（短按抬手）→ 选区不变（单击什么都不做）
//
// 用法：node tests/e2e/probe-touch-canvas.mjs
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

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-touch');
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
  await sleep(700);
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1400);
  await win.waitForSelector('.workspace', { timeout: 15000 });

  // 两个可点的方块 + 一个超高元素（让画布真的能纵向平移）
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.addElement('div');
    let kids = window.__sceneStore.getState().scene.root.children;
    const a = kids[kids.length - 1];
    if (a) window.__sceneStore.getState().updateStyle(a.id, {
      width: '40%', height: '90px', backgroundColor: '#cfe3ff', marginTop: '20px'
    });
    st.addElement('div');
    kids = window.__sceneStore.getState().scene.root.children;
    const b = kids[kids.length - 1];
    if (b) window.__sceneStore.getState().updateStyle(b.id, {
      width: '40%', height: '90px', backgroundColor: '#ffe1cc', marginTop: '20px'
    });
    st.addElement('div');
    kids = window.__sceneStore.getState().scene.root.children;
    const c = kids[kids.length - 1];
    if (c) window.__sceneStore.getState().updateStyle(c.id, { height: '1600px', width: '100%' });
    window.__sceneStore.getState().selectElement(null);
    window.__store_ids = {
      a: kids[kids.length - 3]?.id, b: kids[kids.length - 2]?.id, tall: c?.id
    };
    st.endStyleEdit();
  });
  await sleep(600);

  const ids = await win.evaluate(() => window.__store_ids);
  check('准备：两个小方块 + 一个超高元素都在画布上',
    !!ids?.a && !!ids?.b, JSON.stringify(ids));

  /** 在页面里合成一段手势：返回触摸目标点与结果 */
  const gesture = (script) => win.evaluate(script);

  // 取两个方块的屏幕坐标 + 空白点
  let geo = await win.evaluate((id) => {
    const r1 = document.querySelector(`.canvas [data-bc-id="${id.a}"]`)?.getBoundingClientRect();
    const r2 = document.querySelector(`.canvas [data-bc-id="${id.b}"]`)?.getBoundingClientRect();
    const wrap = document.querySelector('.canvas-wrap')?.getBoundingClientRect();
    return {
      a: r1 ? { x: Math.round(r1.left + r1.width / 2), y: Math.round(r1.top + r1.height / 2) } : null,
      b: r2 ? { x: Math.round(r2.left + r2.width / 2), y: Math.round(r2.top + r2.height / 2) } : null,
      empty: wrap ? { x: Math.round(wrap.left + wrap.width - 24), y: Math.round(wrap.top + wrap.height - 24) } : null
    };
  }, ids);

  check('准备：拿到两个方块中心与一个空白点',
    !!geo?.a && !!geo?.b && !!geo?.empty, JSON.stringify(geo));

  const selNow = () => win.evaluate(() => {
    const st = window.__sceneStore.getState();
    return st.scene.selectedIds ?? (st.scene.selectedId ? [st.scene.selectedId] : []);
  });

  // ① 空白处横向滑动：不选中
  await win.evaluate((p) => {
    const fire = (type, x, y) => document.elementFromPoint(x, y)?.dispatchEvent(
      new PointerEvent(type, { pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true })
    );
    fire('pointerdown', p.x - 100, p.y);
    for (let i = 1; i <= 8; i++) fire('pointermove', p.x - 100 + i * 12, p.y);
    fire('pointerup', p.x - 4, p.y);
  }, geo.empty);
  await sleep(520);
  const afterSwipe = await selNow();
  check('① 空白处横滑不会选中任何元素', afterSwipe.length === 0, `selected=${JSON.stringify(afterSwipe)}`);

  // ② 单指拖动 → 画布平移
  /** 每次交互前重新量坐标：平移过之后旧坐标就落在别的元素上了 */
  const geoNow = () => win.evaluate((id) => {
    const r1 = document.querySelector(`.canvas [data-bc-id="${id.a}"]`)?.getBoundingClientRect();
    const r2 = document.querySelector(`.canvas [data-bc-id="${id.b}"]`)?.getBoundingClientRect();
    const wrap = document.querySelector('.canvas-wrap')?.getBoundingClientRect();
    return {
      a: r1 ? { x: Math.round(r1.left + r1.width / 2), y: Math.round(r1.top + r1.height / 2) } : null,
      b: r2 ? { x: Math.round(r2.left + r2.width / 2), y: Math.round(r2.top + r2.height / 2) } : null,
      empty: wrap ? { x: Math.round(wrap.left + wrap.width - 24), y: Math.round(wrap.top + wrap.height - 24) } : null
    };
  }, ids);
  const scrollBefore = await win.evaluate(() => {
    const w = document.querySelector('.canvas-wrap');
    return { l: w.scrollLeft, t: w.scrollTop, sh: w.scrollHeight, ch: w.clientHeight };
  });
  await win.evaluate((p) => {
    const fire = (type, x, y) => document.elementFromPoint(x, y)?.dispatchEvent(
      new PointerEvent(type, { pointerId: 12, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true })
    );
    fire('pointerdown', p.x, p.y);
    for (let i = 1; i <= 10; i++) fire('pointermove', p.x, p.y - i * 20);
    fire('pointerup', p.x, p.y - 200);
  }, geo.empty);
  await sleep(300);
  const scrollAfter = await win.evaluate(() => {
    const w = document.querySelector('.canvas-wrap');
    return { l: w.scrollLeft, t: w.scrollTop };
  });
  check('② 单指上滑 → 画布纵向真的滚动了',
    scrollAfter.t > scrollBefore.t + 40,
    `scrollTop ${scrollBefore.t} → ${scrollAfter.t}（可滚 ${scrollBefore.sh - scrollBefore.ch}）`);

  // ③ 长按元素 → 选中（先把平移归零，坐标才是稳定的）
  await win.evaluate(() => { const w = document.querySelector('.canvas-wrap'); if (w) w.scrollTop = 0; });
  await sleep(300);
  const g3 = await geoNow();
  geo = g3;
  await win.evaluate((p) => {
    const target = document.elementFromPoint(p.x, p.y);
    const fire = (type, x, y) => target?.dispatchEvent(
      new PointerEvent(type, { pointerId: 13, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true })
    );
    fire('pointerdown', p.x, p.y);
    window.__holdFired = true;
  }, geo.a);
  await sleep(560);
  await win.evaluate((p) => {
    const fire = (type, x, y) => document.elementFromPoint(p.x, p.y)?.dispatchEvent(
      new PointerEvent(type, { pointerId: 13, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true })
    );
    fire('pointerup', p.x, p.y);
  }, geo.a);
  await sleep(260);
  const afterHoldA = await selNow();
  check('③ 长按元素 → 选中它', afterHoldA.includes(ids.a), `selected=${JSON.stringify(afterHoldA)}`);

  // ④ 再长按另一个元素 → 多选
  await win.evaluate((p) => {
    const target = document.elementFromPoint(p.x, p.y);
    target?.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 14, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true
    }));
  }, geo.b);
  await sleep(560);
  await win.evaluate((p) => {
    document.elementFromPoint(p.x, p.y)?.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 14, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true
    }));
  }, geo.b);
  await sleep(260);
  const afterHoldB = await selNow();
  check('④ 再长按另一个元素 → 变成多选（两个都在选区里）',
    afterHoldB.includes(ids.a) && afterHoldB.includes(ids.b), `selected=${JSON.stringify(afterHoldB)}`);

  // ⑦ 单击（短按）不改变选区
  await win.evaluate((p) => {
    const target = document.elementFromPoint(p.x, p.y);
    target?.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 15, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true
    }));
    target?.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 15, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true
    }));
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }));
  }, geo.a);
  await sleep(300);
  const afterTap = await selNow();
  check('⑦ 已选中元素上单击 → 选区不变（单击什么都不做）',
    afterTap.length === afterHoldB.length, `${JSON.stringify(afterHoldB)} → ${JSON.stringify(afterTap)}`);

  // ⑤ 长按空白 → 清空
  // ⚠ 先把那个 1600px 的超高元素压扁：它铺满整宽整高，会让"空白点"其实落在它身上
  await win.evaluate((id) => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.updateStyle(id.tall, { height: '200px' });
    st.endStyleEdit();
  }, ids);
  await sleep(400);
  await win.evaluate(() => { const w = document.querySelector('.canvas-wrap'); if (w) w.scrollTop = 0; });
  await sleep(300);
  geo = await geoNow();
  await win.evaluate((p) => {
    document.elementFromPoint(p.x, p.y)?.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 16, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true
    }));
  }, geo.empty);
  await sleep(560);
  await win.evaluate((p) => {
    document.elementFromPoint(p.x, p.y)?.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 16, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true
    }));
  }, geo.empty);
  await sleep(260);
  const afterHoldEmpty = await selNow();
  check('⑤ 长按空白 → 清空选区', afterHoldEmpty.length === 0, `selected=${JSON.stringify(afterHoldEmpty)}`);

  // ⑥ 双指张开 → zoom 变大（直接读 .canvas 的 transform 缩放，不依赖工具栏那个输入框）
  const readZoom = () => win.evaluate(() => {
    const el = document.querySelector('.canvas');
    if (!el) return -1;
    const m = /matrix\(([^,]+),/.exec(getComputedStyle(el).transform || '');
    return m ? Math.round(Number(m[1]) * 100) : -1;
  });
  const z0 = await readZoom();
  await win.evaluate((p) => {
    const fire = (type, id, x, y) => document.elementFromPoint(p.x, p.y)?.dispatchEvent(
      new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true })
    );
    fire('pointerdown', 21, p.x - 20, p.y);
    fire('pointerdown', 22, p.x + 20, p.y);
    for (let i = 1; i <= 8; i++) {
      fire('pointermove', 21, p.x - 20 - i * 8, p.y);
      fire('pointermove', 22, p.x + 20 + i * 8, p.y);
    }
    fire('pointerup', 21, p.x - 84, p.y);
    fire('pointerup', 22, p.x + 84, p.y);
  }, geo.empty);
  await sleep(400);
  const z1 = await readZoom();
  check('⑥ 双指张开 → 画布放大（zoom 变大）', z1 > z0 + 1, `zoom ${z0}% → ${z1}%`);

  // ⑦ 双指缩放的**锚点**：手指按住的那个内容点要留在手指下面，不能把画布"拽走"
  //    判据：以两指中心为原点，某个元素中心的相对位置应按 zoom 比例同步放大
  //    （d1 ≈ d0 × k）。偏差 > 14px 就说明锚点没守住。
  const boxCenter = () => win.evaluate((bid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${bid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, ids.a);
  const c0 = await boxCenter();
  if (!c0) {
    check('⑦ 双指缩放以两指中心为锚（内容点不漂）', false, '找不到方块 A');
  } else {
    const anchor = { x: Math.round(c0.x + 70), y: Math.round(c0.y) };
    const za = await readZoom();
    await win.evaluate((p) => {
      const fire = (type, id, x, y) => document.elementFromPoint(p.x, p.y)?.dispatchEvent(
        new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true })
      );
      fire('pointerdown', 31, p.x - 20, p.y);
      fire('pointerdown', 32, p.x + 20, p.y);
      for (let i = 1; i <= 6; i++) {
        fire('pointermove', 31, p.x - 20 - i * 6, p.y);
        fire('pointermove', 32, p.x + 20 + i * 6, p.y);
      }
      fire('pointerup', 31, p.x - 56, p.y);
      fire('pointerup', 32, p.x + 56, p.y);
    }, anchor);
    await sleep(450);
    const za2 = await readZoom();
    const c1 = await boxCenter();
    const k = za2 / za;
    const d0 = c0.x - anchor.x;
    const d1 = c1 ? c1.x - anchor.x : NaN;
    const drift = d1 - d0 * k;
    check('⑦ 双指缩放以两指中心为锚（内容点不漂）',
      Number.isFinite(drift) && Math.abs(drift) < 14,
      `锚点位移 ${drift.toFixed(1)}px（zoom ${za}% → ${za2}%，k=${k.toFixed(2)}，d0=${d0.toFixed(0)} → d1=${d1.toFixed(0)}）`);
  }

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
