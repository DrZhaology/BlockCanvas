import { useState, useEffect, useRef } from 'react';
import { useScene, findNode, getEffectiveStyle } from '@store/sceneStore';
import { ColorField } from './ColorPicker';

// BlockCanvas · 盒子阴影可视化组件 (BoxShadowInput)
//
// v0.4.0 重写，修掉了一批真 BUG：
//  1. **颜色解析错乱**：旧实现用 /[a-z]+/ 抓颜色，`0 4px 12px rgba(...)` 里会先匹配到 "px"，
//     于是颜色变成 "px"，生成 `0px 4px 12px px` 这种非法值 → 画布上阴影直接失效。
//     现在只认 rgb()/rgba()/hsl()/#hex/命名色，并且先把颜色从数字串里剔除再解析数值。
//  2. **松手提交旧值**：滑杆拖动过程中用闭包里的旧 state 提交，最后一步经常丢。
//     现在统一用 ref 记录最新值，松手时提交 ref。
//  3. **多层阴影被吃掉**：只编辑第一层，其余层原样保留。
//
// 另加：顶部实时预览（所见即所得）、常用预设、内阴影开关、颜色走统一调色盘。

interface Props {
  elementId: string;
  pseudo?: string | null;
}

interface ParsedShadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
  has: boolean;
}

/** 拆分多层阴影（只按顶层逗号切，括号内的逗号不动） */
function splitShadows(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of v) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

const NAMED = 'transparent|currentcolor|black|white|gray|grey|red|green|blue|yellow|orange|purple|pink|brown|cyan|magenta|lime|silver|gold|navy|teal|olive|maroon';

function parseBoxShadow(val: string): ParsedShadow {
  const res: ParsedShadow = { x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0, 0, 0, 0.15)', inset: false, has: false };
  if (!val || typeof val !== 'string') return res;
  const first = splitShadows(val)[0];
  if (!first) return res;
  res.has = true;
  res.inset = /\binset\b/i.test(first);

  // 颜色：只认合法颜色写法（绝不能把 "px" 当成颜色）
  const colorMatch = /(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8})/.exec(first);
  if (colorMatch) {
    res.color = colorMatch[1];
  } else {
    const named = new RegExp(`(?:^|[\\s,])(${NAMED})(?:$|[\\s,])`, 'i').exec(first);
    if (named) res.color = named[1];
  }

  // 数值：先把颜色和 inset 剔除，剩下的数字按 顺序 = x / y / blur / spread
  const stripped = first
    .replace(/\binset\b/ig, ' ')
    .replace(/rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8}/g, ' ')
    .replace(new RegExp(`\\b(${NAMED})\\b`, 'ig'), ' ');
  const nums = stripped.split(/[\s,]+/).map((t) => parseFloat(t)).filter((n) => !Number.isNaN(n));
  if (nums.length >= 2) {
    res.x = nums[0];
    res.y = nums[1];
    res.blur = nums.length >= 3 ? nums[2] : 0;
    res.spread = nums.length >= 4 ? nums[3] : 0;
  }
  return res;
}

/** 由分项拼回 box-shadow（保留用户原有的其余阴影层） */
function composeBoxShadow(p: ParsedShadow, rest: string[]): string {
  const allZero = p.x === 0 && p.y === 0 && p.blur === 0 && p.spread === 0;
  if (allZero && !p.has) return '';
  const parts: string[] = [];
  if (p.inset) parts.push('inset');
  parts.push(`${p.x}px`, `${p.y}px`, `${p.blur}px`);
  if (p.spread !== 0) parts.push(`${p.spread}px`);
  parts.push(p.color || 'rgba(0, 0, 0, 0.15)');
  const all = [parts.join(' '), ...rest].filter(Boolean).join(', ');
  return allZero && !p.inset ? '' : all;
}

const PRESETS: Array<{ label: string; css: string; hint: string }> = [
  { label: '☁️ 浅浮雕', css: '0 2px 8px rgba(0, 0, 0, 0.08)', hint: '轻微浮起，适合大区块' },
  { label: '📦 立体悬浮', css: '0 10px 25px rgba(0, 0, 0, 0.15)', hint: '卡片 hover / 弹层常用' },
  { label: '🪶 轻柔贴地', css: '0 1px 3px rgba(0, 0, 0, 0.1)', hint: '几乎察觉不到的细腻投影' },
  { label: '💡 蓝色光晕', css: '0 0 16px rgba(30, 136, 229, 0.4)', hint: '聚焦 / 选中态的发光' },
  { label: '🏮 弥散深影', css: '0 20px 40px rgba(0, 0, 0, 0.25)', hint: '模态框、抽屉的大范围投影' },
  { label: '🕳 内凹', css: 'inset 0 3px 8px rgba(0, 0, 0, 0.2)', hint: '像被按进表面的凹陷感' }
];

export function BoxShadowInput({ elementId, pseudo }: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);
  const updatePseudoStyle = useScene((s) => s.updatePseudoStyle);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);

  const node = findNode(scene.root, elementId);
  const effStyle = node ? (getEffectiveStyle(node, activeBreakpoint) as any) : {};
  const isPseudo = Boolean(pseudo);
  const currentStr = (
    isPseudo
      ? (node?.pseudoStyles?.[pseudo!]?.boxShadow as string)
      : (effStyle?.boxShadow as string)
  ) ?? '';

  const parsed = parseBoxShadow(currentStr);
  const [x, setX] = useState(parsed.x);
  const [y, setY] = useState(parsed.y);
  const [blur, setBlur] = useState(parsed.blur);
  const [spread, setSpread] = useState(parsed.spread);
  const [color, setColor] = useState(parsed.color);
  const [inset, setInset] = useState(parsed.inset);

  const editingRef = useRef(false);
  // 多层阴影的其余层（只编辑第一层，其余原样保留）
  const restRef = useRef<string[]>(splitShadows(currentStr).slice(1));

  useEffect(() => {
    if (editingRef.current) return;
    const p = parseBoxShadow(currentStr);
    setX(p.x); setY(p.y); setBlur(p.blur); setSpread(p.spread);
    setColor(p.color); setInset(p.inset);
    restRef.current = splitShadows(currentStr).slice(1);
  }, [currentStr]);

  // 最新值镜像：松手提交时用它，避免"提交到旧值"
  const live = useRef({ x, y, blur, spread, color, inset });
  live.current = { x, y, blur, spread, color, inset };

  const commitValue = (valStr: string) => {
    if (isPseudo) {
      updatePseudoStyle(elementId, pseudo!, { boxShadow: (valStr || undefined) as any });
    } else {
      updateStyle(elementId, { boxShadow: valStr || undefined });
    }
  };

  const write = (transient: boolean) => {
    const css = composeBoxShadow({ ...live.current, has: true }, restRef.current);
    if (isPseudo) commitValue(css);
    else if (transient) updateStyleTransient(elementId, { boxShadow: css || undefined });
    else commitValue(css);
  };

  const apply = (next: Partial<ParsedShadow>, commit = false) => {
    if (next.x !== undefined) setX(next.x);
    if (next.y !== undefined) setY(next.y);
    if (next.blur !== undefined) setBlur(next.blur);
    if (next.spread !== undefined) setSpread(next.spread);
    if (next.color !== undefined) setColor(next.color);
    if (next.inset !== undefined) setInset(next.inset);
    live.current = { ...live.current, ...next };
    if (commit) { write(false); endStyleEdit(); } else { write(true); }
  };

  const applyPreset = (css: string) => {
    beginStyleEdit();
    const p = parseBoxShadow(css);
    restRef.current = splitShadows(css).slice(1);
    setX(p.x); setY(p.y); setBlur(p.blur); setSpread(p.spread); setColor(p.color); setInset(p.inset);
    live.current = { x: p.x, y: p.y, blur: p.blur, spread: p.spread, color: p.color, inset: p.inset };
    commitValue(css);
    endStyleEdit();
  };

  const previewCss = composeBoxShadow({ ...live.current, has: true }, restRef.current) || 'none';

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onSet: (n: number) => void,
    unit = 'px'
  ) => (
    <div className="vis-control-row">
      <span className="vis-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => { editingRef.current = true; beginStyleEdit(); }}
        onChange={(e) => onSet(parseFloat(e.target.value) || 0)}
        onPointerUp={() => { editingRef.current = false; apply({}, true); }}
      />
      <span className="vis-num">{value}{unit}</span>
    </div>
  );

  return (
    <div className="vis-shadow-wrap">
      {/* 实时预览：一眼看到阴影到底长什么样 */}
      <div className="bs-preview-wrap">
        <div className="bs-preview" style={{ boxShadow: previewCss }}>阴影预览</div>
      </div>

      {/* 常用预设 */}
      <div className="vis-preset-row">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className={'btn-mini' + (currentStr === p.css ? ' active' : '')}
            onClick={() => applyPreset(p.css)}
            title={p.hint}
          >{p.label}</button>
        ))}
        {currentStr && (
          <button className="btn-mini btn-danger" onClick={() => applyPreset('')} title="清除阴影">
            🚫 无阴影
          </button>
        )}
      </div>

      {/* 分项微调 */}
      <div className="vis-controls-grid">
        {slider('垂直偏移 Y', y, -40, 60, 1, (n) => apply({ y: n }))}
        {slider('水平偏移 X', x, -40, 40, 1, (n) => apply({ x: n }))}
        {slider('模糊大小', blur, 0, 80, 1, (n) => apply({ blur: n }))}
        {slider('扩散范围', spread, -20, 40, 1, (n) => apply({ spread: n }))}

        <div className="vis-control-row-full">
          <div className="vis-shadow-color-wrap">
            <span className="vis-label">阴影颜色</span>
            <ColorField
              value={color}
              fallback="rgba(0,0,0,0.15)"
              onInputFocus={() => { editingRef.current = true; beginStyleEdit(); }}
              onChange={(c) => { setColor(c); live.current.color = c; write(true); }}
              onInputBlur={(c) => { setColor(c); live.current.color = c; write(false); editingRef.current = false; endStyleEdit(); }}
              onModalOpen={() => { editingRef.current = true; beginStyleEdit(); }}
              onModalClose={(c) => { setColor(c); live.current.color = c; write(false); editingRef.current = false; endStyleEdit(); }}
            />
          </div>
          <label className="vis-check-label" title="内阴影：阴影画在元素内部">
            <input
              type="checkbox"
              checked={inset}
              onChange={(e) => { beginStyleEdit(); apply({ inset: e.target.checked }, true); }}
            />
            内阴影
          </label>
        </div>
      </div>
    </div>
  );
}

export default BoxShadowInput;
