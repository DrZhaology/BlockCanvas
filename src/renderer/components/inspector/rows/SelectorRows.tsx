// BlockCanvas · 选择器与标识的行组件（类名芯片 / 关系选择器编辑）

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useScene } from '@store/sceneStore';
import type { SceneElement } from '@lib/types';
import { classColor, isValidClassToken } from '@lib/classColor';
import { useClosing } from '@lib/useClosing';
import { inferRelationalSelectors } from '@lib/relationInfer';
import type { RelCandidate, RelInferResult } from '@lib/relationInfer';
import { Icon } from '../../Icon';
import { HelpButton } from '../../HelpButton';

export function ClassChipsRow(props: { elementId: string; element: SceneElement }) {
  const updateAttr = useScene((s) => s.updateAttr);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const { elementId, element } = props;
  const tokens = (element.attrs?.className ?? '').trim().split(/\s+/).filter(Boolean);
  const [draft, setDraft] = useState('');
  const [bad, setBad] = useState(false);

  const commit = (next: string[]) => {
    beginStyleEdit();
    updateAttr(elementId, 'className', next.join(' '));
    endStyleEdit();
  };

  const addFromDraft = () => {
    const parts = draft.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return;
    if (!parts.every(isValidClassToken)) { setBad(true); return; }
    commit([...tokens, ...parts.filter((p) => !tokens.includes(p))]);
    setDraft('');
    setBad(false);
  };

  return (
    <div className="prop-row">
      <div className="prop-row-header">
        <span>
          类名 Class
          <HelpButton
            title="类名 Class"
            content={'类名就像"一套衣服的名字"：\n\n1. 给元素起个名字（如 btn primary）\n2. 再给其他元素也填同名 → 它们立刻穿同一套衣服\n3. 之后改任意一个的样式，同名元素全部一起变'}
          />
        </span>
      </div>
      <div className="prop-row-body cls-chips" style={{ padding: '2px 0' }}>
        {tokens.map((t) => (
          <span className="cls-chip" key={t} title={`.${t} · 在「轮廓」模式下此色即该类的专属描边色`}>
            <span className="cls-chip-dot" style={{ background: classColor(t) }} />
            <span className="cls-chip-name">{t}</span>
            <button
              className="cls-chip-x"
              title={`从当前元素移除类名 ${t}`}
              onClick={() => commit(tokens.filter((x) => x !== t))}
            >×</button>
          </span>
        ))}
        <input
          className={'cls-chip-input' + (bad ? ' bad' : '')}
          placeholder="+ 类名，回车添加"
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

// ============ RelationalSelectorRow：关系选择器专属行（独立区域，排列宽松） ============
export function RelationalSelectorRow(props: { elementId: string; element: SceneElement }) {
  const scene = useScene((s) => s.scene);
  const setRelSelector = useScene((s) => s.setRelSelector);
  const { elementId, element } = props;
  const relSel = (element.attrs?.relSelector ?? '').trim();
  const [inferOpen, setInferOpen] = useState(false);
  const [inferResult, setInferResult] = useState<RelInferResult | null>(null);
  // 退场动画：关闭时先播 160ms 再卸载
  const { mounted: inferMounted, closing: inferClosing } = useClosing(inferOpen);

  const handleOpenInfer = () => {
    const res = inferRelationalSelectors(scene.root, elementId);
    setInferResult(res);
    setInferOpen(true);
  };

  return (
    <div className="prop-row" style={{ marginTop: 2 }}>
      <div className="prop-row-header">
        <span>
          关系选择器
          <HelpButton
            title="智能关系选择器与符号通俗说明"
            content={
              '【关系选择器通俗说明】：\n\n' +
              '• >（直接子元素）：例如 .card > h3 —— 只匹配 .card 容器里的「亲儿子」标题，孙子层级不生效；\n' +
              '• 空格（所有后代）：例如 .hero p —— 匹配 .hero 容器内「所有层级」的段落（亲儿子、孙子都生效）；\n' +
              '• +（紧邻弟弟）：例如 h2 + p —— 只匹配紧跟在 h2 后面的第一个段落；\n' +
              '• :first-child / :last-child：只匹配第一个或最后一个子元素。\n\n' +
              '通过父子关系定位元素，无需为每个子元素起 class：\n' +
              '· 点击「自动关联父级」，系统自动向上找父容器（如 .hero、.card），推导生成 .hero > h1、.card > p 等手写级选择器；\n' +
              '· 若选择全部同类（如 .main > div），该容器下所有同标签直接子元素会自动同步该选择器与样式。'
            }
          />
          <span className="prop-scope">父→子</span>
        </span>
      </div>
      <div className="prop-row-body">
        {relSel ? (
          <div className="cls-rel-box">
            <div className="cls-rel-badge" title={`当前关系选择器: ${relSel}`}>
              <span className="cls-rel-icon"><Icon name="bolt" size={12} /></span>
              <span className="cls-rel-text">{relSel}</span>
              <button
                className="cls-chip-x"
                title="清除关系选择器，恢复常规类名/行内模式"
                onClick={() => setRelSelector(elementId, null)}
              >×</button>
            </div>
            <span className="field-hint" style={{ marginTop: 4 }}>通过关系选择器匹配父级，无需类名</span>
          </div>
        ) : (
          <button
            className="btn-secondary cls-rel-trigger-btn"
            title="自动根据在父容器中的位置推导最干净的 CSS 关系选择器（如 .card > h3）"
            onClick={handleOpenInfer}
          >
            <Icon name="bolt" size={13} /> 自动关联父级…
          </button>
        )}
      </div>

      {/* 智能推断推荐弹层：Portal 到 body 居中显示，避免被面板高度裁切（显示不全） */}
      {inferMounted && inferResult && createPortal(
        <>
          <div
            className={'cls-infer-mask bc-mask' + (inferClosing ? ' is-closing' : '')}
            onClick={() => setInferOpen(false)}
          />
          <div className={'cls-infer-pop bc-pop' + (inferClosing ? ' is-closing' : '')}>
            <div className="cls-infer-head">
              <span className="cls-infer-title"><Icon name="bolt" size={13} /> 智能关系选择器推荐</span>
              <button className="cp-close" onClick={() => setInferOpen(false)}><Icon name="close" size={13} /></button>
            </div>
            {inferResult.ok ? (
              <div className="cls-infer-body">
                <div className="hint" style={{ marginBottom: 6 }}>
                  匹配到上层容器 <b>{inferResult.anchorName}</b>，选择一个规则：
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
                        setRelSelector(elementId, c.selector, !!c.isGroup);
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

