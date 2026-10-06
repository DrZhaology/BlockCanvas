import { useEffect } from 'react';

// BlockCanvas · 横向滚动区「直接滚轮」支持（v0.4.2）
//
// 约定：任何需要横向滚动、且希望「不必按 Shift 就能用滚轮带动」的容器，
// 加 class="bc-hscroll" 即可（工具栏主区 / 工具组 / 标签条 / 工具栏管理预览…）。
//
//   · 竖向滚轮 → 直接转为横向滚动（无需 Shift）
//   · 按住 Shift → 依旧生效（浏览器原生把滚轮映射成 deltaX，此处一并兜底）
//   · 只接管「确实能横向滚动」的容器；到边缘后不再拦住页面滚动，手感不突兀
//   · 必须用原生 addEventListener + passive:false：React 的 onWheel 是被动监听，
//     里面 preventDefault() 无效（详见 lib/wheelAdjust.ts 的同一坑）
export const HSCROLL_CLASS = 'bc-hscroll';

export function useHorizontalWheel() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const box = target.closest('.' + HSCROLL_CLASS) as HTMLElement | null;
      if (!box) return;
      const max = box.scrollWidth - box.clientWidth;
      if (max <= 1) return; // 不可横向滚动：完全不干预

      // 竖向滚轮为主；触控板横向手势（deltaX）也支持
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (!delta) return;

      const before = box.scrollLeft;
      const next = Math.max(0, Math.min(max, before + delta));
      if (next === before) return; // 已到边缘：放行，让页面自己滚

      e.preventDefault();
      box.scrollLeft = next;
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
}
