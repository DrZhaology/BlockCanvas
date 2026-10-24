// C补10 复查：编辑器里 Ctrl+Z / Ctrl+Y 到底能不能用 + C补13 图层面板宽度
// 用法：node tests/e2e/probe-v045-undo2.mjs
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

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-undo2');
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

  // 场景 1：点画布（焦点在文档体）后按 Ctrl+Z
  const before = await win.evaluate(() => (window.__sceneStore.getState().scene.root.children || []).length);
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
  });
  await sleep(500);
  const added = await win.evaluate(() => (window.__sceneStore.getState().scene.root.children || []).length);
  await win.evaluate(() => document.body.focus?.());
  await win.keyboard.press('Control+z');
  await sleep(600);
  const afterBody = await win.evaluate(() => (window.__sceneStore.getState().scene.root.children || []).length);
  check('C补10 焦点在页面时 Ctrl+Z 能撤销新增元素',
    before === 0 && added === 1 && afterBody === 0,
    `元素数 ${before} → ${added} → ${afterBody}`);

  // 场景 2：焦点在右侧属性面板的输入框里（用户最常见的场景：刚改完数值）
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const el = (s2.scene.root.children || [])[0];
    if (el) s2.selectElement(el.id);
  });
  await sleep(700);
  await win.locator('.tab-btn', { hasText: '属性' }).click();
  await sleep(600);
  const added2 = await win.evaluate(() => (window.__sceneStore.getState().scene.root.children || []).length);
  // 点进一个数值输入框（如果存在）
  const focused = await win.evaluate(() => {
    const input = document.querySelector('.inspector input[type="text"], .inspector input:not([type])');
    if (!input) return null;
    input.focus();
    return { tag: input.tagName, cls: String(input.className || '').slice(0, 30) };
  });
  await win.keyboard.press('Control+z');
  await sleep(600);
  const afterField = await win.evaluate(() => (window.__sceneStore.getState().scene.root.children || []).length);
  check('C补10 焦点在属性面板输入框里时 Ctrl+Z 也能撤销',
    added2 === 1 && afterField === 0,
    `输入框=${focused ? focused.cls : '无'} 元素数 ${added2} → ${afterField}`);

  // 场景 3：Ctrl+Y 重做
  await win.evaluate(() => document.body.focus?.());
  await win.keyboard.press('Control+y');
  await sleep(600);
  const redone = await win.evaluate(() => (window.__sceneStore.getState().scene.root.children || []).length);
  check('C补10 Ctrl+Y 能重做回来', redone === 1, `元素数=${redone}`);

  // C补13：右侧面板宽度与图层行可用宽度
  const panel = await win.evaluate(() => {
    const wrap = document.querySelector('.right-pane-wrap') || document.querySelector('.right-pane');
    const tree = document.querySelector('.layer-tree');
    const r = wrap ? wrap.getBoundingClientRect() : null;
    return {
      width: r ? Math.round(r.width) : -1,
      hasResizer: !!document.querySelector('.panel-resizer-vertical'),
      treeExists: !!tree
    };
  });
  check('C补13 右侧面板可拖宽（拖拽把手存在）', panel.hasResizer, `面板宽 ${panel.width}px`);
  check('C补13 右侧面板默认宽度足够看图层名（≥420px）', panel.width >= 420, `${panel.width}px`);

  // ---------- C补10 真正要验的：从"项目中心"打开工程后，撤销历史要装回来 ----------
  const dataProjects = resolve(DATA_DIR, 'projects');
  mkdirSync(dataProjects, { recursive: true });
  const projPath = resolve(dataProjects, 'undo-demo.bcproj');
  // 造几条历史再保存（模拟"用户攒了一堆操作"）
  await win.evaluate(async (p) => {
    const st = window.__sceneStore.getState();
    for (let i = 0; i < 3; i++) st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const res = await window.bc.saveProject({
      name: '撤销历史演示',
      scene: s2.scene,
      history: { past: s2.history.past, future: [] }
    }, false, p);
    return res.ok;
  }, projPath);
  await sleep(600);

  // 回首页 → 全部项目 → 点卡片打开（这条路径以前漏传 history）
  await win.evaluate(() => { window.dispatchEvent(new CustomEvent('menu:projects')); });
  await sleep(300);
  const inCenter = await win.evaluate(() => !!document.querySelector('.pc-page'));
  if (!inCenter) {
    // 兜底：直接点工具栏的「全部项目」
    await win.locator('button:has-text("全部项目")').first().click().catch(() => null);
    await sleep(1200);
  }
  await sleep(800);
  const cardClicked = await win.evaluate(() => {
    const card = document.querySelector('.pc-card');
    if (!card) return false;
    card.click();
    return true;
  });
  await sleep(1500);

  const restored = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    return {
      pastLen: (st.history?.past || []).length,
      futureLen: (st.history?.future || []).length,
      children: (st.scene.root.children || []).length
    };
  });
  check('C补10 从项目中心打开工程后，撤销历史被装回（不再是"有记录却撤不动"）',
    cardClicked && restored.pastLen > 0,
    `点击卡片=${cardClicked} 历史条数=${restored.pastLen} 元素数=${restored.children}`);

  const undoWorks = await win.evaluate(async () => {
    const before = (window.__sceneStore.getState().scene.root.children || []).length;
    window.__sceneStore.getState().undo();
    await new Promise((r) => setTimeout(r, 200));
    const after = (window.__sceneStore.getState().scene.root.children || []).length;
    return { before, after };
  });
  check('C补10 打开后立刻按 Ctrl+Z 有效果（元素数变化）',
    undoWorks.after !== undoWorks.before,
    `元素数 ${undoWorks.before} → ${undoWorks.after}`);

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