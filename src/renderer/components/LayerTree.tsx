import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useScene } from '@store/sceneStore';
import { CONTAINER_TAGS } from '@lib/types';
import type { SceneElement } from '@lib/types';

// BlockCanvas · 图层树
// 阶段1：递归显示 DOM 嵌套结构
//  - 单击：选中该元素
//  - 上移 / 下移：调用 store.moveChild
//  - 显隐 / 锁定：调 toggleHidden / toggleLocked
//  - 删除：调 removeElement
//  - 复制/粘贴：调 copyElement / pasteInto
// 拖拽改层级（reparent）放阶段2做 DnD；这里先用按钮跑通主流程

const TYPE_LABELS: Record<string, string> = {
  div: 'div 容器', section: 'section 区块', header: 'header 页眉', nav: 'nav 导航',
  footer: 'footer 页脚', main: 'main 主区', article: 'article 文章', aside: 'aside 侧栏',
  h1: 'h1 标题', h2: 'h2 标题', h3: 'h3 标题', h4: 'h4 标题',
  p: 'p 段落', span: 'span 行内', label: 'label 标签', a: 'a 链接',
  ul: 'ul 无序列表', ol: 'ol 有序列表', li: 'li 列表项',
  button: 'button 按钮', input: 'input 输入', textarea: 'textarea 文本域',
  form: 'form 表单', img: 'img 图片', hr: 'hr 分割线'
};

export function LayerTree() {
  const root = useScene((s) => s.scene.root);
  const selectedIds = useScene((s) => s.scene.selectedIds);
  const select = useScene((s) => s.selectElement);

  return (
    <div className="layer-tree">
      <div className="layer-row root-row" onClick={() => select(root.id)}>
        <span className="layer-label">📄 画布根</span>
      </div>
      {root.children.map((c) => (
        <LayerRow key={c.id} node={c} depth={0} selectedIds={selectedIds} />
      ))}
      {root.children.length === 0 && (
        <div className="hint" style={{ padding: 10 }}>画布为空，从左侧插入元素</div>
      )}
    </div>
  );
}

function LayerRow(props: { node: SceneElement; depth: number; selectedIds: string[] }) {
  const { node, depth, selectedIds } = props;
  const [expanded, setExpanded] = useState(true);
  const rowRef = useRef<HTMLDivElement>(null);

  const isSelected = selectedIds.includes(node.id);
  const select = useScene((s) => s.selectElement);
  const toggleSelect = useScene((s) => s.toggleSelect);
  const moveChild = useScene((s) => s.moveChild);
  const removeElement = useScene((s) => s.removeElement);
  const duplicateElement = useScene((s) => s.duplicateElement);
  const copyElement = useScene((s) => s.copyElement);
  const pasteInto = useScene((s) => s.pasteInto);
  const clipboard = useScene((s) => s.clipboard);
  const toggleHidden = useScene((s) => s.toggleHidden);
  const toggleLocked = useScene((s) => s.toggleLocked);

  // 判断能否粘贴到此元素：必须有 children 槽位（非自闭合）
  const canPasteInto = CONTAINER_TAGS.has(node.type);

  // 选中元素时自动滚动到该行
  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isSelected]);

  return (
    <div className="layer-branch">
      <div
        ref={rowRef}
        className={"layer-row" + (isSelected ? " selected" : "") + (node.hidden ? " row-hidden" : "")}
        title={[
          TYPE_LABELS[node.type] ?? node.type,
          node.text ? `· ${node.text}` : '',
          node.hidden ? '（已隐藏）' : '',
          node.locked ? '（已锁定）' : ''
        ].filter(Boolean).join(' ')}
        style={{ paddingLeft: 8 + depth * 12 }}
        // 用 pointerdown 选中而不是 click：hover 时操作按钮会显示并占据行右半，
        // 若用 click，点按钮会 stopPropagation 吞掉选中，点行中右部会落空 → "点了没选中"
        // pointerdown 先于按钮的 click 触发，任何位置点击都先选中该行
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
          {node.children.map((c) => (
            <LayerRow key={c.id} node={c} depth={depth + 1} selectedIds={selectedIds} />
          ))}
        </div>
      )}
    </div>
  );
}

function typeIcon(t: string): string {
  // 简单用 emoji 占位；阶段2 之后会换成 SVG 图标
  const m: Record<string, string> = {
    div: '.square', section: '▦', header: '▭', nav: '☰',
    footer: '▭', main: '▣', article: '▤', aside: '▥',
    h1: 'H1', h2: 'H2', h3: 'H3', h4: 'H4',
    p: '¶', span: '⌥', label: '🏷', a: '🔗',
    ul: '≣', ol: '≣', li: '•',
    button: '🔘', input: '⌨', textarea: '⌨', form: '▢',
    img: '🖼', hr: '―'
  };
  return m[t] ?? '◻';
}

// ============ 行内 SVG 图标（stroke 风格，跟随按钮颜色） ============
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
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </>
);
