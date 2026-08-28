import { useState, useEffect, useRef } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { ColorField } from './ColorPicker';

// BlockCanvas · 文字阴影可视化组件 (TextShadowInput)
// - 胶囊预设：柔和黑底、霓虹发光、印刷立体等一键应用
// - 分项调节：X/Y 偏移、模糊度、颜色
// - 支持默认状态和伪类状态（如 :hover / :active）

interface Props {
  elementId: string;
  pseudo?: string | null;
}

interface ParsedTextShadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

function parseTextShadow(val: string): ParsedTextShadow {
  const res: ParsedTextShadow = { x: 0, y: 2, blur: 4, color: 'rgba(0,0,0,0.3)' };
  if (!val || typeof val !== 'string') return res;

  // 提取颜色
  let color = 'rgba(0,0,0,0.3)';
  const colorMatch = /(rgba?\([^)]+\)|#[0-9a-f]{3,8}|[a-z]+)/i.exec(val);
  if (colorMatch) {
    color = colorMatch[1];
  }
  res.color = color;

  // 提取数字
  const numStr = val.replace(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})/ig, '').trim();
  const nums = numStr.split(/\s+/).map((t) => parseFloat(t)).filter((n) => !Number.isNaN(n));

  if (nums.length >= 2) {
    res.x = nums[0] || 0;
    res.y = nums[1] || 0;
    res.blur = nums[2] !== undefined ? nums[2] : 0;
  }

  return res;
}

function composeTextShadow(p: ParsedTextShadow): string {
  if (p.x === 0 && p.y === 0 && p.blur === 0) return '';
  return `${p.x}px ${p.y}px ${p.blur}px ${p.color || 'rgba(0,0,0,0.3)'}`;
}

export function TextShadowInput({ elementId, pseudo }: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  const node = findNode(scene.root, elementId);
  const isPseudo = Boolean(pseudo);
  const currentStr = (
    isPseudo
      ? (node?.pseudoStyles?.[pseudo!]?.textShadow as string)
      : (node?.style?.textShadow as string)
  ) ?? '';

  const parsed = parseTextShadow(currentStr);
  const [x, setX] = useState(parsed.x);
  const [y, setY] = useState(parsed.y);
  const [blur, setBlur] = useState(parsed.blur);
  const [color, setColor] = useState(parsed.color);

  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      const p = parseTextShadow(currentStr);
      setX(p.x);
      setY(p.y);
      setBlur(p.blur);
      setColor(p.color);
    }
  }, [currentStr]);

  const commitValue = (valStr: string) => {
    if (isPseudo) {
      const nextPs = { ...(node?.pseudoStyles ?? {}) };
      if (!valStr) {
        if (nextPs[pseudo!]) {
          const nextStyle = { ...nextPs[pseudo!] };
          delete nextStyle.textShadow;
          nextPs[pseudo!] = nextStyle;
        }
      } else {
        nextPs[pseudo!] = { ...(nextPs[pseudo!] ?? {}), textShadow: valStr };
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
      updateStyle(elementId, { textShadow: valStr || undefined });
    }
  };

  const apply = (next: Partial<ParsedTextShadow>, commit = false) => {
    const full: ParsedTextShadow = {
      x: next.x ?? x,
      y: next.y ?? y,
      blur: next.blur ?? blur,
      color: next.color ?? color
    };
    if (next.x !== undefined) setX(next.x);
    if (next.y !== undefined) setY(next.y);
    if (next.blur !== undefined) setBlur(next.blur);
    if (next.color !== undefined) setColor(next.color);

    const comp = composeTextShadow(full);
    if (commit) {
      commitValue(comp);
      endStyleEdit();
    } else {
      if (isPseudo) {
        commitValue(comp);
      } else {
        updateStyleTransient(elementId, { textShadow: comp || undefined });
      }
    }
  };

  const applyPreset = (rawStr: string) => {
    beginStyleEdit();
    commitValue(rawStr);
    endStyleEdit();
  };

  return (
    <div className="vis-shadow-wrap">
      {/* 常用胶囊预设 */}
      <div className="vis-preset-row">
        <button
          className={'btn-mini' + (currentStr.includes('2px 4px') ? ' active' : '')}
          onClick={() => applyPreset('0 2px 4px rgba(0, 0, 0, 0.4)')}
          title="柔和立体阴影，提升暗色文字辨识度"
        >
          🕶️ 柔和立体
        </button>
        <button
          className={'btn-mini' + (currentStr.includes('0 0 10px') ? ' active' : '')}
          onClick={() => applyPreset('0 0 10px rgba(30, 136, 229, 0.8)')}
          title="蓝色霓虹发光文字"
        >
          ✨ 霓虹发光
        </button>
        <button
          className={'btn-mini' + (currentStr.includes('1px 1px 0') ? ' active' : '')}
          onClick={() => applyPreset('1px 1px 0 rgba(255, 255, 255, 0.8)')}
          title="浅色内雕刻字效果"
        >
          🖨️ 刻印浮雕
        </button>
        {currentStr && (
          <button
            className="btn-mini btn-danger"
            onClick={() => applyPreset('')}
            title="清除文字阴影"
          >
            🚫 清除
          </button>
        )}
      </div>

      {/* 分项滑块与数字调节 */}
      <div className="vis-controls-grid">
        {/* Y 轴垂直偏移 */}
        <div className="vis-control-row">
          <span className="vis-label">垂直偏移 Y</span>
          <input
            type="range"
            min={-20}
            max={20}
            step={1}
            value={y}
            onMouseDown={() => { editingRef.current = true; beginStyleEdit(); }}
            onChange={(e) => apply({ y: parseFloat(e.target.value) || 0 })}
            onMouseUp={() => { editingRef.current = false; apply({ y }, true); }}
          />
          <span className="vis-num">{y}px</span>
        </div>

        {/* X 轴水平偏移 */}
        <div className="vis-control-row">
          <span className="vis-label">水平偏移 X</span>
          <input
            type="range"
            min={-20}
            max={20}
            step={1}
            value={x}
            onMouseDown={() => { editingRef.current = true; beginStyleEdit(); }}
            onChange={(e) => apply({ x: parseFloat(e.target.value) || 0 })}
            onMouseUp={() => { editingRef.current = false; apply({ x }, true); }}
          />
          <span className="vis-num">{x}px</span>
        </div>

        {/* 模糊半径 */}
        <div className="vis-control-row">
          <span className="vis-label">模糊度 (Blur)</span>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={blur}
            onMouseDown={() => { editingRef.current = true; beginStyleEdit(); }}
            onChange={(e) => apply({ blur: parseFloat(e.target.value) || 0 })}
            onMouseUp={() => { editingRef.current = false; apply({ blur }, true); }}
          />
          <span className="vis-num">{blur}px</span>
        </div>

        {/* 阴影颜色 */}
        <div className="vis-control-row-full">
          <div className="vis-shadow-color-wrap">
            <span className="vis-label">阴影颜色</span>
            <ColorField
              value={color}
              fallback="rgba(0,0,0,0.3)"
              onInputFocus={() => { beginStyleEdit(); }}
              onChange={(c) => apply({ color: c })}
              onInputBlur={(c) => apply({ color: c }, true)}
              onModalOpen={() => { beginStyleEdit(); }}
              onModalClose={(c) => apply({ color: c }, true)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
