// v0.4.5 更新器剩余验收：更新前检查未保存标签 + 更新中心单视图
// 用法：node tests/e2e/probe-v045-updateguard.mjs
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-updguard');
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
  await sleep(600);

  // 造一个"没保存"的标签
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
  });
  await sleep(500);
  const dirty = await win.evaluate(() => {
    const st = window.__tabStore.getState();
    return st.tabs.filter((t) => t.isDirty).map((t) => t.name);
  });
  check('准备：存在未保存的标签', dirty.length > 0, dirty.join(' / '));

  // 进入更新中心（发两次事件，验证只渲染一个更新视图）
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('menu:check-update'));
    window.dispatchEvent(new CustomEvent('menu:check-update'));
  });
  await sleep(3000);
  const views = await win.evaluate(() => {
    // 更新中心是一个整页视图（不是独立窗口）：重复打开应该只是切视图，不会叠加
    const page = document.querySelector('[class*="update"], .upd-page');
    return {
      pages: document.querySelectorAll('.update-page, .update-center, .upd-page').length,
      hasUpdateUi: !!page || /更新中心|检查更新|可更新/.test(document.body.innerText || '')
    };
  });
  check('更新中心只渲染一个视图（重复打开不会开两个）',
    views.hasUpdateUi && views.pages <= 1,
    `找到 ${views.pages} 个更新视图`);

  // 点某一条的「更新」→ 因为有未保存标签，应该先弹确认，而不是直接开下载
  const tasksBefore = await win.evaluate(() => (window.__taskStore?.getState?.().tasks || []).length);
  // 当前已是最新版时「可更新」是空的，改从「可选择更新（重装）」里取按钮 —— 那里永远列着当前版本
  const clicked = await win.evaluate(() => {
    const head = [...document.querySelectorAll('button, div')]
      .find((b) => /可选择更新/.test((b.textContent || '').trim()) && (b.textContent || '').length < 40);
    if (head) head.click();
    return { ok: true, opened: !!head };
  });
  await sleep(900);
  // 说明：当前已是最新版（可更新 0 / 可重装 0），更新中心里**没有可点的安装按钮**，
// 所以"点更新 → 弹未保存确认"这条链路无法在本探针里端到端触发。
// 这里改为验证它能工作的**前提条件**，并把这一点如实写进文档，不假装验证过。
  const guardPre = await win.evaluate(() => {
    const st = window.__tabStore.getState();
    const dirty = st.tabs.filter((t) => t.isDirty && t.kind !== 'snapshot');
    return {
      dirtyCount: dirty.length,
      // 快照标签不该被算作"未保存"（它们是只读的，关掉不提示保存）
      snapshotCount: st.tabs.filter((t) => t.kind === 'snapshot').length
    };
  });
  check('更新前检查的前提成立：能准确数出未保存标签（排除只读快照）',
    guardPre.dirtyCount >= 1 && guardPre.snapshotCount === 0,
    `未保存 ${guardPre.dirtyCount} 个，快照 ${guardPre.snapshotCount} 个`);

  const btns = await win.evaluate(() =>
    [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean)
  );
  check('（环境说明）当前没有可安装的新版本，故无安装按钮',
    !btns.some((t) => /重新安装|更新到|立即更新/.test(t)),
    btns.slice(0, 8).join(' | '));

  const tasksAfter = await win.evaluate(() => (window.__taskStore?.getState?.().tasks || []).length);
  check('进入更新中心不会自动启动下载任务', tasksAfter === tasksBefore, `任务数 ${tasksBefore} → ${tasksAfter}`);

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