// v0.4.6 第 46 批 · 页面切换的"方向感"
//
// 用户原话：
//   「设置页面…进入和退出动画应该是右侧进入，右侧退出的样式，不要单纯刷新一下。」
//   「新建画布的时候，如果上一个画布在下面，不是页面最顶部，下面一个画布也会在底部，
//     超过的画布，修一下。」
//
// 逐条量：
//   ① 进设置页：<html data-vtslide="page">，且真的有 view-transition 伪元素动画在跑
//   ② 从设置页返回编辑器：同样挂着（右进右出，不是单纯交叉淡入）
//   ②c 项目中心 / 手册 / 预览 同样右进右出（第 47 批："所有别的页面都要修改一下"）
//   ③ 会话页那套专属动画不受影响（不挂 vtslide）
//   ④ 新建页面后画布滚回左上（不继承上一页的滚动位置）
//
// 用法：node tests/e2e/probe-page-transitions.mjs
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
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

const vtState = (win) => win.evaluate(() => ({
  slide: document.documentElement.dataset.vtslide || '',
  vtAnims: document.getAnimations()
    .filter((a) => String(a.effect?.pseudoElement || '').includes('view-transition'))
    .map((a) => String(a.effect.pseudoElement))
}));

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-transitions');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  win.setDefaultTimeout(8000);
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(300, 400);
    w.setContentSize(412, 860);
    w.center();
  });
  await ensureEditor(win);
  await sleep(600);
  // 先建个工程，保证在编辑器里
  if (await win.locator('.empty-home').count()) {
    await win.locator('.eh-btn', { hasText: '新建项目' }).click();
    await sleep(1500);
  }

  // ① 进设置页
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:settings')));
  await sleep(90);
  const inSettings = await vtState(win);
  check('① 进设置页挂上 vtslide=page', inSettings.slide === 'page', JSON.stringify(inSettings.slide));
  check('① 有 view-transition 伪元素动画在跑（不是单纯刷新）',
    inSettings.vtAnims.length > 0, inSettings.vtAnims.slice(0, 4).join(' | '));
  await win.waitForSelector('.fluent-settings-page', { timeout: 8000 });
  await sleep(600);

  // ② 从设置页返回编辑器
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.pt-bar1 .pt-btn')];
    btns.find((b) => (b.getAttribute('aria-label') || '').includes('返回'))?.click();
  });
  await sleep(90);
  const outSettings = await vtState(win);
  check('② 从设置页退出也挂 vtslide（右进右出）', outSettings.slide === 'page', JSON.stringify(outSettings.slide));
  check('② 退出时同样有 view-transition 动画', outSettings.vtAnims.length > 0, outSettings.vtAnims.slice(0, 4).join(' | '));
  await sleep(600);

  // ②c 项目中心 / 手册 / 预览：同一套右进右出（第 47 批扩面）
  const slides = [];
  for (const [label, fire, sel] of [
    ['项目中心', 'menu:web-manager', '.pc-page'],
    ['手册', 'menu:help', '.help-center, .help-page'],
    ['预览', null, '.bc-preview-view']
  ]) {
    if (fire) await win.evaluate((ev) => window.dispatchEvent(new CustomEvent(ev)), fire);
    else {
      // 预览由工具栏在竖屏下换成"程序内预览"事件，这里直接派发同样的载荷
      await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:inapp-preview', {
        detail: { html: '<!doctype html><html><body style="margin:0"><div style="height:400px;background:#4a90d9"></div></body></html>' }
      })));
    }
    await sleep(90);
    const st = await vtState(win);
    slides.push({ label, slide: st.slide, vt: st.vtAnims.length });
    await win.waitForSelector(sel, { timeout: 8000 }).catch(() => {});
    await sleep(600);
    // 返回编辑器，准备下一次
    await win.evaluate(() => {
      const btns = [...document.querySelectorAll('.pt-bar1 .pt-btn')];
      btns.find((b) => (b.getAttribute('aria-label') || '').includes('返回'))?.click();
    });
    await sleep(700);
  }
  check('②c 项目中心 / 手册 / 预览 都挂 vtslide=page 且有 VT 动画',
    slides.every((s) => s.slide === 'page' && s.vt > 0), JSON.stringify(slides));

  // ②b 第二条栏：切到会话页时**不是立刻消失**，而是从下方滑出（220ms 后卸载）
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.pt-bar1 .pt-btn')];
    btns.find((b) => (b.getAttribute('aria-label') || '').includes('管理会话'))?.click();
  });
  await sleep(80);
  const bar2Mid = await win.evaluate(() => {
    const el = document.querySelector('.pt-bar2');
    if (!el) return { exists: false };
    const cs = getComputedStyle(el);
    return { exists: true, leaving: el.classList.contains('is-leaving'), position: cs.position, transform: cs.transform };
  });
  check('②b 切走时第二条栏仍在 DOM 且挂 is-leaving（不是瞬间消失）',
    bar2Mid.exists === true && bar2Mid.leaving === true, JSON.stringify(bar2Mid));
  check('②b 退场期间脱流（position: fixed，不会把会话页顶矮）',
    bar2Mid.position === 'fixed', bar2Mid.position);
  await sleep(420);
  const bar2Gone = await win.evaluate(() => !document.querySelector('.pt-bar2'));
  check('②b 播完（>220ms）才真正卸载', bar2Gone === true, String(bar2Gone));

  // ③ 会话页不挂 vtslide（此时已经在会话页里了）（它有自己的"画布缩小成缩略图"那套）
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.pt-bar1 .pt-btn')];
    btns.find((b) => (b.getAttribute('aria-label') || '').includes('管理会话'))?.click();
  });
  await sleep(90);
  const inSessions = await vtState(win);
  check('③ 会话页不挂 vtslide（专属动画不被通用滑屏顶掉）',
    inSessions.slide !== 'page', JSON.stringify(inSessions.slide));
  await sleep(600);

  // 回到编辑器（会话页里没有 .canvas-wrap）
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.pt-bar1 .pt-btn')];
    btns.find((b) => (b.getAttribute('aria-label') || '').includes('返回'))?.click();
  });
  await sleep(800);

  // ④ 新建页面滚回左上
  const scrollProbe = await win.evaluate(async () => {
    const wrap = document.querySelector('.canvas-wrap');
    if (!wrap) return { ok: false };
    wrap.scrollTop = 260;
    wrap.scrollLeft = 40;
    const before = { top: wrap.scrollTop, left: wrap.scrollLeft };
    window.dispatchEvent(new CustomEvent('bc:new-page'));
    await new Promise((r) => setTimeout(r, 900));
    const w2 = document.querySelector('.canvas-wrap');
    return { ok: true, before, after: { top: w2?.scrollTop ?? -1, left: w2?.scrollLeft ?? -1 } };
  });
  check('④ 新建页面 → 画布回到左上（不继承上一页滚动位置）',
    scrollProbe.ok && scrollProbe.after.top === 0 && scrollProbe.after.left === 0,
    JSON.stringify(scrollProbe));

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
