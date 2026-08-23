import { useState, useEffect, useRef } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { CSS_UNITS, UNIT_LABELS } from '@lib/propertySchema';
import { StepDrag } from '@comp/StepDrag';
import { dragSteps } from '@lib/drag';

// BlockCanvas · 数值输入（数字框 + 单位下拉）
// - 数字框只输入数字（可负、可小数、可空 = 清除）
// - 单位用右侧下拉选择，改动即提交；? 帮助里有每个单位的详细讲解
// - auto（允许时）：数字框禁用，直接显示 "auto"
// - 自定义：输入复杂值如 calc(100% - 20px)，透传原文
// - 编辑中（focus 内）不做 store→输入框的反向同步，
//   避免"px 删不掉"循环：旧实现每次击键都 applyUnit 写回 store，
//   再被 useEffect 同步回输入框，导致单位和 px 始终删不掉

interface Props {
  elementId: string;
  schemaKey: string;
  /** 默认单位（schema.unit） */
  unit: string;
  /** 是否允许 auto 占位 */
  allowAuto?: boolean;
}

export function NumberUnitInput(props: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);
  const { elementId, schemaKey, unit: defaultUnit, allowAuto } = props;

  const node = findNode(scene.root, elementId);
  const style = (node?.style ?? {}) as Record<string, string | undefined>;
  const value = style[schemaKey] ?? '';

  // 解析存储值 → {数字部分, 单位部分}；写不进的当"自定义"透传
  const parsed = parseValue(value);
  const [num, setNum] = useState(parsed.num);
  const [u, setU] = useState(normalizeUnit(parsed, defaultUnit));
  const editingRef = useRef(false);

  // 外部变化（撤销/重做/切换元素）时同步显示；编辑中不打断用户输入
  useEffect(() => {
    if (editingRef.current) return;
    const p = parseValue(value);
    setNum(p.num);
    setU(normalizeUnit(p, defaultUnit));
  }, [value]);

  const commit = (v: string) => updateStyle(elementId, { [schemaKey]: v } as any);

  const units = [...CSS_UNITS, ...(allowAuto ? ['auto'] : []), 'custom'];

  const onNumChange = (v: string) => {
    setNum(v);
    updateStyleTransient(elementId, { [schemaKey]: compose(v, u) } as any);
  };

  const onUnitChange = (nu: string) => {
    setU(nu);
    if (nu === 'auto') {
      setNum('auto');
      commit('auto');
      return;
    }
    if (nu === 'custom') {
      commit(num);
      return;
    }
    commit(compose(num, nu));
  };

  const isAuto = u === 'auto';

  // ↑↓ 拖拽微调（灵敏度同画布缩放）。在数字与单位之间加一个 ↑↓ 按钮：
  // 按住左右拖动调数值；纯单击 +1。auto/custom（复杂值）时禁用。
  const stepBase = useRef(0);
  const dragValRef = useRef<string | null>(null);
  const stepStart = () => {
    beginStyleEdit();
    stepBase.current = parseFloat(num) || 0;
  };
  const stepDrag = (dx: number) => {
    const n = stepBase.current + dragSteps(dx);
    const s = String(Math.round(n));
    dragValRef.current = s;
    setNum(s);
    updateStyleTransient(elementId, { [schemaKey]: compose(s, u) } as any);
  };
  const stepCommit = () => {
    const finalNum = dragValRef.current ?? num;
    dragValRef.current = null;
    commit(compose(finalNum, u));
    endStyleEdit();
  };
  const stepClick = () => {
    const cur = parseFloat(num);
    if (Number.isNaN(cur)) return;
    beginStyleEdit();
    const s = String(Math.round(cur + 1));
    setNum(s);
    commit(compose(s, u));
    endStyleEdit();
  };

  return (
    <div className="num-unit-row">
      <input
        type="text"
        className="num-unit-num"
        inputMode="decimal"
        value={num}
        placeholder={isAuto ? 'auto' : '只填数字'}
        disabled={isAuto}
        onFocus={() => {
          editingRef.current = true;
          beginStyleEdit();
        }}
        onChange={(e) => onNumChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onBlur={() => {
          editingRef.current = false;
          commit(compose(num, u));
          endStyleEdit();
        }}
      />
      <StepDrag
        className="num-unit-step"
        title="按住后左右拖动微调（灵敏度同画布缩放）；单击 +1"
        disabled={isAuto || u === 'custom'}
        onDragStart={stepStart}
        onAdjust={stepDrag}
        onDragEnd={stepCommit}
        onStep={stepClick}
      />
      <select
        className="unit-select"
        value={u}
        onChange={(e) => onUnitChange(e.target.value)}
        title="数值单位：选一个单位，数字部分保持不变"
      >
        {units.map((un) => (
          <option key={un} value={un} title={UNIT_LABELS[un]}>
            {un === '%' ? '%' : un === 'custom' ? '自定义' : un === 'auto' ? 'auto' : un}
          </option>
        ))}
      </select>
    </div>
  );
}

// ============ 解析 / 归一 / 拼接 ============
function parseValue(v: string): { num: string; unit: string } {
  const s = v.trim();
  if (!s) return { num: '', unit: '' };
  if (/^auto$/i.test(s)) return { num: 'auto', unit: 'auto' };
  const m = /^(-?[0-9]*\.?[0-9]+)\s*([a-z%]+)?$/i.exec(s);
  if (m && m[1] !== '') return { num: m[1], unit: (m[2] ?? '').toLowerCase() };
  return { num: s, unit: 'custom' };
}

function normalizeUnit(p: { num: string; unit: string }, defaultUnit: string): string {
  if (p.unit === 'auto') return 'auto';
  if (p.unit === 'custom') return 'custom';
  if (!p.unit) return p.num === '' ? defaultUnit : 'custom'; // 旧数据裸数字：当自定义透传
  if (CSS_UNITS.includes(p.unit)) return p.unit;
  return 'custom'; // 未知单位（cqw 等新单位）→ 自定义透传
}

function compose(num: string, unit: string): string {
  if (unit === 'auto') return 'auto';
  if (unit === 'custom') return num;
  if (num.trim() === '') return '';
  return num + unit;
}