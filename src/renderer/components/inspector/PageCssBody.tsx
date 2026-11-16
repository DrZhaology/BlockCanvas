// BlockCanvas · 属性面板「页面」页签（body 设置 + 全局样式）
//
// v0.4.5 重构（按用户要求，与元素 CSS 面板统一）：
//  · 「添加属性」直接用元素面板同款 AddPropertyMenu：按类别分组 + 中英文/拼音搜索；
//  · 每个属性都渲染成和元素 CSS 一样的专属卡片 —— 颜色开调色盘、数值有数字框 + 单位、
//    内外边距是四向输入、枚举是下拉，不再是一排裸文本框；
//  · body 的 7 个常用项仍走 quickCss（旧工程与导出完全兼容），其余任意 CSS 走 bodyExtra。

import { useState, useRef } from 'react';
import { useScene } from '@store/sceneStore';
import type { ElementType, SceneGraph } from '@lib/types';
import { getSchemaItem, applyUnit } from '@lib/propertySchema';
import { isGradient, serializeGradient, defaultGradient } from '@lib/gradient';
import { AddPropertyMenu } from '../AddPropertyMenu';
import { Icon } from '../Icon';
import { HelpButton } from '../HelpButton';
import { ColorField } from '../ColorPicker';

import { FontPickerModal } from '../FontPickerModal';
import { Collapse } from '../Collapse';
import { GradientEditor } from '../GradientEditor';
import { animateRemove } from './shared';

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
  /**
   * 卡片用哪种编辑器。
   * v0.4.5 第十六批新增 `'font'`：字体走元素那一套「字体库」弹窗
   * （用户反馈「页面和变量里面的字体还是原始的，没有类似单个元素的 font family 的设置方式」）。
   */
  type: 'color' | 'text' | 'font';
  placeholder?: string;
  /** 对应元素 SCHEMA 的 key：决定这张卡片用哪种专属编辑器 */
  schemaKey?: string;
}

const PAGE_PROPS: PagePropDef[] = [
  { key: 'bodyBg', label: '页面背景色', type: 'color', schemaKey: 'backgroundColor' },
  { key: 'textColor', label: '文字颜色', type: 'color', schemaKey: 'color' },
  { key: 'linkColor', label: '链接颜色', type: 'color', schemaKey: 'color' },
  { key: 'fontFamily', label: '页面字体', type: 'font', schemaKey: 'fontFamily' },
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

export function PageCssBody() {
  const quickCss = useScene((s) => s.scene.quickCss);
  const setQuickCss = useScene((s) => s.setQuickCss);
  const bodyExtra = useScene((s) => s.scene.bodyExtra);
  const setBodyExtra = useScene((s) => s.setBodyExtra);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  // v0.4.6（R6-16）：基准视口高度（fixed 的空气墙）—— 只影响画布，不进导出
  const viewportHeight = useScene((s) => s.scene.viewportHeight) ?? 900;
  const setViewportHeight = useScene((s) => s.setViewportHeight);
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
          item.key === 'bodyBg' ? (
            /* 页面背景（v0.4.7）：用户要求「页面的背景色加入可以设置渐变色」。
               这里给它一个专用行：纯色 / 渐变 两段式，渐变复用元素那一套
               GradientEditor（同样的角度盘、色标、预制配色），只是写进 quickCss。
               ⚠ 两个字段分工不能混：
                 · bodyBg     → background-color（纯色，旧工程与导出都认它）
                 · bodyBgImage→ background-image（渐变 / 图片）
               同时存在时浏览器会先铺色再盖渐变，正好可以"半透明渐变 + 底色"。 */
            <PageBgRow
              key={item.key}
              color={qc.bodyBg ?? ''}
              image={qc.bodyBgImage ?? ''}
              onColor={(v) => setKey('bodyBg', v)}
              onImage={(v) => setKey('bodyBgImage', v)}
              onFocusStart={() => beginStyleEdit()}
              onFocusEnd={() => endStyleEdit()}
              onRemove={() => { removeKey('bodyBg'); removeKey('bodyBgImage'); }}
            />
          ) : (
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
          )
        ))}
        {/* v0.4.6（R6-16）：基准视口高度 —— 只影响编辑器里的画布，不进导出。
            它解决的是「fixed 元素往下拖永远贴不到底」：画布会随内容长长，
            所以要先告诉它"浏览器窗口有多高"。 */}
        <div className="page-quick-row">
          <span className="page-quick-label">
            首屏高度
            <HelpButton
              title="首屏高度（基准视口）"
              content={
                '浏览器窗口在真实网页里是有高度的（比如 900px），而画布会随内容一直变长。\n\n' +
                '· 固定定位（position: fixed）的元素以"浏览器窗口"为参照：\n' +
                '  bottom: 0 = 贴在首屏底部，而不是几千米长的页面底部。\n' +
                '· 没有这个基准，画布上把元素拖到底也写不出 bottom: 0。\n\n' +
                '这一项只影响编辑器里的画布与拖动边界，不写进导出的网页。'
              }
            />
          </span>
          <div className="page-quick-inline">
            <input
              type="number"
              className="prop-input"
              min={320}
              max={4000}
              step={10}
              value={viewportHeight}
              onFocus={() => beginStyleEdit()}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setViewportHeight(n);
              }}
              onBlur={() => endStyleEdit()}
              title="画布至少撑这么高；固定定位元素的拖动墙止步于这条线"
            />
            <span className="page-quick-unit">px</span>
          </div>
        </div>
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
// v0.4.5：删除属性时先播完"向右滑出 + 高度收起"，再真正删除。
// 时长要和 CSS 里的 .is-leaving 动画（0.34s）对齐：提前删会看到"走一半突然消失"。
// 系统开了"减少动态效果"时直接删（不做动画）。
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
  // 页面/变量的字体：复用元素的「字体库」弹窗（v0.4.5 第十六批）
  const [fontPickerOpen, setFontPickerOpen] = useState(false);

  return (
    <div className="prop-row page-prop-row" data-cat={schema?.category ?? '其他'}>
      <div className="prop-row-header">
        <span>
          {props.label}
          {schema?.help && <HelpButton title={schema.help.title} content={schema.help.content} />}
        </span>
        <button className="prop-remove" title="删除此属性" onClick={(e) => animateRemove(e.currentTarget, props.onRemove)}>
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
        ) : input === 'font' ? (
          /*
           * v0.4.5 第十六批（用户反馈）：「页面和变量里面的字体还是原始的，
           * 没有类似单个元素的 font family 的设置方式（是有一个弹窗）。」
           * 这里直接复用元素那一套「字体库」弹窗（FontPickerModal）：
           * 同样的搜索、同样的预览、同样的商用许可证徽章，只是写进 bodyExtra / token。
           */
          <div className="page-font-field">
            <input
              className="page-quick-input page-font-input"
              value={value}
              placeholder="留空 = 用浏览器默认字体"
              spellCheck={false}
              onFocus={props.onFocusStart}
              onChange={(e) => props.onChange(e.target.value)}
              onBlur={props.onFocusEnd}
            />
            <button
              className="btn-mini page-font-pick"
              title="打开字体库：可搜索本机字体、预览效果、查看商用许可"
              onClick={() => { props.onFocusStart(); setFontPickerOpen(true); }}
            >字体库…</button>
            <FontPickerModal
              open={fontPickerOpen}
              initial={value}
              onClose={() => { setFontPickerOpen(false); props.onFocusEnd(); }}
              onApply={(v) => { props.onChange(v); setFontPickerOpen(false); props.onFocusEnd(); }}
            />
          </div>
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

/**
 * 页面背景（v0.4.7）：纯色 / 渐变 两段式。
 *
 * 用户原话：「页面的背景色加入可以设置渐变色」。
 *
 * 为什么不是把 GradientEditor 硬塞进 PagePropRow：
 *   PagePropRow 按 schema.input 分发，而"背景"在 body 上是**两条** CSS
 *   （background-color 和 background-image），一个 schema key 表达不了。
 *   所以这里单独写一张行，两个字段各管一条，切模式时只清自己那一条 ——
 *   这样"纯色 → 渐变 → 纯色"来回切不会把另一条弄丢。
 */
function PageBgRow(props: {
  color: string;
  image: string;
  onColor: (v: string) => void;
  onImage: (v: string) => void;
  onFocusStart: () => void;
  onFocusEnd: () => void;
  onRemove: () => void;
}) {
  const { color, image, onColor, onImage, onFocusStart, onFocusEnd, onRemove } = props;
  const isGrad = isGradient(image);
  const mode: 'solid' | 'gradient' = isGrad ? 'gradient' : 'solid';
  const draftRef = useRef(image);

  const switchMode = (next: 'solid' | 'gradient') => {
    if (next === mode) return;
    onFocusStart();
    if (next === 'gradient') {
      // 已经写过渐变就沿用，否则给一套默认渐变（不留空白，点开就有东西看）
      onImage(isGradient(image) ? image : serializeGradient(defaultGradient()));
    } else {
      onImage('');            // 回到纯色：只清 background-image
    }
    onFocusEnd();
  };

  return (
    <div className="prop-row page-prop-row" data-cat="颜色">
      <div className="prop-row-header">
        <span>
          页面背景
          <HelpButton
            title="页面背景（纯色 / 渐变）"
            content={'· 纯色：写进 body 的 background-color。\n· 渐变：写进 body 的 background-image（可调方向、色标、预制配色）。\n· 两者可以同时存在：渐变半透明时会透出下面的纯色。'}
          />
        </span>
        <button className="prop-remove" title="删除页面背景" onClick={(e) => animateRemove(e.currentTarget, onRemove)}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="prop-row-body page-bg-body">
        <div className="bg-mode-seg">
          <button
            className={'bg-mode-btn' + (mode === 'solid' ? ' active' : '')}
            onClick={() => switchMode('solid')}
            title="纯色填充（写 background-color）"
          >纯色</button>
          <button
            className={'bg-mode-btn' + (mode === 'gradient' ? ' active' : '')}
            onClick={() => switchMode('gradient')}
            title="渐变填充（写 background-image，可调方向与色标）"
          >渐变</button>
        </div>
        {mode === 'solid' ? (
          <ColorField
            value={color}
            fallback="#ffffff"
            inputClassName="page-quick-input"
            onInputFocus={onFocusStart}
            onChange={onColor}
            onInputBlur={onFocusEnd}
            onModalOpen={onFocusStart}
            onModalClose={onFocusEnd}
          />
        ) : (
          <GradientEditor
            value={image}
            scope="background"
            onChange={(css) => { draftRef.current = css; onImage(css); }}
            onCommit={() => { onImage(draftRef.current); }}
            onRemove={() => onImage('')}
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
