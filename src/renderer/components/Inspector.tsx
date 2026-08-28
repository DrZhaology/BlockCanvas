import { useState, useEffect } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { TEXT_TAGS, SELF_CLOSING_TAGS } from '@lib/types';
import type { ElementType, SceneElement, SceneGraph } from '@lib/types';
import { SCHEMA, ATTRS_SCHEMA, DEFAULT_VISIBLE_PROPS,
  getSchemaItem, isApplicable, hasStyleValue, applyUnit, UNIT_HELP_TEXT
} from '@lib/propertySchema';
import { getPluginProperties } from '@lib/pluginHost';
import { AddPropertyMenu } from './AddPropertyMenu';
import { HelpButton } from './HelpButton';
import { Box4Input } from './Box4Input';
import { TrblInput } from './TrblInput';
import { ColorPicker, ColorField } from './ColorPicker';
import { NumberUnitInput } from './NumberUnitInput';
import { FontFamilyInput } from './FontFamilyInput';
import { TransformInput } from './TransformInput';
import { BoxShadowInput } from './BoxShadowInput';
import { TextShadowInput } from './TextShadowInput';
import { TransitionInput } from './TransitionInput';
import { OpacityInput } from './OpacityInput';
import { LineHeightInput } from './LineHeightInput';
import { FlexHelper } from './FlexHelper';
import { ClassManager } from './ClassManager';
import { classColor, isValidClassToken } from '@lib/classColor';
import { checkApplicability } from '@lib/propertySchema';
import { inferRelationalSelectors, inferMultiRelationalSelectors, type RelCandidate, type RelInferResult } from '@lib/relationInfer';

// BlockCanvas · 属性面板（阶段2 重写）——「按需添加属性」架构：
//  - 默认只显示 width / height 两个基础尺寸输入
//  - "+ 添加属性" 下拉选 CSS 属性加入面板
//  - 每个属性旁有 "?" 帮助 + "×" 删除
//  - box4 类型展开成 4 边分别输入
//  - color 类型用 ColorPicker 富组件
//  - 文本元素展示文案输入
//  - HTML 原生属性（class/id/src/alt/href 等）单独区
//  - 预设属性（defaultStyleFor 添加的）会自动出现在面板里
//  - 底部操作：复制 / 删除
// 阶段3第1轮：面板顶部 Tab「元素 / 页面」；页面页签 = 全局 CSS（导出 <style> 末尾）

export function Inspector() {
  const scene = useScene((s) => s.scene);
  const removeMany = useScene((s) => s.removeMany);
  const selectMany = useScene((s) => s.selectMany);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const setGlobalCss = useScene((s) => s.setGlobalCss);

  // ⚠️ Hooks 必须在任何提前 return 之前声明（React 规则），
  // 否则"未选中 → 选中"切换时 hook 数量变化会让 React 崩溃卸载整棵组件树（白屏）。
  // 刚添加的属性 key：让对应输入的框自动聚焦 + 蓝色高亮边框，一眼找到
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);
  // 元素 / 页面 / 类名 页签
  const [inspectorTab, setInspectorTab] = useState<'element' | 'page' | 'class'>('element');
  // 「⚠」面板或菜单「类名管理」→ 切到「类名」页签
  useEffect(() => {
    const openClass = () => setInspectorTab('class');
    window.addEventListener('bc:open-class', openClass);
    return () => window.removeEventListener('bc:open-class', openClass);
  }, []);
  // 页面 CSS 文本的本地草稿（blur 时提交，避免每键入栈）
  const [pageCssDraft, setPageCssDraft] = useState(scene.globalCss ?? '');
  // 撤销/重做或外部改动时同步草稿（编辑中不会触发：打字只在本地草稿）
  useEffect(() => {
    setPageCssDraft(scene.globalCss ?? '');
  }, [scene.globalCss]);

  // 切换选中元素时，清除"刚添加"标记（高亮/聚焦不属于新元素）
  const selectedIdForSync = scene.selectedId;
  useEffect(() => {
    setJustAddedKey(null);
  }, [selectedIdForSync]);

  const selected = scene.selectedId ? findNode(scene.root, scene.selectedId) : null;

  // 多选 / 未选中 / 根节点 / 正常属性 四种内容，统一放进"元素"页签
  let elementBody: React.ReactNode;
  if (scene.selectedIds.length > 1) {
    const ids = scene.selectedIds;
    elementBody = (
      <>
        <div className="panel-title">已选 {ids.length} 个元素</div>
        <div className="hint" style={{ marginBottom: 8 }}>
          Ctrl+点击画布或图层树，可取消个别元素；在画布空白处拖框可重新框选。
        </div>
        <div className="multi-sel-list">
          {ids.map((id) => {
            const n = findNode(scene.root, id);
            if (!n) return null;
            return (
              <div key={id} className="multi-sel-item">
                <span>&lt;{n.type}&gt;{n.text ? ` · ${n.text.slice(0, 24)}` : ''}</span>
                <button
                  className="btn-mini"
                  title="从多选中移除"
                  onClick={() => useScene.getState().toggleSelect(id)}
                >移除</button>
              </div>
            );
          })}
        </div>
        <MultiClassNameRow ids={ids} />
        <MultiRelSelectorRow ids={ids} />
        <div className="inspector-actions">
          <button className="btn-danger" onClick={() => removeMany(ids)}>删除全部 {ids.length} 个</button>
          <button className="btn-secondary" onClick={() => selectMany([])}>取消选中</button>
        </div>
      </>
    );
  } else if (!selected) {
    elementBody = (
      <div className="inspector-empty">
        <div className="empty-icon">👆</div>
        <div className="empty-title">未选中元素</div>
        <div className="empty-desc">
          在画布上直接点击任意元素，或在左侧「图层」中点选，即可在此调整大小、颜色、文字与排版。
        </div>
      </div>
    );
  } else if (selected.id === scene.root.id) {
    elementBody = (
      <div className="inspector-empty">
        <div className="empty-icon">📄</div>
        <div className="empty-title">画布根容器</div>
        <div className="empty-desc">
          画布根节点代表整个网页主体。若要修改整页背景色、文字颜色或字体，请切换到上方 <b>「页面」</b> 页签。
        </div>
      </div>
    );
  } else {
    elementBody = <ElementPropsBody selected={selected} justAddedKey={justAddedKey} onJustAdded={setJustAddedKey} />;
  }

  return (
    <div className="panel inspector">
      <div className="inspector-tabs">
        <button
          className={"inspector-tab" + (inspectorTab === 'element' ? ' active' : '')}
          onClick={() => setInspectorTab('element')}
        >元素</button>
        <button
          className={"inspector-tab" + (inspectorTab === 'class' ? ' active' : '')}
          onClick={() => setInspectorTab('class')}
        >类名</button>
        <button
          className={"inspector-tab" + (inspectorTab === 'page' ? ' active' : '')}
          onClick={() => setInspectorTab('page')}
        >页面</button>
      </div>
      {inspectorTab === 'class' && <ClassManager />}
      {inspectorTab === 'page'
        ? (
          <PageCssBody
            draft={pageCssDraft}
            onDraftChange={setPageCssDraft}
            onCommit={() => {
              // blur 一次性提交：会话内不入栈
              beginStyleEdit();
              setGlobalCss(pageCssDraft);
              endStyleEdit();
            }}
          />
        )
        : elementBody}
    </div>
  );
}

// ============ 页面页签：全局样式（新交互：按需添加属性 + 富颜色选择器） ============
// 与「元素」页签同构的交互模型：
//  - 默认显示 4 个常用项；「+ 添加属性」把更多页面级属性加进面板
//  - 颜色项点色块打开富调色盘：RGB / RGBA / HEX / 英文色名 / 任意 CSS 颜色
//  - 键存在（含空串）= 已添加，清空文字行不消失；只有 × 才删除该属性

type PageQuickKey = keyof NonNullable<SceneGraph['quickCss']> & string;

interface PagePropDef {
  key: PageQuickKey;
  label: string;
  type: 'color' | 'text';
  placeholder?: string;
}

const PAGE_PROPS: PagePropDef[] = [
  { key: 'bodyBg', label: '页面背景色', type: 'color' },
  { key: 'textColor', label: '文字颜色', type: 'color' },
  { key: 'linkColor', label: '链接颜色', type: 'color' },
  { key: 'fontFamily', label: '页面字体', type: 'text', placeholder: '例如 Arial, sans-serif' },
  { key: 'bodyFontSize', label: '正文字号', type: 'text', placeholder: '例：16px' },
  { key: 'bodyLineHeight', label: '正文行高', type: 'text', placeholder: '例：1.6 / 24px' },
  { key: 'headingColor', label: '标题颜色（h1~h6）', type: 'color' }
];

const PAGE_DEFAULT_KEYS = new Set<string>(['bodyBg', 'textColor', 'linkColor', 'fontFamily']);

function PageCssBody(props: {
  draft: string;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
}) {
  const { draft, onDraftChange, onCommit } = props;
  const quickCss = useScene((s) => s.scene.quickCss);
  const setQuickCss = useScene((s) => s.setQuickCss);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const qc = quickCss ?? {};

  // 已显示 = 默认项 ∪ 键已存在（含空串）的项；可添加 = 其余
  const visibleDefs = PAGE_PROPS.filter((it) => PAGE_DEFAULT_KEYS.has(it.key) || qc[it.key] !== undefined);
  const addableDefs = PAGE_PROPS.filter((it) => !PAGE_DEFAULT_KEYS.has(it.key) && qc[it.key] === undefined);

  // 会话式提交：focus/开 modal 开会话（不入栈），change 流式写 store，blur/关 modal 收尾一次入栈
  const setKey = (key: PageQuickKey, v: string) => setQuickCss({ [key]: v } as Record<string, string | undefined>);
  const addKey = (key: PageQuickKey) => {
    beginStyleEdit();
    setKey(key, '');
    endStyleEdit();
  };
  const removeKey = (key: PageQuickKey) => {
    beginStyleEdit();
    setQuickCss({ [key]: undefined } as Record<string, string | undefined>);
    endStyleEdit();
  };

  const row = (item: PagePropDef) => {
    const value = qc[item.key] ?? '';
    return (
      <div className="page-quick-row" key={item.key}>
        <span className="page-quick-label">{item.label}</span>
        {item.type === 'color' ? (
          <ColorField
            value={value}
            fallback="#ffffff"
            inputClassName="page-quick-input"
            onInputFocus={() => beginStyleEdit()}
            onChange={(v) => setKey(item.key, v)}
            onInputBlur={() => endStyleEdit()}
            onModalOpen={() => beginStyleEdit()}
            onModalClose={() => endStyleEdit()}
          />
        ) : (
          <input
            className="page-quick-input"
            placeholder={item.placeholder ?? '留空 = 不设置'}
            value={value}
            spellCheck={false}
            onFocus={() => beginStyleEdit()}
            onChange={(e) => setKey(item.key, e.target.value)}
            onBlur={() => endStyleEdit()}
          />
        )}
        <button className="page-quick-clear" title="删除此属性" onClick={() => removeKey(item.key)}>×</button>
      </div>
    );
  };

  return (
    <>
      <div className="panel-title">页面 · 全局样式</div>
      <div className="hint" style={{ marginBottom: 8 }}>
        这里改的是整页的外观，效果和你写的 CSS 一样，会一起放进导出的 HTML。
      </div>

      {/* 页面属性：基础重置开关 + 默认 4 项 + 「+ 添加属性」按需扩展 */}
      <div className="page-quick-css">
        <div className="page-quick-row">
          <span className="page-quick-label">默认边距</span>
          <label className="page-check" title="浏览器默认给页面四周留 8px 白边；勾选后导出的 HTML 会加 html,body 边距重置，和画布一样贴边显示">
            <input
              type="checkbox"
              checked={qc.resetMargin === '1'}
              onChange={(e) => {
                beginStyleEdit();
                setKey('resetMargin', e.target.checked ? '1' : '');
                endStyleEdit();
              }}
            />
            去掉浏览器默认白边（推荐）
          </label>
        </div>
        <div className="page-quick-row">
          <span className="page-quick-label">标题间距</span>
          <label className="page-check" title="h1~h6、p、列表等标签自带浏览器默认外边距（标题之间的大空隙就是它）；勾选后画布与导出都会把这些间距清零——等价于正规网站的 CSS Reset。想单独调某个标题的间距，再给它添加「外边距」即可">
            <input
              type="checkbox"
              checked={qc.resetHeadingMargin === '1'}
              onChange={(e) => {
                beginStyleEdit();
                setKey('resetHeadingMargin', e.target.checked ? '1' : '');
                endStyleEdit();
              }}
            />
            重置标题/段落默认间距（还原网站时推荐）
          </label>
        </div>
        {visibleDefs.map((item) => row(item))}
        <PageAddProp items={addableDefs} onAdd={addKey} />
      </div>

      {/* 高级：可展开的 CSS 文本区 */}
      <div className="page-advanced">
        <button
          className="page-advanced-toggle"
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          <span className={advancedOpen ? 'page-advanced-caret open' : 'page-advanced-caret'}>▸</span>
          高级 CSS（会写的直接用）
        </button>
        <div className="hint" style={{ fontSize: 12, opacity: 0.75 }}>
          放最后生效，可以覆盖上面所有样式：比如给某个元素写 .banner {'{ background-color: #ffd; }'}
        </div>
        {advancedOpen && (
          <div className="page-advanced-body">
            <div className="page-css-help">
              <HelpButton
                title="全局 CSS 怎么用？"
                content={'这是给懂一点 CSS 的用户走的"高级门"：\n\n1. 想给元素加样式名字：在「元素 → HTML 属性 → 类名」里填一个名字（比如 banner）\n\n2. 在这里写规则：\n.banner { background-color: #ffd; }\n\n3. 也可以直接选标签：\np { line-height: 1.8; }\n\na:hover { color: orange; }\n\n注意\n· 不需要会 CSS 也能用本软件：全部可视化操作都支持，这里只是额外入口\n· 写错了不会破坏画布，导出前可以在浏览器里预览（Ctrl+P）检查\n· 自动样式放前面，你写的放后面 → 你的规则优先级更高'}
              />
            </div>
            <textarea
              className="page-css-textarea"
              placeholder={'/* 例如：让所有段落更宽松 */\np {\n  margin-bottom: 20px;\n}\n\n/* 或者针对某个元素：先给它填类名 banner */\n.banner {\n  border: 2px solid gold;\n}'}
              value={draft}
              spellCheck={false}
              onChange={(e) => onDraftChange(e.target.value)}
              onBlur={onCommit}
            />
          </div>
        )}
      </div>
    </>
  );
}

// 「+ 添加属性」下拉（页面版）：复用元素面板的 add-prop 样式，轻量无搜索
function PageAddProp(props: { items: PagePropDef[]; onAdd: (key: PageQuickKey) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (props.items.length === 0) return null;
  return (
    <div className="add-prop-wrap">
      <button className="add-prop-trigger" onClick={() => setOpen(!open)} title="添加页面级属性">
        + 添加属性 {open ? '▴' : '▾'}
      </button>
      {open && (
        <>
          <div className="add-prop-backdrop" onClick={() => setOpen(false)} />
          <div className="add-prop-menu">
            <div className="add-prop-scroll">
              {props.items.map((it) => (
                <button
                  key={it.key}
                  className="add-prop-item"
                  title={it.placeholder ? `例：${it.placeholder}` : it.label}
                  onClick={() => { props.onAdd(it.key); setOpen(false); }}
                >
                  {it.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============ 元素页签内容（选中元素的属性编辑区） ============
function ElementPropsBody(props: { selected: SceneElement; justAddedKey: string | null; onJustAdded: (k: string | null) => void }) {
  const { selected, justAddedKey, onJustAdded } = props;
  const updateStyle = useScene((s) => s.updateStyle);
  const removeElement = useScene((s) => s.removeElement);
  const duplicateElement = useScene((s) => s.duplicateElement);
  const setText = useScene((s) => s.setText);
  const addVisibleProp = useScene((s) => s.addVisibleProp);
  const removeVisibleProp = useScene((s) => s.removeVisibleProp);
  const updatePseudoStyleStore = useScene((s) => s.updatePseudoStyle);
  const removePseudoStyleStore = useScene((s) => s.removePseudoStyle);
  const elementId = selected.id;
  const elementType = selected.type;

  // 折叠状态（可独立展开/收起）- 从 localStorage 恢复，默认全部折叠 (false)
  const [secOpen, setSecOpen] = useState<{ identity: boolean; layout: boolean; css: boolean; pseudo: boolean }>(() => {
    try {
      const saved = localStorage.getItem('bc-inspector-sec-' + elementId);
      if (saved) {
        const p = JSON.parse(saved);
        return { identity: p.identity ?? false, layout: p.layout ?? false, css: p.css ?? false, pseudo: p.pseudo ?? false };
      }
    } catch {}
    return { identity: false, layout: false, css: false, pseudo: false };
  });

  // 折叠状态变更时持久化
  useEffect(() => {
    try {
      localStorage.setItem('bc-inspector-sec-' + elementId, JSON.stringify(secOpen));
    } catch {}
  }, [secOpen, elementId]);

  // 伪类编辑区：:hover / :active / :focus / :link
  const PSEUDO_CLASSES = ['hover', 'active', 'focus', 'link'] as const;
  type PseudoClass = typeof PSEUDO_CLASSES[number];
  const [activePseudo, setActivePseudo] = useState<PseudoClass | null>(null);
  const pseudoStyles = selected.pseudoStyles ?? {};

  // 更新伪类样式的辅助函数（直接通过 store 更新，自动联动同类名/同选择器元素）
  const updatePseudoStyle = (pseudo: PseudoClass | null, patch: Record<string, string>) => {
    if (pseudo === null) {
      updateStyle(elementId, patch);
    } else {
      updatePseudoStyleStore(elementId, pseudo, patch);
    }
  };

  const removePseudoStyle = (pseudo: PseudoClass | null, key?: string) => {
    if (pseudo === null) {
      if (key) {
        removeVisibleProp(elementId, key);
        updateStyle(elementId, { [key]: undefined });
      }
    } else {
      removePseudoStyleStore(elementId, pseudo, key);
    }
  };

  // ============ 决定"显示哪些属性" ============
  // 1. + DEFAULT_VISIBLE_PROPS (现已默认为空，精简干净)
  // 2. style 里有非空值的所有 schema 属性（含 box4/trbl 4 边任一有值便视为已添加）
  // 3. visibleProps 列表里显式添加过的 key（即使 style 值被清空为空串也不消失）
  const visibleSchema: typeof SCHEMA = [];
  const visiblePropList = selected.visibleProps ?? [];
  const allSchema = [...SCHEMA, ...getPluginProperties()];
  for (const s of allSchema) {
    if (!isApplicable(s, selected.type)) continue;
    if (DEFAULT_VISIBLE_PROPS.includes(s.key) || hasStyleValue(selected.style, s as any) || visiblePropList.includes(s.key)) {
      visibleSchema.push(s as any);
    }
  }

  // ============ "添加属性"回调 ============
  const onAddProperty = (key: string) => {
    const item = getSchemaItem(key);
    if (!item) return;
    const patch: Record<string, string> = {};
    if ((item.input === 'box4' || item.input === 'trbl') && item.sides) {
      for (const s of item.sides) patch[s.key] = '';
    } else {
      patch[item.key] = '';
    }
    updateStyle(elementId, patch);
    addVisibleProp(elementId, key);
    onJustAdded(key);
  };

  // ============ "删除属性"回调 ============
  const onRemoveProperty = (key: string) => {
    removeVisibleProp(elementId, key);
  };

  // ============ Applicable attrs for this element ============
  const applicableAttrs = ATTRS_SCHEMA.filter((a) => {
    if (!a.onlyTypes) return true;
    return a.onlyTypes.includes(elementType);
  });

  const hasRel = Boolean((selected.attrs?.relSelector ?? '').trim());
  const relText = (selected.attrs?.relSelector ?? '').trim();
  const hasCls = Boolean((selected.attrs?.className ?? '').trim());
  const clsText = (selected.attrs?.className ?? '').trim();
  const hasId = Boolean((selected.attrs?.id ?? '').trim());
  const idText = (selected.attrs?.id ?? '').trim();
  const stylePropCount = Object.keys(selected.style || {}).filter((k) => selected.style[k] !== undefined && selected.style[k] !== '').length;
  const hasInlineStyle = stylePropCount > 0;

  return (
    <>
      {/* 顶部元素信息栏（自适应展示 标签 + 关系选择器 / 类名 / ID / 行内样式） */}
      <div className="panel-title-header">
        <div className="panel-title-left">
          <span className="panel-title-prefix">属性 ·</span>
          <span className="panel-title-tag">&lt;{elementType}&gt;</span>
        </div>
        <div className="panel-title-badges">
          {hasRel && <span className="panel-title-badge is-rel" title={`关系选择器: ${relText}`}>⚡ {relText}</span>}
          {hasCls && <span className="panel-title-badge is-cls" title={`类名: .${clsText.split(/\s+/).join(' .')}`}>.{clsText.split(/\s+/).join(' .')}</span>}
          {hasId && <span className="panel-title-badge is-id" title={`ID: #${idText}`}>#{idText}</span>}
          {hasInlineStyle && <span className="panel-title-badge is-inline" title={`设置了 ${stylePropCount} 个样式属性`}>行内样式</span>}
        </div>
      </div>

      {/* 0. 文案内容（针对文本元素）——置顶最上方第一位，直接输入 */}
      {TEXT_TAGS.has(elementType) && (
        <div className="field" style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
            文案内容
          </label>
          <textarea
            className="inspector-text-textarea"
            value={selected.text ?? ''}
            placeholder="在此直接输入文本内容（画布也将同步更新）…"
            rows={2}
            onChange={(e) => setText(elementId, e.target.value)}
          />
        </div>
      )}

      {/* 1. 选择器与标识折叠区（默认折叠） */}
      <div className="inspector-sec">
        <div
          className="inspector-sec-head"
          onClick={() => setSecOpen((p) => ({ ...p, identity: !p.identity }))}
          title="点击展开或收起选择器与标识"
        >
          <span>
            <span className="sec-caret">{secOpen.identity ? '▾' : '▸'}</span>
            选择器与标识
          </span>
          <HelpButton
            title="选择器与标识"
            content={'管理元素的命名与匹配机制：\n\n· 类名 Class：给元素命名，同名元素批量共享样式。\n· 关系选择器：无需起名，根据在父容器中的相对位置自动生成规则（如 .hero > h1）。\n· ID：页面内唯一的元素标识。'}
          />
        </div>
        {secOpen.identity && (
          <div className="inspector-sec-body">
            <ClassChipsRow elementId={elementId} element={selected} />
            <RelationalSelectorRow elementId={elementId} element={selected} />
            {elementType === 'img' && (
              <ImgPickerRow elementId={elementId} />
            )}
            {applicableAttrs.filter((a) => a.key !== 'className' && (elementType !== 'img' || a.key !== 'src')).map((a) => (
              <AttrRow
                key={a.key}
                keyName={a.key}
                label={a.label}
                elementId={elementId}
                element={selected}
                help={a.help}
              />
            ))}
          </div>
        )}
      </div>

      {/* 2. 布局助手折叠区（Flex & Grid） */}
      <div className="inspector-sec">
        <div
          className="inspector-sec-head"
          onClick={() => setSecOpen((p) => ({ ...p, layout: !p.layout }))}
          title="点击展开或收起布局助手"
        >
          <span>
            <span className="sec-caret">{secOpen.layout ? '▾' : '▸'}</span>
            布局助手 (Flex &amp; Grid)
          </span>
          <span className="prop-scope">排版容器</span>
        </div>
        {secOpen.layout && (
          <div className="inspector-sec-body">
            <FlexHelper elementId={elementId} elementType={elementType} />
          </div>
        )}
      </div>

      {/* 3. 伪类状态区 */}
      <div className="inspector-sec">
        <div
          className="inspector-sec-head"
          onClick={() => setSecOpen((p: any) => ({ ...p, pseudo: !p.pseudo }))}
          title="编辑 :hover / :active / :focus / :link 状态下的样式与动效"
        >
          <span>
            <span className="sec-caret">{secOpen.pseudo ? '▾' : '▸'}</span>
            交互状态 (伪类)
          </span>
          <HelpButton
            title="交互状态 (伪类) 与动效教程"
            content={
              '【什么是伪类 (交互状态)】：\n' +
              '网页元素在不同操作下会呈现不同的外观：\n\n' +
              '• :hover 悬停 —— 鼠标移到元素上方时触发（最常用！如：按钮变色、卡片上浮、链接出现下划线）。\n' +
              '• :active 按下 —— 鼠标点下去还没松开的瞬间触发（如：按钮被压下去、回弹动效）。\n' +
              '• :focus 聚焦 —— 点击输入框或按 Tab 键选定时触发（如：输入框外圈发光）。\n' +
              '• :link 链接 —— 未访问过的超链接默认状态。\n\n' +
              '【怎么做交互动效（三步法）】：\n' +
              '1. 先在「默认」状态下设好基础样式（如蓝色背景）；\n' +
              '2. 切换到「:hover」标签页，点击「+ 添加属性」，选一个更深的背景色（如深蓝）；\n' +
              '3. 在下方开启「⚡ 0.3s 平滑过渡」，鼠标悬停时颜色就会自然渐变，绝不生硬！'
            }
          />
        </div>
        {secOpen.pseudo && (
          <div className="inspector-sec-body">
            {/* 快捷过渡动画控制条 */}
            <div className="pseudo-transition-bar">
              <div className="pseudo-trans-header">
                <span className="pseudo-trans-title">⚡ 平滑过渡动画 (Transition)</span>
                <span className="pseudo-trans-status">
                  {selected.style.transition ? `已开启: ${selected.style.transition}` : '未开启 (悬停时瞬间突变)'}
                </span>
              </div>
              <div className="pseudo-trans-presets">
                <button
                  className={'btn-mini' + (selected.style.transition?.includes('0.3s') ? ' active' : '')}
                  onClick={() => {
                    updateStyle(elementId, { transition: 'all 0.3s ease' });
                    addVisibleProp(elementId, 'transition');
                  }}
                  title="所有样式 0.3 秒平滑过渡 (最自然舒适)"
                >
                  ⚡ 0.3s 舒适 (推荐)
                </button>
                <button
                  className={'btn-mini' + (selected.style.transition?.includes('0.15s') ? ' active' : '')}
                  onClick={() => {
                    updateStyle(elementId, { transition: 'all 0.15s ease' });
                    addVisibleProp(elementId, 'transition');
                  }}
                  title="所有样式 0.15 秒快速过渡 (轻盈灵敏)"
                >
                  ⚡ 0.15s 快闪
                </button>
                <button
                  className={'btn-mini' + (selected.style.transition?.includes('0.5s') ? ' active' : '')}
                  onClick={() => {
                    updateStyle(elementId, { transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)' });
                    addVisibleProp(elementId, 'transition');
                  }}
                  title="所有样式 0.5 秒柔和过渡"
                >
                  ⚡ 0.5s 柔和
                </button>
                {selected.style.transition && (
                  <button
                    className="btn-mini btn-danger"
                    onClick={() => {
                      updateStyle(elementId, { transition: undefined });
                    }}
                    title="关闭过渡动画"
                  >
                    关闭
                  </button>
                )}
              </div>
            </div>

            <div className="pseudo-tabs">
              {PSEUDO_CLASSES.map((pc) => (
                <button
                  key={pc}
                  className={'pseudo-tab' + (activePseudo === pc ? ' active' : '')}
                  onClick={() => setActivePseudo(pc === activePseudo ? null : pc)}
                  title={`编辑 :${pc} 状态下的外观`}
                >
                  :{pc} {pc === 'hover' ? '(悬停)' : pc === 'active' ? '(按下)' : pc === 'focus' ? '(聚焦)' : '(链接)'}
                </button>
              ))}
              <button
                className={'pseudo-tab' + (activePseudo === null ? ' active' : '')}
                onClick={() => setActivePseudo(null)}
                title="查看默认基础状态"
              >
                默认状态
              </button>
            </div>
            <div className="pseudo-editor">
              {activePseudo === null ? (
                <div className="pseudo-hint-default">
                  当前处于<b>默认状态</b>。所有基础属性在下方「CSS 样式属性」面板中直接调整。<br />
                  点击上方 <code>:hover</code>、<code>:active</code>、<code>:focus</code> 或 <code>:link</code> 标签可为该交互状态单独定制样式覆盖。
                </div>
              ) : (
                (() => {
                  const currentStyle = (pseudoStyles[activePseudo] ?? {}) as Record<string, string | undefined>;
                  const hasProps = Object.keys(currentStyle).length > 0;
                  return (
                    <>
                      <div className="pseudo-hint">
                        正在编辑 <code>:{activePseudo}</code> 状态下的样式覆盖（仅在此状态下生效）
                      </div>
                      <AddPropertyMenu
                        type={elementType}
                        elementStyle={currentStyle as any}
                        visibleKeys={Object.keys(currentStyle).filter((k) => {
                          const item = getSchemaItem(k);
                          return item && isApplicable(item, selected.type);
                        })}
                        onAdd={(key) => {
                          const item = getSchemaItem(key);
                          if (!item) return;
                          const patch: Record<string, string> = {};
                          if ((item.input === 'box4' || item.input === 'trbl') && item.sides) {
                            for (const s of item.sides) patch[s.key] = '';
                          } else {
                            patch[item.key] = '';
                          }
                          updatePseudoStyle(activePseudo, patch);
                        }}
                      />
                      {hasProps && (
                        <div className="pseudo-delete-row">
                          <button
                            className="btn-mini btn-danger"
                            onClick={() => {
                              removePseudoStyle(activePseudo);
                            }}
                          >
                            清空 :{activePseudo} 样式
                          </button>
                        </div>
                      )}
                      {Object.entries(currentStyle).map(([key, val]) => {
                        const item = getSchemaItem(key);
                        if (!item) return null;
                        const v = val ?? '';
                        const onVal = (nv: string) => {
                          updatePseudoStyle(activePseudo, { [key]: nv });
                        };
                        const onRm = () => {
                          removePseudoStyle(activePseudo, key);
                        };
                        return (
                          <div key={key} className="prop-row">
                            <div className="prop-row-header">
                              <span>{item.label}</span>
                              <button className="prop-remove" onClick={onRm} title="删除此属性">×</button>
                            </div>
                            <div className="prop-row-body">
                              {item.input === 'transform' && (
                                <TransformInput elementId={elementId} pseudo={activePseudo} />
                              )}
                              {item.input === 'shadow' && (
                                <BoxShadowInput elementId={elementId} pseudo={activePseudo} />
                              )}
                              {item.input === 'textShadow' && (
                                <TextShadowInput elementId={elementId} pseudo={activePseudo} />
                              )}
                              {item.input === 'opacity' && (
                                <OpacityInput elementId={elementId} pseudo={activePseudo} />
                              )}
                              {item.input === 'lineHeight' && (
                                <LineHeightInput elementId={elementId} />
                              )}
                              {item.input === 'color' && (
                                <ColorField
                                  value={v}
                                  fallback="#ffffff"
                                  onInputBlur={(nv) => onVal(nv || '')}
                                  onChange={onVal}
                                  onInputFocus={() => {}}
                                  onModalOpen={() => {}}
                                  onModalClose={(nv) => onVal(nv)}
                                />
                              )}
                              {item.input === 'select' && item.options && (
                                <select className="prop-select" value={v} onChange={(e) => onVal(e.target.value)}>
                                  {item.options.map((opt) => <option key={opt} value={opt}>{item.optionLabels?.[opt] ?? opt}</option>)}
                                </select>
                              )}
                              {(item.input === 'box4' || item.input === 'trbl') && item.sides ? (
                                <input className="prop-input" value={v} onChange={(e) => onVal(e.target.value)} placeholder="例：8px 4px" />
                              ) : item.input === 'font' ? (
                                <input className="prop-input" value={v} onChange={(e) => onVal(e.target.value)} placeholder="字体族" />
                              ) : !['transform', 'shadow', 'textShadow', 'opacity', 'lineHeight', 'color', 'select'].includes(item.input) ? (
                                <input className="prop-input" value={v} onChange={(e) => onVal(e.target.value)} />
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                      {!hasProps && (
                        <div className="hint" style={{ marginTop: 8, textAlign: 'center' }}>
                          <code>:{activePseudo}</code> 状态下暂无样式覆盖，点击上方 <b>+ 添加属性</b> 开始设置
                        </div>
                      )}
                    </>
                  );
                })()
              )}
            </div>
          </div>
        )}
      </div>

      {/* 4. CSS 样式属性折叠区 */}
      <div className="inspector-sec">
        <div
          className="inspector-sec-head"
          onClick={() => setSecOpen((p) => ({ ...p, css: !p.css }))}
          title="点击展开或收起 CSS 样式属性"
        >
          <span>
            <span className="sec-caret">{secOpen.css ? '▾' : '▸'}</span>
            CSS 样式属性
            {visibleSchema.length > 0 && <span className="sec-count">({visibleSchema.length})</span>}
          </span>
          <HelpButton
            title="CSS 样式属性"
            content={'点击「+ 添加属性」按需添加颜色、字体、边框、阴影等。\n· 点击右侧「?」可查看各属性详细用法，点击「×」可随时移除。'}
          />
        </div>
        {secOpen.css && (
          <div className="inspector-sec-body">
            <AddPropertyMenu
              type={elementType}
              elementStyle={selected.style as any}
              visibleKeys={visibleSchema.map((s) => s.key)}
              onAdd={onAddProperty}
            />
            {visibleSchema.length === 0 && (
              <div className="props-empty-hint">
                暂未添加特殊样式。点击上方 <b>+ 添加属性</b> 自由设定。
              </div>
            )}
            <div className="props-list">
              {visibleSchema.map((s) => (
                <PropertyRow
                  key={s.key}
                  schemaItem={s}
                  elementId={elementId}
                  elementType={elementType}
                  onRemove={() => onRemoveProperty(s.key)}
                  highlight={justAddedKey === s.key}
                  onEdited={() => { if (justAddedKey === s.key) onJustAdded(null); }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ——— 操作区 ——— */}
      <div className="inspector-actions">
        <button className="btn-secondary" onClick={() => duplicateElement(elementId)}>复制元素</button>
        <button className="btn-danger" onClick={() => removeElement(elementId)}>删除元素</button>
      </div>
    </>
  );
}

// ============ MultiClassNameRow：多选时统一设置类名 ============
function MultiClassNameRow(props: { ids: string[] }) {
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
            content={`给选中的 ${ids.length} 个元素统一加类名：\n\n· 输入名字回车 → 全部选中元素都加上它\n· 若这个类名已存在，它们会立刻穿上该类的样式\n· 点 chip 上的 × → 从全部选中元素移除这个名字`}
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
function MultiRelSelectorRow(props: { ids: string[] }) {
  const scene = useScene((s) => s.scene);
  const setMultiRelSelector = useScene((s) => s.setMultiRelSelector);
  const { ids } = props;
  const [inferOpen, setInferOpen] = useState(false);
  const [inferResult, setInferResult] = useState<RelInferResult | null>(null);

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
            title="批量关系选择器"
            content={`给选中的 ${ids.length} 个元素统一设置关系选择器：\n\n· 系统会自动推导它们的共同父容器（如 .card-grid > div）\n· 一键应用后，全部选中元素共享同一套后代样式，无需单独起 class`}
          />
          <span className="prop-scope">批量</span>
        </span>
      </div>
      <div className="prop-row-body">
        {commonRel ? (
          <div className="cls-rel-box">
            <div className="cls-rel-badge" title={`全部 ${ids.length} 个元素均使用关系选择器: ${commonRel}`}>
              <span className="cls-rel-icon">⚡</span>
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
            ⚡ 批量关联父级…
          </button>
        )}
      </div>

      {inferOpen && inferResult && (
        <>
          <div className="cls-infer-mask" onClick={() => setInferOpen(false)} />
          <div className="cls-infer-pop">
            <div className="cls-infer-head">
              <span className="cls-infer-title">⚡ 批量关系选择器推荐</span>
              <button className="cp-close" onClick={() => setInferOpen(false)}>×</button>
            </div>
            {inferResult.ok ? (
              <div className="cls-infer-body">
                <div className="hint" style={{ marginBottom: 6 }}>
                  共同父容器 <b>{inferResult.anchorName}</b>，选择应用于全部 {ids.length} 个元素：
                </div>
                {inferResult.candidates.map((c: RelCandidate, i: number) => (
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
                    </div>
                    <div className="cls-infer-item-desc">{c.description}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="cls-infer-err">
                <div className="hint" style={{ color: '#d9534f', margin: '4px 0' }}>
                  {inferResult.error}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ============ ClassChipsRow：类名专属行（独立区域，排列宽松） ============
function ClassChipsRow(props: { elementId: string; element: SceneElement }) {
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
function RelationalSelectorRow(props: { elementId: string; element: SceneElement }) {
  const scene = useScene((s) => s.scene);
  const setRelSelector = useScene((s) => s.setRelSelector);
  const { elementId, element } = props;
  const relSel = (element.attrs?.relSelector ?? '').trim();
  const [inferOpen, setInferOpen] = useState(false);
  const [inferResult, setInferResult] = useState<RelInferResult | null>(null);

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
            title="智能关系选择器"
            content={'通过父子关系定位元素，无需为每个子元素起 class：\n\n· 点击「⚡ 自动关联父级」，系统自动向上找父容器（如 .hero、.card），推导生成 .hero > h1、.card > p 等手写级选择器\n· 若选择全部同类（如 .main > div），该容器下所有同标签直接子元素会自动同步该选择器与样式'}
          />
          <span className="prop-scope">父→子</span>
        </span>
      </div>
      <div className="prop-row-body">
        {relSel ? (
          <div className="cls-rel-box">
            <div className="cls-rel-badge" title={`当前关系选择器: ${relSel}`}>
              <span className="cls-rel-icon">⚡</span>
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
            ⚡ 自动关联父级…
          </button>
        )}
      </div>

      {/* 智能推断推荐弹层 */}
      {inferOpen && inferResult && (
        <>
          <div className="cls-infer-mask" onClick={() => setInferOpen(false)} />
          <div className="cls-infer-pop">
            <div className="cls-infer-head">
              <span className="cls-infer-title">⚡ 智能关系选择器推荐</span>
              <button className="cp-close" onClick={() => setInferOpen(false)}>×</button>
            </div>
            {inferResult.ok ? (
              <div className="cls-infer-body">
                <div className="hint" style={{ marginBottom: 6 }}>
                  匹配到上层容器 <b>{inferResult.anchorName}</b>，选择一个规则：
                </div>
                {inferResult.candidates.map((c: RelCandidate, i: number) => (
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
                    </div>
                    <div className="cls-infer-item-desc">{c.description}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="cls-infer-err">
                <div className="hint" style={{ color: '#d9534f', margin: '4px 0' }}>
                  {inferResult.error}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ============ PropertyRow：每条 CSS 属性的渲染 ============
function PropertyRow(props: {
  schemaItem: typeof SCHEMA[number];
  elementId: string;
  elementType: ElementType;
  onRemove: () => void;
  /** 刚添加的高亮蓝框（编辑过就取消） */
  highlight?: boolean;
  /** 用户开始编辑这个属性（focus）时回调，用于取消高亮 */
  onEdited?: () => void;
}) {
  const { schemaItem, elementId, elementType, onRemove, highlight, onEdited } = props;
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  const node = findNode(scene.root, elementId);
  const app = checkApplicability(schemaItem, elementType, node?.style as any);

  // 取当前 store 里的值（用于受控 input 的初始值 + 外部更新时同步）
  // trbl 简写输入由 TrblInput 自管，不走这里的单值同步
  const storeValue = (() => {
    if (schemaItem.input === 'trbl') return '';
    if (!node) return '';
    if (schemaItem.input === 'box4' && schemaItem.sides) {
      const side0 = schemaItem.sides[0];
      return (side0 && (node.style as Record<string, string | undefined>)[side0.key]) ?? '';
    }
    return (node.style as Record<string, string | undefined>)[schemaItem.key] ?? '';
  })();

  // 本地 state：受控输入的最新值，避免 onBlur 拿到闭包旧值
  const [localValue, setLocalValue] = useState(storeValue);
  // 当 storeValue 外部更新（如撤销/重做）时同步本地
  useEffect(() => {
    setLocalValue(storeValue);
  }, [storeValue]);

  const help = schemaItem.help ? (
    <HelpButton
      title={schemaItem.help.title}
      // 数值类属性统一附加"单位说明"：一次性讲清所有单位
      content={schemaItem.help.content + (schemaItem.unit ? '\n\n' + UNIT_HELP_TEXT : '')}
    />
  ) : null;

  return (
    <div
      className={'prop-row' + (highlight ? ' highlight' : '') + (!app.applicable ? ' is-inapplicable' : '')}
      // React 合成 onFocus 会冒泡：任何子输入框聚焦都会视为开始编辑
      onFocus={onEdited}
    >
      <div className="prop-row-header">
        <span>
          {schemaItem.scope && (
            <span className="prop-scope" title={schemaItem.scope === '父' ? '此属性作用在父容器上，影响子元素排布' : '此属性作用在子元素上'}>
              {schemaItem.scope}
            </span>
          )}
          {schemaItem.label}{help}
          {!app.applicable && (
            <span className="prop-warn-tag" title={app.disabledReason}>
              ⚠ {app.disabledReason?.slice(0, 14)}…
            </span>
          )}
          {highlight && <span className="prop-new-badge">新</span>}
        </span>
        <button className="prop-remove" title="删除此属性" onClick={onRemove}>×</button>
      </div>
      <div className="prop-row-body">
        {schemaItem.input === 'font' && (
          <FontFamilyInput elementId={elementId} />
        )}
        {schemaItem.input === 'text' && (
          <input
            type="text"
            value={localValue}
            placeholder={schemaItem.placeholder}
            onFocus={() => beginStyleEdit()}
            onChange={(e) => {
              const v = e.target.value;
              setLocalValue(v);
              updateStyleTransient(elementId, { [schemaItem.key]: applyUnit(v, schemaItem.unit) } as any);
            }}
            onBlur={() => {
              updateStyle(elementId, { [schemaItem.key]: applyUnit(localValue, schemaItem.unit) } as any);
              endStyleEdit();
            }}
          />
        )}
        {schemaItem.input === 'number' && schemaItem.unit && (
          // 数值 + 单位（数字框 + 单位下拉）；数字框只输入数字
          <NumberUnitInput
            elementId={elementId}
            schemaKey={schemaItem.key}
            unit={schemaItem.unit}
            allowAuto={schemaItem.allowAuto}
          />
        )}
        {schemaItem.input === 'number' && !schemaItem.unit && (
          <input
            type="number"
            value={localValue}
            placeholder={schemaItem.placeholder}
            onFocus={() => beginStyleEdit()}
            onChange={(e) => {
              const v = e.target.value;
              setLocalValue(v);
              updateStyleTransient(elementId, { [schemaItem.key]: v } as any);
            }}
            onBlur={() => {
              updateStyle(elementId, { [schemaItem.key]: localValue } as any);
              endStyleEdit();
            }}
          />
        )}
        {schemaItem.input === 'select' && schemaItem.options && (
          <select
            value={storeValue}
            onChange={(e) => updateStyle(elementId, { [schemaItem.key]: e.target.value } as any)}
          >
            <option value="">— 未指定 —</option>
            {schemaItem.options.map((o) => (
              <option
                key={o}
                value={o}
                title={schemaItem.optionLabels?.[o]}
              >
                {schemaItem.optionLabels?.[o] ? `${o} · ${schemaItem.optionLabels[o]}` : o}
              </option>
            ))}
          </select>
        )}
        {schemaItem.input === 'color' && (
          <ColorPicker
            elementId={elementId}
            styleKey={schemaItem.key as 'backgroundColor' | 'color' | 'borderColor'}
            fallback={schemaItem.placeholder}
          />
        )}
        {schemaItem.input === 'box4' && schemaItem.sides && (
          <Box4Input elementId={elementId} sides={schemaItem.sides} fallback={schemaItem.placeholder} unit={schemaItem.unit} />
        )}
        {schemaItem.input === 'trbl' && schemaItem.sides && (
          <TrblInput
            elementId={elementId}
            sides={schemaItem.sides}
            fallback={schemaItem.placeholder}
            unit={schemaItem.unit}
            hideUnit={schemaItem.hideUnit}
          />
        )}
        {schemaItem.input === 'transform' && (
          <TransformInput elementId={elementId} />
        )}
        {schemaItem.input === 'shadow' && (
          <BoxShadowInput elementId={elementId} />
        )}
        {schemaItem.input === 'textShadow' && (
          <TextShadowInput elementId={elementId} />
        )}
        {schemaItem.input === 'transition' && (
          <TransitionInput elementId={elementId} />
        )}
        {schemaItem.input === 'opacity' && (
          <OpacityInput elementId={elementId} />
        )}
        {schemaItem.input === 'lineHeight' && (
          <LineHeightInput elementId={elementId} />
        )}
      </div>
    </div>
  );
}

// ============ AttrRow：HTML 原生属性（class/id/src/alt/href 等） ============
function AttrRow(props: {
  keyName: string;
  label: string;
  elementId: string;
  element: SceneElement;
  help?: { title: string; content: string };
}) {
  const { keyName, label, elementId, element, help } = props;
  const updateAttr = useScene((s) => s.updateAttr);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const root = useScene((s) => s.scene.root);

  const currentValue = (element.attrs?.[keyName] as string) ?? '';

  const helpBtn = help ? <HelpButton title={help.title} content={help.content} /> : null;

  // 用 setState 控制本地编辑值（避免每输入一个字符都 setState 触发渲染）
  const [localValue, setLocalValue] = useState(currentValue);
  // 4-F：类名 / ID 输入后的即时提示（同名数量 / ID 重复），blur 时计算
  const [hint, setHint] = useState<{ text: string; danger?: boolean } | null>(null);

  // 选本地图片 button（仅 keyName === 'src'）
  const isImgSrc = keyName === 'src';
  const onPickImage = async () => {
    const res = await window.bc.pickImageSrc();
    if (!res.ok) return;
    updateAttr(elementId, keyName, res.path ?? '');
    setLocalValue(res.path ?? '');
  };

  // 类名 / ID 专用：提交后给出即时反馈（不影响提交本身）
  const checkNameHint = (value: string) => {
    const v = value.trim();
    if (!v) { setHint(null); return; }
    if (keyName === 'className') {
      const cls = v;
      let count = 0;
      const walk = (n: SceneElement): void => {
        if (n.id !== elementId && (n.attrs?.className ?? '').trim() === cls) count++;
        for (const c of n.children) walk(c);
      };
      walk(root);
      setHint(
        count > 0
          ? { text: `已有 ${count} 个元素使用这个类名：改任意一个的样式，它们会一起变（编辑即统一）` }
          : null
      );
    } else if (keyName === 'id') {
      let dup = false;
      let owner = '';
      const walk = (n: SceneElement): void => {
        if (n.id !== elementId && (n.attrs?.id ?? '').trim() === v) { dup = true; owner = n.type; }
        for (const c of n.children) walk(c);
      };
      walk(root);
      setHint(
        dup
          ? { text: `⚠ 这个 ID 已被另一个 <${owner}> 使用，浏览器里 ID 必须唯一`, danger: true }
          : null
      );
    }
  };

  return (
    <div className="prop-row">
      <div className="prop-row-header">
        <span>{label}{helpBtn}</span>
      </div>
      <div className="prop-row-body attr-row-body" style={{ display: 'flex' }}>
        <input
          type="text"
          value={localValue}
          placeholder={'例如 ' + (keyName === 'className' ? 'btn primary' : keyName === 'href' ? 'https://...' : '')}
          onFocus={() => beginStyleEdit()}
          onChange={(e) => {
            setLocalValue(e.target.value);
          }}
          onBlur={() => {
            updateAttr(elementId, keyName, localValue);
            checkNameHint(localValue);
            endStyleEdit();
          }}
        />
        {isImgSrc && (
          <button
            className="btn-mini"
            onClick={onPickImage}
            title="选择本地图片文件"
          >选文件…</button>
        )}
      </div>
      {hint && (
        <div
          className={'attr-hint' + (hint.danger ? ' danger' : '')}
          onClick={() => setHint(null)}
          title="点击关闭"
        >{hint.text}</div>
      )}
    </div>
  );
}

// img 图片来源与路径模式（相对路径 / 绝对路径 / 网络URL）
function ImgPickerRow(props: { elementId: string }) {
  const updateAttr = useScene((s) => s.updateAttr);
  const scene = useScene((s) => s.scene);
  const element = findNode(scene.root, props.elementId);
  const currentSrc = element?.attrs?.src ?? '';

  const [pathMode, setPathMode] = useState<'rel' | 'abs' | 'url'>(() => {
    if (currentSrc.startsWith('http://') || currentSrc.startsWith('https://')) return 'url';
    if (/^[a-zA-Z]:[\\/]/.test(currentSrc) || currentSrc.startsWith('\\\\')) return 'abs';
    return 'rel';
  });

  const onPick = async (mode: 'rel' | 'abs') => {
    const res = await window.bc.pickImageSrc(mode);
    if (!res.ok || !res.path) return;
    updateAttr(props.elementId, 'src', res.path);
  };

  return (
    <div className="prop-row">
      <div className="prop-row-header">
        <span>
          图片路径 (src)
          <HelpButton
            title="图片路径模式"
            content={'支持三种图片引用方式：\n\n1. 相对路径（推荐）：图片位于工程目录中（如 ./images/pic.png），项目移动或打包后图片依然有效！\n2. 绝对路径：本机固定路径（如 D:\\photos\\pic.jpg）。\n3. 网络 URL：直接粘贴在线图片链接（https://...）。'}
          />
        </span>
        <div className="img-mode-seg">
          <button className={'img-mode-btn' + (pathMode === 'rel' ? ' active' : '')} onClick={() => setPathMode('rel')}>相对路径</button>
          <button className={'img-mode-btn' + (pathMode === 'abs' ? ' active' : '')} onClick={() => setPathMode('abs')}>绝对路径</button>
          <button className={'img-mode-btn' + (pathMode === 'url' ? ' active' : '')} onClick={() => setPathMode('url')}>网络URL</button>
        </div>
      </div>
      <div className="prop-row-body" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="text"
          value={currentSrc}
          placeholder={pathMode === 'url' ? 'https://example.com/image.png' : pathMode === 'rel' ? './images/banner.png' : 'D:\\images\\photo.png'}
          onChange={(e) => updateAttr(props.elementId, 'src', e.target.value)}
          style={{ flex: 1 }}
        />
        {pathMode !== 'url' && (
          <button
            className="btn-mini"
            onClick={() => onPick(pathMode as 'rel' | 'abs')}
            title={`点击选择本地图片并生成${pathMode === 'rel' ? '相对' : '绝对'}路径`}
          >
            选本地图片…
          </button>
        )}
      </div>
    </div>
  );
}

// 保证 SELF_CLOSING_TAGS 被引用（未来可能加专用 attrs 处理）
void SELF_CLOSING_TAGS;
