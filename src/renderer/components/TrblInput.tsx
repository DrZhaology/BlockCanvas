import { useState, useEffect, useRef } from 'react';
import { useScene, findNode, getEffectiveStyle } from '@store/sceneStore';
import { CSS_UNITS, UNIT_LABELS } from '@lib/propertySchema';
import { useWheelAdjust } from '@lib/wheelAdjust';
import { tokenRef } from '@lib/designTokens';
import { VarMenu } from './VarMenu';

// BlockCanvas · 四值输入（上 / 右 / 下 / 左 分开填写）
// 设计动机：过去是一个"简写输入框"（要用户自己记住 `8px 4px 8px 4px` 的 CSS 简写顺序），
// 新手看不懂也容易写错。现在改为 4 个独立数值框，各自带单位，一眼看清、逐个填。
//
// v0.4.0 改动：
//  · **单位可以改了**：右上角保留单位下拉（原来被隐藏，导致内外边距没法换单位）；
//  · 每个数值框都支持「长按拖动调值」（和 NumberUnitInput 同一套交互）；
//  · 去掉一排"常用值胶囊"（用户反馈多余），保持面板清爽。
//
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
}

export function TrblInput(props: Props) {
  const { elementId, sides, fallback, unit } = props;
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  const [u, setU] = useState(unit ?? 'px');
  // 「四边同步」是操作习惯，但 v0.4.5 起**不再记忆**：每次打开都是分边独立。
  // 原因：上次勾着的话，用户改一边另外三边跟着变，很容易在不知情的情况下把
  // 原本不对称的 padding/margin 抹平（用户反馈"为什么自动四边同步"）。
  const [sync, setSync] = useState(false);

  const node = findNode(scene.root, elementId);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);
  /**
   * v0.4.5：显示值必须用**当前断点合并后的样式**。
   *
   * 写入是跟着断点走的（非 desktop 断点写进 `responsive[bp]`），
   * 以前这里读的是 `node.style`（基础层）→ 在平板/手机断点下，明明设了 margin，
   * 四个输入框却全是空的；再滚一下滚轮，数值就从 0 重新开始，看起来像"值被清空"。
   */
  const style = (node ? getEffectiveStyle(node, activeBreakpoint) : {}) as Record<string, string | undefined>;

  useEffect(() => { setU(unit ?? 'px'); }, [unit, elementId]);

  if (!node) return null;

  const write = (key: string, raw: string, transient: boolean) => {
    const patch: Record<string, string> = {};
    // v0.4.5：允许直接写变量引用 var(--x)。这种值不能再拼单位，
    // 否则会变成 var(--x)px 这种非法值（以前 padding/margin 用不了变量就是卡在这）。
    const isVar = /^\s*var\(/.test(raw);
    const val = isVar ? raw.trim() : normalize(raw, u);
    if (sync) {
      for (const s of sides) patch[s.key] = val;
    } else {
      patch[key] = val;
    }
    if (transient) updateStyleTransient(elementId, patch);
    else updateStyle(elementId, patch);
  };

  const changeUnit = (nu: string) => {
    setU(nu);
    const patch: Record<string, string> = {};
    for (const s of sides) {
      const v = style[s.key];
      if (v && !/^\s*var\(/.test(v)) patch[s.key] = normalize(stripUnit(v, u), nu);
    }
    if (Object.keys(patch).length > 0) updateStyle(elementId, patch);
  };

  // v0.4.5：四边一次性引用设计变量（**只给尺寸类**）。变量引用不再拼单位。
  // v0.4.5 修正：改用统一的 VarMenu（Portal + 避让定位），不再用会跑出窗口的绝对定位菜单。
  const [varOpen, setVarOpen] = useState(false);
  const varBtnRef = useRef<HTMLButtonElement | null>(null);
  const sizeTokens = (scene.tokens ?? []).filter((t) => t.kind !== 'color');
  const applyVarToAll = (name: string) => {
    const v = tokenRef(name);
    const patch: Record<string, string> = {};
    for (const s of sides) patch[s.key] = v;
    updateStyle(elementId, patch);
    setVarOpen(false);
  };

  return (
    <div className="trbl4">
      <div className="trbl4-head">
        <span className="trbl4-head-title">
          上 / 右 / 下 / 左 分开填写
          {fallback ? <span className="trbl4-head-hint">（例：{fallback}）</span> : null}
        </span>
        <div className="trbl4-head-right">
          <div className="trbl4-var-wrap">
            <button
              ref={varBtnRef}
              className={'trbl4-var-btn' + (varOpen ? ' active' : '')}
              onClick={() => setVarOpen((v) => !v)}
              title={sizeTokens.length > 0
                ? '四边都设成某个「尺寸」类设计变量，例如 space-md = 16px'
                : '还没有尺寸类变量 —— 到右侧「变量」页签新建一个（如 space-md = 16px）'}
              tabIndex={-1}
            >var</button>
            <VarMenu
              open={varOpen}
              anchorRef={varBtnRef}
              kinds={['size']}
              title="四边都引用同一个「尺寸」类变量"
              onClose={() => setVarOpen(false)}
              onPick={applyVarToAll}
            />
          </div>
          <label className="trbl4-sync" title="勾选后：改任意一边，其余三边自动跟随（做四周等距留白更快）">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
            四边同步
          </label>
          <select
            className="unit-select trbl4-unit-select"
            value={u}
            onChange={(e) => changeUnit(e.target.value)}
            title="数值单位：没有写单位的数字自动补这个单位；改选会同时换算已有数值"
          >
            {CSS_UNITS.map((un) => (
              <option key={un} value={un} title={UNIT_LABELS[un]}>{un}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="trbl4-grid">
        {sides.map((s) => (
          <Trbl4Cell
            key={s.key}
            label={s.label}
            value={style[s.key] ?? ''}
            unit={u}
            sync={sync}
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
  sync: boolean;
  onBegin: () => void;
  onEnd: () => void;
  onChange: (raw: string) => void;
  onCommit: (raw: string) => void;
}) {
  const { label, value, unit, sync } = props;
  const [draft, setDraft] = useState(value);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(value);
  }, [value]);

  const { num } = splitVal(value, unit);
  // 变量引用（var(--x)）要原样显示，不能当成"数值"再拼单位
  const isVarValue = /^\s*var\(/.test(value);

  // 滚轮调值：聚焦后滚动滚轮即增减（Shift ×10），停手 0.26s 自动提交
  const wheel = useWheelAdjust({
    getBase: () => parseFloat(splitVal(value, unit).num) || 0,
    precision: /\./.test(splitVal(value, unit).num) ? 2 : 0,
    onStart: () => { editingRef.current = true; setDraft(splitVal(value, unit).num || ''); props.onBegin(); },
    // v0.4.4 修：以前只把新值写进 store，没有同步 draft —— 而聚焦后输入框显示的是 draft，
    // 于是滚轮调值时数字"消失"（空值时直接变成占位符 0），看起来像输入框坏了。
    onPreview: (v) => { setDraft(String(v)); props.onChange(String(v)); },
    onCommit: (v) => {
      setDraft(String(v));
      props.onCommit(String(v));
      props.onEnd();
      editingRef.current = false;
    }
  });

  return (
    <div className="trbl4-cell">
      <span className="trbl4-label">{label}</span>
      <div className="trbl4-input-wrap">
        <input
          ref={wheel.ref}
          type="text"
          className="trbl4-input"
          value={editingRef.current ? draft : (isVarValue ? value : (num || ''))}
          placeholder="0"
          spellCheck={false}
          title={`点一下进入输入状态：滚动滚轮调数值（上滚增大 / 下滚减小），按住 Shift 一次调 10${sync ? '（四边同步开启中）' : ''}`}
          onFocus={() => { editingRef.current = true; setDraft(isVarValue ? value : (num || '')); props.onBegin(); }}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            props.onChange(raw);
          }}
          onBlur={() => {
            wheel.finish(); // 收尾可能未提交的滚轮调节（它会调 onCommit/onEnd）
            if (editingRef.current) {
              editingRef.current = false;
              props.onCommit(draft);
              props.onEnd();
            }
            setDraft('');
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </div>
    </div>
  );
}

// ============ 数值 / 单位拆分 ============
// 16px + 单位 px → 显示 "16"
// auto / 50% / calc(...) 等 → 原样显示
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
