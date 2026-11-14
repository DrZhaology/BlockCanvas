// v0.4.6 · 窄屏外壳验收（R6-7 / R6-8 / R6-9 / R6-10）
//
// 背景：主窗口以前锁在 `minWidth: 960`，所以"编辑器自己的手机界面"这件事**根本不存在**
// （不是做得不好）。本版放开到 360，并在 900px 处切外壳形态：
//
//   data-shell="wide"    ≥900px —— 左右面板并排（原样）
//   data-shell="narrow"  <900px —— 左右面板改抽屉，画布占满，抽屉入口浮在画布上
//
// ⚠ 别和画布断点混：768/480 是**被设计的那张网页**的断点，这里是**编辑器外壳**。
//
// 这个探针验证四件事：
//   ① 阈值切换（跨 900 时 data-shell 真的变了）；
//   ② 抽屉确实抽得出来、遮罩能关掉；
//   ③ 三个真机尺寸下都没有横向溢出（R6-8）；
//   ④ 可点元素 ≥44×44（R6-10 的硬指标）。
//
// 用法：node tests/e2e/probe-shell-narrow.mjs
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

/** 把窗口设成指定尺寸（用真实 IPC，走的正是设置页那个按钮的路径） */
async function setSize(win, preset) {
  const r = await win.evaluate((p) => window.bc.setAcceptanceSize(p), preset);
  await sleep(700);
  return r;
}

/** 扫描横向溢出元素（比 scrollWidth 更准：找出具体是谁超了） */
const scanOverflow = () => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('.app *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // 把"故意超出并由父级裁剪/滚动"的容器排除掉（抽屉、横向滚动区、Portal 浮层）
    if (el.closest('.bc-hscroll, .tb-main, .bc-portal, .tb-more-panel, .bc-varmenu, [data-bc-avoid]')) continue;
    if (el.closest('.elem-pane-wrap, .right-pane-wrap')) continue;
    if (r.right > vw + 1.5) {
      bad.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && typeof el.className === 'string') ? el.className.slice(0, 40) : '',
        right: Math.round(r.right),
        vw
      });
    }
  }
  return { vw, docScrollW: document.documentElement.scrollWidth, bad: bad.slice(0, 6) };
};

/** 触摸目标审计：窄屏下可点元素应 ≥44×44 */
const scanTouch = () => {
  const MIN = 44;
  const sel = [
    '.toolbar .tb-btn', '.toolbar .tb-more-btn', '.tab-bar .tab-btn',
    '.inspector-tab', '.shell-drawer-btn', '.eh-btn'
  ].join(',');
  const small = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // 隐藏的不算
    if (r.width < MIN - 0.5 || r.height < MIN - 0.5) {
      small.push({
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 32),
        w: Math.round(r.width), h: Math.round(r.height),
        text: (el.textContent || '').trim().slice(0, 10)
      });
    }
  }
  return small;
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-shell');
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
    w.setSize(1440, 900);
    w.center();
  });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);

  // ── ① 窗口最小宽度已经放开（这是"存在窄屏外壳"的前提）─────────────
  const minSize = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return w.getMinimumSize();
  });
  check('主窗口最小宽度已放开到 ≤400（以前是 960，所以窄屏外壳根本不存在）',
    minSize[0] <= 400, `最小尺寸 ${minSize[0]}×${minSize[1]}`);

  // ── ② 宽屏形态 ────────────────────────────────────────────────────
  const wide = await win.evaluate(() => {
    const app = document.querySelector('.app');
    return {
      shell: app?.getAttribute('data-shell') ?? null,
      w: window.innerWidth,
      drawerBtn: document.querySelectorAll('.shell-drawer-btn').length
    };
  });
  check('1440px 下外壳是 wide', wide.shell === 'wide', `shell=${wide.shell} w=${wide.w}`);
  check('宽屏不渲染抽屉按钮（DOM 里不留）', wide.drawerBtn === 0, `${wide.drawerBtn} 个`);

  // 进编辑器（外壳形态要在真正的编辑器里验，不是空首页）
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1400);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.addElement('div');
    const kids = window.__sceneStore.getState().scene.root.children || [];
    const f = kids[kids.length - 1];
    if (f) window.__sceneStore.getState().updateStyle(f.id, { height: '120px', width: '100%', backgroundColor: '#dbeafe' });
    window.__sceneStore.getState().endStyleEdit();
  });
  await sleep(600);

  // ── ③ 切到安卓尺寸 → 外壳变 narrow，左右面板并排消失 ─────────────
  const sz = await setSize(win, 'android');
  check('竖屏验收入口能精确设成 412×915',
    sz?.ok === true && Math.abs((sz.width ?? 0) - 412) <= 2 && Math.abs((sz.height ?? 0) - 915) <= 2,
    `实际 ${sz?.width}×${sz?.height}`);

  const narrow = await win.evaluate(() => {
    const app = document.querySelector('.app');
    const left = document.querySelector('.elem-pane-wrap');
    const right = document.querySelector('.right-pane-wrap');
    const lr = left?.getBoundingClientRect();
    const rr = right?.getBoundingClientRect();
    return {
      shell: app?.getAttribute('data-shell') ?? null,
      w: window.innerWidth,
      drawerBtns: document.querySelectorAll('.shell-drawer-btn').length,
      // 收起时面板应该被挪出视口（translateX）或被 visibility:hidden
      leftVisible: lr ? (lr.right > 4 && lr.left < window.innerWidth - 4) : null,
      rightVisible: rr ? (rr.left < window.innerWidth - 4 && rr.right > 4) : null,
      leftVis: left ? getComputedStyle(left).visibility : '',
      rightVis: right ? getComputedStyle(right).visibility : ''
    };
  });
  check('412px 下外壳切到 narrow', narrow.shell === 'narrow', `shell=${narrow.shell} w=${narrow.w}`);
  check('窄屏出现两个抽屉入口按钮', narrow.drawerBtns === 2, `${narrow.drawerBtns} 个`);
  check('左右面板默认收起（不占画布空间）',
    narrow.leftVis === 'hidden' && narrow.rightVis === 'hidden',
    `left=${narrow.leftVis} right=${narrow.rightVis}`);

  // ── ④ 抽屉能抽出来，遮罩能关掉 ───────────────────────────────────
  await win.evaluate(() => {
    document.querySelector('.shell-drawer-btn.is-left')?.click();
  });
  await sleep(600);
  const opened = await win.evaluate(() => {
    const ws = document.querySelector('.workspace');
    const left = document.querySelector('.elem-pane-wrap');
    const r = left?.getBoundingClientRect();
    return {
      drawer: ws?.getAttribute('data-drawer') ?? null,
      vis: left ? getComputedStyle(left).visibility : '',
      width: r ? Math.round(r.width) : 0,
      // 抽屉必须真的在视口内（不是挪到屏幕外）
      inView: r ? (r.left >= -2 && r.left < window.innerWidth / 2) : false,
      hasScrim: !!document.querySelector('.shell-drawer-scrim')
    };
  });
  check('点左侧按钮 → 元素面板抽屉打开（真的在视口里）',
    opened.drawer === 'left' && opened.vis === 'visible' && opened.inView,
    `drawer=${opened.drawer} vis=${opened.vis} inView=${opened.inView} w=${opened.width}`);
  check('抽屉打开时有遮罩（点它就关）', opened.hasScrim === true, String(opened.hasScrim));

  await win.evaluate(() => document.querySelector('.shell-drawer-scrim')?.click());
  await sleep(500);
  const closed = await win.evaluate(() => ({
    drawer: document.querySelector('.workspace')?.getAttribute('data-drawer') ?? null,
    hasScrim: !!document.querySelector('.shell-drawer-scrim'),
    vis: document.querySelector('.elem-pane-wrap') ? getComputedStyle(document.querySelector('.elem-pane-wrap')).visibility : ''
  }));
  check('点遮罩 → 抽屉关闭', closed.drawer === 'none' && closed.hasScrim === false && closed.vis === 'hidden',
    `drawer=${closed.drawer} scrim=${closed.hasScrim}`);

  // 右侧抽屉同样能用
  await win.evaluate(() => document.querySelector('.shell-drawer-btn.is-right')?.click());
  await sleep(600);
  const rightOpen = await win.evaluate(() => {
    const ws = document.querySelector('.workspace');
    const rp = document.querySelector('.right-pane-wrap')?.getBoundingClientRect();
    return {
      drawer: ws?.getAttribute('data-drawer') ?? null,
      inView: rp ? (rp.right <= window.innerWidth + 2 && rp.right > window.innerWidth / 2) : false,
      hasInspector: !!document.querySelector('.inspector')
    };
  });
  check('点右侧按钮 → 属性面板抽屉打开，且内容真的在里面',
    rightOpen.drawer === 'right' && rightOpen.inView && rightOpen.hasInspector,
    `drawer=${rightOpen.drawer} inView=${rightOpen.inView} inspector=${rightOpen.hasInspector}`);
  await win.evaluate(() => document.querySelector('.shell-drawer-scrim')?.click());
  await sleep(500);

  // ── ⑤ 三个真机尺寸下都没有横向溢出（R6-8）────────────────────────
  for (const preset of ['android', 'iphone', 'compact']) {
    const r = await setSize(win, preset);
    await sleep(400);
    const of = await win.evaluate(scanOverflow);
    check(`${preset}（${r?.width}×${r?.height}）无横向溢出`,
      of.bad.length === 0 && of.docScrollW <= of.vw + 2,
      `scrollW=${of.docScrollW} vw=${of.vw}` + (of.bad.length ? ` · ${of.bad.map((b) => `${b.tag}.${b.cls}@${b.right}`).join(', ')}` : ''));
  }

  // ── ⑥ 触摸目标 ≥44×44（R6-10）────────────────────────────────────
  const small = await win.evaluate(scanTouch);
  check('窄屏下可点元素都 ≥44×44（R6-10）',
    small.length === 0,
    small.length ? small.slice(0, 5).map((s) => `${s.cls}[${s.w}×${s.h}] ${s.text}`).join(' · ') : '');

  // ── ⑦ 回到宽屏：抽屉自动收起、按钮消失 ───────────────────────────
  await setSize(win, 'reset');
  await sleep(600);
  const backWide = await win.evaluate(() => {
    const app = document.querySelector('.app');
    return {
      shell: app?.getAttribute('data-shell') ?? null,
      w: window.innerWidth,
      drawerBtn: document.querySelectorAll('.shell-drawer-btn').length,
      drawer: document.querySelector('.workspace')?.getAttribute('data-drawer') ?? null
    };
  });
  check('恢复编辑尺寸后回到 wide 形态', backWide.shell === 'wide', `shell=${backWide.shell} w=${backWide.w}`);
  check('宽屏下抽屉按钮消失、抽屉状态清空',
    backWide.drawerBtn === 0 && backWide.drawer === 'none',
    `btn=${backWide.drawerBtn} drawer=${backWide.drawer}`);

  /**
   * v0.4.6：抽屉的**边缘滑动手势**（用户："往屏幕内部滑动打开，往屏幕边缘滑动关闭，
   * 热区要大，按钮之外的地方滑动也能打开，还要能打断、要防误触"）。
   * 这里用合成 PointerEvent（pointerType: touch）直接驱动 hook，不依赖真机。
   */
  await win.evaluate(() => window.bc.setAcceptanceSize('android'));
  await sleep(900);
  const swipe = async (fromX, fromY, toX, toY) => {
    await win.evaluate(([fx, fy, tx, ty]) => {
      const fire = (type, x, y) => {
        const ev = new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
          isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y
        });
        (document.elementFromPoint(x, y) || document.body).dispatchEvent(ev);
      };
      fire('pointerdown', fx, fy);
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        fire('pointermove', fx + ((tx - fx) * i) / steps, fy + ((ty - fy) * i) / steps);
      }
      fire('pointerup', tx, ty);
    }, [fromX, fromY, toX, toY]);
    await sleep(500);
  };

  const w0 = await win.evaluate(() => window.innerWidth);
  // 从左边缘（按钮之外、屏幕边缘 10px 处）往右滑 → 打开左侧抽屉
  await swipe(10, 400, Math.min(w0 - 40, 200), 404);
  const afterOpen = await win.evaluate(() => ({
    drawer: document.querySelector('.workspace')?.getAttribute('data-drawer') ?? null,
    handleOpacity: (() => {
      const b = document.querySelector('.shell-drawer-btn.is-left');
      return b ? getComputedStyle(b).opacity : null;
    })()
  }));
  check('从屏幕左边缘往内滑 → 打开左侧抽屉（热区不止按钮本身）',
    afterOpen.drawer === 'left', `drawer=${afterOpen.drawer}`);
  check('抽屉打开时把手隐藏（关闭方向已有手势）',
    afterOpen.handleOpacity !== null && Number(afterOpen.handleOpacity) < 0.1,
    `opacity=${afterOpen.handleOpacity}`);

  // 在抽屉里往左边缘滑 → 关闭
  await swipe(Math.min(w0 - 40, 200), 400, 4, 404);
  const afterClose = await win.evaluate(() => document.querySelector('.workspace')?.getAttribute('data-drawer') ?? null);
  check('往屏幕边缘滑 → 关闭抽屉', afterClose === 'none', `drawer=${afterClose}`);

  // 防误触：竖着划一下（起手在边缘）不应该打开抽屉
  await swipe(10, 300, 14, 520);
  const afterVertical = await win.evaluate(() => document.querySelector('.workspace')?.getAttribute('data-drawer') ?? null);
  check('竖滑（滚动手势）不会误开抽屉', afterVertical === 'none', `drawer=${afterVertical}`);

  // v0.4.6：竖屏工具栏改两行（竖向空间大，横向别把按钮滚出屏幕）
  const tb = await win.evaluate(() => {
    const t = document.querySelector('.toolbar');
    const main = document.querySelector('.tb-main');
    const right = document.querySelector('.tb-right');
    if (!t) return null;
    const tr = t.getBoundingClientRect();
    return {
      h: Math.round(tr.height),
      mainTop: main ? Math.round(main.getBoundingClientRect().top) : -1,
      rightTop: right ? Math.round(right.getBoundingClientRect().top) : -1,
      mainScroll: main ? main.scrollWidth > main.clientWidth + 2 : null
    };
  });
  check('竖屏工具栏折成两行（右侧那组在第一行）',
    !!tb && tb.h >= 60 && tb.rightTop < tb.mainTop,
    tb ? JSON.stringify(tb) : 'no toolbar');
  check('竖屏工具栏不再横向滚（不会把按钮滚出屏幕）',
    !!tb && tb.mainScroll === false, tb ? String(tb.mainScroll) : 'no toolbar');

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
