import { useRef, useState } from 'react';
import { useScene, findNode, getEffectiveStyle } from '@store/sceneStore';
import { ColorPicker } from './ColorPicker';
import { GradientEditor } from './GradientEditor';
import { Icon } from './Icon';
import { isGradient, defaultGradient, serializeGradient } from '@lib/gradient';

// BlockCanvas · 背景设置（纯色 / 渐变 / 图片 三模式）
// - 纯色：沿用富调色盘（HEX / RGB / RGBA / 英文色名 / 透明）
// - 渐变：PowerPoint 风格可视化渐变板块（角度盘 / 色标 / 预制配色）
// - 图片：网络 URL 或本地文件（走 bc-img:// 协议），并给出铺满方式 / 位置 / 平铺
// 三者都写进同一个 style：纯色 → background-color，渐变/图片 → background-image
//
// v0.4.5：新增「图片」模式（用户反馈"背景不能设置图片"）。

type BgMode = 'solid' | 'gradient' | 'image';

/** 本地绝对路径 → bc-img://（与画布/首页同一套协议） */
function toImgUrl(p: string): string {
  const s = (p || '').trim();
  if (!s) return '';
  if (/^(https?:|data:|bc-img:)/i.test(s)) return s;
  return 'bc-img://file/' + encodeURIComponent(s);
}

/** 从 background-image 里取出 url(...) 的内容 */
function pickUrl(css: string): string {
  const m = /url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(css || '');
  return m ? m[2] : '';
}

const SIZE_OPTS: Array<[string, string]> = [
  ['cover', '铺满（裁切）'],
  ['contain', '完整显示（留白）'],
  ['auto', '原始尺寸'],
  ['100% 100%', '拉伸到 100% × 100%']
];
const POS_OPTS: Array<[string, string]> = [
  ['center', '居中'],
  ['top', '顶部'],
  ['bottom', '底部'],
  ['left', '靠左'],
  ['right', '靠右']
];
const REPEAT_OPTS: Array<[string, string]> = [
  ['no-repeat', '不平铺'],
  ['repeat', '双向平铺'],
  ['repeat-x', '横向平铺'],
  ['repeat-y', '纵向平铺']
];

export function BackgroundInput(props: { elementId: string; fallback?: string }) {
  const { elementId, fallback = '#ffffff' } = props;
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyle = useScene((s) => s.updateStyle);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);

  const node = findNode(scene.root, elementId);
  const eff = node ? getEffectiveStyle(node, activeBreakpoint) : {};
  const effMap = eff as Record<string, string | undefined>;
  const bgImage = (effMap.backgroundImage ?? '') as string;
  const hasGrad = isGradient(bgImage);
  const hasImage = !hasGrad && /url\(/i.test(bgImage);
  const mode: BgMode = hasGrad ? 'gradient' : hasImage ? 'image' : 'solid';

  const imgUrl = hasImage ? pickUrl(bgImage) : '';
  const bgSize = effMap.backgroundSize ?? 'cover';
  const bgPos = effMap.backgroundPosition ?? 'center';
  const bgRepeat = effMap.backgroundRepeat ?? 'no-repeat';

  // 渐变会话：拖动过程 transient 不入栈，松手才提交一次
  const draftRef = useRef(bgImage);
  const [tick, setTick] = useState(0);
  // 图片地址输入框的草稿（回车/失焦才写进样式，避免每敲一个字就改一次）
  const [urlDraft, setUrlDraft] = useState(imgUrl);
  const [picking, setPicking] = useState(false);

  const switchMode = (next: BgMode) => {
    if (next === mode) return;
    beginStyleEdit();
    if (next === 'gradient') {
      updateStyle(elementId, { backgroundImage: serializeGradient(defaultGradient()) } as never);
    } else if (next === 'image') {
      // 切到图片：先给一套"铺满 + 居中 + 不平铺"的合理默认，避免一上来就是拉伸的原始尺寸
      updateStyle(elementId, {
        backgroundImage: 'url("")',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      } as never);
    } else {
      // 只清 background-image，不动用户可能设置的 background-color
      updateStyle(elementId, { backgroundImage: undefined } as never);
    }
    endStyleEdit();
    setTick((t) => t + 1);
  };

  const applyUrl = (raw: string) => {
    const u = toImgUrl(raw);
    beginStyleEdit();
    updateStyle(elementId, { backgroundImage: u ? `url("${u}")` : undefined } as never);
    endStyleEdit();
    setTick((t) => t + 1);
  };

  const pickLocal = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const r = await window.bc.pickMediaSrc('image');
      if (!r?.ok || !r.path) return;
      const u = toImgUrl(r.path);
      setUrlDraft(u);
      applyUrl(u);
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="bg-input" data-tick={tick}>
      <div className="bg-mode-seg">
        <button
          className={'bg-mode-btn' + (mode === 'solid' ? ' active' : '')}
          onClick={() => switchMode('solid')}
          title="纯色填充"
        >纯色</button>
        <button
          className={'bg-mode-btn' + (mode === 'gradient' ? ' active' : '')}
          onClick={() => switchMode('gradient')}
          title="渐变色填充（可调方向、色标、套用预制配色）"
        >渐变</button>
        <button
          className={'bg-mode-btn' + (mode === 'image' ? ' active' : '')}
          onClick={() => switchMode('image')}
          title="图片填充（网络地址或本地图片，可调铺满方式与位置）"
        >图片</button>
      </div>

      {mode === 'solid' && (
        <ColorPicker
          elementId={elementId}
          styleKey="backgroundColor"
          fallback={fallback}
        />
      )}

      {mode === 'gradient' && (
        <GradientEditor
          value={bgImage}
          scope="background"
          onChange={(css) => {
            beginStyleEdit();
            draftRef.current = css;
            updateStyleTransient(elementId, { backgroundImage: css } as never);
          }}
          onCommit={() => {
            updateStyle(elementId, { backgroundImage: draftRef.current } as never);
            endStyleEdit();
          }}
          onRemove={() => {
            beginStyleEdit();
            updateStyle(elementId, { backgroundImage: undefined } as never);
            endStyleEdit();
            setTick((t) => t + 1);
          }}
        />
      )}

      {mode === 'image' && (
        <div className="bg-image-box">
          {imgUrl ? (
            <div className="bg-image-thumb">
              <img src={imgUrl} alt="" draggable={false} />
            </div>
          ) : (
            <div className="bg-image-thumb is-empty">
              <Icon name="image" size={20} />
              <span>还没有选图片</span>
            </div>
          )}

          <div className="bg-image-url-row">
            <input
              className="bg-image-url"
              value={urlDraft}
              placeholder="粘贴图片地址 https://… 或点右侧选择本地文件"
              spellCheck={false}
              onChange={(e) => setUrlDraft(e.target.value)}
              onBlur={() => { if (urlDraft.trim() !== imgUrl) applyUrl(urlDraft); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); applyUrl(urlDraft); }
                if (e.key === 'Escape') { setUrlDraft(imgUrl); (e.target as HTMLInputElement).blur(); }
              }}
            />
            <button
              className="btn-mini bg-image-pick"
              onClick={() => void pickLocal()}
              disabled={picking}
              title="从本机选一张图片（会以 bc-img:// 引用，导出时随工程一起处理）"
            >{picking ? '选择中…' : '本地图片…'}</button>
          </div>

          <div className="bg-image-opts">
            <label className="bg-image-opt">
              <span>铺满方式</span>
              <select
                value={bgSize}
                onChange={(e) => { beginStyleEdit(); updateStyle(elementId, { backgroundSize: e.target.value } as never); endStyleEdit(); }}
              >
                {SIZE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="bg-image-opt">
              <span>位置</span>
              <select
                value={bgPos}
                onChange={(e) => { beginStyleEdit(); updateStyle(elementId, { backgroundPosition: e.target.value } as never); endStyleEdit(); }}
              >
                {POS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="bg-image-opt">
              <span>平铺</span>
              <select
                value={bgRepeat}
                onChange={(e) => { beginStyleEdit(); updateStyle(elementId, { backgroundRepeat: e.target.value } as never); endStyleEdit(); }}
              >
                {REPEAT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>

          {imgUrl && (
            <button
              className="bg-image-clear"
              onClick={() => { setUrlDraft(''); applyUrl(''); }}
              title="移除背景图片，回到纯色"
            ><Icon name="close" size={12} /> 移除图片</button>
          )}
        </div>
      )}
    </div>
  );
}
