// v0.4.5 第十六批探针：定位系统 / 幽灵卡片 / Alt 滚轮 / 图层居中 / 页面字体 / 更新器
// 用法：node tests/e2e/probe-v045-batch16b.mjs
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
  // A. 静态：源码/CSS 层面的约定
  // ==========================================================================
  const updater = readFileSync(resolve(ROOT, 'src/main/updater.ts'), 'utf8');
  const canvas = readFileSync(resolve(ROOT, 'src/renderer/components/Canvas.tsx'), 'utf8');
  const css29 = readFileSync(resolve(ROOT, 'src/renderer/styles/29-v045-perf.css'), 'utf8');
  const css27 = readFileSync(resolve(ROOT, 'src/renderer/styles/27-v045-ui.css'), 'utf8');
  const layer = readFileSync(resolve(ROOT, 'src/renderer/components/LayerTree.tsx'), 'utf8');
  const inspector = readFileSync(resolve(ROOT, 'src/renderer/components/Inspector.tsx'), 'utf8');

  // —— 更新器 ——
  check('更新器：改名目标收敛成固定 BlockCanvas（不再带版本号）',
    /canonicalFolderName/.test(updater) && !/versionedFolderName\(oldName, version\)/.test(updater),
    'canonicalFolderName');
  check('更新器：只生成一个 PowerShell 脚本、且用隐藏窗口跑（不再闪一堆控制台窗口）',
    /apply-update\.ps1/.test(updater) && /-WindowStyle', 'Hidden'/.test(updater)
    && !/apply-update\.bat/.test(updater) && !/cmd\.exe/.test(updater),
    'ps1 + Hidden');
  check('更新器：全程写日志到 data/logs（复用 ulog）',
    /ulog\(/.test(updater) && /function Log\(\[string\]\$m\)/.test(updater), 'ok');
  check('更新器：删除 .update 用带重试的 safeRmSync（修 ENOTEMPTY）',
    /export function safeRmSync/.test(updater) && /maxRetries:\s*8/.test(updater)
    && /safeRmSync\(stagingDir\)/.test(updater),
    'ok');
  check('更新器：无论成败都会重新启动程序',
    /重新启动/.test(updater) && /Start-Process -FilePath \(Join-Path \$target/.test(updater), 'ok');

  // —— Alt + 滚轮 ——
  check('Alt+滚轮 = 精准微调（1px / Shift 10px），不再是缩放',
    /wheelNoBoxUntil\.current = Date\.now\(\) \+ 800/.test(canvas)
    && /const step = e\.shiftKey \? 10 : 1/.test(canvas)
    && /nudgeElement\(hover\.id, delta\)/.test(canvas),
    'ok');
  check('Alt+滚轮期间不弹盒模型（pointermove 也被挡住）',
    /Date\.now\(\) > wheelNoBoxUntil\.current\) setBoxModel/.test(canvas), 'ok');
  check('Alt+拖动中滚轮：位移基准同步平移（元素跟手，不瞬移）',
    /drag\.rect = \{ \.\.\.drag\.rect, top: drag\.rect\.top - scrolled \}/.test(canvas)
    && /const scrolled = \(wrapEl\?\.scrollTop \?\? 0\) - before/.test(canvas),
    'ok');

  // —— 定位系统 ——
  // ⚠ 源码断言要**排除注释行**：我在注释里写了旧写法做说明，不能把它当成"旧代码还在"。
  const stripComments = (src) => src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/|→)/.test(l)).join('\n');
  const inspectorCode = stripComments(inspector);
  const layerCode = stripComments(layer);
  const quickCode = stripComments(readFileSync(resolve(ROOT, 'src/renderer/components/QuickHelper.tsx'), 'utf8'));
  check('定位偏移界面只暴露"两根轴各一边"（不再四边都给）',
    /pos-axis/.test(css27) && /\.pos-axis-seg/.test(css27)
    && /anchorX/.test(quickCode) && /setAnchorX/.test(quickCode), 'ok');
  check('切换定位方式时会先问"要不要清 margin"',
    /posSwitchAsk/.test(quickCode) && /清掉 margin 再切换/.test(quickCode), 'ok');
  check('绝对/固定定位的负偏移被钳到 0（relative/sticky 不受影响）',
    /const clampOffsets = posAfter === 'absolute' \|\| posAfter === 'fixed'/.test(
      readFileSync(resolve(ROOT, 'src/renderer/store/sceneStore.ts'), 'utf8')
    ), 'ok');

  // —— 幽灵卡片 ——
  check('旧「占位说明型」幽灵卡片已删除',
    !/prop-ghost-card/.test(css29) && !/prop-ghost-card/.test(inspector), 'ok');
  check('新增 position「幽灵卡片」（中键搜 position 时临时出现）',
    /PositionGhostCard/.test(inspector) && /POS_KEYS\.has\(key\)/.test(inspector)
    && existsSync(resolve(ROOT, 'src/renderer/components/PositionGhostCard.tsx')), 'ok');

  // —— 图层 & 字体 ——
  // ⚠ "行的中线对齐容器中线" 这句话在注释里，stripComments 会把它删掉 →
  //    这里改成只断言**代码形态**（有 scrollBy(top: delta) 且没有旧写法）。
  check('图层：选中元素滚到容器垂直中线（不再贴在最下沿）',
    /scroller\.scrollBy\(\{ top: delta/.test(layerCode)
    && /const delta = \(rr\.top \+ rr\.height \/ 2\) - \(sr\.top \+ sr\.height \/ 2\)/.test(layerCode)
    && !/block: 'nearest'/.test(layerCode), 'ok');
  check('页面/变量字体：复用元素的「字体库」弹窗',
    /FontPickerModal/.test(inspectorCode) && /type: 'font'/.test(inspectorCode)
    && /page-font-pick/.test(css29), 'ok');

  // ==========================================================================
  // B. 运行时验证
  // ==========================================================================
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-b16b');
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
  /**
   * ⚠ 必须**尽早**把"上次检查更新"写成今天：
   * App 启动 5 秒后会做一次更新检查，发现新版本就**直接切到「更新中心」页面**
   * （App.tsx 的 checkAndNotify）。探针跑到后半段时视图已经被切走，
   * 画布与右侧面板全部卸载 —— 表现就是"画布上没有元素、页面页签没有行"。
   * 写成今天后 checkAndNotify 会提前 return，视图就稳在编辑器里。
   */
  await win.evaluate(async () => {
    try { await window.bc.setAppConfig({ lastCheckUpdate: new Date().toISOString() }); } catch { /* 忽略 */ }
  }).catch(() => {});
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 15000 });
  await sleep(900);

  // —— 负偏移钳制 ——
  const clamp = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    const id = window.__sceneStore.getState().scene.selectedId;
    window.__sceneStore.getState().updateStyle(id, { position: 'absolute', left: '-40px', top: '-25px' });
    const bp = window.__sceneStore.getState().activeBreakpoint;
    const read = () => {
      const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === id);
      return { ...(n.style || {}), ...((bp !== 'desktop' && n.responsive && n.responsive[bp]) || {}) };
    };
    const absVals = read();
    // relative 的负值必须保留（偏移是位移，负数合法）
    window.__sceneStore.getState().updateStyle(id, { position: 'relative', left: '-40px', top: '-25px' });
    const relVals = read();
    return { abs: { left: absVals.left, top: absVals.top }, rel: { left: relVals.left, top: relVals.top } };
  });
  check('absolute 的负偏移被钳到 0',
    clamp.abs.left === '0px' && clamp.abs.top === '0px', JSON.stringify(clamp.abs));
  check('relative 的负偏移保留（位移量，负数合法）',
    clamp.rel.left === '-40px' && clamp.rel.top === '-25px', JSON.stringify(clamp.rel));

  // —— position 幽灵卡片：中键搜 position → Enter → 右侧出现临时卡片 ——
  await win.evaluate(() => {
    const el = document.querySelector('.canvas [data-bc-id]');
    const r = el.getBoundingClientRect();
    window.dispatchEvent(new CustomEvent('bc:open-prop-search', {
      detail: { x: Math.round(r.left + 20), y: Math.round(r.top + 20) }
    }));
  });
  await sleep(500);
  let opened = await win.evaluate(() => !!document.querySelector('.bc-prop-search'));
  if (!opened) {
    const box = await win.evaluate(() => {
      const el = document.querySelector('.canvas [data-bc-id]');
      const r = el.getBoundingClientRect();
      return { x: r.left + 20, y: r.top + 20 };
    });
    await win.mouse.move(box.x, box.y);
    await win.mouse.down({ button: 'middle' });
    await win.mouse.up({ button: 'middle' });
    await sleep(500);
    opened = await win.evaluate(() => !!document.querySelector('.bc-prop-search'));
  }
  check('准备：中键属性搜索能打开', opened === true, String(opened));

  if (opened) {
    const ghost = await win.evaluate(async () => {
      const input = document.querySelector('.bc-prop-search-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'position');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const first = document.querySelector('.bc-prop-search-item');
      const firstKey = (first?.querySelector('.bc-prop-search-key')?.textContent || '').trim();
      const added = first?.getAttribute('data-added') === '1';
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', ctrlKey: !added, bubbles: true, cancelable: true
      }));
      await new Promise((r) => setTimeout(r, 700));
      const card = document.querySelector('[data-bc-pos-ghost="1"]');
      return {
        firstKey,
        added,
        closed: !document.querySelector('.bc-prop-search'),
        cardShown: !!card,
        modes: [...(card?.querySelectorAll('.pos-ghost-mode') || [])].map((b) => (b.textContent || '').trim()),
        axes: [...(card?.querySelectorAll('.pos-axis') || [])].length
      };
    });
    check('搜 position 命中第一条就是 position', ghost.firstKey === 'position', ghost.firstKey);
    check('Enter / Ctrl+Enter 后搜索框关闭', ghost.closed === true, String(ghost.closed));
    check('右侧出现 position「幽灵卡片」（临时定位卡）', ghost.cardShown === true, String(ghost.cardShown));
    check('幽灵卡片给出 5 种定位方式', ghost.modes.length === 5, ghost.modes.join(' / '));
    check('幽灵卡片只给两根轴（不是四边）', ghost.axes === 2, `axes=${ghost.axes}`);

    // 切换定位方式 → 有 margin 时应弹"要不要清 margin"
    const ask = await win.evaluate(async () => {
      const id = window.__sceneStore.getState().scene.selectedId;
      window.__sceneStore.getState().updateStyle(id, { marginTop: '20px', marginLeft: '12px' });
      await new Promise((r) => setTimeout(r, 300));
      const btn = [...document.querySelectorAll('.pos-ghost-mode')].find((b) => /绝对/.test(b.textContent || ''));
      btn?.click();
      await new Promise((r) => setTimeout(r, 400));
      const confirm = document.querySelector('.pos-ghost .pos-confirm');
      return {
        asked: !!confirm,
        text: (confirm?.textContent || '').replace(/\s+/g, ' ').slice(0, 50),
        buttons: [...(confirm?.querySelectorAll('button') || [])].map((b) => (b.textContent || '').trim())
      };
    });
    check('切换定位方式时提示"要不要清除 margin"',
      ask.asked === true && ask.buttons.some((b) => /清掉 margin/.test(b)),
      JSON.stringify(ask.buttons));

    // 点"清掉 margin" → margin 归零、定位生效
    const cleared = await win.evaluate(async () => {
      const btn = [...document.querySelectorAll('.pos-ghost .pos-confirm button')].find((b) => /清掉 margin/.test(b.textContent || ''));
      btn?.click();
      await new Promise((r) => setTimeout(r, 500));
      const id = window.__sceneStore.getState().scene.selectedId;
      const bp = window.__sceneStore.getState().activeBreakpoint;
      const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === id);
      const m = { ...(n.style || {}), ...((bp !== 'desktop' && n.responsive && n.responsive[bp]) || {}) };
      return m;
    });
    check('点「清掉 margin」后 margin 归零、position 变成 absolute',
      String(cleared.marginTop) === '0px' && String(cleared.marginLeft) === '0px' && cleared.position === 'absolute',
      JSON.stringify({ pos: cleared.position, mt: cleared.marginTop, ml: cleared.marginLeft }));
    check('同一根轴只留一边（另一边是 auto）',
      (cleared.left === 'auto' || cleared.left === undefined || cleared.right === 'auto' || cleared.right === undefined)
      && (cleared.top === 'auto' || cleared.top === undefined || cleared.bottom === 'auto' || cleared.bottom === undefined),
      JSON.stringify({ left: cleared.left, right: cleared.right, top: cleared.top, bottom: cleared.bottom }));
  }

  // —— Alt + 滚轮：精准微调，且不弹盒模型 ——
  // 诊断：此时应用到底处于什么状态（画布/场景/视图）
  const diag = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    return {
      hasCanvas: !!document.querySelector('.canvas'),
      hasBody: !!document.querySelector('.workspace'),
      hasHome: !!document.querySelector('.empty-home'),
      hasProjects: !!document.querySelector('.pc-page'),
      children: (st.scene.root.children || []).length,
      selectedId: st.scene.selectedId,
      canvasEls: document.querySelectorAll('.canvas [data-bc-id]').length,
      loading: !!document.querySelector('.bc-loading'),
      blocker: !!document.querySelector('.bc-update-blocker'),
      // 渲染期异常会落到 ErrorBoundary 的兜底界面 → 把它的文案带出来
      boundary: (document.querySelector('.error-boundary-msg')?.textContent || '').slice(0, 160),
      rootHtml: (document.getElementById('root')?.innerHTML || '').slice(0, 120)
    };
  });
  check('诊断：编辑器仍在前台且场景里有元素',
    diag.hasCanvas && diag.children > 0 && diag.canvasEls > 0,
    JSON.stringify(diag));
  // 用**画布上第一个存在的元素**（不依赖刚插入的那个是否渲染出来），
  // 并强制把它设成 relative + top:0，这样微调结果可预期（-1px）。
  const wheel = await win.evaluate(async () => {
    let el = document.querySelector('.canvas [data-bc-id]');
    for (let i = 0; i < 10 && !el; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      el = document.querySelector('.canvas [data-bc-id]');
    }
    if (!el) return { missing: true };
    const id = el.getAttribute('data-bc-id');
    window.__sceneStore.getState().selectElement(id);
    window.__sceneStore.getState().updateStyle(id, { position: 'relative', left: '0px', top: '0px' });
    await new Promise((r) => setTimeout(r, 400));
    el = document.querySelector(`.canvas [data-bc-id="${id}"]`) || el;
    try { el.scrollIntoView({ block: 'center' }); } catch { /* 忽略 */ }
    const r = el.getBoundingClientRect();
    return { id, x: Math.max(4, r.left + r.width / 2), y: Math.max(4, r.top + r.height / 2) };
  });
  check('准备：Alt 滚轮测试用的元素已渲染', wheel.missing !== true, JSON.stringify(wheel));
  if (wheel.missing) {
    check('Alt 悬停（不按住）会显示盒模型', false, '前置失败');
    check('Alt+滚轮上滚一格 → top 减 1px（精准微调）', false, '前置失败');
    check('Alt+滚轮期间不显示盒模型', false, '前置失败');
  } else {
    await sleep(400);
    // Alt 悬停 → 盒模型出现（`.bc-boxm` = F12 式盒模型浮层；
    // `.bc-alt-box` 是"可编辑"虚线框，是另一回事，Alt 悬停时本来就该有）
    await win.keyboard.down('Alt');
    await win.mouse.move(wheel.x, wheel.y);
    await sleep(400);
    const boxHover = await win.evaluate(() => !!document.querySelector('.bc-boxm'));
    check('Alt 悬停（不按住）会显示盒模型', boxHover === true, String(boxHover));
    // Alt + 滚轮 → 微调 1px（用**真实滚轮事件**：onWheel 挂在 .canvas 上，
// 手动 dispatch 到 .canvas-wrap 是不冒泡到 .canvas 的，等于没触发）
    await win.mouse.wheel(0, -1);
    await sleep(500);
    const afterWheel = await win.evaluate((id) => {
      const bp = window.__sceneStore.getState().activeBreakpoint;
      const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === id);
      const m = { ...(n.style || {}), ...((bp !== 'desktop' && n.responsive && n.responsive[bp]) || {}) };
      return { top: m.top, boxVisible: !!document.querySelector('.bc-boxm') };
    }, wheel.id);
    await win.keyboard.up('Alt');
    check('Alt+滚轮上滚一格 → top 减 1px（精准微调）',
      String(afterWheel.top) === '-1px', String(afterWheel.top));
    check('Alt+滚轮期间不显示盒模型（.bc-boxm 被清掉）',
      afterWheel.boxVisible === false, String(afterWheel.boxVisible));
  }

  // —— 页面字体：有「字体库…」按钮 ——
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.inspector-tab')].find((x) => /页面/.test(x.textContent || ''));
    b?.click();
  });
  // body 设置是折叠区，展开有 0.3s 动画；等按钮真的出现再断言
  await win.waitForSelector('.page-font-pick', { timeout: 8000 }).catch(() => {});
  const fontField = await win.evaluate(() => {
    const btn = document.querySelector('.page-font-pick');
    return {
      hasBtn: !!btn,
      label: (btn?.textContent || '').trim(),
      // 诊断：页面页签是否真的渲染了、有哪些行
      hasPageBody: !!document.querySelector('.page-quick-css, .page-prop-row'),
      rows: [...document.querySelectorAll('.page-prop-row .prop-row-header')].map((r) => (r.textContent || '').trim()).slice(0, 6)
    };
  });
  check('页面设置里的字体有「字体库…」入口（与元素同一套弹窗）',
    fontField.hasBtn === true && /字体库/.test(fontField.label),
    `${fontField.label || '(无按钮)'} · rows=${JSON.stringify(fontField.rows)}`);

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 第十六批探针（定位/幽灵卡片/Alt滚轮/图层/字体/更新器）：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });