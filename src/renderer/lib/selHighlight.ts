// ============================================================================
// BlockCanvas · 选中高亮样式（v0.4.4）
// ----------------------------------------------------------------------------
// 画布里"选中元素"的外框有两种可切换样式（设置 → 编辑器与画布）：
//   · glow（默认）：橙色边框 + 光晕 + 呼吸闪烁 —— 画布里最醒目的东西；
//   · plain：原来的蓝色单一边框，无动效。
// 实现是纯 CSS：body 上挂 bc-sel-plain 类即切到 plain（见 25-v044-storage-ui.css）。
// 这里只负责"读 / 写 / 应用"这一约定，App 启动时调一次 applySelHighlightClass()。
// 存 localStorage（跟 bc-outlines 等外观开关同一套路）。
// ============================================================================

const KEY = 'bc-sel-highlight'; // 'glow' | 'plain'

export type SelHighlightStyle = 'glow' | 'plain';

export function readSelHighlight(): SelHighlightStyle {
  try {
    return localStorage.getItem(KEY) === 'plain' ? 'plain' : 'glow';
  } catch {
    return 'glow';
  }
}

export function writeSelHighlight(v: SelHighlightStyle): void {
  try { localStorage.setItem(KEY, v); } catch { /* 忽略隐私模式 */ }
  document.body.classList.toggle('bc-sel-plain', v === 'plain');
}

/** App 启动时调用一次：把持久化的样式应用到 body */
export function applySelHighlightClass(): void {
  document.body.classList.toggle('bc-sel-plain', readSelHighlight() === 'plain');
}
