// 撤销粒度探针（v0.4.4g）
// 目标：所有"连续操作"（滑块拖动 / 滚轮调值）都必须只产生**一条**撤销记录，
// 按一次 Ctrl+Z 就整体还原，而不是"一点一点退回去"。
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
  const DATA_DIR = resolve(tmpdir(), 'bc-undo-probe');
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

  // 保证右侧显示「属性」面板（localStorage 里可能记着上次是「图层」）
  await win.locator('.right-pane .tab-btn', { hasText: '属性' }).click().catch(() => {});
  await sleep(300);

  // 造一个元素 + 打开「不透明度」属性行
  const id = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'u1', type: 'div', style: { width: '160px', height: '60px', backgroundColor: '#e8eefc' }, children: [] }, null);
    const sid = window.__sceneStore.getState().scene.selectedId;
    window.__sceneStore.getState().addVisibleProp(sid, 'opacity');
    return sid;
  });
  await sleep(500);
  // 展开「CSS 样式属性」折叠区（收起时子节点会被卸载）
  await win.locator('[title="点击展开或收起 CSS 样式属性"]').click().catch(() => {});
  await sleep(500);

  // ============ 1. 滑块连续拖动 = 一条撤销 ============
  const past0 = await win.evaluate(() => window.__sceneStore.getState().history.past.length);
  const dragged = await win.evaluate(() => {
    const input = document.querySelector('.vis-opacity-wrap input[type=range]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    for (const v of [90, 80, 70, 60, 50]) {
      setter.call(input, String(v));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return true;
  });
  ok('找到不透明度滑块', dragged === true);
  await sleep(400);
  const past1 = await win.evaluate(() => window.__sceneStore.getState().history.past.length);
  const op = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n.style.opacity;
  }, id);
  ok('滑块拖动后 opacity 已写入', op === '0.5', String(op));
  ok('滑块连续拖动只产生 1 条撤销记录', past1 - past0 === 1, `${past0} → ${past1}`);

  // 一次 Ctrl+Z 应整体还原（opacity 回到空）
  await win.keyboard.press('Control+z');
  await sleep(400);
  const opAfter = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n.style.opacity ?? '';
  }, id);
  ok('一次 Ctrl+Z 整体还原（不会一点一点退）', opAfter === '', JSON.stringify(opAfter));

  // ============ 2. 数值框滚轮连续调值 = 一条撤销 ============
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addVisibleProp(st.scene.selectedId, 'width');
  });
  await sleep(400);
  const past2 = await win.evaluate(() => window.__sceneStore.getState().history.past.length);
  const wheeled = await win.evaluate(() => {
    // 宽度输入框（NumberUnitInput 渲染成 input）
    const rows = Array.from(document.querySelectorAll('[data-prop-key="width"] input'));
    const input = rows.find((i) => i.type !== 'range');
    if (!input) return false;
    input.focus();
    for (let i = 0; i < 6; i += 1) {
      input.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }));
    }
    input.blur();
    return true;
  });
  ok('找到宽度输入框', wheeled === true);
  await sleep(600);
  const past3 = await win.evaluate(() => window.__sceneStore.getState().history.past.length);
  ok('滚轮连续调值只产生 1 条撤销记录', past3 - past2 === 1, `${past2} → ${past3}`);

  await win.keyboard.press('Control+z');
  await sleep(400);
  const wAfter = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n.style.width;
  }, id);
  ok('滚轮调值一次 Ctrl+Z 整体还原', wAfter === '160px', String(wAfter));

  // ============ 3. 选中元素 + 焦点在属性输入框里，Ctrl+Z / Ctrl+Y 也要能用（v0.4.4h）============
  // 用户反馈的 bug：点画布选中元素后，焦点留在右侧输入框 → 全局快捷键被输入框守卫吃掉。
  const w0 = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n.style.width;
  }, id);

  // 点进宽度输入框（焦点停在输入框里），再用滚轮连续调值（模拟用户连续操作）
  await win.locator('[data-prop-key="width"] input').first().click();
  await sleep(250);
  const focusTag = await win.evaluate(() => document.activeElement?.tagName || 'BODY');
  ok('焦点确实在属性输入框里', focusTag === 'INPUT', focusTag);

  await win.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-prop-key="width"] input'));
    const input = rows.find((i) => i.type !== 'range');
    for (let i = 0; i < 6; i += 1) {
      input.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }));
    }
  });
  await sleep(600);
  const wChanged = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n.style.width;
  }, id);
  ok('滚轮已改变宽度', wChanged !== w0, `${w0} → ${wChanged}`);

  // 焦点仍在输入框里 → 按 Ctrl+Z 应该整体还原（而不是被输入框吃掉）
  const focusStill = await win.evaluate(() => document.activeElement?.tagName || 'BODY');
  ok('按 Ctrl+Z 之前焦点仍在输入框里', focusStill === 'INPUT', focusStill);
  await win.keyboard.press('Control+z');
  await sleep(500);
  const wUndo = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n.style.width;
  }, id);
  ok('焦点在输入框里时 Ctrl+Z 仍然生效', wUndo === w0, `${wChanged} → ${wUndo}`);

  await win.keyboard.press('Control+y');
  await sleep(500);
  const wRedo = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n.style.width;
  }, id);
  ok('Ctrl+Y 重做也生效', wRedo === wChanged, String(wRedo));

  // 点画布 → 焦点主动离开输入框（这样后续快捷键不会被吃掉）
  await win.locator('[data-prop-key="width"] input').first().click();
  await sleep(200);
  const r = await win.evaluate((eid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, id);
  await win.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await sleep(350);
  const focusAfter = await win.evaluate(() => document.activeElement?.tagName || 'BODY');
  ok('点画布后焦点主动离开输入框', focusAfter !== 'INPUT' && focusAfter !== 'TEXTAREA', focusAfter);

  ok('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  console.log(`\n===== 撤销粒度探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
