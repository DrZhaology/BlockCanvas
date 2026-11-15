// BlockCanvas · 单条 CSS 属性行（按 schema.input 分发到各专属编辑器）
//
// 这里是"属性面板长得像设计工具而不是一堆文本框"的关键：
// color → 调色盘、number+unit → 数字框 + 单位下拉、box4 → 四向输入、
// shadow / textShadow / transform / opacity / lineHeight / font 各有专属编辑器。

import { useState, useEffect } from 'react';
import { useScene, findNode, getEffectiveStyle } from '@store/sceneStore';
import type { ElementType } from '@lib/types';
import { SCHEMA, applyUnit, UNIT_HELP_TEXT, checkApplicability } from '@lib/propertySchema';
import { Icon } from '../../Icon';
import { HelpButton } from '../../HelpButton';
import { Box4Input } from '../../Box4Input';
import { TrblInput } from '../../TrblInput';
import { ColorPicker } from '../../ColorPicker';
import { NumberUnitInput } from '../../NumberUnitInput';
import { FontFamilyInput } from '../../FontFamilyInput';
import { TransformInput } from '../../TransformInput';
import { BorderInput } from '../../BorderInput';
import { BoxShadowInput } from '../../BoxShadowInput';
import { TextShadowInput } from '../../TextShadowInput';
import { FilterInput } from '../../FilterInput';
import { OutlineInput } from '../../OutlineInput';
import { GridSpanInput } from '../../GridSpanInput';
import { TransitionInput } from '../../TransitionInput';
import { OpacityInput } from '../../OpacityInput';
import { LineHeightInput } from '../../LineHeightInput';
import { BackgroundInput } from '../../BackgroundInput';
import { animateRemove } from '../shared';
import { askPositionSwitch, marginSummaryOf } from '@lib/posSwitch';

export function PropertyRow(props: {
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
  /**
   * 不画右上角的 ×（v0.4.6）。
   * 临时卡片里用：那张卡片不是"列表里的一行"，它跟着选中的元素活着，
   * 摆一个 × 会让人以为要手动管理它（用户明确要求「临时卡片不要有 ×」）。
   */
  noRemove?: boolean;
}) {
  const { schemaItem, elementId, elementType, onRemove, highlight, flash, onEdited, noRemove } = props;
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

  /**
   * 下拉型属性的提交（v0.4.6：position 走统一的外边距确认）。
   *
   * 用户原话：「发现有些地方做了，但是有些时候改的时候不会有提示，比如卡片 position 直接改，
   * 这次做统一。」所以这里和快捷助手走**同一个**全屏模态（lib/posSwitch），
   * 三选项：先不设置定位 / 保留外边距并切换 / 清除外边距并切换（绿色推荐）。
   */
  const commitSelect = async (v: string) => {
    if (schemaItem.key === 'position' && v && v !== 'static') {
      const ms = marginSummaryOf(effStyle as Record<string, string | undefined>);
      if (ms.dirty) {
        const choice = await askPositionSwitch({ next: v, margins: ms.text, elementTag: String(elementType) });
        if (choice === 'cancel') { setLocalValue(storeValue); return; }
        beginStyleEdit();
        updateStyle(elementId, {
          position: v,
          ...(choice === 'clear'
            ? { marginTop: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '0px' }
            : {})
        } as never);
        endStyleEdit();
        return;
      }
    }
    updateStyle(elementId, { [schemaItem.key]: v } as never);
  };

  const help = schemaItem.help ? (
    <HelpButton
      title={schemaItem.help.title}
      // 数值类属性统一附加"单位说明"：一次性讲清所有单位
      content={schemaItem.help.content + (schemaItem.unit ? '\n\n' + UNIT_HELP_TEXT : '')}
    />
  ) : null;

  return (
    <div
      className={'prop-row' + (highlight ? ' highlight is-just-added' : '') + (flash ? ' flash' : '') + (!app.applicable ? ' is-inapplicable' : '')}
      // 分类配色：CSS 用 data-cat 给每类属性一条不同颜色的左边线，密集列表也能一眼分清
      data-cat={schemaItem.category}
      // 中键搜索定位用：找到这一行并滚动/高亮
      data-prop-key={schemaItem.key}
      // React 合成 onFocus 会冒泡：任何子输入框聚焦都会视为开始编辑
      onFocus={onEdited}
    >
      <div className="prop-row-header">
        <span>
          {/* v0.4.5：以前每个属性名前都挂一个"子"字小方块，看起来像乱码。
              现在只在**真的作用于父容器**（flex/grid 这类）时显示一枚"父级"小标签，
              其余属性靠左侧分类色条区分，不再堆字。 */}
          {schemaItem.scope === '父' && (
            <span className="prop-scope" title="此属性作用在父容器上，影响子元素排布">父级</span>
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
        {!noRemove && (
          <button className="prop-remove" title="删除此属性" onClick={(e) => animateRemove(e.currentTarget, onRemove)}><Icon name="close" size={12} /></button>
        )}
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
            onChange={(e) => { void commitSelect(e.target.value); }}
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

