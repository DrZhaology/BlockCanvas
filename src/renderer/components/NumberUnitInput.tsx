import { useState, useEffect, useRef } from 'react';
import { useScene, findNode, getEffectiveStyle } from '@store/sceneStore';
import { CSS_UNITS, UNIT_LABELS } from '@lib/propertySchema';
import { useWheelAdjust } from '@lib/wheelAdjust';

// BlockCanvas · 数值输入（数字框 + 单位下拉）
//
// 交互（v0.4.0 定稿）：**去掉 ↑↓ 小按钮**，改为滚轮调值：
//  · 点一下输入框 → 正常聚焦、正常打字；
//  · 聚焦状态下滚动滚轮 → 上滚增大 / 下滚减小；按住 Shift 步进 ×10；
//  · 停止滚动约 0.26s 自动提交（一次聚焦 = 一条撤销记录）。
//  · auto / custom（复杂值）时自动禁用滚轮调值，避免误改。
//
// 其余约定：
//  - 数字框只输入数字（可负、可小数、可空 = 清除）；单位用右侧下拉选择
//  - 编辑中（focus 内）不做 store→输入框的反向同步，避免"px 删不掉"循环

interface Props {
  elementId: string;
  schemaKey: string;
  /** 默认单位（schema.unit） */
  unit: string;
  /** 是否允许 auto 占位 */
  allowAuto?: boolean;
  pseudo?: string | null;
}

export function NumberUnitInput(props: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);
  const updatePseudoStyle = useScene((s) => s.updatePseudoStyle);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);
  const { elementId, schemaKey, unit: defaultUnit, allowAuto, pseudo } = props;

  const isPseudo = Boolean(pseudo);
  const node = findNode(scene.root, elementId);
  const effStyle = node ? (getEffectiveStyle(node, activeBreakpoint) as any) : {};
  const value = isPseudo
    ? ((node?.pseudoStyles?.[pseudo!]?.[schemaKey] as string) ?? '')
    : ((effStyle[schemaKey] as string) ?? '');

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

  const commit = (v: string) => {
    if (isPseudo) {
      updatePseudoStyle(elementId, pseudo!, { [schemaKey]: v || undefined as any });
    } else {
      updateStyle(elementId, { [schemaKey]: v } as any);
    }
  };

  const units = [...CSS_UNITS, ...(allowAuto ? ['auto'] : []), 'custom'];

  const onNumChange = (v: string) => {
    let currentUnit = u;
    if (u === 'auto') {
      currentUnit = defaultUnit || 'px';
      setU(currentUnit);
    }
    setNum(v);
    if (isPseudo) {
      updatePseudoStyle(elementId, pseudo!, { [schemaKey]: compose(v, currentUnit) });
    } else {
      updateStyleTransient(elementId, { [schemaKey]: compose(v, currentUnit) } as any);
    }
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
    const cleanNum = num === 'auto' ? '' : num;
    setNum(cleanNum);
    commit(compose(cleanNum, nu));
  };

  const isAuto = u === 'auto';
  const dragDisabled = isAuto || u === 'custom';

  // —— 滚轮调数值（替代原 ↑↓ 按钮，也替代早先的长按拖动）——
  const numRef = useRef(num);
  numRef.current = num;
  const wheel = useWheelAdjust({
    disabled: dragDisabled,
    getBase: () => parseFloat(numRef.current) || 0,
    // 值里本来就有小数（如 1.5 / 0.75）时按两位小数步进，否则走整数
    precision: /\./.test(numRef.current) ? 2 : 0,
    onStart: () => { editingRef.current = true; beginStyleEdit(); },
    onPreview: (v) => {
      const s = String(v);
      setNum(s);
      if (isPseudo) updatePseudoStyle(elementId, pseudo!, { [schemaKey]: compose(s, u) });
      else updateStyleTransient(elementId, { [schemaKey]: compose(s, u) } as any);
    },
    onCommit: (v) => {
      const s = String(v);
      setNum(s);
      commit(compose(s, u));
    }
  });

  return (
    <div className="num-unit-row">
      <input
        ref={wheel.ref}
        type="text"
        className="num-unit-num"
        value={num}
        placeholder={isAuto ? 'auto' : '只填数字'}
        // 单位选 auto 时数值无意义（值就是 auto），禁用数字框避免用户输入被忽略而困惑；
        // 想改回来直接切右侧单位下拉即可。
        disabled={isAuto}
        title={dragDisabled
          ? (isAuto ? '当前单位为 auto（自动计算）；想指定具体数值请切换右侧单位' : '当前为自定义值，请直接在框内输入')
          : '点一下进入输入状态：滚动滚轮调数值（上滚增大 / 下滚减小），按住 Shift 一次调 10'}
        onFocus={() => {
          editingRef.current = true;
          beginStyleEdit();
          if (u === 'auto') {
            setNum('');
            setU(defaultUnit || 'px');
          }
        }}
        onChange={(e) => onNumChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onBlur={() => {
          wheel.finish(); // 把可能还没提交的滚轮调节收尾
          editingRef.current = false;
          commit(compose(numRef.current, u));
          endStyleEdit();
        }}
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
