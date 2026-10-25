// v0.4.5 C补14b 验收：定位元素拖动"取最短两边"，中线不死锁不闪
// 用法：node tests/e2e/probe-v045-fixed-side.mjs
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

/** 按住 Alt 从元素中心拖动 by(dx,dy)，中途取样样式，最后松手 */
async function altDrag(win, id, dx, dy) {
  const c = await win.evaluate((tid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${tid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, id);
  if (!c) return null;
  await win.keyboard.down('Alt');
  await win.mouse.move(c.x, c.y);
  await win.mouse.move(c.x + 1, c.y + 1);
  await sleep(260);
  await win.mouse.down();
  const samples = [];
  for (let i = 1; i <= 5; i++) {
    await win.mouse.move(c.x + Math.round(dx * i / 5), c.y + Math.round(dy * i / 5));
    await sleep(120);
    samples.push(await win.evaluate((tid) => {
      const st = window.__sceneStore.getState();
      const n = (st.scene.root.children || []).find((c) => c.id === tid);
      return n ? { l: n.style.left ?? null, r: n.style.right ?? null, t: n.style.top ?? null, b: n.style.bottom ?? null } : null;
    }, id));
  }
  await win.mouse.up();
  await win.keyboard.up('Alt');
  await sleep(250);
  return samples;
}

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-fixedside');
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
  await sleep(700);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // 造一个 absolute 元素：锚在**容器右侧**（right: 20px），看拖动后是否仍然用 right
  const id = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const before = new Set((st.scene.root.children || []).map((c) => c.id));
    st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const fresh = (s2.scene.root.children || []).find((c) => !before.has(c.id));
    if (!fresh) return null;
    s2.updateStyle(fresh.id, {
      position: 'absolute', right: '20px', top: '40px',
      width: '120px', height: '80px', backgroundColor: '#bfdbfe'
    });
    window.__sceneStore.getState().selectElement(fresh.id);
    return fresh.id;
  });
  await sleep(800);
  const start = await win.evaluate((tid) => {
    const n = (window.__sceneStore.getState().scene.root.children || []).find((c) => c.id === tid);
    return n ? { ...n.style } : null;
  }, id);
  check('准备：元素初始用 right/top 锚定', !!start && start.right === '20px' && !start.left,
    start ? `right=${start.right} left=${start.left ?? '(无)'}` : '没建出来');

  // 往左拖 40px（仍在右侧区域）→ 应该继续用 right，且 left 保持为空
  const s1 = await altDrag(win, id, -40, 0);
  const last = s1 && s1[s1.length - 1];
  check('C补14b 拖动后仍用 right 锚定（不再强行改写成 left）',
    !!last && typeof last.r === 'string' && last.l == null,
    last ? `right=${last.r} left=${last.l ?? '(无)'}` : '没有取样到');

  // 关键：整个拖动过程中不能出现"left 和 right 同时存在"（over-constrained）
  const both = (s1 || []).filter((s) => s && s.l && s.r);
  check('C补14b 全程没有 left/right 同时存在的过约束状态',
    both.length === 0, both.length ? JSON.stringify(both[0]) : '干净');

  // 垂直方向：元素在上方（top:40）→ 应继续用 top，bottom 为空
  check('C补14b 垂直方向同理：靠近上边就用 top，不会写 bottom',
    !!last && typeof last.t === 'string' && last.b == null,
    last ? `top=${last.t} bottom=${last.b ?? '(无)'}` : '');

  // 拖到水平中线附近 → 必须固定用 left（死区），且**不能出现 left 被清零**的瞬间
  const midLeft = await win.evaluate((tid) => {
    const st = window.__sceneStore.getState();
    const el = document.querySelector(`.canvas [data-bc-id="${tid}"]`);
    const parent = el ? el.parentElement : null;
    const pr = parent ? parent.getBoundingClientRect() : null;
    const w = pr ? Math.round((pr.width - 120) / 2) : 300;
    st.updateStyle(tid, { left: undefined, right: undefined, position: 'absolute', top: '120px', width: '120px', height: '80px' });
    window.__sceneStore.getState().updateStyle(tid, { left: w + 'px' });
    return w;
  }, id);
  await sleep(600);
  const s2 = await altDrag(win, id, 6, 0);
  const cleared = (s2 || []).filter((s) => s && s.l == null && s.r == null);
  const hasLeft = (s2 || []).filter((s) => s && typeof s.l === 'string');
  check('C补14b 中线死区内始终用 left（不会出现两边都不设的"清零"瞬间）',
    cleared.length === 0 && hasLeft.length === (s2 || []).length,
    `清零帧=${cleared.length} 用 left 的帧=${hasLeft.length}/${(s2 || []).length}`);

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