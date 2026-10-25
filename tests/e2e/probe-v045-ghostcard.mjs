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

  // 默认开关是开着的 → 不应出现幽灵卡片
  const before = await win.evaluate(() => ({
    ghost: document.querySelectorAll('.prop-ghost-card').length,
    rows: document.querySelectorAll('.props-list .prop-row').length
  }));
  check('开关打开时：代管属性直接列在列表里，没有幽灵卡片',
    before.ghost === 0 && before.rows > 0, JSON.stringify(before));

  // 关掉「是否显示到下方 CSS 属性」。
  // ⚠ 这个开关在「快捷助手」板块里，而该板块默认是收起的 —— 探针必须先展开它，
  //   否则点击落空（第一版就踩了这个坑：labels: 0）。
  await win.evaluate(() => {
    const head = [...document.querySelectorAll('.inspector-sec-head')].find((x) => /快捷助手/.test(x.textContent || ''));
    if (head && !document.querySelector('.qh-sync-label')) head.click();
  });
  await sleep(500);
  const hasToggle = await win.evaluate(() => document.querySelectorAll('.qh-sync-label input[type="checkbox"]').length);
  check('准备：「快捷助手」里有「是否显示到下方 CSS 属性」开关', hasToggle === 1, `count=${hasToggle}`);

  await win.evaluate(() => {
    const box = document.querySelector('.qh-sync-label input[type="checkbox"]');
    if (box && box.checked) box.click();
  });
  await sleep(800);

  const ghost = await win.evaluate(() => {
    const card = document.querySelector('.prop-ghost-card');
    return {
      exists: !!card,
      text: (card?.textContent || '').replace(/\s+/g, ' ').trim(),
      buttons: [...(card?.querySelectorAll('.prop-ghost-btn') || [])].map((b) => (b.textContent || '').trim()),
      rows: document.querySelectorAll('.props-list .prop-row').length
    };
  });
  check('关掉开关后：代管属性从列表消失，但出现「幽灵卡片」说明它们仍在生效',
    ghost.exists && /快捷助手/.test(ghost.text) && /依然生效/.test(ghost.text),
    ghost.text.slice(0, 70));
  check('幽灵卡片给出两个出口（显示出来 / 去快捷助手）',
    ghost.buttons.includes('显示出来') && ghost.buttons.includes('去快捷助手'),
    ghost.buttons.join(' / '));

  // 点「显示出来」→ 卡片消失、属性回到列表、开关被记住
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.prop-ghost-btn')].find((x) => /显示出来/.test(x.textContent || ''));
    if (b) b.click();
  });
  await sleep(700);
  const afterShow = await win.evaluate(() => ({
    ghost: document.querySelectorAll('.prop-ghost-card').length,
    rows: document.querySelectorAll('.props-list .prop-row').length,
    checked: !!document.querySelector('.qh-sync-label input[type="checkbox"]')?.checked
  }));
  check('点「显示出来」→ 卡片消失、属性回到列表、开关回到"开"',
    afterShow.ghost === 0 && afterShow.rows > 0 && afterShow.checked === true, JSON.stringify(afterShow));

  // 再关一次 → 卡片回来（状态是全局记忆的，不是一次性）
  await win.evaluate(() => {
    const box = document.querySelector('.qh-sync-label input[type="checkbox"]');
    if (box && box.checked) box.click();
  });
  await sleep(700);
  const again = await win.evaluate(() => document.querySelectorAll('.prop-ghost-card').length);
  check('再关一次开关 → 幽灵卡片重新出现（不是一次性的）', again === 1, `count=${again}`);

  // 元素完全没有代管样式时，不该出现幽灵卡片（避免噪音）
  const clean = await win.evaluate(async () => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    const id3 = window.__sceneStore.getState().scene.selectedId;
    await new Promise((r) => setTimeout(r, 400));
    return { id: id3, ghost: document.querySelectorAll('.prop-ghost-card').length };
  });
  check('元素没有代管样式时不会显示幽灵卡片（避免无意义噪音）', clean.ghost === 0, JSON.stringify(clean));

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