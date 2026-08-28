import { useState, useEffect, useRef } from 'react';
import { useScene, findNode } from '@store/sceneStore';

// BlockCanvas · 文本行高可视化组件 (LineHeightInput)
// - 常用胶囊预设：1.2 紧凑标题、1.5 舒适、1.6 标准正文、1.8 宽松、2.0 双倍
// - 滑杆微调 1.0~2.5 倍行距

interface Props {
  elementId: string;
}

export function LineHeightInput({ elementId }: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  const node = findNode(scene.root, elementId);
  const currentStr = (node?.style?.lineHeight as string) ?? '';
  const currentNum = parseFloat(currentStr);

  const [val, setVal] = useState(Number.isNaN(currentNum) ? 1.6 : currentNum);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      const n = parseFloat(currentStr);
      setVal(Number.isNaN(n) ? 1.6 : n);
    }
  }, [currentStr]);

  const apply = (v: number, commit = false) => {
    setVal(v);
    const str = String(v);
    if (commit) {
      updateStyle(elementId, { lineHeight: str || undefined });
      endStyleEdit();
    } else {
      updateStyleTransient(elementId, { lineHeight: str || undefined });
    }
  };

  const applyPreset = (v: number) => {
    beginStyleEdit();
    apply(v, true);
  };

  return (
    <div className="vis-lineheight-wrap">
      <div className="vis-preset-row">
        <button
          className={'btn-mini' + (val === 1.2 ? ' active' : '')}
          onClick={() => applyPreset(1.2)}
          title="紧凑行距（大标题推荐）"
        >
          紧凑 1.2
        </button>
        <button
          className={'btn-mini' + (val === 1.5 ? ' active' : '')}
          onClick={() => applyPreset(1.5)}
          title="舒适行距"
        >
          舒适 1.5
        </button>
        <button
          className={'btn-mini' + (val === 1.6 ? ' active' : '')}
          onClick={() => applyPreset(1.6)}
          title="标准正文行距（推荐）"
        >
          正文 1.6 (荐)
        </button>
        <button
          className={'btn-mini' + (val === 1.8 ? ' active' : '')}
          onClick={() => applyPreset(1.8)}
          title="宽松呼吸感行距"
        >
          宽松 1.8
        </button>
        <button
          className={'btn-mini' + (val === 2.0 ? ' active' : '')}
          onClick={() => applyPreset(2.0)}
          title="双倍行距"
        >
          双倍 2.0
        </button>
      </div>

      <div className="vis-control-row" style={{ marginTop: 6 }}>
        <input
          type="range"
          min={1.0}
          max={2.5}
          step={0.05}
          value={val}
          onMouseDown={() => { editingRef.current = true; beginStyleEdit(); }}
          onChange={(e) => apply(parseFloat(e.target.value) || 1.6)}
          onMouseUp={() => { editingRef.current = false; apply(val, true); }}
        />
        <span className="vis-num" style={{ minWidth: 36, textAlign: 'right' }}>
          {val.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
