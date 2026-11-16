// v0.4.5 第十一批探针：幽灵卡片（快捷助手样式被隐藏时的占位）+ 深色语义变量收敛
// 用法：node tests/e2e/probe-v045-ghostcard.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, readFileSync } from 'fs';
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
  // ==========================================================================
  // A. 静态检查：深色分支是否收敛（同一份 CSS 里不再有硬编码浅色块）
  // ==========================================================================
  const css = readFileSync(resolve(ROOT, 'src/renderer/styles/29-v045-perf.css'), 'utf8');
  const darkRules = css.split('\n').filter((l) => /^\s*html\[data-bc-dark\]/.test(l));
  /**
   * 白名单说明（这条断言的本意是"深色别写死浅色背景/文字"，不是"一个色值都不许有"）：
   *   · lic-free / lic-restricted —— 字体许可证徽章，颜色本身就是语义（免费绿 / 受限黄）
   *   · pc-badge.is-*            —— 项目类型徽章，四种类型各有自己的色相（蓝/紫/橙/红）
   *   · dd-session-warn*         —— 删除前的"会话还开着"警示条，琥珀色是危险语义
   * 这三类都是**语义色**，和 surface/line/text 这种"表面色"不是一回事，
   * 强行套变量反而会让它们和普通文字撞色。
   */
  const SEMANTIC_OK = /lic-free|lic-restricted|pc-badge\.is-|dd-session-warn/;
  const hardcoded = darkRules.filter((l) => /#[0-9a-f]{6}\b/i.test(l) && !SEMANTIC_OK.test(l));
  check('新增的深色规则都走语义变量（只剩遮罩 / 许可证 / 类型徽章 / 警示条这类"语义色"）',
    hardcoded.length === 0, hardcoded.join(' | ') || `${darkRules.length} 条深色规则`);

  const tokens = readFileSync(resolve(ROOT, 'src/renderer/styles/00-theme-tokens.css'), 'utf8');
  check('语义变量在深色下有完整一套（surface / line / text 三级 + accent + danger）',
    /--surface-0[\s\S]*--surface-1[\s\S]*--surface-2[\s\S]*--surface-sunken/.test(tokens)
    && /--text-1[\s\S]*--text-2[\s\S]*--text-3/.test(tokens)
    && /--line[\s\S]*--line-strong/.test(tokens),
    'ok');

  const DATA_DIR = resolve(tmpdir(), 'bc-probe-ghost');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
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
  await win.waitForSelector('.toolbar', { timeout: 15000 });
  await sleep(900);

  // 造一个"有快捷助手样式"的元素（display:flex + gap）
  const id = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    const id2 = window.__sceneStore.getState().scene.selectedId;
    window.__sceneStore.getState().updateStyle(id2, {
      display: 'flex', gap: '16px', flexDirection: 'row', width: '200px', height: '60px'
    });
    return id2;
  });
  await sleep(700);

  // 展开「CSS 样式属性」板块
  await win.evaluate(() => {
    const head = [...document.querySelectorAll('.inspector-sec-head')].find((x) => /CSS 样式属性/.test(x.textContent || ''));
    if (head && !document.querySelector('.props-list')) head.click();
  });
  await sleep(500);

  // v0.4.6：这个开关**改成默认关闭**（用户："默认关闭，也就不把属性显示到下方 CSS"）
  // 所以先把开关打开，再看"代管属性是否进列表"。
  const openHelper = async () => {
    await win.evaluate(() => {
      const head = [...document.querySelectorAll('.inspector-sec-head')].find((x) => /快捷助手/.test(x.textContent || ''));
      if (head && !document.querySelector('.qh-sync-label')) head.click();
    });
    await sleep(400);
  };
  await openHelper();
  const defaultOff = await win.evaluate(() =>
    document.querySelector('.qh-sync-label input[type="checkbox"]')?.checked === false
  );
  check('「显示到下方 CSS 属性」默认关闭', defaultOff, String(defaultOff));

  const offRows = await win.evaluate(() => document.querySelectorAll('.props-list .prop-row').length);

  // 打开开关 → 代管属性（display / gap / flexDirection…）出现在列表里
  await win.evaluate(() => {
    const box = document.querySelector('.qh-sync-label input[type="checkbox"]');
    if (box && !box.checked) box.click();
  });
  await sleep(800);
  const onRows = await win.evaluate(() => ({
    rows: document.querySelectorAll('.props-list .prop-row').length,
    hasDisplay: !!document.querySelector('[data-prop-key="display"]')
  }));
  check('打开开关后：代管属性进入下方列表',
    onRows.rows > offRows && onRows.hasDisplay, JSON.stringify({ off: offRows, on: onRows }));

  // 再关掉 → 从列表消失
  await win.evaluate(() => {
    const box = document.querySelector('.qh-sync-label input[type="checkbox"]');
    if (box && box.checked) box.click();
  });
  await sleep(800);
  const backOff = await win.evaluate(() => ({
    rows: document.querySelectorAll('.props-list .prop-row').length,
    hasDisplay: !!document.querySelector('[data-prop-key="display"]')
  }));
  check('关掉后：代管属性从列表消失',
    backOff.rows === offRows && !backOff.hasDisplay, JSON.stringify(backOff));

  /**
   * v0.4.6：幽灵卡片的语义变了（用户第二次提，并按新规则定稿）
   * ---------------------------------------------------------------
   * 「快捷助手关闭了显示到下方 CSS 属性的时候，中键搜索属性的时候，临时做一个幽灵卡片，
   *   颜色做的不一样。这个卡片关闭当前选中元素的属性面板后就下次进来不显示了。」
   *   → 只有开关**关闭**时，中键搜到的属性才会进这张紫色卡片；
   *   → **没有关闭按钮**（不能叉掉），换元素/离开面板自然消失。
   */
  const fireSearch = async (key) => {
    await win.evaluate((k) => {
      window.dispatchEvent(new CustomEvent('bc:focus-prop', { detail: { key: k, add: false } }));
    }, key);
    await sleep(700);
  };

  // 关着开关时搜一条代管属性 → 出幽灵卡片，里面有这条属性
  await fireSearch('gap');
  const ghost = await win.evaluate(() => {
    const card = document.querySelector('[data-bc-ghost-card="1"]');
    return {
      exists: !!card,
      rows: card ? card.querySelectorAll('.prop-row').length : 0,
      closeBtn: card ? card.querySelectorAll('.ghost-prop-card-head button, .pos-ghost-x, [title*="关闭"]').length : 0
    };
  });
  check('开关关闭 + 中键搜属性 → 出幽灵卡片', ghost.exists, JSON.stringify(ghost));
  check('幽灵卡片里能直接改这条属性', ghost.rows >= 1, `rows=${ghost.rows}`);
  check('幽灵卡片**没有**关闭按钮（用户明确不要 ×）', ghost.closeBtn === 0, `buttons=${ghost.closeBtn}`);

  // 换元素 → 幽灵卡片消失（下次进来不再显示）
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
  });
  await sleep(900);
  const afterSwitch = await win.evaluate(() => document.querySelectorAll('[data-bc-ghost-card="1"]').length);
  check('换元素后幽灵卡片自动消失', afterSwitch === 0, String(afterSwitch));

  // 普通元素不会凭空出现幽灵卡片（只有"搜过"才会有）
  const clean = await win.evaluate(() => ({
    ghost: document.querySelectorAll('[data-bc-ghost-card="1"]').length
  }));
  check('没搜过就不会凭空出现幽灵卡片', clean.ghost === 0, JSON.stringify(clean));

  // 深色模式：切过去后语义变量真的变了（不是只有 data-bc-dark 这个属性）
  const dark = await win.evaluate(() => {
    document.documentElement.setAttribute('data-bc-dark', '');
    const cs = getComputedStyle(document.documentElement);
    const light = {
      s0: cs.getPropertyValue('--surface-0').trim(),
      t1: cs.getPropertyValue('--text-1').trim()
    };
    document.documentElement.removeAttribute('data-bc-dark');
    const cs2 = getComputedStyle(document.documentElement);
    const l2 = {
      s0: cs2.getPropertyValue('--surface-0').trim(),
      t1: cs2.getPropertyValue('--text-1').trim()
    };
    return { dark: light, light: l2 };
  });
  check('切到深色：语义变量整体换了一套（surface / text 都变）',
    dark.dark.s0 !== dark.light.s0 && dark.dark.t1 !== dark.light.t1,
    JSON.stringify(dark));

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 第十一批探针（幽灵卡片 + 深色语义变量）：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });