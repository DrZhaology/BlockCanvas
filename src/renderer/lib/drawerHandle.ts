// ============================================================================
// BlockCanvas · 窄屏抽屉把手：长按后可以上下挪（v0.4.6 起，v0.4.7 修）
// ----------------------------------------------------------------------------
// 用户原话：
//   「长按抽屉，可以单独为左右两个抽屉按钮调整上下的位置。但是肯定还有强迫症用户，
//     两边的抽屉做一下对齐吸附，但是不要把单个抽屉上下移动的能力做没了。」
//
// 交互：
//   · 短按 = 开/关抽屉（原行为，不变）；
//   · 长按 420ms 后进入"调位置"模式：手指上下滑，把手跟着走，屏幕边缘出一条细参考线；
//   · 松手存进 localStorage（这台机器的习惯，不跟着工程走）；
//   · 两个抽屉在**不同**的物理边上时，靠近对面 ±2.5% 会**吸附对齐**（治强迫症）；
//   · 两个抽屉挤在**同一条**物理边上时不能对齐（对齐就叠成一个、点不到），
//     改为默认 38% / 62% 错开 + 强制留 5% 间距，用户拖过就用自己的值；
//   · 双击 = 复位到默认高度。
//
// v0.4.7 修的两处：
//   ① 位置改成**模块级 store**（useSyncExternalStore）：以前两个把手各持一份 useState，
//      拖左边之后右边的组件还以为左边是 50%，再拖右边就会把左边的值写回 50%；
//   ② 同一物理边时必须错开（both-left / both-right），否则两个把手重合只能点到上面那个。
// ============================================================================
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type HandleSide = 'left' | 'right';

const KEY = 'bc-drawer-handle-y';
const HOLD_MS = 420;
const MIN_Y = 4;
const MAX_Y = 96;
const SAME_EDGE_MIN_GAP = 5; // 同边时两个把手至少要差 5%（约 45px），否则点不到下面那个
const SNAP_RANGE = 2.5;      // 吸附范围（对面把手 ±2.5%）
/** 同一条物理边上两个把手的默认错开位置 */
const SAME_EDGE_DEF = { left: 38, right: 62 } as const;

interface Pos { left: number; right: number }
const DEFAULT_Y: Pos = { left: 50, right: 50 };

function read(): Pos {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Pos>;
      const ok = (v: unknown) => typeof v === 'number' && v >= MIN_Y && v <= MAX_Y;
      return { left: ok(p.left) ? p.left! : 50, right: ok(p.right) ? p.right! : 50 };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_Y };
}

function write(p: Pos): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/* ── 模块级 store（两个把手共享同一份，谁改都立刻同步）──────────────────── */
let cache: Pos | null = null;
const subs = new Set<() => void>();

function snapshot(): Pos {
  if (!cache) cache = read();
  return cache;
}

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

function commit(next: Pos): void {
  cache = next;
  write(next);
  subs.forEach((f) => f());
}

const clampY = (v: number) => Math.round(Math.max(MIN_Y, Math.min(MAX_Y, v)) * 10) / 10;

/**
 * 把"存下来的值"翻译成"屏幕上真正的高度"。
 * 同一条物理边上两个把手必须错开：默认 38% / 62%，用户拖过就用自己的值，
 * 但两者至少留 5% 间距（否则重合，下面那个永远点不到）。
 */
export function effectiveY(pos: Pos, side: HandleSide, sameEdge: boolean): number {
  const raw = pos[side];
  if (!sameEdge) return raw;
  const otherRaw = pos[side === 'left' ? 'right' : 'left'];
  // 存的是 50 = "没调过" → 用错开的默认位（元素面板 38%、属性面板 62%）
  const y = raw === 50 ? (side === 'left' ? SAME_EDGE_DEF.left : SAME_EDGE_DEF.right) : raw;
  const other = otherRaw === 50
    ? (side === 'left' ? SAME_EDGE_DEF.right : SAME_EDGE_DEF.left)
    : otherRaw;
  if (Math.abs(y - other) < SAME_EDGE_MIN_GAP) {
    return clampY(other + (y >= other ? SAME_EDGE_MIN_GAP : -SAME_EDGE_MIN_GAP));
  }
  return clampY(y);
}

/** 读出两侧把手的纵向位置（百分比 4~96） */
export function useHandlePos(sameEdge = false): [Pos, (side: HandleSide, y: number) => void] {
  const pos = useSyncExternalStore(subscribe, snapshot, snapshot);
  const set = useCallback((side: HandleSide, y: number) => {
    const cur = snapshot();
    const next: Pos = { ...cur, [side]: clampY(y) };
    if (sameEdge) {
      // 同边：不吸附（对齐就叠一起了），但强制留出间距，保证两个都点得到
      const other = effectiveY(cur, side === 'left' ? 'right' : 'left', true);
      if (Math.abs(next[side] - other) < SAME_EDGE_MIN_GAP) {
        next[side] = clampY(other + (next[side] >= other ? SAME_EDGE_MIN_GAP : -SAME_EDGE_MIN_GAP));
      }
    } else {
      // 两边：靠近对面 ±2.5% 就对齐（"两边对齐吸附，但不要吃掉单独移动的能力"）
      const other = cur[side === 'left' ? 'right' : 'left'];
      if (Math.abs(next[side] - other) <= SNAP_RANGE) next[side] = other;
    }
    commit(next);
  }, [sameEdge]);
  return [pos, set];
}

/** 长按后拖动的高度状态机（挂到把手上即可） */
export function useLongPressDrag(side: HandleSide, applyY: (y: number) => void) {
  const st = useRef<{
    timer: number; startY: number; dragging: boolean; moved: boolean;
    /** 这一趟 pointerdown 到底是不是"调位置"，给调用方吞 click 用 */
    lastWasDrag: boolean;
    /** 当前这一趟挂到 window 上的清理函数 */
    detach: (() => void) | null;
  }>({ timer: 0, startY: 0, dragging: false, moved: false, lastWasDrag: false, detach: null });
  const [dragging, setDragging] = useState(false);
  const [guide, setGuide] = useState<number | null>(null);

  useEffect(() => () => {
    window.clearTimeout(st.current.timer);
    st.current.detach?.();
  }, []);

  /**
   * v0.4.6 竖屏重做时修的两个真 BUG（都是触摸场景高发）：
   *
   * ① **松手收不到 pointerup**：以前 pointermove / pointerup 只绑在把手上，
   *    手指往上拖 200px 早就离开那个 30×60 的小盒子了 → 松手时元素收不到 pointerup，
   *    `dragging` 永远停在 true，把手就卡在"拖动中"（表现：位置调完不保存、
   *    再点没反应、opacity 也不回落到静止态）。
   * ② 同理，拖出去之后 pointermove 也收不到，位移直接断掉。
   *
   * 所以改成：pointerdown 时把 move/up/cancel 挂到 **window（capture）** 上，
   * 松手（或 pointercancel，触摸被浏览器接管时就是它）必定能收到，一次到位。
   */
  const onPointerDown = (e: React.PointerEvent) => {
    st.current.startY = e.clientY;
    st.current.moved = false;
    st.current.dragging = false;
    st.current.lastWasDrag = false;
    window.clearTimeout(st.current.timer);
    st.current.detach?.();

    const pid = e.pointerId;
    const finish = () => {
      window.clearTimeout(st.current.timer);
      const was = st.current.dragging;
      st.current.dragging = false;
      st.current.lastWasDrag = was;
      setDragging(false);
      setGuide(null);
      st.current.detach?.();
      st.current.detach = null;
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (Math.abs(ev.clientY - st.current.startY) > 6) {
        if (!st.current.dragging) window.clearTimeout(st.current.timer); // 一上来就滑 → 不是长按
        st.current.moved = true;
      }
      if (!st.current.dragging) return;
      setGuide(ev.clientY);
      applyY((ev.clientY / window.innerHeight) * 100);
    };

    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    st.current.detach = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
    };

    st.current.timer = window.setTimeout(() => {
      st.current.dragging = true;
      setDragging(true);
      setGuide(st.current.startY);
    }, HOLD_MS);
  };

  /** 元素上的 move 不再做事（window 上那份是唯一入口，避免两处重复计算） */
  const onPointerMove = (_e: React.PointerEvent) => { /* 见 onPointerDown 里的 window 监听 */ };

  const onPointerUp = () => {
    window.clearTimeout(st.current.timer);
    const wasDragging = st.current.dragging || st.current.lastWasDrag;
    st.current.dragging = false;
    st.current.lastWasDrag = false;
    setDragging(false);
    setGuide(null);
    st.current.detach?.();
    st.current.detach = null;
    return wasDragging; // true = 这次是"调位置"，调用方应该吞掉 click
  };

  return { dragging, guide, onPointerDown, onPointerMove, onPointerUp, side };
}
