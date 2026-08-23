import React, { useRef, useState, useMemo } from 'react';
import { useScene, findParent } from '@store/sceneStore';
import { SELF_CLOSING_TAGS, TEXT_ONLY_TAGS, CONTAINER_TAGS } from '@lib/types';
import type { SceneElement } from '@lib/types';
import { selectorForNode, collectStyleClasses, buildStyleBlock, createStyleClassSet, quickCssToCss, cssTextToObject } from '@lib/styleClass';

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
    // 快速设置的 body/a 规则在导出 HTML 里作用于页面；画布注入时把它指向画布自身，
    // 避免污染编辑器窗口的 body（所见即所得语义不变）
    return quickCssToCss(quickCss).replace('body {', '.canvas {').replace('a {', '.canvas a {');
  }, [quickCss]);
  const selectedId = useScene((s) => s.scene.selectedId);
  const selectedIds = useScene((s) => s.scene.selectedIds);
  const select = useScene((s) => s.selectElement);
  const toggleSelect = useScene((s) => s.toggleSelect);
  const selectMany = useScene((s) => s.selectMany);

  // 拖框选中状态
  const dragRef = useRef<{ startX: number; startY: number; active: boolean; ctrl: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // 拖框结束后会跟着一个 click（冒泡到 .canvas）——用它吞掉，避免框选完又清空选区
  const suppressClickRef = useRef(false);

  const onCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    onZoomChange?.((z) => {
      const next = e.deltaY < 0 ? z * 1.1 : z / 1.1;
      return Math.min(2, Math.max(0.5, Math.round(next * 10) / 10));
    });
  };

  const selectParent = (id: string) => {
    const p = findParent(root, id);
    if (p && p.id !== root.id) select(p.id);
  };

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // 只从画布空白处（背景）起框；元素上的按下由元素自身处理（选中/多选）
    if (e.target !== e.currentTarget) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, active: false, ctrl: e.ctrlKey || e.metaKey };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || Number.isNaN(d.startX)) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    // 移动超过 4px 才算"拖框"（区分普通点击清空选区）
    if (!d.active && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    d.active = true;
    const rect = e.currentTarget.getBoundingClientRect();
    setMarquee({
      left: Math.min(dx, 0) + (d.startX - rect.left),
      top: Math.min(dy, 0) + (d.startY - rect.top),
      width: Math.abs(dx),
      height: Math.abs(dy)
    });
  };

  const onCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || Number.isNaN(d.startX)) return;
    dragRef.current = null;
    setMarquee(null);
    if (!d.active) return; // 没拖成框 = 普通点击，交给 onClick 清空选区
    suppressClickRef.current = true;
    // 100% 在框内才算选中（与 Windows 桌面框选一致，只框到一半不选）
    const minX = Math.min(d.startX, e.clientX);
    const minY = Math.min(d.startY, e.clientY);
    const maxX = Math.max(d.startX, e.clientX);
    const maxY = Math.max(d.startY, e.clientY);
    const ids: string[] = [];
    for (const el of e.currentTarget.querySelectorAll('[data-bc-id]')) {
      if (el.getAttribute('data-bc-locked') === '1') continue;
      const r = el.getBoundingClientRect();
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

  const onCanvasClick = () => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    select(null);
  };

  // 拖动画布左/右边缘调整宽度。整条边都可抓握（和面板手柄同逻辑）。
  // 行为 = 「拖哪边、锚定另一边」：拖右沿 → 左沿固定，右沿 1:1 跟随鼠标；拖左沿同理反过来。
  // 拖拽中靠临时给 wrapper 加 padding-left + flex-start 把被锚定的边固定住，松开恢复居中。
  const [wDrag, setWDrag] = useState<{ padLeft: number; newW: number } | null>(null);
  const onResizeStart = (e: React.PointerEvent, side: 'l' | 'r') => {
    if (e.button !== 0) return;
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
      className="canvas-wrap"
      style={wDrag ? { justifyContent: 'flex-start', paddingLeft: wDrag.padLeft, paddingRight: 0, paddingBottom: 24, paddingTop: 24 } : undefined}
      title="提示：Ctrl+点击 多选；空白处拖框批量选中；Alt+点击 选中父级；Ctrl+滚轮 缩放画布"
    >
      {/* 画布样式注入（与导出同源同序）：① 自动样式类 ② 快速设置 ③ 用户全局 CSS */}
      <style className="bc-auto-css">{autoCssBlock}</style>
      {quickCssBlock && (
        <style className="bc-quick-css">{quickCssBlock}</style>
      )}
      {globalCss && globalCss.trim() !== '' && (
        <style className="bc-global-css">{globalCss}</style>
      )}
      <div
        className="canvas"
        style={{
          ...(canvasWidth === 'auto' ? undefined : { width: canvasWidth }),
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: 'left top'
        }}
        onClick={onCanvasClick}
        onWheel={onCanvasWheel}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={() => { dragRef.current = null; setMarquee(null); }}
      >
        {root.children.map((c) => (
          <CanvasNode key={c.id} node={c} depth={0} selectedIds={selectedIds} onSelect={select} onSelectParent={selectParent} onToggleSelect={toggleSelect} />
        ))}
        {root.children.length === 0 && (
          <div className="canvas-empty">从左侧点击元素按钮插入到画布</div>
        )}
        {marquee && (
          <div
            className="marquee-box"
            style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
          />
        )}
        {/* 画布左右拖拽手柄（#6）：贴住画布左右边缘，鼠标上去变左右拉伸光标 */}
        <span className="canvas-resize-handle canvas-resize-handle-l" onPointerDown={(e) => onResizeStart(e, 'l')} title="拖动调整画布宽度" />
        <span className="canvas-resize-handle canvas-resize-handle-r" onPointerDown={(e) => onResizeStart(e, 'r')} title="拖动调整画布宽度" />
      </div>
      {selectedId && (
        <div className="canvas-hint">
          已选中 {selectedIds.length > 1 ? `${selectedIds.length} 个元素` : '元素'}
          {selectedIds.length > 1 ? '。Ctrl+点击可取消个别' : ''}。空白处拖框可批量选中
        </div>
      )}
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
}) {
  const { node, selectedIds, onSelect, onSelectParent, onToggleSelect } = props;

  // hidden：画布不渲染（导出也不渲染，见 exporter）
  if (node.hidden) return null;

  const isSelected = selectedIds.includes(node.id);
  const Tag = node.type as keyof React.JSX.IntrinsicElements;
  // 4-C/4-F：选择器 = 类名优先 → ID → 行内样式（与导出同一计算 → DOM 与规则文本一致）
  const selInfo = useMemo(() => selectorForNode(node), [node.style, node.attrs]);
  // 有类名/ID 的元素：样式由自动类承担。无类名无 ID 的元素：行内样式与导出一致。
  // 内联里还混着编辑器交互装饰：光标、选中框、空容器可见性兜底 —— 全部不导出。
  const baseStyle: React.CSSProperties = {
    cursor: node.locked ? 'default' : 'pointer'
  };
  // 无类名无 ID：样式照抄导出的 style 属性值（同一文本 → 画布 = 导出）
  if (selInfo.inlineCss) {
    Object.assign(baseStyle, cssTextToObject(selInfo.inlineCss));
  }
  // flex 横排容器里，空的无宽子容器会被压缩到 0 宽 → 完全不可见不可点（"插进去看不到"）。
  // 编辑器专用兜底：无显式 width 的容器/hr 补 min-width 60px（不进 node.style、不导出）；
  // 用户设了 width（含百分比）则尊重用户值
  if ((CONTAINER_TAGS.has(node.type) || node.type === 'hr') && !node.style.width) {
    baseStyle.minWidth = '60px';
  }
  if (isSelected) {
    baseStyle.outline = '2px solid #1e88e5';
    baseStyle.outlineOffset = '-2px';
  }

  const commonProps = {
    'data-bc-id': node.id,
    'data-bc-locked': node.locked ? '1' : '0',
    // 类名优先原则：用户类名（或兜底 hash 类）真实挂到 DOM；用 ID 做选择器时挂 id 属性 —— 与导出一致
    className: selInfo.classAttr || undefined,
    id: selInfo.idAttr || undefined
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
      {...commonProps}
    >
      {/* 文本直接作为文本节点（与导出一致）；hover 时高亮提示可点选 */}
      {node.text || null}
      {node.children.length > 0 &&
        node.children.map((c) => (
          <CanvasNode key={c.id} node={c} depth={props.depth + 1} selectedIds={selectedIds} onSelect={onSelect} onSelectParent={onSelectParent} onToggleSelect={onToggleSelect} />
        ))}
      {node.locked && <span className="lock-badge">🔒</span>}
    </Tag>
  );
});

// 图片 src 转换：本地绝对路径（Windows C:\... 或 \\网络路径）转成 bc-img:// 协议，
function toRenderableSrc(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (/^(https?:|data:|blob:)/i.test(t) || /^[a-z]+:\/\//i.test(t) || t.startsWith('/')) return t;
  if (/^[a-zA-Z]:[\\/]/.test(t) || t.startsWith('\\\\')) {
    return 'bc-img://file/' + encodeURIComponent(t);
  }
  return t;
}
