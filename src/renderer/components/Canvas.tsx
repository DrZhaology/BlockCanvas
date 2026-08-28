import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useScene, findParent } from '@store/sceneStore';
import { SELF_CLOSING_TAGS, TEXT_ONLY_TAGS, CONTAINER_TAGS, TEXT_TAGS } from '@lib/types';
import type { SceneElement } from '@lib/types';
import { selectorForNode, collectStyleClasses, buildStyleBlock, createStyleClassSet, quickCssToCss, cssTextToObject } from '@lib/styleClass';
import { classColor } from '@lib/classColor';

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
  const toggleSelect = useScene((s) => s.toggleSelect);
  const selectMany = useScene((s) => s.selectMany);

  // 拖框选中状态（client 坐标系：起点可在画布空白或条纹背景，拖到哪都能继续选）
  const dragRef = useRef<{ startX: number; startY: number; active: boolean; ctrl: boolean } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
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

  const endMarquee = () => {
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    document.body.classList.remove('bc-marqueeing');
  };

  // window 级监听：指针跑到画布外（条纹区/面板上）也持续更新选框
  const onWindowMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    d.active = true;
    setMarquee({
      x: Math.min(d.startX, e.clientX),
      y: Math.min(d.startY, e.clientY),
      w: Math.abs(dx),
      h: Math.abs(dy)
    });
  };

  const onWindowUp = (e: PointerEvent) => {
    const d = dragRef.current;
    endMarquee();
    dragRef.current = null;
    setMarquee(null);
    if (!d) return;
    if (!d.active) return; // 没拖成框 = 普通点击，交给 onClick 清空选区
    suppressClickRef.current = true;
    // 100% 在框内才算选中（与 Windows 桌面框选一致）。client 坐标对比，
    // getBoundingClientRect 已含缩放 → zoom 下天然正确
    const minX = Math.min(d.startX, e.clientX);
    const minY = Math.min(d.startY, e.clientY);
    const maxX = Math.max(d.startX, e.clientX);
    const maxY = Math.max(d.startY, e.clientY);
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
    // 起点允许：条纹背景（wrap 自身）或画布空白处（canvas 自身）；
    // 元素上的按下由元素自身处理（选中/多选），不在此起框
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && t !== canvasRef.current) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, active: false, ctrl: e.ctrlKey || e.metaKey };
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
      title="提示：Ctrl+点击 多选；空白/条纹处拖框批量选中（可拖出画布）；Alt+点击 选中父级；Ctrl+滚轮 缩放画布"
      onPointerDown={onCanvasPointerDown}
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
      <div
        ref={canvasRef}
        className="canvas"
        style={{
          ...(canvasWidth === 'auto' ? undefined : { width: canvasWidth }),
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: 'left top'
        }}
        onWheel={onCanvasWheel}
      >
        {root.children.map((c) => (
          <CanvasNode key={c.id} node={c} depth={0} selectedIds={selectedIds} onSelect={select} onSelectParent={selectParent} onToggleSelect={toggleSelect} />
        ))}
        {root.children.length === 0 && (
          <div className="canvas-empty">从左侧点击元素按钮插入到画布</div>
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

  // 画布双击就地编辑文案
  const [editingText, setEditingText] = useState(false);
  const [inlineDraft, setInlineDraft] = useState(node.text ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingText) setInlineDraft(node.text ?? '');
  }, [node.text, editingText]);

  useEffect(() => {
    if (editingText && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
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
    setEditingText(false);
    useScene.getState().setText(node.id, inlineDraft);
  };
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
    // 方案1：双层高亮边框（内白 + 外亮蓝），向内 -2px 偏移，绝不向外扩张改变视觉大小
    baseStyle.outline = '2px solid #1e88e5';
    baseStyle.outlineOffset = '-2px';
    baseStyle.boxShadow = 'inset 0 0 0 1.5px #ffffff';
  }

  const commonProps = {
    'data-bc-id': node.id,
    'data-bc-locked': node.locked ? '1' : '0',
    // 类名优先原则：用户类名（或兜底 hash 类）真实挂到 DOM；用 ID 做选择器时挂 id 属性 —— 与导出一致
    className: selInfo.classAttr || undefined,
    id: selInfo.idAttr || undefined,
    // 同类同色（编辑器可视化）：优先类名，其次关系选择器作为分组标记，配合 bc-class-colors 注入描边色
    'data-bc-cg': (node.attrs?.className ?? '').trim().split(/\s+/)[0] || (node.attrs?.relSelector ?? '').trim() || undefined
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
      {/* 文本直接作为文本节点；双击进入就地输入框 */}
      {editingText ? (
        <input
          ref={inputRef}
          type="text"
          className="canvas-inline-text-input"
          value={inlineDraft}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onChange={(e) => setInlineDraft(e.target.value)}
          onBlur={commitInlineText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitInlineText();
            else if (e.key === 'Escape') {
              setInlineDraft(node.text ?? '');
              setEditingText(false);
            }
          }}
        />
      ) : (
        node.text || null
      )}
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
