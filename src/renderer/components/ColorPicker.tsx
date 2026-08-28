import { useState, useEffect, useRef } from 'react';
import { useScene } from '@store/sceneStore';

// BlockCanvas · ColorField 富颜色选择器（通用内核）
// 支持：Hex / RGB / RGBA / 英文色名 + 任意 CSS 颜色文本
// - 文本输入框接受任意 CSS 颜色字符串，自动识别格式并同步 RGBA 滑块
// - 色块按钮点开调色盘 modal：原色/新色对比、RGBA 滑杆、HEX 快选、英文色名、清空
// - 通过回调与外部状态解耦：
//     onChange(v)      流式变化（transient，不入撤销栈由调用方决定）
//     onModalClose(v)  modal 关闭时的最终提交（v = 最新草稿）
//     commitOnBlur + onInputBlur(v)  文本框失焦是否回写最终值（元素属性用）
// 使用方：
//  - ColorPicker（下方导出）：绑定元素样式（Inspector 属性行）
//  - Inspector「页面」页签：绑定 scene.quickCss
// 输入策略：beginStyleEdit 标记起点，transient 实时变，关闭/失焦时 commit

interface ColorFieldProps {
  /** 当前显示值（受控，来自外部状态） */
  value: string;
  /** 空值时的占位/底色 */
  fallback?: string;
  /** 文本输入框附加类名（如「页面」页签的 page-quick-input） */
  inputClassName?: string;
  /** 文本框聚焦（会话开始） */
  onInputFocus?: () => void;
  /** 值流式变化 */
  onChange: (v: string) => void;
  /** 文本框失焦（携带最新草稿：元素属性用它做最终提交；页面页签用它结束会话） */
  onInputBlur?: (v: string) => void;
  /** 打开调色盘 modal（会话开始） */
  onModalOpen?: () => void;
  /** 关闭调色盘 modal（最终提交，携带最新草稿） */
  onModalClose: (v: string) => void;
}

export function ColorField(props: ColorFieldProps) {
  const { value, fallback = '#ffffff', inputClassName } = props;

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  // 「原色」快照：打开弹窗那一刻的颜色。不能用 value —— 滑杆一动 onChange 流式写回
  // store，value 就变了，原色会跟着新颜色走（BUG：原色≠原来的颜色）
  const [origColor, setOrigColor] = useState(value);
  const [r, setR] = useState<number>(255);
  const [g, setG] = useState<number>(255);
  const [b, setB] = useState<number>(255);
  const [a, setA] = useState<number>(1);
  // 始终记录"最新输入值"，避免关闭 modal 时用闭包里的旧值回写
  const draftRef = useRef(value);

  // 外部值变化时同步 RGBA 滑块（撤销/重做/切换元素）
  useEffect(() => {
    const parsed = parseColor(value || fallback);
    if (parsed) { setR(parsed.r); setG(parsed.g); setB(parsed.b); setA(parsed.a); }
  }, [value, fallback]);

  // 开 modal 前 snapshot 原色（对比条带的"原色"用它），并解析 RGBA 初始滑杆
  const openModal = () => {
    setOrigColor(value);
    setDraft(value);
    draftRef.current = value;
    const parsed = parseColor(value || fallback);
    if (parsed) { setR(parsed.r); setG(parsed.g); setB(parsed.b); setA(parsed.a); }
    props.onModalOpen?.();
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    props.onModalClose(draftRef.current);
  };

  // 改 RGBA 滑块
  const onRgbaChange = (nr: number, ng: number, nb: number, na: number) => {
    setR(nr); setG(ng); setB(nb); setA(na);
    const newColor = `rgba(${nr}, ${ng}, ${nb}, ${na.toFixed(2)})`;
    setDraft(newColor);
    draftRef.current = newColor;
    props.onChange(newColor);
  };

  // 改颜色名下拉
  const onNamedPick = (name: string) => {
    const hex = NAMED_COLORS[name] || '';
    if (!hex) {
      setDraft('');
      draftRef.current = '';
      props.onChange('');
      return;
    }
    setDraft(name);
    draftRef.current = name;
    props.onChange(name);
    // 同时同步 RGBA 滑块
    const parsed = parseColor(hex);
    if (parsed) { setR(parsed.r); setG(parsed.g); setB(parsed.b); setA(parsed.a); }
  };

  // 改文本框（modal 内外的文本输入共用）
  const onTextInput = (v: string) => {
    setDraft(v);
    draftRef.current = v;
    props.onChange(v);
    // 尝试同步滑块
    const parsed = parseColor(v);
    if (parsed) { setR(parsed.r); setG(parsed.g); setB(parsed.b); setA(parsed.a); }
  };

  // 改 hex 取色器
  const onHexpicker = (hex: string) => {
    setDraft(hex);
    draftRef.current = hex;
    props.onChange(hex);
    const parsed = parseColor(hex);
    if (parsed) { setR(parsed.r); setG(parsed.g); setB(parsed.b); };
  };

  return (
    <>
      <input
        type="text"
        className={'color-text-input' + (inputClassName ? ' ' + inputClassName : '')}
        value={value}
        placeholder={fallback + ' / 例：#1e88e5 / rgb(30,136,229) / red'}
        onClick={(e) => e.stopPropagation()}
        onFocus={() => { if (!modalOpen) props.onInputFocus?.(); }}
        onChange={(e) => onTextInput(e.target.value)}
        onBlur={() => props.onInputBlur?.(draftRef.current)}
      />
      <button
        className={"color-swatch-btn" + (value === 'transparent' || a === 0 ? " is-transparent" : "")}
        style={value === 'transparent' ? undefined : { background: value || fallback }}
        onClick={(e) => { e.stopPropagation(); openModal(); }}
        title={value === 'transparent' ? '当前颜色：透明 (transparent)' : '打开调色盘'}
      />
      {modalOpen && (
        <div className="cp-backdrop" onClick={(e) => { e.stopPropagation(); closeModal(); }}>
          <div className="cp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cp-modal-header">
              <span>调色盘</span>
              <button className="cp-close" onClick={closeModal}>×</button>
            </div>

            <div className="cp-section">
              <div className="cp-section-label">对比原色 / 新色</div>
              <div className="cp-compare">
                <div className="cp-compare-old" style={{ background: origColor || fallback }}>
                  <span>原色</span>
                </div>
                <div className="cp-compare-new" style={{ background: `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})` }}>
                  <span>新色</span>
                </div>
              </div>
            </div>

            <div className="cp-section">
              <div className="cp-section-label">Red</div>
              <div className="cp-slider">
                <input type="range" min={0} max={255} value={r}
                  onChange={(e) => onRgbaChange(Number(e.target.value), g, b, a)} />
                <input type="number" min={0} max={255} value={r}
                  onChange={(e) => onRgbaChange(Number(e.target.value) || 0, g, b, a)} />
              </div>
              <div className="cp-section-label">Green</div>
              <div className="cp-slider">
                <input type="range" min={0} max={255} value={g}
                  onChange={(e) => onRgbaChange(r, Number(e.target.value) || 0, b, a)} />
                <input type="number" min={0} max={255} value={g}
                  onChange={(e) => onRgbaChange(r, Number(e.target.value) || 0, b, a)} />
              </div>
              <div className="cp-section-label">Blue</div>
              <div className="cp-slider">
                <input type="range" min={0} max={255} value={b}
                  onChange={(e) => onRgbaChange(r, g, Number(e.target.value) || 0, a)} />
                <input type="number" min={0} max={255} value={b}
                  onChange={(e) => onRgbaChange(r, g, Number(e.target.value) || 0, a)} />
              </div>
              <div className="cp-section-label">Alpha (透明度 0~1)</div>
              <div className="cp-slider">
                <input type="range" min={0} max={100} value={Math.round(a * 100)}
                  onChange={(e) => onRgbaChange(r, g, b, Number(e.target.value) / 100)} />
                <input type="number" step={0.01} min={0} max={1} value={a}
                  onChange={(e) => onRgbaChange(r, g, b, Number(e.target.value) || 0)} />
              </div>
            </div>

            <div className="cp-section">
              <div className="cp-section-label">Hex（快选，不含 Alpha）</div>
              <input
                type="color"
                value={rgbToHex(r, g, b)}
                onChange={(e) => onHexpicker(e.target.value)}
              />
            </div>

            <div className="cp-section">
              <div className="cp-section-label">英文色名（与 RGBA 同步覆盖）</div>
              <select
                value=""
                onChange={(e) => onNamedPick(e.target.value)}
                className="cp-named"
              >
                <option value="">— 选择基本色 —</option>
                {Object.keys(NAMED_COLORS).map((n) => (
                  <option key={n} value={n} style={{ color: NAMED_COLORS[n] }}>{n}</option>
                ))}
              </select>
            </div>

            <div className="cp-section">
              <div className="cp-section-label">文本输入</div>
              <input
                type="text"
                className="cp-text"
                value={draft}
                onChange={(e) => onTextInput(e.target.value)}
                placeholder="可直接粘贴任意 CSS 颜色"
              />
            </div>

            <div className="cp-section cp-actions-row">
              <button className="cp-btn cp-transparent-btn" onClick={() => onTextInput('transparent')}>🏁 设为透明 (transparent)</button>
              <button className="cp-clear" onClick={() => onTextInput('')}>清空颜色</button>
            </div>

            <div className="cp-footer">
              <button className="cp-ok" onClick={closeModal}>应用</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============ 元素属性绑定：背景色 / 文字颜色 / 边框颜色 ============
interface Props {
  elementId: string;
  styleKey: 'backgroundColor' | 'color' | 'borderColor';
  fallback?: string;
}

export function ColorPicker(props: Props) {
  const { elementId, styleKey, fallback = '#ffffff' } = props;
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  const node = findInTree(scene.root, elementId);
  const currentValue = (node?.style?.[styleKey] as string) ?? '';

  return (
    <div className="color-picker-row">
      <ColorField
        value={currentValue}
        fallback={fallback}
        onInputFocus={() => { beginStyleEdit(); }}
        onChange={(v) => updateStyleTransient(elementId, { [styleKey]: v } as any)}
        onInputBlur={(v) => updateStyle(elementId, { [styleKey]: v } as any)}
        onModalOpen={() => { beginStyleEdit(); }}
        onModalClose={(v) => updateStyle(elementId, { [styleKey]: v } as any)}
      />
    </div>
  );
}

// ============ 颜色解析工具 ============
type Parsed = { r: number; g: number; b: number; a: number };

function parseColor(v: string): Parsed | null {
  if (!v) return null;
  v = v.trim().toLowerCase();
  if (v === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  // #rgb / #rrggbb
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
        a: 1
      };
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1
    };
  }
  // rgb(r, g, b)
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(v);
  if (rgb) {
    return { r: w(rgb[1]), g: w(rgb[2]), b: w(rgb[3]), a: 1 };
  }
  // rgba(r, g, b, a)
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(v);
  if (rgba) {
    return { r: w(rgba[1]), g: w(rgba[2]), b: w(rgba[3]), a: clamp(Float(rgba[4]), 0, 1) };
  }
  // 命名色
  if (NAMED_COLORS[v]) {
    return parseColor(NAMED_COLORS[v]);
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map((v) => clamp(v | 0, 0, 255).toString(16).padStart(2, '0'))
    .join('');
}

function w(s: string): number { return clamp(parseInt(s, 10) || 0, 0, 255); }
function Float(s: string): number { return parseFloat(s) || 0; }
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

function findInTree(root: { id: string; children: any[] }, id: string): any {
  if (root.id === id) return root;
  for (const c of root.children) {
    const r = findInTree(c, id);
    if (r) return r;
  }
  return null;
}

// 17 种 CSS 基本英文色名（小白也能记住）
const NAMED_COLORS: Record<string, string> = {
  red: '#ff0000', orange: '#ffa500', yellow: '#ffff00',
  green: '#008000', blue: '#0000ff', purple: '#800080',
  pink: '#ffc0cb', brown: '#a52a2a', black: '#000000',
  white: '#ffffff', gray: '#808080', grey: '#808080',
  silver: '#c0c0c0', gold: '#ffd700', cyan: '#00ffff',
  magenta: '#ff00ff', lime: '#00ff00'
};
