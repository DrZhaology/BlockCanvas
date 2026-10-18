import { useMemo, useState } from 'react';
import { useScene } from '@store/sceneStore';

// BlockCanvas · 滤镜 / 背景模糊 可视化编辑器（v0.4.4）
// 以前 filter / backdrop-filter 只是一个裸文本框，用户根本不知道能写什么、也看不到效果。
// 现在给一组预设 + 滑杆，实时写回 CSS；未知函数（用户手写的）原样保留。

interface Props {
  elementId: string;
  schemaKey: 'filter' | 'backdropFilter';
  /** 当前值（受控） */
  value: string;
  onFocusStart: () => void;
  onFocusEnd: () => void;
}

interface Fx {
  blur: number;
  brightness: number;
  grayscale: number;
  saturate: number;
  contrast: number;
  hue: number;
  others: string[];
}

const DEFAULT_FX: Fx = { blur: 0, brightness: 1, grayscale: 0, saturate: 1, contrast: 1, hue: 0, others: [] };

function parseFx(v: string): Fx {
  const out: Fx = { ...DEFAULT_FX, others: [] };
  const re = /([a-z-]+)\(([^)]*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v || ''))) {
    const fn = m[1].toLowerCase();
    const num = parseFloat(m[2]);
    const n = Number.isFinite(num) ? num : 0;
    if (fn === 'blur') out.blur = n;
    else if (fn === 'brightness') out.brightness = n;
    else if (fn === 'grayscale') out.grayscale = n > 1 ? n / 100 : n;
    else if (fn === 'saturate') out.saturate = n;
    else if (fn === 'contrast') out.contrast = n;
    else if (fn === 'hue-rotate') out.hue = n;
    else out.others.push(`${m[1]}(${m[2]})`);
  }
  return out;
}

function buildFx(fx: Fx): string {
  const parts: string[] = [];
  if (fx.blur > 0) parts.push(`blur(${fx.blur}px)`);
  if (Math.abs(fx.brightness - 1) > 0.01) parts.push(`brightness(${fx.brightness.toFixed(2)})`);
  if (fx.grayscale > 0) parts.push(`grayscale(${fx.grayscale.toFixed(2)})`);
  if (Math.abs(fx.saturate - 1) > 0.01) parts.push(`saturate(${fx.saturate.toFixed(2)})`);
  if (Math.abs(fx.contrast - 1) > 0.01) parts.push(`contrast(${fx.contrast.toFixed(2)})`);
  if (fx.hue !== 0) parts.push(`hue-rotate(${fx.hue}deg)`);
  parts.push(...fx.others);
  return parts.join(' ');
}

const PRESETS: Array<{ label: string; patch: Partial<Fx>; kind: 'filter' | 'both' }> = [
  { label: '无', patch: { ...DEFAULT_FX }, kind: 'both' },
  { label: '模糊', patch: { blur: 8 }, kind: 'both' },
  { label: '毛玻璃', patch: { blur: 14, saturate: 1.4 }, kind: 'both' },
  { label: '提亮', patch: { brightness: 1.12 }, kind: 'filter' },
  { label: '压暗', patch: { brightness: 0.88 }, kind: 'filter' },
  { label: '灰度', patch: { grayscale: 1 }, kind: 'filter' },
  { label: '高对比', patch: { contrast: 1.25, saturate: 1.1 }, kind: 'filter' },
  { label: '鲜艳', patch: { saturate: 1.5, brightness: 1.04 }, kind: 'filter' },
  { label: '复古', patch: { grayscale: 0.3, contrast: 0.9, brightness: 1.05 }, kind: 'filter' },
  { label: '色相', patch: { hue: 40 }, kind: 'filter' }
];

export function FilterInput(props: Props) {
  const updateStyle = useScene((s) => s.updateStyle);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const isBackdrop = props.schemaKey === 'backdropFilter';
  const parsed = useMemo(() => parseFx(props.value), [props.value]);
  const [fx, setFx] = useState<Fx>(parsed);
  // 外部值变化（撤销 / 切换元素）时同步
  const [lastValue, setLastValue] = useState(props.value);
  if (props.value !== lastValue) {
    setLastValue(props.value);
    setFx(parsed);
  }

  const commit = (next: Fx, final = false) => {
    setFx(next);
    const css = buildFx(next);
    if (final) updateStyle(props.elementId, { [props.schemaKey]: css } as any);
    else updateStyleTransient(props.elementId, { [props.schemaKey]: css } as any);
  };
  const start = () => { beginStyleEdit(); props.onFocusStart(); };
  const end = () => { updateStyle(props.elementId, { [props.schemaKey]: buildFx(fx) } as any); endStyleEdit(); props.onFocusEnd(); };

  const slider = (
    label: string, key: 'blur' | 'brightness' | 'grayscale' | 'saturate' | 'contrast' | 'hue',
    min: number, max: number, step: number, fmt: (n: number) => string
  ) => (
    <div className="fx-row" key={key}>
      <span className="fx-label">{label}</span>
      <input
        className="fx-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={fx[key]}
        onMouseDown={start}
        onChange={(e) => commit({ ...fx, [key]: Number(e.target.value) })}
        onMouseUp={end}
        onKeyUp={end}
      />
      <span className="fx-val">{fmt(fx[key])}</span>
    </div>
  );

  return (
    <div className="fx-editor">
      <div className="fx-presets">
        {PRESETS.filter((p) => p.kind === 'both' || !isBackdrop).map((p) => (
          <button
            key={p.label}
            className="fx-preset"
            onClick={() => {
              beginStyleEdit();
              const next = { ...DEFAULT_FX, ...p.patch } as Fx;
              commit(next, true);
              endStyleEdit();
            }}
            title={`套用「${p.label}」`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {slider(isBackdrop ? '模糊' : '模糊', 'blur', 0, 24, 1, (n) => `${n}px`)}
      {!isBackdrop && slider('亮度', 'brightness', 0.4, 1.8, 0.02, (n) => n.toFixed(2))}
      {!isBackdrop && slider('灰度', 'grayscale', 0, 1, 0.05, (n) => n.toFixed(2))}
      {slider('饱和度', 'saturate', 0.2, 2, 0.05, (n) => n.toFixed(2))}
      {!isBackdrop && slider('对比度', 'contrast', 0.4, 2, 0.05, (n) => n.toFixed(2))}
      {!isBackdrop && slider('色相', 'hue', -180, 180, 1, (n) => `${n}°`)}

      <input
        className="fx-custom"
        value={props.value}
        placeholder={isBackdrop ? '例：blur(12px) saturate(1.4)' : '例：brightness(1.08) grayscale(0.2)'}
        spellCheck={false}
        onChange={(e) => {
          // 手写值：直接透传（支持任意 CSS 滤镜函数）
          updateStyleTransient(props.elementId, { [props.schemaKey]: e.target.value } as any);
        }}
        onFocus={() => beginStyleEdit()}
        onBlur={(e) => {
          updateStyle(props.elementId, { [props.schemaKey]: e.target.value } as any);
          endStyleEdit();
        }}
      />
    </div>
  );
}

export default FilterInput;
