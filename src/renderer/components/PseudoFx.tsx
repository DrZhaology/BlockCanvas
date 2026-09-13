import {
  parseTransform,
  buildTransform,
  parseShadow,
  buildShadow,
  parseDuration,
  transitionEasing,
  parseRadius
} from '@lib/fx';
import { HelpButton } from './HelpButton';

// BlockCanvas · 伪类预制动效库 + 滑块微调
// 过去 hover / active 只有「+ 添加属性」这一条冷启动路径，新手完全不知道从哪下手，
// 原来的几个预制效果也丢了。现在每个伪类都配一整套「一句话就能用」的动效，
// 套用后还能用滑块继续改数值，做到高度自定义。

export type PseudoClass = 'hover' | 'active' | 'focus' | 'link';

export interface FxPreset {
  id: string;
  name: string;
  icon: string;
  desc: string;
  patch: Record<string, string>;
}

export const PSEUDO_PRESETS: Record<PseudoClass, FxPreset[]> = {
  hover: [
    { id: 'lift', name: '上浮', icon: '⬆', desc: '向上抬起并加深投影', patch: { transform: 'translateY(-6px)', boxShadow: '0 12px 26px rgba(0, 0, 0, 0.16)' } },
    { id: 'zoom', name: '放大', icon: '⤢', desc: '整体轻微放大', patch: { transform: 'scale(1.05)', boxShadow: '0 10px 22px rgba(0, 0, 0, 0.14)' } },
    { id: 'glow', name: '发光', icon: '✨', desc: '外圈品牌色光晕', patch: { boxShadow: '0 0 0 3px rgba(30, 136, 229, 0.28), 0 8px 22px rgba(30, 136, 229, 0.32)' } },
    { id: 'liftZoom', name: '浮起放大', icon: '🚀', desc: '上浮 + 放大，卡片最常用', patch: { transform: 'translateY(-4px) scale(1.03)', boxShadow: '0 16px 32px rgba(0, 0, 0, 0.18)' } },
    { id: 'tilt', name: '轻微倾斜', icon: '🌀', desc: '带一点俏皮的旋转', patch: { transform: 'rotate(-2deg) scale(1.03)' } },
    { id: 'deep', name: '投影加深', icon: '🌑', desc: '原地加深立体感', patch: { boxShadow: '0 18px 36px rgba(0, 0, 0, 0.24)' } },
    { id: 'darken', name: '变暗', icon: '🌗', desc: '整体压暗一档', patch: { filter: 'brightness(0.92)' } },
    { id: 'brighten', name: '变亮', icon: '🔆', desc: '整体提亮一档', patch: { filter: 'brightness(1.08)' } },
    { id: 'underline', name: '出现下划线', icon: '▁', desc: '文字链接常用', patch: { textDecoration: 'underline' } }
  ],
  active: [
    { id: 'sink', name: '按下下沉', icon: '⬇', desc: '按钮被按下去', patch: { transform: 'translateY(2px)' } },
    { id: 'shrink', name: '按压缩小', icon: '⤡', desc: '点击瞬间收紧', patch: { transform: 'scale(0.96)' } },
    { id: 'pressDark', name: '按压变暗', icon: '🌚', desc: '按下时压暗', patch: { filter: 'brightness(0.9)' } },
    { id: 'inner', name: '内凹阴影', icon: '🕳', desc: '像被按进表面里', patch: { boxShadow: 'inset 0 3px 8px rgba(0, 0, 0, 0.2)' } },
    { id: 'sinkShrink', name: '下沉并缩小', icon: '🔽', desc: '最真实的按压反馈', patch: { transform: 'translateY(2px) scale(0.97)' } }
  ],
  focus: [
    { id: 'ring', name: '外圈光晕', icon: '◎', desc: '聚焦时的标准外环', patch: { boxShadow: '0 0 0 3px rgba(30, 136, 229, 0.35)' } },
    { id: 'softRing', name: '柔光扩散', icon: '🔵', desc: '更柔和的聚焦提示', patch: { boxShadow: '0 0 0 6px rgba(30, 136, 229, 0.16)' } },
    { id: 'borderHi', name: '边框高亮', icon: '▢', desc: '描边变品牌色', patch: { borderStyle: 'solid', borderWidth: '1px', borderColor: '#1e88e5' } },
    { id: 'bottomLine', name: '底部横线', icon: '▁', desc: '输入框经典下划线', patch: { borderStyle: 'solid', borderWidth: '0 0 2px 0', borderColor: '#1e88e5' } }
  ],
  link: [
    { id: 'underline', name: '加下划线', icon: '▁', desc: '未访问链接的默认表现', patch: { textDecoration: 'underline' } },
    { id: 'none', name: '去掉下划线', icon: '—', desc: '导航链接常用', patch: { textDecoration: 'none' } },
    { id: 'bold', name: '加粗', icon: '𝐁', desc: '强调未访问链接', patch: { fontWeight: '600' } },
    { id: 'blue', name: '变品牌蓝', icon: '🔷', desc: '统一链接色', patch: { color: '#1e88e5' } }
  ]
};

export const PSEUDO_LABEL: Record<PseudoClass, string> = {
  hover: '悬停',
  active: '按下',
  focus: '聚焦',
  link: '链接'
};

interface Props {
  pseudo: PseudoClass;
  /** 当前伪类下已有的样式覆盖 */
  currentStyle: Record<string, string | undefined>;
  /** 元素默认（基础）样式 */
  baseStyle: Record<string, string | undefined>;
  /** 套用某个预制效果（会整体合并进伪类样式） */
  onApplyPreset: (patch: Record<string, string>) => void;
  /** 清空当前伪类的全部覆盖 */
  onClearAll: () => void;
  /** 写伪类样式（滑块拖动中为瞬态） */
  onPatch: (patch: Record<string, string>) => void;
  /** 写基础样式（过渡时长等） */
  onPatchBase: (patch: Record<string, string>) => void;
  /** 拖动开始 / 结束（撤销会话） */
  onDragStart: () => void;
  onDragEnd: () => void;
}

export function PseudoFxPanel(props: Props) {
  const { pseudo, currentStyle, baseStyle, onApplyPreset, onClearAll, onPatch, onPatchBase, onDragStart, onDragEnd } = props;
  const presets = PSEUDO_PRESETS[pseudo];

  const tf = parseTransform(currentStyle.transform);
  const sh = parseShadow(currentStyle.boxShadow);
  const radius = parseRadius(currentStyle.borderRadius);
  const duration = parseDuration(baseStyle.transition ?? currentStyle.transition);
  const easing = transitionEasing(baseStyle.transition ?? currentStyle.transition);

  const hasTransform = Boolean(currentStyle.transform);
  const hasShadow = Boolean(currentStyle.boxShadow);

  const activeId = (() => {
    // 反查当前命中的预制（简单按 transform/shadow 文本匹配）
    const hit = presets.find((p) => {
      const keys = Object.keys(p.patch);
      return keys.length > 0 && keys.every((k) => currentStyle[k] === p.patch[k]);
    });
    return hit?.id ?? null;
  })();

  return (
    <>
      <div className="pseudo-presets">
        <div className="pseudo-presets-title">
          <span>⚡ :{pseudo} 预制动效（点一下就能用）</span>
          <HelpButton
            title={`${PSEUDO_LABEL[pseudo]} 预制动效怎么用？`}
            content={
              `【三步做出交互动效】\n\n` +
              `1. 点下面任意一个预制效果 → 立刻套用到 :${pseudo} 状态；\n` +
              `2. 用「微调滑块」把位移、缩放、阴影、过渡时长调到顺眼；\n` +
              `3. 到画布上把鼠标移上去（:hover）或按住（:active）看真实效果。\n\n` +
              `【为什么要过渡？】\n` +
              `没有 transition 时，状态切换是"瞬间跳变"，很生硬。\n` +
              `打开下面的「过渡时长」滑块（推荐 0.2~0.3s），变化就会平滑自然。\n\n` +
              `【预制的含义】\n` +
              `· 上浮 / 浮起放大 —— 卡片、商品图最常用\n` +
              `· 发光 / 外圈光晕 —— 按钮、输入框聚焦\n` +
              `· 按下下沉 / 缩小 —— 按钮真实按压反馈\n\n` +
              `套用后可继续在下方「+ 添加属性」里加任意其它属性，互不冲突。`
            }
          />
          {Object.keys(currentStyle).length > 0 && (
            <button className="btn-mini btn-danger" style={{ marginLeft: 'auto' }} onClick={onClearAll} title={`清空 :${pseudo} 的全部样式覆盖`}>
              清空
            </button>
          )}
        </div>
        <div className="pseudo-preset-grid">
          {presets.map((p) => (
            <button
              key={p.id}
              className={'pseudo-preset-btn' + (activeId === p.id ? ' active' : '')}
              onClick={() => onApplyPreset(p.patch)}
              title={`${p.name}：${p.desc}`}
            >
              <span className="pseudo-preset-ico">{p.icon}</span>
              <span>{p.name}</span>
              <span className="pseudo-preset-desc">{p.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* —— 微调滑块 —— */}
      <div className="fx-sliders">
        <div className="pseudo-presets-title" style={{ marginBottom: 2 }}>
          <span>🎚 微调滑块（高度自定义）</span>
        </div>

        <FxSlider
          label="过渡时长 (transition)"
          min={0}
          max={1.5}
          step={0.05}
          value={duration}
          format={(v) => v.toFixed(2) + 's'}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onChange={(v) => onPatchBase({ transition: `all ${v.toFixed(2)}s ${easing}` })}
          hint="状态切换的平滑时长。0 表示关闭过渡（瞬间跳变），推荐 0.2~0.3s。"
        />

        {hasTransform && (
          <FxSlider
            label="垂直位移 Y"
            min={-24}
            max={24}
            step={1}
            value={tf.y}
            format={(v) => v + 'px'}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onChange={(v) => onPatch({ transform: buildTransform({ ...tf, y: v }) })}
            hint="负数向上浮起，正数向下下沉。"
          />
        )}

        {hasTransform && (
          <FxSlider
            label="缩放比例"
            min={0.7}
            max={1.4}
            step={0.01}
            value={tf.scale}
            format={(v) => v.toFixed(2) + '×'}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onChange={(v) => onPatch({ transform: buildTransform({ ...tf, scale: v }) })}
            hint="1 为原始大小，大于 1 放大、小于 1 缩小。"
          />
        )}

        {hasTransform && (
          <FxSlider
            label="旋转角度"
            min={-20}
            max={20}
            step={0.5}
            value={tf.rotate}
            format={(v) => v + '°'}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onChange={(v) => onPatch({ transform: buildTransform({ ...tf, rotate: v }) })}
            hint="轻微倾斜（±2° 以内）最自然，别太夸张。"
          />
        )}

        {hasShadow && sh && (
          <FxSlider
            label="阴影模糊"
            min={0}
            max={60}
            step={1}
            value={sh.blur}
            format={(v) => v + 'px'}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onChange={(v) => onPatch({ boxShadow: buildShadow({ ...sh, blur: v }) })}
            hint="数值越大阴影越弥散柔和。"
          />
        )}

        {hasShadow && sh && (
          <FxSlider
            label="阴影下移"
            min={-10}
            max={30}
            step={1}
            value={sh.y}
            format={(v) => v + 'px'}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onChange={(v) => onPatch({ boxShadow: buildShadow({ ...sh, y: v }) })}
            hint="阴影向下偏移越多，悬浮感越强。"
          />
        )}

        {radius !== null && (
          <FxSlider
            label="圆角 (border-radius)"
            min={0}
            max={40}
            step={1}
            value={radius}
            format={(v) => v + 'px'}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onChange={(v) => onPatch({ borderRadius: v + 'px' })}
            hint="状态切换时圆角也跟着变，会有种被撑开的动感。"
          />
        )}

        {!hasTransform && !hasShadow && radius === null && (
          <div className="hint" style={{ fontSize: 11, opacity: 0.75 }}>
            套用一个预制效果后，这里会出现对应的微调滑块。
          </div>
        )}
      </div>
    </>
  );
}

function FxSlider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  hint?: string;
}) {
  const { label, min, max, step, value, format, onChange, onDragStart, onDragEnd, hint } = props;
  return (
    <div className="fx-slider-row" title={hint}>
      <span className="fx-slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onPointerDown={onDragStart}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onKeyUp={onDragEnd}
      />
      <span className="fx-slider-val">{format(Number.isFinite(value) ? value : 0)}</span>
    </div>
  );
}

export default PseudoFxPanel;
