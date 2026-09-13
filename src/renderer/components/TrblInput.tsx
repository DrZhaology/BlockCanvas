import { useState, useEffect, useRef } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { CSS_UNITS, UNIT_LABELS } from '@lib/propertySchema';

// BlockCanvas · 四值输入（上 / 右 / 下 / 左 分开填写）
// 设计动机：过去是一个"简写输入框"（要用户自己记住 `8px 4px 8px 4px` 的 CSS 简写顺序），
// 新手看不懂也容易写错。现在改为 4 个独立数值框，各自带单位，一眼看清、逐个填。
//   - 仍支持任意 CSS 值：auto / 50% / calc(100% - 20px) 直接写进框里
//   - 「四边同步」开关：勾上后改一个，其余三个自动跟随（做四周等距留白时更快）
//   - 落库仍写 4 个 longhand 字段，导出时由 simplifyStyle 自动合并成简写 → 代码依旧干净

interface SideDef { key: string; label: string }

interface Props {
  elementId: string;
  sides: SideDef[];
  fallback?: string;
  /** 数值缺单位时自动补全（如 'px'），见 schema.unit */
  unit?: string;
  /** 隐藏「单位」下拉：单位直接写在输入框右侧（如 10px、1rem），裸数字按 unit 补 */
  hideUnit?: boolean;
}

export function TrblInput(props: Props) {
  const { elementId, sides, fallback, unit, hideUnit } = props;
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  const [u, setU] = useState(unit ?? 'px');
  const [sync, setSync] = useState(false);

  const node = findNode(scene.root, elementId);
  const style = (node?.style ?? {}) as Record<string, string | undefined>;

  useEffect(() => { setU(unit ?? 'px'); }, [unit, elementId]);

  if (!node) return null;

  const write = (key: string, raw: string, transient: boolean) => {
    const patch: Record<string, string> = {};
    if (sync) {
      for (const s of sides) patch[s.key] = normalize(raw, u);
    } else {
      patch[key] = normalize(raw, u);
    }
    if (transient) updateStyleTransient(elementId, patch);
    else updateStyle(elementId, patch);
  };

  const changeUnit = (nu: string) => {
    setU(nu);
    const patch: Record<string, string> = {};
    for (const s of sides) {
      const v = style[s.key];
      if (v) patch[s.key] = normalize(stripUnit(v, u), nu);
    }
    if (Object.keys(patch).length > 0) updateStyle(elementId, patch);
  };

  return (
    <div className="trbl4">
      <div className="trbl4-head">
        <span className="trbl4-head-title">
          上 / 右 / 下 / 左 分开填写
          {fallback ? <span className="trbl4-head-hint">（例：{fallback}）</span> : null}
        </span>
        <div className="trbl4-head-right">
          <label className="trbl4-sync" title="勾选后：改任意一边，其余三边自动跟随（做四周等距留白更快）">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
            四边同步
          </label>
          {!hideUnit && (
            <select
              className="unit-select trbl4-unit-select"
              value={u}
              onChange={(e) => changeUnit(e.target.value)}
              title="没有写单位的数字自动补这个单位"
            >
              {CSS_UNITS.map((un) => (
                <option key={un} value={un} title={UNIT_LABELS[un]}>{un}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="trbl4-grid">
        {sides.map((s) => (
          <Trbl4Cell
            key={s.key}
            label={s.label}
            value={style[s.key] ?? ''}
            unit={u}
            elementId={elementId}
            onBegin={beginStyleEdit}
            onEnd={endStyleEdit}
            onChange={(raw) => write(s.key, raw, true)}
            onCommit={(raw) => write(s.key, raw, false)}
          />
        ))}
      </div>
    </div>
  );
}

function Trbl4Cell(props: {
  label: string;
  value: string;
  unit: string;
  elementId: string;
  onBegin: () => void;
  onEnd: () => void;
  onChange: (raw: string) => void;
  onCommit: (raw: string) => void;
}) {
  const { label, value, unit } = props;
  const [draft, setDraft] = useState(value);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(value);
  }, [value]);

  const { num, hasUnit } = splitVal(value, unit);

  return (
    <div className="trbl4-cell">
      <span className="trbl4-label">{label}</span>
      <div className="trbl4-input-wrap">
        <span className={'trbl4-spacer' + (hasUnit ? '' : ' is-hidden')}>{unit}</span>
        <input
          type="text"
          className="trbl4-input"
          value={editingRef.current ? draft : (num || '')}
          placeholder="0"
          spellCheck={false}
          onFocus={() => { editingRef.current = true; setDraft(num || ''); props.onBegin(); }}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            props.onChange(raw);
          }}
          onBlur={() => {
            editingRef.current = false;
            props.onCommit(draft);
            setDraft('');
            props.onEnd();
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        <span className={'trbl4-unit' + (hasUnit ? '' : ' is-hidden')}>{unit}</span>
      </div>
    </div>
  );
}

// ============ 数值 / 单位拆分 ============
// 16px + 单位 px → 显示 "16" 并展示 px 后缀
// auto / 50% / calc(...) 等 → 原样显示且不展示后缀
function splitVal(v: string, unit: string): { num: string; hasUnit: boolean } {
  if (!v) return { num: '', hasUnit: true };
  const m = v.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)$/i);
  if (m && (!m[2] || m[2].toLowerCase() === unit.toLowerCase())) return { num: m[1], hasUnit: true };
  return { num: v, hasUnit: false };
}

function stripUnit(v: string, unit: string): string {
  const m = v.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)$/i);
  if (m && (!m[2] || m[2].toLowerCase() === unit.toLowerCase())) return m[1];
  return v;
}

// ============ 裸数字补单位（其余值原样保留） ============
function normalize(raw: string, unit: string): string {
  const t = raw.trim();
  if (t === '') return '';
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return t + unit;
  return t;
}

// ============ 兼容导出（旧调用方可能引用） ============
export interface TrblSideDef { key: string; label: string }

/** 4 边字段 → 最简简写（导出/展示用） */
export function toShorthand(style: Record<string, string | undefined>, sides: TrblSideDef[]): string {
  const vals = sides.map((s) => style[s.key] ?? '');
  if (vals.every((v) => v === '')) return '';
  const first = vals.find((v) => v !== '') ?? '';
  const filled = vals.map((v) => (v === '' ? first : v));
  const [a, b, c, d] = filled;
  if (a === b && b === c && c === d) return a;
  if (a === c && b === d) return `${a} ${b}`;
  if (b === d) return `${a} ${b} ${c}`;
  return `${a} ${b} ${c} ${d}`;
}
