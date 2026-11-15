// ============================================================================
// BlockCanvas · 元素「进场动画」的标记（v0.4.6）
// ----------------------------------------------------------------------------
// 用户反馈：「添加元素的加入动画和退出动画都没了」。
//
// 做法：拿**上一帧的节点 id 集合**和这一帧比，多出来的就是"刚插进来的"，
// 给它们挂一个 `data-bc-new="1"`（400ms 后自己摘掉），动画由 CSS 播
// （见 styles/35-v046-cards.css 的 @keyframes bcNodeIn）。
//
// 三个刻意的选择：
//   ① 首帧不做 —— 打开工程时整页元素都算"新增"，那不叫入场动画，叫闪屏；
//   ② 用数据标记 + 动画，而不是给节点常驻 transition ——
//      后者会盖掉用户自己在画布上写的 transition（伪类预览就废了）；
//   ③ 只标记、不延迟任何渲染 —— 动画归动画，插入本身仍然是一次同步 state 更新。
// ============================================================================
import { useEffect, useRef } from 'react';
import type { SceneElement } from '@lib/types';

/** 标记存活时长；比动画（200ms）长一点，避免重复插入时标记被提前摘掉 */
const MARK_MS = 400;

export function useEnterAnim(root: SceneElement, canvasRef: React.RefObject<HTMLDivElement | null>): void {
  const prev = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set<string>();
    const walk = (n: SceneElement) => {
      for (const c of n.children) { ids.add(c.id); walk(c); }
    };
    walk(root);
    const before = prev.current;
    prev.current = ids;
    if (!before) return; // 首帧：打开工程时不该整页闪一下
    const added = [...ids].filter((id) => !before.has(id));
    if (added.length === 0) return;
    const raf = requestAnimationFrame(() => {
      for (const id of added) {
        const el = canvasRef.current?.querySelector(`[data-bc-id="${CSS.escape(id)}"]`) as HTMLElement | null;
        if (!el) continue;
        /**
         * 用 **Web Animations API**，不用 CSS class / 内联 style：
         *   · React 会重写画布节点的 `style` 和 `className`（baseStyle、classAttr 都归它管），
         *     写进去的 `animation` / class 在下一帧就被抹掉 —— 实测 computed animationName 恒为 none；
         *   · WAAPI 的动画挂在元素上，不受属性重写影响，除非显式 cancel。
         * 同时保留 `data-bc-new` 标记给样式表和探针看（双保险）。
         */
        el.setAttribute('data-bc-new', '1');
        try {
          const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          el.animate(
            [
              { opacity: 0, translate: '0 8px', scale: '0.985' },
              { opacity: 1, translate: '0 0', scale: '1' }
            ],
            { duration: reduced ? 1 : 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
          );
        } catch { /* 老内核没有 WAAPI 时只留标记 */ }
        window.setTimeout(() => el.removeAttribute('data-bc-new'), MARK_MS);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [root, canvasRef]);
}
