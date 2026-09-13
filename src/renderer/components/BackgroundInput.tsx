import { useRef, useState } from 'react';
import { useScene, findNode, getEffectiveStyle } from '@store/sceneStore';
import { ColorPicker } from './ColorPicker';
import { GradientEditor } from './GradientEditor';
import { isGradient, defaultGradient, serializeGradient } from '@lib/gradient';

// BlockCanvas · 背景设置（纯色 ↔ 渐变 双模式）
// - 纯色：沿用富调色盘（HEX / RGB / RGBA / 英文色名 / 透明）
// - 渐变：PowerPoint 风格可视化渐变板块（角度盘 / 色标 / 预制配色）
// 两者都写进同一个 style：纯色 → background-color，渐变 → background-image

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
  const bgImage = ((eff as Record<string, string | undefined>).backgroundImage ?? '') as string;
  const hasGrad = isGradient(bgImage);
  const mode: 'solid' | 'gradient' = hasGrad ? 'gradient' : 'solid';

  // 渐变会话：拖动过程 transient 不入栈，松手才提交一次
  const draftRef = useRef(bgImage);
  const [tick, setTick] = useState(0);

  const switchMode = (next: 'solid' | 'gradient') => {
    if (next === mode) return;
    beginStyleEdit();
    if (next === 'gradient') {
      updateStyle(elementId, { backgroundImage: serializeGradient(defaultGradient()) } as any);
    } else {
      // 只清渐变，不动用户可能设置的 background-color
      updateStyle(elementId, { backgroundImage: undefined } as any);
    }
    endStyleEdit();
    setTick((t) => t + 1);
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
      </div>

      {mode === 'solid' ? (
        <ColorPicker
          elementId={elementId}
          styleKey="backgroundColor"
          fallback={fallback}
        />
      ) : (
        <GradientEditor
          value={bgImage}
          scope="background"
          onChange={(css) => {
            draftRef.current = css;
            updateStyleTransient(elementId, { backgroundImage: css } as any);
          }}
          onCommit={() => {
            beginStyleEdit();
            updateStyle(elementId, { backgroundImage: draftRef.current } as any);
            endStyleEdit();
          }}
          onRemove={() => {
            beginStyleEdit();
            updateStyle(elementId, { backgroundImage: undefined } as any);
            endStyleEdit();
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

export default BackgroundInput;
