import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScene, findNode } from '@store/sceneStore';
import { TEXT_TAGS } from '@lib/types';

// ============================================================================
// BlockCanvas · 画布文字「右键快捷菜单」（v0.4.4d）
// ----------------------------------------------------------------------------
// 两种模式：
//   · element —— 右键一个文字元素（不进入编辑）→ 调整**整个元素**的字号/字重/颜色。
//     写进元素的 node.style（**和右侧属性面板同一份数据 → 完全互通**）。
//   · range   —— 在就地编辑态里选中一段文字后右键 → 只调整**选中的那一小段**。
//     包成带内联样式的富文本片段（导出成 `<span style="…">…</span>`，不用选择器）。
// 只对**文字元素**出现（块级容器不弹）。面板点击别处即关；调整实时生效（无需"完成"按钮）。
// ============================================================================

const TEXT_COLORS = [
  '#111827', '#374151', '#6b7280', '#9ca3af',
  '#dc2626', '#ea580c', '#d97706', '#16a34a',
  '#0891b2', '#2563eb', '#7c3aed', '#db2777'
];

const WEIGHTS: { v: string; label: string }[] = [
  { v: '400', label: '常规' },
  { v: '600', label: '中黑' },
  { v: '700', label: '加粗' },
  { v: '900', label: '特粗' }
];

export type TextMenuPayload =
  | { mode: 'element'; id: string; x: number; y: number }
  | { mode: 'range'; id: string; x: number; y: number; start: number; end: number; text: string };

export function CanvasTextMenu({ payload, onClose }: { payload: TextMenuPayload; onClose: () => void }) {
  const { id, x, y } = payload;
  const node = useScene((s) => findNode(s.scene.root, id));
  const updateStyle = useScene((s) => s.updateStyle);
  const applyTextRunStyle = useScene((s) => s.applyTextRunStyle);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  // 位置：贴近光标，超出视口就夹紧
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.min(Math.max(6, x), Math.max(6, window.innerWidth - w - 6));
    const top = Math.min(Math.max(6, y), Math.max(6, window.innerHeight - h - 6));
    setPos({ left, top });
  }, [x, y]);

  // 外部点击 / Esc / 滚动 / 缩放 关闭
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    window.addEventListener('mousedown', onDoc, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', onDoc, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!node) return null;
  const isRange = payload.mode === 'range';
  const curSize = parseFloat(node.style.fontSize || '') || 0;
  const curWeight = String(node.style.fontWeight || '');
  const curColor = (node.style.color || '').toLowerCase();
  const selLen = isRange ? (payload.end - payload.start) : 0;

  const setSize = (delta: number) => {
    const base = curSize || 16;
    const next = Math.max(6, Math.min(400, Math.round(base + delta)));
    if (isRange) applyTextRunStyle(id, payload.start, payload.end, { fontSize: next + 'px' });
    else updateStyle(id, { fontSize: next + 'px' });
  };
  const setWeight = (v: string) => {
    if (isRange) applyTextRunStyle(id, payload.start, payload.end, { fontWeight: v });
    else updateStyle(id, { fontWeight: v });
  };
  const setColor = (c: string) => {
    if (isRange) applyTextRunStyle(id, payload.start, payload.end, { color: c });
    else updateStyle(id, { color: c });
  };

  return createPortal(
    <div
      ref={ref}
      className="bc-text-menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="bc-text-menu-head">
        <span className="bc-text-menu-tag">&lt;{node.type}&gt;</span>
        <span className="bc-text-menu-tip">
          {isRange
            ? `只调整选中的 ${selLen} 个字（内联样式，不影响其它文字）`
            : '调整这段文字（与右侧「CSS 样式属性」互通）'}
        </span>
      </div>

      <div className="bc-text-menu-row">
        <span className="bc-text-menu-label">字号</span>
        <div className="bc-text-size">
          <button className="bc-ts-btn" title="减小 1px" onClick={() => setSize(-1)}>−</button>
          <span className="bc-ts-val">{curSize ? Math.round(curSize) : '默认'}</span>
          <button className="bc-ts-btn" title="增大 1px" onClick={() => setSize(1)}>＋</button>
        </div>
        <span className="bc-text-menu-hint">px</span>
      </div>

      <div className="bc-text-menu-row">
        <span className="bc-text-menu-label">字重</span>
        <div className="bc-weight-seg">
          {WEIGHTS.map((w) => (
            <button
              key={w.v}
              className={'bc-weight-btn' + (curWeight === w.v ? ' active' : '')}
              style={{ fontWeight: Number(w.v) }}
              onClick={() => setWeight(w.v)}
            >{w.label}</button>
          ))}
        </div>
      </div>

      <div className="bc-text-menu-row bc-text-menu-row-col">
        <span className="bc-text-menu-label">颜色</span>
        <div className="bc-color-grid">
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              className={'bc-color-swatch' + (curColor === c ? ' active' : '')}
              style={{ background: c }}
              title={c}
              onClick={() => setColor(c)}
            />
          ))}
          <label className="bc-color-swatch bc-color-custom" title="自定义颜色">
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(curColor) ? curColor : '#111827'}
              onChange={(e) => setColor(e.target.value)}
            />
            <span>＋</span>
          </label>
        </div>
      </div>

      <div className="bc-text-menu-hintfoot">点别处即关闭；改错了按 Ctrl+Z 撤销</div>
    </div>,
    document.body
  );
}

/** 该元素能不能用「文字右键菜单」——只有文字元素才行（块级容器不弹） */
export function isTextStylable(node: { type: string }): boolean {
  return TEXT_TAGS.has(node.type as never);
}
