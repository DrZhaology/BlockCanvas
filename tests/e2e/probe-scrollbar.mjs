// ============================================================================
// v0.4.6 · 自绘滚动条探针（用户："滚动条静止的时候 5px，按下的时候变宽一点，
// 交互动画不明显，而且太细小了点。"）
// ----------------------------------------------------------------------------
// 要证明的四件事：
//   ① 静止 5px、透明度 0.55（常显，不会消失）
//   ② 悬停 7px、透明度 1
//   ③ 按住 9px + is-dragging
//   ④ 变粗时**贴着容器边不漂移**（右边缘三次都一样），并且拖动真的能滚
//
// ⚠ 选错滑块是这份探针最容易犯的错：画布和底部元素面板各有一条竖滑块，
//   必须按"整条都落在 .canvas-wrap 里"来挑，否则量到面板那条、永远看到 5px。
//
// 用法：node tests/e2e/probe-scrollbar.mjs
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
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '   -> ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

const main = async () => {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-scrollbar');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push(String(e.message)));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1400);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const r = window.__sceneStore.getState().scene.root;
    const el = r.children[r.children.length - 1];
    window.__sceneStore.getState().updateStyle(el.id, { minHeight: '2400px' });
  });
  await sleep(1200);

  /** 挑"整条都落在 canvas-wrap 里"的那条竖滑块 */
  const pick = () => win.evaluate(() => {
    const w = document.querySelector('.canvas-wrap');
    const wr = w.getBoundingClientRect();
    const cand = [...document.querySelectorAll('.bc-osb-thumb.is-y')]
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.top >= wr.top - 2 && r.bottom <= wr.bottom + 2 && r.left >= wr.left - 2 && r.right <= wr.right + 2);
    if (!cand.length) return null;
    const { r } = cand[0];
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), right: Math.round(r.right) };
  });

  const thumb0 = await pick();
  check('画布里有自绘竖向滑块', !!thumb0, thumb0 ? `x=${thumb0.x} h-track` : 'no thumb');
  if (!thumb0) { console.log(`\n=== ${pass} passed, ${fail} failed ===`); await app.close(); process.exit(1); }

  const rest = await win.evaluate(() => {
    const t = [...document.querySelectorAll('.bc-osb-thumb.is-y')][0];
    return { w: Math.round(t.getBoundingClientRect().width), op: Number(getComputedStyle(t).opacity) };
  });
  check('静止厚度 5px', rest.w === 5, `w=${rest.w}`);
  check('静止仍然可见（opacity ≥ .5，不会消失）', rest.op >= 0.5, `opacity=${rest.op}`);

  const hit = await win.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return e ? String(e.className) : null;
  }, [thumb0.x, thumb0.y]);
  check('滑块能被指针命中（不被面板盖住）', !!hit && hit.includes('bc-osb-thumb'), `hit=${hit}`);

  await win.mouse.move(thumb0.x, thumb0.y);
  await sleep(450);
  const hov = await win.evaluate(() => {
    const list = [...document.querySelectorAll('.bc-osb-thumb.is-y')].map((e) => ({ w: Math.round(e.getBoundingClientRect().width), right: Math.round(e.getBoundingClientRect().right), hover: e.matches(':hover'), op: Number(getComputedStyle(e).opacity) }));
    return list.find((x) => x.hover) ?? list[0];
  });
  check('悬停加粗到 7px', hov.w === 7, `w=${hov.w}`);
  check('悬停不透明', hov.op >= 0.98, `opacity=${hov.op}`);
  check('加粗时右边缘不漂移', Math.abs(hov.right - thumb0.right) <= 1, `right ${thumb0.right} -> ${hov.right}`);

  await win.mouse.down();
  await sleep(450);
  const down = await win.evaluate(() => {
    const list = [...document.querySelectorAll('.bc-osb-thumb.is-y')].map((e) => ({ w: Math.round(e.getBoundingClientRect().width), right: Math.round(e.getBoundingClientRect().right), drag: e.classList.contains('is-dragging') }));
    return list.find((x) => x.drag) ?? list[0];
  });
  check('按住变粗到 9px 且挂上 is-dragging', down.w === 9 && down.drag, `w=${down.w} drag=${down.drag}`);

  const before = await win.evaluate(() => Math.round(document.querySelector('.canvas-wrap').scrollTop));
  await win.mouse.move(thumb0.x, thumb0.y + 80, { steps: 8 });
  await sleep(300);
  await win.mouse.up();
  await sleep(300);
  const afterScroll = await win.evaluate(() => Math.round(document.querySelector('.canvas-wrap').scrollTop));
  check('拖滑块能滚动容器', afterScroll > before + 20, `scrollTop ${before} -> ${afterScroll}`);

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(1); });
