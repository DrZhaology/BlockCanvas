import { useState, useEffect, useRef } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { applyUnit, CSS_UNITS, UNIT_LABELS } from '@lib/propertySchema';

// BlockCanvas · 简写输入（trbl：top/right/bottom/left）
// 一个输入框，支持 1~4 个值（空格分隔，顺序 上 右 下 左）：
//   - 1 个值：四周相同，如 10px
//   - 2 个值：上下 / 左右，如 0 auto
//   - 3 个值：上 / 左右 / 下
//   - 4 个值：上 右 下 左 分别，如 8px 4px 8px 4px
// 输入时实时（transient）预览；失焦或回车时按 CSS 简写规则拆成 4 边字段提交。
// 超过 4 个值判为非法：失焦时回滚显示，不提交。
// 显示时反向合并：全相等显示 1 个值、上下/左右相等显示 2 个值、左右相等显示 3 个值。

interface SideDef { key: string; label: string }

interface Props {
  elementId: string;
  sides: SideDef[];
  fallback?: string;
  /** 数值缺单位时自动补全（如 'px'），见 schema.unit */
  unit?: string;
  /** 隐藏「单位」下拉：单位直接写在输入框里（如 10px、1rem），裸数字按 unit 补 */
  hideUnit?: boolean;
}

export function TrblInput(props: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);
  const { elementId, sides, fallback, unit, hideUnit } = props;

  const node = findNode(scene.root, elementId);
  const style = (node?.style ?? {}) as Record<string, string | undefined>;

  // 由 4 边字段反向合并出的显示值（外部变化时同步）
  const displayShorthand = toShorthand(style, sides);

  const [text, setText] = useState(displayShorthand);
  const [u, setU] = useState(unit ?? 'px');
  const editingRef = useRef(false);
  // 非编辑态（撤销/重做/外部修改）时跟着 store 走；编辑中不打断用户输入
  useEffect(() => {
    if (!editingRef.current) setText(displayShorthand);
  }, [displayShorthand]);

  return (
    <div className="trbl-row">
      <input
        type="text"
        className="trbl-input"
        value={text}
        placeholder={fallback ? `例：${fallback} / 0 auto / 8px 4px 8px 4px` : '1~4 个值，空格分隔'}
        title="填 1~4 个值，空格分隔，顺序：上 右 下 左。例：10px（四周）、0 auto（上下/左右）、8px 4px 8px 4px"
        onFocus={() => {
          editingRef.current = true;
          beginStyleEdit();
        }}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          const parsed = parseShorthand(v, sides);
          if (parsed) updateStyleTransient(elementId, withUnit(parsed, u));
        }}
        onBlur={() => {
          editingRef.current = false;
          const parsed = parseShorthand(text, sides);
          if (parsed) {
            const patch = withUnit(parsed, u);
            updateStyle(elementId, patch);
            setText(shorthandFromValues(patch, sides));
          } else {
            // 非法输入（如多于 4 个值）：回滚显示，不提交
            setText(displayShorthand);
          }
          endStyleEdit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {!hideUnit && (
        <select
          className="unit-select"
          value={u}
          onChange={(e) => {
            const nu = e.target.value;
            setU(nu);
            // 换单位：所有"缺单位"的数字带上新单位，写死的单位（auto/50% 等）不动
            const parsed = parseShorthand(text, sides);
            if (parsed) {
              const patch = withUnit(parsed, nu);
              updateStyle(elementId, patch);
              setText(shorthandFromValues(patch, sides));
            }
          }}
          title="没有写单位的数字自动补这个单位"
        >
          {CSS_UNITS.map((un) => (
            <option key={un} value={un} title={UNIT_LABELS[un]}>
              {un}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ============ 简写 patch 数值补单位（每个值独立处理） ============
function withUnit(patch: Record<string, string>, unit?: string): Record<string, string> {
  if (!unit) return patch;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) out[k] = applyUnit(v, unit);
  return out;
}

// ============ 解析：CSS 简写 → 4 边字段（按 sides 顺序） ============
// 返回 null 表示非法（值个数超过 4）
export function parseShorthand(v: string, sides: SideDef[]): Record<string, string> | null {
  const tokens = v.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length > 4) return null;

  const vals: string[] = ['', '', '', ''];
  if (tokens.length === 1) {
    vals.fill(tokens[0]);
  } else if (tokens.length === 2) {
    vals[0] = tokens[0]; vals[1] = tokens[1];
    vals[2] = tokens[0]; vals[3] = tokens[1];
  } else if (tokens.length === 3) {
    vals[0] = tokens[0]; vals[1] = tokens[1];
    vals[2] = tokens[2]; vals[3] = tokens[1];
  } else if (tokens.length === 4) {
    vals[0] = tokens[0]; vals[1] = tokens[1];
    vals[2] = tokens[2]; vals[3] = tokens[3];
  }

  const out: Record<string, string> = {};
  sides.forEach((s, i) => { out[s.key] = vals[i]; });
  return out;
}

// ============ 合并：4 边字段 → 最简简写（展示用/入库后回显） ============
function shorthandFromValues(patch: Record<string, string>, sides: SideDef[]): string {
  return shorthandFromVals(sides.map((s) => patch[s.key] ?? ''));
}

export function toShorthand(style: Record<string, string | undefined>, sides: SideDef[]): string {
  const vals = sides.map((s) => style[s.key] ?? '');
  if (vals.every((v) => v === '')) return '';
  // 个别边缺省（罕见）：按 CSS 简写语义用首值补齐，避免显示误导
  const first = vals.find((v) => v !== '') ?? '';
  const filled = vals.map((v) => (v === '' ? first : v));
  return shorthandFromVals(filled);
}

function shorthandFromVals(vals: string[]): string {
  const [a, b, c, d] = vals;
  if (a === b && b === c && c === d) return a;
  if (a === c && b === d) return `${a} ${b}`;
  if (b === d) return `${a} ${b} ${c}`;
  return `${a} ${b} ${c} ${d}`;
}