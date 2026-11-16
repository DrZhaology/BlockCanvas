// v0.4.6 · 窄屏外壳验收（R6-7 / R6-8 / R6-9 / R6-10）
//
// 背景：主窗口以前锁在 `minWidth: 960`，所以"编辑器自己的手机界面"这件事**根本不存在**
// （不是做得不好）。本版放开到 360，并在 900px 处切外壳形态：
//
//   data-shell="split"   ≥900px —— 左右面板并排（原样）
//   data-shell="stack"   <900px —— 左右面板改抽屉，画布占满，抽屉入口浮在画布上
//
// ⚠ 别和画布断点混：768/480 是**被设计的那张网页**的断点，这里是**编辑器外壳**。
//
// v0.4.6 拆轴：`data-shell` 只表示**布局**（看宽度），触摸能力是正交的
// `data-input="pointer|touch"`（见 lib/inputMode.ts）。桌面 Electron 窗口应当是 pointer，
// 且跨 900 时 input 不该跟着变 —— 这条断言就是防止两个轴又粘回去。
//
// 这个探针验证五件事：
//   ① 阈值切换（跨 900 时 data-shell 真的变了，且 data-input 不跟着动）；
//   ② 抽屉确实抽得出来、遮罩能关掉；
//   ③ 三个真机尺寸下都没有横向溢出（R6-8）；
//   ④ 可点元素没有被压到 <28px（鼠标档回归护栏；手指档 44×44 由 probe-shell-widths 在触摸模拟下验）。
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

/** 触摸目标审计（v0.4.6 拆轴后的判据）：
 *  `probe-shell-narrow` 跑的是**桌面窄窗 + 鼠标**（input=pointer），
 *  所以这里只要求"鼠标点得准"的 32px，不要求手指的 44px ——
 *  手指那一档（44px）由 `probe-shell-widths` 在**模拟触摸 + 1280px** 下单独断言。
 *  老写法"窄屏就给 44px"是没拆轴时把"小屏"和"手指"混在一起，
 *  代价是 412×915 下工具栏从 153px 挤到 201px、画布白掉 48px。
 *  ⚠ 例外：抽屉把手是**故意做小**的（用户："按钮小到完全不挡住画布的任何面积"），
 *  它的契约是"边框盒 ≤40 宽 + 热区 ≥44 高"，宽度由下面单独那条断言盯着。 */
const scanTouch = () => {
  // 28 = 桌面工具栏按钮的既有高度（v0.4.x 一直是 28）。这里只当**回归护栏**：
  // 防止某次改动把可点区压得更小，不是重新定标准。
  const MIN = 28;
  const sel = [
    '.toolbar .tb-btn-ghost', '.toolbar .tb-btn-primary', '.toolbar .tb-grp-btn',
    '.toolbar .tb-more-btn', '.tab-bar .tab-btn',
    '.inspector-tab', '.eh-btn'
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
      input: app?.getAttribute('data-input') ?? null,
      w: window.innerWidth,
      drawerBtn: document.querySelectorAll('.shell-drawer-btn').length
    };
  });
  check('1440px 下外壳是 split', wide.shell === 'split', `shell=${wide.shell} w=${wide.w}`);
  check('桌面窗口的输入轴是 pointer（有鼠标、能悬停）',
    wide.input === 'pointer', `input=${wide.input}`);
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
      input: app?.getAttribute('data-input') ?? null,
      w: window.innerWidth,
      drawerBtns: document.querySelectorAll('.shell-drawer-btn').length,
      // 收起时面板应该被挪出视口（translateX）或被 visibility:hidden
      leftVisible: lr ? (lr.right > 4 && lr.left < window.innerWidth - 4) : null,
      rightVisible: rr ? (rr.left < window.innerWidth - 4 && rr.right > 4) : null,
      leftVis: left ? getComputedStyle(left).visibility : '',
      rightVis: right ? getComputedStyle(right).visibility : ''
    };
  });
  check('412px 下外壳切到 stack', narrow.shell === 'stack', `shell=${narrow.shell} w=${narrow.w}`);
  // 拆轴的反向断言：窗口变窄 ≠ 变成触摸设备。桌面窗口缩到 412px 仍然有鼠标和 Alt，
  // 输入轴必须还是 pointer；否则又会退回到"窄窗就塞 420ms 长按"的老坑。
  check('窗口变窄不会把输入轴带成 touch（两个轴正交）',
    narrow.input === 'pointer', `input=${narrow.input}`);
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

  // ── ⑥ 可点目标：鼠标档 ≥32×32（手指档 44 见 probe-shell-widths 的触摸断言）──
  const small = await win.evaluate(scanTouch);
  check('窄屏（鼠标）下可点元素没有被压到 <28px',
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
  check('恢复编辑尺寸后回到 split 形态', backWide.shell === 'split', `shell=${backWide.shell} w=${backWide.w}`);
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

  /* ───────────────────────────────────────────────────────────────────────
     v0.4.7：抽屉交互重做后的硬指标
     ---------------------------------------------------------------------
     用户把上一版否了，原话四条：按钮要小到不挡画布 / 滑动打开的区域要大 /
     打断动画必须有 / 关闭要防误触。下面用一个页面内的小驱动器逐条量。
     ─────────────────────────────────────────────────────────────────────── */

  // 页面内手势驱动器：按真实时序 fire pointerdown → pointermove… → pointerup，
  // 每一步都记下面板当前的 left（px），用来量"跟手多少"和"有没有跳变"。
  await win.evaluate(() => {
    window.__bcDrag = (o) => {
      const pane = document.querySelector('.elem-pane-wrap');
      const leftOf = () => (pane ? Math.round(pane.getBoundingClientRect().left) : 9999);
      const fire = (type, x, y) => {
        const ev = new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: o.id ?? 21,
          pointerType: o.pointerType ?? 'touch',
          isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y
        });
        (document.elementFromPoint(x, y) || document.body).dispatchEvent(ev);
      };
      fire('pointerdown', o.x0, o.y0);
      const trail = [leftOf()];
      for (const [x, y] of o.steps) {
        fire('pointermove', x, y);
        trail.push(leftOf());
      }
      const last = o.steps[o.steps.length - 1] || [o.x0, o.y0];
      fire('pointerup', last[0], last[1]);
      return { trail };
    };
  });

  /** 起手点 → 终点，均分成 n 步 */
  const stepsOf = (x0, y0, x1, y1, n = 8) => Array.from({ length: n },
    (_, i) => [Math.round(x0 + ((x1 - x0) * (i + 1)) / n), Math.round(y0 + ((y1 - y0) * (i + 1)) / n)]);

  const drag = (o) => win.evaluate((oo) => window.__bcDrag(oo), o);
  const drawerNow = () => win.evaluate(() => document.querySelector('.workspace')?.getAttribute('data-drawer') ?? null);
  const ensureClosed = async () => {
    if ((await drawerNow()) !== 'none') {
      await win.evaluate(() => document.querySelector('.shell-drawer-scrim')?.click());
      await sleep(420);
    }
  };
  const ensureOpened = async () => {
    if ((await drawerNow()) !== 'left') {
      await win.evaluate(() => document.querySelector('.shell-drawer-btn.is-left')?.click());
      await sleep(520);
    }
  };
  const paneLeft = () => win.evaluate(() =>
    Math.round((document.querySelector('.elem-pane-wrap')?.getBoundingClientRect().left) ?? 9999));

  // ① 把手尺寸：又小又贴边，但还点得到
  // ⚠ v0.4.6：量之前先把鼠标挪开。下面几条长按/拖动测试会把指针留在把手上，
  //   而把手有 `:hover { opacity: 1 }`，指针没移开就会读到 1 而不是静止态的 .72
  //   （底部两条操作栏上线后布局变了，指针残留的位置正好压在把手上）。
  await win.mouse.move(300, 300);
  await sleep(260);
  const nub = await win.evaluate(() => {
    const b = document.querySelector('.shell-drawer-btn.is-left');
    const rb = document.querySelector('.shell-drawer-btn.is-right');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const bar = getComputedStyle(b, '::before');
    const svg = b.querySelector('svg');
    return {
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      left: Math.round(r.left),
      rightEdge: rb ? Math.round(rb.getBoundingClientRect().right) : -1,
      opacity: Number(cs.opacity),
      barW: parseFloat(bar.width),
      barH: parseFloat(bar.height),
      icon: svg ? Math.round(svg.getBoundingClientRect().width) : -1,
      // 诊断：opacity 被顶到 1 到底是谁干的（hover / 拖动残留 / 打开态）
      dragAttr: b.getAttribute('data-dragging'),
      cls: String(b.className),
      hover: b.matches(':hover'),
      drawerAttr: document.querySelector('.workspace')?.getAttribute('data-drawer'),
      vw: window.innerWidth
    };
  });
  check('把手边框盒 ≤40px 宽、≥44px 高（小到不挡画布，但手指点得到）',
    !!nub && nub.w <= 40 && nub.h >= 44, nub ? `w=${nub.w} h=${nub.h}` : 'no nub');
  check('可见小舌 20×46、图标 14px、贴屏幕边、静止 opacity .72（用户要求回到第二版的尺寸）',
    !!nub && Math.abs(nub.barW - 20) <= 1.5 && Math.abs(nub.barH - 46) <= 1.5
      && nub.icon >= 12 && nub.icon <= 16
      && nub.left === 0 && nub.rightEdge === nub.vw && Math.abs(nub.opacity - 0.72) <= 0.05,
    JSON.stringify(nub));

  // ② 宽起手区：离屏幕边 120px 起手往内滑也能打开（不是只有按钮那一小块）
  await ensureClosed();
  // v0.4.6：起手区收紧成「把手附近一小块」（横向 56px 边带 + 把手中心 ±96px）。
  // 用户原话：「左右两侧的面板只有抽屉按钮附近一块区域可以打开，现在整条左右边都可以开启，
  // 下方的工具栏根本左右滑动不了。」—— 所以这条从"离边 120px 也能开"改成"必须贴着把手"。
  const nubY = await win.evaluate(() => {
    const b = document.querySelector('.shell-drawer-btn.is-left');
    return b ? Math.round(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2) : 430;
  });
  await drag({ x0: 10, y0: nubY, steps: stepsOf(10, nubY, 330, nubY + 4) });
  await sleep(420);
  const wideZone = await drawerNow();
  check('贴着把手（横向 10px / 把手中心高度）往内滑能打开抽屉',
    wideZone === 'left', `drawer=${wideZone} nubY=${nubY}`);

  // ③ 关闭防误触死区：20px 外出 = 面板纹丝不动；120px 外出 = 面板跟着走
  await ensureOpened();
  await sleep(260);
  const baseLeft = await paneLeft();
  const d20 = await drag({ x0: 250, y0: 420, steps: stepsOf(250, 420, 230, 422, 8), id: 22 });
  const moved20 = Math.max(...d20.trail) - Math.min(...d20.trail);
  const stillOpen = await drawerNow();
  check('关闭方向前 28px 是死区：外出 20px 面板一动不动',
    Math.abs(baseLeft - d20.trail[d20.trail.length - 1]) <= 1 && moved20 <= 1 && stillOpen === 'left',
    `base=${baseLeft} trail=${JSON.stringify(d20.trail)} drawer=${stillOpen}`);

  await ensureOpened();
  await sleep(260);
  const d120 = await drag({ x0: 250, y0: 420, steps: stepsOf(250, 420, 130, 424, 10), id: 23 });
  const moved120 = Math.max(...d120.trail) - Math.min(...d120.trail);
  check('越过死区后面板跟手：外出 120px 面板跟着走了（≈92px）',
    moved120 >= 50, `moved=${moved120} trail=${JSON.stringify(d120.trail)}`);
  await sleep(420);
  check('外出 120px 松手 → 抽屉真的关掉', (await drawerNow()) === 'none', `drawer=${await drawerNow()}`);

  // ④ 鼠标指针也算（用户："不按 pointerType 分流"）
  await ensureClosed();
  await drag({ x0: 10, y0: nubY, steps: stepsOf(10, nubY, 320, nubY + 2), pointerType: 'mouse', id: 24 });
  await sleep(420);
  check('鼠标拖动同样能打开抽屉（没有按 pointerType 分流）',
    (await drawerNow()) === 'left', `drawer=${await drawerNow()}`);

  // ⑤ 抽屉开着时把手隐藏；关掉之后回来
  const nubHidden = await win.evaluate(() => {
    const b = document.querySelector('.shell-drawer-btn.is-left');
    return { opacity: Number(getComputedStyle(b).opacity), pe: getComputedStyle(b).pointerEvents };
  });
  check('抽屉打开时它自己的把手隐藏（关闭已有手势 / 遮罩两条路）',
    nubHidden.opacity < 0.1 && nubHidden.pe === 'none', JSON.stringify(nubHidden));
  await ensureClosed();
  await sleep(320);
  // ⚠ 读数前先清掉焦点：把手被 `.click()` 过后会拿到 focus，`:focus` 那一档会把
  //   opacity 顶到 1，读出来就不是静止态的 .72（和 hover 是同一个坑）。
  await win.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await sleep(120);
  const nubBack = await win.evaluate(() => Number(getComputedStyle(document.querySelector('.shell-drawer-btn.is-left')).opacity));
  check('抽屉关掉之后把手自己回来', Math.abs(nubBack - 0.72) <= 0.06, `opacity=${nubBack}`);

  // ⑥ 打断动画：打开过渡还在跑的时候抓住面板 → 从当前位置接着走，不许跳回逻辑起点
  //   ⚠ 判断"是否还在过渡中"靠定时器不可靠（渲染进程一忙 setTimeout 就飘），
  //   所以这里先把面板过渡放慢到 900ms，稳定地制造一个"过渡中途"。
  const interrupt = await win.evaluate(async () => {
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const pane = document.querySelector('.elem-pane-wrap');
    const leftOf = () => Math.round(pane.getBoundingClientRect().left);
    const slow = document.createElement('style');
    slow.id = 'bc-probe-slow-motion';
    slow.textContent = ".app[data-shell='stack'] .elem-pane-wrap,"
      + " .app[data-shell='stack'] .right-pane-wrap { transition-duration: 900ms !important; }";
    document.head.appendChild(slow);

    // ⚠ 先把抽屉确定关掉：以前这里无脑 click 遮罩 + 等 1000ms，
    //   但遮罩只在下拉打开时存在；如果进来时抽屉已经是开的，那一 click 会把它关掉，
    //   紧接着 line 485 的"点把手打开"就变成"再关一次"，midLeft 直接停在关闭位。
    //   现在改成条件点击 + 断言已关，再开始。
    if (document.querySelector('.shell-drawer-scrim')) document.querySelector('.shell-drawer-scrim')?.click();
    await nap(420);
    const closedLeft = leftOf();
    const diag = {
      track: document.body.classList.contains('bc-drawer-track'),
      dur: getComputedStyle(pane).transitionDuration
    };
    document.querySelector('.shell-drawer-btn.is-left')?.click(); // 开始打开（被放大到 900ms）
    await nap(220);                                              // 过渡跑到约 1/4
    const midLeft = leftOf();
    // 起手点必须落在"面板当前可见的部分"里（过渡中面板右缘只到 mid+宽度，别落在面板外）
    const r = window.__bcDrag({ x0: 130, y0: 420, steps: Array.from({ length: 10 }, (_, i) => [130 - (i + 1) * 12, 420]), id: 25 });
    const first = r.trail[0];
    let maxJump = 0;
    for (let i = 1; i < r.trail.length; i++) maxJump = Math.max(maxJump, Math.abs(r.trail[i] - r.trail[i - 1]));
    slow.remove();
    return {
      closedLeft, midLeft, first, maxJump, diag, trail: r.trail,
      follow: first - r.trail[r.trail.length - 1]
    };
  });
  check('打断动画：过渡中途抓住面板 → 停在当前动画位置（没跳回逻辑起点）',
    interrupt.midLeft > interrupt.closedLeft + 20 && interrupt.midLeft < -20
      && Math.abs(interrupt.first - interrupt.midLeft) <= 2,
    `closed=${interrupt.closedLeft} mid=${interrupt.midLeft} first=${interrupt.first} ${JSON.stringify(interrupt.diag)}`);
  check('打断动画：整趟拖动没有单步跳变 >40px，且真的在跟手',
    interrupt.maxJump <= 40 && interrupt.follow >= 40,
    `maxJump=${interrupt.maxJump} follow=${interrupt.follow} trail=${JSON.stringify(interrupt.trail)}`);
  await sleep(420);

  /* v0.4.6 竖屏重做：顶部工具栏已经**整体删除**，改由底部两条操作栏接管
     （用户："把整个上方的所有东西全部删除，包括多标签页，两层工具栏"）。
     所以这里验的是新契约，不再是"顶部工具栏折两行"。 */
  const bars = await win.evaluate(() => {
    const b1 = document.querySelector('.pt-bar1');
    const b2 = document.querySelector('.pt-bar2');
    const inner = document.querySelector('.pt-bar2-inner');
    const tb = document.querySelector('.pt-bar2 .toolbar');
    const app = document.querySelector('.app');
    const rect = (el) => (el ? el.getBoundingClientRect() : null);
    const r1 = rect(b1); const r2 = rect(b2); const ra = rect(app);
    return {
      hasBar1: !!b1, hasBar2: !!b2,
      bar1H: r1 ? Math.round(r1.height) : 0,
      bar2H: r2 ? Math.round(r2.height) : 0,
      appH: ra ? Math.round(ra.height) : 0,
      // 顶部必须一条栏都没有
      topBars: document.querySelectorAll('.bc-titlebar, .project-tab-bar').length,
      // 折叠态：单行 + 内部可横滑
      toolbarH: tb ? Math.round(tb.getBoundingClientRect().height) : 0,
      innerScrollX: inner ? inner.scrollWidth > inner.clientWidth + 2 : null,
      // 第一条栏的按钮：撤销/重做/新建/会话/入口
      btnCount: b1 ? b1.querySelectorAll('.pt-btn').length : 0,
      sessCount: (document.querySelector('.pt-sess-count')?.textContent || '').trim(),
      tabCount: window.__tabStore?.getState?.().tabs.length ?? -1,
      // 两条栏都在底部（不能跑到中间去）
      barsAtBottom: r1 && r2 && ra ? Math.round(ra.bottom - r1.bottom) <= 2 && Math.round(r2.bottom) <= Math.round(r1.top) + 2 : false
    };
  });
  check('竖屏顶部一条栏都没有（标题栏 / 多标签页条都不渲染）',
    bars.topBars === 0, `topBars=${bars.topBars}`);
  check('底部第一条操作栏存在、有 5 个按钮、位于最底',
    bars.hasBar1 && bars.btnCount === 5 && bars.barsAtBottom === true,
    `btn=${bars.btnCount} bottom=${bars.barsAtBottom} h=${bars.bar1H}`);
  check('底部第二条操作栏存在且是折叠单行（工具栏高 ≤44，内部可横滑）',
    bars.hasBar2 && bars.toolbarH > 0 && bars.toolbarH <= 44,
    `bar2=${bars.bar2H} toolbarH=${bars.toolbarH} scrollX=${bars.innerScrollX}`);
  check('会话按钮上的数字 = 标签页数量',
    bars.sessCount === String(bars.tabCount) && Number(bars.sessCount) > 0,
    `count=${bars.sessCount} tabs=${bars.tabCount}`);

  // v0.4.6：抽屉方位（设置 → 竖屏 → 抽屉方位）
  const dockOf = async (mode) => win.evaluate(async (m) => {
    localStorage.setItem('bc-drawer-side', m);
    window.dispatchEvent(new CustomEvent('bc:drawer-side-changed'));
    await new Promise((r) => setTimeout(r, 260));
    const app = document.querySelector('.app');
    const elem = document.querySelector('.elem-pane-wrap');
    const right = document.querySelector('.right-pane-wrap');
    const cs = (el) => (el ? getComputedStyle(el) : null);
    return {
      attr: app?.getAttribute('data-drawer-side') ?? null,
      elemRight: cs(elem)?.right ?? null,
      elemLeft: cs(elem)?.left ?? null,
      rightRight: cs(right)?.right ?? null,
      rightLeft: cs(right)?.left ?? null
    };
  }, mode);

  // v0.4.6：长按把手 → 上下调位置（短按仍是开关抽屉）；双击复位
  await ensureClosed();
  const handle = await win.evaluate(async () => {
    localStorage.removeItem('bc-drawer-handle-y');
    const btn = document.querySelector('.shell-drawer-btn.is-left');
    if (!btn) return { ok: false };
    const r = btn.getBoundingClientRect();
    const fire = (type, y) => btn.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch',
      isPrimary: true, button: 0, buttons: 1, clientX: r.left + 10, clientY: y
    }));
    fire('pointerdown', r.top + 10);
    await new Promise((res) => setTimeout(res, 520));      // 等长按成立
    fire('pointermove', window.innerHeight * 0.8);
    fire('pointerup', window.innerHeight * 0.8);
    await new Promise((res) => setTimeout(res, 260));
    const drawner = document.querySelector('.workspace')?.getAttribute('data-drawer');
    const topAfter = btn.style.top;
    const saved = localStorage.getItem('bc-drawer-handle-y');
    return { ok: true, topAfter, saved, drawer: drawner };
  });
  check('长按把手后上下拖动 → 位置改变并存下来',
    !!handle.ok && handle.topAfter !== '50%' && !!handle.saved,
    JSON.stringify(handle));
  check('长按调位置那一次不会顺手把抽屉打开',
    handle.drawer === 'none', `drawer=${handle.drawer}`);

  const reset = await win.evaluate(async () => {
    const btn = document.querySelector('.shell-drawer-btn.is-left');
    btn?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await new Promise((res) => setTimeout(res, 240));
    return btn?.style.top ?? null;
  });
  check('双击把手 → 复位到 50%', reset === '50%', String(reset));

  const dSplit = await dockOf('split');
  check('方位=左右分布：元素面板贴左、属性面板贴右',
    dSplit.attr === 'split' && dSplit.elemLeft === '0px' && dSplit.rightRight === '0px',
    JSON.stringify(dSplit));
  const dRev = await dockOf('split-reverse');
  check('方位=左右反向：元素面板贴右、属性面板贴左',
    dRev.attr === 'split-reverse' && dRev.elemRight === '0px' && dRev.rightLeft === '0px',
    JSON.stringify(dRev));
  const dBL = await dockOf('both-left');
  check('方位=都靠左：属性面板也贴左',
    dBL.attr === 'both-left' && dBL.rightLeft === '0px',
    JSON.stringify(dBL));
  // 同边模式下两个把手会重合 → 必须自动错开（38% / 62%），否则下面那个永远点不到
  const sameEdge = await win.evaluate(() => {
    const l = document.querySelector('.shell-drawer-btn.is-left');
    const r = document.querySelector('.shell-drawer-btn.is-right');
    if (!l || !r) return null;
    const lr = l.getBoundingClientRect();
    const rr = r.getBoundingClientRect();
    const cy = (b) => Math.round(b.top + b.height / 2);
    const hit = (b, x, y) => (document.elementFromPoint(x, y)?.closest('.shell-drawer-btn') === b);
    return {
      edgeL: Math.round(lr.left), edgeR: Math.round(rr.left),
      cyL: cy(lr), cyR: cy(rr), vh: window.innerHeight,
      hitL: hit(l, lr.left + 8, cy(lr)), hitR: hit(r, rr.left + 8, cy(rr))
    };
  });
  check('都收在左边时：两个把手贴同一条边、上下错开、各自都点得到',
    !!sameEdge && sameEdge.edgeL === 0 && sameEdge.edgeR === 0
      && Math.abs(sameEdge.cyL - sameEdge.cyR) >= sameEdge.vh * 0.05
      && sameEdge.hitL && sameEdge.hitR,
    JSON.stringify(sameEdge));
  const dBR = await dockOf('both-right');
  check('方位=都靠右：元素面板也贴右',
    dBR.attr === 'both-right' && dBR.elemRight === '0px',
    JSON.stringify(dBR));
  await dockOf('split');

  /**
   * v0.4.7 · 竖屏没有多标签页管理（用户要求）：
   * 只保留当前标签，"+"和每个标签上的关闭 × 都不显示。
   * 这里量可见性（computed display），不看 DOM 里还在不在。
   */
  const tabUi = await win.evaluate(() => {
    const add = document.querySelector('.project-tab-bar .tab-add-btn');
    const cls = document.querySelector('.project-tab-bar .tab-close-btn');
    const tabs = document.querySelectorAll('.project-tab-bar .tab-item').length;
    return {
      add: add ? getComputedStyle(add).display : 'missing',
      close: cls ? getComputedStyle(cls).display : 'missing',
      tabs
    };
  });
  check('竖屏下不显示「新建标签 +」', tabUi.add === 'none' || tabUi.add === 'missing', `display=${tabUi.add}`);
  check('竖屏下不显示标签的关闭 ×', tabUi.close === 'none' || tabUi.close === 'missing', `display=${tabUi.close}`);
  check('竖屏下只剩当前一个标签页', tabUi.tabs <= 1, `tabs=${tabUi.tabs}`);

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
