// ============================================================================
// BlockCanvas · 画布视图复位（v0.4.6 第 43 批）
// ----------------------------------------------------------------------------
// 用户原话：「还原大小的时候同时回正画布，现在画布不会全部在屏幕区域，
//   有些在屏幕外面。」
//
// "还原大小"只把 zoom 拉回 100% 是不够的：
//   · 用户在放大状态下把画布滚到了页面中间 → 缩回 100% 后，
//     画布的**顶部已经在视口上方**，屏幕上只剩页面中段，看着像"画布跑掉了"；
//   · 双指缩放可能留下一小段位移补偿（--bc-canvas-dx/-dy），
//     不清掉的话画布会偏在一侧，有一部分在屏幕外。
//
// 所以"还原"是三件事一起做：清位移补偿 + 滚动回顶部左上 + 缩放回 100%。
// ============================================================================

/**
 * 把画布恢复到"标准视图"：100% 缩放 + 画布左上角对齐视口左上角。
 *
 * @param setZoom React 的 zoom setter（App 里就是 setZoom）
 */
export function resetCanvasView(setZoom: (z: number) => void): void {
  settleCanvasResidual();

  // ② 滚动回原点：画布左上角重新贴住视口左上角（"回正"）
  const w = document.querySelector('.canvas-wrap') as HTMLElement | null;
  if (w) {
    w.scrollLeft = 0;
    w.scrollTop = 0;
  }

  // ③ 缩放回 100%
  setZoom(1);
}

/**
 * 把双指手势留下的位移补偿"结算"掉，然后清空三个临时变量。
 *
 * 不能直接 removeProperty：那一份位移正是画面当前所在位置的组成部分，
 * 抹掉它画面会**平移**一下（看起来就是"跳了"）。正确做法是把它折进滚动量
 * （画面位置 = 内容坐标 - 滚动量，所以 scroll 要减），视觉上零变化。
 */
export function settleCanvasResidual(): void {
  const el = document.querySelector('.canvas') as HTMLElement | null;
  const w = document.querySelector('.canvas-wrap') as HTMLElement | null;
  if (!el || !w) return;
  const dx = parseFloat(el.style.getPropertyValue('--bc-canvas-dx') || '0');
  const dy = parseFloat(el.style.getPropertyValue('--bc-canvas-dy') || '0');
  if (dx || dy) {
    w.scrollLeft -= dx;
    w.scrollTop -= dy;
  }
  el.style.removeProperty('--bc-canvas-dx');
  el.style.removeProperty('--bc-canvas-dy');
  el.style.removeProperty('--bc-canvas-k');
}

/**
 * 缩放档位（百分比）。用固定阶梯而不是 ×1.25：
 * 触摸屏上连点几下就要能回到整数档（100 / 200），"精准缩放"也依赖可预期的落点。
 * 阶梯两端与双指手势的范围一致（10% ~ 400%），不会出现"按钮缩得比手势更小"。
 */
const ZOOM_STEPS = [10, 25, 50, 75, 100, 125, 150, 200, 300, 400];

/** 上一档 / 下一档（已经到顶或到底时返回当前值，按钮据此置灰） */
export function zoomStepOf(zoom: number, dir: 1 | -1): number {
  const pct = zoom * 100;
  if (dir > 0) {
    const next = ZOOM_STEPS.find((v) => v > pct + 0.5);
    return (next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]) / 100;
  }
  const lower = [...ZOOM_STEPS].reverse().find((v) => v < pct - 0.5);
  return (lower ?? ZOOM_STEPS[0]) / 100;
}

/**
 * 「放大 / 缩小」按钮：先把手势残留位移结算掉，再改 zoom。
 * 不结算的话，CSS 里的 `scale(var(--bc-canvas-k, zoom))` 会被旧的 -k 顶着，
 * 表现为"点了按钮没反应 / 反应一次之后再也不动"。
 */
export function stepCanvasZoom(zoom: number, dir: 1 | -1, setZoom: (z: number) => void): void {
  settleCanvasResidual();
  setZoom(zoomStepOf(zoom, dir));
}
