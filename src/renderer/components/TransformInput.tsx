import { useState, useEffect, useRef } from 'react';
import { useScene, findNode } from '@store/sceneStore';

// BlockCanvas · 变换与缩放可视化输入组件 (TransformInput)
// - 小白胶囊预设：悬浮上移、轻微放大、按下回弹、旋转等一键设置
// - 进阶分项滑块：位移(X/Y)、缩放(Scale)、旋转(Rotate)
// - 自动双向解析与合成 transform 字符串
// - 支持默认状态和伪类状态（如 :hover / :active）

interface Props {
  elementId: string;
  pseudo?: string | null;
}

interface ParsedTransform {
  translateX: number;
  translateY: number;
  scale: number;
  rotate: number;
}

function parseTransform(val: string): ParsedTransform {
  const res: ParsedTransform = { translateX: 0, translateY: 0, scale: 1, rotate: 0 };
  if (!val || typeof val !== 'string') return res;

  // translateY(-4px) or translate(0, -4px)
  const ty = /translateY\(\s*(-?[\d.]+)\s*px\s*\)/i.exec(val);
  if (ty) res.translateY = parseFloat(ty[1]) || 0;

  const tx = /translateX\(\s*(-?[\d.]+)\s*px\s*\)/i.exec(val);
  if (tx) res.translateX = parseFloat(tx[1]) || 0;

  const txy = /translate\(\s*(-?[\d.]+)\s*px\s*,\s*(-?[\d.]+)\s*px\s*\)/i.exec(val);
  if (txy) {
    res.translateX = parseFloat(txy[1]) || 0;
    res.translateY = parseFloat(txy[2]) || 0;
  }

  // scale(1.05)
  const sc = /scale\(\s*(-?[\d.]+)\s*\)/i.exec(val);
  if (sc) res.scale = parseFloat(sc[1]) || 1;

  // rotate(45deg)
  const rot = /rotate\(\s*(-?[\d.]+)\s*deg\s*\)/i.exec(val);
  if (rot) res.rotate = parseFloat(rot[1]) || 0;

  return res;
}

function composeTransform(p: ParsedTransform): string {
  const parts: string[] = [];
  if (p.translateX !== 0 && p.translateY !== 0) {
    parts.push(`translate(${p.translateX}px, ${p.translateY}px)`);
  } else if (p.translateY !== 0) {
    parts.push(`translateY(${p.translateY}px)`);
  } else if (p.translateX !== 0) {
    parts.push(`translateX(${p.translateX}px)`);
  }

  if (p.scale !== 1) {
    parts.push(`scale(${p.scale})`);
  }

  if (p.rotate !== 0) {
    parts.push(`rotate(${p.rotate}deg)`);
  }

  return parts.join(' ');
}

export function TransformInput({ elementId, pseudo }: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  const node = findNode(scene.root, elementId);
  const isPseudo = Boolean(pseudo);
  const currentStr = (
    isPseudo
      ? (node?.pseudoStyles?.[pseudo!]?.transform as string)
      : (node?.style?.transform as string)
  ) ?? '';

  const parsed = parseTransform(currentStr);
  const [tx, setTx] = useState(parsed.translateX);
  const [ty, setTy] = useState(parsed.translateY);
  const [scale, setScale] = useState(parsed.scale);
  const [rotate, setRotate] = useState(parsed.rotate);

  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      const p = parseTransform(currentStr);
      setTx(p.translateX);
      setTy(p.translateY);
      setScale(p.scale);
      setRotate(p.rotate);
    }
  }, [currentStr]);

  const commitValue = (valStr: string) => {
    if (isPseudo) {
      const nextPs = { ...(node?.pseudoStyles ?? {}) };
      if (!valStr) {
        if (nextPs[pseudo!]) {
          const nextStyle = { ...nextPs[pseudo!] };
          delete nextStyle.transform;
          nextPs[pseudo!] = nextStyle;
        }
      } else {
        nextPs[pseudo!] = { ...(nextPs[pseudo!] ?? {}), transform: valStr };
      }
      useScene.setState((s) => {
        const update = (n: any): any => {
          if (n.id === elementId) return { ...n, pseudoStyles: nextPs };
          return { ...n, children: n.children.map(update) };
        };
        return { scene: { ...s.scene, root: update(s.scene.root) } };
      });
      setTimeout(() => {
        const ts = (window as any).__tabStore;
        if (ts) ts.getState().markActiveTabDirty(true);
      }, 50);
    } else {
      updateStyle(elementId, { transform: valStr || undefined });
    }
  };

  const apply = (next: Partial<ParsedTransform>, commit = false) => {
    const full: ParsedTransform = {
      translateX: next.translateX ?? tx,
      translateY: next.translateY ?? ty,
      scale: next.scale ?? scale,
      rotate: next.rotate ?? rotate
    };
    if (next.translateX !== undefined) setTx(next.translateX);
    if (next.translateY !== undefined) setTy(next.translateY);
    if (next.scale !== undefined) setScale(next.scale);
    if (next.rotate !== undefined) setRotate(next.rotate);

    const comp = composeTransform(full);
    if (commit) {
      commitValue(comp);
      endStyleEdit();
    } else {
      if (isPseudo) {
        commitValue(comp);
      } else {
        updateStyleTransient(elementId, { transform: comp || undefined });
      }
    }
  };

  const applyPreset = (preset: Partial<ParsedTransform>) => {
    beginStyleEdit();
    apply(preset, true);
  };

  return (
    <div className="vis-transform-wrap">
      {/* 常用胶囊预设 */}
      <div className="vis-preset-row">
        <button
          className={'btn-mini' + (ty === -4 && scale === 1 && rotate === 0 ? ' active' : '')}
          onClick={() => applyPreset({ translateX: 0, translateY: -4, scale: 1, rotate: 0 })}
          title="Y轴向上浮起 4px (卡片 hover 最常用)"
        >
          🎈 悬浮上移 -4px
        </button>
        <button
          className={'btn-mini' + (scale === 1.05 && ty === 0 && rotate === 0 ? ' active' : '')}
          onClick={() => applyPreset({ translateX: 0, translateY: 0, scale: 1.05, rotate: 0 })}
          title="轻微放大 1.05 倍 (按钮 hover 常用)"
        >
          🔍 放大 1.05x
        </button>
        <button
          className={'btn-mini' + (scale === 0.96 && ty === 0 && rotate === 0 ? ' active' : '')}
          onClick={() => applyPreset({ translateX: 0, translateY: 0, scale: 0.96, rotate: 0 })}
          title="缩小 0.96 倍 (点击 active 按下态常用)"
        >
          🔘 按下态 0.96x
        </button>
        <button
          className={'btn-mini' + (scale === 1.05 && ty === -4 ? ' active' : '')}
          onClick={() => applyPreset({ translateX: 0, translateY: -4, scale: 1.05, rotate: 0 })}
          title="放大 + 悬浮组合效果"
        >
          💥 放大+悬浮
        </button>
        <button
          className={'btn-mini' + (rotate === 45 ? ' active' : '')}
          onClick={() => applyPreset({ translateX: 0, translateY: 0, scale: 1, rotate: 45 })}
          title="顺时针旋转 45 度"
        >
          🔄 旋转 45°
        </button>
        {currentStr && (
          <button
            className="btn-mini btn-danger"
            onClick={() => applyPreset({ translateX: 0, translateY: 0, scale: 1, rotate: 0 })}
            title="复位清除所有变换"
          >
            ↩️ 复位
          </button>
        )}
      </div>

      {/* 分项滑块与数字调节 */}
      <div className="vis-controls-grid">
        {/* Y 轴位移 */}
        <div className="vis-control-row">
          <span className="vis-label">垂直位移 Y</span>
          <input
            type="range"
            min={-30}
            max={30}
            step={1}
            value={ty}
            onMouseDown={() => { editingRef.current = true; beginStyleEdit(); }}
            onChange={(e) => apply({ translateY: parseFloat(e.target.value) || 0 })}
            onMouseUp={() => { editingRef.current = false; apply({ translateY: ty }, true); }}
          />
          <span className="vis-num">{ty}px</span>
        </div>

        {/* X 轴位移 */}
        <div className="vis-control-row">
          <span className="vis-label">水平位移 X</span>
          <input
            type="range"
            min={-30}
            max={30}
            step={1}
            value={tx}
            onMouseDown={() => { editingRef.current = true; beginStyleEdit(); }}
            onChange={(e) => apply({ translateX: parseFloat(e.target.value) || 0 })}
            onMouseUp={() => { editingRef.current = false; apply({ translateX: tx }, true); }}
          />
          <span className="vis-num">{tx}px</span>
        </div>

        {/* 缩放比例 */}
        <div className="vis-control-row">
          <span className="vis-label">缩放比例</span>
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.01}
            value={scale}
            onMouseDown={() => { editingRef.current = true; beginStyleEdit(); }}
            onChange={(e) => apply({ scale: parseFloat(e.target.value) || 1 })}
            onMouseUp={() => { editingRef.current = false; apply({ scale }, true); }}
          />
          <span className="vis-num">{scale.toFixed(2)}x</span>
        </div>

        {/* 旋转角度 */}
        <div className="vis-control-row">
          <span className="vis-label">旋转角度</span>
          <input
            type="range"
            min={-180}
            max={180}
            step={5}
            value={rotate}
            onMouseDown={() => { editingRef.current = true; beginStyleEdit(); }}
            onChange={(e) => apply({ rotate: parseFloat(e.target.value) || 0 })}
            onMouseUp={() => { editingRef.current = false; apply({ rotate }, true); }}
          />
          <span className="vis-num">{rotate}°</span>
        </div>
      </div>
    </div>
  );
}
