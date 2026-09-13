import type { Breakpoint } from './types';

// BlockCanvas · 设备 / 断点统一模型
//
// 背景：过去「画布宽度」与「三断点（电脑/平板/手机）」是两套互不相干的状态——
// 在属性面板把断点切到「手机」，画布宽度却纹丝不动，用户完全看不出效果。
//
// 现在合并为**单一设备状态**：设备 = 画布宽度 = 编辑中的断点，三者永远同步。
//   💻 电脑 → 自适应窗口（桌面为基准，不生成 @media）
//   📱 平板 → 768px（对应 @media max-width: 768px）
//   📱 手机 → 375px（对应 @media max-width: 480px）
//   自定义宽度 → 按像素落回最近断点

export type DeviceId = 'desktop' | 'tablet' | 'mobile';

export const DEVICE_LIST: Array<{ id: DeviceId; label: string; icon: string; width: string; hint: string }> = [
  { id: 'desktop', label: '电脑', icon: '💻', width: 'auto', hint: '电脑端基准样式（自适应窗口宽度）' },
  { id: 'tablet', label: '平板', icon: '📱', width: '768px', hint: '平板端 ≤768px 样式定制' },
  { id: 'mobile', label: '手机', icon: '📲', width: '375px', hint: '手机端 ≤480px 样式定制' }
];

/** 画布宽度 → 断点（≤480 手机，≤768 平板，其余电脑；自适应视作电脑） */
export function widthToBreakpoint(w: string): Breakpoint {
  if (!w || w === 'auto') return 'desktop';
  const px = parseInt(w, 10);
  if (Number.isNaN(px)) return 'desktop';
  if (px <= 480) return 'mobile';
  if (px <= 768) return 'tablet';
  return 'desktop';
}

/** 断点 → 标准画布宽度 */
export function breakpointToWidth(bp: Breakpoint): string {
  if (bp === 'mobile') return '375px';
  if (bp === 'tablet') return '768px';
  return 'auto';
}

/** 画布宽度 → 当前设备 id */
export function widthToDevice(w: string): DeviceId {
  const bp = widthToBreakpoint(w);
  return bp === 'mobile' ? 'mobile' : bp === 'tablet' ? 'tablet' : 'desktop';
}

/** 广播切换设备（画布顶部设备条 / 属性面板断点栏 / 工具栏 共用同一入口） */
export function requestDevice(d: DeviceId): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('bc:set-device', { detail: d }));
}

/** 画布宽度的中文展示 */
export function widthLabel(w: string): string {
  if (!w || w === 'auto') return '自适应';
  const px = parseInt(w, 10);
  return Number.isNaN(px) ? w : px + 'px';
}
