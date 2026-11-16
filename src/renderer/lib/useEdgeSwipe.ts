// ============================================================================
// BlockCanvas · 窄屏抽屉的手势引擎（v0.4.7 重做）
// ----------------------------------------------------------------------------
// 用户原话（上一版被否了，这版逐条对着做，不再自作聪明）：
//   「这个抽屉点击抽屉本身才能打开，或者往屏幕内部滑动（比如左边的抽屉往右，
//     右边的抽屉往左）。滑动打开的区域要大，按钮外的一些面积滑动也能打开，
//     不是只有在按钮那一小块区域滑动能打开。打开的面板，如果往屏幕边缘的方向
//     滑动可以关闭……同时两个的打开、打断动画都要有，没错这里特别注意！打断动画！
//     同时关闭抽屉的时候做一下防误触，也就是刚刚往边缘方向滑动的一段具体改成
//     抽屉不会动，这段时间识别一下是竖向滑动还是关闭抽屉。这里防误触要做好。」
//
// 五条硬约定（tests/e2e/probe-shell-narrow.mjs 逐条量）：
//   ① **起手区很大**：视口两侧各 25%（且不小于 140px）都能起手，不再只有按钮那一小块；
//   ② **方向先判**：前 14px 只用来分"横滑 / 竖滚"，判成竖滚就整趟让给页面滚动；
//   ③ **可打断**：pointerdown 的第一件事是把面板**当前**的实时位移（计算矩阵里的
//      translateX，正在跑的过渡也算）冻进行内变量 --bc-drawer-x 并关掉过渡 ——
//      于是"过渡还在跑时再抓一把"是从当前位置接着走，而不是跳回逻辑起点；
//      松手把变量删掉、交还 CSS 的 open/closed 状态，过渡就从当前位置平滑收尾；
//   ④ **关闭防误触**：方向锁成立后先走 28px 死区（面板一动不动），死区里只要 |dy|
//      反超 |dx| 就整趟取消 —— 这是"想滚页面却把抽屉关掉"的唯一可靠解药；
//   ⑤ 不按 pointerType 分流：触屏 / 鼠标 / 手写笔同一套逻辑（鼠标也得能拖）。
//
// 位移符号：物理左边的抽屉收起时是 -102%（负），物理右是 +102%（正）；
// 因此所有"当前位移"都落在 [closedTx, 0] 这段区间里，clamp 只用这一个区间。
// ============================================================================
import { useEffect, useRef } from 'react';

export type DrawerSide = 'left' | 'right' | null;

/** 物理边（面板从哪条边进出） */
type Phys = 'left' | 'right';
/** 逻辑抽屉（'left' = 元素面板，'right' = 属性面板，与 App 的 drawer 同名） */
type Logical = 'left' | 'right';

const ZONE_RATIO = 0.25;   // 起手区 = 视口宽的 25%
const ZONE_MIN = 140;      // 但不小于 140px（412px 手机上就是这档，够"按钮外面也能滑"）
/**
 * v0.4.6：**打开**抽屉的起手区收紧成"把手附近一小块"。
 * 以前打开也用上面那条 25%（≥140px）的宽带 —— 等于左右各 140px 内任何横滑都被吃掉，
 * 底部工具栏、画布横向滑动全都滑不动（用户："整条左右边都可以开启"）。
 * 关闭方向仍用宽带（从面板里任意位置往外滑都能关，符合直觉）。
 */
const OPEN_ZONE_PX = 56;
/** 把手中心上下这么高的范围算"把手附近" */
const NUB_BAND = 96;
const DIR_LOCK = 14;       // 判方向所需的最小位移
const DEAD_BAND = 28;      // 关闭方向的死区（这段时间面板一动不动）
const OPEN_TRIGGER = 60;   // 往内滑够多远算"打开"
const CLOSE_TRIGGER = 60;  // 死区之后再往外滑够多远算"关闭"
const OFF_RATIO = 1.02;    // 与 CSS 的 102% 对齐

interface Gesture {
  pointerId: number;
  /** 这一趟是"开"还是"关"（起手时按当时的状态定死） */
  intent: 'open' | 'close';
  /** 阶段：undecided = 还在判方向 */
  mode: 'undecided' | 'open' | 'close';
  logical: Logical;
  phys: Phys;
  pane: HTMLElement;
  startX: number;
  startY: number;
  /** 起手瞬间的实时位移（px）；后续位移都在它上面加减 */
  snapTx: number;
  /** 收起时的位移（px，负或正） */
  closedTx: number;
  /** 是否已经越过关闭死区 */
  pastBand: boolean;
}

/** 把位移夹在 [收起, 0] 之间（收起是负还是正取决于物理边） */
function clampTx(v: number, closedTx: number): number {
  return closedTx < 0 ? Math.min(0, Math.max(closedTx, v)) : Math.max(0, Math.min(closedTx, v));
}

/**
 * 读面板**当前的实时位移**（含正在跑的过渡）。
 * 用计算矩阵的 e 分量：比"拿 rect 减静止位置"稳，因为过渡中的 rect 已经是插值后的。
 */
function readTx(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  const m3 = /matrix3d\(([^)]+)\)/.exec(t);
  if (m3) { const p = m3[1].split(','); return Number(p[12]) || 0; }
  const m2 = /matrix\(([^)]+)\)/.exec(t);
  if (m2) { const p = m2[1].split(','); return Number(p[4]) || 0; }
  return 0;
}

function paneOf(l: Logical): HTMLElement | null {
  return document.querySelector(
    l === 'left' ? '.elem-pane-wrap' : '.right-pane-wrap'
  ) as HTMLElement | null;
}

/** 逻辑抽屉 → 它从哪条物理边进出（由 App 上的 data-drawer-side 决定） */
function physOf(l: Logical, mode: string | null): Phys {
  if (mode === 'split-reverse') return l === 'left' ? 'right' : 'left';
  if (mode === 'both-left') return 'left';
  if (mode === 'both-right') return 'right';
  return l; // split
}

/** 某个逻辑抽屉的把手中心 Y（同边两个把手时用来挑"离手指最近的那个"） */
function nubCenterY(l: Logical): number {
  const b = document.querySelector(`.shell-drawer-btn.is-${l}`) as HTMLElement | null;
  if (!b) return Number.POSITIVE_INFINITY;
  const r = b.getBoundingClientRect();
  return r.height ? r.top + r.height / 2 : Number.POSITIVE_INFINITY;
}

export function useEdgeSwipe(opts: {
  enabled: boolean;
  drawer: DrawerSide;
  setDrawer: (d: DrawerSide) => void;
  /** 抽屉本身宽度（现在由真实 rect 量，这里只作兜底，保持签名不变） */
  paneWidth?: () => number;
}) {
  const st = useRef<Gesture | null>(null);
  /** 手势代号：上一次手势排队的 rAF 回收不能把这一次正在用的变量删掉 */
  const token = useRef(0);
  // opts 是字面量对象、每次渲染都换新，监听不能跟着它重挂（否则 App 随便渲染一下
  // 就会把进行中的手势掐断）。所有实时值走 ref。
  const live = useRef(opts);
  live.current = opts;

  useEffect(() => {
    if (!opts.enabled) {
      // 宽屏没有抽屉：把跟手状态彻底清干净（切回并排时不留半截位移）
      st.current = null;
      document.body.classList.remove('bc-drawer-track');
      document.querySelectorAll<HTMLElement>('.elem-pane-wrap, .right-pane-wrap')
        .forEach((el) => el.style.removeProperty('--bc-drawer-x'));
      return;
    }

    const track = (on: boolean) => {
      if (on) document.body.classList.add('bc-drawer-track');
      else document.body.classList.remove('bc-drawer-track');
    };

    /** 把位移写进面板自己的行内变量（同时确保过渡是关掉的，否则手指和面板差一截） */
    const push = (pane: HTMLElement, tx: number) => {
      pane.style.setProperty('--bc-drawer-x', `${Math.round(tx)}px`);
      track(true);
    };

    /** 交还 CSS：先恢复过渡，下一帧再删变量 → 过渡从"当前值"平滑收尾（可打断的另一半） */
    const release = (pane: HTMLElement, my: number) => {
      track(false);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (my !== token.current) return; // 期间又起了一次手势，别动它的变量
        pane.style.removeProperty('--bc-drawer-x');
      }));
    };

    const cancel = (g: Gesture) => {
      st.current = null;
      release(g.pane, token.current);
    };

    const onDown = (e: PointerEvent) => {
      if (e.isPrimary === false) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // 画布 Alt+拖动 = 框选/移动，别抢（这不属于"滑动"，会让老用户以为坏了）
      if (e.altKey) return;
      if (st.current) return; // 一根手指一套状态机
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, [contenteditable="true"]')) return;

      const app = document.querySelector('.app');
      const sideMode = app?.getAttribute('data-drawer-side') ?? null;
      const open = live.current.drawer;
      const vw = window.innerWidth;
      const x = e.clientX;
      const y = e.clientY;
      const zone = Math.max(ZONE_MIN, vw * ZONE_RATIO);

      let logical: Logical | null = null;
      let intent: 'open' | 'close' = 'open';

      if (open) {
        // 关：从这条边滑出去。起手点落在面板里、或落在这条边的宽起手区里都算。
        const pane = paneOf(open);
        if (!pane) return;
        const phys = physOf(open, sideMode);
        const inZone = phys === 'left' ? x <= zone : x >= vw - zone;
        const inPane = !!(t && pane.contains(t));
        if (!inZone && !inPane) return;
        logical = open;
        intent = 'close';
      } else {
        /* 开：起手点必须**贴着屏幕边**、而且**靠近那个把手**。
           用户原话：「左右两侧的面板只有抽屉按钮附近一块区域可以打开，
           现在整条左右边都可以开启，下方的工具栏根本左右滑动不了。」
           —— 以前起手区是视口宽 25%，等于整条边都能开抽屉，
           屏幕上任何横向滑动都被它抢走，底部工具栏自然滑不动。
           现在：横向 56px 窄带 + 纵向把手中心 ±96px，只留把手附近一小块。 */
        const openZone = OPEN_ZONE_PX;
        const phys: Phys | null = x <= openZone ? 'left' : x >= vw - openZone ? 'right' : null;
        if (!phys) return;
        // 同边模式（both-left / both-right）两个抽屉都从这条边进出 →
        // 挑把手离手指最近的那个（默认 38% / 62%，不会挑错）
        const cand = (['left', 'right'] as Logical[])
          .filter((l) => physOf(l, sideMode) === phys && paneOf(l));
        if (!cand.length) return;
        logical = cand.length === 1
          ? cand[0]
          : cand.reduce((a, b) => (Math.abs(nubCenterY(a) - y) <= Math.abs(nubCenterY(b) - y) ? a : b));
        // 纵向再收一道：必须在把手上下 NUB_BAND 之内，否则这一下是想滚画布/滑工具栏
        if (Math.abs(y - nubCenterY(logical)) > NUB_BAND) return;
        intent = 'open';
      }

      const pane = paneOf(logical);
      if (!pane) return;
      const phys = physOf(logical, sideMode);
      const pw = pane.getBoundingClientRect().width || live.current.paneWidth?.() || 0;
      if (pw <= 0) return;

      // ① 立刻冻结在当前位置（过渡还在跑也没关系，这就是"打断"）
      const snapTx = readTx(pane);
      token.current += 1;
      push(pane, snapTx);

      st.current = {
        pointerId: e.pointerId,
        intent,
        mode: 'undecided',
        logical,
        phys,
        pane,
        startX: x,
        startY: y,
        snapTx,
        closedTx: (phys === 'left' ? -1 : 1) * OFF_RATIO * pw,
        pastBand: false
      };
    };

    const onMove = (e: PointerEvent) => {
      const g = st.current;
      if (!g || e.pointerId !== g.pointerId) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;

      // —— ① 判方向：位移太小就什么都不做（宁可晚 30ms，也别把竖滚吃掉）——
      if (g.mode === 'undecided') {
        if (Math.abs(dx) < DIR_LOCK && Math.abs(dy) < DIR_LOCK) return;
        if (Math.abs(dy) >= Math.abs(dx)) { cancel(g); return; } // 竖滑 → 整趟交还给页面
        const inward = g.phys === 'left' ? dx : -dx;
        if (g.intent === 'open') {
          if (inward <= 0) return; // 往边缘滑，不是打开手势
          g.mode = 'open';
        } else {
          if (inward >= 0) return; // 往内滑，不是关闭手势
          g.mode = 'close';
        }
      }

      if (g.mode === 'open') {
        const inward = g.phys === 'left' ? dx : -dx;
        if (inward <= 0) { push(g.pane, g.snapTx); return; }
        push(g.pane, clampTx(g.snapTx + inward, g.closedTx));
        return;
      }

      // —— ② 关闭：先走 28px 死区，这期间面板一动不动，继续判竖滑还是关闭 ——
      const out = g.phys === 'left' ? -dx : dx;
      if (!g.pastBand) {
        if (Math.abs(dy) > Math.abs(dx) + 1) { cancel(g); return; } // 死区内转成竖滑 → 取消
        if (out < DEAD_BAND) { push(g.pane, g.snapTx); return; }         // 死区：面板纹丝不动
        g.pastBand = true;
      }
      const dirSign = g.phys === 'left' ? -1 : 1;
      push(g.pane, clampTx(g.snapTx + dirSign * (out - DEAD_BAND), g.closedTx));
    };

    const onUp = (e: PointerEvent) => {
      const g = st.current;
      if (!g || e.pointerId !== g.pointerId) return;
      st.current = null;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      let decide: 'open' | 'close' | null = null;

      if (g.mode === 'open') {
        const inward = g.phys === 'left' ? dx : -dx;
        if (inward >= OPEN_TRIGGER) decide = 'open';
      } else if (g.mode === 'close') {
        const out = g.phys === 'left' ? -dx : dx;
        // 死区里就抬手的，面板压根没动过 —— 当然不算关闭
        if (g.pastBand && out >= CLOSE_TRIGGER && Math.abs(dy) <= Math.abs(dx)) decide = 'close';
      }

      if (decide === 'open') live.current.setDrawer(g.logical);
      else if (decide === 'close') live.current.setDrawer(null);
      release(g.pane, token.current);
    };

    const onCancel = (e: PointerEvent) => {
      const g = st.current;
      if (!g || e.pointerId !== g.pointerId) return;
      cancel(g);
    };

    /**
     * v0.4.7 触摸专项 —— 用户实测：「抽屉看似鼠标拖动能关闭，但是我手触屏实测关不掉。
     * 我觉得都是触摸，这可能就是程序问题了。」
     *
     * 用户判断对了，这是程序问题，不是 Windows 限制：
     * 触摸下手指移动超过 ~10px 时，浏览器会判定"这是滚动"并**抢走手势**，
     * 同时给我们的元素派发 `pointercancel` —— 我们那套 pointermove 流程当场被掐断，
     * 所以鼠标（没有滚动接管）一切正常，触摸却永远做不完动作。
     *
     * 治本：在 touchmove（passive:false）里，只要这一趟被判定为**横向**手势，
     * 就 preventDefault() —— 浏览器不启动滚动，pointer 流就不会被 cancel。
     * 竖滑一律放行，页面照常滚。
     */
    const onTouchMove = (e: TouchEvent) => {
      const g = st.current;
      if (!g) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - g.startX;
      const dy = t.clientY - g.startY;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
    };

    // capture 阶段注册：画布自己的 pointerdown 会 stopPropagation（框选 / Alt 手势），
    // 冒泡阶段的 window 监听根本收不到 —— 第一版就是这样，实测"怎么滑都不开"。
    const CAP = { passive: true, capture: true } as const;
    const TCAP = { passive: false, capture: true } as const;
    window.addEventListener('pointerdown', onDown, CAP);
    window.addEventListener('pointermove', onMove, CAP);
    window.addEventListener('pointerup', onUp, CAP);
    window.addEventListener('pointercancel', onCancel, CAP);
    window.addEventListener('touchmove', onTouchMove, TCAP);
    return () => {
      window.removeEventListener('pointerdown', onDown, CAP as never);
      window.removeEventListener('pointermove', onMove, CAP as never);
      window.removeEventListener('pointerup', onUp, CAP as never);
      window.removeEventListener('pointercancel', onCancel, CAP as never);
      window.removeEventListener('touchmove', onTouchMove, TCAP as never);
      st.current = null;
      track(false);
      document.querySelectorAll<HTMLElement>('.elem-pane-wrap, .right-pane-wrap')
        .forEach((el) => el.style.removeProperty('--bc-drawer-x'));
    };
  }, [opts.enabled]);
}
