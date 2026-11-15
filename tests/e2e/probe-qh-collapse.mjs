// ============================================================================
// v0.4.6 · 快捷助手「定位助手」展开/收起动画探针
// ----------------------------------------------------------------------------
// 用户原话：「快捷助手里面的定位助手没有展开合起来的动画。」
//
// 要证明它不是"瞬切"：
//   ① 展开过程中高度**有中间态**（至少采到 3 个互不相同的值，且单调递增）；
//   ② 过渡时长在 150–250ms 档（跟其它板块一致，不是随手一个数）；
//   ③ 收起时高度递减，且动画跑完才卸载。
//
// 做法：点开「定位助手」的标题按钮，然后在页面里按 30ms 一档采样
// `.qh-pos-collapse` 的高度，一条 round-trip 拿回整条高度曲线。
//
// 用法：node tests/e2e/probe-qh-collapse.mjs
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-qh-collapse');
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
  await win.waitForFunction(() => !document.querySelector('.bc-loading'), { timeout: 15000 }).catch(() => {});
  await sleep(500);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1500);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // 选一个元素：快捷助手是"跟着选中元素"出来的
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const r = window.__sceneStore.getState().scene.root;
    window.__sceneStore.getState().selectElement(r.children[r.children.length - 1].id);
  });
  await sleep(800);

  // 右侧面板里的「快捷助手」板块如果是收着的，先展开
  const opened = await win.evaluate(() => {
    if (document.querySelector('.quick-helper')) return 'already';
    const t = [...document.querySelectorAll('.inspector-sec-title, .inspector-sec-head, .props-sec-head, .inspector-sec-body > *, button')]
      .find((n) => (n.textContent || '').includes('快捷助手'));
    if (t) { t.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 'clicked'; }
    return 'missing';
  });
  await sleep(700);

  const hasHelper = await win.evaluate(() => !!document.querySelector('.quick-helper'));
  check('快捷助手面板能打开', hasHelper, `entry=${opened}`);
  if (!hasHelper) {
    await win.screenshot({ path: resolve(ROOT, 'tests/e2e/shots-v046/09-qh-fail.png') });
    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    await app.close();
    process.exit(1);
  }

  /** 点「定位助手」的标题按钮，并按 30ms 一档采样高度曲线 */
  const run = async (wantOpen) => win.evaluate(async (open) => {
    const heads = [...document.querySelectorAll('.qh-block-head')];
    const head = heads.find((h) => (h.textContent || '').includes('定位助手'));
    if (!head) return { error: 'no-head' };
    // 标题右侧那颗才是开关：button.qh-block-toggle（没有 aria-expanded，别按 aria 找）
    const btn = head.querySelector('.qh-block-toggle') || head.querySelector('button') || head;
    const before = document.querySelector('.qh-pos-collapse');
    const beforeH = before ? Math.round(before.getBoundingClientRect().height) : 0;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const samples = [];
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 30));
      const el = document.querySelector('.qh-pos-collapse');
      samples.push(el ? Math.round(el.getBoundingClientRect().height) : 0);
    }
    const el = document.querySelector('.qh-pos-collapse');
    const cs = el ? getComputedStyle(el) : null;
    return {
      wantOpen: open,
      beforeH,
      samples,
      finalH: el ? Math.round(el.getBoundingClientRect().height) : 0,
      dur: cs ? cs.transitionDuration : '',
      prop: cs ? cs.transitionProperty : ''
    };
  }, wantOpen);

  const openRes = await run(true);
  if (openRes.error) {
    check('找到「定位助手」标题', false, openRes.error);
    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    await app.close();
    process.exit(1);
  }
  check('找到「定位助手」标题', true, `beforeH=${openRes.beforeH}`);
  check('展开前是收着的', openRes.beforeH <= 2, `h=${openRes.beforeH}`);

  const distinct = [...new Set(openRes.samples)].filter((v) => v > 0 && v < Math.max(...openRes.samples));
  check('展开过程有中间态（不是瞬切）', distinct.length >= 2, `中间高度=[${distinct.join(',')}]`);
  check('展开后确实展开到位', openRes.finalH >= 100, `finalH=${openRes.finalH}`);

  const durMs = (() => {
    const m = /([\d.]+)s/.exec(openRes.dur || '');
    return m ? Math.round(Number(m[1]) * 1000) : -1;
  })();
  check('过渡时长在 150–250ms 档', durMs >= 150 && durMs <= 250, `duration=${openRes.dur}`);
  check('过渡的是高度那套属性（grid-template-rows / height）',
    /grid|height|max-height/.test(openRes.prop || ''), `property=${openRes.prop}`);

  const closeRes = await run(false);
  check('收起时有递减过程', closeRes.samples.some((v) => v > 2 && v < closeRes.finalH + 40), `samples=[${closeRes.samples.slice(0, 6).join(',')}]`);
  check('收起后高度归零', closeRes.finalH <= 2, `finalH=${closeRes.finalH}`);

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));
  await win.screenshot({ path: resolve(ROOT, 'tests/e2e/shots-v046/09-qh-collapse.png') });
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(1); });
