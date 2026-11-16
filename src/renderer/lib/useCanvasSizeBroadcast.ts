// ============================================================================
// BlockCanvas · v0.4.7 · 广播画布真实宽度（给 App 推导断点用）
// ----------------------------------------------------------------------------
// 为什么单独一个 hook：Canvas.tsx 受 400 行预算约束，这段有 20 行。
//
// 为什么要 ÷ zoom：缩放是 CSS transform，`getBoundingClientRect()` 量到的是**放大后**
// 的宽度；断点判据要的是布局宽度（= 导出/预览用的那个宽度）。
//
// 为什么不用 window.resize：画布还会被两侧面板挤、被缩放、被"自适应"档位跟着窗口走 ——
// ResizeObserver 一条覆盖全部（用户要求"像网页一样实时监测"）。
// ============================================================================
import { useEffect } from 'react';

export function useCanvasSizeBroadcast(
  ref: React.RefObject<HTMLElement | null>,
  zoom: number
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const push = () => {
      const w = el.getBoundingClientRect().width / (zoom || 1);
      if (w > 0) window.dispatchEvent(new CustomEvent('bc:canvas-size', { detail: { w } }));
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, zoom]);
}
