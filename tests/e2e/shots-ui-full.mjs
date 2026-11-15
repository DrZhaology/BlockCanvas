// ============================================================================
// v0.4.6 · 全量 UI 检查（竖屏为主，逐屏截图 + 硬数字）
// ----------------------------------------------------------------------------
// 用户原话：「完成所有的任务之后……这一轮完成后做全量 UI 检查。特别是竖屏 UI。
//             每个界面都要做。」「全量UI检查是为了检测UI，反复修改UI用的」
//
// 用法：node tests/e2e/shots-ui-full.mjs
// 产物：tests/e2e/shots-ui-full/*.png （生成物，不入库）
// 每屏都打印：横向溢出条数 / 根容器尺寸 / 关键结构存在性，
// 所以"数字干净但布局挤压"这类假绿还得靠人眼看缩略图总览（contact-sheet.png）。
// ============================================================================
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const OUT = resolve(ROOT, 'tests/e2e/shots-ui-full');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const DATA_DIR = resolve(tmpdir(), 'bc-shots-uifull');
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
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); w.blur(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await win.waitForFunction(() => !document.querySelector('.bc-loading'), { timeout: 15000 }).catch(() => {});
  await sleep(700);

  /** 量一屏：横向溢出 + 根容器 + 结构存在性 */
  const measure = (sel) => win.evaluate((s) => {
    const vw = document.documentElement.clientWidth;
    const root = s ? document.querySelector(s) : null;
    const r = root ? root.getBoundingClientRect() : null;
    const skip = '.bc-hscroll, .tb-main, .tb-more-panel, .bc-portal, .bc-varmenu, [data-bc-avoid], .elem-pane-wrap, .right-pane-wrap, .pt-bar2-inner, .pt-menu-panel, .sess-thumb, .layer-menu, .bc-pop, .fluent-sidebar, .help-toc, .help-doc-tabs';
    const bad = [];
    for (const el of document.querySelectorAll('.app *')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      if (el.closest(skip)) continue;
      if (b.right > vw + 1.5) bad.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 34), over: Math.round(b.right - vw), w: Math.round(b.width) });
    }
    return {
      vw,
      rootW: r ? Math.round(r.width) : 0,
      rootH: r ? Math.round(r.height) : 0,
      badCount: bad.length,
      bad: bad.slice(0, 3),
      bar1: !!document.querySelector('.pt-bar1'),
      bar2: !!document.querySelector('.pt-bar2'),
      topbar: !!document.querySelector('.bc-titlebar, .project-tab-bar')
    };
  }, sel);

  const shot = async (name) => win.screenshot({ path: resolve(OUT, name + '.png') });
  const stop = async (name, sel) => {
    await sleep(500);
    const m = await measure(sel);
    console.log(`${name}  ${JSON.stringify(m)}`);
    await shot(name);
  };

  /* ① 首页（还没开项目） */
  await stop('01-home', '.empty-home');

  /* 建项目 */
  await win.locator('.eh-actions .eh-btn', { hasText: '新建项目' }).first().click();
  await sleep(1500);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  /* 竖屏：unmaximize 再 setSize（最大化时 setSize 会被忽略） */
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); });
  await sleep(200);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(412, 860); w.center(); w.blur(); });
  await sleep(900);

  /* 再造两个标签页（竖屏第一条栏的真按钮，会话页才有卡片可看） */
  for (let i = 0; i < 2; i++) {
    await win.locator('.pt-bar1 .pt-btn[aria-label="新建页面"]').click();
    await sleep(700);
  }
  await sleep(600);

  /* 造点内容：一个红块 + 一段文字，图层树才有层级可看（当前页 = 最后新建的那页） */
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    let root = window.__sceneStore.getState().scene.root;
    const box = root.children[root.children.length - 1];
    window.__sceneStore.getState().updateStyle(box.id, {
      width: '320px', height: '160px', background: '#ef4444', borderRadius: '12px', margin: '24px auto'
    });
    window.__sceneStore.getState().addElement('p');
    root = window.__sceneStore.getState().scene.root;
    const p = root.children[root.children.length - 1];
    window.__sceneStore.getState().setText(p.id, '你好，BlockCanvas');
    window.__sceneStore.getState().updateStyle(p.id, { textAlign: 'center', fontSize: '20px', color: '#334155' });
  });
  await sleep(600);

  /* ② 编辑器主界面（第二条栏折叠态） */
  await stop('02-editor', '.workspace');

  /* ③ 第二条栏展开态：长按 420ms 再上滑（起点压在第二条栏内部，别滑到栏外，
        否则 pointermove 落在画布上，栏收不到事件就"长按没反应"） */
  const bar2Box = await win.locator('.pt-bar2').boundingBox();
  if (bar2Box) {
    const cx = Math.round(bar2Box.x + bar2Box.width / 2);
    const y0 = Math.round(bar2Box.y + bar2Box.height - 8);
    await win.mouse.move(cx, y0);
    await win.mouse.down();
    await sleep(460);
    await win.mouse.move(cx, y0 - 30, { steps: 5 });
    await win.mouse.up();
    await sleep(520);
    const exp = await win.evaluate(() => {
      const b = document.querySelector('.pt-bar2');
      return { cls: b?.className, h: Math.round(b?.getBoundingClientRect().height || 0) };
    });
    console.log('03-bar2-expanded  ' + JSON.stringify(exp));
    await shot('03-bar2-expanded');
    // 收回（同理，起点往下滑一点点，全程留在栏内）
    const box2 = await win.locator('.pt-bar2').boundingBox();
    const y1 = Math.round(box2.y + box2.height - 30);
    await win.mouse.move(cx, y1);
    await win.mouse.down();
    await sleep(460);
    await win.mouse.move(cx, y1 + 20, { steps: 5 });
    await win.mouse.up();
    await sleep(520);
  }

  /* ④ 更多菜单 */
  await win.locator('.tb-more-btn').click();
  await stop('04-more-menu', '.pt-bar2');
  await win.keyboard.press('Escape');
  await sleep(300);

  /* ⑤ 设备菜单 */
  await win.locator('.tb-device-pt-btn').click();
  await stop('05-device-menu', '.pt-bar2');
  await win.keyboard.press('Escape');
  await sleep(300);

  /* ⑥ 入口菜单（三） */
  await win.locator('.pt-entry > .pt-btn').click();
  await stop('06-entry-menu', '.pt-bar1');
  await win.mouse.click(200, 300);
  await sleep(300);

  /* ⑦ 下方图层面板 */
  await win.locator('.pt-layer-btn').click();
  await stop('07-layers', '.pt-sheet');

  /* ⑧ 图层行长按菜单（长按 600ms 再松手） */
  const row = await win.locator('.pt-sheet .layer-row').nth(2).boundingBox();
  if (row) {
    await win.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
    await win.mouse.down();
    await sleep(600);
    await win.mouse.up();
    await sleep(300);
    const hasMenu = await win.evaluate(() => !!document.querySelector('.layer-menu'));
    console.log('08-layer-menu  ' + JSON.stringify({ hasMenu }));
    await shot('08-layer-menu');
    await win.mouse.click(200, 200);
    await sleep(250);
  }

  /* ⑨ 切到属性 → 面板收起 + 右侧抽屉打开 */
  await win.locator('.pt-sheet-tab', { hasText: '属性' }).click();
  await sleep(700);
  const afterProps = await win.evaluate(() => ({
    sheetOpen: !!document.querySelector('.pt-sheet.is-open'),
    drawer: document.querySelector('.workspace')?.getAttribute('data-drawer')
  }));
  console.log('09-right-drawer  ' + JSON.stringify(afterProps));
  await shot('09-right-drawer');

  /* ⑩ 左侧元素抽屉 */
  await win.mouse.click(395, 300);
  await sleep(400);
  await win.locator('.shell-drawer-btn.is-left').click();
  await stop('10-left-drawer', '.elem-pane-wrap');
  await win.mouse.click(395, 300);
  await sleep(400);

  /* ⑪ 会话管理页 */
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.pt-bar1 .pt-btn')];
    btns[btns.length - 3]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await stop('11-sessions', '.sess-page');
  const thumbs = await win.evaluate(() => [...document.querySelectorAll('.sess-thumb')].map((t) => {
    const r = t.getBoundingClientRect();
    const f = t.querySelector('iframe');
    const fr = f ? f.getBoundingClientRect() : null;
    return {
      h: Math.round(r.height),
      ov: getComputedStyle(t).overflow,
      fh: fr ? Math.round(fr.height) : 0,
      fw: fr ? Math.round(fr.width) : 0,
      tf: f ? getComputedStyle(f).transform : 'none'
    };
  }));
  console.log('11b-thumbs  ' + JSON.stringify(thumbs));

  /* ⑫ 会话卡 ×：脏标签 → 贴 × 的二级菜单 */
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const r = st.scene.root;
    const first = r.children[0];
    if (first) st.updateStyle(first.id, { opacity: '0.9' }); // 制造未保存状态
  });
  await sleep(300);
  const closers = win.locator('.sess-close');
  const dirtyIdx = await win.evaluate(() => {
    const cards = [...document.querySelectorAll('.sess-card')];
    return Math.max(0, cards.findIndex((c) => c.classList.contains('is-active')));
  });
  await closers.nth(dirtyIdx).click();
  await sleep(500);
  const pop = await win.evaluate(() => {
    // v0.4.6 第三十九批之后：确认面板画在**卡片内部**（.sess-confirm），不再是浮层
    const p = document.querySelector('.sess-confirm');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    const card = p.closest('.sess-card')?.getBoundingClientRect();
    return {
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      innerCard: Boolean(card) && r.bottom <= card.bottom + 1
    };
  });
  console.log('12-session-confirm  ' + JSON.stringify({
    dirtyIdx,
    pop,
    fullscreen: await win.evaluate(() => !!document.querySelector('.bc-confirm-scrim, .bc-confirm-pop'))
  }));
  await shot('12-session-confirm');
  await win.locator('.sess-confirm .sess-cbtn', { hasText: '取消' }).click();
  await sleep(300);

  /* ⑬ 宽屏回归：并排形态不能被动坏（点一张会话卡回到编辑器） */
  await win.locator('.sess-card').first().click();
  await sleep(600);

  /* ⑫b 程序内预览：竖屏点「预览」不走系统浏览器，而是整屏 iframe + 第一条栏留返回。
         这里直接注入一份测试 HTML（绕过"导出前体检"向导，那条逻辑另有探针管）。 */
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:inapp-preview', {
    detail: { html: '<!doctype html><meta charset=utf-8><body style="margin:0;font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh"><h1>程序内预览 OK</h1></body>' }
  })));
  await sleep(700);
  const preview = await win.evaluate(() => ({
    frame: !!document.querySelector('.bc-preview-frame'),
    bar1: !!document.querySelector('.pt-bar1'),
    bar2: !!document.querySelector('.pt-bar2'),
    frameH: Math.round(document.querySelector('.bc-preview-frame')?.getBoundingClientRect().height || 0)
  }));
  console.log('13a-preview  ' + JSON.stringify(preview));
  await shot('13a-preview');
  // 返回编辑器：第一条栏最左那颗（子页面形态下是「返回」）
  await win.locator('.pt-bar1 .pt-btn[aria-label="返回"]').click();
  await sleep(600);

  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); w.blur(); });
  await sleep(900);
  const wide = await win.evaluate(() => ({
    shell: document.querySelector('.app')?.getAttribute('data-shell'),
    bars: document.querySelectorAll('.pt-bar').length,
    paneW: Math.round(document.querySelector('.right-pane-wrap')?.getBoundingClientRect().width || 0),
    canvasW: Math.round(document.querySelector('.canvas')?.getBoundingClientRect().width || 0)
  }));
  console.log('13-wide  ' + JSON.stringify(wide));
  await shot('13-wide');

  /* 回到竖屏，继续子页面 */
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(412, 860); w.center(); w.blur(); });
  await sleep(900);

  /* ⑭ 设置：一级分类列表 → 二级具体设置页（v0.4.6 两级导航） */
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:settings')));
  await stop('14-settings-list', '.set-list');
  await win.locator('.set-list-card', { hasText: '竖屏与触摸' }).click();
  await sleep(400);
  const setDetail = await win.evaluate(() => ({
    listGone: !document.querySelector('.set-list'),
    head: document.querySelector('.set-detail-title')?.textContent ?? null,
    backBtn: !!document.querySelector('.fluent-back-btn')
  }));
  console.log('15a-settings-detail  ' + JSON.stringify(setDetail));
  await stop('15-settings-detail', '.fluent-content');
  // 官方返回路径：第一条栏的「返回」应该回到分类列表（不是直接回编辑器）
  await win.locator('.pt-bar1 .pt-btn[aria-label="返回"]').click();
  await sleep(500);
  const backTo = await win.evaluate(() => ({
    listBack: !!document.querySelector('.set-list'),
    page: !!document.querySelector('.fluent-settings-page')
  }));
  console.log('15b-settings-back  ' + JSON.stringify(backTo));

  /* ⑯ 使用手册 + 侧边栏抽屉（v0.4.6：第一条栏最左多一颗「侧边栏」） */
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:help')));
  await stop('16-help', '.help-center, .help-page, .hc-page');
  const helpBar1 = await win.evaluate(() => [...document.querySelectorAll('.pt-bar1 .pt-btn')].map((b) => b.getAttribute('aria-label')));
  console.log('16a-help-bar1  ' + JSON.stringify(helpBar1));
  await win.locator('.pt-bar1 .pt-btn[aria-label="侧边栏"]').click();
  await sleep(520);
  const drawer = await win.evaluate(() => {
    const d = document.querySelector('.help-drawer');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      tabs: d.querySelectorAll('.help-doc-tab').length,
      toc: d.querySelectorAll('.help-toc-item').length,
      hasSearch: !!d.querySelector('.help-search-input'),
      bottom: Math.round(r.bottom)
    };
  });
  console.log('16b-help-drawer  ' + JSON.stringify(drawer));
  await shot('16a-help-drawer');
  await win.locator('.help-drawer-close').click();
  await sleep(320);

  /* ⑰ 项目中心：先从手册页返回编辑器，再点第二条栏的「全部项目」 */
  await win.locator('.pt-bar1 .pt-btn[aria-label="返回"]').click();
  await sleep(800);
  const projBtn = win.locator('.pt-bar2 .tb-main button', { hasText: '项目' }).first();
  await projBtn.click().catch(async () => {
    // 折叠态里它可能被横滑出视野：先展开第二条栏再点
    await win.evaluate(() => {
      const b = document.querySelector('.pt-bar2');
      if (b && !b.classList.contains('is-expanded')) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sleep(500);
    await win.locator('.pt-bar2 .tb-main button', { hasText: '项目' }).first().click();
  });
  await stop('17-projects', '.pc-page');

  /* ⑱ 新建页面两段式动画取证：out（旧画布左移）→ in（新画布右进）→ null（收尾） */
  await win.locator('.pt-bar1 .pt-btn[aria-label="返回"]').click();
  await sleep(900);
  const animNow = () => win.evaluate(() => document.querySelector('.app')?.getAttribute('data-newpage'));
  await win.locator('.pt-bar1 .pt-btn[aria-label="新建页面"]').click();
  await sleep(70);
  const phase1 = await animNow();
  await sleep(240);
  const phase2 = await animNow();
  await sleep(500);
  const phase3 = await animNow();
  console.log('18-newpage-anim  ' + JSON.stringify({ out: phase1, in: phase2, end: phase3 }));

  console.log('页面错误 ' + (errs.length ? errs.join(' | ') : 'none'));
  await app.close();
};

main().catch((e) => { console.error(e); process.exit(1); });
