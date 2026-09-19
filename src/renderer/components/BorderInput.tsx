import { useRef } from 'react';
import { useScene, findNode, getEffectiveStyle } from '@store/sceneStore';
import { ColorField } from './ColorPicker';
import { useWheelAdjust } from '@lib/wheelAdjust';

// BlockCanvas · 边框可视化编辑器 (BorderInput)
//
// 目标：把"边框"从一堆分散的文本框，变成**看得见、点得到**的一块：
//   · 顶部实时预览：当前边框长什么样，直接画给你看；
//   · 线型：无 / 实线 / 虚线 / 点线 / 双线（按钮上直接画出来）；
//   · 粗细：滑杆 + 数字，长按数字还能拖动调值；
//   · 四条边独立开关：想只留底边框？点掉上/右/左即可；
//   · 颜色：统一调色盘（全屏遮罩那个）。
//
// 兼容：老项目里写的 `border: 1px solid #ccc` 简写会被自动解析进来，
// 用户一旦在可视化面板里改动，就会改写成 4 条 longhand + style + color（导出代码依旧干净）。

interface Props {
  elementId: string;
  pseudo?: string | null;
}

const SIDES: Array<{ label: string; widthKey: string; styleKey: string; short: string }> = [
  { label: '上', widthKey: 'borderTopWidth', styleKey: 'borderTopStyle', short: 'top' },
  { label: '右', widthKey: 'borderRightWidth', styleKey: 'borderRightStyle', short: 'right' },
  { label: '下', widthKey: 'borderBottomWidth', styleKey: 'borderBottomStyle', short: 'bottom' },
  { label: '左', widthKey: 'borderLeftWidth', styleKey: 'borderLeftStyle', short: 'left' }
];

const STYLE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'none', label: '无' },
  { id: 'solid', label: '实线' },
  { id: 'dashed', label: '虚线' },
  { id: 'dotted', label: '点线' },
  { id: 'double', label: '双线' }
];

function parseShorthand(v: string): { width?: string; style?: string; color?: string } {
  const out: { width?: string; style?: string; color?: string } = {};
  for (const p of v.split(/\s+/).filter(Boolean)) {
    if (/^[\d.]+[a-z%]*$/i.test(p) || /^(thin|medium|thick)$/i.test(p)) out.width = p;
    else if (/^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(p)) out.style = p;
    else out.color = p;
  }
  return out;
}

export function BorderInput({ elementId, pseudo }: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyle = useScene((s) => s.updateStyle);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updatePseudoStyle = useScene((s) => s.updatePseudoStyle);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);

  const node = findNode(scene.root, elementId);
  if (!node) return null;
  const isPseudo = Boolean(pseudo);
  const own = isPseudo
    ? (node.pseudoStyles?.[pseudo!] ?? {})
    : (node.style ?? {});
  const eff = (getEffectiveStyle(node, activeBreakpoint) ?? {}) as Record<string, string | undefined>;
  const S = (isPseudo ? (own as Record<string, string | undefined>) : eff);

  // 简写兼容：没有 longhand 时用 border 简写兜底显示
  const sh = !S.borderTopWidth && !S.borderRightWidth && !S.borderBottomWidth && !S.borderLeftWidth && S.border
    ? parseShorthand(S.border)
    : null;

  const widthOf = (wKey: string): string => (S[wKey] ?? sh?.width ?? '');
  const styleOf = (): string => (S.borderStyle ?? sh?.style ?? (S.border ? 'solid' : 'solid'));
  const colorOf = (): string => (S.borderColor ?? sh?.color ?? '#e2e8f0');

  const widthNums = SIDES.map((s) => parseFloat(widthOf(s.widthKey) || '0') || 0);
  const anySide = widthNums.some((n) => n > 0);
  const uniformWidth = widthNums.every((n) => n === widthNums[0]) ? widthNums[0] : null;
  const currentStyle = styleOf();
  const currentColor = colorOf();

  // 写入：统一转成 longhand（并清掉简写，避免两份值打架）
  const commit = (patch: Record<string, string | undefined>, transient = false) => {
    const body = { ...patch, border: undefined } as Record<string, string | undefined>;
    if (isPseudo) updatePseudoStyle(elementId, pseudo!, body as any);
    else if (transient) updateStyleTransient(elementId, body as any);
    else updateStyle(elementId, body as any);
  };

  const setAllWidths = (px: number, transient = false) => {
    const patch: Record<string, string | undefined> = {};
    SIDES.forEach((s, i) => {
      const cur = widthNums[i];
      if (cur > 0 || px > 0) patch[s.widthKey] = px + 'px';
    });
    commit(patch, transient);
  };

  const setStyle = (v: string) => {
    beginStyleEdit();
    const patch: Record<string, string | undefined> = { borderStyle: v };
    if (v === 'none') SIDES.forEach((s) => { patch[s.widthKey] = '0px'; });
    else SIDES.forEach((s, i) => { if (widthNums[i] <= 0) patch[s.widthKey] = '1px'; });
    commit(patch);
    endStyleEdit();
  };

  const toggleSide = (i: number) => {
    beginStyleEdit();
    const wKey = SIDES[i].widthKey;
    const cur = widthNums[i];
    commit({ [wKey]: cur > 0 ? '0px' : `${uniformWidth && uniformWidth > 0 ? uniformWidth : 1}px` });
    endStyleEdit();
  };

  // 粗细数字框：聚焦后滚轮调值（Shift ×10）
  const baseRef = useRef(uniformWidth ?? 1);
  baseRef.current = uniformWidth ?? (widthNums.find((n) => n > 0) ?? 1);
  const wheel = useWheelAdjust({
    getBase: () => baseRef.current,
    min: 0,
    onStart: () => beginStyleEdit(),
    onPreview: (v) => setAllWidths(Math.max(0, Math.round(v)), true),
    onCommit: (v) => { setAllWidths(Math.max(0, Math.round(v))); endStyleEdit(); }
  });

  // v0.4.4 修复：预览**逐边独立** —— 过去预览用"统一宽度"画四条边，
  // 单独勾选某一边时预览完全对不上（四边同宽同显）。
  const previewStyle: React.CSSProperties = {
    borderTop: `${widthNums[0]}px ${currentStyle} ${currentColor}`,
    borderRight: `${widthNums[1]}px ${currentStyle} ${currentColor}`,
    borderBottom: `${widthNums[2]}px ${currentStyle} ${currentColor}`,
    borderLeft: `${widthNums[3]}px ${currentStyle} ${currentColor}`
  };
  const lastRangeW = useRef(uniformWidth ?? 0);

  return (
    <div className="border-editor">
      {/* 实时预览 */}
      <div className="be-preview-wrap">
        <div className="be-preview" style={previewStyle}>
          <span>边框预览</span>
        </div>
        <div className="be-sides">
          {SIDES.map((s, i) => (
            <button
              key={s.short}
              className={'be-side-btn' + (widthNums[i] > 0 ? ' active' : '')}
              onClick={() => toggleSide(i)}
              title={widthNums[i] > 0 ? `关闭「${s.label}」边框` : `打开「${s.label}」边框`}
            >{s.label}</button>
          ))}
        </div>
      </div>

      {/* 线型 */}
      <div className="be-row">
        <span className="be-label">线型</span>
        <div className="be-styles">
          {STYLE_OPTIONS.map((o) => (
            <button
              key={o.id}
              className={'be-style-btn' + (currentStyle === o.id ? ' active' : '')}
              onClick={() => setStyle(o.id)}
              title={o.label}
            >
              <span className={'be-style-sample is-' + o.id} />
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* 粗细 */}
      <div className="be-row">
        <span className="be-label">粗细</span>
        <input
          type="range"
          min={0}
          max={16}
          step={1}
          value={uniformWidth ?? (widthNums.find((n) => n > 0) ?? 0)}
          onPointerDown={() => beginStyleEdit()}
          onChange={(e) => { const n = Number(e.target.value); lastRangeW.current = n; setAllWidths(n, true); }}
          onPointerUp={() => { setAllWidths(lastRangeW.current); endStyleEdit(); }}
          className="be-width-range"
          title="拖动调整四边边框粗细"
        />
        <input
          ref={wheel.ref}
          type="text"
          className="be-width-num"
          value={String(uniformWidth ?? (widthNums.find((n) => n > 0) ?? 0))}
          title="点一下进入输入状态：滚动滚轮调粗细（上滚变粗 / 下滚变细），按住 Shift 一次调 10"
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (!Number.isNaN(n)) setAllWidths(Math.max(0, n));
          }}
          onBlur={wheel.finish}
        />
        <span className="be-unit">px</span>
      </div>

      {/* 颜色 */}
      <div className="be-row">
        <span className="be-label">颜色</span>
        <div className="be-color">
          <ColorField
            value={S.borderColor ?? sh?.color ?? ''}
            fallback="#e2e8f0"
            onInputFocus={() => beginStyleEdit()}
            onChange={(c) => commit({ borderColor: c }, true)}
            onInputBlur={(c) => { commit({ borderColor: c }); endStyleEdit(); }}
            onModalOpen={() => beginStyleEdit()}
            onModalClose={(c) => { commit({ borderColor: c }); endStyleEdit(); }}
          />
        </div>
      </div>

      {!anySide && currentStyle !== 'none' && (
        <div className="be-hint">当前四边粗细都是 0，看不出边框。拖动上面的「粗细」或点开某一侧即可。</div>
      )}
    </div>
  );
}

export default BorderInput;
