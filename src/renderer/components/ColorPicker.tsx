import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useScene, getEffectiveStyle } from '@store/sceneStore';
import { tokenRef, cssVarName, tokenNameFromRef, isValidTokenName, uniqueTokenName } from '@lib/designTokens';

// BlockCanvas · ColorField 富颜色选择器（通用内核）
// 支持：Hex / RGB / RGBA / 英文色名 + 任意 CSS 颜色文本
//
// v0.4.2 重做取色内核：
//  · 用自绘「饱和度 × 明度面板 + 色相条 + 透明度条」替代原生 <input type="color">
//    —— 原生取色器会弹出系统/Chromium 自带窗口（没有遮罩、样式不统一），
//       而且拖动时 input 事件频率极高，逐帧写回 store 会明显卡顿；
//  · 面板拖动走 rAF 合并提交，HEX 文本框只在提交时落地，输入不再掉帧；
//  · 所有颜色入口共用同一个遮罩层与层级，视觉完全一致；
//  · 新增常用色板与「最近使用」，常用色一键取。
//
// 通过回调与外部状态解耦：
//     onChange(v)      流式变化（transient，不入撤销栈由调用方决定）
//     onModalClose(v)  modal 关闭时的最终提交（v = 最新草稿）
//     commitOnBlur + onInputBlur(v)  文本框失焦是否回写最终值（元素属性用）

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
  /** 是否在面板里隐藏「设计变量」区（变量面板自己编辑变量时用，避免自引用） */
  noTokens?: boolean;
}

const RECENT_KEY = 'bc-recent-colors';
const RECENT_MAX = 12;
const CLOSE_ANIM = 150;

/** 常用色板（贴近真实网页设计的 30 色） */
const SWATCHES: string[] = [
  '#000000', '#262626', '#404040', '#737373', '#a3a3a3', '#d4d4d4', '#f5f5f5', '#ffffff',
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#1e88e5', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#78350f', '#1e3a8a', '#065f46', '#7c2d12'
];

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

function pushRecent(color: string) {
  const c = (color || '').trim();
  if (!c || c === 'transparent') return;
  try {
    const list = readRecent().filter((x) => x.toLowerCase() !== c.toLowerCase());
    list.unshift(c);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch { /* ignore */ }
}

export function ColorField(props: ColorFieldProps) {
  const { value, fallback = '#ffffff', inputClassName } = props;
  // 设计变量（颜色类）→ 调色盘里可一键引用；noTokens 用于「变量面板自己」避免自引用
  // 注意：选择器只取稳定的 tokens 引用，过滤放 useMemo —— 否则每次渲染都产新数组，
  // 会让 useSyncExternalStore 认为快照变了，白白重渲染。
  const allTokens = useScene((s) => s.scene.tokens);
  const colorTokens = useMemo(
    () => (props.noTokens ? [] : (allTokens ?? []).filter((t) => t.kind === 'color')),
    [allTokens, props.noTokens]
  );
  // v0.4.5：「var」快捷引用菜单 —— 不打开调色盘也能一键写入变量引用
  const [varMenu, setVarMenu] = useState<{ x: number; y: number } | null>(null);
  const varBtnRef = useRef<HTMLButtonElement | null>(null);
  const openVarMenu = () => {
    const r = varBtnRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = Math.min(320, 44 * colorTokens.length + 12);
    const y = Math.min(r.bottom + 4, window.innerHeight - menuH - 8);
    setVarMenu({ x: Math.min(r.left, window.innerWidth - 244), y: Math.max(8, y) });
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState(value);
  // 「原色」快照：打开弹窗那一刻的颜色。不能用 value —— 拖动一动 onChange 流式写回
  // store，value 就变了，原色会跟着新颜色走（BUG：原色≠原来的颜色）
  const [origColor, setOrigColor] = useState(value);
  // HSV + Alpha 是取色面板的"真身"，RGB 由它推导
  const [h, setH] = useState(210);
  const [s, setS] = useState(0.8);
  const [v, setV] = useState(0.9);
  const [a, setA] = useState(1);
  const [hexDraft, setHexDraft] = useState('#ffffff');
  const [recent, setRecent] = useState<string[]>(() => readRecent());

  // 始终记录"最新输入值"，避免关闭 modal 时用闭包里的旧值回写
  const draftRef = useRef(value);
  // 记录"自己刚写出去的字符串"，避免回流把自己的状态覆盖掉
  const selfRef = useRef<string>('');
  const closeTimer = useRef(0);

  const rgb = hsvToRgb(h, s, v);

  // —— 高频输入节流（取色面板拖动 / 透明度滑杆）——
  // 指针事件远高于屏幕刷新率，逐帧合并提交，避免每帧都写 store 造成卡顿
  const rafRef = useRef(0);
  const pendingRef = useRef<string | null>(null);
  const emitThrottled = (v2: string) => {
    pendingRef.current = v2;
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      const val = pendingRef.current;
      pendingRef.current = null;
      if (val !== null) { selfRef.current = val; props.onChange(val); }
    });
  };
  useEffect(() => () => {
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  // 外部值变化时同步 HSV 滑杆（撤销/重做/切换元素）
  function applyParsed(parsed: Parsed) {
    const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
    setH(hsv.h); setS(hsv.s); setV(hsv.v); setA(parsed.a);
    setHexDraft(rgbToHex(parsed.r, parsed.g, parsed.b));
  }

  useEffect(() => {
    if (value === selfRef.current) return;
    const parsed = parseColor(value || fallback);
    if (!parsed) return;
    applyParsed(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, fallback]);

  /** 统一出口：由 HSV+A 生成 rgba 字符串并提交 */
  const emitHsv = (nh: number, ns: number, nv: number, na: number, immediate = false) => {
    const c = hsvToRgb(nh, ns, nv);
    const hex = rgbToHex(c.r, c.g, c.b);
    const out = na >= 1 ? hex : `rgba(${c.r}, ${c.g}, ${c.b}, ${Number(na.toFixed(2))})`;
    setHexDraft(hex);
    setDraft(out);
    draftRef.current = out;
    if (immediate) { selfRef.current = out; props.onChange(out); }
    else emitThrottled(out);
  };

  // —— 取色面板（饱和度 / 明度）——
  const svRef = useRef<HTMLDivElement>(null);
  const svDragging = useRef(false);
  const pickSV = (clientX: number, clientY: number) => {
    const el = svRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ns = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
    const nv = 1 - clamp((clientY - r.top) / Math.max(1, r.height), 0, 1);
    setS(ns); setV(nv);
    emitHsv(h, ns, nv, a);
  };

  // —— 色相条 ——
  const hueRef = useRef<HTMLDivElement>(null);
  const hueDragging = useRef(false);
  const pickHue = (clientX: number) => {
    const el = hueRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nh = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1) * 360;
    setH(nh);
    emitHsv(nh, s, v, a);
  };

  // —— 透明度条 ——
  const alphaRef = useRef<HTMLDivElement>(null);
  const alphaDragging = useRef(false);
  const pickAlpha = (clientX: number) => {
    const el = alphaRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const na = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
    setA(na);
    emitHsv(h, s, v, na);
  };

  const startDrag = (which: 'sv' | 'hue' | 'alpha') => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (which === 'sv') { svDragging.current = true; pickSV(e.clientX, e.clientY); }
    if (which === 'hue') { hueDragging.current = true; pickHue(e.clientX); }
    if (which === 'alpha') { alphaDragging.current = true; pickAlpha(e.clientX); }
  };
  const moveDrag = (which: 'sv' | 'hue' | 'alpha') => (e: React.PointerEvent) => {
    if (which === 'sv' && svDragging.current) pickSV(e.clientX, e.clientY);
    if (which === 'hue' && hueDragging.current) pickHue(e.clientX);
    if (which === 'alpha' && alphaDragging.current) pickAlpha(e.clientX);
  };
  const endDrag = (which: 'sv' | 'hue' | 'alpha') => (e: React.PointerEvent) => {
    if (which === 'sv') svDragging.current = false;
    if (which === 'hue') hueDragging.current = false;
    if (which === 'alpha') alphaDragging.current = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  // 开 modal 前 snapshot 原色（对比条带的"原色"用它），并解析 HSV 初始值
  const openModal = () => {
    setOrigColor(value);
    setDraft(value);
    draftRef.current = value;
    const parsed = parseColor(value || fallback);
    if (parsed) applyParsed(parsed);
    setRecent(readRecent());
    props.onModalOpen?.();
    setClosing(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    // 立即提交（保证 store 状态正确），遮罩与弹窗再做 150ms 的退场动画
    props.onModalClose(draftRef.current);
    pushRecent(draftRef.current);
    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setModalOpen(false);
      setClosing(false);
    }, CLOSE_ANIM);
  };

  // 改 RGBA 数字输入
  const setChannel = (channel: 'r' | 'g' | 'b' | 'a', raw: string) => {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    if (channel === 'a') {
      const na = clamp(n, 0, 1);
      setA(na);
      emitHsv(h, s, v, na, true);
      return;
    }
    const next = { ...rgb };
    if (channel === 'r') next.r = clamp(Math.round(n), 0, 255);
    if (channel === 'g') next.g = clamp(Math.round(n), 0, 255);
    if (channel === 'b') next.b = clamp(Math.round(n), 0, 255);
    const hsv = rgbToHsv(next.r, next.g, next.b);
    setH(hsv.h); setS(hsv.s); setV(hsv.v);
    const out = a >= 1 ? rgbToHex(next.r, next.g, next.b) : `rgba(${next.r}, ${next.g}, ${next.b}, ${Number(a.toFixed(2))})`;
    setHexDraft(rgbToHex(next.r, next.g, next.b));
    setDraft(out);
    draftRef.current = out;
    selfRef.current = out;
    props.onChange(out);
  };

  // 改颜色名下拉
  const onNamedPick = (name: string) => {
    if (!name) return;
    const hex = NAMED_COLORS[name] || '';
    if (!hex) return;
    setDraft(name);
    draftRef.current = name;
    selfRef.current = name;
    props.onChange(name);
    const parsed = parseColor(hex);
    if (parsed) applyParsed(parsed);
  };

  // 改 HEX 文本框（只在提交时落地，输入过程不惊动 store → 不卡）
  const commitHex = (raw: string) => {
    const txt = raw.trim();
    setHexDraft(txt);
    if (!txt) {
      setDraft('');
      draftRef.current = '';
      selfRef.current = '';
      props.onChange('');
      return;
    }
    const normalized = normalizeHex(txt);
    if (!normalized) return;
    const parsed = parseColor(normalized);
    if (!parsed) return;
    const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
    setH(hsv.h); setS(hsv.s); setV(hsv.v);
    const out = parsed.a >= 1 ? normalized : `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${parsed.a})`;
    setDraft(out);
    draftRef.current = out;
    selfRef.current = out;
    props.onChange(out);
  };

  /** 一键套用某个颜色（色板 / 最近使用） */
  const applyQuick = (c: string) => {
    const parsed = parseColor(c);
    if (!parsed) return;
    applyParsed(parsed);
    const out = parsed.a >= 1 ? rgbToHex(parsed.r, parsed.g, parsed.b) : c;
    setDraft(out);
    draftRef.current = out;
    selfRef.current = out;
    props.onChange(out);
  };

  /** 套用设计变量：写入 var(--bc-xxx) 引用，而不是写死颜色 —— 改变量即全站同步 */
  const applyToken = (name: string, rawValue: string) => {
    const ref = tokenRef(name);
    setDraft(ref);
    draftRef.current = ref;
    selfRef.current = ref;
    props.onChange(ref);
    // 顺手把取色区同步到该变量当前的颜色，方便在此基础上微调
    const parsed = parseColor(rawValue);
    if (parsed) applyParsed(parsed);
  };

  const previewColor = (() => {
    const c = hsvToRgb(h, s, v);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${Number(a.toFixed(2))})`;
  })();

  // v0.4.5：调色盘里直接新建颜色变量并立即引用（值 = 当前调色盘的色）
  const setTokens = useScene((s) => s.setTokens);
  const [newVarOpen, setNewVarOpen] = useState(false);
  const [newVarName, setNewVarName] = useState('');
  const createAndApplyVar = () => {
    const clean = newVarName.trim();
    if (!clean || !isValidTokenName(clean)) {
      alert('变量名只能用小写字母开头，且只包含小写字母、数字和连字符（例如 brand、bg-soft）。');
      return;
    }
    const list = allTokens ?? [];
    const name = uniqueTokenName(clean, list);
    const initColor = hexDraft || '#1e88e5';
    setTokens([...list, { name, value: initColor, group: '颜色', kind: 'color' }]);
    applyToken(name, initColor);
    setNewVarOpen(false);
    setNewVarName('');
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
        onChange={(e) => {
          // 同步草稿，否则失焦时 onInputBlur 会把旧值回写、把用户刚输入的文本冲掉
          const v2 = e.target.value;
          setDraft(v2);
          draftRef.current = v2;
          selfRef.current = v2;
          props.onChange(v2);
        }}
        onBlur={() => props.onInputBlur?.(draftRef.current)}
      />
      <button
        className={'color-swatch-btn' + (value === 'transparent' || a === 0 ? ' is-transparent' : '')}
        style={value === 'transparent' ? undefined : { background: value || fallback }}
        onClick={(e) => { e.stopPropagation(); openModal(); }}
        title={value === 'transparent' ? '当前颜色：透明 (transparent)' : '打开调色盘'}
      />
      {/* v0.4.5：「var」快捷引用 —— 有颜色变量时显示，一键写入 var(--bc-*) */}
      {colorTokens.length > 0 && (
        <button
          ref={varBtnRef}
          className="color-var-btn"
          onClick={(e) => {
            e.stopPropagation();
            if (varMenu) { setVarMenu(null); return; }
            openVarMenu();
          }}
          title="引用设计变量：选一个变量写入 var() 引用（改变量全站一起变）"
        >var</button>
      )}
      {varMenu && createPortal(
        <>
          <div className="cp-varmenu-mask" onMouseDown={() => setVarMenu(null)} />
          <div className="cp-varmenu" style={{ left: varMenu.x, top: varMenu.y }}>
            <div className="cp-varmenu-title">引用设计变量</div>
            {colorTokens.map((t) => (
              <button
                key={t.name}
                className={'cp-varmenu-item' + (value === tokenRef(t.name) ? ' active' : '')}
                onClick={(e) => {
                  e.stopPropagation();
                  applyToken(t.name, t.value);
                  setVarMenu(null);
                }}
                title={`${cssVarName(t.name)}: ${t.value}`}
              >
                <span className="cp-varmenu-swatch" style={{ background: t.value }} />
                <span className="cp-varmenu-name">{t.name}</span>
                <span className="cp-varmenu-val">{t.value}</span>
              </button>
            ))}
            <div className="cp-varmenu-foot">管理变量 → 右侧面板「变量」页签</div>
          </div>
        </>,
        document.body
      )}
      {/* 调色盘用 Portal 挂到 body：既不会被属性面板的 overflow 裁切，
          也不会被父级 transform（如折叠动画）变成包含块导致遮罩错位 */}
      {modalOpen && createPortal(
        <div
          className={'cp-backdrop' + (closing ? ' is-closing' : '')}
          onClick={(e) => { e.stopPropagation(); closeModal(); }}
        >
          <div className="cp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cp-modal-header">
              <span>调色盘</span>
              <button className="cp-close" onClick={closeModal}>×</button>
            </div>

            <div className="cp-body">
              {/* 原色 / 新色 对比 */}
              <div className="cp-section">
                <div className="cp-section-label">对比原色 / 新色</div>
                <div className="cp-compare">
                  <div className="cp-compare-old" style={{ background: origColor || fallback }}>
                    <span>原色</span>
                  </div>
                  <div className="cp-compare-new" style={{ background: previewColor }}>
                    <span>新色</span>
                  </div>
                </div>
              </div>

              {/* 自绘取色区：饱和度 × 明度 */}
              <div className="cp-section">
                <div className="cp-section-label">取色（左右调浓淡 · 上下调明暗）</div>
                <div
                  ref={svRef}
                  className="cp-sv"
                  style={{ '--cp-hue': `hsl(${h}, 100%, 50%)` } as React.CSSProperties}
                  onPointerDown={startDrag('sv')}
                  onPointerMove={moveDrag('sv')}
                  onPointerUp={endDrag('sv')}
                  onPointerCancel={endDrag('sv')}
                  title="按住拖动取色：水平方向是鲜艳程度，垂直方向是明暗"
                >
                  <span className="cp-sv-cursor" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
                </div>

                <div
                  ref={hueRef}
                  className="cp-hue"
                  onPointerDown={startDrag('hue')}
                  onPointerMove={moveDrag('hue')}
                  onPointerUp={endDrag('hue')}
                  onPointerCancel={endDrag('hue')}
                  title="色相：红橙黄绿青蓝紫"
                >
                  <span className="cp-hue-cursor" style={{ left: `${(h / 360) * 100}%`, background: `hsl(${h}, 100%, 50%)` }} />
                </div>

                <div
                  ref={alphaRef}
                  className="cp-alpha"
                  style={{ '--cp-solid': rgbToHex(rgb.r, rgb.g, rgb.b) } as React.CSSProperties}
                  onPointerDown={startDrag('alpha')}
                  onPointerMove={moveDrag('alpha')}
                  onPointerUp={endDrag('alpha')}
                  onPointerCancel={endDrag('alpha')}
                  title="透明度：左端全透明，右端不透明"
                >
                  <span className="cp-alpha-cursor" style={{ left: `${a * 100}%` }} />
                </div>
              </div>

              {/* HEX 与透明度数字 */}
              <div className="cp-section">
                <div className="cp-section-label">HEX（不含透明度）</div>
                <div className="cp-slider">
                  <input
                    type="text"
                    className="cp-hex"
                    value={hexDraft}
                    spellCheck={false}
                    placeholder="#1e88e5"
                    onChange={(e) => setHexDraft(e.target.value)}
                    onBlur={(e) => commitHex(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  />
                  <div className="cp-alpha-num">
                    <span>透明度</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={1}
                      value={Number(a.toFixed(2))}
                      onChange={(e) => setChannel('a', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* RGBA 分项 */}
              <div className="cp-section">
                <div className="cp-section-label">Red / Green / Blue</div>
                {(['r', 'g', 'b'] as const).map((ch) => (
                  <div className="cp-slider" key={ch}>
                    <span className="cp-ch-name">{ch.toUpperCase()}</span>
                    <input
                      type="range"
                      min={0}
                      max={255}
                      value={rgb[ch]}
                      style={{ accentColor: RGB_TRACK[ch] }}
                      onChange={(e) => setChannel(ch, e.target.value)}
                    />
                    <input
                      type="number"
                      min={0}
                      max={255}
                      value={rgb[ch]}
                      onChange={(e) => setChannel(ch, e.target.value)}
                    />
                  </div>
                ))}
              </div>

              {/* 设计变量：引用后改变量即可全站同步（v0.4.5 大色板 + 顺手新建） */}
              <div className="cp-section">
                <div className="cp-section-label">设计变量（点一下写入 var() 引用，改变量全站一起变）</div>
                <div className="cp-token-grid">
                  {colorTokens.map((t) => (
                    <button
                      key={t.name}
                      className={'cp-token' + (tokenNameFromRef(draft) === t.name ? ' active' : '')}
                      onClick={() => applyToken(t.name, t.value)}
                      title={`${cssVarName(t.name)}: ${t.value}\n点一下写入 var(${cssVarName(t.name)})，之后在「变量」页签改这里的值，所有引用处会一起变`}
                    >
                      <span className="cp-token-swatch" style={{ background: t.value }} />
                      <span className="cp-token-name">{t.name}</span>
                    </button>
                  ))}
                  <button
                    className="cp-token cp-token-add"
                    onClick={() => setNewVarOpen(true)}
                    title="新建一个颜色变量并立即引用"
                  >＋ 新建</button>
                </div>
                {newVarOpen && (
                  <div className="cp-token-new">
                    <input
                      autoFocus
                      type="text"
                      className="cp-token-new-input"
                      placeholder="变量名（如 brand）"
                      value={newVarName}
                      onChange={(e) => setNewVarName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') createAndApplyVar();
                        if (e.key === 'Escape') { setNewVarOpen(false); setNewVarName(''); }
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button className="btn-mini" onClick={createAndApplyVar}>创建并引用</button>
                  </div>
                )}
              </div>

              {/* 常用色板 */}
              <div className="cp-section">
                <div className="cp-section-label">常用色板（点一下直接取）</div>
                <div className="cp-swatches">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      className={'cp-swatch' + (hexDraft.toLowerCase() === c.toLowerCase() ? ' active' : '')}
                      style={{ background: c }}
                      title={c}
                      onClick={() => applyQuick(c)}
                    />
                  ))}
                </div>
              </div>

              {/* 最近使用 */}
              {recent.length > 0 && (
                <div className="cp-section">
                  <div className="cp-section-label">最近使用</div>
                  <div className="cp-swatches">
                    {recent.map((c) => (
                      <button
                        key={c}
                        className="cp-swatch"
                        style={{ background: c }}
                        title={c}
                        onClick={() => applyQuick(c)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 英文色名 */}
              <div className="cp-section">
                <div className="cp-section-label">英文色名（与上方同步覆盖）</div>
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

              {/* 文本输入 */}
              <div className="cp-section">
                <div className="cp-section-label">任意 CSS 颜色文本</div>
                <input
                  type="text"
                  className="cp-text"
                  value={draft}
                  onChange={(e) => {
                    const v2 = e.target.value;
                    setDraft(v2);
                    draftRef.current = v2;
                    props.onChange(v2);
                    const parsed = parseColor(v2);
                    if (parsed) applyParsed(parsed);
                  }}
                  placeholder="可直接粘贴任意 CSS 颜色（#hex / rgb() / red ...）"
                />
              </div>

              <div className="cp-section cp-actions-row">
                <button
                  className="cp-clear"
                  title="清空颜色值（想彻底去掉背景，请直接删除「背景颜色」这条属性）"
                  onClick={() => { setDraft(''); draftRef.current = ''; props.onChange(''); }}
                >清空颜色</button>
              </div>
            </div>

            <div className="cp-footer">
              <span className="cp-footer-preview" style={{ background: previewColor }} />
              <code className="cp-footer-code">{draft || '（空）'}</code>
              <button className="cp-ok" onClick={closeModal}>应用</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ============ 元素属性绑定：背景色 / 文字颜色 / 边框颜色 ============
interface Props {
  elementId: string;
  styleKey: 'backgroundColor' | 'color' | 'borderColor' | string;
  fallback?: string;
  pseudo?: string | null;
}

export function ColorPicker(props: Props) {
  const { elementId, styleKey, fallback = '#ffffff', pseudo } = props;
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);
  const updatePseudoStyle = useScene((s) => s.updatePseudoStyle);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);

  const isPseudo = Boolean(pseudo);
  const node = findInTree(scene.root, elementId);
  const effStyle = node ? (getEffectiveStyle(node, activeBreakpoint) as any) : {};
  const currentValue = isPseudo
    ? ((node?.pseudoStyles?.[pseudo!]?.[styleKey] as string) ?? '')
    : ((effStyle[styleKey] as string) ?? '');

  const commit = (v: string) => {
    if (isPseudo) {
      updatePseudoStyle(elementId, pseudo!, { [styleKey]: v });
    } else {
      updateStyle(elementId, { [styleKey]: v } as any);
    }
  };

  const onChangeVal = (v: string) => {
    if (isPseudo) {
      updatePseudoStyle(elementId, pseudo!, { [styleKey]: v });
    } else {
      updateStyleTransient(elementId, { [styleKey]: v } as any);
    }
  };

  return (
    <div className="color-picker-row">
      <ColorField
        value={currentValue}
        fallback={fallback}
        onInputFocus={() => { beginStyleEdit(); }}
        onChange={onChangeVal}
        onInputBlur={commit}
        onModalOpen={() => { beginStyleEdit(); }}
        onModalClose={commit}
      />
    </div>
  );
}

// ============ 颜色解析工具 ============
type Parsed = { r: number; g: number; b: number; a: number };

const RGB_TRACK: Record<'r' | 'g' | 'b', string> = {
  r: '#ef4444',
  g: '#22c55e',
  b: '#3b82f6'
};

function parseColor(v: string): Parsed | null {
  if (!v) return null;
  v = v.trim().toLowerCase();
  if (v === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  // #rgb / #rgba / #rrggbb / #rrggbbaa
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hex) {
    const hx = hex[1];
    if (hx.length === 3 || hx.length === 4) {
      return {
        r: parseInt(hx[0] + hx[0], 16),
        g: parseInt(hx[1] + hx[1], 16),
        b: parseInt(hx[2] + hx[2], 16),
        a: hx.length === 4 ? clamp(parseInt(hx[3] + hx[3], 16) / 255, 0, 1) : 1
      };
    }
    if (hx.length === 6 || hx.length === 8) {
      return {
        r: parseInt(hx.slice(0, 2), 16),
        g: parseInt(hx.slice(2, 4), 16),
        b: parseInt(hx.slice(4, 6), 16),
        a: hx.length === 8 ? clamp(parseInt(hx.slice(6, 8), 16) / 255, 0, 1) : 1
      };
    }
    return null;
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

/** '#abc' / 'abc' / '1e88e5' → '#aabbcc'；非法返回 null */
function normalizeHex(raw: string): string | null {
  let t = raw.trim().toLowerCase();
  if (!t) return null;
  if (!t.startsWith('#')) t = '#' + t;
  if (/^#[0-9a-f]{3}$/.test(t)) return '#' + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map((v) => clamp(v | 0, 0, 255).toString(16).padStart(2, '0'))
    .join('');
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let hh = 0;
  if (d !== 0) {
    if (max === rn) hh = ((gn - bn) / d) % 6;
    else if (max === gn) hh = (bn - rn) / d + 2;
    else hh = (rn - gn) / d + 4;
    hh *= 60;
    if (hh < 0) hh += 360;
  }
  return { h: hh, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp < 1) { r1 = c; g1 = x; }
  else if (hp < 2) { r1 = x; g1 = c; }
  else if (hp < 3) { g1 = c; b1 = x; }
  else if (hp < 4) { g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  const m = v - c;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255)
  };
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
