import { useState, useEffect, useRef } from 'react';
import { useScene, findNode } from '@store/sceneStore';

// BlockCanvas · 不透明度可视化组件 (OpacityInput)
// - 胶囊预设：100% 实体、80% 轻透、50% 半透明、20% 幽灵、0% 隐藏
// - 滑块 0%~100% 直观调节
// - 支持默认状态和伪类状态（如 :hover / :active）

interface Props {
  elementId: string;
  pseudo?: string | null;
}

export function OpacityInput({ elementId, pseudo }: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  const node = findNode(scene.root, elementId);
  const isPseudo = Boolean(pseudo);
  const currentStr = (
    isPseudo
      ? (node?.pseudoStyles?.[pseudo!]?.opacity as string)
      : (node?.style?.opacity as string)
  ) ?? '';
  const currentNum = currentStr === '' ? 1 : parseFloat(currentStr);

  const [val, setVal] = useState(Number.isNaN(currentNum) ? 1 : currentNum);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      const n = currentStr === '' ? 1 : parseFloat(currentStr);
      setVal(Number.isNaN(n) ? 1 : n);
    }
  }, [currentStr]);

  const commitValue = (valStr: string) => {
    if (isPseudo) {
      const nextPs = { ...(node?.pseudoStyles ?? {}) };
      if (!valStr) {
        if (nextPs[pseudo!]) {
          const nextStyle = { ...nextPs[pseudo!] };
          delete nextStyle.opacity;
          nextPs[pseudo!] = nextStyle;
        }
      } else {
        nextPs[pseudo!] = { ...(nextPs[pseudo!] ?? {}), opacity: valStr };
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
      updateStyle(elementId, { opacity: valStr || undefined });
    }
  };

  const apply = (v: number, commit = false) => {
    setVal(v);
    const str = v === 1 ? '' : String(v);
    if (commit) {
      commitValue(str);
      endStyleEdit();
    } else {
      if (isPseudo) {
        commitValue(str);
      } else {
        updateStyleTransient(elementId, { opacity: str || undefined });
      }
    }
  };

  return (
    <div className="vis-opacity-wrap">
      <div className="vis-preset-row">
        <button
          className={'btn-mini' + (val === 1 ? ' active' : '')}
          onClick={() => { beginStyleEdit(); apply(1, true); }}
          title="100% 完全不透明"
        >
          100% 实体
        </button>
        <button
          className={'btn-mini' + (val === 0.8 ? ' active' : '')}
          onClick={() => { beginStyleEdit(); apply(0.8, true); }}
          title="80% 轻微透光 (hover 常用)"
        >
          80% 轻透
        </button>
        <button
          className={'btn-mini' + (val === 0.5 ? ' active' : '')}
          onClick={() => { beginStyleEdit(); apply(0.5, true); }}
          title="50% 半透明"
        >
          50% 半透
        </button>
        <button
          className={'btn-mini' + (val === 0.2 ? ' active' : '')}
          onClick={() => { beginStyleEdit(); apply(0.2, true); }}
          title="20% 幽灵微光"
        >
          20% 幽灵
        </button>
        <button
          className={'btn-mini' + (val === 0 ? ' active' : '')}
          onClick={() => { beginStyleEdit(); apply(0, true); }}
          title="0% 完全透明隐藏"
        >
          0% 隐藏
        </button>
      </div>

      <div className="vis-control-row" style={{ marginTop: 6 }}>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(val * 100)}
          onMouseDown={() => { editingRef.current = true; beginStyleEdit(); }}
          onChange={(e) => apply(parseFloat(e.target.value) / 100)}
          onMouseUp={() => { editingRef.current = false; apply(val, true); }}
        />
        <span className="vis-num" style={{ minWidth: 40, textAlign: 'right' }}>
          {Math.round(val * 100)}%
        </span>
      </div>
    </div>
  );
}
