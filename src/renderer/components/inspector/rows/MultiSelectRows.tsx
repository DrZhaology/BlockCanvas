// BlockCanvas · 多选时的行组件（统一设置类名 / 关系选择器）

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useScene, findNode } from '@store/sceneStore';
import { classColor, isValidClassToken } from '@lib/classColor';
import { useClosing } from '@lib/useClosing';
import { inferMultiRelationalSelectors } from '@lib/relationInfer';
import type { RelCandidate, RelInferResult } from '@lib/relationInfer';
import { Icon } from '../../Icon';
import { HelpButton } from '../../HelpButton';

// ============ MultiClassNameRow：多选时统一设置类名 ============
export function MultiClassNameRow(props: { ids: string[] }) {
  const scene = useScene((s) => s.scene);
  const updateAttr = useScene((s) => s.updateAttr);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const { ids } = props;
  const [draft, setDraft] = useState('');
  const [bad, setBad] = useState(false);

  // 类名并集 + 拥有数
  const counts = new Map<string, number>();
  for (const id of ids) {
    const n = findNode(scene.root, id);
    const cls = (n?.attrs?.className ?? '').trim();
    if (!cls) continue;
    for (const t of new Set(cls.split(/\s+/))) counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  // 一条 undo 内批量改全部选中元素
  const applyAll = (fn: (cur: string[]) => string[]) => {
    beginStyleEdit();
    for (const id of ids) {
      const n = findNode(scene.root, id);
      const cur = (n?.attrs?.className ?? '').trim().split(/\s+/).filter(Boolean);
      updateAttr(id, 'className', fn(cur).join(' '));
    }
    endStyleEdit();
  };

  const addFromDraft = () => {
    const parts = draft.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return;
    if (!parts.every(isValidClassToken)) { setBad(true); return; }
    applyAll((cur) => [...cur, ...parts.filter((p) => !cur.includes(p))]);
    setDraft('');
    setBad(false);
  };

  return (
    <div className="prop-row" style={{ marginTop: 8 }}>
      <div className="prop-row-header">
        <span>
          批量类名
          <HelpButton
            title="批量类名"
            content={`给选中的 ${ids.length} 个元素统一加类名：\n\n· 输入名字回车 → 全部选中元素都加上它\n· 若这个类名已存在，它们会立刻穿上该类的样式\n· 点名字上的关闭按钮 → 从全部选中元素移除这个名字`}
          />
        </span>
      </div>
      <div className="prop-row-body cls-chips">
        {[...counts.entries()].map(([t, c]) => (
          <span className="cls-chip" key={t} title={c < ids.length ? `${ids.length} 个中有 ${c} 个有此类` : `全部 ${ids.length} 个都有此类`}>
            <span className="cls-chip-dot" style={{ background: classColor(t) }} />
            <span className="cls-chip-name">{t}</span>
            {c < ids.length && <span className="cls-chip-count">{c}/{ids.length}</span>}
            <button
              className="cls-chip-x"
              title={`从全部 ${ids.length} 个选中元素移除类名 ${t}`}
              onClick={() => applyAll((cur) => cur.filter((x) => x !== t))}
            >×</button>
          </span>
        ))}
        <input
          className={'cls-chip-input' + (bad ? ' bad' : '')}
          placeholder="+ 类名应用到全部，回车确认"
          value={draft}
          spellCheck={false}
          title={bad ? '只能用字母 / 数字 / 横线 / 下划线' : '多个类名用空格分隔'}
          onChange={(e) => { setDraft(e.target.value); setBad(false); }}
          onBlur={addFromDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addFromDraft();
            else if (e.key === 'Escape') { setDraft(''); setBad(false); }
          }}
        />
      </div>
    </div>
  );
}

// ============ MultiRelSelectorRow：多选批量关联父级关系选择器 ============
export function MultiRelSelectorRow(props: { ids: string[] }) {
  const scene = useScene((s) => s.scene);
  const setMultiRelSelector = useScene((s) => s.setMultiRelSelector);
  const { ids } = props;
  const [inferOpen, setInferOpen] = useState(false);
  const [inferResult, setInferResult] = useState<RelInferResult | null>(null);
  // 退场动画：关闭时先播 160ms 再卸载
  const { mounted: inferMounted, closing: inferClosing } = useClosing(inferOpen);

  // 检查是否所有选中的元素已拥有相同的关系选择器
  const rels = ids.map((id) => (findNode(scene.root, id)?.attrs?.relSelector ?? '').trim()).filter(Boolean);
  const commonRel = rels.length === ids.length && new Set(rels).size === 1 ? rels[0] : null;

  const handleOpenInfer = () => {
    const res = inferMultiRelationalSelectors(scene.root, ids);
    setInferResult(res);
    setInferOpen(true);
  };

  return (
    <div className="prop-row" style={{ marginTop: 4 }}>
      <div className="prop-row-header">
        <span>
          批量关系选择器
          <HelpButton
            title="批量关系选择器与符号通俗说明"
            content={
              '【关系选择器通俗说明】：\n\n' +
              '• >（直接子元素）：例如 .card > h3 —— 只匹配 .card 容器里的「亲儿子」标题，孙子层级不生效；\n' +
              '• 空格（所有后代）：例如 .hero p —— 匹配 .hero 容器内「所有层级」的段落（亲儿子、孙子都生效）；\n' +
              '• +（紧邻弟弟）：例如 h2 + p —— 只匹配紧跟在 h2 后面的第一个段落；\n' +
              '• :first-child / :last-child：只匹配第一个或最后一个子元素。\n\n' +
              '点击「批量关联父级」，系统会自动推导并推荐最干净的标准选择器，一键套用！'
            }
          />
          <span className="prop-scope">批量</span>
        </span>
      </div>
      <div className="prop-row-body">
        {commonRel ? (
          <div className="cls-rel-box">
            <div className="cls-rel-badge" title={`全部 ${ids.length} 个元素均使用关系选择器: ${commonRel}`}>
              <span className="cls-rel-icon"><Icon name="bolt" size={12} /></span>
              <span className="cls-rel-text">{commonRel}</span>
              <button
                className="cls-chip-x"
                title="清除全部选中元素的关系选择器"
                onClick={() => setMultiRelSelector(ids, null)}
              >×</button>
            </div>
            <span className="field-hint" style={{ marginTop: 4 }}>全部选中元素共享此关系选择器与样式</span>
          </div>
        ) : (
          <button
            className="btn-secondary cls-rel-trigger-btn"
            title="根据选中的元素在共同父容器中的结构推导关系选择器"
            onClick={handleOpenInfer}
          >
            <Icon name="bolt" size={13} /> 批量关联父级…
          </button>
        )}
      </div>

      {inferMounted && inferResult && createPortal(
        <>
          <div
            className={'cls-infer-mask bc-mask' + (inferClosing ? ' is-closing' : '')}
            onClick={() => setInferOpen(false)}
          />
          <div className={'cls-infer-pop bc-pop' + (inferClosing ? ' is-closing' : '')}>
            <div className="cls-infer-head">
              <span className="cls-infer-title"><Icon name="bolt" size={13} /> 批量关系选择器推荐</span>
              <button className="cp-close" onClick={() => setInferOpen(false)}><Icon name="close" size={13} /></button>
            </div>
            {inferResult.ok ? (
              <div className="cls-infer-body">
                <div className="hint" style={{ marginBottom: 6 }}>
                  共同父容器 <b>{inferResult.anchorName}</b>，选择应用于全部 {ids.length} 个元素：
                </div>
                {inferResult.candidates.map((c: RelCandidate, i: number) => {
                  const symbolExpl = c.selector.includes(' > ')
                    ? '（> 仅直接子级）'
                    : c.selector.includes(' + ')
                    ? '（+ 紧邻同级）'
                    : c.selector.includes(' ')
                    ? '（空格 所有后代）'
                    : '';
                  return (
                    <button
                      key={i}
                      className={"cls-infer-item" + (c.recommended ? ' recommended' : '')}
                      onClick={() => {
                        setMultiRelSelector(ids, c.selector);
                        setInferOpen(false);
                      }}
                    >
                      <div className="cls-infer-item-sel">
                        <code>{c.selector}</code>
                        {c.recommended && <span className="cls-infer-badge">推荐</span>}
                        {symbolExpl && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{symbolExpl}</span>}
                      </div>
                      <div className="cls-infer-item-desc">{c.description}</div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="cls-infer-err">
                <div className="hint" style={{ color: '#d9534f', margin: '4px 0' }}>
                  {inferResult.error}
                </div>
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

