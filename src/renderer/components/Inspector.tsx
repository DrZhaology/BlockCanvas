import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useScene, findNode, getEffectiveStyle } from '@store/sceneStore';
import { TEXT_TAGS, SELF_CLOSING_TAGS, CONTAINER_TAGS } from '@lib/types';
import type { ElementType, SceneElement, SceneGraph } from '@lib/types';
import { SCHEMA, ATTRS_SCHEMA, DEFAULT_VISIBLE_PROPS,
  getSchemaItem, isApplicable, hasStyleValue, applyUnit, UNIT_HELP_TEXT
} from '@lib/propertySchema';
import { getPluginProperties } from '@lib/pluginHost';
import { AddPropertyMenu } from './AddPropertyMenu';
import { Icon } from './Icon';
import { HelpButton } from './HelpButton';
import { Box4Input } from './Box4Input';
import { useShowBr } from '@lib/showBr';
import { peekPendingPropFocus, subscribePropFocus, takePendingPropFocus, type PropFocusRequest } from '@lib/propFocus';
import { TrblInput } from './TrblInput';
import { ColorPicker, ColorField } from './ColorPicker';
import { NumberUnitInput } from './NumberUnitInput';
import { FontFamilyInput } from './FontFamilyInput';
import { TransformInput } from './TransformInput';
import { BorderInput } from './BorderInput';
import { BoxShadowInput } from './BoxShadowInput';
import { TextShadowInput } from './TextShadowInput';
import { FilterInput } from './FilterInput';
import { OutlineInput } from './OutlineInput';
import { GridSpanInput } from './GridSpanInput';
import { TransitionInput } from './TransitionInput';
import { OpacityInput } from './OpacityInput';
import { LineHeightInput } from './LineHeightInput';
import { QuickHelper, HELPER_MANAGED_KEYS } from './QuickHelper';
import { PseudoFxPanel } from './PseudoFx';
import { BackgroundInput } from './BackgroundInput';
import { Collapse } from './Collapse';
import { findTableAncestor } from '@lib/tableOps';
import { ClassManager } from './ClassManager';
import { TokenPanel } from './TokenPanel';
import { classColor, isValidClassToken } from '@lib/classColor';
import { isGradient } from '@lib/gradient';
import { requestDevice, useEffectiveDevice } from '@lib/device';
import { planResponsiveFixes } from '@lib/responsiveAuto';
import { useClosing } from '@lib/useClosing';
import { checkApplicability } from '@lib/propertySchema';
import { inferRelationalSelectors, inferMultiRelationalSelectors, type RelCandidate, type RelInferResult } from '@lib/relationInfer';
import { appAlert, appConfirm } from '@lib/appConfirm';

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

// 「快捷助手属性是否显示到下方 CSS 列表」的全局开关（设置页同一开关，事件双向同步）
const HELPER_IN_CSS_KEY = 'bc-helper-in-css-global';

export function Inspector() {
  const scene = useScene((s) => s.scene);
  const removeMany = useScene((s) => s.removeMany);
  const selectMany = useScene((s) => s.selectMany);

  // ⚠️ Hooks 必须在任何提前 return 之前声明（React 规则），
  // 否则"未选中 → 选中"切换时 hook 数量变化会让 React 崩溃卸载整棵组件树（白屏）。
  // 刚添加的属性 key：让对应输入的框自动聚焦 + 蓝色高亮边框，一眼找到
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);
  // 元素 / 页面 / 类名 页签
  const [inspectorTab, setInspectorTabRaw] = useState<'element' | 'page' | 'class' | 'token'>('element');
  // v0.4.4：页签切换不再走 View Transition（旧帧快照会让文字停顿），
  // 改为内容重挂载 + 轻量入场动画（见 .insp-tab-anim 的 bcSwapIn）。
  const setInspectorTab = (t: 'element' | 'page' | 'class' | 'token') => {
    if (t === inspectorTab) return;
    setInspectorTabRaw(t);
  };
  // 「⚠」面板或菜单「类名管理」→ 切到「类名」页签
  useEffect(() => {
    const openClass = () => setInspectorTabRaw('class');
    window.addEventListener('bc:open-class', openClass);
    return () => window.removeEventListener('bc:open-class', openClass);
  }, []);
  // 切换选中元素时，清除"刚添加"标记（高亮/聚焦不属于新元素）
  const selectedIdForSync = scene.selectedId;
  useEffect(() => {
    setJustAddedKey(null);
  }, [selectedIdForSync]);

  // 中键属性搜索：右侧面板可能停在「页面 / 类名 / 变量」页签（ElementPropsBody 未挂载），
  // 甚至整个 Inspector 刚被 App 从「图层」切过来。这里统一兜底：收到请求就切到「元素」页签，
  // 真正的定位由 ElementPropsBody 挂载后从缓冲里取走执行（见 lib/propFocus）。
  useEffect(() => {
    const toElement = () => {
      if (peekPendingPropFocus()) setInspectorTabRaw('element');
    };
    toElement(); // 挂载瞬间可能已经有排队请求（从图层页切过来的情况）
    return subscribePropFocus(toElement);
  }, []);

  // 画布/模板刚插入新元素 → 把右侧属性区滚回顶部（顶部就是这个新元素的属性）
  useEffect(() => {
    const onAdded = () => {
      window.setTimeout(() => {
        const scroller = document.querySelector('.right-pane .tab-body') as HTMLElement | null;
        if (scroller) {
          scroller.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 80);
    };
    window.addEventListener('bc:element-added', onAdded);
    return () => window.removeEventListener('bc:element-added', onAdded);
  }, []);

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
        <div className="empty-icon"><Icon name="target" size={30} /></div>
        <div className="empty-title">未选中元素</div>
        <div className="empty-desc">
          在画布上直接点击任意元素，或在左侧「图层」中点选，即可在此调整大小、颜色、文字与排版。
        </div>
      </div>
    );
  } else if (selected.id === scene.root.id) {
    elementBody = (
      <div className="inspector-empty">
        <div className="empty-icon"><Icon name="pageReset" size={30} /></div>
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
        <button
          className={"inspector-tab" + (inspectorTab === 'token' ? ' active' : '')}
          onClick={() => setInspectorTab('token')}
          title="设计变量：把主色 / 圆角 / 间距定义成名字，改一处全站跟着变"
        >变量</button>
      </div>
      <div className="insp-tab-anim" key={inspectorTab}>
        {inspectorTab === 'class'
          ? <ClassManager />
          : inspectorTab === 'token'
            ? <TokenPanel />
            : inspectorTab === 'page'
            ? <PageCssBody />
            : elementBody}
      </div>
    </div>
  );
}

// ============ 页面页签：body 设置 + 全局样式 ============
// v0.4.5 重构（按用户要求，与元素 CSS 面板统一）：
//  · 「添加属性」直接用元素面板同款 AddPropertyMenu：按类别分组 + 中英文/拼音搜索；
//  · 每个属性都渲染成和元素 CSS 一样的专属卡片 —— 颜色开调色盘、数值有数字框 + 单位、
//    内外边距是四向输入、枚举是下拉，不再是一排裸文本框；
//  · body 的 7 个常用项仍走 quickCss（旧工程与导出完全兼容），其余任意 CSS 走 bodyExtra。

type PageQuickKey = keyof NonNullable<SceneGraph['quickCss']> & string;

interface PagePropDef {
  key: PageQuickKey;
  label: string;
  type: 'color' | 'text';
  placeholder?: string;
  /** 对应元素 SCHEMA 的 key：决定这张卡片用哪种专属编辑器 */
  schemaKey?: string;
}

const PAGE_PROPS: PagePropDef[] = [
  { key: 'bodyBg', label: '页面背景色', type: 'color', schemaKey: 'backgroundColor' },
  { key: 'textColor', label: '文字颜色', type: 'color', schemaKey: 'color' },
  { key: 'linkColor', label: '链接颜色', type: 'color', schemaKey: 'color' },
  { key: 'fontFamily', label: '页面字体', type: 'text', schemaKey: 'fontFamily' },
  { key: 'bodyFontSize', label: '正文字号', type: 'text', schemaKey: 'fontSize' },
  { key: 'bodyLineHeight', label: '正文行高', type: 'text', schemaKey: 'lineHeight' },
  { key: 'headingColor', label: '标题颜色（h1~h6）', type: 'color', schemaKey: 'color' }
];

const PAGE_DEFAULT_KEYS = new Set<string>(['bodyBg', 'textColor', 'linkColor', 'fontFamily']);

const camelToKebab = (k: string) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const kebabToCamel = (k: string) => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** 「添加属性」里选中的 CSS 属性若正好是 body 常用项 → 写回 quickCss，避免两处重复 */
const CSS_TO_QUICK: Record<string, PageQuickKey> = {
  backgroundColor: 'bodyBg',
  color: 'textColor',
  fontFamily: 'fontFamily',
  fontSize: 'bodyFontSize',
  lineHeight: 'bodyLineHeight'
};

function PageCssBody() {
  const quickCss = useScene((s) => s.scene.quickCss);
  const setQuickCss = useScene((s) => s.setQuickCss);
  const bodyExtra = useScene((s) => s.scene.bodyExtra);
  const setBodyExtra = useScene((s) => s.setBodyExtra);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  // 两块开合记忆：存工程文件 scene.uiState.pageSec（与右侧其他板块同一机制，不触发脏标记）
  const pageSec = useScene((s) => s.scene.uiState?.pageSec);
  const setPageSec = useScene((s) => s.setPageSec);
  const bodyOpen = pageSec?.body ?? true;
  const globalOpen = pageSec?.global ?? false;
  // 「全局样式」添加表单
  const qc = quickCss ?? {};
  // 注意：值为空串也要保留 —— 刚点「添加属性」加进来的行就是空值，过滤掉会"点了没反应"
  const extraEntries = Object.entries(bodyExtra ?? {});
  const legacyCss = (useScene.getState().scene.globalCss ?? '').trim();

  // 已显示 = 默认项 ∪ 键已存在（含空串）的项
  const visibleDefs = PAGE_PROPS.filter((it) => PAGE_DEFAULT_KEYS.has(it.key) || qc[it.key] !== undefined);

  // 会话式提交：focus/开 modal 开会话（不入栈），change 流式写 store，blur/关 modal 收尾一次入栈
  const setKey = (key: PageQuickKey, v: string) => setQuickCss({ [key]: v } as Record<string, string | undefined>);
  const removeKey = (key: PageQuickKey) => {
    beginStyleEdit();
    setQuickCss({ [key]: undefined } as Record<string, string | undefined>);
    endStyleEdit();
  };
  const setExtra = (k: string, v: string) => setBodyExtra({ [k]: v });
  const removeExtra = (k: string) => {
    // 四向属性（padding / margin）连同四个分边一起删，避免删了简写却留下 padding-top 之类的孤儿键
    const sc = getSchemaItem(kebabToCamel(k));
    const patch: Record<string, string | undefined> = { [k]: undefined };
    sc?.sides?.forEach((s) => { patch[camelToKebab(s.key)] = undefined; });
    beginStyleEdit();
    setBodyExtra(patch);
    endStyleEdit();
  };

  // 「+ 添加属性」：与元素面板同一个菜单；选中的 key 若是 body 常用项就写回 quickCss
  const addBodyProp = (camelKey: string) => {
    const quick = CSS_TO_QUICK[camelKey];
    beginStyleEdit();
    if (quick) setKey(quick, qc[quick] ?? '');
    else setBodyExtra({ [camelToKebab(camelKey)]: '' });
    endStyleEdit();
  };
  const visibleCamelKeys = [
    ...visibleDefs.map((d) => d.schemaKey ?? ''),
    ...extraEntries.map(([k]) => kebabToCamel(k))
  ].filter(Boolean);

  return (
    <>
      <div className="panel-title">页面 · 全局</div>
      <div className="hint" style={{ marginBottom: 8 }}>
        这里改的是整页的外观，效果和你写的 CSS 一样，会一起放进导出的 HTML。
      </div>

      {/* ① body 设置：常用项 + 「+ 添加属性」按需扩展（可折叠，状态进工程文件） */}
      <div className="inspector-sec">
        <div
          className="inspector-sec-head"
          onClick={() => setPageSec({ body: !bodyOpen })}
          title="点击展开或收起 body 设置"
        >
          <span>
            <span className="sec-caret"><Icon name={bodyOpen ? 'chevronDown' : 'chevronRight'} size={12} /></span>
            body 设置
          </span>
          <HelpButton
            title="body 设置"
            content={'改的是整页 body 的常用外观：背景色、文字颜色、字体、字号等。\n\n· 每项留空 = 不设置；点 × 可以把该项从面板里移除。\n· 下面的开关：去掉浏览器默认给页面留的白边 / 重置标题段落自带的间距。\n· 这里没覆盖到的属性，用下方「全局样式」自由添加。'}
          />
        </div>
        <Collapse open={bodyOpen}>
          <div className="inspector-sec-body">
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
        {visibleDefs.map((item) => (
          <PagePropRow
            key={item.key}
            label={item.label}
            cssKey={camelToKebab(item.schemaKey ?? item.key)}
            schemaKey={item.schemaKey}
            value={qc[item.key] ?? ''}
            onChange={(v) => setKey(item.key, v)}
            onFocusStart={() => beginStyleEdit()}
            onFocusEnd={() => endStyleEdit()}
            onRemove={() => removeKey(item.key)}
          />
        ))}
        {/* v0.4.4 修：body 区不再放「添加属性」。
            以前这里也有一个添加菜单，但 bodyExtra 的卡片渲染在「全局样式」区，
            用户点 body 区的按钮 → 属性跑到下面去了（反馈 #6）。现在只保留全局样式区一个入口。 */}
            </div>
          </div>
        </Collapse>
      </div>

      {/* ② 全局样式：像给 body 写 CSS 一样自由添加任意属性（可折叠，状态进工程文件） */}
      <div className="inspector-sec">
        <div
          className="inspector-sec-head"
          onClick={() => setPageSec({ global: !globalOpen })}
          title="点击展开或收起全局样式"
        >
          <span>
            <span className="sec-caret"><Icon name={globalOpen ? 'chevronDown' : 'chevronRight'} size={12} /></span>
            全局样式
          </span>
          <HelpButton
            title="全局样式"
            content={'给整个网页的 body 补任意 CSS 属性，和元素的属性面板同一种用法：\n\n· 左侧写属性名（如 letter-spacing），右侧写值（如 2px）。\n· 属性名有常用项下拉建议，也可以自由输入。\n· 留空的值不会输出；点 × 删除该属性。\n\n这些属性和 body 设置一起并进同一条 body 规则，画布和导出的网页都生效。'}
          />
        </div>
        <Collapse open={globalOpen}>
          <div className="inspector-sec-body">
            {extraEntries.length === 0 && (
              <div className="hint" style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
                还没有额外属性。body 设置不够用时（例如背景图、字距），点下面「添加属性」。
              </div>
            )}
            {extraEntries.map(([k, v]) => (
              <PagePropRow
                key={k}
                label={getSchemaItem(kebabToCamel(k))?.label ?? k}
                cssKey={k}
                value={String(v ?? '')}
                onChange={(nv) => setExtra(k, nv)}
                onFocusStart={() => beginStyleEdit()}
                onFocusEnd={() => endStyleEdit()}
                onRemove={() => removeExtra(k)}
                sideGet={(side) => String((bodyExtra ?? {})[side] ?? '')}
                sideSet={(side, sv) => setExtra(side, sv)}
              />
            ))}
            <AddPropertyMenu
              type={'div' as ElementType}
              elementStyle={{}}
              visibleKeys={visibleCamelKeys}
              onAdd={(k) => addBodyProp(k)}
            />
          </div>
        </Collapse>
      </div>

      {legacyCss !== '' && (
        <div className="page-legacy-css-hint">
          <span>此工程来自旧版本，含有「高级 CSS」内容（仍在导出时生效，这里不再提供编辑）。</span>
          <button
            className="btn-mini"
            title="清空旧版高级 CSS（清空后导出不再包含它）"
            onClick={() => { beginStyleEdit(); useScene.getState().setGlobalCss(''); endStyleEdit(); }}
          >清空</button>
        </div>
      )}

    </>
  );
}

// ============ 页面属性卡片（与元素 CSS 属性行同一套视觉 / 编辑器） ============
// 只绑定「值 + 写回」，不碰元素 / 断点，所以能同时服务 body 常用项与任意全局 CSS。
function PagePropRow(props: {
  label: string;
  /** bodyExtra 里存的 kebab CSS 名 */
  cssKey: string;
  /** 可选：元素 SCHEMA 的 camelCase key，用来决定卡片形态 */
  schemaKey?: string;
  value: string;
  onChange: (v: string) => void;
  onFocusStart: () => void;
  onFocusEnd: () => void;
  onRemove: () => void;
  /** 四向属性（padding / margin）的分边读写；不传则退化成简写文本框 */
  sideGet?: (cssSide: string) => string;
  sideSet?: (cssSide: string, v: string) => void;
}) {
  const schema = getSchemaItem(props.schemaKey ?? kebabToCamel(props.cssKey));
  const input = schema?.input ?? 'text';
  const unit = schema?.unit;
  const value = props.value ?? '';
  const canSides = Boolean(schema?.sides && props.sideGet && props.sideSet);

  return (
    <div className="prop-row page-prop-row" data-cat={schema?.category ?? '其他'}>
      <div className="prop-row-header">
        <span>
          {props.label}
          {schema?.help && <HelpButton title={schema.help.title} content={schema.help.content} />}
        </span>
        <button className="prop-remove" title="删除此属性" onClick={props.onRemove}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="prop-row-body">
        {input === 'color' ? (
          <ColorField
            value={value}
            fallback="#ffffff"
            inputClassName="page-quick-input"
            onInputFocus={props.onFocusStart}
            onChange={props.onChange}
            onInputBlur={props.onFocusEnd}
            onModalOpen={props.onFocusStart}
            onModalClose={props.onFocusEnd}
          />
        ) : input === 'number' && unit ? (
          <PageNumUnit
            value={value}
            unit={unit}
            allowAuto={schema?.allowAuto}
            onChange={props.onChange}
            onFocusStart={props.onFocusStart}
            onFocusEnd={props.onFocusEnd}
          />
        ) : input === 'select' && schema?.options ? (
          <select
            className="page-quick-input"
            value={value}
            onChange={(e) => props.onChange(e.target.value)}
            onFocus={props.onFocusStart}
            onBlur={props.onFocusEnd}
          >
            <option value="">默认</option>
            {schema.options.map((o) => (
              <option key={o} value={o}>
                {schema.optionLabels?.[o] ? `${o} · ${schema.optionLabels[o]}` : o}
              </option>
            ))}
          </select>
        ) : canSides && schema?.sides ? (
          <PageBox4
            sides={schema.sides.map((s) => ({ css: camelToKebab(s.key), label: s.label }))}
            get={props.sideGet!}
            set={props.sideSet!}
            unit={unit ?? 'px'}
            onFocusStart={props.onFocusStart}
            onFocusEnd={props.onFocusEnd}
          />
        ) : (
          <input
            className="page-quick-input"
            value={value}
            placeholder={schema?.placeholder ?? '留空 = 不设置'}
            spellCheck={false}
            onFocus={props.onFocusStart}
            onChange={(e) => props.onChange(e.target.value)}
            onBlur={props.onFocusEnd}
          />
        )}
      </div>
    </div>
  );
}

/** 数字 + 单位（页面版）：解析 / 拼接规则与元素面板的 NumberUnitInput 一致 */
function PageNumUnit(props: {
  value: string;
  unit: string;
  allowAuto?: boolean;
  onChange: (v: string) => void;
  onFocusStart: () => void;
  onFocusEnd: () => void;
}) {
  const parse = (v: string) => {
    const s = (v || '').trim();
    if (!s) return { num: '', unit: props.unit };
    if (/^auto$/i.test(s)) return { num: 'auto', unit: 'auto' };
    const m = /^(-?[0-9]*\.?[0-9]+)\s*([a-z%]+)?$/i.exec(s);
    if (m && m[1] !== '') return { num: m[1], unit: (m[2] ?? '').toLowerCase() || props.unit };
    return { num: s, unit: 'custom' };
  };
  const p = parse(props.value);
  const units = ['px', '%', 'em', 'rem', 'vw', 'vh', ...(props.allowAuto ? ['auto'] : []), 'custom'];
  const compose = (num: string, unit: string) => {
    if (unit === 'auto') return 'auto';
    if (unit === 'custom') return num;
    if (num.trim() === '') return '';
    return num + unit;
  };
  return (
    <div className="num-unit-row">
      <input
        type="text"
        className="num-unit-num"
        value={p.num}
        placeholder="只填数字"
        disabled={p.unit === 'auto'}
        onFocus={props.onFocusStart}
        onChange={(e) => props.onChange(compose(e.target.value, p.unit))}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onBlur={props.onFocusEnd}
      />
      <select
        className="unit-select"
        value={p.unit}
        onChange={(e) => props.onChange(compose(p.num, e.target.value))}
        onFocus={props.onFocusStart}
        onBlur={props.onFocusEnd}
      >
        {units.map((u) => (
          <option key={u} value={u}>{u === 'custom' ? '自定义' : u}</option>
        ))}
      </select>
    </div>
  );
}

/** 四向数值（页面版 padding / margin）：每个方向一个框 + 共享单位 */
function PageBox4(props: {
  sides: { css: string; label: string }[];
  get: (cssSide: string) => string;
  set: (cssSide: string, v: string) => void;
  unit: string;
  onFocusStart: () => void;
  onFocusEnd: () => void;
}) {
  const [u, setU] = useState(props.unit || 'px');
  return (
    <div className="box4">
      {props.sides.map((s) => (
        <div className="box4-cell" key={s.css}>
          <span className="box4-label">{s.label}</span>
          <input
            type="text"
            value={props.get(s.css)}
            placeholder="—"
            onFocus={props.onFocusStart}
            onChange={(e) => props.set(s.css, e.target.value === '' ? '' : applyUnit(e.target.value, u))}
            onBlur={props.onFocusEnd}
          />
        </div>
      ))}
      <div className="box4-unit-row">
        <span className="box4-label">单位</span>
        <select className="unit-select" value={u} onChange={(e) => setU(e.target.value)} title="没有写单位的数字自动补这个单位">
          {['px', '%', 'em', 'rem', 'vw', 'vh'].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
    </div>
  );
}

// ============ 元素页签内容（选中元素的属性编辑区） ============
// 画布当前宽度（与工具栏同一状态；通过事件与 localStorage 同步）
function useCanvasWidth(): string {
  const [w, setW] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem('bc-canvas-width') || '"auto"') as string; } catch { return 'auto'; }
  });
  useEffect(() => {
    const on = (e: Event) => setW(String((e as CustomEvent).detail ?? 'auto'));
    window.addEventListener('bc-canvas-width-changed', on);
    return () => window.removeEventListener('bc-canvas-width-changed', on);
  }, []);
  return w || 'auto';
}

function ElementPropsBody(props: { selected: SceneElement; justAddedKey: string | null; onJustAdded: (k: string | null) => void }) {
  const { selected, justAddedKey, onJustAdded } = props;
  const updateStyle = useScene((s) => s.updateStyle);
  const setText = useScene((s) => s.setText);
  // 「显示 <br>」开关：与画布就地编辑框共用同一份状态（见 lib/showBr.ts）
  const [showBr, setShowBr] = useShowBr();
  const addVisibleProp = useScene((s) => s.addVisibleProp);
  const removeVisibleProp = useScene((s) => s.removeVisibleProp);
  const updatePseudoStyleStore = useScene((s) => s.updatePseudoStyle);
  const removePseudoStyleStore = useScene((s) => s.removePseudoStyle);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);
  const clearBreakpointOverride = useScene((s) => s.clearBreakpointOverride);
  const setActiveBreakpoint = useScene((s) => s.setActiveBreakpoint);
  const canvasWidth = useCanvasWidth();
  const canvasAuto = !canvasWidth || canvasWidth === 'auto';
  // 设备高亮按**画布实际宽度**判断：自适应时窗口变窄，会自动切到平板 / 手机
  const liveDevice = useEffectiveDevice(canvasWidth);
  // 自适应模式下，编辑断点跟着实际宽度走（否则在 375px 画布上还在改电脑端样式）
  useEffect(() => {
    if (canvasAuto && activeBreakpoint !== liveDevice) setActiveBreakpoint(liveDevice);
  }, [canvasAuto, liveDevice, activeBreakpoint, setActiveBreakpoint]);
  const elementId = selected.id;
  const elementType = selected.type;
  // v0.4.3：选中项是不是表格（或表格里的单元格/行）—— 是则给出「打开表格编辑器」入口
  // （用 getState 取根：本组件由父级随 scene 变化重渲染，无需再订阅一次）
  const tableOwner = findTableAncestor(useScene.getState().scene.root, elementId);
  // 是否已有可挂 CSS 规则的"名字"（类名 / 关系选择器 / ID）—— 没有名字则伪类导出后不生效
  const hasSelector = Boolean(
    (selected.attrs?.relSelector ?? '').trim() ||
    (selected.attrs?.className ?? '').trim() ||
    (selected.attrs?.id ?? '').trim()
  );

  const hasTabletOverride = Boolean(selected.responsive?.tablet && Object.keys(selected.responsive.tablet).length > 0);
  const hasMobileOverride = Boolean(selected.responsive?.mobile && Object.keys(selected.responsive.mobile).length > 0);
  const hasCurBpOverride = Boolean(
    activeBreakpoint !== 'desktop' &&
    selected.responsive?.[activeBreakpoint] &&
    Object.keys(selected.responsive[activeBreakpoint]!).length > 0
  );

  const isCurrentHidden = Boolean(activeBreakpoint !== 'desktop' && selected.responsive?.[activeBreakpoint]?.display === 'none');
  const toggleHideOnDevice = () => {
    updateStyle(elementId, { display: isCurrentHidden ? undefined : 'none' });
  };
  const toggleColumnLayout = () => {
    updateStyle(elementId, { display: 'flex', flexDirection: 'column' });
  };
  const toggleFullWidth = () => {
    updateStyle(elementId, { width: '100%', boxSizing: 'border-box' });
  };

  // ✨ 整页自动适配：按当前断点批量重排（只算建议 → 确认 → 一次性写入，一条撤销可回退）
  const autoFitPage = async () => {
    if (activeBreakpoint === 'desktop') return;
    const bp = activeBreakpoint as 'tablet' | 'mobile';
    const bpName = bp === 'mobile' ? '手机' : '平板';
    const root = useScene.getState().scene.root;
    const fixes = planResponsiveFixes(root, bp);
    if (fixes.length === 0) {
      void appAlert(`这一页在「${bpName}」断点下已经很合适了 —— 没有需要自动调整的地方。`, '无需调整');
      return;
    }
    const preview = fixes.slice(0, 6).map((f) => `· ${f.label}：${f.reasons[0]}`).join('\n');
    const more = fixes.length > 6 ? `\n…还有 ${fixes.length - 6} 个元素` : '';
    const ok = await appConfirm({
      title: `整页自动适配（${bpName}）`,
      body: `将为「${bpName}」断点自动调整 ${fixes.length} 个元素：\n\n${preview}${more}\n\n` +
        `· 只影响当前断点的样式，电脑端完全不受影响\n` +
        `· 全部改动算一步，Ctrl+Z 可整体撤销\n\n继续？`,
      okText: '开始调整'
    });
    if (!ok) return;
    beginStyleEdit();
    for (const f of fixes) updateStyle(f.id, f.patch);
    endStyleEdit();
  };

  // 折叠状态（可独立展开/收起）- 同类名/同选择器元素共享折叠记忆
  const secStorageKey = (() => {
    const rel = (selected.attrs?.relSelector ?? '').trim();
    if (rel) return 'bc-inspector-sec-rel-' + rel.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cls = (selected.attrs?.className ?? '').trim();
    if (cls) return 'bc-inspector-sec-cls-' + cls.split(/\s+/)[0];
    return 'bc-inspector-sec-id-' + elementId;
  })();

  // 面板板块开合：**默认只展开「选择器与标识」**（新插入的元素先让人看到"叫什么名字"这件事），
  // 其余板块（布局 / CSS 属性 / 交互状态）默认折叠；用户手动开合后按元素/选择器记忆。
  // 不提供"默认展开哪个板块"的设置项 —— 就这一套默认值。
  //
  // v0.4.4：记忆改存**工程文件**（scene.uiState.inspectorSec）—— 用户要求这类
  // "每个元素的开关"跟着项目走，不再写 localStorage。
  // 一次性迁移：工程里还没有、而 localStorage 里有旧记录时，读过来并写进工程。
  const normalizeSec = (p: any) => ({
    identity: p?.identity ?? true,
    layout: p?.layout ?? false,
    css: p?.css ?? false,
    pseudo: p?.pseudo ?? false
  });
  const [secOpen, setSecOpen] = useState<{ identity: boolean; layout: boolean; css: boolean; pseudo: boolean }>(() => {
    const fromScene = useScene.getState().scene.uiState?.inspectorSec?.[secStorageKey];
    if (fromScene) return normalizeSec(fromScene);
    for (const k of [secStorageKey, 'bc-inspector-sec-id-' + elementId, 'bc-inspector-sec-' + elementId]) {
      try {
        const saved = localStorage.getItem(k);
        if (saved) {
          const v = normalizeSec(JSON.parse(saved));
          queueMicrotask(() => useScene.getState().setInspectorSec(secStorageKey, v));
          return v;
        }
      } catch { /* 忽略 */ }
    }
    return { identity: true, layout: false, css: false, pseudo: false };
  });

  // 折叠状态变更 → 写进工程文件（scene.uiState）
  // v0.4.4 修：**切换选中元素时不能把上一个元素的开关状态写到新元素名下**。
  // 以前两个 effect 的执行顺序是「先保存（用新 key + 旧 state）→ 再读取」，于是永远读到刚写进去的旧状态，
  // 表现就是"换了个元素，右侧面板还是上一个元素的开合状态"。
  // 这里用 loadedSecKey 记录"当前 state 属于哪个 key"，只在 key 一致时才保存。
  const loadedSecKey = useRef(secStorageKey);
  useEffect(() => {
    if (loadedSecKey.current !== secStorageKey) return;
    useScene.getState().setInspectorSec(secStorageKey, secOpen);
  }, [secOpen, secStorageKey]);

  // 元素切换 / 身份变化时，从工程文件恢复该元素的折叠状态；
  // 并做一次性迁移：元素从「未命名（按 id 记录）」到「有了类名/选择器（按选择器记录）」时，
  // 把原记录搬过去 —— 展开习惯跟着元素走，不会因为起了个名字就全收回去了。
  useEffect(() => {
    const readFrom = (key: string) => {
      const fromScene = useScene.getState().scene.uiState?.inspectorSec?.[key];
      if (fromScene) return normalizeSec(fromScene);
      try {
        const saved = localStorage.getItem(key);
        if (saved) return normalizeSec(JSON.parse(saved));
      } catch { /* 忽略 */ }
      return null;
    };
    let v = readFrom(secStorageKey);
    if (!v && secStorageKey.startsWith('bc-inspector-sec-cls-')) {
      // 只有"获得类名"才迁移（关系选择器/ID 是另一种身份，习惯未必通用）
      for (const oldKey of ['bc-inspector-sec-id-' + elementId, 'bc-inspector-sec-' + elementId]) {
        const old = readFrom(oldKey);
        if (old) { v = old; break; }
      }
    }
    if (v) setSecOpen(v);
    else setSecOpen({ identity: true, layout: false, css: false, pseudo: false });
    loadedSecKey.current = secStorageKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secStorageKey, elementId]);

  // 「快捷助手 → 是否显示到下方 CSS 属性」开关
  // v0.4.4：改为**全局统一**（所有元素共用一份，不再按元素/选择器单独记忆），
  // 「设置 → 编辑器与画布」里是同一个开关，两边通过事件即时同步。
  const [showHelperInCss, setShowHelperInCss] = useState<boolean>(() => {
    try { return localStorage.getItem(HELPER_IN_CSS_KEY) !== '0'; } catch { return true; }
  });
  useEffect(() => {
    const sync = () => {
      try { setShowHelperInCss(localStorage.getItem(HELPER_IN_CSS_KEY) !== '0'); } catch { /* ignore */ }
    };
    window.addEventListener('bc:helper-in-css-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('bc:helper-in-css-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const changeShowHelperInCss = (v: boolean) => {
    setShowHelperInCss(v);
    try { localStorage.setItem(HELPER_IN_CSS_KEY, v ? '1' : '0'); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('bc:helper-in-css-changed'));
  };

  // 伪类编辑区：:hover / :active / :focus / :link
  const PSEUDO_CLASSES = ['hover', 'active', 'focus', 'link'] as const;
  type PseudoClass = typeof PSEUDO_CLASSES[number];
  const pseudoStyles = selected.pseudoStyles ?? {};

  // 智能默认选中：若当前元素已有 :hover 覆盖，自动切到 :hover 标签，避免用户误以为 hover 丢失
  const [activePseudo, setActivePseudo] = useState<PseudoClass | null>(() => {
    if (pseudoStyles.hover && Object.keys(pseudoStyles.hover).length > 0) return 'hover';
    if (pseudoStyles.active && Object.keys(pseudoStyles.active).length > 0) return 'active';
    if (pseudoStyles.focus && Object.keys(pseudoStyles.focus).length > 0) return 'focus';
    if (pseudoStyles.link && Object.keys(pseudoStyles.link).length > 0) return 'link';
    return null;
  });

  // 切换元素时，自动定位到该元素已有的第一个伪类状态（若有），否则回到默认状态
  useEffect(() => {
    const ps = selected.pseudoStyles ?? {};
    if (ps.hover && Object.keys(ps.hover).length > 0) {
      setActivePseudo('hover');
    } else if (ps.active && Object.keys(ps.active).length > 0) {
      setActivePseudo('active');
    } else if (ps.focus && Object.keys(ps.focus).length > 0) {
      setActivePseudo('focus');
    } else if (ps.link && Object.keys(ps.link).length > 0) {
      setActivePseudo('link');
    } else {
      setActivePseudo(null);
    }
  }, [elementId]);

  // 更新伪类样式的辅助函数（直接通过 store 更新，自动联动同类名/同选择器元素）
  const updatePseudoStyle = (pseudo: PseudoClass | null, patch: Record<string, string>) => {
    if (pseudo === null) {
      updateStyle(elementId, patch);
    } else {
      updatePseudoStyleStore(elementId, pseudo, patch);
    }
  };

  // v0.4.4：把"正在编辑的伪类"同步给画布做实时预览。
  // 无类名元素走内联样式，:hover 规则永远被内联压住 → 以前画布上完全看不出效果。
  const setPreviewPseudo = useScene((s) => s.setPreviewPseudo);
  useEffect(() => {
    setPreviewPseudo(activePseudo);
    return () => setPreviewPseudo(null);
  }, [activePseudo, elementId, setPreviewPseudo]);

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
  // 4. 「背景颜色」行：渐变（background-image）也算已设置，走同一个入口切换纯色/渐变；
  //    但"文字渐变"（-webkit-text-fill-color: transparent）由快捷助手代管，不在此重复出现
  // 5. 快捷助手代管的属性（布局 / 文字渐变）：当「是否显示到下方 CSS 属性」关闭时隐藏
  //    （用户从 + 添加属性 显式加过的除外，避免误藏用户手动加的属性）
  // 6. 文字渐变元素：其渐变本体就是 background-image —— 下方不再重复出现
  //    「背景颜色 / 背景图片」行（显式加过的除外），避免"改文字渐变却跑来改背景"的困惑
  const visibleSchema: typeof SCHEMA = [];
  const visiblePropList = selected.visibleProps ?? [];
  const allSchema = [...SCHEMA, ...getPluginProperties()];
  const isTextGradientEl = selected.style.WebkitTextFillColor === 'transparent';
  // 「过渡动画 (transition)」由「交互状态 (伪类)」区域的滑块统一管理，
  // 不再在下方「CSS 样式属性」里重复出现一条（用户若从 + 添加属性 显式加过，仍然显示）
  const PSEUDO_MANAGED_KEYS = new Set(['transition']);
  for (const s of allSchema) {
    // v0.4.4：显式添加过的属性即使"当前条件不满足"也要渲染出来（行上标「不生效」），
    // 否则 left/right/top/bottom 在 position:static 时加进来会直接消失（用户反馈）。
    if (!isApplicable(s, selected.type) && !visiblePropList.includes(s.key)) continue;
    const extraBg = s.key === 'backgroundColor' && isGradient(selected.style.backgroundImage) && !isTextGradientEl;
    const byValue = hasStyleValue(selected.style, s as any) || extraBg;
    const helperHidden =
      !showHelperInCss && HELPER_MANAGED_KEYS.has(s.key) && !visiblePropList.includes(s.key);
    const pseudoHidden =
      PSEUDO_MANAGED_KEYS.has(s.key) && !visiblePropList.includes(s.key);
    const textGradHidden =
      isTextGradientEl &&
      (s.key === 'backgroundColor' || s.key === 'backgroundImage') &&
      !visiblePropList.includes(s.key);
    if (
      DEFAULT_VISIBLE_PROPS.includes(s.key) ||
      visiblePropList.includes(s.key) ||
      (byValue && !helperHidden && !pseudoHidden && !textGradHidden)
    ) {
      visibleSchema.push(s as any);
    }
  }

  // ============ "添加属性"回调 ============
  const onAddProperty = (key: string, value?: string) => {
    const item = getSchemaItem(key);
    if (!item) return;
    const patch: Record<string, string> = {};
    if (value !== undefined) {
      // 来自"搜索属性值 → 一键插入"：属性名 + 属性值一起写入
      patch[item.key] = value;
    } else if ((item.input === 'box4' || item.input === 'trbl') && item.sides) {
      for (const s of item.sides) patch[s.key] = '';
    } else if (item.input === 'number' && item.unit) {
      patch[item.key] = '0' + item.unit;
    } else {
      patch[item.key] = '';
    }
    updateStyle(elementId, patch);
    addVisibleProp(elementId, key);
    onJustAdded(key);
  };

  // ============ 中键搜索：定位到某条 CSS 属性（橙色高亮）============
  // 画布上对元素按中键 → 敲属性名 → Enter → 这里展开「CSS 样式属性」、确保该行存在、滚动并闪烁高亮。
  const [flashKey, setFlashKey] = useState<string | null>(null);
  useEffect(() => {
    const apply = (req: PropFocusRequest) => {
      const key = req.key;
      if (!key) return;
      // add 默认 true（老行为）；中键搜索在"未添加"时按 Enter 会传 false —— 只提示、不偷偷加
      const shouldAdd = req.add !== false;
      setSecOpen((p) => ({ ...p, css: true }));
      if (shouldAdd) addVisibleProp(elementId, key);
      setFlashKey(key);
      // 滚动到该行：**不用 scrollIntoView('center')** —— 行在列表末尾时容器已经滚不动，
      // 只能贴底，容易被面板底部挡住（用户反馈"末尾元素定位不到"）。
      // 这里按"可视区 + 28px 内边距"校正，并且行还没渲染出来时自动重试。
      const scrollToRow = (attempt = 0) => {
        const row = document.querySelector(`[data-prop-key="${CSS.escape(key)}"]`) as HTMLElement | null;
        if (!row) {
          if (attempt < 6) window.setTimeout(() => scrollToRow(attempt + 1), 90);
          return;
        }
        // 右侧是嵌套滚动：`.tab-body` 与 `.panel` 都可能滚，真正能滚的是"内容超出"的那一层
        const findScroller = (start: HTMLElement | null): HTMLElement | null => {
          let cur = start?.parentElement ?? null;
          while (cur) {
            const oy = getComputedStyle(cur).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight + 1) return cur;
            cur = cur.parentElement;
          }
          return null;
        };
        const scroller = findScroller(row);
        if (!scroller) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
        const sr = scroller.getBoundingClientRect();
        const rr = row.getBoundingClientRect();
        const pad = 28;
        if (rr.top < sr.top + pad) {
          scroller.scrollBy({ top: rr.top - sr.top - pad, behavior: 'smooth' });
        } else if (rr.bottom > sr.bottom - pad) {
          scroller.scrollBy({ top: rr.bottom - sr.bottom + pad, behavior: 'smooth' });
        }
        // 折叠区展开有 0.3s 动画，首帧量到的位置会偏 —— 稍后再校验一次，不在可视区就继续校正
        if (attempt < 4) {
          window.setTimeout(() => {
            const r2 = document.querySelector(`[data-prop-key="${CSS.escape(key)}"]`) as HTMLElement | null;
            if (!r2) return;
            const s2 = scroller.getBoundingClientRect();
            const b2 = r2.getBoundingClientRect();
            if (b2.top < s2.top + 4 || b2.bottom > s2.bottom - 4) scrollToRow(attempt + 1);
          }, 280);
        }
      };
      window.setTimeout(() => scrollToRow(), 90);
      window.setTimeout(() => setFlashKey(null), 2200);
    };
    // 挂载瞬间先消费缓冲：从「页面 / 类名 / 图层」切过来的请求，事件早就派发完了
    const first = takePendingPropFocus();
    if (first) apply(first);
    return subscribePropFocus((req) => { takePendingPropFocus(); apply(req); });
  }, [elementId, addVisibleProp]);

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
  const isNamed = hasRel || hasCls || hasId;
  const stylePropCount = Object.keys(selected.style || {}).filter((k) => selected.style[k] !== undefined && selected.style[k] !== '').length;
  // 仅在无任何类名、无关系选择器、无ID且有自定义样式时，才标注为未命名的行内样式
  const hasInlineStyle = !isNamed && stylePropCount > 0;

  return (
    <>
      {/* 顶部元素信息栏（自适应展示 标签 + 关系选择器 / 类名 / ID / 独立样式） */}
      <div className="panel-title-header">
        <div className="panel-title-left">
          <span className="panel-title-prefix">属性 ·</span>
          <span className="panel-title-tag">&lt;{elementType}&gt;</span>
        </div>
        <div className="panel-title-badges">
          {hasRel && <span className="panel-title-badge is-rel" title={`关系选择器: ${relText}`}><Icon name="bolt" size={11} /> {relText}</span>}
          {hasCls && <span className="panel-title-badge is-cls" title={`类名: .${clsText.split(/\s+/).join(' .')}`}>.{clsText.split(/\s+/).join(' .')}</span>}
          {hasId && <span className="panel-title-badge is-id" title={`ID: #${idText}`}>#{idText}</span>}
          {hasInlineStyle && (
            <span className="panel-title-badge is-inline" title={`未设置类名或选择器，当前包含 ${stylePropCount} 项独立样式`}>
              独立样式
            </span>
          )}
        </div>
      </div>

      {/* 未命名的强提醒：没有类名 / ID / 关系选择器时，伪类样式导出后必然失效。
          这里做闪烁提示，尽量在用户"白干一场"之前拦下来。 */}
      {hasInlineStyle && (
        <div className="cls-warn-flash" role="alert">
          <span className="cls-warn-ico"><Icon name="warning" size={18} /></span>
          <div className="cls-warn-body">
            <div className="cls-warn-title">样式还没有名字</div>
            <div className="cls-warn-desc">
              这 {stylePropCount} 项样式会以<b>行内样式</b>导出；:hover / :active / :focus 这类伪类样式
              必须有「类名 / ID / 关系选择器」才能在导出后生效。
            </div>
            <div className="cls-warn-actions">
              <button
                className="btn-primary btn-mini"
                onClick={() => setSecOpen((p) => ({ ...p, identity: true }))}
              >起个名字</button>
              <button
                className="btn-secondary btn-mini"
                onClick={() => window.dispatchEvent(new CustomEvent('bc:open-class'))}
                title="到「类名 · ID 总览」里批量给未命名元素起名"
              >打开类名总览</button>
            </div>
          </div>
        </div>
      )}

      {/* 响应式断点条：三个设备分段（高亮按画布**实际宽度**判断）+ 右侧一枚小的「自适应」按钮（不常亮） */}
      <div className="inspector-bp-bar">
        <div className="inspector-bp-tabs">
          <button
            className={'bp-tab-btn' + (liveDevice === 'desktop' ? ' active' : '')}
            onClick={() => requestDevice('desktop')}
            title="电脑端基础样式（全局基准，平板/手机自动继承）。点此画布宽度切为 1920px"
          >
            <Icon name="laptop" size={14} /><span>电脑</span>
          </button>
          <button
            className={'bp-tab-btn' + (liveDevice === 'tablet' ? ' active' : '') + (hasTabletOverride ? ' has-override' : '')}
            onClick={() => requestDevice('tablet')}
            title="平板端 ≤768px 样式定制。点此画布宽度同步变为 768px，所见即所得"
          >
            <Icon name="tablet" size={14} /><span>平板</span>
            {hasTabletOverride && <span className="bp-dot" title="已有平板端定制覆盖" />}
          </button>
          <button
            className={'bp-tab-btn' + (liveDevice === 'mobile' ? ' active' : '') + (hasMobileOverride ? ' has-override' : '')}
            onClick={() => requestDevice('mobile')}
            title="手机端 ≤480px 样式定制。点此画布宽度同步变为 375px，所见即所得"
          >
            <Icon name="phone" size={14} /><span>手机</span>
            {hasMobileOverride && <span className="bp-dot" title="已有手机端定制覆盖" />}
          </button>
        </div>
        <button
          className={'bp-auto-btn' + (canvasAuto ? ' is-auto' : '')}
          onClick={() => window.dispatchEvent(new CustomEvent('bc:set-device', { detail: 'auto' }))}
          title="自适应宽度：画布铺满编辑区。设备按画布实际宽度自动判断，这个按钮不会常亮"
        >
          <Icon name="responsive" size={14} />
        </button>
      </div>

      {/* 移动端快捷操作与覆盖说明条 */}
      {activeBreakpoint !== 'desktop' && (
        <div className="inspector-bp-banner">
          <div className="inspector-bp-banner-head">
            <span>
              正在定制 <b>{activeBreakpoint === 'mobile' ? '手机端 (≤480px)' : '平板端 (≤768px)'}</b> 样式覆盖
            </span>
            {hasCurBpOverride && (
              <button
                className="btn-mini btn-ghost bp-clear-btn"
                onClick={() => clearBreakpointOverride(elementId, undefined, activeBreakpoint)}
                 title="清空当前设备上的所有定制覆盖，完全恢复电脑端继承"
              >
                <Icon name="undo" size={12} /> 还原继承
              </button>
            )}
          </div>
          <div className="inspector-bp-actions">
            <button
              className={'btn-mini bp-quick-btn' + (isCurrentHidden ? ' active' : '')}
              onClick={toggleHideOnDevice}
              title={isCurrentHidden ? '取消隐藏，在当前设备重新显示' : '在当前设备上隐藏此元素 (display: none)'}
            >
              {isCurrentHidden ? <><Icon name="eye" size={13} /> 取消隐藏</> : <><Icon name="block" size={13} /> 在此设备隐藏</>}
            </button>
            {CONTAINER_TAGS.has(elementType) && (
              <button
                className="btn-mini bp-quick-btn"
                onClick={toggleColumnLayout}
                title="将容器在当前设备转为上下单列竖排 (适合手机单手阅读)"
              >
                <Icon name="refresh" size={13} /> 切竖排
              </button>
            )}
            <button
              className="btn-mini bp-quick-btn"
              onClick={toggleFullWidth}
              title="将宽度设为 100% 撑满屏幕 (手机端卡片与按钮常用)"
            >
              <Icon name="responsive" size={13} /> 撑满全宽
            </button>
            <button
              className="btn-mini bp-quick-btn bp-autofit-btn"
              onClick={autoFitPage}
              title={`一键把整页按「${activeBreakpoint === 'mobile' ? '手机' : '平板'}」规则重排：过宽元素改自适应、横排容器改竖排、多列网格改单列、内边距与字号适度收紧。只影响当前断点，可整体撤销。`}
            >
              <Icon name="sparkle" size={13} /> 整页自动适配
            </button>
          </div>
        </div>
      )}

      {/* 0. 文案内容（针对文本元素）——置顶最上方第一位，直接输入 */}
      {TEXT_TAGS.has(elementType) && (
        <div className="field" style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
            文案内容
          </label>
          <textarea
            className="inspector-text-textarea"
            value={selected.text ?? ''}
            placeholder="在此直接输入文本内容（画布也将同步更新）…换行会导出成 <br>"
            rows={5}
            onChange={(e) => setText(elementId, e.target.value)}
          />
          <button
            className={'bc-br-inspector-toggle' + (showBr ? ' active' : '')}
            onClick={() => setShowBr(!showBr)}
            title="开启后，画布的就地编辑框里会用淡灰色标出换行位置（<br>）；换行本来就会自动生成 <br>"
          >
            {showBr ? <><Icon name="check" size={12} /> 已显示 {'<br>'} 换行标记</> : '显示 <br> 换行标记'}
          </button>
        </div>
      )}

      {/* 0.5 表格元素：直达专用表格编辑器（v0.4.3）
              —— 表格的结构（加行/列、合并拆分、表头表尾）在通用属性面板里做不了，
              所以给一张表一个显眼的入口，直接进「表格编辑器」页面。 */}
      {tableOwner && (
        <div className="tbl-entry">
          <div className="tbl-entry-text">
            <b><Icon name="grid" size={14} /> 这是表格元素</b>
            <span>加行/列、合并拆分单元格、表头表尾与整套样式，都在表格编辑器里一气呵成。</span>
          </div>
          <button
            className="btn-primary btn-mini"
            onClick={() => window.dispatchEvent(new CustomEvent('bc:open-table-editor', { detail: tableOwner.id }))}
          >打开表格编辑器</button>
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
            <span className="sec-caret"><Icon name={secOpen.identity ? 'chevronDown' : 'chevronRight'} size={12} /></span>
            选择器与标识
          </span>
          <HelpButton
            title="选择器与标识"
            content={'管理元素的命名与匹配机制：\n\n· 类名 Class：给元素命名，同名元素批量共享样式。\n· 关系选择器：无需起名，根据在父容器中的相对位置自动生成规则（如 .hero > h1）。\n· ID：页面内唯一的元素标识。'}
          />
        </div>
        <Collapse open={secOpen.identity}>
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
        </Collapse>
      </div>

      {/* 2. 快捷助手折叠区（Flex & Grid + 文字渐变 + 未来更多） */}
      <div className="inspector-sec">
        <div
          className="inspector-sec-head"
          onClick={() => setSecOpen((p) => ({ ...p, layout: !p.layout }))}
          title="点击展开或收起快捷助手"
        >
          <span>
            <span className="sec-caret"><Icon name={secOpen.layout ? 'chevronDown' : 'chevronRight'} size={12} /></span>
            快捷助手
          </span>
          <span className="prop-scope">排版 / 渐变</span>
        </div>
        <Collapse open={secOpen.layout}>
          <div className="inspector-sec-body">
            <QuickHelper
              elementId={elementId}
              elementType={elementType}
              showInCss={showHelperInCss}
              onShowInCssChange={changeShowHelperInCss}
            />
          </div>
        </Collapse>
      </div>

      {/* 3. 伪类状态区 */}
      <div className="inspector-sec">
        <div
          className="inspector-sec-head"
          onClick={() => setSecOpen((p: any) => ({ ...p, pseudo: !p.pseudo }))}
          title="编辑 :hover / :active / :focus / :link 状态下的样式与动效"
        >
          <span>
            <span className="sec-caret"><Icon name={secOpen.pseudo ? 'chevronDown' : 'chevronRight'} size={12} /></span>
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
              '3. 在下方开启「0.3s 平滑过渡」，鼠标悬停时颜色就会自然渐变。'
            }
          />
        </div>
        <Collapse open={secOpen.pseudo}>
          <div className="inspector-sec-body">
            <div className="pseudo-tabs">
              {PSEUDO_CLASSES.map((pc) => {
                const count = Object.keys(pseudoStyles[pc] ?? {}).length;
                return (
                  <button
                    key={pc}
                    className={'pseudo-tab' + (activePseudo === pc ? ' active' : '') + (count > 0 ? ' has-override' : '')}
                    onClick={() => setActivePseudo(pc === activePseudo ? null : pc)}
                    title={`编辑 :${pc} 状态下的外观${count > 0 ? `（已有 ${count} 项样式覆盖）` : ''}`}
                  >
                    :{pc} {pc === 'hover' ? '(悬停)' : pc === 'active' ? '(按下)' : pc === 'focus' ? '(聚焦)' : '(链接)'}
                    {count > 0 && <span className="pseudo-tab-dot" title={`已设置 ${count} 项覆盖`} />}
                  </button>
                );
              })}
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
                      {!hasSelector && (
                        <div className="pseudo-need-selector">
                          <span><Icon name="warning" size={15} /></span>
                          <div>
                            这个元素还没有<b>类名 / 关系选择器 / ID</b>。伪类样式需要挂在一个"名字"上，
                            没有名字的话<b>导出的网页里不会生效</b>（画布上能看到，导出后失效）。
                            <div className="pn-btn">
                              <button
                                className="btn-mini"
                                onClick={() => setSecOpen((p) => ({ ...p, identity: true }))}
                              >去上面「选择器与标识」起个名字</button>
                            </div>
                          </div>
                        </div>
                      )}
                      <PseudoFxPanel
                        pseudo={activePseudo}
                        currentStyle={currentStyle}
                        baseStyle={selected.style as Record<string, string | undefined>}
                        onApplyPreset={(patch) => {
                          beginStyleEdit();
                          // v0.4.4：覆盖式套用 —— 先清掉该伪类的全部旧覆盖，再写入新预制。
                          // 过去是合并写入，换一个预制时上一次的位移/阴影会残留叠加。
                          removePseudoStyle(activePseudo);
                          updatePseudoStyle(activePseudo, patch);
                          // 套用动效时自动补 0.3s ease 过渡：没有 transition，
                          // hover/active 的变化就是瞬间跳变（这也是历史上"画布上
                          // 没有过渡"的根因——滑块显示 0.30s 让人以为已经开启）。
                          if (!(selected.style as Record<string, string | undefined>).transition) {
                            updateStyle(elementId, { transition: 'all 0.30s ease' } as any);
                          }
                          endStyleEdit();
                        }}
                        onClearAll={() => removePseudoStyle(activePseudo)}
                        onPatch={(patch) => updatePseudoStyle(activePseudo, patch)}
                        onPatchBase={(patch) => updateStyle(elementId, patch as any)}
                        onDragStart={() => beginStyleEdit()}
                        onDragEnd={() => endStyleEdit()}
                      />
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
                          } else if (item.input === 'transform') {
                            patch[item.key] = 'translateY(-4px)';
                          } else if (item.input === 'shadow') {
                            patch[item.key] = '0 8px 24px rgba(0, 0, 0, 0.12)';
                          } else if (item.input === 'textShadow') {
                            patch[item.key] = '0 2px 4px rgba(0, 0, 0, 0.3)';
                          } else if (item.input === 'opacity') {
                            patch[item.key] = '0.8';
                          } else if (item.input === 'lineHeight') {
                            patch[item.key] = '1.6';
                          } else if (item.input === 'color') {
                            patch[item.key] = (selected.style as any)?.[item.key] || '#1e88e5';
                          } else if (item.input === 'select' && item.options && item.options.length > 0) {
                            patch[item.key] = item.options[0];
                          } else if (item.input === 'number') {
                            patch[item.key] = (selected.style as any)?.[item.key] || (item.unit ? '16' + item.unit : '16');
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
                                <LineHeightInput elementId={elementId} pseudo={activePseudo} />
                              )}
                              {item.input === 'font' && (
                                <FontFamilyInput elementId={elementId} pseudo={activePseudo} />
                              )}
                              {item.input === 'color' && (
                                <ColorPicker
                                  elementId={elementId}
                                  styleKey={key}
                                  fallback={item.placeholder}
                                  pseudo={activePseudo}
                                />
                              )}
                              {item.input === 'number' && item.unit && (
                                <NumberUnitInput
                                  elementId={elementId}
                                  schemaKey={key}
                                  unit={item.unit}
                                  allowAuto={item.allowAuto}
                                  pseudo={activePseudo}
                                />
                              )}
                              {item.input === 'number' && !item.unit && (
                                <input
                                  type="number"
                                  className="prop-input"
                                  value={v}
                                  onChange={(e) => onVal(e.target.value)}
                                />
                              )}
                              {item.input === 'select' && item.options && (
                                <select className="prop-select" value={v} onChange={(e) => onVal(e.target.value)}>
                                  {item.options.map((opt) => <option key={opt} value={opt}>{item.optionLabels?.[opt] ?? opt}</option>)}
                                </select>
                              )}
                              {(item.input === 'box4' || item.input === 'trbl') && (
                                <input className="prop-input" value={v} onChange={(e) => onVal(e.target.value)} placeholder={item.placeholder || '例：8px 16px'} />
                              )}
                              {item.input === 'text' && (
                                <input className="prop-input" value={v} onChange={(e) => onVal(e.target.value)} placeholder={item.placeholder} />
                              )}
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
        </Collapse>
      </div>

      {/* 4. CSS 样式属性折叠区 */}
      <div className="inspector-sec">
        <div
          className="inspector-sec-head"
          onClick={() => setSecOpen((p) => ({ ...p, css: !p.css }))}
          title="点击展开或收起 CSS 样式属性"
        >
          <span>
            <span className="sec-caret"><Icon name={secOpen.css ? 'chevronDown' : 'chevronRight'} size={12} /></span>
            CSS 样式属性
            {visibleSchema.length > 0 && <span className="sec-count">({visibleSchema.length})</span>}
          </span>
          <HelpButton
            title="CSS 样式属性"
            content={'点击「+ 添加属性」按需添加颜色、字体、边框、阴影等。\n· 点击右侧「?」可查看各属性详细用法，点击「×」可随时移除。'}
          />
        </div>
        <Collapse open={secOpen.css}>
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
                  flash={flashKey === s.key}
                  onEdited={() => { if (justAddedKey === s.key) onJustAdded(null); }}
                />
              ))}
            </div>
          </div>
        </Collapse>
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
function MultiRelSelectorRow(props: { ids: string[] }) {
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

// ============ PropertyRow：每条 CSS 属性的渲染 ============
function PropertyRow(props: {
  schemaItem: typeof SCHEMA[number];
  elementId: string;
  elementType: ElementType;
  onRemove: () => void;
  /** 刚添加的高亮蓝框（编辑过就取消） */
  highlight?: boolean;
  /** 中键搜索定位到本行时的橙色闪烁高亮 */
  flash?: boolean;
  /** 用户开始编辑这个属性（focus）时回调，用于取消高亮 */
  onEdited?: () => void;
}) {
  const { schemaItem, elementId, elementType, onRemove, highlight, flash, onEdited } = props;
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);
  const clearBreakpointOverride = useScene((s) => s.clearBreakpointOverride);

  const node = findNode(scene.root, elementId);
  const effStyle = node ? getEffectiveStyle(node, activeBreakpoint) : {};
  const app = checkApplicability(schemaItem, elementType, effStyle as any);
  const isOverridden = Boolean(
    activeBreakpoint !== 'desktop' &&
    node?.responsive?.[activeBreakpoint]?.[schemaItem.key] !== undefined
  );

  // 取当前 store 里的值（用于受控 input 的初始值 + 外部更新时同步）
  // trbl 简写输入由 TrblInput 自管，不走这里的单值同步
  const storeValue = (() => {
    if (schemaItem.input === 'trbl') return '';
    if (!node) return '';
    if (schemaItem.input === 'box4' && schemaItem.sides) {
      const side0 = schemaItem.sides[0];
      return (side0 && (effStyle as Record<string, string | undefined>)[side0.key]) ?? '';
    }
    return (effStyle as Record<string, string | undefined>)[schemaItem.key] ?? '';
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
      className={'prop-row' + (highlight ? ' highlight' : '') + (flash ? ' flash' : '') + (!app.applicable ? ' is-inapplicable' : '')}
      // 分类配色：CSS 用 data-cat 给每类属性一条不同颜色的左边线，密集列表也能一眼分清
      data-cat={schemaItem.category}
      // 中键搜索定位用：找到这一行并滚动/高亮
      data-prop-key={schemaItem.key}
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
          {isOverridden && (
            <span
              className="prop-bp-badge"
              title={`在当前 ${activeBreakpoint} 设备已覆盖定制（电脑端为: ${(node?.style as any)?.[schemaItem.key] || '未设'}）。点击清除覆盖，还原继承`}
              onClick={(e) => {
                e.stopPropagation();
                clearBreakpointOverride(elementId, schemaItem.key);
              }}
            >
              <Icon name="phone" size={10} /> 覆盖 <Icon name="undo" size={10} />
            </span>
          )}
          {!app.applicable && (
            <span className="prop-warn-tag" title={`${app.disabledReason}\n（属性已保留，条件满足后自动生效）`}>
              <Icon name="warning" size={10} /> 不生效
            </span>
          )}
          {highlight && <span className="prop-new-badge">新</span>}
        </span>
        <button className="prop-remove" title="删除此属性" onClick={onRemove}><Icon name="close" size={12} /></button>
      </div>
      <div className="prop-row-body">
        {schemaItem.input === 'font' && (
          <FontFamilyInput elementId={elementId} />
        )}
        {schemaItem.input === 'text'
          && !['filter', 'backdropFilter', 'outline', 'gridColumn', 'gridRow'].includes(schemaItem.key) && (
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
        {/* v0.4.4：滤镜 / 背景模糊 → 预设 + 滑杆（不再是一个裸文本框） */}
        {(schemaItem.key === 'filter' || schemaItem.key === 'backdropFilter') && (
          <FilterInput
            elementId={elementId}
            schemaKey={schemaItem.key as 'filter' | 'backdropFilter'}
            value={localValue}
            onFocusStart={() => { /* beginStyleEdit 由组件内部调用 */ }}
            onFocusEnd={() => { /* endStyleEdit 由组件内部调用 */ }}
          />
        )}
        {/* v0.4.4：外轮廓线 → 粗细 / 线型 / 颜色 */}
        {schemaItem.key === 'outline' && (
          <OutlineInput
            elementId={elementId}
            value={localValue}
            onFocusStart={() => { /* 组件内部处理 */ }}
            onFocusEnd={() => { /* 组件内部处理 */ }}
          />
        )}
        {/* v0.4.4：跨列 / 跨行 → 常用档位 + 自定义 */}
        {(schemaItem.key === 'gridColumn' || schemaItem.key === 'gridRow') && (
          <GridSpanInput
            elementId={elementId}
            schemaKey={schemaItem.key as 'gridColumn' | 'gridRow'}
            value={localValue}
            onFocusStart={() => beginStyleEdit()}
            onFocusEnd={() => endStyleEdit()}
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
          schemaItem.key === 'backgroundColor' ? (
            // 背景色：纯色 / 渐变 双模式（渐变走 PowerPoint 风格可视化编辑器）
            <BackgroundInput elementId={elementId} fallback={schemaItem.placeholder} />
          ) : (
            <ColorPicker
              elementId={elementId}
              styleKey={schemaItem.key as 'backgroundColor' | 'color' | 'borderColor'}
              fallback={schemaItem.placeholder}
            />
          )
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
        {schemaItem.input === 'border' && (
          <BorderInput elementId={elementId} />
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
          ? { text: `注意：这个 ID 已被另一个 <${owner}> 使用，浏览器里 ID 必须唯一`, danger: true }
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
    if (/^[a-zA-Z]:[\\/]/.test(currentSrc) || currentSrc.startsWith('\\\\') || currentSrc.startsWith('file://')) return 'abs';
    return 'rel';
  });

  const onPick = async (mode: 'rel' | 'abs') => {
    const res = await window.bc.pickImageSrc(mode);
    if (!res.ok || !res.path) return;
    updateAttr(props.elementId, 'src', res.path);
  };

  // 检测是否是可能在导出 file:// 协议下失效的路径并给出温馨提示
  const isAbsOrFileProto = /^[a-zA-Z]:[\\/]/.test(currentSrc) || currentSrc.startsWith('\\\\') || currentSrc.startsWith('file://');

  return (
    <div className="prop-row">
      <div className="prop-row-header">
        <span>
          图片路径 (src)
          <HelpButton
            title="图片路径与 file:// 协议说明"
            content={
              '【图片路径模式说明】：\n\n' +
              '1. 相对路径（强烈推荐）：\n' +
              '   例如 ./images/photo.png 或 images/photo.png。\n' +
              '   导出的 HTML 文件直接双击在浏览器打开（file:// 协议）或部署上线均能完美显示！\n\n' +
              '2. 网络图片 URL：\n' +
              '   例如 https://example.com/pic.jpg。\n' +
              '   只要电脑能联网，无论本地打开还是线上均能正常显示。\n\n' +
              '3. 本地绝对路径（如 D:\\photo.jpg 或 file://...）：\n' +
              '   注意：编辑器内已做专属特权通道强行正常预览；但导出的 HTML 在现代浏览器由于同源安全限制，通过 file:// 协议可能无法跨盘符读取，建议将图片放入与导出的 HTML 相同或子文件夹内，使用相对路径！'
            }
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
      {isAbsOrFileProto && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#d97706', lineHeight: 1.4 }}>
          <Icon name="warning" size={12} /> 提示：当前为绝对路径。编辑器内已强行支持预览，但导出 HTML 在浏览器中直接双击 (file://) 打开时受跨域安全限制可能无法跨盘显示，推荐使用相对路径 (./images/...)。
        </div>
      )}
    </div>
  );
}

// 保证 SELF_CLOSING_TAGS 被引用（未来可能加专用 attrs 处理）
void SELF_CLOSING_TAGS;
