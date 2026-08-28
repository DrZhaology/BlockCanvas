import { useState, useEffect, useRef } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { ColorField } from './ColorPicker';

// BlockCanvas · 盒子阴影可视化组件 (BoxShadowInput)
// - 胶囊预设：浅浮雕、立体悬浮、发光光晕、深色弥散等一键设置
// - 分项控制：X/Y 偏移、模糊、扩散、颜色、内阴影
// - 支持默认状态和伪类状态（如 :hover / :active）

interface Props {
  elementId: string;
  pseudo?: string | null;
}

interface ParsedShadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
}

function parseBoxShadow(val: string): ParsedShadow {
  const res: ParsedShadow = { x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.15)', inset: false };
  if (!val || typeof val !== 'string') return res;

  const isInset = /\binset\b/i.test(val);
  res.inset = isInset;

  const clean = val.replace(/\binset\b/ig, '').trim();

  // 匹配颜色部分 (rgba / rgb / #hex / hsl)
  let color = 'rgba(0,0,0,0.15)';
  const colorMatch = /(rgba?\([^)]+\)|#[0-9a-f]{3,8}|[a-z]+)/i.exec(clean);
  if (colorMatch) {
    color = colorMatch[1];
  }
  res.color = color;

  // 提取数字部分
  const numStr = clean.replace(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})/ig, '').trim();
  const nums = numStr.split(/\s+/).map((t) => parseFloat(t)).filter((n) => !Number.isNaN(n));

  if (nums.length >= 2) {
    res.x = nums[0] || 0;
    res.y = nums[1] || 0;
    res.blur = nums[2] !== undefined ? nums[2] : 0;
    res.spread = nums[3] !== undefined ? nums[3] : 0;
  }

  return res;
}

function composeBoxShadow(p: ParsedShadow): string {
  if (p.x === 0 && p.y === 0 && p.blur === 0 && p.spread === 0) return '';
  const parts: string[] = [];
  if (p.inset) parts.push('inset');
  parts.push(`${p.x}px`, `${p.y}px`, `${p.blur}px`);
  if (p.spread !== 0) parts.push(`${p.spread}px`);
  parts.push(p.color || 'rgba(0,0,0,0.15)');
  return parts.join(' ');
}

export function BoxShadowInput({ elementId, pseudo }: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  const node = findNode(scene.root, elementId);
  const isPseudo = Boolean(pseudo);
  const currentStr = (
    isPseudo
      ? (node?.pseudoStyles?.[pseudo!]?.boxShadow as string)
      : (node?.style?.boxShadow as string)
  ) ?? '';

  const parsed = parseBoxShadow(currentStr);
  const [x, setX] = useState(parsed.x);
  const [y, setY] = useState(parsed.y);
  const [blur, setBlur] = useState(parsed.blur);
  const [spread, setSpread] = useState(parsed.spread);
  const [color, setColor] = useState(parsed.color);
  const [inset, setInset] = useState(parsed.inset);

  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      const p = parseBoxShadow(currentStr);
      setX(p.x);
      setY(p.y);
      setBlur(p.blur);
      setSpread(p.spread);
      setColor(p.color);
      setInset(p.inset);
    }
  }, [currentStr]);

  const commitValue = (valStr: string) => {
    if (isPseudo) {
      const nextPs = { ...(node?.pseudoStyles ?? {}) };
      if (!valStr) {
        if (nextPs[pseudo!]) {
          const nextStyle = { ...nextPs[pseudo!] };
          delete nextStyle.boxShadow;
          nextPs[pseudo!] = nextStyle;
        }
      } else {
        nextPs[pseudo!] = { ...(nextPs[pseudo!] ?? {}), boxShadow: valStr };
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
      updateStyle(elementId, { boxShadow: valStr || undefined });
    }
  };

  const apply = (next: Partial<ParsedShadow>, commit = false) => {
    const full: ParsedShadow = {
      x: next.x ?? x,
      y: next.y ?? y,
      blur: next.blur ?? blur,
      spread: next.spread ?? spread,
      color: next.color ?? color,
      inset: next.inset ?? inset
    };
    if (next.x !== undefined) setX(next.x);
    if (next.y !== undefined) setY(next.y);
    if (next.blur !== undefined) setBlur(next.blur);
    if (next.spread !== undefined) setSpread(next.spread);
    if (next.color !== undefined) setColor(next.color);
    if (next.inset !== undefined) setInset(next.inset);

    const comp = composeBoxShadow(full);
    if (commit) {
      commitValue(comp);
      endStyleEdit();
    } else {
      if (isPseudo) {
        commitValue(comp);
      } else {
        updateStyleTransient(elementId, { boxShadow: comp || undefined });
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
          className={'btn-mini' + (currentStr.includes('2px 8px') ? ' active' : '')}
          onClick={() => applyPreset('0 2px 8px rgba(0, 0, 0, 0.08)')}
          title="轻微浅浮雕阴影"
        >
          ☁️ 浅浮雕
        </button>
        <button
          className={'btn-mini' + (currentStr.includes('10px 25px') ? ' active' : '')}
          onClick={() => applyPreset('0 10px 25px rgba(0, 0, 0, 0.15)')}
          title="立体悬浮阴影 (卡片 hover 常用)"
        >
          📦 立体悬浮
        </button>
        <button
          className={'btn-mini' + (currentStr.includes('30, 136, 229') ? ' active' : '')}
          onClick={() => applyPreset('0 0 16px rgba(30, 136, 229, 0.4)')}
          title="蓝色品牌光晕效果"
        >
          💡 蓝色光晕
        </button>
        <button
          className={'btn-mini' + (currentStr.includes('20px 40px') ? ' active' : '')}
          onClick={() => applyPreset('0 20px 40px rgba(0, 0, 0, 0.25)')}
          title="大范围弥散深色阴影"
        >
          🏮 弥散深影
        </button>
        {currentStr && (
          <button
            className="btn-mini btn-danger"
            onClick={() => applyPreset('')}
            title="清除阴影"
          >
            🚫 无阴影
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
            min={-30}
            max={40}
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
            min={-30}
            max={30}
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
          <span className="vis-label">模糊大小 (Blur)</span>
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={blur}
            onMouseDown={() => { editingRef.current = true; beginStyleEdit(); }}
            onChange={(e) => apply({ blur: parseFloat(e.target.value) || 0 })}
            onMouseUp={() => { editingRef.current = false; apply({ blur }, true); }}
          />
          <span className="vis-num">{blur}px</span>
        </div>

        {/* 扩散大小 */}
        <div className="vis-control-row">
          <span className="vis-label">扩散范围 (Spread)</span>
          <input
            type="range"
            min={-15}
            max={30}
            step={1}
            value={spread}
            onMouseDown={() => { editingRef.current = true; beginStyleEdit(); }}
            onChange={(e) => apply({ spread: parseFloat(e.target.value) || 0 })}
            onMouseUp={() => { editingRef.current = false; apply({ spread }, true); }}
          />
          <span className="vis-num">{spread}px</span>
        </div>

        {/* 阴影颜色与内阴影开关 */}
        <div className="vis-control-row-full">
          <div className="vis-shadow-color-wrap">
            <span className="vis-label">阴影颜色</span>
            <ColorField
              value={color}
              fallback="rgba(0,0,0,0.15)"
              onInputFocus={() => { beginStyleEdit(); }}
              onChange={(c) => apply({ color: c })}
              onInputBlur={(c) => apply({ color: c }, true)}
              onModalOpen={() => { beginStyleEdit(); }}
              onModalClose={(c) => apply({ color: c }, true)}
            />
          </div>
          <label className="vis-check-label" title="开启内阴影 (inset)">
            <input
              type="checkbox"
              checked={inset}
              onChange={(e) => {
                beginStyleEdit();
                apply({ inset: e.target.checked }, true);
              }}
            />
            内阴影 (inset)
          </label>
        </div>
      </div>
    </div>
  );
}
