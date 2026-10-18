import { useState } from 'react';
import { useScene } from '@store/sceneStore';
import { ColorField } from './ColorPicker';

// BlockCanvas · 外轮廓线 outline 可视化卡片（v0.4.4）
// 以前 outline 只是一个文本框；现在给 粗细 / 线型 / 颜色 三个控件，实时预览。

interface Props {
  elementId: string;
  value: string;
  onFocusStart: () => void;
  onFocusEnd: () => void;
}

const STYLES = [
  { id: 'solid', label: '实线' },
  { id: 'dashed', label: '虚线' },
  { id: 'dotted', label: '点线' },
  { id: 'double', label: '双线' }
] as const;

function parseOutline(v: string) {
  const s = (v || '').trim();
  if (!s || s === 'none') return { width: 0, style: 'solid', color: '#2563eb' };
  const m = /^(\d+(?:\.\d+)?)(px|em|rem)?\s*(solid|dashed|dotted|double)?\s*(.*)$/.exec(s);
  const colorMatch = /(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)/.exec(m?.[4] || '');
  return {
    width: m ? Number(m[1]) : 2,
    style: (m?.[3] as string) || 'solid',
    color: colorMatch ? colorMatch[1] : '#2563eb'
  };
}

export function OutlineInput(props: Props) {
  const updateStyle = useScene((s) => s.updateStyle);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const parsed = parseOutline(props.value);
  const [width, setWidth] = useState(parsed.width);
  const [style, setStyle] = useState(parsed.style);
  const [color, setColor] = useState(parsed.color);

  const compose = (w: number, st: string, c: string) =>
    w <= 0 ? 'none' : `${w}px ${st} ${c}`;

  const apply = (w: number, st: string, c: string, final = false) => {
    setWidth(w); setStyle(st); setColor(c);
    const css = compose(w, st, c);
    if (final) updateStyle(props.elementId, { outline: css } as any);
    else updateStyleTransient(props.elementId, { outline: css } as any);
  };

  return (
    <div className="outline-editor">
      <div className="outline-preview" style={{ outline: compose(width, style, color), outlineOffset: 2 }}>
        <span>外轮廓预览</span>
      </div>

      <div className="outline-row">
        <span className="outline-label">粗细</span>
        <input
          className="outline-range"
          type="range"
          min={0}
          max={12}
          step={1}
          value={width}
          onMouseDown={() => beginStyleEdit()}
          onChange={(e) => apply(Number(e.target.value), style, color)}
          onMouseUp={() => { apply(width, style, color, true); endStyleEdit(); }}
        />
        <span className="outline-val">{width}px</span>
      </div>

      <div className="outline-row">
        <span className="outline-label">线型</span>
        <div className="outline-styles">
          {STYLES.map((s) => (
            <button
              key={s.id}
              className={'outline-style-btn' + (style === s.id ? ' active' : '')}
              onClick={() => { beginStyleEdit(); apply(width || 2, s.id, color, true); endStyleEdit(); }}
              title={s.label}
            >
              <span className={'outline-sample is-' + s.id} />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="outline-row">
        <span className="outline-label">颜色</span>
        <div className="outline-color">
          <ColorField
            value={color}
            fallback="#2563eb"
            onInputFocus={() => beginStyleEdit()}
            onChange={(c) => apply(width, style, c)}
            onInputBlur={(c) => { apply(width, style, c, true); endStyleEdit(); }}
            onModalOpen={() => beginStyleEdit()}
            onModalClose={(c) => { apply(width, style, c, true); endStyleEdit(); }}
          />
        </div>
      </div>
    </div>
  );
}

export default OutlineInput;
