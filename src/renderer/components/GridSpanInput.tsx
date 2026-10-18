import { useScene } from '@store/sceneStore';

// BlockCanvas · 跨列 / 跨行 可视化卡片（v0.4.4）
// grid-column / grid-row 以前是纯文本，现在给常用档位 + 自定义。

interface Props {
  elementId: string;
  schemaKey: 'gridColumn' | 'gridRow';
  value: string;
  onFocusStart: () => void;
  onFocusEnd: () => void;
}

const OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '自动' },
  { value: 'span 2', label: '跨 2' },
  { value: 'span 3', label: '跨 3' },
  { value: 'span 4', label: '跨 4' },
  { value: '1 / -1', label: '撑满整行' }
];

export function GridSpanInput(props: Props) {
  const updateStyle = useScene((s) => s.updateStyle);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const isRow = props.schemaKey === 'gridRow';
  const value = (props.value || '').trim();
  const known = OPTIONS.some((o) => o.value === value);

  const commit = (v: string) => {
    beginStyleEdit();
    updateStyle(props.elementId, { [props.schemaKey]: v } as any);
    endStyleEdit();
  };

  return (
    <div className="grid-span">
      <div className="grid-span-seg">
        {OPTIONS.map((o) => (
          <button
            key={o.value || 'auto'}
            className={'grid-span-btn' + (value === o.value ? ' active' : '')}
            onClick={() => commit(o.value)}
            title={isRow ? `跨行：${o.label}` : `跨列：${o.label}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <input
        className="grid-span-custom"
        value={value}
        placeholder={isRow ? '例：span 2 / 2 / 1 / -1' : '例：span 2 / 1 / -1'}
        spellCheck={false}
        onFocus={props.onFocusStart}
        onChange={(e) => {
          // 自定义值：直接透传
          updateStyle(props.elementId, { [props.schemaKey]: e.target.value } as any);
        }}
        onBlur={props.onFocusEnd}
      />
      {!known && value && <span className="grid-span-hint">自定义值</span>}
    </div>
  );
}

export default GridSpanInput;
