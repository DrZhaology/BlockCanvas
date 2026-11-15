import { useRef, useState, useMemo, useEffect } from 'react';
import { useScene, findNode, findParent, getEffectiveStyle } from '@store/sceneStore';
import type { SceneElement } from '@lib/types';
import { createStyleClassSet, collectStyleClasses, buildStyleBlock, quickCssToCss } from '@lib/styleClass';
import { classColor } from '@lib/classColor';
import { downscaleBigImages } from '@lib/imgDownscale';
import { useShowBr } from '@lib/showBr';
import { CanvasTextMenu, isTextStylable, type TextMenuPayload } from './CanvasTextMenu';
import { CanvasPropSearch } from './CanvasPropSearch';
import { CanvasNode } from './canvas/CanvasNode';
import { AltOverlays } from './canvas/AltOverlays';
import { useAltDrag } from './canvas/useAltDrag';
import { useMarquee } from './canvas/useMarquee';
import { useStickyMarks } from './canvas/sticky';
import { useFixedFrame } from './canvas/useFixedFrame';
import { FixedLayerContext } from './canvas/fixedLayer';
import { useEnterAnim } from './canvas/useEnterAnim';
import { useInlineSel } from './canvas/useInlineSel';

// BlockCanvas · 画布（组装层）
//
// 这一层只做四件事：① 注入样式（与导出同源同序）② 递归渲染 scene graph
// ③ 挂事件（Alt 交互 / 框选 / 滚轮）④ 画覆盖层。
// 具体机制分别落在：
//   canvas/CanvasNode.tsx   单节点渲染（含 img/video/audio 分支）
//   canvas/useAltDrag.ts    Alt 拖动 / 缩放 / 改字号 + Alt/Ctrl 滚轮
//   canvas/useMarquee.ts    拖框多选（含自动滚动、内容坐标系）
//   canvas/geometry.ts      包含块 / 热区 / 盒模型读数（纯函数）
//   canvas/walls.ts         墙与吸附计算（纯函数）
//
// 历史沿革（结论都还成立，别推翻）：
//   · 阶段3：样式走"类"体系，画布注入与导出同一份 <style> → 画布 = 浏览器 = 导出
//   · 阶段4：选择器类名优先 → ID → 行内样式；DOM 同步挂 id/class 与导出一致
//   · 阶段4：hidden 不渲染、locked 显示锁标记且不可点选、自闭合单独渲染
//   · 阶段4：Alt+点击 = 选中父级；Ctrl+点击 = 加/减选中；空白拖框 = 框选
//   · v0.4.5：fixed 的包含块是 .canvas（模拟浏览器视口）；Alt 手势全部 ÷ zoom

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
  const bodyExtra = useScene((s) => s.scene.bodyExtra);
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
    const base = quickCssToCss(quickCss, bodyExtra)
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
  }, [quickCss, bodyExtra]);
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
  const selectedIds = useScene((s) => s.scene.selectedIds);
  const select = useScene((s) => s.selectElement);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);
  // v0.4.6（R6-16）：基准视口高度 —— 画布最小高度 + fixed 的空气墙 + 首屏线位置
  const viewportHeight = useScene((s) => s.scene.viewportHeight) ?? 900;

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
  const canvasRef = useRef<HTMLDivElement>(null);
  /**
   * v0.4.6 重做 fixed：画布里挂一层「浏览器视口层」。
   *
   * 这一层的位置和尺寸**就等于红框**（由 lib/fixedViewport.ts 写 CSS 变量驱动），
   * fixed 节点通过 portal 渲染进去，于是它们的 left/top/right/bottom 相对**视口**解析，
   * 而不是相对整张画布 —— `bottom: 0` 才真的是"贴视口底"。
   *
   * 用真实 DOM 节点（而不是 <div ref> + state）是为了首帧就能 portal，
   * 否则 fixed 元素会晚一帧出现，"插入动画"会先闪一下。
   */
  const fixedLayerEl = useMemo(() => document.createElement('div'), []);
  useEffect(() => {
    const host = canvasRef.current;
    if (!host) return;
    fixedLayerEl.className = 'canvas-fixed-layer';
    host.appendChild(fixedLayerEl);
    return () => { fixedLayerEl.remove(); };
  }, [fixedLayerEl]);
  // v0.4.5（性能）：画布图片按显示尺寸降采样。
  // 4K 图按原始分辨率解码一张≈33MB，插 50 张就是 1.6GB —— 这是内存飙升的主因。
  // 这里在场景/尺寸变化后扫一遍，把"原图远大于显示尺寸"的图换成小副本（导出仍用原图）。
  useEffect(() => {
    const id = window.setTimeout(() => {
      try { downscaleBigImages(canvasRef.current); } catch { /* 优化失败不影响渲染 */ }
    }, 260);
    return () => window.clearTimeout(id);
  }, [root, canvasWidth, zoom, activeBreakpoint]);

  // 画布内「浏览器视口」（v0.4.6）：选中 fixed 元素时画红框 + 把 fixed 元素钉在视口上。
  // 几何与语义在 lib/fixedViewport.ts，React 接线在 canvas/useFixedFrame.ts。
  const selectedIdForFrame = useScene((s) => s.scene.selectedId);
  const selectedPos = (() => {
    if (!selectedIdForFrame) return '';
    const n = findNode(root, selectedIdForFrame);
    if (!n) return '';
    return (getEffectiveStyle(n, activeBreakpoint) as Record<string, string | undefined>).position ?? '';
  })();
  const fixedFrame = useFixedFrame({
    canvasRef,
    show: selectedPos === 'fixed',
    zoom,
    canvasWidth
  });
  // 中键属性搜索 / 右键文字菜单 的浮层状态
  const [textMenu, setTextMenu] = useState<TextMenuPayload | null>(null);
  const [propSearch, setPropSearch] = useState<{ x: number; y: number } | null>(null);

  // Alt 交互（拖拽 / 缩放 / 改字号 / Alt·Ctrl 滚轮）
  const alt = useAltDrag({
    zoom,
    canvasRef,
    onZoomChange: (next) => { onZoomChange?.(() => next); },
    onMiddlePress: (id, x, y) => { select(id); setPropSearch({ x, y }); }
  });

  // 框选
  const mq = useMarquee(canvasRef);

  // 元素进场动画（v0.4.6）：新增节点打标 → CSS 播，见 canvas/useEnterAnim.ts
  useEnterAnim(root, canvasRef);

  /**
   * v0.4.6（R6-17）：sticky 的元素标记。
   *
   * sticky 的效果只在"页面滚动"时可见，而画布本身不滚 —— 编辑器里它和 static 长得一样。
   * 这里给它挂 data-bc-sticky（armed / idle）+ 角标文案，让"会不会吸附、以什么为吸附线"
   * 一眼可见。idle（没写 top/bottom）= 永远不会吸附，是最常见的错，必须显性提示。
   */
  useStickyMarks(root, [root, selectedIds, zoom, canvasWidth, activeBreakpoint]);

  /**
   * 行内选中元素的「合并外框」测量。
   *
   * display:inline 的元素（span/a/strong…）跨行时，CSS outline 会围着**每个行盒**各画一个框，
   * 看起来像"选中了多个"。这里改成画一个并集大框（getBoundingClientRect 天然返回并集）。
   */
  // 行内选中元素的合并外框（实现见 canvas/useInlineSel.ts）
  const inlineSel = useInlineSel(selectedIds, { root, zoom, canvasWidth });

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
        alt.clearAltState();
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
      alt.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectParent = (id: string) => {
    const p = findParent(root, id);
    if (p && p.id !== root.id) select(p.id);
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 与起框同样的空白语义：点条纹/画布空白 = 清空选区
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && t !== canvasRef.current) return;
    if (mq.suppressClickRef.current) { mq.suppressClickRef.current = false; return; }
    select(null);
  };

  // 右键：命中文字元素 → 弹「单独调整这段文字」菜单（不按 Alt；块级容器不弹）
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

  // 缩放锚点：目前固定左上（Alt 滚轮已让位给"精准微调"，不再以光标为锚）
  const [zoomOrigin] = useState('left top');

  return (
    <div
      className={'canvas-wrap' + (alt.altHover ? ' is-alt-mode' : '')}
      style={wDrag ? { justifyContent: 'flex-start', paddingLeft: wDrag.padLeft, paddingRight: 0, paddingBottom: 24, paddingTop: 24 } : undefined}
      title="提示：Ctrl+点击 多选；空白/条纹处拖框批量选中（可拖出画布，靠边自动滚动）；Alt+点击 选中父级；Alt+贴边拖 改大小；Alt+按住文字左右拖 改字号；Alt+按住元素中间拖 移动；Ctrl+滚轮 缩放画布"
      onPointerDown={mq.onCanvasPointerDown}
      onPointerDownCapture={alt.onWrapPointerDownCapture}
      onPointerMove={alt.onWrapPointerMove}
      onPointerLeave={() => { if (!alt.altDragRef.current) { alt.clearAltState(); } }}
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
          //
          // v0.4.6 第 43 批：缩放走 CSS 变量（--bc-canvas-k / -dx / -dy）。
          // 兜底值 = React 的 zoom（平时行为不变）；触摸双指缩放期间由手势层直接写变量，
          // 一帧都不用 React 渲染 → 跟手不卡（以前每帧 setState → 整棵画布树重渲染 → 僵硬）。
          transform: `translate(var(--bc-canvas-dx, 0px), var(--bc-canvas-dy, 0px)) scale(var(--bc-canvas-k, ${zoom}))`,
          transformOrigin: zoomOrigin,
          // v0.4.6（R6-16）：画布至少撑到基准视口高度 ——
          // 短页面下 fixed 的 bottom:0 才有落点，也才看得见"整屏大概多长"。
          // CSS 里还有 min-height: 600px 兜底（viewportHeight 通常 900 会覆盖它）。
          minHeight: viewportHeight,
          // 拖拽调宽时关掉过渡（否则 1:1 跟手会变成"追不上"）
          ...(wDrag ? { transition: 'none' } : undefined),
          // Alt 拖动时临时加长画布（松手归零）
          ...(alt.altPad ? { paddingBottom: alt.altPad } : undefined)
        }}
        onWheel={alt.onCanvasWheel}
      >
        <FixedLayerContext.Provider value={fixedLayerEl}>
          {root.children.map((c) => (
            <CanvasNode key={c.id} node={c} depth={0} selectedIds={selectedIds} onSelect={select} onSelectParent={selectParent} onToggleSelect={toggleSelect} onTextMenu={openTextMenu} />
          ))}
        </FixedLayerContext.Provider>
        {root.children.length === 0 && (
          <div className="canvas-empty">从下方元素面板点一个元素，就能插入到画布</div>
        )}
        {/* 画布左右拖拽手柄：贴住画布左右边缘，鼠标上去变左右拉伸光标 */}
        <span className="canvas-resize-handle canvas-resize-handle-l" onPointerDown={(e) => onResizeStart(e, 'l')} title="拖动调整画布宽度" />
        <span className="canvas-resize-handle canvas-resize-handle-r" onPointerDown={(e) => onResizeStart(e, 'r')} title="拖动调整画布宽度" />
      </div>
      {/* 画布内「浏览器视口」（v0.4.6）：选中 fixed 元素时显示，红色 1px 框。
          它就是 fixed 元素的参照面 —— 上下跟着工具栏/元素面板的高度走，左右贴着画布。 */}
      {fixedFrame && (
        <div
          className="canvas-fixed-frame"
          style={{
            left: fixedFrame.left,
            top: fixedFrame.top,
            width: Math.max(0, fixedFrame.right - fixedFrame.left),
            height: Math.max(0, fixedFrame.bottom - fixedFrame.top)
          }}
          title="浏览器视口：fixed 元素只在框内活动，导出后也以这块区域为参照"
        >
          <span>浏览器视口</span>
        </div>
      )}
      {/* 框选矩形：fixed 覆盖层（client 坐标），可自由延伸到画布外的条纹区 */}
      {mq.marquee && (
        <div
          className="marquee-box"
          style={{ position: 'fixed', left: mq.marquee.x, top: mq.marquee.y, width: mq.marquee.w, height: mq.marquee.h, zIndex: 90 }}
        />
      )}
      {/* 行内选中元素的合并外框（fixed 定位 + client 坐标） */}
      {inlineSel.map((r) => (
        <div
          key={r.key}
          className="canvas-inline-sel"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        />
      ))}
      {/* Alt 系列覆盖层（高亮框 / 盒模型 / 数值气泡 / 墙提示 / 吸附线 / 放入目标） */}
      <AltOverlays
        api={{
          altHover: alt.altHover,
          dragging: !!alt.altDragRef.current,
          altBadge: alt.altBadge,
          wallFlash: alt.wallFlash,
          wallHints: alt.wallHints,
          dropTarget: alt.dropTarget,
          guides: alt.guides,
          boxModel: alt.boxModel
        }}
      />
      {/* 右键文字样式菜单（Portal 到 body） */}
      {textMenu && <CanvasTextMenu payload={textMenu} onClose={() => setTextMenu(null)} />}
      {/* 中键属性搜索（Portal 到 body） */}
      {propSearch && <CanvasPropSearch x={propSearch.x} y={propSearch.y} onClose={() => setPropSearch(null)} />}
    </div>
  );
}

// useShowBr 在 CanvasNode 里用；这里 re-export 一下保持旧的导入路径可用（历史探针用过）
export { useShowBr };
