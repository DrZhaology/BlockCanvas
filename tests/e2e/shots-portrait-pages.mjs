// v0.4.6 · 竖屏「子页面」截图：设置页 / 使用手册 / 项目中心 / 会话管理
//
// 为什么单独一个脚本：编辑器那套 shots-v046 只覆盖编辑器与抽屉，
// 而竖屏的子页面（设置三块、手册正文、项目卡片）是另一批布局，坏了看不出来。
// 这里在 412×860 下逐个页面截图并打印**横向溢出**与关键容器尺寸 ——
// 溢出为 0 且容器宽度 = 视口宽，才算这一页真的适配了。
//
// 用法：node tests/e2e/shots-portrait-pages.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = resolve(ROOT, 'tests/e2e/shots-portrait');

async function main() {
  mkdirSync(OUT, { recursive: true });
  const DATA_DIR = resolve(tmpdir(), 'bc-shots-portrait');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(300, 400);
    w.setContentSize(412, 860);
    w.center();
  });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);

  /** 量一页：横向溢出 + 主容器是否撑满视口 */
  const measure = (sel) => win.evaluate((s) => {
    const vw = document.documentElement.clientWidth;
    const root = document.querySelector(s);
    const r = root ? root.getBoundingClientRect() : null;
    const bad = [];
    for (const el of document.querySelectorAll('.app *')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      if (el.closest('.bc-hscroll, .tb-main, .bc-portal, .tb-more-panel, .bc-varmenu, [data-bc-avoid], .elem-pane-wrap, .right-pane-wrap, .pt-bar2-inner')) continue;
      if (b.right > vw + 1.5) bad.push({ cls: String(el.className || '').slice(0, 32), over: Math.round(b.right - vw) });
    }
    return {
      vw,
      docScrollW: document.documentElement.scrollWidth,
      rootW: r ? Math.round(r.width) : 0,
      rootH: r ? Math.round(r.height) : 0,
      badCount: bad.length,
      bad: bad.slice(0, 4),
      hasBar1: !!document.querySelector('.pt-bar1'),
      hasTop: !!document.querySelector('.bc-titlebar, .project-tab-bar')
    };
  }, sel);

  const shot = async (name) => {
    await win.screenshot({ path: resolve(OUT, `${name}.png`) });
  };

  const run = async (name, sel, open) => {
    await open();
    await sleep(1100);
    const m = await measure(sel);
    console.log(`${name}: ${JSON.stringify(m)}`);
    await shot(name);
  };

  // ① 设置页（竖屏）
  await run('10-settings', '.fluent-settings-page', async () => {
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:settings')));
  });

  // ② 使用手册
  await run('11-help', '.help-center, .help-page, .hc-page', async () => {
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:help')));
  });

  // ③ 项目中心
  await run('12-projects', '.pc-page, .projects-page', async () => {
    await win.evaluate(() => document.querySelector('.pt-bar1 .pt-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await sleep(300);
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:open-project')));
  });

  // ④ 会话管理
  await run('13-sessions', '.sess-page', async () => {
    await win.evaluate(() => {
      const btns = [...document.querySelectorAll('.pt-bar1 .pt-btn')];
      // 会话按钮是第 3 个（撤销/重做/会话/新建/入口）
      btns[btns.length - 3]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  });

  await app.close();
  console.log('\n截图目录：tests/e2e/shots-portrait/');
}

main().catch((e) => { console.error(e); process.exit(1); });
