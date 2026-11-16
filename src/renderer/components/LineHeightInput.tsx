import { useState, useEffect, useRef } from 'react';
import { useScene, findNode, getEffectiveStyle } from '@store/sceneStore';

// BlockCanvas · 文本行高可视化组件 (LineHeightInput)
// - 常用胶囊预设：1.2 紧凑标题、1.5 舒适、1.6 标准正文、1.8 宽松、2.0 双倍
// - 滑杆微调（v0.4.7：上限从 2.5 放到 4.0 —— 用户反馈"量程不够"；
//   大标题配大留白、海报式排版常用到 3 倍以上，2.5 根本调不到位）

interface Props {
  elementId: string;
  pseudo?: string | null;
}

export function LineHeightInput({ elementId, pseudo }: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);
  const updatePseudoStyle = useScene((s) => s.updatePseudoStyle);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);

  const isPseudo = Boolean(pseudo);
  const node = findNode(scene.root, elementId);
  const effStyle = node ? (getEffectiveStyle(node, activeBreakpoint) as any) : {};
  const currentStr = isPseudo
    ? ((node?.pseudoStyles?.[pseudo!]?.lineHeight as string) ?? '')
    : ((effStyle?.lineHeight as string) ?? '');
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
    if (isPseudo) {
      updatePseudoStyle(elementId, pseudo!, { lineHeight: (str || undefined) as any });
      if (commit) endStyleEdit();
    } else {
      if (commit) {
        updateStyle(elementId, { lineHeight: str || undefined });
        endStyleEdit();
      } else {
        updateStyleTransient(elementId, { lineHeight: str || undefined });
      }
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
        {/* v0.4.7：用户要"量程再大一点"，补两个大间距档（海报/大标题留白常用） */}
        <button
          className={'btn-mini' + (val === 2.5 ? ' active' : '')}
          onClick={() => applyPreset(2.5)}
          title="大间距（海报式排版）"
        >
          大间距 2.5
        </button>
        <button
          className={'btn-mini' + (val === 3.0 ? ' active' : '')}
          onClick={() => applyPreset(3.0)}
          title="超宽间距（大标题配大量留白）"
        >
          超宽 3.0
        </button>
      </div>

      <div className="vis-control-row" style={{ marginTop: 6 }}>
        <input
          type="range"
          /* v0.4.7：1.0 → 4.0（原来到 2.5 就顶住了，用户："量程不够"） */
          min={0.8}
          max={4.0}
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
