import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseGradient,
  serializeGradient,
  defaultGradient,
  angleHint,
  GRADIENT_PRESETS,
  GRADIENT_PRESET_GROUPS,
  type GradientSpec
} from '@lib/gradient';
import { ColorField } from './ColorPicker';

// BlockCanvas · 渐变编辑器（PowerPoint 风格可视化调整板块）
// 背景渐变与文字渐变共用同一内核：
//  - 类型（线性 / 径向）、角度方向盘（可拖拽 + 快捷角度）、色标（颜色 + 位置滑杆 + 增删）
//  - 顶部实时预览条；底部预制渐变画廊（一键套用好看配色）
//  - 与原生 CSS 字符串双向无损转换：模板里手写的 linear-gradient 直接可编辑

interface Props {
  value: string;
  /** 实时变化（拖动时流式写入，不入撤销栈） */
  onChange: (css: string) => void;
  /** 交互收尾（松开鼠标 / 关闭调色盘）——由调用方入撤销栈 */
  onCommit: () => void;
  /** 移除渐变 */
  onRemove: () => void;
  /** 语义：背景 or 文字（文案提示用） */
  scope?: 'background' | 'text';
}

export function GradientEditor(props: Props) {
  const { value, onChange, onCommit, onRemove, scope = 'background' } = props;

  const parsed = useMemo(() => parseGradient(value), [value]);
  const [spec, setSpec] = useState<GradientSpec>(() => parsed ?? defaultGradient());
  // 记录"自己刚写出去的字符串"，避免 onChange → value 回流时把正在拖拽的本地状态覆盖掉
  const selfRef = useRef<string>('');
  const [presetOpen, setPresetOpen] = useState(false);
  // 角度数字框草稿（拖动方向盘时不打断用户手输）
  const [angleDraft, setAngleDraft] = useState<string>(() => String(Math.round((parsed ?? defaultGradient()).angle)));

  useEffect(() => {
    setAngleDraft(String(Math.round(spec.angle)));
  }, [spec.angle]);

  useEffect(() => {
    if (value === selfRef.current) return;
    const p = parseGradient(value);
    if (p) setSpec(p);
  }, [value]);

  const push = (next: GradientSpec) => {
    setSpec(next);
    const css = serializeGradient(next);
    selfRef.current = css;
    onChange(css);
  };

  // —— 角度方向盘拖拽 ——
  const dialRef = useRef<HTMLDivElement>(null);
  const needleRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const centerRef = useRef<{ cx: number; cy: number }>({ cx: 0, cy: 0 });
  const rafRef = useRef(0);
  const pendingAngle = useRef<number | null>(null);
  const specRef = useRef(spec);
  specRef.current = spec;

  const updateDialVisual = (deg: number) => {
    if (needleRef.current) {
      needleRef.current.style.transform = `rotate(${deg}deg)`;
    }
    if (knobRef.current) {
      const r = ((deg - 90) * Math.PI) / 180;
      const x = 44 + Math.cos(r) * 30;
      const y = 44 + Math.sin(r) * 30;
      knobRef.current.style.left = `${x}px`;
      knobRef.current.style.top = `${y}px`;
    }
  };

  const angleFromEvent = (clientX: number, clientY: number): number => {
    const { cx, cy } = centerRef.current;
    if (!cx && !cy) return spec.angle;
    // CSS 渐变角度：0deg 指向上，顺时针增大
    const rad = Math.atan2(clientX - cx, cy - clientY);
    let deg = (rad * 180) / Math.PI;
    deg = ((deg % 360) + 360) % 360;
    return Math.round(deg);
  };

  const flushAngle = () => {
    rafRef.current = 0;
    if (pendingAngle.current === null) return;
    const deg = pendingAngle.current;
    pendingAngle.current = null;
    const next = { ...specRef.current, angle: deg };
    specRef.current = next;
    push(next);
  };

  const onDialDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const el = dialRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      centerRef.current = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }
    const deg = angleFromEvent(e.clientX, e.clientY);
    updateDialVisual(deg);
    pendingAngle.current = deg;
    if (!rafRef.current) rafRef.current = window.requestAnimationFrame(flushAngle);
  };

  const onDialMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const deg = angleFromEvent(e.clientX, e.clientY);
    updateDialVisual(deg);
    pendingAngle.current = deg;
    if (!rafRef.current) rafRef.current = window.requestAnimationFrame(flushAngle);
  };

  const onDialUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (rafRef.current) { window.cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    flushAngle();
    onCommit();
  };
  useEffect(() => () => { if (rafRef.current) window.cancelAnimationFrame(rafRef.current); }, []);

  const addStop = () => {
    const stops = [...spec.stops].sort((a, b) => a.pos - b.pos);
    const last = stops[stops.length - 1];
    const prev = stops[stops.length - 2] ?? stops[0];
    const pos = Math.round((last.pos + prev.pos) / 2);
    push({ ...spec, stops: [...stops, { color: last.color, pos }].sort((a, b) => a.pos - b.pos) });
    onCommit();
  };

  const updateStop = (i: number, patch: Partial<{ color: string; pos: number }>) => {
    const stops = spec.stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    push({ ...spec, stops });
  };

  const removeStop = (i: number) => {
    if (spec.stops.length <= 2) return;
    push({ ...spec, stops: spec.stops.filter((_, idx) => idx !== i) });
    onCommit();
  };

  const applyPreset = (css: string) => {
    const p = parseGradient(css);
    if (!p) return;
    push(p);
    onCommit();
    setPresetOpen(false);
  };

  // 方向盘手柄坐标（半径 30px）
  const rad = ((spec.angle - 90) * Math.PI) / 180;
  const hx = 44 + Math.cos(rad) * 30;
  const hy = 44 + Math.sin(rad) * 30;

  return (
    <div className="grad-editor">
      {/* 预览条 */}
      <div className="grad-preview" style={{ backgroundImage: serializeGradient(spec) }} title="实时预览">
        <span className="grad-preview-tag">{scope === 'text' ? '文字渐变预览' : '渐变预览'}</span>
        {scope === 'text' && (
          <span className="grad-preview-text" style={{ backgroundImage: serializeGradient(spec) }}>
            Aa 文字
          </span>
        )}
      </div>

      {/* 类型 + 角度 */}
      <div className="grad-row">
        <div className="grad-seg">
          <button
            className={'grad-seg-btn' + (spec.type === 'linear' ? ' active' : '')}
            onClick={() => { push({ ...spec, type: 'linear' }); onCommit(); }}
            title="线性渐变：沿一个方向从一种颜色过渡到另一种"
          >线性</button>
          <button
            className={'grad-seg-btn' + (spec.type === 'radial' ? ' active' : '')}
            onClick={() => { push({ ...spec, type: 'radial' }); onCommit(); }}
            title="径向渐变：从中心向外扩散"
          >径向</button>
        </div>
        {spec.type === 'linear' && (
          <div className="grad-angle-mini">
            <input
              type="number"
              className="grad-angle-num"
              value={angleDraft}
              min={0}
              max={359}
              onChange={(e) => setAngleDraft(e.target.value)}
              onBlur={() => {
                const n = Number(angleDraft);
                if (!Number.isNaN(n)) { push({ ...spec, angle: (((n % 360) + 360) % 360) }); }
                onCommit();
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            <span className="grad-angle-unit">deg</span>
            <span className="grad-angle-hint">{angleHint(spec.angle)}</span>
          </div>
        )}
      </div>

      {spec.type === 'linear' && (
        <div className="grad-dial-row">
          <div
            ref={dialRef}
            className="grad-dial"
            onPointerDown={onDialDown}
            onPointerMove={onDialMove}
            onPointerUp={onDialUp}
            onPointerCancel={onDialUp}
            title="按住拖动调整渐变方向"
          >
            <div className="grad-dial-ring" />
            <div ref={needleRef} className="grad-dial-needle" style={{ transform: `rotate(${spec.angle}deg)` }} />
            <div ref={knobRef} className="grad-dial-knob" style={{ left: hx, top: hy }} />
            <span className="grad-dial-center" />
          </div>
          <div className="grad-angle-presets">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
              <button
                key={a}
                className={'grad-angle-btn' + (Math.round(spec.angle) === a ? ' active' : '')}
                onClick={() => { push({ ...spec, angle: a }); onCommit(); }}
                title={angleHint(a)}
              >{a}°</button>
            ))}
          </div>
        </div>
      )}

      {spec.type === 'radial' && (
        <div className="grad-row grad-shape-row">
          <span className="grad-label">形状</span>
          <div className="grad-seg">
            <button
              className={'grad-seg-btn' + (spec.shape === 'circle' ? ' active' : '')}
              onClick={() => { push({ ...spec, shape: 'circle' }); onCommit(); }}
            >圆形</button>
            <button
              className={'grad-seg-btn' + (spec.shape === 'ellipse' ? ' active' : '')}
              onClick={() => { push({ ...spec, shape: 'ellipse' }); onCommit(); }}
            >椭圆</button>
          </div>
        </div>
      )}

      {/* 色标列表 */}
      <div className="grad-stops-head">
        <span className="grad-label">色标（{spec.stops.length}）</span>
        <button className="btn-mini" onClick={addStop} title="在中间插入一个新色标">+ 添加色标</button>
      </div>
      <div className="grad-stops">
        {spec.stops.map((s, i) => (
          <div className="grad-stop" key={i}>
            <ColorField
              value={s.color}
              fallback="#667eea"
              inputClassName="grad-stop-color"
              onInputFocus={() => { /* 会话由调用方 beginStyleEdit 负责 */ }}
              onChange={(v) => updateStop(i, { color: v })}
              onInputBlur={() => onCommit()}
              onModalOpen={() => { /* noop */ }}
              onModalClose={(v) => { updateStop(i, { color: v }); onCommit(); }}
            />
            <input
              type="range"
              className="grad-stop-range"
              min={0}
              max={100}
              value={Math.round(s.pos)}
              onPointerDown={() => { /* 拖动开始 */ }}
              onChange={(e) => updateStop(i, { pos: Number(e.target.value) })}
              onPointerUp={() => onCommit()}
              title="色标位置百分比"
            />
            <span className="grad-stop-pos">{Math.round(s.pos)}%</span>
            <button
              className="grad-stop-del"
              disabled={spec.stops.length <= 2}
              onClick={() => removeStop(i)}
              title={spec.stops.length <= 2 ? '至少保留 2 个色标' : '删除这个色标'}
            >×</button>
          </div>
        ))}
      </div>

      {/* 预制渐变画廊 */}
      <div className="grad-presets-head">
        <button className="grad-presets-toggle" onClick={() => setPresetOpen((v) => !v)}>
          <span className={'page-advanced-caret' + (presetOpen ? ' open' : '')}>▸</span>
          预制渐变配色（{GRADIENT_PRESETS.length} 款）
        </button>
        <button className="btn-mini grad-clear-btn" onClick={onRemove} title="移除渐变，恢复纯色">移除渐变</button>
      </div>
      {presetOpen && (
        <div className="grad-presets">
          {GRADIENT_PRESET_GROUPS.map((g) => (
            <div className="grad-preset-group" key={g}>
              <div className="grad-preset-group-title">{g}</div>
              <div className="grad-preset-grid">
                {GRADIENT_PRESETS.filter((p) => p.group === g).map((p) => (
                  <button
                    key={p.name}
                    className="grad-preset-item"
                    style={{ backgroundImage: p.css }}
                    title={p.name}
                    onClick={() => applyPreset(p.css)}
                  >
                    <span className="grad-preset-name">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default GradientEditor;
