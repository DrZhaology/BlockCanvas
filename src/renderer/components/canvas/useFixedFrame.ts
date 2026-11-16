// 画布内「浏览器视口」的 React 侧接线（v0.4.6）
//
// 从 Canvas.tsx 里抽出来的原因：那 40 行只是"量矩形 + 写 CSS 变量 + 缩放时隐藏"，
// 和组装层的职责无关；抽出来 Canvas 才能守住"组装层 ≤400 行"的红线。
// 具体几何/语义见 lib/fixedViewport.ts。
import { useEffect, useRef, useState } from 'react';
import { measureFixedViewport, applyFixedShift, hideFixedTemporarily, type FixedViewport } from '@lib/fixedViewport';

export function useFixedFrame(opts: {
  canvasRef: React.RefObject<HTMLDivElement>;
  /** 选中元素是不是 fixed（只有它是 fixed 时才画红框） */
  show: boolean;
  /** 这两个值一变就说明"画布尺寸变了"，此时 fixed 元素的位置是骗人的，先藏起来 */
  zoom: number;
  canvasWidth: string;
}): FixedViewport | null {
  const { canvasRef, show, zoom, canvasWidth } = opts;
  const [frame, setFrame] = useState<FixedViewport | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      applyFixedShift(el);
      if (!show) { setFrame((cur) => (cur ? null : cur)); return; }
      const vp = measureFixedViewport(el);
      setFrame((cur) => (
        cur && vp && cur.left === vp.left && cur.top === vp.top && cur.right === vp.right && cur.bottom === vp.bottom
          ? cur : vp
      ));
    };
    update();
    const onAny = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    window.addEventListener('scroll', onAny, true);
    window.addEventListener('resize', onAny);
    const wrap = el.closest('.canvas-wrap') as HTMLElement | null;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onAny) : null;
    if (ro && wrap) ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onAny, true);
      window.removeEventListener('resize', onAny);
      ro?.disconnect();
    };
  }, [canvasRef, show, zoom, canvasWidth]);

  // 缩放 / 改画布宽度时，fixed 元素暂时隐藏（用户："显示了反麻烦"）
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    hideFixedTemporarily();
  }, [zoom, canvasWidth]);

  return frame;
}
