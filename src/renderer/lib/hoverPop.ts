import { useEffect, useRef, useState } from 'react';

// ============================================================================
// BlockCanvas · 悬停弹层统一节奏（v0.4.4）
// ----------------------------------------------------------------------------
// 全程序所有「鼠标浮上去自动弹开」的浮层必须共用这一套时长与开合逻辑，
// 保证交互手感一致（用户要求：菜单栏 / 小问号 / 元素面板 / 工具组 / 任务按钮
// 全部统一为「悬停 0.5 秒弹出」）：
//   · 悬停 HOVER_OPEN_MS 后弹出；
//   · 移开后留 HOVER_CLOSE_MS 缓冲，允许光标从触发器滑进浮层里（不闪退）。
// 进场 / 退场动画不在这里写 —— 一律走 animations.css 的 bcPopIn / bcPopOut
// （时长 token --dur-pop / --dur-pop-exit），组件只引用类名。
// ============================================================================

/** 悬停多久后弹出（统一 0.5 秒） */
export const HOVER_OPEN_MS = 500;
/** 移开多久后收起（留出光标滑进浮层的时间） */
export const HOVER_CLOSE_MS = 300;

export interface HoverPop {
  open: boolean;
  setOpen: (v: boolean) => void;
  /** 鼠标进入触发器时调用（防抖后再弹） */
  scheduleOpen: () => void;
  /** 鼠标离开触发器 / 浮层时调用（延迟收起） */
  scheduleClose: () => void;
  /** 立即取消所有待执行的开合（例如光标滑进了浮层） */
  cancel: () => void;
  /** 点击切换（点击是即时开关，不等防抖） */
  toggle: () => void;
}

/**
 * 统一的悬停弹层状态机。用法：
 *   const pop = useHoverPop();
 *   <button onMouseEnter={pop.scheduleOpen} onMouseLeave={pop.scheduleClose} onClick={pop.toggle} />
 *   <div onMouseEnter={pop.cancel} onMouseLeave={pop.scheduleClose} />
 */
export function useHoverPop(initial = false): HoverPop {
  const [open, setOpen] = useState(initial);
  const openTimer = useRef(0);
  const closeTimer = useRef(0);

  const cancel = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  const scheduleOpen = () => {
    cancel();
    openTimer.current = window.setTimeout(() => setOpen(true), HOVER_OPEN_MS);
  };
  const scheduleClose = () => {
    cancel();
    closeTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };
  const toggle = () => {
    cancel();
    setOpen((o) => !o);
  };

  useEffect(() => cancel, []);

  return { open, setOpen, scheduleOpen, scheduleClose, cancel, toggle };
}
