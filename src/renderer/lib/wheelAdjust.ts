import { useEffect, useRef } from 'react';

// BlockCanvas · 输入框「滚轮调数值」统一交互
//
// 目标交互（v0.4.0 定稿，替代早先的「长按拖动」方案）：
//  1. 点一下输入框 → 正常聚焦、正常打字；
//  2. **聚焦状态下滚动滚轮** → 上滚增大 / 下滚减小；按住 Shift 步进 ×10；
//  3. 停止滚动约 260ms → 自动提交（一次聚焦会话 = 一条撤销记录）。
//
// 三个必须注意的实现细节：
//  · **必须用原生 addEventListener 且 passive:false**。React 的 onWheel 在 React 17+ 是
//    被动监听，里面 preventDefault() 无效，页面会跟着一起滚。
//  · **只有 document.activeElement === 输入框 才响应**。否则在面板上随便滚一下就会
//    误改数值（这是最容易挨骂的一类 bug）。
//  · **滚一段才算一格**（WHEEL_UNIT）。v0.4.4 定稿：**滚一下 = ±1，按住 Shift = ±10**。
//    鼠标滚轮一格 deltaY 常是 100~120，阈值取 80：一格恰好计 1 步，快速滚两格计 2 步；
//    触控板是连续小数值，累计到 80 才算一格 —— 两者手感一致，不会一下跳 2~3。

const WHEEL_UNIT = 80;    // 累计多少 deltaY 算一格
const IDLE_MS = 260;      // 静止多久算「滚完了」→ 提交并结束本次连续调节

export interface WheelAdjustOptions {
  /** 取当前基准值（连续调节过程中以内部累积值为准，只在开始时取一次） */
  getBase: () => number;
  /** 滚动中实时预览（走 updateStyleTransient，不入历史） */
  onPreview: (value: number) => void;
  /** 一次连续调节结束（走 updateStyle，会话内不重复入栈） */
  onCommit: (value: number) => void;
  /** 本次连续调节开始时触发一次（通常在这里 beginStyleEdit） */
  onStart?: () => void;
  /** 整体禁用（如值为 auto / 自定义复杂值） */
  disabled?: boolean;
  /** 每格步长，默认 1 */
  step?: number;
  /** 下限 / 上限 */
  min?: number;
  max?: number;
  /** 保留小数位数，默认 0（整数） */
  precision?: number;
}

function roundTo(v: number, precision: number): number {
  if (precision <= 0) return Math.round(v);
  const f = Math.pow(10, precision);
  return Math.round(v * f) / f;
}

export function useWheelAdjust(opts: WheelAdjustOptions) {
  const o = useRef(opts);
  o.current = opts;

  const ref = useRef<HTMLInputElement | null>(null);
  const acc = useRef(0);          // 累计的 deltaY
  const cur = useRef(0);          // 连续调节中的当前值
  const active = useRef(false);   // 是否处于一次连续调节中
  const idleTimer = useRef(0);

  const finish = () => {
    window.clearTimeout(idleTimer.current);
    idleTimer.current = 0;
    acc.current = 0;
    if (active.current) {
      active.current = false;
      o.current.onCommit(cur.current);
    }
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (o.current.disabled) return;
      // 只在「这个输入框正处于聚焦状态」时才接管滚轮
      if (document.activeElement !== el) return;
      e.preventDefault();
      e.stopPropagation();

      const opt = o.current;
      if (!active.current) {
        active.current = true;
        cur.current = opt.getBase();
        opt.onStart?.();
      }

      acc.current += e.deltaY;
      const steps = Math.trunc(acc.current / WHEEL_UNIT);
      if (steps === 0) {
        // 还没凑够一格：只重置空闲计时，等用户继续滚
        window.clearTimeout(idleTimer.current);
        idleTimer.current = window.setTimeout(finish, IDLE_MS);
        return;
      }
      acc.current -= steps * WHEEL_UNIT;

      // 向下滚（deltaY > 0）= 减小，符合直觉
      const mult = e.shiftKey ? 10 : 1;
      const step = opt.step ?? 1;
      let next = cur.current + -steps * step * mult;
      if (typeof opt.min === 'number') next = Math.max(opt.min, next);
      if (typeof opt.max === 'number') next = Math.min(opt.max, next);
      next = roundTo(next, opt.precision ?? 0);
      cur.current = next;

      opt.onPreview(next);

      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(finish, IDLE_MS);
    };

    // passive:false 是 preventDefault 生效的前提
    el.addEventListener('wheel', onWheel as EventListener, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel as EventListener);
      window.clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    /** 挂到需要滚轮调值的 input 上 */
    ref,
    /** 失焦时调用：把未提交的连续调节收尾 */
    finish,
    /** 是否正在调节（可用于高亮） */
    isActive: () => active.current
  };
}
