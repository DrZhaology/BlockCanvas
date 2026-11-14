// ============================================================================
// BlockCanvas · 窄屏抽屉的边缘滑动手势（v0.4.6）
// ----------------------------------------------------------------------------
// 用户原话：
//   「改成非常小的两个抽屉形式的按钮，svg 要小……这个抽屉点击抽屉本身才能打开，
//     或者往屏幕内部滑动（比如左边的抽屉往右，右边的往左）。滑动打开的区域要大，
//     按钮外的一些面积滑动也能打开，不是只有在按钮那一小块区域滑动能打开。
//     打开的面板，如果往屏幕边缘的方向滑动可以关闭。同时两个的打开、打断动画都要有，
//     没错这里特别注意！打断动画！同时关闭抽屉的时候做一下防误触，也就是刚刚往边缘
//     方向滑动的一段具体改成抽屉不会动，这段时间识别一下是竖向滑动还是关闭抽屉。」
//
// 这份实现守着四条：
//   ① **热区大**：屏幕两侧各 28px 的一条竖带都能起手（不只是按钮那 40px 方块）；
//   ② **方向先判**：起手前 18px 只用来判"横滑还是竖滚"，判不出就什么都不做
//      —— 宁可晚 60ms 响应，也不能把用户的竖向滚动吃掉；
//   ③ **可打断**：抽屉位移交给 CSS 变量 + transition，中途反向拖动会从**当前值**接着走，
//      而不是跳回起点重播（这是我们最常犯的错）；
//   ④ **打开时按钮消失**（关闭方向的手势已经存在了，不需要再留入口）。
// ============================================================================
import { useCallback, useEffect, useRef } from 'react';

const EDGE_HOT = 28;      // 边缘热区宽度
const DIR_LOCK = 18;      // 判方向所需的最小位移
const OPEN_TRIGGER = 64;  // 从边缘滑多远算"打开"
const CLOSE_TRIGGER = 72; // 往边缘滑多远算"关闭"

export type DrawerSide = 'left' | 'right' | null;

export function useEdgeSwipe(opts: {
  enabled: boolean;
  drawer: DrawerSide;
  setDrawer: (d: DrawerSide) => void;
  /** 抽屉本身宽度（用于跟手位移的比例，取视口的 86%） */
  paneWidth?: () => number;
}) {
  const { enabled, drawer, setDrawer } = opts;
  const state = useRef<{
    active: boolean;
    mode: 'idle' | 'undecided' | 'open-swipe' | 'close-swipe';
    side: 'left' | 'right';
    startX: number;
    startY: number;
    locked: boolean;
  } | null>(null);

  /** 把跟手位移写进 CSS 变量；null = 交还给 CSS 的 open/close 状态 */
  const setFollow = useCallback((dx: number | null) => {
    const el = document.documentElement;
    if (dx === null) {
      el.style.removeProperty('--bc-drawer-follow');
      document.body.classList.remove('bc-drawer-track');
    } else {
      el.style.setProperty('--bc-drawer-follow', `${Math.round(dx)}px`);
      // 跟手期间必须关掉 transition，否则手指和面板差一截（180ms 的滞后）
      document.body.classList.add('bc-drawer-track');
    }
  }, []);

  useEffect(() => {
    if (!enabled) { setFollow(null); return; }
    const paneW = () => (opts.paneWidth ? opts.paneWidth() : window.innerWidth * 0.86);

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;      // 鼠标走点击，不做手势
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      // 抽屉内部起手 = 可能是"往边缘滑关闭"；边缘带起手 = "往内滑打开"
      const inPane = !!target?.closest?.('.elem-pane-wrap, .right-pane-wrap');
      const nearLeft = e.clientX <= EDGE_HOT;
      const nearRight = e.clientX >= window.innerWidth - EDGE_HOT;

      if (drawer && inPane) {
        state.current = { active: true, mode: 'undecided', side: drawer, startX: e.clientX, startY: e.clientY, locked: false };
      } else if (!drawer && (nearLeft || nearRight)) {
        state.current = { active: true, mode: 'undecided', side: nearLeft ? 'left' : 'right', startX: e.clientX, startY: e.clientY, locked: false };
      } else {
        state.current = null;
      }
    };

    const onMove = (e: PointerEvent) => {
      const s = state.current;
      if (!s?.active) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;

      // —— ① 判方向（只看前 18px）——
      if (!s.locked) {
        if (Math.abs(dx) < DIR_LOCK && Math.abs(dy) < DIR_LOCK) return;
        if (Math.abs(dy) >= Math.abs(dx)) { state.current = null; return; }  // 竖滑 → 交还给滚动
        s.locked = true;
        s.mode = drawer ? 'close-swipe' : 'open-swipe';
      }

      // —— ② 跟手（符号按"抽屉在哪一侧"定：左抽屉收进去是负、右抽屉是正）——
      if (s.mode === 'open-swipe') {
        const inward = s.side === 'left' ? dx : -dx;
        if (inward <= 0) { setFollow(0); return; }
        const w = paneW();
        setFollow(s.side === 'left'
          ? -w + Math.min(w, inward)          // -paneW → 0
          : w - Math.min(w, inward));         // +paneW → 0
      } else if (s.mode === 'close-swipe') {
        const outward = s.side === 'left' ? -dx : dx;
        if (outward <= 0) { setFollow(0); return; }
        const w = paneW();
        setFollow(s.side === 'left' ? -Math.min(w, outward) : Math.min(w, outward));
      }
    };

    const onUp = (e: PointerEvent) => {
      const s = state.current;
      state.current = null;
      setFollow(null);
      if (!s?.active || !s.locked) return;
      const dx = e.clientX - s.startX;
      if (s.mode === 'open-swipe') {
        const inward = s.side === 'left' ? dx : -dx;
        if (inward >= OPEN_TRIGGER) setDrawer(s.side);
      } else if (s.mode === 'close-swipe') {
        const outward = s.side === 'left' ? -dx : dx;
        if (outward >= CLOSE_TRIGGER) setDrawer(null);
      }
    };

    // capture 阶段注册：画布自己的 pointerdown 会 stopPropagation（框选/Alt 手势），
    // 冒泡阶段的 window 监听根本收不到 —— 第一版就是这样，实测"怎么滑都不开"。
    const CAP = { passive: true, capture: true } as const;
    window.addEventListener('pointerdown', onDown, CAP);
    window.addEventListener('pointermove', onMove, CAP);
    window.addEventListener('pointerup', onUp, CAP);
    window.addEventListener('pointercancel', onUp, CAP);
    return () => {
      window.removeEventListener('pointerdown', onDown, CAP as never);
      window.removeEventListener('pointermove', onMove, CAP as never);
      window.removeEventListener('pointerup', onUp, CAP as never);
      window.removeEventListener('pointercancel', onUp, CAP as never);
      setFollow(null);
    };
  }, [enabled, drawer, setDrawer, setFollow, opts]);
}
