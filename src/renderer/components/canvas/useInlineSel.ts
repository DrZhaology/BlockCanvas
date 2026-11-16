// 行内选中元素的「合并外框」测量（v0.4.6 从 Canvas.tsx 抽出）
//
// display:inline 的元素（span/a/strong…）跨行时，CSS outline 会围着**每个行盒**各画一个框，
// 看起来像"选中了多个"。这里改成量一个并集大框（getBoundingClientRect 天然返回并集）。
// 独立成文件是为了让 Canvas.tsx 守住「组装层 ≤400 行」的红线。
import { useEffect, useState } from 'react';

export interface InlineSelRect { key: string; x: number; y: number; w: number; h: number }

export function useInlineSel(
  selectedIds: string[],
  deps: { root: unknown; zoom: number; canvasWidth: string }
): InlineSelRect[] {
  const { root, zoom, canvasWidth } = deps;
  const [inlineSel, setInlineSel] = useState<InlineSelRect[]>([]);

  useEffect(() => {
    if (selectedIds.length === 0) { setInlineSel([]); return; }
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const out: InlineSelRect[] = [];
      for (const id of selectedIds) {
        const el = document.querySelector(`.canvas [data-bc-id="${CSS.escape(id)}"]`);
        if (!el) continue;
        try {
          if (getComputedStyle(el).display !== 'inline') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          out.push({ key: id, x: r.left, y: r.top, w: r.width, h: r.height });
        } catch { /* ignore */ }
      }
      setInlineSel(out);
    };
    measure();
    // 类名样式（display 可能来自自动类规则）落地后再量一次
    const raf = requestAnimationFrame(measure);
    const onScrollOrResize = () => measure();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [selectedIds, root, zoom, canvasWidth]);

  return inlineSel;
}
