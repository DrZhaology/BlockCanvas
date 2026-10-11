import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScene, findNode } from '@store/sceneStore';
import { TEXT_TAGS } from '@lib/types';

// ============================================================================
// BlockCanvas · 画布文字「右键快捷菜单」（v0.4.4d）
// ----------------------------------------------------------------------------
// 场景：像 Word 那样，偶尔需要把某一段文字单独加粗 / 换个颜色 / 调个字号。
//   · 不需要按 Alt（这是"选中文字"的常规操作）；
//   · 只对**文字元素**出现（div/section 等块级容器不弹，避免误操作）；
//   · 改的是**内联样式**（写进元素的 style 属性），不抽类、不生成选择器 ——
//     这种一次性微调用选择器反而麻烦，且不会连累同选择器的其它元素。
// 目前只支持：字号 / 字重 / 颜色（不做渐变、不做字体 —— 只服务"加粗某段文字"这类场景）。
// ============================================================================

/** 常用文字色（点一下就换，不用开调色盘） */
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

export function CanvasTextMenu({ id, x, y, onClose }: { id: string; x: number; y: number; onClose: () => void }) {
  const node = useScene((s) => findNode(s.scene.root, id));
  const setInlineStyle = useScene((s) => s.setInlineStyle);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  // 拖动滑块/连续点击时先压一个检查点，整段操作算一条撤销
  const sessionRef = useRef(false);
  const beginSession = () => {
    if (sessionRef.current) return;
    sessionRef.current = true;
    useScene.getState().beginStyleEdit();
  };
  const endSession = () => {
    if (!sessionRef.current) return;
    sessionRef.current = false;
    useScene.getState().endStyleEdit();
  };

  // 位置：贴近光标，超出视口就翻转/夹紧
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
      endSession();
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { endSession(); onClose(); } };
    const onScroll = () => { endSession(); onClose(); };
    window.addEventListener('mousedown', onDoc, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', onDoc, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      endSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!node) return null;
  const inline = node.inlineStyle ?? {};
  // 当前字号：优先内联，其次元素自身样式
  const curSize = parseFloat(inline.fontSize || node.style.fontSize || '') || 0;
  const curWeight = String(inline.fontWeight || node.style.fontWeight || '');
  const curColor = (inline.color || node.style.color || '').toLowerCase();
  const tagLabel = `<${node.type}>`;

  const setSize = (delta: number) => {
    const base = curSize || 16;
    const next = Math.max(6, Math.min(400, Math.round(base + delta)));
    beginSession();
    setInlineStyle(id, { fontSize: next + 'px' });
  };
  const setWeight = (v: string) => {
    beginSession();
    setInlineStyle(id, { fontWeight: v });
    endSession();
  };
  const setColor = (c: string) => {
    beginSession();
    setInlineStyle(id, { color: c });
    endSession();
  };
  const clearAll = () => {
    beginSession();
    setInlineStyle(id, { fontSize: '', fontWeight: '', color: '' }, true);
    endSession();
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      className="bc-text-menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="bc-text-menu-head">
        <span className="bc-text-menu-tag">{tagLabel}</span>
        <span className="bc-text-menu-tip">单独调整这段文字（内联样式，不影响同类元素）</span>
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

      <div className="bc-text-menu-foot">
        <button className="btn-mini" onClick={clearAll} title="清除这段文字的内联字号/字重/颜色">清除</button>
        <button className="btn-mini btn-primary" onClick={() => { endSession(); onClose(); }}>完成</button>
      </div>
    </div>,
    document.body
  );
}

/** 该元素能不能用「文字右键菜单」——只有文字元素才行（块级容器不弹） */
export function isTextStylable(node: { type: string }): boolean {
  return TEXT_TAGS.has(node.type as never);
}
