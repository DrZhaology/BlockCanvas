// v0.4.5 第四批（用户反馈）验收：性能 + 一批明确的 UI 问题
// 用法：node tests/e2e/probe-v045-perf.mjs
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from 'fs';

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

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-perf');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  // 造 60 个素材，模拟"用户放了很多图"的场景
  const cacheDir = join(DATA_DIR, 'cache', 'assets');
  mkdirSync(cacheDir, { recursive: true });
  for (let i = 0; i < 60; i++) {
    writeFileSync(join(cacheDir, `a${String(i).padStart(14, '0')}.png`), PNG_1X1);
  }

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(800);

  // ---------- A2：窗口变矮也要居中 ----------
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1200, 620); });
  await sleep(600);
  const shortWin = await win.evaluate(() => {
    const home = document.querySelector('.empty-home');
    const c = document.querySelector('.eh-center');
    if (!home || !c) return null;
    const cs = getComputedStyle(home);
    const hr = home.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    return { align: cs.alignItems, top: Math.round(cr.top - hr.top), bottom: Math.round(hr.bottom - cr.bottom) };
  });
  check('A2 窗口变矮后首页仍然居中（不再跑到顶上）',
    !!shortWin && shortWin.align === 'center',
    shortWin ? `align-items=${shortWin.align} 上${shortWin.top} 下${shortWin.bottom}` : '找不到首页');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); });
  await sleep(500);

  // ---------- C补6：性能 ----------
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // 插几张图片元素，检查是否带 lazy/decoding
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    for (let i = 0; i < 3; i++) st.addElement('img');
    const s2 = window.__sceneStore.getState();
    (s2.scene.root.children || []).forEach((c, i) => {
      if (c.type === 'img') window.__sceneStore.getState().updateAttr(c.id, 'src', `https://example.com/p${i}.jpg`);
    });
  });
  await sleep(900);
  const imgPerf = await win.evaluate(() => {
    const imgs = [...document.querySelectorAll('.canvas img')];
    return {
      count: imgs.length,
      lazy: imgs.filter((i) => i.getAttribute('loading') === 'lazy').length,
      async: imgs.filter((i) => i.getAttribute('decoding') === 'async').length
    };
  });
  check('C补6 画布图片启用懒加载（不再一次性解码全部大图）',
    imgPerf.count > 0 && imgPerf.lazy === imgPerf.count,
    `${imgPerf.lazy}/${imgPerf.count} 张带 loading=lazy`);
  check('C补6 图片解码改为异步（不阻塞主线程）',
    imgPerf.async === imgPerf.count, `${imgPerf.async}/${imgPerf.count} 张带 decoding=async`);

  // 视频：未选中时不预载
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('video');
    const s2 = window.__sceneStore.getState();
    const v = (s2.scene.root.children || []).find((c) => c.type === 'video');
    if (v) s2.updateAttr(v.id, 'src', 'https://example.com/v.mp4');
  });
  await sleep(800);
  const vidPreload = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    // 先取消选中，再看未选中的视频是否 preload=none
    st.selectElement(null);
    return null;
  });
  void vidPreload;
  await sleep(500);
  const vidPreload2 = await win.evaluate(() => {
    const v = document.querySelector('.canvas video');
    return { preload: v ? v.getAttribute('preload') : '', selectedCount: document.querySelectorAll('.canvas [data-bc-sel="1"]').length };
  });
  check('C补6 未选中的视频不预载（避免多个视频一起吃 GPU）',
    vidPreload2.preload === 'none',
    `preload=${vidPreload2.preload} 选中数=${vidPreload2.selectedCount}`);

  // 素材库：只渲染第一批，避免 60 张一次性铺开
  await win.evaluate(() => {
    const btn = [...document.querySelectorAll('.inspector-tab')].find((b) => (b.textContent || '').trim() === '素材');
    if (btn) btn.click();
  });
  await sleep(1200);
  const gallery = await win.evaluate(() => {
    const items = document.querySelectorAll('.asset-item');
    const imgs = [...document.querySelectorAll('.asset-thumb img')];
    return {
      items: items.length,
      lazyImgs: imgs.filter((i) => i.getAttribute('loading') === 'lazy').length,
      imgs: imgs.length,
      hasMore: !!document.querySelector('.asset-gallery-more'),
      cv: items.length ? getComputedStyle(items[0]).contentVisibility : ''
    };
  });
  check('C补6 素材库分批渲染（60 个素材不会一次全挂上 DOM）',
    gallery.items > 0 && gallery.items <= 40 && gallery.hasMore,
    `渲染 ${gallery.items} 个，有"显示更多"=${gallery.hasMore}`);
  check('C补6 素材缩略图懒加载 + 视口外不排版',
    gallery.imgs > 0 && gallery.lazyImgs === gallery.imgs && gallery.cv === 'auto',
    `lazy ${gallery.lazyImgs}/${gallery.imgs}，content-visibility=${gallery.cv}`);

  // ---------- C补11：选中不再闪烁 ----------
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const ids = (st.scene.root.children || []).map((c) => c.id).slice(0, 3);
    st.selectMany(ids);
  });
  await sleep(900);
  const sel = await win.evaluate(() => {
    const els = [...document.querySelectorAll('.canvas [data-bc-sel="1"]')];
    const st = window.__sceneStore.getState();
    return {
      count: els.length,
      selectedIds: (st.scene.selectedIds || []).length,
      childTypes: (st.scene.root.children || []).map((c) => c.type).join(','),
      names: [...new Set(els.map((e) => getComputedStyle(e).animationName))],
      infinite: els.map((e) => getComputedStyle(e).animationIterationCount)
    };
  });
  console.log('DEBUG 选中:', JSON.stringify(sel));
  // 直接校验样式表：选中态规则里不能再出现 infinite 动画
  const blinkRules = await win.evaluate(() => {
    const hits = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules = [];
      try { rules = Array.from(sheet.cssRules || []); } catch { continue; }
      for (const r of rules) {
        const txt = r.cssText || '';
        if (txt.includes('data-bc-sel') || txt.includes('canvas-inline-sel')) hits.push(txt);
      }
    }
    const infinite = hits.filter((t) => /infinite/.test(t));
    return { total: hits.length, infinite: infinite.length, sample: (infinite[0] || hits[0] || '').slice(0, 100) };
  });
  check('C补11 选中边框不再有无限闪烁动画（直接校验样式表）',
    blinkRules.infinite === 0,
    `选中态规则 ${blinkRules.total} 条，其中 infinite ${blinkRules.infinite} 条`);
  check('C补11 多选状态本身是生效的（selectedIds ≥ 2）',
    sel.selectedIds >= 2, `selectedIds=${sel.selectedIds}，元素类型 ${sel.childTypes}`);

  // ---------- N：设置页居中 ----------
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:settings')));
  await sleep(1200);
  const settings = await win.evaluate(() => {
    const el = document.querySelector('.fluent-content');
    if (!el) return null;
    const cs = getComputedStyle(el);
    // 关键：margin-left / margin-right 解析后应该相等（都是 auto 时会被均分）
    return {
      marginLeft: Math.round(parseFloat(cs.marginLeft) || 0),
      marginRight: Math.round(parseFloat(cs.marginRight) || 0),
      maxWidth: cs.maxWidth
    };
  });
  check('N 设置页正文左右外边距均分（不再整体贴左）',
    !!settings && Math.abs(settings.marginLeft - settings.marginRight) <= 2,
    settings ? `margin-left=${settings.marginLeft} margin-right=${settings.marginRight} max-width=${settings.maxWidth}` : '找不到 .fluent-content');

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