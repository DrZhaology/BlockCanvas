import { useState, useEffect, useRef } from 'react';
import { useScene, findNode } from '@store/sceneStore';

// BlockCanvas · 平滑过渡动画可视化组件 (TransitionInput)
// - 胶囊预设：0.3s 舒适、0.15s 快闪、0.5s 柔和、单属性过渡等
// - 分项控制：过渡对象属性、时长滑块、缓动曲线

interface Props {
  elementId: string;
}

interface ParsedTransition {
  property: string;
  duration: number; // 秒
  timing: string;
}

function parseTransition(val: string): ParsedTransition {
  const res: ParsedTransition = { property: 'all', duration: 0.3, timing: 'ease' };
  if (!val || typeof val !== 'string') return res;

  // 匹配时长 (0.3s / 300ms)
  const durMatch = /([\d.]+)\s*(s|ms)/i.exec(val);
  if (durMatch) {
    const num = parseFloat(durMatch[1]) || 0.3;
    res.duration = durMatch[2].toLowerCase() === 'ms' ? num / 1000 : num;
  }

  // 匹配 timing
  if (/\blinear\b/i.test(val)) res.timing = 'linear';
  else if (/\bease-in-out\b/i.test(val)) res.timing = 'ease-in-out';
  else if (/\bease-in\b/i.test(val)) res.timing = 'ease-in';
  else if (/\bease-out\b/i.test(val)) res.timing = 'ease-out';
  else res.timing = 'ease';

  // 匹配 property
  if (/\bbackground(-color)?\b/i.test(val)) res.property = 'background';
  else if (/\btransform\b/i.test(val)) res.property = 'transform';
  else if (/\bbox-shadow\b/i.test(val)) res.property = 'box-shadow';
  else if (/\bopacity\b/i.test(val)) res.property = 'opacity';
  else res.property = 'all';

  return res;
}

function composeTransition(p: ParsedTransition): string {
  if (p.duration <= 0) return '';
  return `${p.property} ${p.duration}s ${p.timing}`;
}

export function TransitionInput({ elementId }: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  const node = findNode(scene.root, elementId);
  const currentStr = (node?.style?.transition as string) ?? '';

  const parsed = parseTransition(currentStr);
  const [property, setProperty] = useState(parsed.property);
  const [duration, setDuration] = useState(parsed.duration);
  const [timing, setTiming] = useState(parsed.timing);

  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      const p = parseTransition(currentStr);
      setProperty(p.property);
      setDuration(p.duration);
      setTiming(p.timing);
    }
  }, [currentStr]);

  const apply = (next: Partial<ParsedTransition>, commit = false) => {
    const full: ParsedTransition = {
      property: next.property ?? property,
      duration: next.duration ?? duration,
      timing: next.timing ?? timing
    };
    if (next.property !== undefined) setProperty(next.property);
    if (next.duration !== undefined) setDuration(next.duration);
    if (next.timing !== undefined) setTiming(next.timing);

    const comp = composeTransition(full);
    if (commit) {
      updateStyle(elementId, { transition: comp || undefined });
      endStyleEdit();
    } else {
      updateStyleTransient(elementId, { transition: comp || undefined });
    }
  };

  const applyPreset = (rawStr: string) => {
    beginStyleEdit();
    updateStyle(elementId, { transition: rawStr || undefined });
    endStyleEdit();
  };

  return (
    <div className="vis-transition-wrap">
      {/* 常用胶囊预设 */}
      <div className="vis-preset-row">
        <button
          className={'btn-mini' + (currentStr.includes('0.3s') && property === 'all' ? ' active' : '')}
          onClick={() => applyPreset('all 0.3s ease')}
          title="所有样式 0.3 秒平滑过渡 (最自然舒适，推荐)"
        >
          ⚡ 0.3s 舒适 (推荐)
        </button>
        <button
          className={'btn-mini' + (currentStr.includes('0.15s') ? ' active' : '')}
          onClick={() => applyPreset('all 0.15s ease')}
          title="0.15 秒快速过渡 (轻盈灵敏)"
        >
          ⚡ 0.15s 快闪
        </button>
        <button
          className={'btn-mini' + (currentStr.includes('0.5s') ? ' active' : '')}
          onClick={() => applyPreset('all 0.5s ease')}
          title="0.5 秒柔和过渡"
        >
          ⚡ 0.5s 柔和
        </button>
        <button
          className={'btn-mini' + (property === 'transform' ? ' active' : '')}
          onClick={() => applyPreset('transform 0.25s ease')}
          title="仅对位移与缩放动画过渡"
        >
          动效 0.25s
        </button>
        {currentStr && (
          <button
            className="btn-mini btn-danger"
            onClick={() => applyPreset('')}
            title="关闭过渡动画"
          >
            🚫 关闭
          </button>
        )}
      </div>

      {/* 分项调节 */}
      <div className="vis-controls-grid">
        {/* 过渡时长滑块 */}
        <div className="vis-control-row">
          <span className="vis-label">过渡时长</span>
          <input
            type="range"
            min={0.05}
            max={1.0}
            step={0.05}
            value={duration}
            onMouseDown={() => { editingRef.current = true; beginStyleEdit(); }}
            onChange={(e) => apply({ duration: parseFloat(e.target.value) || 0.3 })}
            onMouseUp={() => { editingRef.current = false; apply({ duration }, true); }}
          />
          <span className="vis-num">{duration.toFixed(2)}s</span>
        </div>

        {/* 过渡对象 */}
        <div className="vis-control-row">
          <span className="vis-label">作用范围</span>
          <select
            className="prop-select"
            value={property}
            onChange={(e) => {
              beginStyleEdit();
              apply({ property: e.target.value }, true);
            }}
          >
            <option value="all">全部样式 (all · 推荐)</option>
            <option value="background">背景色 (background)</option>
            <option value="transform">变换动效 (transform)</option>
            <option value="box-shadow">阴影 (box-shadow)</option>
            <option value="opacity">不透明度 (opacity)</option>
          </select>
        </div>

        {/* 缓动曲线 */}
        <div className="vis-control-row">
          <span className="vis-label">缓动曲线</span>
          <select
            className="prop-select"
            value={timing}
            onChange={(e) => {
              beginStyleEdit();
              apply({ timing: e.target.value }, true);
            }}
          >
            <option value="ease">平滑舒适 (ease · 默认)</option>
            <option value="linear">匀速运动 (linear)</option>
            <option value="ease-in">慢入快出 (ease-in)</option>
            <option value="ease-out">快入慢出 (ease-out)</option>
            <option value="ease-in-out">慢入慢出 (ease-in-out)</option>
          </select>
        </div>
      </div>
    </div>
  );
}
