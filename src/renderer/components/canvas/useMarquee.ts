// BlockCanvas · 框选（拖框多选）
//
// 关键设计：选框的**起点钉在画布内容坐标上**（startCx/Cy = client - wrapRect + scroll），
// 容器滚动时选框跟着内容走 —— 于是可以把"已经滚出视口"的部分也框进来。
// 绘制（fixed 覆盖层）与命中判定共用同一份换算结果，不会出现"看着框住了但没选中"。
import { useRef, useState } from 'react';
import { useScene } from '@store/sceneStore';
import { altHeld } from '@lib/altMode';
import type { MarqueeDrag } from './types';

export function useMarquee(canvasRef: React.RefObject<HTMLDivElement | null>) {
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<MarqueeDrag | null>(null);
  // 拖框结束后会跟着一个 click（冒泡到 .canvas）——用它吞掉，避免框选完又清空选区
  const suppressClickRef = useRef(false);
  // 拖框自动滚动：指针靠近容器边缘时持续滚动，让"视口外的内容"也能被框选
  const autoScrollRef = useRef<{ vx: number; vy: number; raf: number; clientX: number; clientY: number } | null>(null);
  const selectMany = useScene((s) => s.selectMany);

  const wrapEl = () => (canvasRef.current?.closest('.canvas-wrap') as HTMLElement | null);

  /** 画布滚动容器的当前滚动量 */
  const canvasScroll = () => {
    const w = wrapEl();
    return { left: w?.scrollLeft ?? 0, top: w?.scrollTop ?? 0 };
  };

  /**
   * 把「内容坐标」的选框换算回 client 坐标。
   * 起点钉在内容上（startCx/Cy），滚动时选框跟着内容走 —— 于是可以把画布滚出去、
   * 当前不在视口里的部分也框进来（这正是"框选视口外内容"的修法）。
   */
  const marqueeClientRect = (d: MarqueeDrag, cx: number, cy: number) => {
    const sc = canvasScroll();
    const curCx = cx - d.wrapRect.left + sc.left;
    const curCy = cy - d.wrapRect.top + sc.top;
    const minCx = Math.min(d.startCx, curCx);
    const maxCx = Math.max(d.startCx, curCx);
    const minCy = Math.min(d.startCy, curCy);
    const maxCy = Math.max(d.startCy, curCy);
    return {
      x: minCx - sc.left + d.wrapRect.left,
      y: minCy - sc.top + d.wrapRect.top,
      w: maxCx - minCx,
      h: maxCy - minCy
    };
  };

  // 自动滚动：指针靠近（或越过）容器边缘时按距离给速度，rAF 里持续滚并实时重算选框
  const updateAutoScroll = (clientX: number, clientY: number) => {
    const wrap = wrapEl();
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const ZONE = 44;
    const MAX = 22; // px / 帧
    const speed = (over: number) => Math.sign(over) * Math.min(MAX, Math.abs(over) * 0.5);
    const vy = clientY < r.top + ZONE ? speed(clientY - (r.top + ZONE))
      : clientY > r.bottom - ZONE ? speed(clientY - (r.bottom - ZONE)) : 0;
    const vx = clientX < r.left + ZONE ? speed(clientX - (r.left + ZONE))
      : clientX > r.right - ZONE ? speed(clientX - (r.right - ZONE)) : 0;
    const cur = autoScrollRef.current;
    if (!cur) {
      if (!vx && !vy) return;
      const state = { vx, vy, clientX, clientY, raf: 0 };
      const step = () => {
        const s = autoScrollRef.current;
        const d = dragRef.current;
        const w = wrapEl();
        if (!s || !d || !w) { if (s) s.raf = 0; return; }
        const beforeL = w.scrollLeft, beforeT = w.scrollTop;
        w.scrollLeft += s.vx;
        w.scrollTop += s.vy;
        if (w.scrollLeft !== beforeL || w.scrollTop !== beforeT) {
          setMarquee(marqueeClientRect(d, s.clientX, s.clientY));
        }
        s.raf = requestAnimationFrame(step);
      };
      state.raf = requestAnimationFrame(step);
      autoScrollRef.current = state;
    } else {
      cur.vx = vx; cur.vy = vy; cur.clientX = clientX; cur.clientY = clientY;
      if (!vx && !vy) { cancelAnimationFrame(cur.raf); autoScrollRef.current = null; }
    }
  };

  // window 级监听：指针跑到画布外（条纹区/面板上）也持续更新选框
  const onWindowMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    d.active = true;
    window.getSelection()?.removeAllRanges();
    setMarquee(marqueeClientRect(d, e.clientX, e.clientY));
    updateAutoScroll(e.clientX, e.clientY);
  };

  const endMarquee = () => {
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    document.body.classList.remove('bc-marqueeing');
    if (autoScrollRef.current) { cancelAnimationFrame(autoScrollRef.current.raf); autoScrollRef.current = null; }
  };

  const onWindowUp = (e: PointerEvent) => {
    const d = dragRef.current;
    endMarquee();
    dragRef.current = null;
    setMarquee(null);
    window.getSelection()?.removeAllRanges();
    if (!d) return;
    if (!d.active) return; // 没拖成框 = 普通点击，交给 onClick 清空选区
    suppressClickRef.current = true;
    // 用「内容坐标」选框换算回 client，与元素 rect（已含滚动 / 缩放）对比：
    // 100% 落在框内才算选中（与 Windows 桌面框选一致）
    const rect = marqueeClientRect(d, e.clientX, e.clientY);
    const minX = rect.x;
    const minY = rect.y;
    const maxX = rect.x + rect.w;
    const maxY = rect.y + rect.h;
    const ids: string[] = [];
    for (const el of document.querySelectorAll('.canvas [data-bc-id]')) {
      if (el.getAttribute('data-bc-locked') === '1') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // hidden 元素不参与
      if (r.left >= minX - 0.5 && r.top >= minY - 0.5 && r.right <= maxX + 0.5 && r.bottom <= maxY + 0.5) {
        ids.push(el.getAttribute('data-bc-id')!);
      }
    }
    if (d.ctrl) {
      // Ctrl+拖框：合并进现有选区
      const cur = useScene.getState().scene.selectedIds;
      selectMany([...new Set([...cur, ...ids])]);
    } else {
      selectMany(ids);
    }
  };

  /** 画布空白处按下 → 起框（元素上的按下由元素自己处理） */
  const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // 按住 Alt（**或**开着竖屏的一键 Alt 模式）= 画布交互模式，空白处不起框。
    // 竖屏那个开关以前只改了 altMode 状态，这里仍旧只认 e.altKey ——
    // 于是用户开了 Alt 模式在空白画布上长按/拖，还是被打成范围选中，把上下平移带坏了。
    if (altHeld(e)) return;
    // 起点允许：条纹背景（wrap 自身）或画布空白处（canvas 自身）
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && t !== canvasRef.current) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    const wrap = wrapEl();
    const wrapRect = wrap?.getBoundingClientRect() ?? new DOMRect();
    const sc = canvasScroll();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      // 起点钉在「内容坐标」上：容器滚动时选框跟着内容走，不会错位
      startCx: e.clientX - wrapRect.left + sc.left,
      startCy: e.clientY - wrapRect.top + sc.top,
      wrapRect, scrollLeft0: sc.left, scrollTop0: sc.top,
      active: false, ctrl: e.ctrlKey || e.metaKey
    };
    document.body.classList.add('bc-marqueeing');
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
  };

  return { marquee, dragRef, suppressClickRef, onCanvasPointerDown, endMarquee, marqueeClientRect };
}
