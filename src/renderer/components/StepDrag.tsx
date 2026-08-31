import { useRef } from 'react';
import { dragSteps } from '@lib/drag';

// BlockCanvas · ↑↓ 微调小按钮（数值输入用）
// 交互：
//  - 按住左键 → 左右拖动微调数值（灵敏度与画布缩放一致，由 dragSteps 换算）；
//  - 松手前几乎没动 → 视为单击，触发 onStep(1)（+1）。
// 光标体验（Pointer Lock）：
//  - 按下即 requestPointerLock：拖拽期间系统光标隐藏、位置冻结；
//  - 松开 exitPointerLock：光标原样出现在「按下去的位置」，不会漂移到松手处。
//  - 不支持/锁定失败时退回 CSS 隐藏光标（bc-drag-hide-cursor），行为照旧。
// 父组件负责在 onDragStart 记录基准值、onAdjust 实时更新、onDragEnd 提交。

const MOVE_THRESH = 2; // 超过 2px 才视为“拖动”（否则是点击）

interface DragState {
  px: number; // 按下点（未锁定时用 clientX 差值算位移）
  moved: boolean;
  acc: number; // 指针锁定期间的 movementX 累计位移
}

export function StepDrag(props: {
  className?: string;
  title?: string;
  disabled?: boolean;
  onDragStart: () => void;
  /** dx = 相对按下点的横向位移（px），父组件换算成数值变化 */
  onAdjust: (dx: number) => void;
  onDragEnd: () => void;
  onStep: (dir: 1 | -1) => void;
}) {
  const st = useRef<DragState | null>(null);
  const fallbackHide = useRef(false);
  const { onDragStart, onAdjust, onDragEnd, onStep, disabled } = props;

  // 指针锁定：拖拽期间隐藏光标且冻结位置，松开后光标回到按下处
  const lockCursor = (el: HTMLElement) => {
    try {
      const anyEl = el as unknown as { requestPointerLock?: () => unknown };
      if (typeof anyEl.requestPointerLock !== 'function') {
        fallbackHide.current = true;
        document.body.classList.add('bc-drag-hide-cursor');
        return;
      }
      const r = anyEl.requestPointerLock();
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => {
          fallbackHide.current = true;
          document.body.classList.add('bc-drag-hide-cursor');
        });
      }
    } catch {
      fallbackHide.current = true;
      document.body.classList.add('bc-drag-hide-cursor');
    }
  };
  const unlockCursor = () => {
    try {
      if (document.pointerLockElement) document.exitPointerLock();
    } catch { /* ignore */ }
    if (fallbackHide.current) {
      fallbackHide.current = false;
      document.body.classList.remove('bc-drag-hide-cursor');
    }
  };

  return (
    <span
      className={'step-drag' + (props.className ? ' ' + props.className : '') + (disabled ? ' disabled' : '')}
      title={props.title}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        st.current = { px: e.clientX, moved: false, acc: 0 };
        lockCursor(e.currentTarget as HTMLElement);
        onDragStart();
      }}
      onPointerMove={(e) => {
        const s = st.current;
        if (!s) return;
        // 锁定期间 clientX 冻结不变，改用 movementX 累计位移；未锁定退回 clientX 差值
        let dx: number;
        if (document.pointerLockElement) {
          s.acc += e.movementX || 0;
          dx = Math.round(s.acc);
        } else {
          dx = e.clientX - s.px;
        }
        if (!s.moved) {
          if (Math.abs(dx) < MOVE_THRESH) return;
          s.moved = true;
        }
        onAdjust(dx);
      }}
      onPointerUp={() => {
        const s = st.current;
        unlockCursor();
        if (!s) return;
        st.current = null;
        if (s.moved) onDragEnd();
        else onStep(1);
      }}
      onPointerCancel={() => {
        unlockCursor();
        if (st.current) onDragEnd();
        st.current = null;
      }}
    >↑↓</span>
  );
}

// 把步进起点换算成可用于上方数值拖拽的辅助：简单包一层 dragSteps，
// 保持“灵敏度与画布一致”的约定统一集中在 lib/drag。
export const stepAdjust = dragSteps;
