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
  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
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
  // A. 项目中心：表头小问号 + 项目类型标注（v0.4.5 第 14 批改版）
  // ==========================================================================
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-projects')));
  await sleep(900);
  const pcBefore = await win.evaluate(() => ({
    onPage: !!document.querySelector('.pc-page, .pc-header'),
    hasHelpBtn: !!document.querySelector('.pc-kindhelp-btn'),
    popOpen: !!document.querySelector('.pc-kindhelp-pop'),
    // 每个卡片都必须有一个类型徽章
    cards: [...document.querySelectorAll('.pc-card')].map((c) => {
      const b = c.querySelector('.pc-badge');
      return { badge: (b?.textContent || '').trim(), cls: b?.className || '' };
    })
  }));
  check('项目中心表头有一个小问号（不再是点了没反应的文字按钮）',
    pcBefore.onPage && pcBefore.hasHelpBtn, JSON.stringify({ helpBtn: pcBefore.hasHelpBtn }));

  // 点一下 → 说明卡弹出，四种类型都解释清楚
  await win.evaluate(() => document.querySelector('.pc-kindhelp-btn')?.click());
  await sleep(400);
  const pcPop = await win.evaluate(() => {
    const pop = document.querySelector('.pc-kindhelp-pop');
    const rows = [...document.querySelectorAll('.pc-kindhelp-row')].map((r) => ({
      badge: (r.querySelector('.pc-badge')?.textContent || '').trim(),
      desc: (r.querySelector('.pc-kindhelp-desc')?.textContent || '').trim()
    }));
    return { open: !!pop, text: (pop?.textContent || '').replace(/\s+/g, ' '), rows };
  });
  check('点小问号 → 弹出说明卡（四种类型都在）',
    pcPop.open && pcPop.rows.length === 4
      && pcPop.rows.some((r) => r.badge.includes('网页项目'))
      && pcPop.rows.some((r) => r.badge.includes('网站项目'))
      && pcPop.rows.some((r) => r.badge.includes('外部项目'))
      && pcPop.rows.some((r) => r.badge.includes('文件已丢失')),
    pcPop.rows.map((r) => r.badge).join(' / '));
  check('说明卡里讲清了"外部项目 = 不在 data/projects"',
    /data\/projects/.test(pcPop.text) && /不在/.test(pcPop.text),
    pcPop.rows.find((r) => r.badge.includes('外部'))?.desc.slice(0, 60));
  check('每个项目卡片都有类型标注',
    pcBefore.cards.length === 0 || pcBefore.cards.every((c) => !!c.badge),
    JSON.stringify(pcBefore.cards.slice(0, 3)));

  // 再点一下收起
  await win.evaluate(() => document.querySelector('.pc-kindhelp-btn')?.click());
  await sleep(300);
  const closed = await win.evaluate(() => !!document.querySelector('.pc-kindhelp-pop'));
  check('再点一下能收起说明卡', closed === false, String(closed));

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