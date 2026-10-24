// 排查"输入框有时点不进去"：每次开关弹层之后，检查有没有残留的全屏透明遮罩，
// 并实际验证属性面板里的输入框能否聚焦 + 输入。
// 用法：node tests/e2e/probe-input-focus.mjs
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

/** 找出"覆盖大半屏幕、可接收点击"的遮罩残留 */
const OVERLAY_FN = `() => {
  const out = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    if (cs.pointerEvents === 'none') continue;
    const r = el.getBoundingClientRect();
    const covers = (r.width * r.height) / (vw * vh);
    if (covers > 0.6 && r.width > vw * 0.7 && r.height > vh * 0.7) {
      const cls = String(el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.');
      out.push({ el: el.tagName.toLowerCase() + (cls ? '.' + cls : ''), z: cs.zIndex, covers: Math.round(covers * 100) + '%' });
    }
  }
  return out;
}`;

/** 实际验证：能不能聚焦并输入 */
const FOCUS_FN = `async () => {
  const input = document.querySelector('.inspector input[type="text"], .inspector input:not([type]), .pc-search-input');
  if (!input) return { ok: false, why: '面板里找不到输入框' };
  input.focus();
  const focused = document.activeElement === input;
  const before = input.value;
  // 用原生 setter + input 事件模拟真实输入
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, before + 'X');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  const after = input.value;
  // 复原
  setter.call(input, before);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: focused, focused, changed: after !== before, cls: String(input.className || '').slice(0, 26) };
}`;

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-inputfocus');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const el = (s2.scene.root.children || [])[0];
    if (el) s2.selectElement(el.id);
  });
  await sleep(800);
  await win.locator('.tab-btn', { hasText: '属性' }).click();
  await sleep(800);

  const overlayFn = new Function('return ' + OVERLAY_FN)();
  const focusFn = new Function('return ' + FOCUS_FN)();

  const step = async (label, action) => {
    if (action) { await action(); await sleep(600); }
    const overlays = await win.evaluate(overlayFn);
    const focus = await win.evaluate(focusFn);
    check(`${label}：没有残留全屏遮罩`, overlays.length === 0,
      overlays.length ? overlays.map((o) => `${o.el} z=${o.z} 覆盖${o.covers}`).join(' | ') : '干净');
    check(`${label}：输入框能聚焦且能输入`, focus.ok === true && focus.changed === true,
      focus.ok ? `${focus.cls} 聚焦=${focus.focused} 值变化=${focus.changed}` : focus.why);
  };

  await step('基线（未开任何弹层）');

  // ① 添加属性菜单：开 → 关
  await step('打开「添加属性」菜单', async () => {
    await win.evaluate(() => {
      const b = document.querySelector('.add-prop-trigger');
      if (b) b.click();
    });
  });
  await step('关闭「添加属性」菜单（Esc）', async () => { await win.keyboard.press('Escape'); });

  // ② 调色盘：开 → 点遮罩关
  await step('打开调色盘', async () => {
    await win.evaluate(() => {
      const sw = document.querySelector('.color-swatch-btn');
      if (sw) sw.click();
    });
  });
  await step('关闭调色盘（Esc）', async () => { await win.keyboard.press('Escape'); });

  // ③ 中键属性搜索：开 → Esc 关
  await step('打开属性搜索（中键）', async () => {
    await win.evaluate(() => {
      const el = document.querySelector('.canvas [data-bc-id]');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
    });
  });
  await step('关闭属性搜索（Esc）', async () => { await win.keyboard.press('Escape'); });

  // ④ 左右面板反复切换（用户说"切换界面就好了"，反向验证切换不会留下遮罩）
  await step('切到图层再切回属性', async () => {
    await win.locator('.tab-btn', { hasText: '图层' }).click();
    await sleep(400);
    await win.locator('.tab-btn', { hasText: '属性' }).click();
  });

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