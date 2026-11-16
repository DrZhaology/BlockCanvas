// BlockCanvas · 属性面板「页面」页签的四张属性卡片
//
// 从 PageCssBody.tsx 里拆出来的（v0.4.7 拆分）：那边原本 628 行，
// 触发了 probe-arch 的「inspector/ 下每个文件 ≤600 行」红线。
// 拆的规则是**按职责**，不是按行数硬切：
//   · PageCssBody —— 页面页签的编排（读 quickCss / bodyExtra、组装列表）
//   · 本文件       —— 单张卡片怎么画（只吃"值 + 写回"，不碰元素 / 断点 / 场景）
// 这样两类改动不再互相牵制：改卡片样式不用读场景逻辑，改数据流不用翻 JSX。
import { useState, useRef } from 'react';
import { getSchemaItem, applyUnit } from '@lib/propertySchema';
import { isGradient, serializeGradient, defaultGradient } from '@lib/gradient';
import { Icon } from '../Icon';
import { HelpButton } from '../HelpButton';
import { ColorField } from '../ColorPicker';
import { FontPickerModal } from '../FontPickerModal';
import { GradientEditor } from '../GradientEditor';
import { animateRemove, camelToKebab, kebabToCamel } from './shared';

// ============ 页面属性卡片（与元素 CSS 属性行同一套视觉 / 编辑器） ============
// v0.4.5：删除属性时先播完"向右滑出 + 高度收起"，再真正删除。
// 时长要和 CSS 里的 .is-leaving 动画（0.34s）对齐：提前删会看到"走一半突然消失"。
// 系统开了"减少动态效果"时直接删（不做动画）。
// 只绑定「值 + 写回」，不碰元素 / 断点，所以能同时服务 body 常用项与任意全局 CSS。
export function PagePropRow(props: {
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
export function PageBgRow(props: {
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
export function PageNumUnit(props: {
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
export function PageBox4(props: {
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