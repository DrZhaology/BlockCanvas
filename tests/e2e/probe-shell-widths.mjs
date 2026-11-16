// v0.4.6 · 外壳宽度六档扫描（拆轴 + CSS 方向翻转的验收网）
//
// 这个探针解决一个反复复发的问题：**竖屏总是在"新增了宽屏功能"之后崩**。
// 原因不是某个样式写错了，而是过去的写法是「宽屏是默认、窄屏靠一 堆覆盖去撤销」——
// 每加一个宽屏功能就欠一笔"窄屏得撤销它"的债，没人写就崩一块。
//
// 所以判据必须从"某屏幕看起来对"升级成"任何宽度都不溢出、不塌"：
//   ① 360 / 500 / 700 / 899 / 901 / 1280 六档宽度逐一扫；
//   ② 每档都断言 12 条硬指标（见 CHECKS 注释）；
//   ③ 899 ↔ 901 专门盯断点边界（差 2px 时布局必须整体切换，不能半拉子）。
//
// ⚠ 已知排除项（故意溢出/滚动的容器，不是 bug）：
//   .bc-hscroll / .tb-main / .bc-portal / .tb-more-panel / .bc-varmenu / [data-bc-avoid]
//   以及抽屉面板本身（它就是要滑出视口）。
//
// 用法：node tests/e2e/probe-shell-widths.mjs
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

/** 六档宽度及其期望的外壳形态。
 *  ⚠ 断点边界用 898 / 902 而不是 899 / 901：实测 Electron 的 setContentSize
 *  会把视口宽吸附到偶数（899→900、901→900），奇数值根本设不出来 ——
 *  硬测 899 会得到"正好压在断点上"的假结果。898 与 902 是断点两侧最近的可设置宽度。 */
const WIDTHS = [
  { w: 360, shell: 'stack', note: '手机竖屏最窄（主窗口下限 320）' },
  { w: 500, shell: 'stack', note: '小平板 / 大手机横放' },
  { w: 700, shell: 'stack', note: '桌面窄窗' },
  { w: 898, shell: 'stack', note: '断点下方（900 以下最近可用宽度）' },
  { w: 902, shell: 'split', note: '断点上方（900 以上最近可用宽度）' },
  { w: 1280, shell: 'split', note: '标准编辑尺寸' }
];

/** 把窗口设成**精确**的内容宽度。
 *  Electron 的 setContentSize 与实际视口宽会差 1–2px（DPI / 边框取整），
 *  899 会被量成 900 而"正好压在断点上" —— 所以量一次、补差一次，保证 899 真的是 899。 */
async function setContentWidth(app, win, w) {
  const apply = async (px) => {
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setContentSize(size.w, size.h);
    }, { w: px, h: 800 });
    await sleep(420);
    return win.evaluate(() => document.documentElement.clientWidth);
  };
  let actual = await apply(w);
  if (actual !== w) actual = await apply(w - (actual - w));
  await sleep(160);
  return actual;
}

/** 量一屏的关键几何。全部用 clientWidth 而不是 innerWidth 之外的猜测 */
const measure = () => {
  const app = document.querySelector('.app');
  const ws = document.querySelector('.workspace');
  const wrap = document.querySelector('.canvas-wrap');
  const toolbar = document.querySelector('.toolbar');
  const elem = document.querySelector('.elem-pane-wrap');
  const right = document.querySelector('.right-pane-wrap');
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const wsCs = cs(ws);

  // 横向溢出扫描：找出具体谁超了右边（比只看 scrollWidth 有用）
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('.app *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (el.closest('.bc-hscroll, .tb-main, .bc-portal, .tb-more-panel, .bc-varmenu, [data-bc-avoid]')) continue;
    if (el.closest('.elem-pane-wrap, .right-pane-wrap')) continue;
    if (r.right > vw + 1.5) {
      bad.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 36),
        right: Math.round(r.right),
        over: Math.round(r.right - vw)
      });
    }
  }

  return {
    vw,
    shell: app?.getAttribute('data-shell') ?? null,
    input: app?.getAttribute('data-input') ?? null,
    docScrollW: document.documentElement.scrollWidth,
    // 外壳网格
    wsCols: wsCs?.gridTemplateColumns ?? '',
    wsRows: wsCs?.gridTemplateRows ?? '',
    wsAreas: (wsCs?.gridTemplateAreas ?? '').slice(0, 40),
    // 画布可编辑区
    wrapW: wrap ? Math.round(wrap.getBoundingClientRect().width) : 0,
    wrapH: wrap ? Math.round(wrap.getBoundingClientRect().height) : 0,
    // 工具栏
    tbH: toolbar ? Math.round(toolbar.getBoundingClientRect().height) : 0,
    tbOverflowX: toolbar ? toolbar.scrollWidth - toolbar.clientWidth : -1,
    // 面板形态
    elemPos: cs(elem)?.position ?? '',
    rightPos: cs(right)?.position ?? '',
    elemVis: cs(elem)?.visibility ?? '',
    rightVis: cs(right)?.visibility ?? '',
    drawerBtns: document.querySelectorAll('.shell-drawer-btn').length,
    // 工作区高度 == 画布高度（防"下方留一条空灰带"的老毛病）
    wsH: ws ? Math.round(ws.getBoundingClientRect().height) : 0,
    // v0.4.6 竖屏重做：底部两条操作栏
    appH: Math.round(document.querySelector('.app')?.getBoundingClientRect().height ?? 0),
    bar1H: Math.round(document.querySelector('.pt-bar1')?.getBoundingClientRect().height ?? 0),
    bar2H: Math.round(document.querySelector('.pt-bar2')?.getBoundingClientRect().height ?? 0),
    hasTopBar: !!document.querySelector('.bc-titlebar') || !!document.querySelector('.project-tab-bar'),
    bad: bad.slice(0, 5),
    badCount: bad.length
  };
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-shell-widths');
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
    w.setMinimumSize(320, 480);
    w.setContentSize(1280, 800);
    w.center();
  });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);

  // 进编辑器（外壳形态要在真正的编辑器里验，不是空首页）
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1400);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });
  // 放一个够长够宽的元素：竖屏溢出的典型触发物（长文本 + 固定宽度）
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.addElement('div');
    const kids = window.__sceneStore.getState().scene.root.children || [];
    const f = kids[kids.length - 1];
    if (f) {
      window.__sceneStore.getState().updateStyle(f.id, {
        height: '420px', width: '100%', backgroundColor: '#dbeafe'
      });
    }
    window.__sceneStore.getState().endStyleEdit();
  });
  await sleep(600);

  const seen = [];
  for (const { w, shell, note } of WIDTHS) {
    const vw = await setContentWidth(app, win, w);
    const m = await win.evaluate(measure);
    seen.push({ w, vw, ...m });

    // ⓿ 视口宽必须真的等于目标宽（否则断点边界 899 会被量成 900，整组断言失去意义）
    check(`${w}px 视口宽精确等于目标（补差后）`, vw === w, `vw=${vw}`);

    // ① 外壳形态与断点一致
    check(`${w}px（${note}）外壳是 ${shell}`, m.shell === shell, `shell=${m.shell} vw=${m.vw}`);
    // ② 输入轴不被宽度带跑（拆轴的正交性）
    check(`${w}px 输入轴仍是 pointer（宽度≠触摸）`, m.input === 'pointer', `input=${m.input}`);
    // ③ **最重要的一条**：整页不得横向溢出
    check(`${w}px 页面没有横向滚动`, m.docScrollW <= m.vw + 1,
      `scrollW=${m.docScrollW} vw=${m.vw}`);
    // ④ 没有任何元素越过右边（溢出扫描）
    check(`${w}px 没有元素越过右边界`, m.badCount === 0,
      m.badCount === 0 ? '' : JSON.stringify(m.bad));
    // ⑤ 画布可编辑区还活着（不是被面板挤成一条）
    check(`${w}px 画布可编辑区宽度 >120`, m.wrapW > 120, `wrapW=${m.wrapW}`);
    // ⑥ 画布有真实高度（≥240，防"下面留一条空灰带"）
    check(`${w}px 画布高度 ≥240`, m.wrapH >= 240, `wrapH=${m.wrapH}`);
    // ⑦ 工具栏没被压成 0（两行或一行都要有高度）
    check(`${w}px 工具栏有高度且可点`, m.tbH >= 40, `tbH=${m.tbH}`);

    if (shell === 'stack') {
      // ⑬ v0.4.6 竖屏重做：顶部必须**完全空**（没有自绘标题栏、没有多标签页条）
      check(`${w}px 顶部没有任何栏（标题栏 / 多标签页条都不得渲染）`,
        m.hasTopBar === false, `hasTopBar=${m.hasTopBar}`);
      // ⑭ 底部两条操作栏都在，且第一条够高（手指点得到）
      check(`${w}px 底部有两条操作栏（第一条 ≥48px）`,
        m.bar1H >= 48 && m.bar2H > 0, `bar1=${m.bar1H} bar2=${m.bar2H}`);
      // ⑮ 画布 + 两条栏 = 整屏（不留空、不溢出）
      check(`${w}px 画布 + 两条操作栏正好铺满一屏`,
        Math.abs((m.wrapH + m.bar1H + m.bar2H) - m.appH) <= 3,
        `wrap=${m.wrapH} + ${m.bar1H} + ${m.bar2H} vs app=${m.appH}`);
      // ⑧ 堆叠形态：面板是覆盖层（absolute）+ 默认收起 + 两个把手
      check(`${w}px 面板是覆盖层（position:absolute）`,
        m.elemPos === 'absolute' && m.rightPos === 'absolute',
        `elem=${m.elemPos} right=${m.rightPos}`);
      check(`${w}px 面板默认收起（visibility:hidden）`,
        m.elemVis === 'hidden' && m.rightVis === 'hidden',
        `elem=${m.elemVis} right=${m.rightVis}`);
      check(`${w}px 有 2 个抽屉把手`, m.drawerBtns === 2, `${m.drawerBtns} 个`);
      // ⑨ 网格真的收成一格（这是"画布占满"的硬指标）
      check(`${w}px 外壳网格收成一列一行`,
        m.wsCols.split(' ').length === 1 && m.wsRows.split(' ').length === 1,
        `cols=${m.wsCols} rows=${m.wsRows}`);
    } else {
      // ⑩ 并排形态：面板放回网格（原样是 position:relative）、可见、无把手
      check(`${w}px 面板放回网格（position:relative，不是覆盖层）`,
        m.elemPos === 'relative' && m.rightPos === 'relative',
        `elem=${m.elemPos} right=${m.rightPos}`);
      check(`${w}px 面板可见`, m.elemVis === 'visible' && m.rightVis === 'visible',
        `elem=${m.elemVis} right=${m.rightVis}`);
      check(`${w}px 没有抽屉把手（DOM 里不留）`, m.drawerBtns === 0, `${m.drawerBtns} 个`);
    }
    // ⑪ 工作区高度必须撑满（不等于画布高度就说明多出了一行空网格）
    check(`${w}px 工作区高度 ≥ 画布高度（没有多余空行）`,
      m.wsH >= m.wrapH - 2, `wsH=${m.wsH} wrapH=${m.wrapH}`);

    console.log(`      ↳ ${w}px: cols=${m.wsCols} rows=${m.wsRows} wrap=${m.wrapW}×${m.wrapH} tb=${m.tbH}`);
  }

  // ── 断点边界专项：898 → 902 必须整体翻转，不能半拉子 ────────────────
  const a = seen.find((s) => s.w === 898);
  const b = seen.find((s) => s.w === 902);
  check('898→902 跨断点时面板形态整体翻转（没有半拉子中间态）',
    a.elemPos === 'absolute' && b.elemPos === 'relative',
    `898:${a.elemPos} → 902:${b.elemPos}`);
  check('898→902 跨断点时把手一起出现/消失',
    a.drawerBtns === 2 && b.drawerBtns === 0,
    `898:${a.drawerBtns} → 902:${b.drawerBtns}`);
  check('898→902 画布宽度在两档都 >120（断点两侧都能编辑）',
    a.wrapW > 120 && b.wrapW > 120, `898:${a.wrapW} → 902:${b.wrapW}`);

  /**
   * ── 输入轴独立性：**模拟触摸设备，但窗口保持 1280px** ──────────────────
   *
   * 这是拆轴这件事的最终验收，也是拆轴之前根本做不到的场景：
   *   · 拆轴前：`data-shell='narrow'` 同时当"布局开关"和"触摸开关"用，
   *     1280px 的平板横放会判成 wide → 布局对了，但 32px 的按钮用手指点不准；
   *   · 拆轴后：布局归 data-shell（split），输入归 data-input（touch），两件事各算各的 ——
   *     所以这里应该看到「面板仍然并排、没有抽屉把手」**且**「工具栏按钮高 ≥44px」。
   *
   * 用 CDP 的 Emulation.setEmulatedMedia 改 `pointer` / `hover` 媒体特性，
   * 这会让 `window.matchMedia('(hover: none) and (pointer: coarse)')` 真的成立 ——
   * 不是伪造 DOM 属性，走的就是产品里那条判定路径。
   */
  let cdp = null;
  try {
    cdp = await win.context().newCDPSession(win);
    // 两条都用上：setTouchEmulationEnabled 让设备"有手指"，
    // setEmulatedMedia 的 features 才把 (pointer:coarse)/(hover:none) 真正打开。
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }]
    });
  } catch (e) {
    check('准备：能把媒体特性模拟成触摸设备（CDP setEmulatedMedia）', false, String(e).slice(0, 160));
  }
  await sleep(700);

  const touchWide = await win.evaluate(() => {
    const mq = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const app = document.querySelector('.app');
    const elem = document.querySelector('.elem-pane-wrap');
    const buttons = [...document.querySelectorAll('.toolbar button')].map((b) => {
      const r = b.getBoundingClientRect();
      return {
        c: String(b.className || '').slice(0, 24),
        h: Math.round(r.height), w: Math.round(r.width), vis: r.height > 0
      };
    });
    // 只盯「大目标清单」里那几个：.tb-btn-ghost / .tb-btn-primary / .tb-grp-btn / .tb-more-btn
    const bigOnes = buttons.filter((b) =>
      /\b(tb-btn-ghost|tb-btn-primary|tb-grp-btn|tb-more-btn)\b/.test(' ' + b.c + ' '));
    return {
      mqCoarse: mq,
      input: app?.getAttribute('data-input') ?? null,
      shell: app?.getAttribute('data-shell') ?? null,
      drawerBtns: document.querySelectorAll('.shell-drawer-btn').length,
      elemPos: elem ? getComputedStyle(elem).position : '',
      bigOnes,
      bigMinH: bigOnes.length ? Math.min(...bigOnes.map((b) => b.h)) : 0,
      bigMinW: bigOnes.length ? Math.min(...bigOnes.map((b) => b.w)) : 0,
      allBtns: buttons.slice(0, 10),
      pseudoTabH: (() => {
        const b = document.querySelector('.pseudo-tab');
        return b ? Math.round(b.getBoundingClientRect().height) : 0;
      })()
    };
  });

  check('触摸模拟生效：matchMedia(coarse) 成立', touchWide.mqCoarse === true, String(touchWide.mqCoarse));
  check('1280px + 触摸 → 输入轴切成 touch（宽度没变，输入变了）',
    touchWide.input === 'touch', `input=${touchWide.input} shell=${touchWide.shell}`);
  check('1280px + 触摸 → 布局仍并排（不会被输入轴带成抽屉）',
    touchWide.shell === 'split' && touchWide.drawerBtns === 0 && touchWide.elemPos === 'relative',
    `shell=${touchWide.shell} btns=${touchWide.drawerBtns} elem=${touchWide.elemPos}`);
  check('1280px + 触摸 → 工具栏主按钮 ≥44×44（手指点得准）',
    touchWide.bigOnes.length > 0 && touchWide.bigMinH >= 44 && touchWide.bigMinW >= 44,
    `minH=${touchWide.bigMinH} minW=${touchWide.bigMinW} n=${touchWide.bigOnes.length} all=${JSON.stringify(touchWide.allBtns)}`);
  check('1280px + 触摸 → 伪类按钮也长到 ≥44px',
    touchWide.pseudoTabH === 0 || touchWide.pseudoTabH >= 44, `pseudoTabH=${touchWide.pseudoTabH}`);

  // 还原成鼠标：输入轴要能自己切回去（不能只在启动时判一次）
  // ⚠ 必须同时关掉 touch 模拟 —— 只把 media features 改回 fine/hover 不够，
  //   Chromium 在 touch 模拟开启时仍然按 coarse 报（实测切不回来）。
  if (cdp) {
    try {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.send('Emulation.setEmulatedMedia', { media: 'screen', features: [
        { name: 'pointer', value: 'fine' }, { name: 'hover', value: 'hover' }
      ] });
    } catch { /* 忽略 */ }
  }
  await sleep(700);
  const backPointer = await win.evaluate(() => ({
    input: document.querySelector('.app')?.getAttribute('data-input') ?? null,
    bigMinH: (() => {
      const list = [...document.querySelectorAll('.toolbar button')]
        .filter((b) => /\btb-(btn|more-btn)\b/.test(' ' + String(b.className || '') + ' '))
        .map((b) => Math.round(b.getBoundingClientRect().height))
        .filter((h) => h > 0);
      return list.length ? Math.min(...list) : 0;
    })()
  }));
  check('接上鼠标后输入轴自己切回 pointer（订阅是活的，不是启动时判一次）',
    backPointer.input === 'pointer', `input=${backPointer.input}`);
  check('接回鼠标后工具栏按钮回到 <44px（触摸样式没有泄漏到桌面）',
    backPointer.bigMinH > 0 && backPointer.bigMinH < 44, `minH=${backPointer.bigMinH}`);

  check('无 page 错误', errs.length === 0, errs.join(' | ').slice(0, 300));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
