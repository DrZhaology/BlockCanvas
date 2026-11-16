// 验收：走正式「导出 HTML」通道（BC_AUTO_EXPORT_DIR），然后检查行内 CSS + 全页截图
import { createRequire } from 'module';
import { resolve } from 'path';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const OUT = resolve(ROOT, 'tests/e2e/shots-diag/promo-site');
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const env = {
    ...process.env,
    BC_DATA_DIR: resolve(ROOT, 'data'),
    BC_AUTO_EXPORT_DIR: OUT
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  win.setDefaultTimeout(20000);
  await sleep(1600);
  /**
   * ⚠ 必须像工程中心那样**真的把场景塞进标签**：
   *   `openProjectFile` 只是把文件读出来返回 `{ok, project:{scene}, history, path}`，
   *   **它不会自己打开标签**（那是 ProjectsCenter 里 `newTab(...)` 干的）。
   *   上一版探针只调了 openProjectFile 就以为打开了 —— 场景还是启动时的空 div，
   *   于是导出了一个空页面（121 个行内样式就是这么来的：那个空 div 没有类名）。
   */
  const opened = await win.evaluate(async () => {
    const list = await window.bc.listProjects();
    const t = (list || []).find((p) => String(p.name || '').includes('宣传页'));
    if (!t) return { ok: false, why: 'not found' };
    const res = await window.bc.openProjectFile(t.filePath);
    if (!res?.ok || !res.project?.scene) return { ok: false, why: 'read failed', err: res?.error };
    const st = window.__tabStore.getState();
    const norm = (x) => String(x || '').replace(/[\\/]+/g, '/').toLowerCase();
    const existing = st.tabs.find((x) => x.filePath && norm(x.filePath) === norm(t.filePath));
    if (existing) st.switchTab(existing.id);
    else st.newTab(t.name, res.project.scene, t.filePath, res.history);
    return { ok: true, name: t.name };
  });
  console.log('打开：' + JSON.stringify(opened));
  await sleep(2200);

  // ⚠ 必须先确认"当前活动标签就是宣传页"，否则导出的是别的旧页面（上一版就导错了页）
  const active = await win.evaluate(() => {
    const st = window.__tabStore.getState();
    const tab = st.tabs.find((t) => t.id === st.activeTabId);
    const scene = window.__sceneStore.getState().scene;
    let withCls = 0; let total = 0;
    (function w(n) { total += 1; if (String((n.attrs || {}).className || '').trim()) withCls += 1; (n.children || []).forEach(w); })(scene.root);
    return { tabName: tab?.name, tabCount: st.tabs.length, activeId: st.activeTabId, withCls, total };
  });
  console.log('活动标签：' + JSON.stringify(active));

  // 点真正的「导出 HTML」按钮（走体检闸门 → 若有阻断会弹向导，这里先点一次放行）
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    btns.find((b) => (b.textContent || '').includes('导出 HTML'))?.click();
  });
  await sleep(2500);
  // 若弹出体检向导，点"继续"
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const go = btns.find((b) => /^继续|一键修复全部后继续|仍然导出/.test((b.textContent || '').trim()));
    go?.click();
  });
  await sleep(2500);
  await app.close();

  const file = resolve(OUT, 'index.html');
  if (!existsSync(file)) {
    console.log('没找到导出文件：' + file);
    process.exit(1);
  }
  const html = readFileSync(file, 'utf8');
  const inlineCount = (html.match(/\sstyle="/g) || []).length;
  const classCount = (html.match(/\sclass="/g) || []).length;
  const styleBlocks = (html.match(/<style/g) || []).length;
  console.log('导出结果：' + JSON.stringify({ kb: Math.round(html.length / 1024), inlineStyle: inlineCount, classAttrs: classCount, styleTags: styleBlocks }));

  // 用 electron 当浏览器全页截图
  const env2 = { ...process.env };
  delete env2.ELECTRON_RUN_AS_NODE;
  const app2 = await electron.launch({ args: ['--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env: env2 });
  const page = await app2.firstWindow();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('file:///' + file.replace(/\\/g, '/'));
  await sleep(1500);
  const m1 = await page.evaluate(() => ({
    h: document.documentElement.scrollHeight,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  }));
  await page.screenshot({ path: 'tests/e2e/shots-diag/promo-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(800);
  const m2 = await page.evaluate(() => ({
    h: document.documentElement.scrollHeight,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  }));
  await page.screenshot({ path: 'tests/e2e/shots-diag/promo-mobile.png', fullPage: true });
  console.log('桌面：' + JSON.stringify(m1) + '  手机：' + JSON.stringify(m2));
  await app2.close();
};
main().catch((e) => { console.error(e); process.exit(1); });
