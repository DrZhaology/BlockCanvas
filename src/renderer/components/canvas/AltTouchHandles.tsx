// ============================================================================
// BlockCanvas · v0.4.6 第 46 批：Alt 模式的**触摸手柄层**
// ----------------------------------------------------------------------------
// 用户原话：
//   「Alt 模式的体验很烂，因为之前没有说过，现在我详细说一下怎么做：
//     开启 Alt 模式后，这个元素必须被选中，才能进行可视化调整：
//     1. 选中元素和没开启 Alt 模式的画布一样，长按元素才能选中，但是不能选中多个元素，
//        按住下一个元素，上一个元素自动取消选中。
//     2. 选中后，元素中间出现一个 svg（上下左右都是箭头），按住这个 svg 就可以改变这个
//        元素在画布上的位置。
//     3. 选中后，4 个角出现 4 个方框，按住这个方框（不只是这个方框，方框外面的一部分区域
//        也能按倒，因为手指很大），就可以调整元素的宽度和高度，逻辑和电脑端类似。
//     4. 选中后，4 条边也可以按住调整。」
//
// 为什么需要这一层：桌面那套 Alt 全靠**鼠标 hover** —— 指针移到元素边缘才"知道"你要拖哪条边。
// 手指按下去之前没有任何 hover 事件，所以 `altHoverRef` 永远是 null，一条边也拖不起来。
// 于是这里把"能拖哪里"直接画出来（中间移动柄 + 4 角 + 4 边），按下时告诉 useAltDrag 拖谁。
//
// 实现要点：
//   · 覆盖层是 `position: fixed`（屏幕坐标），每次量元素的 getBoundingClientRect —— 
//     滚动 / 缩放 / 拖动过程中位置都在变，只有实时量才不会错位；
//   · 容器 `pointer-events: none`，只有手柄自己 `auto` —— 否则整块画布都点不动了；
//   · 手柄的**视觉**尺寸和**命中**尺寸分开：4 角视觉 20px、命中 44px（用伪元素撑开），
//     4 边视觉 6px 厚、命中 26px。用户明确说过"手指很大"。
//   · 拖拽本身不在这里做：按下时调 `beginDrag`，交给 useAltDrag + altDragMove
//     （和桌面按住 Alt 走同一条路，贴墙吸附 / 双边约束 / 松手归一化全部复用）。
// ============================================================================

import { useEffect, useState } from 'react';
import { useScene } from '@store/sceneStore';
import { useAltMode } from '@lib/altMode';
import { useShellLayout } from '@lib/shellMode';
import type { AltEdge, AltMode } from './types';

export type AltTouchTarget = { id: string; mode: AltMode; edge: AltEdge | null };
export type AltTouchBegin = {
  (target: AltTouchTarget, clientX: number, clientY: number, pointerId: number): boolean;
};

type Box = { x: number; y: number; w: number; h: number };

/** 4 角：视觉方块边长 / 触摸命中区边长（手指大，命中区要 44） */
const CORNER_VIS = 20;
const CORNER_HIT = 44;
/** 4 边：视觉厚度 / 命中区厚度 / 长度占边长比例 */
const EDGE_VIS = 6;
const EDGE_HIT = 26;
const EDGE_LEN = 0.34;

const CORNERS: Array<{ edge: AltEdge; cx: number; cy: number; cursor: string }> = [
  { edge: 'tl', cx: 0, cy: 0, cursor: 'nwse-resize' },
  { edge: 'tr', cx: 1, cy: 0, cursor: 'nesw-resize' },
  { edge: 'bl', cx: 0, cy: 1, cursor: 'nesw-resize' },
  { edge: 'br', cx: 1, cy: 1, cursor: 'nwse-resize' }
];

const EDGES: Array<{ edge: AltEdge; cursor: string; style: (b: Box) => React.CSSProperties }> = [
  // 上 / 下：横向铺在边的中点
  { edge: 't', cursor: 'ns-resize', style: (b) => ({ left: b.w / 2, top: 0, width: Math.max(56, (b.w * EDGE_LEN) | 0), height: EDGE_VIS }) },
  { edge: 'b', cursor: 'ns-resize', style: (b) => ({ left: b.w / 2, top: b.h, width: Math.max(56, (b.w * EDGE_LEN) | 0), height: EDGE_VIS }) },
  // 左 / 右：纵向铺在边的中点
  { edge: 'l', cursor: 'ew-resize', style: (b) => ({ left: 0, top: b.h / 2, width: EDGE_VIS, height: Math.max(56, (b.h * EDGE_LEN) | 0) }) },
  { edge: 'r', cursor: 'ew-resize', style: (b) => ({ left: b.w, top: b.h / 2, width: EDGE_VIS, height: Math.max(56, (b.h * EDGE_LEN) | 0) }) }
];

/** 中间的"上下左右箭头"图标（用户原话要求这个形状） */
function MoveGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 3.2v19.6M3.2 13h19.6" />
      <path d="M13 3.2 10.4 6M13 3.2 15.6 6M13 22.8 10.4 20M13 22.8 15.6 20" />
      <path d="M3.2 13 6 10.4M3.2 13 6 15.6M22.8 13 20 10.4M22.8 13 20 15.6" />
    </svg>
  );
}

export function AltTouchHandles(props: {
  /** 只在竖屏 + Alt 模式开着时为 true */
  active: boolean;
  zoom: number;
  beginDrag: AltTouchBegin;
}) {
  const { active, zoom, beginDrag } = props;
  const selectedIds = useScene((s) => s.scene.selectedIds);
  const [box, setBox] = useState<Box | null>(null);
  const [dragging, setDragging] = useState(false);

  const single = active && selectedIds.length === 1 ? selectedIds[0] : null;

  // 实时跟框：元素可能因为滚动 / 改样式 / 动画在动，只有每帧量 rect 才不会错位。
  // 只在"有单个选中"时跑，代价可以忽略（一次 getBoundingClientRect）。
  useEffect(() => {
    if (!single) { setBox(null); return; }
    let raf = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const el = document.querySelector(`.canvas [data-bc-id="${CSS.escape(single)}"]`) as HTMLElement | null;
      if (!el) { setBox(null); raf = requestAnimationFrame(tick); return; }
      const r = el.getBoundingClientRect();
      const visible = r.width >= 8 && r.height >= 8 && getComputedStyle(el).visibility !== 'hidden';
      setBox((prev) => {
        if (!visible) return null;
        const next = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        if (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) return prev;
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [single, zoom]);

  if (!single || !box) return null;

  const start = (e: React.PointerEvent, target: AltTouchTarget) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = beginDrag(target, e.clientX, e.clientY, e.pointerId);
    if (!ok) return;
    setDragging(true);
    // 拖动期间把桌面那枚"模式+尺寸"气泡藏掉：手指就按在中间，气泡正好压在移动柄上
    document.body.classList.add('bc-alttouch-drag');
    // 手指抬起（或被打断）时收状态。拖拽本身由 useAltDrag 挂在 window 上的
    // pointermove / pointerup 负责，这里只做"视觉上退出拖动态"。
    const done = () => {
      setDragging(false);
      document.body.classList.remove('bc-alttouch-drag');
      window.removeEventListener('pointerup', done, true);
      window.removeEventListener('pointercancel', done, true);
    };
    window.addEventListener('pointerup', done, true);
    window.addEventListener('pointercancel', done, true);
  };

  const b = box;
  return (
    <div
      className={'bc-alttouch' + (dragging ? ' is-dragging' : '')}
      style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
      aria-hidden="true"
    >
      {/* 框线：让"能拖的范围"一眼可见（不动画，避免和拖动争帧） */}
      <span className="bc-alttouch-box" />

      {/* 中间：按住移动（等价桌面 Alt + 元素中间拖） */}
      <span
        className="bc-alttouch-move"
        onPointerDown={(e) => start(e, { id: single, mode: 'move', edge: null })}
        role="button"
        aria-label="按住移动这个元素"
      >
        <MoveGlyph />
      </span>

      {/* 4 角：按住改宽高（命中区 44px，视觉 20px 方块） */}
      {CORNERS.map((c) => (
        <span
          key={c.edge}
          className="bc-alttouch-corner"
          data-edge={c.edge}
          style={{ left: b.w * c.cx, top: b.h * c.cy, cursor: c.cursor, ['--vis' as string]: CORNER_VIS + 'px', ['--hit' as string]: CORNER_HIT + 'px' }}
          onPointerDown={(e) => start(e, { id: single, mode: 'resize', edge: c.edge })}
        />
      ))}

      {/* 4 边：按住改单边（命中区 26px 厚） */}
      {EDGES.map((e2) => (
        <span
          key={e2.edge}
          className="bc-alttouch-edge"
          data-edge={e2.edge}
          style={{ ...e2.style(b), cursor: e2.cursor, ['--hit' as string]: EDGE_HIT + 'px' }}
          onPointerDown={(e) => start(e, { id: single, mode: 'resize', edge: e2.edge })}
        />
      ))}
    </div>
  );
}

/**
 * 自洽的挂载点：自己判断「竖屏 + Alt 模式开着」，Canvas 里只写一行。
 * 判断放这里而不是 Canvas，是为了让组装层保持干净（它也受 400 行预算约束）。
 */
export function AltTouchLayer(props: { zoom: number; beginDrag: AltTouchBegin }) {
  const altOn = useAltMode();
  const shell = useShellLayout();
  const on = shell.layout === 'stack' && altOn;
  // 手柄层在的时候，桌面的 hover 浮层（盒模型 / 尺寸气泡 / 橙色高亮框）会把中间那颗移动柄糊住
  useEffect(() => { if (on) document.body.classList.add('bc-alttouch-on'); else document.body.classList.remove('bc-alttouch-on'); }, [on]);
  if (!on) return null;
  return <AltTouchHandles active zoom={props.zoom} beginDrag={props.beginDrag} />;
}
export default AltTouchHandles;
