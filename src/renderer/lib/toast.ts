// ============================================================================
// BlockCanvas · 全局轻提示（toast，v0.4.4）
// ----------------------------------------------------------------------------
// 需求："不要生硬的弹窗提示" —— 打开已打开过的项目这类小事，
// 只需要在角落里飘一条提示，几秒后自己消失，不打断操作。
//
// 用法：任意地方 `showToast('文本')` → App 挂载的 <AppToasts /> 会监听事件渲染。
// 样式见 26-empty-home.css 的 .bc-toast*。
// ============================================================================

export type ToastType = 'ok' | 'err' | 'info';

export function showToast(text: string, type: ToastType = 'ok'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('bc:toast', { detail: { text, type } }));
}
