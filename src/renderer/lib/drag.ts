// BlockCanvas · 拖拽灵敏度（统一）
// 所有“按住拖拽微调数值”的交互（画布缩放、画布宽度、属性数值 ↑↓）共用同一个换算，
// 保证“鼠标移动的多、数值变化的少”，便于细微调整。
// 当前：每拖拽 2px 变化 1 个整数步（1% / 1px / 1 单位）。
export const DRAG_FACTOR = 0.5;

/** 把鼠标横向位移 dx（px）换算成“步数”，保留整数（用于 zoom% / px 宽度 / 数值） */
export function dragSteps(dx: number): number {
  return Math.round(dx * DRAG_FACTOR);
}