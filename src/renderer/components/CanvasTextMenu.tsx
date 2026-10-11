import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScene, findNode } from '@store/sceneStore';
import { TEXT_TAGS, type ElementStyle, type TextRun } from '@lib/types';

// ============================================================================
// BlockCanvas · 画布文字「右键快捷菜单」（v0.4.4e）
// ----------------------------------------------------------------------------
// 两种模式（规则统一，永远不会"串色"）：
//   · element —— 右键一个文字元素（不进入编辑）；或在编辑态里**选中了整段文本**。
//     → 调整的是**整个元素**的 CSS（写 node.style），**与右侧属性面板完全互通**。
//   · range   —— 在编辑态里只选中**一部分**文字。
//     → 只给这一小段套**内联 HTML 样式**（导出成 `<span style="…">`，不用选择器）；
//       因为它内联，优先级天然高于整段 CSS，所以整段样式不会覆盖它。
// 菜单里显示的当前值，也是**这段文本自己的值**（range 模式取选中片段）。
// 支持：字号 / 字重 / 颜色 / 下划线 / 删除线 / 斜体。
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

/** 取覆盖 [start,end) 的片段 */
function runsCovering(runs: TextRun[], start: number, end: number): TextRun[] {
  const out: TextRun[] = [];
  let pos = 0;
  for (const r of runs) {
    const a = pos;
    const b = pos + r.text.length;
    pos = b;
    if (b <= start || a >= end) continue;
    out.push(r);
  }
  return out;
}

/** 文本装饰（下划线 / 删除线）的开关 */
function toggleDecoration(cur: string, token: 'underline' | 'line-through'): string {
  const set = new Set(cur.split(/\s+/).filter((x) => x && x !== 'none'));
  if (set.has(token)) set.delete(token);
  else set.add(token);
  return set.size ? [...set].join(' ') : 'none';
}

export function CanvasTextMenu({ payload, onClose }: { payload: TextMenuPayload; onClose: () => void }) {
  const { id, x, y } = payload;
  const node = useScene((s) => findNode(s.scene.root, id));
  const updateStyle = useScene((s) => s.updateStyle);
  const applyTextRunStyle = useScene((s) => s.applyTextRunStyle);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.min(Math.max(6, x), Math.max(6, window.innerWidth - w - 6));
    const top = Math.min(Math.max(6, y), Math.max(6, window.innerHeight - h - 6));
    setPos({ left, top });
  }, [x, y]);

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
  const start = isRange ? payload.start : 0;
  const end = isRange ? payload.end : 0;

  // 当前值：element 模式取元素 CSS；range 模式取"选中片段"的值（片段之间不一致则为空）
  const readVal = (k: keyof ElementStyle): string => {
    if (!isRange) return String((node.style[k] as string | undefined) ?? '');
    const runs: TextRun[] = node.runs && node.runs.length ? node.runs : [{ text: node.text ?? '' }];
    const cov = runsCovering(runs, start, end);
    if (!cov.length) return '';
    const vals = cov.map((r) => String((r.style?.[k] as string | undefined) ?? ''));
    return vals.every((v) => v === vals[0]) ? vals[0] : '';
  };

  const patch = (p: Partial<ElementStyle>) => {
    if (isRange) applyTextRunStyle(id, start, end, p);
    else updateStyle(id, p);
  };

  const curSize = parseFloat(readVal('fontSize')) || 0;
  const curWeight = readVal('fontWeight');
  const curColor = readVal('color').toLowerCase();
  const curDeco = readVal('textDecoration');
  const hasUnderline = curDeco.includes('underline');
  const hasStrike = curDeco.includes('line-through');
  const isItalic = readVal('fontStyle') === 'italic';
  const selLen = isRange ? (end - start) : 0;

  const setSize = (delta: number) => {
    const base = curSize || 16;
    const next = Math.max(6, Math.min(400, Math.round(base + delta)));
    patch({ fontSize: next + 'px' });
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
            ? `只调整选中的 ${selLen} 个字（内联样式，整段 CSS 覆盖不了它）`
            : '调整这段文字（写进元素 CSS，与右侧属性面板互通）'}
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
              onClick={() => patch({ fontWeight: w.v })}
            >{w.label}</button>
          ))}
        </div>
      </div>

      <div className="bc-text-menu-row">
        <span className="bc-text-menu-label">样式</span>
        <div className="bc-style-seg">
          <button
            className={'bc-style-btn' + (hasUnderline ? ' active' : '')}
            title="下划线"
            style={{ textDecoration: 'underline' }}
            onClick={() => patch({ textDecoration: toggleDecoration(curDeco, 'underline') })}
          >U</button>
          <button
            className={'bc-style-btn' + (hasStrike ? ' active' : '')}
            title="删除线"
            style={{ textDecoration: 'line-through' }}
            onClick={() => patch({ textDecoration: toggleDecoration(curDeco, 'line-through') })}
          >S</button>
          <button
            className={'bc-style-btn bc-style-i' + (isItalic ? ' active' : '')}
            title="斜体"
            onClick={() => patch({ fontStyle: isItalic ? 'normal' : 'italic' })}
          >I</button>
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
              onClick={() => patch({ color: c })}
            />
          ))}
          <label className="bc-color-swatch bc-color-custom" title="自定义颜色">
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(curColor) ? curColor : '#111827'}
              onChange={(e) => patch({ color: e.target.value })}
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
