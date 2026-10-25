// v0.4.5 第十批探针：只读快照单一右侧面板（J）+ 项目中心「外部」说明
// 用法：node tests/e2e/probe-v045-snapshot-ui.mjs
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

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-snapui');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'projects'), { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(900);

  // ==========================================================================
  // A. 项目中心：「外部」说明
  // ==========================================================================
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-projects')));
  await sleep(900);
  const pc = await win.evaluate(() => {
    const ex = document.querySelector('.pc-explain');
    const badge = document.querySelector('.pc-badge.is-external');
    return {
      onPage: !!document.querySelector('.pc-page, .pc-header'),
      hasExplain: !!ex,
      explainText: (ex?.textContent || '').trim(),
      explainTip: ex?.getAttribute('title') || '',
      badgeTip: badge?.getAttribute('title') || ''
    };
  });
  check('项目中心表头有「『外部』是什么？」常显说明', pc.onPage && pc.hasExplain && pc.explainText.includes('外部'), JSON.stringify({ has: pc.hasExplain, text: pc.explainText }));
  check('说明里讲清了"外部 = 文件不在默认目录"',
    /不在默认|别处|data\/projects/.test(pc.explainTip) && /外部位置/.test(pc.explainTip),
    pc.explainTip.slice(0, 60));
  check('「外部」徽章的悬停提示也补全了（含具体路径与后果）',
    pc.badgeTip === '' || (/文件不在默认|外部位置/.test(pc.badgeTip) && /文件已丢失/.test(pc.badgeTip)),
    pc.badgeTip.slice(0, 60) || '（当前没有外部工程，跳过）');

  // 回到编辑器
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:set-layout', { detail: 'bottom' })));
  await sleep(300);
  await win.locator('.pc-back-btn').first().click().catch(() => {});
  await sleep(800);

  // ==========================================================================
  // B. 只读快照：单一右侧面板
  // ==========================================================================
  // 直接开一个 snapshot 标签（比造真实快照文件稳定，且验的正是 UI 结构）
  const opened = await win.evaluate(() => {
    const st = window.__tabStore.getState();
    const scene = window.__sceneStore.getState().scene;
    const id = st.newTab('快照演示', scene, null, undefined, 'snapshot', {
      projectName: '快照演示工程',
      projectPath: 'C:/demo/demo.bcproj',
      snapshotPath: 'C:/demo/backups/snap-2026.bcproj',
      takenAt: new Date('2026-01-02T03:04:05Z').toISOString()
    });
    return id;
  });
  check('准备：成功打开一个只读快照标签', !!opened, String(opened));
  await sleep(900);

  const layout = await win.evaluate(() => {
    const bar = document.querySelector('.snapshot-bar');
    const notice = document.querySelector('.snapshot-notice');
    const info = document.querySelector('.snapshot-info-solo');
    const elemPane = document.querySelector('.elem-pane-wrap');
    const toolbar = document.querySelector('.toolbar');
    const resizer = document.querySelector('.panel-resizer-vertical');
    const ws = document.querySelector('.workspace');
    const right = document.querySelector('.right-pane-wrap');
    return {
      hasBar: !!bar,
      hasNotice: !!notice,
      hasInfo: !!info,
      hasElemPane: !!elemPane,
      hasToolbar: !!toolbar,
      hasResizer: !!resizer,
      isReadonly: !!ws && ws.classList.contains('is-readonly'),
      rightW: right ? Math.round(right.getBoundingClientRect().width) : -1,
      infoText: (info?.textContent || '').replace(/\s+/g, ' ').slice(0, 80),
      actionCount: info ? info.querySelectorAll('.snap-btn').length : 0
    };
  });

  check('只读模式下**没有**顶部快照条（信息不再散在顶栏）', layout.isReadonly && layout.hasBar === false, JSON.stringify({ bar: layout.hasBar, ro: layout.isReadonly }));
  check('只读模式下左侧元素面板整块不渲染（不占画布）', layout.hasElemPane === false, String(layout.hasElemPane));
  check('只读模式下也没有旧的左侧说明块', layout.hasNotice === false, String(layout.hasNotice));
  check('所有信息与动作都在**右侧那一张**面板里', layout.hasInfo && layout.actionCount === 3, JSON.stringify({ info: layout.hasInfo, actions: layout.actionCount }));
  check('右侧面板宽度固定（不读写用户拖过的宽度）', layout.rightW === 372, `${layout.rightW}px`);
  check('只读模式下没有面板拖手（宽度不可改，避免"拖了也不保存"的困惑）', layout.hasResizer === false, String(layout.hasResizer));
  check('说明文字里讲清了三个动作各自的后果',
    /覆盖回项目/.test(layout.infoText) && /另存为新项目/.test(layout.infoText), layout.infoText);

  // 退出预览 → 编辑器布局与宽度恢复
  await win.evaluate(() => {
    const st = window.__tabStore.getState();
    st.closeTab(st.activeTabId);
  });
  await sleep(900);
  const back = await win.evaluate(() => {
    const ws = document.querySelector('.workspace');
    const right = document.querySelector('.right-pane-wrap');
    const elem = document.querySelector('.elem-pane-wrap');
    return {
      isReadonly: !!ws && ws.classList.contains('is-readonly'),
      rightW: right ? Math.round(right.getBoundingClientRect().width) : -1,
      hasElem: !!elem,
      hasToolbar: !!document.querySelector('.toolbar'),
      hasResizer: !!document.querySelector('.panel-resizer-vertical')
    };
  });
  check('退出预览后编辑器布局原样恢复（宽度回到用户自己的值、面板与工具条都回来）',
    back.isReadonly === false && back.rightW !== 372 && back.hasElem && back.hasToolbar && back.hasResizer,
    JSON.stringify(back));

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 第十批探针（快照面板 + 外部说明）：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });