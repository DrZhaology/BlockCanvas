import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useScene, findParent, findNode, getEffectiveStyle } from '@store/sceneStore';
import { SELF_CLOSING_TAGS, TEXT_ONLY_TAGS, CONTAINER_TAGS, TEXT_TAGS } from '@lib/types';
import type { SceneElement } from '@lib/types';
import { selectorForNode, collectStyleClasses, buildStyleBlock, createStyleClassSet, quickCssToCss, cssTextToObject, simplifyStyle } from '@lib/styleClass';
import { classColor } from '@lib/classColor';
import { useShowBr } from '@lib/showBr';
import { CanvasTextMenu, isTextStylable, type TextMenuPayload } from './CanvasTextMenu';
import { CanvasPropSearch } from './CanvasPropSearch';

// BlockCanvas · 画布
// 阶段1：递归渲染 scene graph。
// 阶段2补：多选 + 拖框选中。
// 阶段3第1轮：样式渲染改为"类"体系（与导出共用 lib/styleClass）：
//  - 画布注入与导出相同的 <style> 块 → 画布 = 浏览器 = 导出（用户全局 CSS 可覆盖）
//  - 内联 style 只剩编辑器专属视觉（选中框/空容器兜底/cursor），一律不导出
// 阶段4・4-C：选择器策略 = 类名优先 → ID → 自动 hash 兜底；DOM 同步挂 id/class 与导出一致
// 阶段4・5：选择器重构——无类名无 ID 的元素改走"行内样式"（与导出同一文本），
// 不再生成自动 hash 类；隐藏/锁定/点击行为不变
//  - hidden 元素画布不渲染；locked 元素显示锁标记且不可点选
//  - 自闭合元素走 SELF_CLOSING_TAGS 单独渲染
//  - Alt+点击元素 = 选中它的父级；Ctrl+点击 = 加/减选中；空白拖框 = 框选
// 4-B/4-F：Ctrl+滚轮缩放画布；zoom 状态由 App 持有（归位按钮在工具栏）

/**
 * 「拖到墙外 → 改父子关系」：从鼠标下的 DOM 往上找第一个可作为新父级的**块级容器**。
 * 排除：被拖元素自身及其后代、当前父级（避免误重排）、自闭合元素、锁定元素、纯 inline 元素。
 */
function pickDropTarget(
  under: HTMLElement | null,
  draggedEl: HTMLElement,
  currentParentId: string | null,
  root: SceneElement
): { id: string; rect: { x: number; y: number; w: number; h: number } } | null {
  let cur: HTMLElement | null = under;
  while (cur && cur !== document.body) {
    if (cur.hasAttribute?.('data-bc-id')) {
      const id = cur.getAttribute('data-bc-id')!;
      if (cur !== draggedEl && !draggedEl.contains(cur)) {
        const node = findNode(root, id);
        const cs = getComputedStyle(cur);
        const isBlock = cs.display !== 'inline' && cs.display !== 'contents';
        if (node && isBlock && !SELF_CLOSING_TAGS.has(node.type)
          && id !== currentParentId && cur.getAttribute('data-bc-locked') !== '1') {
          const r = cur.getBoundingClientRect();
          return { id, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
        }
      }
    }
    cur = cur.parentElement;
  }
  return null;
}

export function Canvas({ canvasWidth = 'auto', zoom = 1, onZoomChange, onUserResize }: {
  canvasWidth?: string;
  zoom?: number;
  onZoomChange?: (fn: (z: number) => number) => void;
  // 用户拖动画布左右边缘调整宽度（绝对 px 数）——供 App 写入 canvasWidth 状态并持久化
  onUserResize?: (px: number) => void;
}) {
  const root = useScene((s) => s.scene.root);
  const globalCss = useScene((s) => s.scene.globalCss);
  const quickCss = useScene((s) => s.scene.quickCss);
  // 自动样式类规则（与导出同一生成逻辑）：画布注入 <style>，元素挂类名
  const styleSet = useMemo(() => {
    const ctx = createStyleClassSet();
    collectStyleClasses(root, ctx);
    return ctx;
  }, [root]);
  const autoCssBlock = useMemo(() => buildStyleBlock(styleSet), [styleSet]);
  const quickCssBlock = useMemo(() => {
    // 快速设置的 body/a/标题规则在导出 HTML 里作用于页面；画布注入时把它指向画布自身，
    // 避免污染编辑器窗口（所见即所得语义不变）。
    // 「默认边距」所见即所得：未开启"去掉白边"时，画布模拟浏览器给 body 的 8px 默认 margin
    //（.canvas 无 margin 概念，用 padding 等效呈现）；开启后贴边，与导出行为一致。
    const base = quickCssToCss(quickCss)
      .replace('body {', '.canvas {')
      .replace('a {', '.canvas a {')
      .replace('h1, h2, h3, h4, h5, h6 {', '.canvas h1, .canvas h2, .canvas h3, .canvas h4, .canvas h5, .canvas h6 {');
    const bodyMargin = quickCss?.resetMargin === '1' ? '' : '\n.canvas { padding: 8px; }';
    // 「重置标题/段落默认间距」：画布侧同步清零（带 .canvas 前缀防泄漏到编辑器 UI），
    // 与导出端的 UA margin 重置保持一致
    const headingReset = quickCss?.resetHeadingMargin === '1'
      ? '\n.canvas h1, .canvas h2, .canvas h3, .canvas h4, .canvas h5, .canvas h6, .canvas p, .canvas ul, .canvas ol, .canvas figure, .canvas blockquote, .canvas table { margin: 0; }'
      : '';
    return base + bodyMargin + headingReset;
  }, [quickCss]);
  // 同类同色：轮廓模式下，同类名/关系选择器元素用同一专属颜色描边（颜色 = classColor 哈希色板）。
  // 只注入编辑器可视化样式（挂在 body 开关类下），导出链路不经过。
  const classColorCss = useMemo(() => {
    const names = new Set<string>();
    const walk = (n: SceneElement): void => {
      const cls = (n.attrs?.className ?? '').trim();
      const rel = (n.attrs?.relSelector ?? '').trim();
      if (cls) names.add(cls.split(/\s+/)[0]);
      else if (rel) names.add(rel);
      for (const c of n.children) walk(c);
    };
    walk(root);
    return [...names]
      .map((n) => `body.bc-outlines-on .canvas [data-bc-cg="${CSS.escape(n)}"]{outline-color:${classColor(n)};}`)
      .join('\n');
  }, [root]);
  const selectedId = useScene((s) => s.scene.selectedId);
  const selectedIds = useScene((s) => s.scene.selectedIds);
  const select = useScene((s) => s.selectElement);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);

  // 画布专用断点生效规则：在当前非桌面断点下，为 .canvas 内所有匹配元素强行应用该断点样式规则
  const canvasResponsiveCss = useMemo(() => {
    const parts: string[] = [];
    if (activeBreakpoint === 'tablet' || activeBreakpoint === 'mobile') {
      if (styleSet.tabletOrder.length > 0) {
        const lines = styleSet.tabletOrder.map((sel) => `.canvas ${sel} { ${styleSet.tabletRules.get(sel)} }`).join('\n');
        parts.push(lines);
      }
    }
    if (activeBreakpoint === 'mobile') {
      if (styleSet.mobileOrder.length > 0) {
        const lines = styleSet.mobileOrder.map((sel) => `.canvas ${sel} { ${styleSet.mobileRules.get(sel)} }`).join('\n');
        parts.push(lines);
      }
    }
    return parts.join('\n');
  }, [styleSet, activeBreakpoint]);

  const toggleSelect = useScene((s) => s.toggleSelect);
  const selectMany = useScene((s) => s.selectMany);
  // 滚轮缩放要用到"当前缩放"，但 wheel 回调里读 prop 会拿到旧值 → 用 ref 跟住
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Alt+滚轮的"缩放锚点"（transform-origin）：默认左上，Alt 滚轮时设到光标处
  const [zoomOrigin, setZoomOrigin] = useState('left top');

  // 拖框选中状态（**内容坐标系**：起点钉在画布内容上，容器滚动时选框跟着内容走，
  // 于是可以把画布滚出去的部分也框进来；绘制时再换算回 client 坐标）。
  const dragRef = useRef<{
    startX: number; startY: number;   // 起点（client）
    startCx: number; startCy: number; // 起点（内容坐标，= client - wrapRect + scroll）
    scrollLeft0: number; scrollTop0: number; // 起框时的滚动量（诊断用）
    active: boolean;
    ctrl: boolean;
    wrapRect: DOMRect;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // 拖框结束后会跟着一个 click（冒泡到 .canvas）——用它吞掉，避免框选完又清空选区
  const suppressClickRef = useRef(false);
  // 拖框自动滚动：指针靠近容器边缘时持续滚动，让"视口外的内容"也能被框选
  const autoScrollRef = useRef<{ vx: number; vy: number; raf: number; clientX: number; clientY: number } | null>(null);

  // ============ Alt 交互（v0.4.4d）============
  // 按住 Alt 后，画布元素才进入"可编辑"状态（平时只负责选中/预览，避免误触）：
  //   · 指针贴到元素边缘 → 拖拽改宽高（resize）
  //   · 指针落在文字元素中间 → 左右拖动改字号（font，鼠标隐藏）
  //   · 指针落在其它元素中间 → 拖动移动位置（move，改 left/top 或 margin）
  // 不按 Alt 时行为完全不变；Alt+单击（不拖）= 选中父级（沿用旧行为）。
  type AltEdge = 'l' | 'r' | 't' | 'b' | 'tl' | 'tr' | 'bl' | 'br';
  type AltMode = 'resize' | 'font' | 'move';
  type Bar = { x: number; y: number; w: number; h: number };
  const [altHover, setAltHover] = useState<{ id: string; edge: AltEdge | null; mode: AltMode; rect: { x: number; y: number; w: number; h: number } } | null>(null);
  const altHoverRef = useRef<typeof altHover>(null);
  altHoverRef.current = altHover;
  // Alt 拖拽中"实时边界框"的 rAF 句柄：样式写入 → React 提交 → 下一帧量真实 rect 再画框，
  // 保证拖动过程中橙色边界 1:1 跟手（以前拖动时框直接消失，松手才回来）
  const altLiveRaf = useRef(0);
  const [altBadge, setAltBadge] = useState<{ x: number; y: number; text: string } | null>(null);
  // 撞到"墙"时闪一下的那条边（橙色），告诉用户"这是限制不是 BUG"
  const [wallFlash, setWallFlash] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Alt 拖动中"当前可达边界"的常显提示线（橙色细线）——
  // 用户反馈：只剩视口边界线了，内边距/外边距的界限看不见 → 拖动时把四面墙都画出来。
  const [wallHints, setWallHints] = useState<Bar[]>([]);
  // 撞墙后继续往墙外拖 → 进入"改父子关系"模式：被拖元素淡化，鼠标下的块级元素高亮
  const [dropTarget, setDropTarget] = useState<{ id: string; rect: { x: number; y: number; w: number; h: number } } | null>(null);
  // Alt 移动时的"吸附对齐参考线"（PowerPoint 风格）
  const [guides, setGuides] = useState<{ x: number | null; y: number | null; box: { left: number; top: number; right: number; bottom: number } | null } | null>(null);
  const wallFlashTimer = useRef(0);
  const flashWall = (b: Bar | null) => {
    if (!b) return;
    setWallFlash(b);
    window.clearTimeout(wallFlashTimer.current);
    wallFlashTimer.current = window.setTimeout(() => setWallFlash(null), 620);
  };
  const altDragRef = useRef<null | {
    id: string; mode: AltMode; edge: AltEdge | null;
    startX: number; startY: number;
    rect: DOMRect;
    startW: number; startH: number;
    /** 移动基准：定位元素用计算后的 left/top；常规流用 margin */
    positioned: boolean; isFixed: boolean;
    startLeft: number; startTop: number;
    startMarginL: number; startMarginT: number;
    /** 允许移动/缩放的 client 坐标范围（"墙"）+ 每面墙要画的整条边 + 吸附参考线 */
    bounds: {
      minX: number; maxX: number; minY: number; maxY: number;
      barL: Bar | null; barR: Bar | null; barT: Bar | null; barB: Bar | null;
      snapX: number[]; snapY: number[];
    };
    /** 拖动时常显的"可达边界"提示线（橙色） */
    walls: Bar[];
    /** 撞墙后继续往外拖 → 进入"改父子关系"模式（被拖元素淡化、鼠标下元素高亮） */
    reparent: boolean;
    dropId: string | null;
    parentId: string | null;
    startFont: number;
    engaged: boolean;
  }>(null);

  /**
   * 计算元素"能动到哪儿"的边界（client 坐标）+ 每面墙要画的位置。
   *
   * 规则（v0.4.4g 重做）：
   *   · 墙基准取父容器的**内容盒**（去掉 padding/border），并**把元素自己的 margin 算进去** ——
   *     所以"碰到内边距/外边距"就停，不会无视 margin 直接突破。
   *   · **元素与元素的碰撞**：定位元素（absolute/relative/fixed）会把邻近兄弟的边缘当成墙，
   *     墙就画在那个兄弟的边上；只有没有兄弟可撞时才退回父容器/画布。
   *   · `fixed` 额外受**画布四边**限制（画布 = 浏览器视口）。
   *   · 常规流元素纵向不设底（可以一直往下拖，把画布撑长）。
   */
  const boundsFor = (el: HTMLElement, rect: DOMRect) => {
    const canvasEl = el.closest('.canvas') as HTMLElement | null;
    const cs = getComputedStyle(el);
    const pos = cs.position;
    const isFixed = pos === 'fixed';
    const positioned = pos === 'absolute' || pos === 'relative' || pos === 'fixed';
    const m = {
      top: parseFloat(cs.marginTop) || 0,
      right: parseFloat(cs.marginRight) || 0,
      bottom: parseFloat(cs.marginBottom) || 0,
      left: parseFloat(cs.marginLeft) || 0
    };
    const boxOf = (n: HTMLElement) => {
      const r = n.getBoundingClientRect();
      const cw = n.clientWidth || r.width;
      const ch = n.clientHeight || r.height;
      const left = r.left + n.clientLeft;
      const top = r.top + n.clientTop;
      return { left, top, right: left + cw, bottom: top + ch };
    };
    const parentEl = el.parentElement;
    const pb = boxOf(parentEl && parentEl !== canvasEl ? parentEl : (canvasEl ?? el));

    // 墙的"整面"高亮条
    const vBar = (x: number, top: number, bottom: number) => ({ x: x - 2, y: top, w: 4, h: Math.max(2, bottom - top) });
    const hBar = (y: number, left: number, right: number) => ({ x: left, y: y - 2, w: Math.max(2, right - left), h: 4 });

    // 定位元素的 margin 是固定的 → 墙要把它算进去；常规流元素的 margin 本身就是被调的量 → 不算
    const addM = positioned;
    // 四面墙的"真实位置"（client 坐标）：元素的边缘最终会被挡在这条线上。
    // 注意：画在**墙的位置**（父容器内容盒内侧 ± 元素外边距），不是父容器的边框 —— 用户明确要求。
    let wallLeft = pb.left + (addM ? m.left : 0);
    let wallRight = pb.right - (addM ? m.right : 0);
    let wallTop = pb.top + (addM ? m.top : 0);
    let wallBottom = isFixed ? pb.bottom - (addM ? m.bottom : 0) : Infinity;
    // 每面墙要画的"整面"（默认铺满父容器内容盒；被兄弟元素挡住时改成画在那个兄弟的边上）
    let barL: Bar | null = vBar(wallLeft, pb.top, pb.bottom);
    let barR: Bar | null = vBar(wallRight, pb.top, pb.bottom);
    let barT: Bar | null = hBar(wallTop, pb.left, pb.right);
    let barB: Bar | null = Number.isFinite(wallBottom) ? hBar(wallBottom, pb.left, pb.right) : null;

    // 元素与元素的碰撞（只对定位元素生效 —— 常规流的兄弟永远紧挨着，谈不上"撞"）
    if (positioned && parentEl) {
      for (const sib of Array.from(parentEl.children) as HTMLElement[]) {
        if (sib === el || !sib.hasAttribute?.('data-bc-id')) continue;
        const sr = sib.getBoundingClientRect();
        const vOverlap = Math.min(rect.bottom, sr.bottom) - Math.max(rect.top, sr.top) > 1;
        const hOverlap = Math.min(rect.right, sr.right) - Math.max(rect.left, sr.left) > 1;
        if (vOverlap) {
          if (sr.right <= rect.left + 1 && sr.right + m.left > wallLeft) { wallLeft = sr.right + m.left; barL = vBar(wallLeft, sr.top, sr.bottom); }
          if (sr.left >= rect.right - 1 && sr.left - m.right < wallRight) { wallRight = sr.left - m.right; barR = vBar(wallRight, sr.top, sr.bottom); }
        }
        if (hOverlap) {
          if (sr.bottom <= rect.top + 1 && sr.bottom + m.top > wallTop) { wallTop = sr.bottom + m.top; barT = hBar(wallTop, sr.left, sr.right); }
          if (sr.top >= rect.bottom - 1 && sr.top - m.bottom < wallBottom) { wallBottom = sr.top - m.bottom; barB = hBar(wallBottom, sr.left, sr.right); }
        }
      }
    }

    let minX = wallLeft;
    let maxX = wallRight - rect.width;
    let minY = wallTop;
    let maxY = Number.isFinite(wallBottom) ? wallBottom - rect.height : Infinity;
    // 兜底：范围别反转
    if (maxX < minX) maxX = minX;
    if (Number.isFinite(maxY) && maxY < minY) maxY = minY;
    // 允许至少停在原地
    minY = Math.min(minY, rect.top);
    if (Number.isFinite(maxY)) maxY = Math.max(maxY, rect.bottom - rect.height);

    // —— 吸附对齐参考线（PowerPoint 风格）：父容器 + 所有兄弟的 左/中/右、上/中/下 ——
    const snapX: number[] = [pb.left, (pb.left + pb.right) / 2, pb.right];
    const snapY: number[] = [pb.top, (pb.top + pb.bottom) / 2, pb.bottom];
    if (parentEl) {
      for (const sib of Array.from(parentEl.children) as HTMLElement[]) {
        if (sib === el || !sib.hasAttribute?.('data-bc-id')) continue;
        const sr = sib.getBoundingClientRect();
        snapX.push(sr.left, (sr.left + sr.right) / 2, sr.right);
        snapY.push(sr.top, (sr.top + sr.bottom) / 2, sr.bottom);
      }
    }

    return { minX, maxX, minY, maxY, barL, barR, barT, barB, snapX, snapY };
  };

  const EDGE_PX = 7;   // 边缘热区宽度（按住 Alt 后才生效）
  const CORNER_PX = 18; // 四角热区宽度（v0.4.4：角上要"好抓"，比边大得多 —— 以前 7px 太精确，很难命中）
  // 被标了 Alt 光标属性的元素（CSS 按 data-bc-alt 切换 resize/move/pointer 光标；
  // 因为元素光标已不在内联里，样式表能正常覆盖）
  const altTaggedRef = useRef<HTMLElement | null>(null);
  const tagAltCursor = (el: HTMLElement | null, kind: string) => {
    if (altTaggedRef.current && altTaggedRef.current !== el) {
      altTaggedRef.current.removeAttribute('data-bc-alt');
      altTaggedRef.current = null;
    }
    if (el) {
      el.setAttribute('data-bc-alt', kind);
      altTaggedRef.current = el;
    }
  };

  /** 判断指针落在某个元素的哪条边上（贴边才算，避免整块都能拖）。
   *  四角用更大的热区（CORNER_PX），边用小的（EDGE_PX）—— 角优先判定。 */
  const edgeAt = (rect: DOMRect, x: number, y: number): AltEdge | null => {
    const dL = x - rect.left;
    const dR = rect.right - x;
    const dT = y - rect.top;
    const dB = rect.bottom - y;
    // 1) 先用大热区判"角"：横纵同时进入 CORNER_PX 才算角（角上既要改宽又要改高）
    const hCorner = dL <= CORNER_PX ? 'l' : dR <= CORNER_PX ? 'r' : '';
    const vCorner = dT <= CORNER_PX ? 't' : dB <= CORNER_PX ? 'b' : '';
    if (hCorner && vCorner) return (vCorner + hCorner) as AltEdge;
    // 2) 再用小热区判"边"
    const h = dL <= EDGE_PX ? 'l' : dR <= EDGE_PX ? 'r' : '';
    const v = dT <= EDGE_PX ? 't' : dB <= EDGE_PX ? 'b' : '';
    if (h && v) return (v + h) as AltEdge;
    if (h) return h as AltEdge;
    if (v) return v as AltEdge;
    return null;
  };

  // Alt 悬停：算出"鼠标下面是谁、贴着哪条边、该进入哪种模式"，并给出对应的光标
  const onWrapPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.altKey || altDragRef.current) {
      if (altHover) setAltHover(null);
      tagAltCursor(null, '');
      return;
    }
    const el = (e.target as HTMLElement)?.closest?.('.canvas [data-bc-id]') as HTMLElement | null;
    if (!el || el.getAttribute('data-bc-locked') === '1') {
      if (altHover) setAltHover(null);
      tagAltCursor(null, '');
      return;
    }
    const id = el.getAttribute('data-bc-id')!;
    const node = findNode(root, id);
    if (!node) { if (altHover) setAltHover(null); tagAltCursor(null, ''); return; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // 行内元素（display:inline，如 span/strong/a）不参与"贴边改大小" —— 它没有块级盒，
    // 强行 resize 既不符合直觉、也容易误触；行内文字走"左右拖改字号"。
    const isInline = cs.display === 'inline';
    const edge = isInline ? null : edgeAt(r, e.clientX, e.clientY);
    const isText = TEXT_TAGS.has(node.type);
    const mode: AltMode = edge ? 'resize' : isText ? 'font' : 'move';
    // 角光标要区分两种对角：tl/br = 左上-右下(nwse)；tr/bl = 右上-左下(nesw)
    const cursorKind = mode !== 'resize' ? mode
      : edge === 'l' || edge === 'r' ? 'x'
        : edge === 't' || edge === 'b' ? 'y'
          : (edge === 'tl' || edge === 'br') ? 'nwse' : 'nesw';
    tagAltCursor(el, cursorKind);
    const next = { id, edge, mode, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
    const prev = altHoverRef.current;
    if (prev && prev.id === id && prev.edge === edge && prev.mode === mode
      && Math.abs(prev.rect.x - next.rect.x) < 0.5 && Math.abs(prev.rect.y - next.rect.y) < 0.5
      && Math.abs(prev.rect.w - next.rect.w) < 0.5 && Math.abs(prev.rect.h - next.rect.h) < 0.5) return;
    setAltHover(next);
  };

  // Alt + 按下：开始一次"可能发生的"拖拽（真正开始改样式要等指针移动超过阈值，
  // 否则单纯 Alt+单击仍按老规矩 = 选中父级）
  const onWrapPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    // 画布内任何一次按下（除了按在就地编辑框里）都先把正在编辑的文案提交掉 ——
    // 画布会 preventDefault，焦点不会转移 → 光靠 blur 不可靠，这里主动提交。
    const t0 = e.target as HTMLElement | null;
    if (!t0?.classList?.contains('canvas-inline-text-input')) {
      window.dispatchEvent(new CustomEvent('bc:commit-inline'));
    }
    // 点画布 = 离开右侧属性面板的输入框：主动 blur。
    // 画布的 pointerdown 会 preventDefault()，焦点不会自然转移 → 焦点留在输入框里，
    // 之后按 Ctrl+Z / Ctrl+Y 会被输入框"吃掉"（用户反馈：选中元素后撤销没反应）。
    const ae = document.activeElement as HTMLElement | null;
    if (ae && ae !== document.body && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)
      && !ae.closest('.canvas')) {
      ae.blur();
    }
    // 鼠标中键 = 打开"属性搜索"框（敲属性名 → Enter → 右侧面板定位高亮）
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      const el = t0?.closest?.('.canvas [data-bc-id]') as HTMLElement | null;
      if (el) {
        select(el.getAttribute('data-bc-id')!);
        setPropSearch({ x: e.clientX, y: e.clientY });
      }
      return;
    }
    if (!e.altKey || e.button !== 0) return;
    const h = altHoverRef.current;
    if (!h) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.querySelector(`.canvas [data-bc-id="${CSS.escape(h.id)}"]`) as HTMLElement | null;
    if (!el) return;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const pos = cs.position;
    const positioned = pos === 'absolute' || pos === 'fixed' || pos === 'relative';
    const bounds = boundsFor(el, rect);
    const parentNode = findParent(root, h.id);
    // 定位基准：优先计算后的 left/top（缺省时用计算值，第一次拖动即"补上" left/top，避免跳变）
    const startLeft = Number.isFinite(parseFloat(cs.left)) ? parseFloat(cs.left) : 0;
    const startTop = Number.isFinite(parseFloat(cs.top)) ? parseFloat(cs.top) : 0;
    const startMarginL = Number.isFinite(parseFloat(cs.marginLeft)) ? parseFloat(cs.marginLeft) : 0;
    const startMarginT = Number.isFinite(parseFloat(cs.marginTop)) ? parseFloat(cs.marginTop) : 0;
    altDragRef.current = {
      id: h.id, mode: h.mode, edge: h.edge,
      startX: e.clientX, startY: e.clientY,
      rect,
      startW: rect.width, startH: rect.height,
      positioned, isFixed: pos === 'fixed',
      startLeft, startTop, startMarginL, startMarginT,
      bounds,
      walls: [bounds.barL, bounds.barR, bounds.barT, bounds.barB].filter(Boolean) as Bar[],
      reparent: false,
      dropId: null,
      parentId: parentNode?.id ?? null,
      startFont: parseFloat(cs.fontSize) || 16,
      engaged: false
    };
    window.addEventListener('pointermove', onAltDragMove);
    window.addEventListener('pointerup', onAltDragUp);
  };

  /** Alt 拖拽进行中：下一帧量一次元素真实 rect，让悬停高亮框实时跟随（拖动中不再消失） */
  const scheduleAltLiveBox = () => {
    if (altLiveRaf.current) return;
    altLiveRaf.current = requestAnimationFrame(() => {
      altLiveRaf.current = 0;
      const d = altDragRef.current;
      if (!d) return;
      const el = document.querySelector(`.canvas [data-bc-id="${CSS.escape(d.id)}"]`) as HTMLElement | null;
      if (!el) return;
      try {
        const r = el.getBoundingClientRect();
        setAltHover({ id: d.id, edge: d.edge, mode: d.mode, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
      } catch { /* 忽略 */ }
    });
  };

  const onAltDragMove = (ev: PointerEvent) => {
    const d = altDragRef.current;
    if (!d) return;
    const dx = ev.clientX - d.startX;
    const dy = ev.clientY - d.startY;
    if (!d.engaged && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    const st = useScene.getState();
    if (!d.engaged) {
      d.engaged = true;
      document.body.classList.add('bc-alt-dragging');
      if (d.mode === 'font') document.body.classList.add('bc-alt-fonting');
      // 拖动时常显"可达边界"提示线（橙色）——让内边距/外边距的界限一眼可见
      if (d.mode !== 'font') setWallHints(d.walls);
      st.selectElement(d.id);
      st.beginStyleEdit(); // 单条撤销：整个拖动 = 一步 Ctrl+Z
    }
    const node = findNode(st.scene.root, d.id);
    if (!node) return;
    // 撞墙时高亮"整面墙"（元素边/外边距 ↔ 另一个元素的边，或父容器内边距）
    const bar = (side: 'l' | 'r' | 't' | 'b'): Bar | null =>
      side === 'l' ? d.bounds.barL : side === 'r' ? d.bounds.barR : side === 't' ? d.bounds.barT : d.bounds.barB;

    if (d.mode === 'resize') {
      // 贴哪条边改哪条；贴左/上边时同时把元素"推"回去 → 对侧边保持不动
      //（以前左/上是反的：改了宽度但左边不动，看着像往反方向长）
      const hasL = !!d.edge && d.edge.includes('l');
      const hasR = !!d.edge && d.edge.includes('r');
      const hasT = !!d.edge && d.edge.includes('t');
      const hasB = !!d.edge && d.edge.includes('b');
      let nw = d.startW;
      let nh = d.startH;
      if (hasL || hasR) nw = Math.max(8, d.startW + (hasL ? -dx : dx));
      if (hasT || hasB) nh = Math.max(8, d.startH + (hasT ? -dy : dy));
      // 墙：右 / 下边不能超出父容器（或画布视口）
      const parentRight = d.bounds.maxX + d.startW;
      const parentBottom = Number.isFinite(d.bounds.maxY) ? d.bounds.maxY + d.startH : Infinity;
      if (hasR && nw > parentRight - d.rect.left) {
        nw = Math.max(8, parentRight - d.rect.left);
        flashWall(bar('r'));
      }
      if (hasB && nh > parentBottom - d.rect.top) {
        nh = Math.max(8, parentBottom - d.rect.top);
        flashWall(bar('b'));
      }
      // 墙：左 / 上边不能超出父容器（对侧边固定）
      let shiftX = hasL ? dx : 0;
      let shiftY = hasT ? dy : 0;
      if (hasL && d.rect.right - nw < d.bounds.minX) {
        nw = Math.max(8, d.rect.right - d.bounds.minX);
        shiftX = d.bounds.minX - d.rect.left;
        flashWall(bar('l'));
      }
      if (hasT && d.rect.bottom - nh < d.bounds.minY) {
        nh = Math.max(8, d.rect.bottom - d.bounds.minY);
        shiftY = d.bounds.minY - d.rect.top;
        flashWall(bar('t'));
      }
      const patch: Record<string, string> = { width: Math.round(nw) + 'px' };
      if (hasT || hasB) patch.height = Math.round(nh) + 'px';
      if (hasL) patch[d.positioned ? 'left' : 'marginLeft'] = Math.round((d.positioned ? d.startLeft : d.startMarginL) + shiftX) + 'px';
      if (hasT) patch[d.positioned ? 'top' : 'marginTop'] = Math.round((d.positioned ? d.startTop : d.startMarginT) + shiftY) + 'px';
      st.updateStyle(d.id, patch);
      scheduleAltLiveBox();
      setAltBadge({ x: d.rect.right, y: d.rect.top, text: `${Math.round(nw)} × ${Math.round(nh)}` });
    } else if (d.mode === 'font') {
      const size = Math.max(6, Math.min(400, Math.round(d.startFont + dx / 6)));
      st.updateStyle(d.id, { fontSize: size + 'px' });
      scheduleAltLiveBox();
      setAltBadge({ x: ev.clientX + 14, y: ev.clientY + 14, text: `字号 ${size}px` });
    } else {
      // move：定位元素改 left/top（缺省会自动补上），常规流元素改 margin；
      // 都受"墙"限制 —— 横向不出父容器、纵向不越过上一个兄弟；撞墙闪"整面墙"
      let targetLeft = d.rect.left + dx;
      let targetTop = d.rect.top + dy;

      // —— 撞墙后继续往墙外拖 → 进入"改父子关系"模式（模仿把元素拖进另一个容器）——
      // 一旦进入就"锁住"：被拖元素冻结在墙上（淡化显示），改用鼠标位置挑要放入的块级元素。
      const pushOut = Math.max(
        d.bounds.minX - targetLeft,
        targetLeft - d.bounds.maxX,
        d.bounds.minY - targetTop,
        Number.isFinite(d.bounds.maxY) ? targetTop - d.bounds.maxY : -Infinity
      );
      if (!d.reparent && pushOut > 28) {
        d.reparent = true;
        document.body.classList.add('bc-reparenting');
        const srcEl = document.querySelector(`.canvas [data-bc-id="${CSS.escape(d.id)}"]`) as HTMLElement | null;
        srcEl?.setAttribute('data-bc-drag-src', '1');
        setWallHints([]); // 改父子关系时不再需要边界线
      }
      if (d.reparent) {
        const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        const draggedEl = document.querySelector(`.canvas [data-bc-id="${CSS.escape(d.id)}"]`) as HTMLElement | null;
        const tgt = under && draggedEl ? pickDropTarget(under, draggedEl, d.parentId, st.scene.root) : null;
        d.dropId = tgt?.id ?? null;
        setDropTarget(tgt);
        setAltBadge({
          x: ev.clientX + 14, y: ev.clientY + 14,
          text: tgt ? '松开 → 放入这个元素' : '移到某个块级元素上 → 放入其中'
        });
        return; // 冻结：不再继续改样式
      }

      // —— 吸附对齐（PowerPoint 风格）：左/中/右、上/中/下 靠近参考线时吸过去并画参考线 ——
      const SNAP = 6;
      const trySnap = (edges: number[], targets: number[]) => {
        let best: { delta: number; line: number } | null = null;
        for (const e of edges) {
          for (const t of targets) {
            const delta = t - e;
            if (Math.abs(delta) <= SNAP && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line: t };
          }
        }
        return best;
      };
      const sx = trySnap([targetLeft, targetLeft + d.rect.width / 2, targetLeft + d.rect.width], d.bounds.snapX);
      if (sx) targetLeft += sx.delta;
      const sy = trySnap([targetTop, targetTop + d.rect.height / 2, targetTop + d.rect.height], d.bounds.snapY);
      if (sy) targetTop += sy.delta;
      if (sx || sy) {
        const cr = canvasRef.current?.getBoundingClientRect();
        setGuides({
          x: sx ? sx.line : null,
          y: sy ? sy.line : null,
          box: cr ? { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom } : null
        });
      } else {
        setGuides(null);
      }

      let hit: { x: number; y: number; w: number; h: number } | null = null;
      if (targetLeft < d.bounds.minX) { targetLeft = d.bounds.minX; hit = bar('l'); }
      if (targetLeft > d.bounds.maxX) { targetLeft = d.bounds.maxX; hit = bar('r'); }
      if (targetTop < d.bounds.minY) { targetTop = d.bounds.minY; hit = bar('t'); }
      if (Number.isFinite(d.bounds.maxY) && targetTop > d.bounds.maxY) { targetTop = d.bounds.maxY; hit = bar('b'); }
      const ax = targetLeft - d.rect.left;
      const ay = targetTop - d.rect.top;
      const patch: Record<string, string> = {};
      if (d.positioned) {
        patch.left = Math.round(d.startLeft + ax) + 'px';
        patch.top = Math.round(d.startTop + ay) + 'px';
      } else {
        patch.marginLeft = Math.round(d.startMarginL + ax) + 'px';
        patch.marginTop = Math.round(d.startMarginT + ay) + 'px';
      }
      st.updateStyle(d.id, patch);
      if (hit) flashWall(hit);
      scheduleAltLiveBox();
      setAltBadge({ x: ev.clientX + 14, y: ev.clientY + 14, text: `${Math.round(ax)}, ${Math.round(ay)}` });
    }
  };

  const onAltDragUp = () => {
    const d = altDragRef.current;
    altDragRef.current = null;
    if (altLiveRaf.current) { cancelAnimationFrame(altLiveRaf.current); altLiveRaf.current = 0; }
    window.removeEventListener('pointermove', onAltDragMove);
    window.removeEventListener('pointerup', onAltDragUp);
    document.body.classList.remove('bc-alt-dragging');
    document.body.classList.remove('bc-alt-fonting');
    setAltBadge(null);
    setGuides(null);
    setWallHints([]);
    if (!d) return;

    // 「拖到墙外 → 改父子关系」收尾：清理淡化标记 + 执行 reparent
    if (d.reparent) {
      document.body.classList.remove('bc-reparenting');
      const srcEl = document.querySelector(`.canvas [data-bc-id="${CSS.escape(d.id)}"]`) as HTMLElement | null;
      srcEl?.removeAttribute('data-bc-drag-src');
      setDropTarget(null);
      if (d.engaged) useScene.getState().endStyleEdit(); // 先把拖动产生的样式改动收成一条撤销
      if (d.dropId) {
        useScene.getState().reparent(d.id, d.dropId);
        useScene.getState().selectElement(d.id);
      }
      const swallow0 = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); window.removeEventListener('click', swallow0, true); };
      window.addEventListener('click', swallow0, true);
      return;
    }

    if (d.engaged) {
      useScene.getState().endStyleEdit();
      // 吞掉这次拖拽之后冒泡上来的 click（否则会顺手选中/选中父级）
      const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); window.removeEventListener('click', swallow, true); };
      window.addEventListener('click', swallow, true);
    }
    // 没拖（纯 Alt+单击）→ 什么都不做，交给元素自身的 onClick 走"选中父级"
  };

  // 松开 Alt / 组件卸载 → 清掉 Alt 悬停高亮与光标标记
  useEffect(() => {
    // 按住 Alt 期间给 body 打标记：画布宽度手柄要让位（隐藏 + 不响应），
    // 否则 Alt 贴边调元素时会被画布宽度的竖线手柄抢走操作（用户反馈）。
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') document.body.classList.add('bc-alt-down');
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || !e.altKey) {
        document.body.classList.remove('bc-alt-down');
        setAltHover(null);
        tagAltCursor(null, '');
      }
    };
    const onBlur = () => document.body.classList.remove('bc-alt-down');
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.body.classList.remove('bc-alt-down');
      tagAltCursor(null, '');
      window.clearTimeout(wallFlashTimer.current);
      if (altLiveRaf.current) { cancelAnimationFrame(altLiveRaf.current); altLiveRaf.current = 0; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // 滚轮时先收掉 Alt 悬停高亮（避免缩放时还挂着"可编辑"虚线框与光标）
    if (altHover) setAltHover(null);
    tagAltCursor(null, '');
    // Ctrl+滚轮 / Alt+滚轮 都是缩放；Alt 额外做"以鼠标位置为锚点"的精准缩放
    if (!e.ctrlKey && !e.altKey) return;
    e.preventDefault();
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const oldZoom = zoomRef.current;
    // 分度更细（4%/格，以前 10%/格）：滚起来"费力一点"但精度更高
    const dir = e.deltaY < 0 ? 1 : -1;
    const next = Math.min(2, Math.max(0.5, Math.round(oldZoom * (1 + dir * 0.04) * 100) / 100));
    if (next === oldZoom) return;
    if (e.altKey && next !== 1) {
      // 以鼠标位置为缩放锚点：把 transform-origin 设到光标处（相对画布百分比），
      // 缩放时该点保持不动 —— 比"补偿滚动"更可靠（画布居中时滚动是无效的）。
      const r = canvasEl.getBoundingClientRect();
      const ox = r.width ? ((e.clientX - r.left) / r.width) * 100 : 0;
      const oy = r.height ? ((e.clientY - r.top) / r.height) * 100 : 0;
      setZoomOrigin(`${Math.max(0, Math.min(100, ox)).toFixed(2)}% ${Math.max(0, Math.min(100, oy)).toFixed(2)}%`);
    } else {
      setZoomOrigin('left top');
    }
    onZoomChange?.(() => next);
  };

  const selectParent = (id: string) => {
    const p = findParent(root, id);
    if (p && p.id !== root.id) select(p.id);
  };

  // —— 行内元素选中框修复 ——
  // display:inline 的元素（span/a/strong…）跨行时，CSS outline 会围着**每个行盒**各画一个框，
  // 看起来像"选中了多个"。这里为行内选中元素改画「合并外框」：
  // getBoundingClientRect 天然返回所有片段的并集矩形（fixed 定位，缩放/滚动坐标天然正确），
  // 由上层 .canvas-inline-sel 画一个完整大框；元素自身的 outline 在 CanvasNode 里停用。
  const [inlineSel, setInlineSel] = useState<Array<{ key: string; x: number; y: number; w: number; h: number }>>([]);
  useEffect(() => {
    if (selectedIds.length === 0) { setInlineSel([]); return; }
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const out: Array<{ key: string; x: number; y: number; w: number; h: number }> = [];
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

  const endMarquee = () => {
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    document.body.classList.remove('bc-marqueeing');
    if (autoScrollRef.current) { cancelAnimationFrame(autoScrollRef.current.raf); autoScrollRef.current = null; }
  };

  /** 画布滚动容器的当前滚动量 */
  const canvasScroll = () => {
    const w = canvasRef.current?.closest('.canvas-wrap') as HTMLElement | null;
    return { left: w?.scrollLeft ?? 0, top: w?.scrollTop ?? 0 };
  };

  /**
   * 把「内容坐标」的选框换算回 client 坐标。
   * 起点钉在内容上（startCx/Cy），滚动时选框跟着内容走 —— 于是可以把画布滚出去、
   * 当前不在视口里的部分也框进来（这正是"框选视口外内容"的修法）。
   * 绘制（fixed 覆盖层）与命中判定共用同一份结果。
   */
  const marqueeClientRect = (d: NonNullable<typeof dragRef.current>, cx: number, cy: number) => {
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
    const wrap = canvasRef.current?.closest('.canvas-wrap') as HTMLElement | null;
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
        const w = canvasRef.current?.closest('.canvas-wrap') as HTMLElement | null;
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

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.altKey) return; // 按住 Alt = 画布交互模式（缩放 / 移动 / 改字号），空白处不起框
    // 起点允许：条纹背景（wrap 自身）或画布空白处（canvas 自身）；
    // 元素上的按下由元素自身处理（选中/多选），不在此起框
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && t !== canvasRef.current) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    const wrap = canvasRef.current?.closest('.canvas-wrap') as HTMLElement | null;
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

  const onCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 与起框同样的空白语义：点条纹/画布空白 = 清空选区
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && t !== canvasRef.current) return;
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    select(null);
  };

  // 右键：命中文字元素 → 弹「单独调整这段文字」菜单（不按 Alt；块级容器不弹）
  const [textMenu, setTextMenu] = useState<TextMenuPayload | null>(null);
  // 中键：属性搜索框
  const [propSearch, setPropSearch] = useState<{ x: number; y: number } | null>(null);
  const onWrapContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement)?.closest?.('.canvas [data-bc-id]') as HTMLElement | null;
    if (!el) return;
    const id = el.getAttribute('data-bc-id')!;
    const node = findNode(root, id);
    if (!node || node.locked || !isTextStylable(node)) return;
    e.preventDefault();
    e.stopPropagation();
    select(id);
    setTextMenu({ mode: 'element', id, x: e.clientX, y: e.clientY });
  };
  // 就地编辑态里"选中文字再右键" → 由 CanvasNode 决定是整段（element）还是局部（range）
  const openTextMenu = (p: TextMenuPayload) => setTextMenu(p);

  // 拖动画布左/右边缘调整宽度。整条边都可抓握（和面板手柄同逻辑）。
  // 行为 = 「拖哪边、锚定另一边」：拖右沿 → 左沿固定，右沿 1:1 跟随鼠标；拖左沿同理反过来。
  // 拖拽中靠临时给 wrapper 加 padding-left + flex-start 把被锚定的边固定住，松开恢复居中。
  const [wDrag, setWDrag] = useState<{ padLeft: number; newW: number } | null>(null);
  const onResizeStart = (e: React.PointerEvent, side: 'l' | 'r') => {
    if (e.button !== 0) return;
    if (e.altKey) return; // 按住 Alt 时画布宽度手柄失效（Alt 专用于元素交互，避免抢操作）
    e.preventDefault();
    e.stopPropagation();
    const canvasEl = e.currentTarget.parentElement as HTMLElement;
    const startW = canvasEl.offsetWidth || 0;
    const anchorLeft = canvasEl.offsetLeft || 0; // 相对 wrapper 内容区左(含居中偏移+padding)，不受缩放影响
    const anchorRight = anchorLeft + startW;
    const startX = e.clientX;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      let next = side === 'r' ? startW + dx : startW - dx; // 1:1 跟手
      next = Math.max(300, Math.round(next)); // 太窄没法编辑，设下限
      const padLeft = side === 'r' ? anchorLeft : anchorRight - next; // 固定对侧边
      setWDrag({ padLeft, newW: next });
      onUserResize?.(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setWDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className={'canvas-wrap' + (altHover ? ' is-alt-mode' : '')}
      style={wDrag ? { justifyContent: 'flex-start', paddingLeft: wDrag.padLeft, paddingRight: 0, paddingBottom: 24, paddingTop: 24 } : undefined}
      title="提示：Ctrl+点击 多选；空白/条纹处拖框批量选中（可拖出画布，靠边自动滚动）；Alt+点击 选中父级；Alt+贴边拖 改大小；Alt+按住文字左右拖 改字号；Alt+按住元素中间拖 移动；Ctrl+滚轮 缩放画布"
      onPointerDown={onCanvasPointerDown}
      onPointerDownCapture={onWrapPointerDownCapture}
      onPointerMove={onWrapPointerMove}
      onPointerLeave={() => { if (!altDragRef.current) setAltHover(null); }}
      onContextMenu={onWrapContextMenu}
      onClick={onCanvasClick}
    >
      {/* 画布样式注入（与导出同源同序）：① 自动样式类 ② 快速设置 ③ 用户全局 CSS ④ 同类同色（编辑器可视化） */}
      <style className="bc-auto-css">{autoCssBlock}</style>
      {quickCssBlock && (
        <style className="bc-quick-css">{quickCssBlock}</style>
      )}
      {globalCss && globalCss.trim() !== '' && (
        <style className="bc-global-css">{globalCss}</style>
      )}
      {classColorCss && (
        <style className="bc-class-colors">{classColorCss}</style>
      )}
      {canvasResponsiveCss && (
        <style className="bc-canvas-responsive-css">{canvasResponsiveCss}</style>
      )}
      <div
        ref={canvasRef}
        className="canvas"
        style={{
          ...(canvasWidth === 'auto' ? undefined : { width: canvasWidth }),
          // 始终给 .canvas 一个 transform：让它成为 fixed 后代的"包含块"，
          // 于是画布里的 position:fixed 元素被关在画布内（相当于浏览器视口），
          // 不会跑到编辑器面板上乱盖。zoom=1 时 scale(1) 视觉上无差别。
          transform: `scale(${zoom})`,
          transformOrigin: zoomOrigin,
          // 拖拽调宽时关掉过渡（否则 1:1 跟手会变成"追不上"）
          ...(wDrag ? { transition: 'none' } : undefined)
        }}
        onWheel={onCanvasWheel}
      >
        {root.children.map((c) => (
          <CanvasNode key={c.id} node={c} depth={0} selectedIds={selectedIds} onSelect={select} onSelectParent={selectParent} onToggleSelect={toggleSelect} onTextMenu={openTextMenu} />
        ))}
        {root.children.length === 0 && (
          <div className="canvas-empty">从下方元素面板点一个元素，就能插入到画布</div>
        )}
        {/* 画布左右拖拽手柄（#6）：贴住画布左右边缘，鼠标上去变左右拉伸光标 */}
        <span className="canvas-resize-handle canvas-resize-handle-l" onPointerDown={(e) => onResizeStart(e, 'l')} title="拖动调整画布宽度" />
        <span className="canvas-resize-handle canvas-resize-handle-r" onPointerDown={(e) => onResizeStart(e, 'r')} title="拖动调整画布宽度" />
      </div>
      {selectedId && (
        <div className="canvas-hint">
          已选中 {selectedIds.length > 1 ? `${selectedIds.length} 个元素` : '元素'}
          {selectedIds.length > 1 ? '。Ctrl+点击可取消个别' : ''}。空白处拖框可批量选中（可拖出画布）
        </div>
      )}
      {/* 框选矩形：fixed 覆盖层（client 坐标），可自由延伸到画布外的条纹区 */}
      {marquee && (
        <div
          className="marquee-box"
          style={{ position: 'fixed', left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, zIndex: 90 }}
        />
      )}
      {/* 行内选中元素的合并外框（见上方注释；fixed 定位 + client 坐标） */}
      {inlineSel.map((r) => (
        <div
          key={r.key}
          className="canvas-inline-sel"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        />
      ))}
      {/* Alt 悬停高亮：按住 Alt 后，鼠标下的元素亮出可交互边框 + 命中边提示。
          v0.4.4：拖拽过程中也持续显示（rAF 量真实 rect），橙色边界 1:1 实时跟随 —— 以前拖动时框会消失。 */}
      {altHover && (
        <div
          className={'bc-alt-box mode-' + altHover.mode + (altDragRef.current ? ' is-live' : '')}
          style={{ left: altHover.rect.x, top: altHover.rect.y, width: altHover.rect.w, height: altHover.rect.h }}
        >
          {altHover.edge && <span className={'bc-alt-edge e-' + altHover.edge} />}
        </div>
      )}
      {/* Alt 拖拽实时数值气泡 */}
      {altBadge && (
        <div className="bc-alt-badge" style={{ left: altBadge.x, top: altBadge.y }}>{altBadge.text}</div>
      )}
      {/* 撞到"墙"时的橙色闪烁提示（说明是限制，不是 BUG） */}
      {wallFlash && (
        <div
          className="bc-wall-flash"
          style={{ left: wallFlash.x, top: wallFlash.y, width: wallFlash.w, height: wallFlash.h }}
        />
      )}
      {/* Alt 拖动时常显的"可达边界"提示线（内边距 / 外边距 / 兄弟元素边） */}
      {wallHints.map((b, i) => (
        <div key={'wh' + i} className="bc-wall-hint" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />
      ))}
      {/* 拖到墙外 → 改父子关系：鼠标下的块级元素高亮（松开即放入） */}
      {dropTarget && (
        <div
          className="bc-drop-into"
          style={{ left: dropTarget.rect.x, top: dropTarget.rect.y, width: dropTarget.rect.w, height: dropTarget.rect.h }}
        >
          <span className="bc-drop-into-tag">放入此元素</span>
        </div>
      )}
      {/* Alt 移动时的吸附对齐参考线 */}
      {guides && guides.box && guides.x !== null && (
        <div className="bc-align-guide bc-align-v" style={{ left: guides.x, top: guides.box.top, height: guides.box.bottom - guides.box.top }} />
      )}
      {guides && guides.box && guides.y !== null && (
        <div className="bc-align-guide bc-align-h" style={{ top: guides.y, left: guides.box.left, width: guides.box.right - guides.box.left }} />
      )}
      {/* 右键文字样式菜单（Portal 到 body） */}
      {textMenu && <CanvasTextMenu payload={textMenu} onClose={() => setTextMenu(null)} />}
      {/* 中键属性搜索（Portal 到 body） */}
      {propSearch && <CanvasPropSearch x={propSearch.x} y={propSearch.y} onClose={() => setPropSearch(null)} />}
    </div>
  );
}

const CanvasNode = React.memo(function CanvasNode(props: {
  node: SceneElement;
  depth: number;
  selectedIds: string[];
  onSelect: (id: string | null) => void;
  onSelectParent: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onTextMenu: (p: TextMenuPayload) => void;
}) {
  const { node, selectedIds, onSelect, onSelectParent, onToggleSelect, onTextMenu } = props;

  // hidden：画布不渲染（导出也不渲染，见 exporter）
  if (node.hidden) return null;

  const isSelected = selectedIds.includes(node.id);
  const Tag = node.type as keyof React.JSX.IntrinsicElements;
  // 4-C/4-F：选择器 = 类名优先 → ID → 行内样式（与导出同一计算 → DOM 与规则文本一致）
  const selInfo = useMemo(() => selectorForNode(node), [node.style, node.attrs]);

  // 画布双击就地编辑文案（v0.4.4d 重做：多行 textarea + 自动撑高 + 点别处即保存）
  const [editingText, setEditingText] = useState(false);
  const [inlineDraft, setInlineDraft] = useState(node.text ?? '');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editingRef = useRef(false);
  editingRef.current = editingText;
  // 「显示 <br>」：与属性面板共用同一份开关（见 lib/showBr.ts）
  const [showBr] = useShowBr();

  // 选中态测量：display:inline 的元素跨行时 outline 会按行盒拆成多个框。
  // 行内选中元素不再自画 outline（由 Canvas 的 .canvas-inline-sel 合并外框负责）。
  // 用 data-bc-id 查 DOM（不用 ref——动态 Tag 的 ref 联合类型 TS 处理不了）。
  const [isInlineFrag, setIsInlineFrag] = useState(false);
  useEffect(() => {
    if (!isSelected) { setIsInlineFrag(false); return; }
    let alive = true;
    const check = () => {
      if (!alive) return;
      try {
        const el = document.querySelector(`.canvas [data-bc-id="${CSS.escape(node.id)}"]`);
        if (!el) return;
        setIsInlineFrag(getComputedStyle(el).display === 'inline');
      } catch { /* ignore */ }
    };
    check();
    const raf = requestAnimationFrame(check); // 自动类规则落地后复查
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [isSelected, node.id, node.style, node.attrs, node.type]);

  useEffect(() => {
    if (!editingText) setInlineDraft(node.text ?? '');
  }, [node.text, editingText]);

  const autoGrow = (ta: HTMLTextAreaElement) => {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 24) + 'px';
  };

  useEffect(() => {
    if (editingText && inputRef.current) {
      const ta = inputRef.current;
      ta.focus();
      ta.select();
      autoGrow(ta);
    }
  }, [editingText]);

  // 「点别的地方就保存」双保险：
  //  ① 画布内的按下 → Canvas 派发 bc:commit-inline（见 onWrapPointerDownCapture）；
  //  ② 画布外（属性面板等）的按下 → 全局 mousedown 兜底。
  // 为什么不能用 onBlur —— 画布的 pointerdown 会 preventDefault()，焦点根本不会转移 → 不触发 blur。
  useEffect(() => {
    if (!editingText) return;
    const onCommitEvt = () => commitInlineText();
    const onDocDown = (ev: MouseEvent) => {
      const ta = inputRef.current;
      if (ta && (ev.target === ta || ta.contains(ev.target as Node))) return;
      commitInlineText();
    };
    window.addEventListener('bc:commit-inline', onCommitEvt);
    document.addEventListener('mousedown', onDocDown, true);
    return () => {
      window.removeEventListener('bc:commit-inline', onCommitEvt);
      document.removeEventListener('mousedown', onDocDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingText]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (node.locked) return;
    if (TEXT_TAGS.has(node.type) || node.text !== undefined) {
      e.stopPropagation();
      setInlineDraft(node.text ?? '');
      setEditingText(true);
    }
  };

  const commitInlineText = () => {
    if (!editingRef.current) return;
    // 直接读 DOM 里的当前值（闭包里的 inlineDraft 可能是旧值）
    const v = inputRef.current ? inputRef.current.value : inlineDraft;
    editingRef.current = false;
    setEditingText(false);
    if (v !== (node.text ?? '')) useScene.getState().setText(node.id, v);
  };

  /** 把纯文本按换行渲染成「文本 + <br>」 */
  const withBreaks = (s: string, keyBase: string): React.ReactNode[] => {
    const parts = s.split('\n');
    const out: React.ReactNode[] = [];
    parts.forEach((p, i) => {
      if (p) out.push(<React.Fragment key={`${keyBase}t${i}`}>{p}</React.Fragment>);
      if (i < parts.length - 1) out.push(<br key={`${keyBase}b${i}`} />);
    });
    return out;
  };

  /** 渲染文字内容：有富文本片段就逐段渲染（带样式的包成内联 span），否则渲染纯文本 */
  const renderTextContent = () => {
    if (node.runs && node.runs.length > 0) {
      return node.runs.map((r, i) => {
        const css = r.style ? simplifyStyle(r.style) : null;
        const inner = withBreaks(r.text, 'r' + i);
        return css ? <span key={i} style={css as React.CSSProperties}>{inner}</span> : <React.Fragment key={i}>{inner}</React.Fragment>;
      });
    }
    return node.text ? withBreaks(node.text, 'p') : null;
  };

  /** 叠加层内容：透明文字（用来定位下划线/删除线）+（开关开启时）淡灰 <br> 标记 */
  const brOverlayNodes = (() => {
    const parts = inlineDraft.split('\n');
    const out: React.ReactNode[] = [];
    parts.forEach((p, i) => {
      if (p) out.push(<span key={`t${i}`}>{p}</span>);
      if (i < parts.length - 1) {
        if (showBr) out.push(<span key={`m${i}`} className="bc-br-mark">{'<br>'}</span>);
        out.push(<br key={`b${i}`} />);
      }
    });
    return out;
  })();
  // 有类名/ID 的元素：样式由自动类承担。无类名无 ID 的元素：行内样式与导出一致。
  // 内联里还混着编辑器交互装饰：选中框、空容器可见性兜底 —— 全部不导出。
  // ⚠ 光标（pointer / Alt 交互的 resize 等）**不再写内联** —— 内联 cursor 会盖过
  //   任何样式表规则，导致 Alt 悬停时无法切换成 resize/move 光标。改由 CSS 按
  //   data-bc-locked / data-bc-alt 属性统一控制（见 23-v044d-ui.css）。
  const baseStyle: React.CSSProperties = {};
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);
  // 无类名无 ID：样式照抄导出的 style 属性值（同一文本 → 画布 = 导出）
  if (selInfo.inlineCss) {
    Object.assign(baseStyle, cssTextToObject(selInfo.inlineCss));
    if (activeBreakpoint !== 'desktop') {
      const eff = getEffectiveStyle(node, activeBreakpoint);
      Object.assign(baseStyle, simplifyStyle(eff));
    }
  }
  // flex 横排容器里，空的无宽子容器会被压缩到 0 宽 → 完全不可见不可点（"插进去看不到"）。
  // 编辑器专用兜底：无显式 width 的容器/hr 补 min-width 60px（不进 node.style、不导出）；
  // 用户设了 width（含百分比）则尊重用户值
  if ((CONTAINER_TAGS.has(node.type) || node.type === 'hr') && !node.style.width) {
    baseStyle.minWidth = '60px';
  }
  if (isSelected && !isInlineFrag) {
    // 选中高亮（v0.4.4）：外框改由 CSS 按 data-bc-sel 画（两种可切换样式，见 25-v044-storage-ui.css）；
    // 这里只保留"内圈白细线"——**追加**在用户自己的 box-shadow 之前，绝不覆盖用户的阴影。
    // （旧实现直接 baseStyle.boxShadow = 'inset ...' —— 内联样式优先级高于类名规则，
    //   结果元素一被选中，它自己的盒子阴影就"消失"了。）
    const ownShadow = (
      (baseStyle.boxShadow as string | undefined)
      ?? ((getEffectiveStyle(node, activeBreakpoint) as Record<string, string | undefined>).boxShadow)
      ?? ''
    ).trim();
    baseStyle.boxShadow = ownShadow
      ? `inset 0 0 0 1.5px #ffffff, ${ownShadow}`
      : 'inset 0 0 0 1.5px #ffffff';
  }

  /** 就地编辑时的"文字观感"：把元素生效的排版样式套到编辑框（含叠加层）上，
   *  让编辑框里的预览与画布一致 —— 字号 / 粗细 / 斜体 / 颜色直接生效；
   *  下划线 / 删除线由叠加层用"透明文字 + 显式 decoration-color"画出（textarea 自身不支持）。 */
  const effForEdit = getEffectiveStyle(node, activeBreakpoint) as Record<string, string | undefined>;
  const pick = (k: string): string => String((node.style as Record<string, string | undefined>)[k] ?? effForEdit[k] ?? '');
  const editTextStyle: React.CSSProperties = {
    fontSize: pick('fontSize') || undefined,
    fontWeight: pick('fontWeight') || undefined,
    fontStyle: pick('fontStyle') || undefined,
    color: pick('color') || undefined,
    lineHeight: pick('lineHeight') || undefined,
    fontFamily: pick('fontFamily') || undefined,
    letterSpacing: pick('letterSpacing') || undefined,
    textAlign: (pick('textAlign') || undefined) as React.CSSProperties['textAlign']
  };
  const editDeco = pick('textDecoration');

  const commonProps = {
    'data-bc-id': node.id,
    'data-bc-locked': node.locked ? '1' : '0',
    // 选中高亮（v0.4.4）：用 data 属性 + CSS 画，不再写内联 outline ——
    // 两种可切换样式（橙色光晕闪烁 / 蓝色细线）都在样式表里，body.bc-sel-plain 一键切换
    'data-bc-sel': isSelected && !isInlineFrag ? '1' : undefined,
    // 类名优先原则：用户类名（或兜底 hash 类）真实挂到 DOM；用 ID 做选择器时挂 id 属性 —— 与导出一致
    className: selInfo.classAttr || undefined,
    id: selInfo.idAttr || undefined,
    // 同类同色（编辑器可视化）：优先类名，其次关系选择器作为分组标记，配合 bc-class-colors 注入描边色
    'data-bc-cg': (node.attrs?.className ?? '').trim().split(/\s+/)[0] || (node.attrs?.relSelector ?? '').trim() || undefined,
    // 表格单元格跨度 / 表头 scope —— 与导出保持一致的所见即所得
    ...(node.type === 'th' || node.type === 'td'
      ? {
          colSpan: Math.max(1, Number(node.attrs?.colspan) || 1),
          rowSpan: Math.max(1, Number(node.attrs?.rowspan) || 1)
        }
      : {}),
    ...(node.type === 'th' && node.attrs?.scope ? { scope: node.attrs.scope } : {})
  } as const;

  // 统一点击逻辑：Ctrl=多选切换；Alt=选中父级；否则选中自己；locked 不可选
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.locked) return;
    if (e.altKey) onSelectParent(node.id);
    else if (e.ctrlKey || e.metaKey) onToggleSelect(node.id);
    else onSelect(node.id);
  };

  // 自闭合：无 children、无 text
  if (SELF_CLOSING_TAGS.has(node.type)) {
    const selfProps: Record<string, string> = {};
    if (node.type === 'img') {
      selfProps.alt = (node.attrs?.alt ?? '') || node.text || '';
      const rawSrc = node.attrs?.src;
      if (rawSrc) selfProps.src = toRenderableSrc(rawSrc);
    } else if (node.type === 'input') {
      selfProps.type = node.attrs?.typeAttr || 'text';
      if (node.attrs?.placeholder) selfProps.placeholder = node.attrs.placeholder;
    }
    return (
      <Tag
        {...selfProps}
        style={baseStyle}
        onClick={handleClick}
        {...commonProps}
      />
    );
  }

  // 文本独占（textarea）：有开闭标签但不允许 ReactNode 子元素
  if (TEXT_ONLY_TAGS.has(node.type)) {
    const taProps: Record<string, string> = {};
    if (node.attrs?.placeholder) taProps.placeholder = node.attrs.placeholder;
    return (
      <Tag
        style={baseStyle}
        {...taProps}
        value={node.text ?? ''}
        readOnly
        onChange={() => {/* 画布上不可编辑 */}}
        onClick={handleClick}
        {...commonProps}
      />
    );
  }

  // 容器/文本型：与导出器一致——文字和子元素可以同时存在，先文字后子元素
  return (
    <Tag
      style={baseStyle}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      {...commonProps}
    >
      {/* 文本直接作为文本节点；双击进入就地编辑（多行 textarea，点别处 / Esc 都保存） */}
      {editingText ? (
        <span
          className="bc-inline-edit-wrap"
          style={editTextStyle}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <textarea
            ref={inputRef}
            className="canvas-inline-text-input"
            value={inlineDraft}
            rows={1}
            spellCheck={false}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => { setInlineDraft(e.target.value); autoGrow(e.target); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              // Esc 也保存（用户要求）；换行交给浏览器默认（自动生成 <br>）
              if (e.key === 'Escape') { e.preventDefault(); commitInlineText(); }
            }}
            onContextMenu={(e) => {
              const ta = e.currentTarget;
              const s = ta.selectionStart;
              const en = ta.selectionEnd;
              if (s === en) return;
              e.preventDefault();
              e.stopPropagation();
              // 规则统一：选中"整段文本" → 走整段 CSS（与右侧面板同一份数据）；
              //           只选了一部分 → 走内联 HTML 样式（整段 CSS 覆盖不了它）
              if (s === 0 && en === ta.value.length) {
                onTextMenu({ mode: 'element', id: node.id, x: e.clientX, y: e.clientY });
              } else {
                onTextMenu({ mode: 'range', id: node.id, x: e.clientX, y: e.clientY, start: s, end: en, text: ta.value });
              }
            }}
          />
          {/* 叠加层：文字透明，只负责画「下划线 / 删除线」和（开关开启时的）淡灰 <br> 标记。
              textarea 本身不渲染 text-decoration，所以用这一层补上，位置与输入文字逐字对齐。 */}
          <div
            className="bc-inline-br-overlay"
            aria-hidden="true"
            style={{ textDecoration: editDeco || undefined, textDecorationColor: editTextStyle.color as string | undefined }}
          >{brOverlayNodes}</div>
        </span>
      ) : (
        renderTextContent()
      )}
      {node.children.length > 0 &&
        node.children.map((c) => (
          <CanvasNode key={c.id} node={c} depth={props.depth + 1} selectedIds={selectedIds} onSelect={onSelect} onSelectParent={onSelectParent} onToggleSelect={onToggleSelect} onTextMenu={onTextMenu} />
        ))}
      {node.locked && <span className="lock-badge">🔒</span>}
    </Tag>
  );
});

// 图片 src 转换：保证画布实时预览任何相对路径、绝对路径、网络 URL 和 base64
function toRenderableSrc(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  // 网络链接 / Base64 / Blob
  if (/^(https?:|data:|blob:)/i.test(t)) return t;
  // 已经带有协议头的路径
  if (/^[a-z0-9+.-]+:\/\//i.test(t)) {
    if (t.startsWith('file://')) {
      const pathPart = t.replace(/^file:\/\/\/?/i, '');
      return 'bc-img://file/' + encodeURIComponent(pathPart);
    }
    return t;
  }
  // Windows 盘符绝对路径 (C:\... 或 C:/...)
  if (/^[a-zA-Z]:[\\/]/.test(t) || t.startsWith('\\\\')) {
    return 'bc-img://file/' + encodeURIComponent(t);
  }
  // 相对路径（如 ./images/pic.png、images/pic.png、../pic.jpg 或 /pic.png）
  return 'bc-img://file/' + encodeURIComponent(t);
}
