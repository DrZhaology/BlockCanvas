import { useState, useEffect, useRef } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { applyUnit, CSS_UNITS, UNIT_LABELS } from '@lib/propertySchema';

// BlockCanvas · Box4 输入组件（4 个输入框，分别填 上 右 下 左）
// 目前用于 border-width；margin/padding/border-radius 已改用 TrblInput 简写输入
// 每侧一个受控输入：onChange 用 transient 实时预览，onBlur 提交"最新值"（不再有闭包旧值问题）
// 三段式：beginStyleEdit 标记起点 → transient 不入历史 → blur commit 入栈一次

interface SideDef { key: string; label: string }

interface Props {
  elementId: string;
  sides: SideDef[];
  fallback?: string;
  /** 数值缺单位时自动补全（如 'px'），见 schema.unit */
  unit?: string;
}

export function Box4Input(props: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);
  const elementId = props.elementId;
  const [u, setU] = useState(props.unit ?? 'px');

  const node = findNode(scene.root, elementId);
  if (!node) return null;

  const style = (node.style ?? {}) as Record<string, string | undefined>;

  return (
    <div className="box4">
      {props.sides.map((s) => (
        <Box4Cell
          key={s.key}
          label={s.label}
          keyName={s.key}
          current={style[s.key] ?? ''}
          fallback={props.fallback ?? ''}
          elementId={elementId}
          unit={u}
          beginStyleEdit={beginStyleEdit}
          endStyleEdit={endStyleEdit}
          updateStyleTransient={updateStyleTransient}
          updateStyle={updateStyle}
        />
      ))}
      <div className="box4-unit-row">
        <span className="box4-label">单位</span>
        <select
          className="unit-select"
          value={u}
          onChange={(e) => {
            const nu = e.target.value;
            setU(nu);
            // 换单位：4 个框的数字全部带上新单位（缺单位才补）
            const patch: Record<string, string> = {};
            for (const s of props.sides) patch[s.key] = applyUnit(style[s.key] ?? '', nu);
            updateStyle(elementId, patch);
          }}
          title="没有写单位的数字自动补这个单位"
        >
          {CSS_UNITS.map((un) => (
            <option key={un} value={un} title={UNIT_LABELS[un]}>
              {un}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Box4Cell(props: {
  label: string;
  keyName: string;
  current: string;
  fallback: string;
  elementId: string;
  unit?: string;
  beginStyleEdit: () => void;
  endStyleEdit: () => void;
  updateStyleTransient: (id: string, partial: Record<string, string>) => void;
  updateStyle: (id: string, partial: Record<string, string>) => void;
}) {
  const [v, setV] = useState(props.current);
  const editingRef = useRef(false);
  // 外部变化（撤销/重做）时同步；编辑中不打断输入（否则单位会反复贴回去）
  useEffect(() => {
    if (!editingRef.current) setV(props.current);
  }, [props.current]);

  return (
    <div className="box4-cell">
      <span className="box4-label">{props.label}</span>
      <input
        type="text"
        value={v}
        placeholder={props.fallback}
        onFocus={() => {
          editingRef.current = true;
          props.beginStyleEdit();
        }}
        onChange={(e) => {
          const next = e.target.value;
          setV(next);
          props.updateStyleTransient(props.elementId, { [props.keyName]: applyUnit(next, props.unit) });
        }}
        onBlur={() => {
          editingRef.current = false;
          props.updateStyle(props.elementId, { [props.keyName]: applyUnit(v, props.unit) });
          props.endStyleEdit();
        }}
      />
    </div>
  );
}