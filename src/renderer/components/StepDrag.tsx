import { useRef } from 'react';
import { dragSteps } from '@lib/drag';

// BlockCanvas · ↑↓ 微调小按钮（数值输入用）
// 交互：
//  - 按住左键 → 左右拖动微调数值（灵敏度与画布缩放一致，由 dragSteps 换算）；
//  - 松手前几乎没动 → 视为单击，触发 onStep(1)（+1）。
// 与“按钮”的点击不混淆：有实际位移才走 onAdjust，纯点击走 onStep。
// 父组件负责在 onDragStart 记录基准值、onAdjust 实时更新、onDragEnd 提交。

const MOVE_THRESH = 2; // 超过 2px 才视为“拖动”（否则是点击）

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
  const st = useRef<{ px: number; moved: boolean } | null>(null);
  const { onDragStart, onAdjust, onDragEnd, onStep, disabled } = props;

  return (
    <span
      className={'step-drag' + (props.className ? ' ' + props.className : '') + (disabled ? ' disabled' : '')}
      title={props.title}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        st.current = { px: e.clientX, moved: false };
        onDragStart();
      }}
      onPointerMove={(e) => {
        const s = st.current;
        if (!s) return;
        const dx = e.clientX - s.px;
        if (!s.moved) {
          if (Math.abs(dx) < MOVE_THRESH) return;
          s.moved = true;
        }
        onAdjust(dx);
      }}
      onPointerUp={() => {
        const s = st.current;
        if (!s) return;
        st.current = null;
        if (s.moved) onDragEnd();
        else onStep(1);
      }}
      onPointerCancel={() => {
        const s = st.current;
        if (s) onDragEnd();
        st.current = null;
      }}
    >↑↓</span>
  );
}

// 把步进起点换算成可用于上方数值拖拽的辅助：简单包一层 dragSteps，
// 保持“灵敏度与画布一致”的约定统一集中在 lib/drag。
export const stepAdjust = dragSteps;