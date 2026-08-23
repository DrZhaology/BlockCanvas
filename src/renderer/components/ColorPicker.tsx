import { useState, useEffect, useRef } from 'react';
import { useScene } from '@store/sceneStore';

// BlockCanvas · ColorPicker 富组件
// 支持：Hex / RGB / RGBA / 英文色名
// - 输入框接受任意 CSS 颜色字符串，自动识别格式
// - 取色器（input[type=color]）仅能处理 #hex，作为辅助快选
// - modal 显示"原色 / 新色"对比条带
// - modal 带边框 + 背景蒙层防误关
// 输入策略：beginStyleEdit 标记起点，transient 实时变，blur/modal关闭时 commit

interface Props {
  elementId: string;
  styleKey: 'backgroundColor' | 'color' | 'borderColor';
  fallback?: string;
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

export function ColorPicker(props: Props) {
  const { elementId, styleKey, fallback = '#ffffff' } = props;
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  const node = findInTree(scene.root, elementId);
  const currentValue = (node?.style?.[styleKey] as string) ?? '';

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(currentValue);
  const [r, setR] = useState<number>(255);
  const [g, setG] = useState<number>(255);
  const [b, setB] = useState<number>(255);
  const [a, setA] = useState<number>(1);
  const swatchRef = useRef<HTMLDivElement>(null);
  // 始终记录"最新输入值"，避免 onBlur 用闭包里的旧值回写
  const draftRef = useRef(currentValue);

  // 把当前值解析成 r/g/b/a
  useEffect(() => {
    const parsed = parseColor(currentValue || fallback);
    if (parsed) { setR(parsed.r); setG(parsed.g); setB(parsed.b); setA(parsed.a); }
  }, [currentValue, fallback]);

  // 开 modal 前 snapshot 原色，开 modal 后跟随 currentValue 更新 draft
  const openModal = () => {
    setDraft(currentValue);
    const parsed = parseColor(currentValue || fallback);
    if (parsed) { setR(parsed.r); setG(parsed.g); setB(parsed.b); setA(parsed.a); }
    beginStyleEdit();
    setModalOpen(true);
  };

  const closeModal = () => {
    updateStyle(elementId, { [styleKey]: draft } as any);
    setModalOpen(false);
  };

  // 改 RGBA 滑块
  const onRgbaChange = (nr: number, ng: number, nb: number, na: number) => {
    setR(nr); setG(ng); setB(nb); setA(na);
    const newColor = `rgba(${nr}, ${ng}, ${nb}, ${na.toFixed(2)})`;
    setDraft(newColor);
    draftRef.current = newColor;
    updateStyleTransient(elementId, { [styleKey]: newColor } as any);
  };

  // 改颜色名下拉
  const onNamedPick = (name: string) => {
    const hex = NAMED_COLORS[name] || '';
    if (!hex) {
      setDraft('');
      draftRef.current = '';
      updateStyleTransient(elementId, { [styleKey]: '' } as any);
      return;
    }
    setDraft(name);
    draftRef.current = name;
    updateStyleTransient(elementId, { [styleKey]: name } as any);
    // 同时同步 RGBA 滑块
    const parsed = parseColor(hex);
    if (parsed) { setR(parsed.r); setG(parsed.g); setB(parsed.b); setA(parsed.a); }
  };

  // 改文本框
  const onTextInput = (v: string) => {
    setDraft(v);
    draftRef.current = v;
    updateStyleTransient(elementId, { [styleKey]: v } as any);
    // 尝试同步滑块
    const parsed = parseColor(v);
    if (parsed) { setR(parsed.r); setG(parsed.g); setB(parsed.b); setA(parsed.a); }
  };

  // 改 hex 取色器
  const onHexpicker = (hex: string) => {
    setDraft(hex);
    draftRef.current = hex;
    updateStyleTransient(elementId, { [styleKey]: hex } as any);
    const parsed = parseColor(hex);
    if (parsed) { setR(parsed.r); setG(parsed.g); setB(parsed.b); };
  };

  return (
    <div className="color-picker-row">
      <input
        type="text"
        className="color-text-input"
        value={currentValue}
        placeholder={fallback + ' / 例：#1e88e5 / rgb(30,136,229) / red'}
        onClick={(e) => e.stopPropagation()}
        onFocus={() => { if (!modalOpen) beginStyleEdit(); }}
        onChange={(e) => onTextInput(e.target.value)}
        onBlur={() => updateStyle(elementId, { [styleKey]: draftRef.current } as any)}
      />
      <button
        className="color-swatch-btn"
        style={{ background: currentValue || fallback }}
        onClick={(e) => { e.stopPropagation(); openModal(); }}
        title="打开调色盘"
        ref={swatchRef as any}
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
                <div className="cp-compare-old" style={{ background: currentValue || fallback }}>
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

            <div className="cp-section">
              <button className="cp-clear" onClick={() => onTextInput('')}>清空颜色</button>
            </div>

            <div className="cp-footer">
              <button className="cp-ok" onClick={closeModal}>应用</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 颜色解析工具 ============
type Parsed = { r: number; g: number; b: number; a: number };

function parseColor(v: string): Parsed | null {
  if (!v) return null;
  v = v.trim().toLowerCase();
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
