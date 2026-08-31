import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useScene, CONTAINER_TAGS } from '@store/sceneStore';
import type { SceneElement } from '@lib/types';
import { HelpButton } from './HelpButton';

// BlockCanvas · 图层树 (DOM 结构)
// - 树状递归展示 DOM 嵌套关系
// - 支持选择、展开/收起、重命名、隐藏、锁定、快速移动
// - 拖拽排序功能：开启后支持任意跨层级拖拽、移入/移出容器，并在顶部给出关系选择器失效提示

const TYPE_LABELS: Record<string, string> = {
  div: 'div 容器', section: 'section 区块', header: 'header 页眉', nav: 'nav 导航',
  footer: 'footer 页脚', main: 'main 主区', article: 'article 文章', aside: 'aside 侧栏',
  figure: 'figure 图文', blockquote: 'blockquote 引用',
  h1: 'h1 标题', h2: 'h2 标题', h3: 'h3 标题', h4: 'h4 标题',
  p: 'p 段落', span: 'span 行内', strong: 'strong 加粗', em: 'em 斜体',
  mark: 'mark 高亮', small: 'small 小字', code: 'code 代码', del: 'del 删除线',
  sup: 'sup 上标', sub: 'sub 下标', label: 'label 标签', a: 'a 链接',
  ul: 'ul 无序列表', ol: 'ol 有序列表', li: 'li 列表项',
  table: 'table 表格', tr: 'tr 表格行', th: 'th 表头格', td: 'td 单元格',
  figcaption: 'figcaption 图注',
  button: 'button 按钮', input: 'input 输入', textarea: 'textarea 文本域',
  form: 'form 表单', img: 'img 图片', hr: 'hr 分割线', br: 'br 换行'
};

export function LayerTree() {
  const root = useScene((s) => s.scene.root);
  const selectedIds = useScene((s) => s.scene.selectedIds);
  const select = useScene((s) => s.selectElement);
  const reparent = useScene((s) => s.reparent);

  // 拖拽排序开关状态（记忆到 localStorage）
  const [dragEnabled, setDragEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('bc-layer-drag') === '1'; } catch { return false; }
  });

  const toggleDrag = (v: boolean) => {
    setDragEnabled(v);
    try { localStorage.setItem('bc-layer-drag', v ? '1' : '0'); } catch {}
  };

  // 拖拽状态
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: 'above' | 'inside' | 'below' } | null>(null);

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData('text/plain') || draggedId;
    if (id && id !== root.id) {
      reparent(id, root.id, root.children.length);
    }
    setDraggedId(null);
    setDropTarget(null);
  };

  return (
    <div className="layer-tree">
      <div className="layer-tree-header">
        <div className="layer-tree-title">
          <span>图层结构</span>
          <HelpButton
            title="图层树功能说明"
            content={'【图层树帮助】：\n\n· 单击选中元素，Ctrl+点击进行多选。\n· 开启「🖐️ 拖拽排序」后，可按住节点自由上下拖动调整顺序，或拖入容器内形成嵌套。\n\n⚠ 提示：移动跨越父容器后，元素此前若使用过「⚡ 智能关系选择器」（如 .hero > h1），可能因层级变化而失效，建议重新关联。'}
          />
        </div>
        <div className="layer-drag-toggle-wrap">
          <button
            className={"layer-drag-toggle-btn" + (dragEnabled ? ' active' : '')}
            onClick={() => toggleDrag(!dragEnabled)}
            title={dragEnabled ? '拖拽排序已开启（可直接按住节点拖动重排）。点击关闭' : '点击开启拖拽排序模式'}
          >
            {dragEnabled ? '🖐️ 拖拽排序: 开' : '🖐️ 拖拽排序: 关'}
          </button>
        </div>
      </div>

      {dragEnabled && (
        <div className="layer-drag-warn">
          <span>💡 拖拽模式已开启，按住节点可上下调序或拖入容器（拖到画布根可移出最外层）。</span>
        </div>
      )}

      {/* 画布根节点行（可作为拖出到最外层的放置目标） */}
      <div
        className={"layer-row root-row" + (dropTarget?.id === root.id ? ' drop-inside' : '')}
        onClick={() => select(root.id)}
        onDragOver={(e) => {
          if (!dragEnabled) return;
          e.preventDefault();
          setDropTarget({ id: root.id, pos: 'inside' });
        }}
        onDragLeave={() => {
          if (dropTarget?.id === root.id) setDropTarget(null);
        }}
        onDrop={handleRootDrop}
      >
        <span className="layer-icon">📄</span>
        <span className="layer-name">画布根 (body)</span>
        <span className="field-hint" style={{ fontSize: 10 }}>拖到此处移至最外层</span>
      </div>

      {root.children.map((c, idx) => (
        <LayerRow
          key={c.id}
          node={c}
          depth={0}
          index={idx}
          parentId={root.id}
          selectedIds={selectedIds}
          dragEnabled={dragEnabled}
          draggedId={draggedId}
          setDraggedId={setDraggedId}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
        />
      ))}

      {root.children.length === 0 && (
        <div className="hint" style={{ padding: 12, textAlign: 'center' }}>画布为空，从下方插入元素</div>
      )}
    </div>
  );
}

function LayerRow(props: {
  node: SceneElement;
  depth: number;
  index: number;
  parentId: string;
  selectedIds: string[];
  dragEnabled: boolean;
  draggedId: string | null;
  setDraggedId: (id: string | null) => void;
  dropTarget: { id: string; pos: 'above' | 'inside' | 'below' } | null;
  setDropTarget: (t: { id: string; pos: 'above' | 'inside' | 'below' } | null) => void;
}) {
  const {
    node, depth, index, parentId, selectedIds,
    dragEnabled, draggedId, setDraggedId, dropTarget, setDropTarget
  } = props;
  const [expanded, setExpanded] = useState(true);
  const rowRef = useRef<HTMLDivElement>(null);

  const isSelected = selectedIds.includes(node.id);
  const select = useScene((s) => s.selectElement);
  const toggleSelect = useScene((s) => s.toggleSelect);
  const moveChild = useScene((s) => s.moveChild);
  const reparent = useScene((s) => s.reparent);
  const removeElement = useScene((s) => s.removeElement);
  const duplicateElement = useScene((s) => s.duplicateElement);
  const copyElement = useScene((s) => s.copyElement);
  const pasteInto = useScene((s) => s.pasteInto);
  const clipboard = useScene((s) => s.clipboard);
  const toggleHidden = useScene((s) => s.toggleHidden);
  const toggleLocked = useScene((s) => s.toggleLocked);

  const isContainer = CONTAINER_TAGS.has(node.type);
  const canPasteInto = isContainer;

  // 选中元素时自动滚动到该行
  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isSelected]);

  // 拖拽事件处理
  const handleDragStart = (e: React.DragEvent) => {
    if (!dragEnabled) return;
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', node.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedId(node.id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!dragEnabled || !draggedId || draggedId === node.id) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const h = rect.height;

    let pos: 'above' | 'inside' | 'below';
    if (isContainer && offsetY > h * 0.25 && offsetY < h * 0.75) {
      pos = 'inside';
    } else if (offsetY <= h / 2) {
      pos = 'above';
    } else {
      pos = 'below';
    }
    setDropTarget({ id: node.id, pos });
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    if (dropTarget?.id === node.id) {
      setDropTarget(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!dragEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    const targetId = e.dataTransfer.getData('text/plain') || draggedId;
    if (!targetId || targetId === node.id) {
      setDraggedId(null);
      setDropTarget(null);
      return;
    }

    if (dropTarget) {
      if (dropTarget.pos === 'inside' && isContainer) {
        reparent(targetId, node.id, node.children.length);
        setExpanded(true);
      } else if (dropTarget.pos === 'above') {
        reparent(targetId, parentId, index);
      } else if (dropTarget.pos === 'below') {
        reparent(targetId, parentId, index + 1);
      }
    }
    setDraggedId(null);
    setDropTarget(null);
  };

  const isCurrentDrop = dropTarget?.id === node.id;
  const dropClass = isCurrentDrop ? ` drop-${dropTarget.pos}` : '';
  const isDraggingSelf = draggedId === node.id;

  // 关系选择器或类名标记
  const relSel = (node.attrs?.relSelector ?? '').trim();
  const cls = (node.attrs?.className ?? '').trim();

  return (
    <div className={"layer-branch" + (isDraggingSelf ? " is-dragging" : "")}>
      <div
        ref={rowRef}
        className={"layer-row" + (isSelected ? " selected" : "") + (node.hidden ? " row-hidden" : "") + dropClass}
        title={[
          TYPE_LABELS[node.type] ?? node.type,
          relSel ? `[⚡ ${relSel}]` : cls ? `[.${cls}]` : '',
          node.text ? `· ${node.text}` : '',
          node.hidden ? '（已隐藏）' : '',
          node.locked ? '（已锁定）' : ''
        ].filter(Boolean).join(' ')}
        style={{ paddingLeft: 8 + depth * 12 }}
        draggable={dragEnabled && !node.locked}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.ctrlKey || e.metaKey) toggleSelect(node.id);
          else select(node.id);
        }}
      >
        {node.children.length > 0 ? (
          <button
            className="layer-toggle"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            title={expanded ? "收起" : "展开"}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="layer-toggle-placeholder" />
        )}
        <span className="layer-icon">{node.hidden ? '🚫' : node.locked ? '🔒' : typeIcon(node.type)}</span>
        <span className="layer-name">{TYPE_LABELS[node.type] ?? node.type}</span>
        {relSel && <span className="layer-rel-badge" title={relSel}>⚡</span>}
        {cls && !relSel && <span className="layer-cls-badge" title={cls}>.{cls.split(/\s+/)[0]}</span>}
        {node.text && <span className="layer-text-preview">{"· " + node.text}</span>}
        <span className="layer-actions" onClick={(e) => e.stopPropagation()}>
          <button title="上移" onClick={() => moveChild(node.id, 'up')}><Svg><ChevronUp /></Svg></button>
          <button title="下移" onClick={() => moveChild(node.id, 'down')}><Svg><ChevronDown /></Svg></button>
          <button title={node.hidden ? "显示" : "隐藏"} onClick={() => toggleHidden(node.id)}>
            <Svg>{node.hidden ? <EyeOff /> : <Eye />}</Svg>
          </button>
          <button title={node.locked ? "解锁" : "锁定"} onClick={() => toggleLocked(node.id)}>
            <Svg>{node.locked ? <Lock /> : <LockOpen />}</Svg>
          </button>
          <button title="复制" onClick={() => duplicateElement(node.id)}><Svg><CopyIcon /></Svg></button>
          <button title="拷贝到剪贴板" onClick={() => copyElement(node.id)}><Svg><ClipboardCopy /></Svg></button>
          {canPasteInto && clipboard && (
            <button title="粘贴到此元素" onClick={() => pasteInto(node.id)}><Svg><ClipboardPaste /></Svg></button>
          )}
          <button title="删除" className="layer-del" onClick={() => removeElement(node.id)}><Svg><Trash /></Svg></button>
        </span>
      </div>
      {expanded && node.children.length > 0 && (
        <div className="layer-children">
          {node.children.map((c, idx) => (
            <LayerRow
              key={c.id}
              node={c}
              depth={depth + 1}
              index={idx}
              parentId={node.id}
              selectedIds={selectedIds}
              dragEnabled={dragEnabled}
              draggedId={draggedId}
              setDraggedId={setDraggedId}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function typeIcon(t: string): string {
  // 单字符标准字形/图标（彻底杜绝多字符 .square 导致的重叠溢出问题）
  const m: Record<string, string> = {
    div: '⬚', section: '▦', header: '▭', nav: '☰',
    footer: '▭', main: '▣', article: '▤', aside: '▥',
    figure: '🖼', blockquote: '❝',
    h1: 'H1', h2: 'H2', h3: 'H3', h4: 'H4',
    p: '¶', span: '⌥', strong: '𝐁', em: '𝑖',
    mark: '🖍', small: '🆂', code: '⟨⟩', del: '✂',
    sup: 'x²', sub: 'x₂', label: '🏷', a: '🔗',
    ul: '≣', ol: '🔢', li: '•',
    table: '⊞', tr: '═', th: '┳', td: '▫',
    figcaption: '💬',
    button: '🔘', input: '⌨', textarea: '📝', form: '▢',
    img: '🖼', hr: '―', br: '↵'
  };
  return m[t] ?? '◻';
}

// ============ 行内 SVG 图标 ============
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
const ChevronUp = () => <path d="m18 15-6-6-6 6" />;
const ChevronDown = () => <path d="m6 9 6 6 6-6" />;
const Eye = () => (
  <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>
);
const EyeOff = () => (
  <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><path d="m2 2 20 20" /><circle cx="12" cy="12" r="3" /></>
);
const Lock = () => (
  <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>
);
const LockOpen = () => (
  <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.8-.6" /></>
);
const CopyIcon = () => (
  <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>
);
const ClipboardCopy = () => (
  <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>
);
const ClipboardPaste = () => (
  <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 12 3 3 3-3" /><path d="M12 9v6" /></>
);
const Trash = () => (
  <><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></>
);
