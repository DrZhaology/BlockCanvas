// v0.4.5 第五批（自定任务）验收：文字默认文案 / 删除右下角提示 / 设置面板退场 / 页签不跳动
// 用法：node tests/e2e/probe-v045-batch5.mjs
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
const tabCount = (t) => (t ? t.heights.join(',') : '');
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-batch5');
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
  await sleep(800);

  // ---------- A补：页面设置面板有退场动画 ----------
  await win.locator('.eh-gear').click();
  await sleep(400);
  const panelOpen = await win.evaluate(() => {
    const p = document.querySelector('.eh-panel');
    return { open: !!p, anim: p ? getComputedStyle(p).animationName : '' };
  });
  check('A补 设置面板有进场动画', panelOpen.open && panelOpen.anim === 'ehPanelIn',
    `animation=${panelOpen.anim}`);

  // 点关闭 → 应该出现 is-closing 且动画是 ehPanelOut（而不是立刻消失）
  await win.locator('.eh-panel-x').click();
  await sleep(40);
  const closing = await win.evaluate(() => {
    const p = document.querySelector('.eh-panel');
    if (!p) return { gone: true };
    return { gone: false, closing: p.classList.contains('is-closing'), anim: getComputedStyle(p).animationName };
  });
  check('A补 关闭时先播放退场动画（不是直接消失）',
    !closing.gone && closing.closing === true && closing.anim === 'ehPanelOut',
    closing.gone ? '面板已立刻卸载（说明没有退场动画）' : `is-closing=${closing.closing} anim=${closing.anim}`);
  await sleep(400);
  const afterClose = await win.evaluate(() => !document.querySelector('.eh-panel'));
  check('A补 退场动画结束后面板才真正卸载', afterClose === true, `已卸载=${afterClose}`);

  // ---------- 进入编辑器 ----------
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // ---------- C补1：右下角"已选中元素…"提示已删除 ----------
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
  });
  await sleep(700);
  const hint = await win.evaluate(() => ({
    node: !!document.querySelector('.canvas-hint'),
    text: (document.body.innerText || '').includes('空白处拖框可批量选中')
  }));
  check('C补1 右下角那条"已选中元素…"提示已删除',
    !hint.node && !hint.text, `节点=${hint.node} 文案还在=${hint.text}`);

  // ---------- C补12：文字类元素插入后带默认文案 ----------
  const texts = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const types = ['strong', 'em', 'mark', 'small', 'code', 'del', 'blockquote', 'figcaption', 'h5', 'h6', 'sup', 'sub', 'pre'];
    const before = new Set((st.scene.root.children || []).map((c) => c.id));
    for (const t of types) st.addElement(t);
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    const fresh = kids.filter((c) => !before.has(c.id));
    return {
      total: fresh.length,
      withText: fresh.filter((c) => (c.text || '').trim().length > 0).length,
      sample: fresh.slice(0, 4).map((c) => `${c.type}:${(c.text || '').slice(0, 6)}`)
    };
  });
  check('C补12 文字类元素插入后都有默认文案（不再插出空盒子）',
    texts.total > 0 && texts.withText === texts.total,
    `${texts.withText}/${texts.total} 有文案 · ${texts.sample.join(' / ')}`);

  // ---------- C1：左侧布局下页签切换不跳动 ----------
  // 底部布局里页签是**竖排**在面板左侧（top 天然不同），用户反馈的是"左侧布局"下的横排页签。
  await win.evaluate(() => { localStorage.setItem('bc-layout', JSON.stringify('left')); });
  await win.reload();
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });
  await sleep(1200);
  const layout = await win.evaluate(() => document.querySelector('.workspace')?.getAttribute('data-layout'));
  const tabs = await win.evaluate(() => {
    const els = [...document.querySelectorAll('.element-panel .inspector-tab')];
    if (els.length < 3) return null;
    const rects = els.map((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) }; });
    return { count: els.length, tops: [...new Set(rects.map((r) => r.top))], heights: [...new Set(rects.map((r) => r.h))] };
  });
  check('C1 左侧布局下三个页签同一水平线、高度一致（切换不会上下跳）',
    layout === 'left' && !!tabs && tabs.tops.length === 1 && tabs.heights.length === 1,
    tabs ? `布局=${layout} 页签 ${tabs.count} 个 · top=${tabs.tops.join(',')} · height=${tabCount(tabs)}` : `找不到页签（布局=${layout}）`);

  // 切三个页签，量位置是否始终不变
  const stable = await win.evaluate(async () => {
    const btns = [...document.querySelectorAll('.element-panel .inspector-tab')];
    const readTop = () => [...document.querySelectorAll('.element-panel .inspector-tab')]
      .map((e) => Math.round(e.getBoundingClientRect().top));
    const first = readTop();
    for (const b of btns) { b.click(); await new Promise((r) => setTimeout(r, 180)); }
    const last = readTop();
    return { first, last, same: first.join(',') === last.join(',') };
  });

  check('C1 切换三个页签时页签位置始终不变',
    stable.same === true,
    `切换前 top=[${stable.first.join(',')}] 切换后=[${stable.last.join(',')}]`);

  // ---------- C补18：属性卡片退场动画改成滑到容器外 ----------
  const outAnim = await win.evaluate(() => {
    const hits = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules = [];
      try { rules = Array.from(sheet.cssRules || []); } catch { continue; }
      for (const r of rules) {
        if ((r.cssText || '').includes('propRowOut2')) hits.push(r.cssText);
      }
    }
    return { found: hits.length > 0, sample: (hits[0] || '').slice(0, 90) };
  });
  check('C补18 属性卡片退场改为整块滑出容器（新增 propRowOut2）',
    outAnim.found, outAnim.sample || '没找到关键帧');

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