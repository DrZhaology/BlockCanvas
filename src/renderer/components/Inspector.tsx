import { useState, useEffect } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { TEXT_TAGS, SELF_CLOSING_TAGS } from '@lib/types';
import type { ElementType, SceneElement, SceneGraph } from '@lib/types';
import {
  SCHEMA, ATTRS_SCHEMA, DEFAULT_VISIBLE_PROPS,
  getSchemaItem, isApplicable, hasStyleValue, applyUnit, UNIT_HELP_TEXT
} from '@lib/propertySchema';
import { AddPropertyMenu } from './AddPropertyMenu';
import { HelpButton } from './HelpButton';
import { Box4Input } from './Box4Input';
import { TrblInput } from './TrblInput';
import { ColorPicker } from './ColorPicker';
import { NumberUnitInput } from './NumberUnitInput';
import { FlexHelper } from './FlexHelper';
import { ClassManager } from './ClassManager';

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
        <div className="inspector-actions">
          <button className="btn-danger" onClick={() => removeMany(ids)}>删除全部 {ids.length} 个</button>
          <button className="btn-secondary" onClick={() => selectMany([])}>取消选中</button>
        </div>
      </>
    );
  } else if (!selected) {
    elementBody = (
      <>
        <div className="panel-title">属性</div>
        <div className="hint">在画布或图层树上点选一个元素</div>
      </>
    );
  } else if (selected.id === scene.root.id) {
    elementBody = (
      <>
        <div className="panel-title">属性 · 画布根</div>
        <div className="hint">画布根不可移除，子元素在画布上垂直堆叠。</div>
      </>
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

// ============ 页面页签：全局 CSS（4-D：快速设置 + 高级可展开） ============
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

  // 快速设置的提交模式：
  // - 文本输入：focus 开会话（检查点），onChange 直接改 store（会话内不推栈），blur 收尾
  // - 取色器：点一次 = 最终值，begin → set → end 一次提交
  const quickItems: {
    key: keyof NonNullable<SceneGraph['quickCss']>;
    label: string;
    type: 'color' | 'text';
    placeholder?: string;
  }[] = [
    { key: 'bodyBg', label: '页面背景色', type: 'color' },
    { key: 'textColor', label: '文字颜色', type: 'color' },
    { key: 'linkColor', label: '链接颜色', type: 'color' },
    { key: 'fontFamily', label: '页面字体', type: 'text', placeholder: '例如 Arial, sans-serif' }
  ];
  const quickRow = (item: (typeof quickItems)[number]) => {
    const value = (quickCss ?? {})[item.key] ?? '';
    const commit = (v: string) => {
      beginStyleEdit();
      setQuickCss({ [item.key]: v || undefined } as Record<string, string | undefined>);
      endStyleEdit();
    };
    const clear = () => {
      beginStyleEdit();
      setQuickCss({ [item.key]: undefined } as Record<string, string | undefined>);
      endStyleEdit();
    };
    return (
      <div className="page-quick-row" key={item.key}>
        <span className="page-quick-label">{item.label}</span>
        {item.type === 'color' ? (
          <>
            <input
              type="color"
              className="page-quick-swatch"
              value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'}
              onChange={(e) => commit(e.target.value)}
              title={value ? `当前：${value}` : '点击选择颜色'}
            />
            <input
              className="page-quick-input"
              placeholder="留空 = 不设置"
              value={value}
              spellCheck={false}
              onFocus={() => beginStyleEdit()}
              onChange={(e) => setQuickCss({ [item.key]: e.target.value || undefined } as Record<string, string | undefined>)}
              onBlur={() => endStyleEdit()}
            />
          </>
        ) : (
          <input
            className="page-quick-input"
            placeholder={item.placeholder ?? '留空 = 不设置'}
            value={value}
            spellCheck={false}
            onFocus={() => beginStyleEdit()}
            onChange={(e) => setQuickCss({ [item.key]: e.target.value || undefined } as Record<string, string | undefined>)}
            onBlur={() => endStyleEdit()}
          />
        )}
        {value !== '' && (
          <button className="page-quick-clear" title="清空该项" onClick={clear}>×</button>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="panel-title">页面 · 全局设置</div>
      <div className="hint" style={{ marginBottom: 8 }}>
        这里改的是整页的外观，效果和你写的 CSS 一样，会一起放进导出的 HTML。
      </div>

      {/* 快速设置：可视化常用项 */}
      <div className="page-quick-css">
        {quickItems.map((item) => quickRow(item))}
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

// ============ 元素页签内容（选中元素的属性编辑区） ============
function ElementPropsBody(props: { selected: SceneElement; justAddedKey: string | null; onJustAdded: (k: string | null) => void }) {
  const { selected, justAddedKey, onJustAdded } = props;
  const updateStyle = useScene((s) => s.updateStyle);
  const removeElement = useScene((s) => s.removeElement);
  const duplicateElement = useScene((s) => s.duplicateElement);
  const setText = useScene((s) => s.setText);
  const addVisibleProp = useScene((s) => s.addVisibleProp);
  const removeVisibleProp = useScene((s) => s.removeVisibleProp);
  const elementId = selected.id;
  const elementType = selected.type;

  // ============ 决定"显示哪些属性" ============
  // 1. + DEFAULT_VISIBLE_PROPS (width/height)
  // 2. style 里有非空值的所有 schema 属性（含 box4/trbl 4 边任一有值便视为已添加）
  // 3. visibleProps 列表里显式添加过的 key（即使 style 值被清空为空串也不消失）
  const visibleSchema: typeof SCHEMA = [];
  const visiblePropList = selected.visibleProps ?? [];
  for (const s of SCHEMA) {
    if (!isApplicable(s, selected.type)) continue;
    if (DEFAULT_VISIBLE_PROPS.includes(s.key) || hasStyleValue(selected.style, s) || visiblePropList.includes(s.key)) {
      visibleSchema.push(s);
    }
  }

  // ============ "添加属性"回调 ============
  // 不预填 0 / 0px（用户反馈：预填数值再删掉很别扭，而且 width:0 会把元素压没）。
  // visibleProps 固化该属性，清空文字也不会让属性行消失。
  // 高亮"新"由 justAddedKey 驱动；不自动聚焦（程序化聚焦会立刻触发 onEdited 把高亮清掉，
  // 而且抢焦点惹人烦——蓝色高亮边框已足够让人一眼定位新属性）。
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

  // ============ "删除属性"回调：从 visibleProps + style 一并清掉（只有 × 才会删属性） ============
  const onRemoveProperty = (key: string) => {
    removeVisibleProp(elementId, key);
  };

  // ============ Applicable attrs for this element ============
  const applicableAttrs = ATTRS_SCHEMA.filter((a) => {
    if (!a.onlyTypes) return true;
    return a.onlyTypes.includes(elementType);
  });

  return (
    <>
      <div className="panel-title">
        属性 · {"<" + elementType + ">"}
      </div>

      {/* 文案 */}
      {TEXT_TAGS.has(elementType) && (
        <Field label="文案">
          <textarea
            value={selected.text ?? ''}
            placeholder="在此输入文字内容"
            rows={2}
            onChange={(e) => setText(elementId, e.target.value)}
          />
        </Field>
      )}

      {/* 元素专属自动行为（img 选本地路径） */}
      {elementType === 'img' && (
        <ImgPickerRow elementId={elementId} />
      )}

      {/* 布局助手：Flex 中文封装（横排/竖排 + 对齐 + 间距；叶子元素给"选中父容器"入口） */}
      <FlexHelper elementId={elementId} elementType={elementType} />

      {/* ——— CSS 样式属性区 ——— */}
      <div className="props-section-title">CSS 样式</div>
      <AddPropertyMenu
        type={elementType}
        visibleKeys={visibleSchema.map((s) => s.key)}
        onAdd={onAddProperty}
      />

      <div className="props-list">
        {visibleSchema.map((s) => {
          // 已显示属性，每个有一个 PropertyRow
          return (
            <PropertyRow
              key={s.key}
              schemaItem={s}
              elementId={elementId}
              elementType={elementType}
              onRemove={() => onRemoveProperty(s.key)}
              highlight={justAddedKey === s.key}
              onEdited={() => { if (justAddedKey === s.key) onJustAdded(null); }}
            />
          );
        })}
      </div>

      {/* ——— HTML 原生属性区 ——— */}
      {applicableAttrs.length > 0 && (
        <>
          <div className="props-section-title">HTML 属性</div>
          <div className="props-list">
            {applicableAttrs.map((a) => (
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
        </>
      )}

      {/* ——— 操作区 ——— */}
      <div className="inspector-actions">
        <button className="btn-secondary" onClick={() => duplicateElement(elementId)}>复制元素</button>
        <button className="btn-danger" onClick={() => removeElement(elementId)}>删除元素</button>
      </div>
    </>
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
  const { schemaItem, elementId, onRemove, highlight, onEdited } = props;
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  // 取当前 store 里的值（用于受控 input 的初始值 + 外部更新时同步）
  // trbl 简写输入由 TrblInput 自管，不走这里的单值同步
  const storeValue = (() => {
    if (schemaItem.input === 'trbl') return '';
    const node = findNode(scene.root, elementId);
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
      className={'prop-row' + (highlight ? ' highlight' : '')}
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
          {highlight && <span className="prop-new-badge">新</span>}
        </span>
        <button className="prop-remove" title="删除此属性" onClick={onRemove}>×</button>
      </div>
      <div className="prop-row-body">
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
          />
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

// img 选本地路径快捷按钮（独立一行）
function ImgPickerRow(props: { elementId: string }) {
  const updateAttr = useScene((s) => s.updateAttr);
  const scene = useScene((s) => s.scene);
  const element = findNode(scene.root, props.elementId);
  const currentSrc = element?.attrs?.src ?? '';

  const onPick = async () => {
    const res = await window.bc.pickImageSrc();
    if (!res.ok) return;
    updateAttr(props.elementId, 'src', res.path ?? '');
  };

  return (
    <Field label="图片路径" hint="URL 或本地路径，点击右侧选本地图片">
      <input
        type="text"
        value={currentSrc}
        placeholder="URL 或本地路径"
        onChange={(e) => updateAttr(props.elementId, 'src', e.target.value)}
        style={{ flex: 1 }}
      />
      <button className="btn-mini" onClick={onPick} title="选择本地图片">选文件…</button>
    </Field>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </label>
      <div className="field-row">{children}</div>
    </div>
  );
}

// 保证 SELF_CLOSING_TAGS 被引用（未来可能加专用 attrs 处理）
void SELF_CLOSING_TAGS;
