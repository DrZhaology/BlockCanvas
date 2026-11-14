// ============================================================================
// BlockCanvas · 窄屏抽屉把手：长按后可以上下挪（v0.4.6）
// ----------------------------------------------------------------------------
// 用户原话：
//   「长按抽屉，可以单独为左右两个抽屉按钮调整上下的位置。但是肯定还有强迫症用户，
//     两边的抽屉做一下对齐吸附，但是不要把单个抽屉上下移动的能力做没了。」
//
// 交互：
//   · 短按 = 开/关抽屉（原行为，不变）；
//   · 长按 420ms 后进入"调位置"模式：手指上下滑，把手跟着走，屏幕边缘出一条细参考线；
//   · 松手存进 localStorage（这台机器的习惯，不跟着工程走）；
//   · 靠近另一侧把手 ±2.5% 时**吸附对齐**（治强迫症），但仍然可以停在别处；
//   · 双击 = 复位到默认高度。
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';

export type HandleSide = 'left' | 'right';
const KEY = 'bc-drawer-handle-y';
const HOLD_MS = 420;

interface Pos { left: number; right: number }
const DEFAULT_Y: Pos = { left: 50, right: 50 };

function read(): Pos {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Pos>;
      const ok = (v: unknown) => typeof v === 'number' && v >= 4 && v <= 96;
      return { left: ok(p.left) ? p.left! : 50, right: ok(p.right) ? p.right! : 50 };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_Y };
}

function write(p: Pos): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** 读出两侧把手的纵向位置（百分比 0~100） */
export function useHandlePos(): [Pos, (side: HandleSide, y: number) => void] {
  const [pos, setPos] = useState<Pos>(read);
  const set = useCallback((side: HandleSide, y: number) => {
    setPos((cur) => {
      const next = { ...cur, [side]: Math.round(Math.max(4, Math.min(96, y)) * 10) / 10 };
      // 吸附：靠近另一边 ±2.5% 就对齐（"两边对齐吸附，但不要吃掉单独移动的能力"）
      const other = side === 'left' ? next.right : next.left;
      if (Math.abs(next[side] - other) <= 2.5) next[side] = other;
      write(next);
      return next;
    });
  }, []);
  return [pos, set];
}

/** 长按后拖动的高度状态机（挂到把手上即可） */
export function useLongPressDrag(side: HandleSide, applyY: (y: number) => void) {
  const st = useRef<{ timer: number; startY: number; dragging: boolean; moved: boolean }>({
    timer: 0, startY: 0, dragging: false, moved: false
  });
  const [dragging, setDragging] = useState(false);
  const [guide, setGuide] = useState<number | null>(null);

  useEffect(() => () => window.clearTimeout(st.current.timer), []);

  const onPointerDown = (e: React.PointerEvent) => {
    st.current.startY = e.clientY;
    st.current.moved = false;
    st.current.dragging = false;
    window.clearTimeout(st.current.timer);
    st.current.timer = window.setTimeout(() => {
      st.current.dragging = true;
      setDragging(true);
      setGuide(e.clientY);
    }, HOLD_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (Math.abs(e.clientY - st.current.startY) > 6) {
      if (!st.current.dragging) window.clearTimeout(st.current.timer); // 一上来就滑 → 不是长按
      st.current.moved = true;
    }
    if (!st.current.dragging) return;
    const y = (e.clientY / window.innerHeight) * 100;
    setGuide(e.clientY);
    applyY(y);
  };

  const onPointerUp = () => {
    window.clearTimeout(st.current.timer);
    const wasDragging = st.current.dragging;
    st.current.dragging = false;
    setDragging(false);
    setGuide(null);
    return wasDragging; // true = 这次是"调位置"，调用方应该吞掉 click
  };

  return { dragging, guide, onPointerDown, onPointerMove, onPointerUp, side };
}
