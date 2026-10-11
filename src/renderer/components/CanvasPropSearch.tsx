import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SCHEMA } from '@lib/propertySchema';
import { getPluginProperties } from '@lib/pluginHost';
import { searchProperties } from '@lib/propSearch';

// ============================================================================
// BlockCanvas · 画布「中键搜索属性」（v0.4.4g）
// ----------------------------------------------------------------------------
// 在画布上对某个元素按**鼠标中键** → 弹出一个搜索框 → 敲属性名 → Enter：
//   直接跳到右侧属性面板的「CSS 样式属性」，定位到匹配度最高的那一行并橙色高亮。
// 支持拼错 / 只敲前几个字母 / 拼音缩写（见 lib/propSearch）。
// 设计意图：鼠标中键 + 键盘，一步直达，不用在长长的属性列表里翻。
// ============================================================================

export function CanvasPropSearch({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const all = [...SCHEMA, ...getPluginProperties()];
  const hits = searchProperties(all, q).slice(0, 6);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.min(Math.max(6, x), Math.max(6, window.innerWidth - w - 6)),
      top: Math.min(Math.max(6, y), Math.max(6, window.innerHeight - h - 6))
    });
  }, [x, y, q]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDoc, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc, true);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (key?: string) => {
    const target = key || hits[0]?.item.key;
    if (!target) return;
    window.dispatchEvent(new CustomEvent('bc:focus-prop', { detail: { key: target } }));
    onClose();
  };

  return createPortal(
    <div ref={ref} className="bc-prop-search" style={{ left: pos.left, top: pos.top }}>
      <div className="bc-prop-search-row">
        <span className="bc-prop-search-ico" aria-hidden="true">🔍</span>
        <input
          ref={inputRef}
          className="bc-prop-search-input"
          value={q}
          placeholder="敲属性名 → Enter 定位"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
      </div>
      {q.trim() !== '' && (
        <div className="bc-prop-search-list bc-scroll">
          {hits.length === 0 && <div className="bc-prop-search-empty">没有匹配的属性</div>}
          {hits.map((h, i) => (
            <button
              key={h.item.key}
              className={'bc-prop-search-item' + (i === 0 ? ' is-best' : '')}
              onClick={() => commit(h.item.key)}
              title={`定位到「${h.item.label}」`}
            >
              <span className="bc-prop-search-label">{h.item.label}</span>
              <span className="bc-prop-search-key">{h.item.key}</span>
            </button>
          ))}
        </div>
      )}
      <div className="bc-prop-search-hint">中键搜索 · Enter 定位 · Esc 关闭</div>
    </div>,
    document.body
  );
}
