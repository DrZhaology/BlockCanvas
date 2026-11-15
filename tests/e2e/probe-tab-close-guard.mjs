// v0.4.6 · 关闭标签的保存确认（用户："多标签页的页面关闭都没有保存不保存的提示"）
//
// 五条契约：
//   ① 脏标签请求关闭 → 弹确认框（三个按钮：保存并关闭 / 不保存 / 取消）
//   ② 点「取消」→ 标签还在，内容不动
//   ③ 点「不保存」→ 标签真的关掉
//   ④ 干净标签请求关闭 → **不弹框**，直接关
//   ⑤ 弹框是程序内的（不是系统原生 confirm）—— 本探针里会替换 window.confirm
//      成一个"一被调用就报错"的桩，所以只要用了原生弹窗，这条必红
//
// 用法：node tests/e2e/probe-tab-close-guard.mjs
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
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-close');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(300, 400);
    w.setContentSize(1280, 860);
    w.center();
  });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);

  // 原生弹窗桩：一被调用就记录下来（用来证明没用系统 confirm）
  await win.evaluate(() => {
    window.__nativeDialogUsed = 0;
    window.confirm = () => { window.__nativeDialogUsed++; return true; };
    window.alert = () => { window.__nativeDialogUsed++; };
  });

  // 建两个标签：A 脏、B 干净
  const ids = await win.evaluate(() => {
    const st = window.__tabStore.getState();
    const a = st.newTab('脏页面');
    const b = st.newTab('干净页面');
    // 让 A 变脏
    window.__tabStore.getState().switchTab(a);
    window.__sceneStore.getState().beginStyleEdit();
    window.__sceneStore.getState().addElement('div');
    window.__sceneStore.getState().endStyleEdit();
    window.__tabStore.getState().markActiveTabDirty(true);
    // ⚠ 新建的标签本身就算"未保存"（还没存过盘），所以要把 B 显式标成干净，
    //   才能验"干净标签不弹框"。这一步不是作弊：等价于用户已经存过一次盘。
    window.__tabStore.getState().switchTab(b);
    window.__tabStore.getState().markActiveTabDirty(false);
    window.__tabStore.getState().switchTab(a);
    return { a, b, tabs: window.__tabStore.getState().tabs.length };
  });
  await sleep(500);
  check('准备：两个标签，A 已标记未保存', ids.tabs === 2, JSON.stringify(ids));

  const dirtyOf = (id) => win.evaluate((x) => {
    const t = window.__tabStore.getState().tabs.find((k) => k.id === x);
    return t ? { exists: true, dirty: !!t.isDirty } : { exists: false };
  }, id);

  const dialogNow = () => win.evaluate(() => {
    const el = document.querySelector('.bc-confirm');
    if (!el) return { shown: false };
    return {
      shown: true,
      title: (el.querySelector('.bc-confirm-title')?.textContent || '').trim(),
      buttons: [...el.querySelectorAll('.bc-confirm-btn')].map((b) => (b.textContent || '').trim())
    };
  });

  // ① 脏标签 → 弹框
  await win.evaluate((x) => {
    window.dispatchEvent(new CustomEvent('bc:request-close-tab', { detail: { id: x } }));
  }, ids.a);
  await sleep(400);
  const dlg = await dialogNow();
  check('① 关闭未保存标签 → 弹出确认框', dlg.shown === true, JSON.stringify(dlg));
  check('① 确认框有三个选项：保存并关闭 / 不保存 / 取消',
    dlg.shown && dlg.buttons.length === 3
      && dlg.buttons.some((t) => t.includes('保存并关闭'))
      && dlg.buttons.some((t) => t.includes('不保存'))
      && dlg.buttons.some((t) => t.includes('取消')),
    (dlg.buttons || []).join(' / '));
  check('① 标题带上了标签名', dlg.shown && /脏页面/.test(dlg.title || ''), dlg.title);

  // ② 取消 → 标签还在
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.bc-confirm-btn')];
    btns.find((b) => (b.textContent || '').includes('取消'))?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(350);
  const afterCancel = await dirtyOf(ids.a);
  const dlgGone = await dialogNow();
  check('② 点「取消」→ 弹框关掉且标签仍在', dlgGone.shown === false && afterCancel.exists === true,
    JSON.stringify({ dlg: dlgGone.shown, tab: afterCancel }));

  // ③ 不保存 → 真的关掉
  await win.evaluate((x) => {
    window.dispatchEvent(new CustomEvent('bc:request-close-tab', { detail: { id: x } }));
  }, ids.a);
  await sleep(320);
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.bc-confirm-btn')];
    btns.find((b) => (b.textContent || '').includes('不保存'))?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(420);
  const afterDiscard = await dirtyOf(ids.a);
  check('③ 点「不保存」→ 标签被关掉', afterDiscard.exists === false, JSON.stringify(afterDiscard));

  // ④ 干净标签 → 不弹框直接关
  await win.evaluate((x) => {
    window.dispatchEvent(new CustomEvent('bc:request-close-tab', { detail: { id: x } }));
  }, ids.b);
  await sleep(400);
  const cleanDlg = await dialogNow();
  const afterClean = await dirtyOf(ids.b);
  check('④ 干净标签 → 不弹框，直接关', cleanDlg.shown === false && afterClean.exists === false,
    JSON.stringify({ dlg: cleanDlg.shown, tab: afterClean }));

  // ⑤ 全程没用系统原生弹窗
  const native = await win.evaluate(() => window.__nativeDialogUsed);
  check('⑤ 全程没有调用系统原生 confirm/alert', native === 0, `native=${native}`);

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
