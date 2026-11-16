// BlockCanvas · 属性面板「交互状态 (伪类)」折叠区
//
// 支持 :hover / :active / :focus / :link 四种状态各自覆盖样式，并内置动效预制。
// 拆分前它是 ElementPropsBody 里 240 行的内联 JSX —— 是那一屏里最长的单块。
//
// 关键约定（都踩过坑）：
//  · 伪类样式必须挂在"名字"（类名 / 关系选择器 / ID）上，否则导出的网页里不生效 ——
//    所以没有名字时要显式提示，而不是让用户白设。
//  · 套用动效预制时自动补 `transition: all .30s ease`：没有 transition，
//    hover/active 的变化就是瞬间跳变（滑块显示 0.30s 会让人误以为已经开启）。
//  · 覆盖式套用：先清掉该伪类的全部旧覆盖再写新的，否则换预制时上一次的位移/阴影会残留叠加。
import { useScene } from '@store/sceneStore';
import type { ElementType, SceneElement } from '@lib/types';
import { getSchemaItem, isApplicable } from '@lib/propertySchema';
import { Icon } from '../../Icon';
import { HelpButton } from '../../HelpButton';
import { Collapse } from '../../Collapse';
import { AddPropertyMenu } from '../../AddPropertyMenu';
import { PseudoFxPanel } from '../../PseudoFx';
import { ColorPicker } from '../../ColorPicker';
import { NumberUnitInput } from '../../NumberUnitInput';
import { FontFamilyInput } from '../../FontFamilyInput';
import { TransformInput } from '../../TransformInput';
import { BoxShadowInput } from '../../BoxShadowInput';
import { TextShadowInput } from '../../TextShadowInput';
import { OpacityInput } from '../../OpacityInput';
import { LineHeightInput } from '../../LineHeightInput';

export const PSEUDO_CLASSES = ['hover', 'active', 'focus', 'link'] as const;
export type PseudoClass = typeof PSEUDO_CLASSES[number];

export const PSEUDO_LABEL: Record<PseudoClass, string> = {
  hover: '(悬停)',
  active: '(按下)',
  focus: '(聚焦)',
  link: '(链接)'
};

export type PseudoSectionProps = {
  open: boolean;
  onToggle: () => void;
  activePseudo: PseudoClass | null;
  setActivePseudo: (p: PseudoClass | null) => void;
  pseudoStyles: Record<string, Record<string, string | undefined>>;
  hasSelector: boolean;
  selected: SceneElement;
  elementId: string;
  elementType: ElementType;
  onOpenIdentity: () => void;
};

export function PseudoSection(props: PseudoSectionProps) {
  const {
    open, onToggle, activePseudo, setActivePseudo, pseudoStyles, hasSelector,
    selected, elementId, elementType, onOpenIdentity
  } = props;
  const updateStyle = useScene((s) => s.updateStyle);
  const updatePseudoStyleStore = useScene((s) => s.updatePseudoStyle);
  const removePseudoStyleStore = useScene((s) => s.removePseudoStyle);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);

  // 更新伪类样式的辅助函数（直接通过 store 更新，自动联动同类名/同选择器元素）
  const updatePseudoStyle = (pseudo: PseudoClass | null, patch: Record<string, string>) => {
    if (pseudo === null) updateStyle(elementId, patch);
    else updatePseudoStyleStore(elementId, pseudo, patch);
  };
  const removePseudoStyle = (pseudo: PseudoClass | null, key?: string) => {
    if (pseudo === null) {
      if (key) updateStyle(elementId, { [key]: undefined });
    } else {
      removePseudoStyleStore(elementId, pseudo, key);
    }
  };

  return (
    <div className="inspector-sec">
      <div
        className="inspector-sec-head"
        onClick={onToggle}
        title="编辑 :hover / :active / :focus / :link 状态下的样式与动效"
      >
        <span>
          <span className="sec-caret"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /></span>
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
      <Collapse open={open}>
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
                  :{pc} {PSEUDO_LABEL[pc]}
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
                            <button className="btn-mini" onClick={onOpenIdentity}>
                              去上面「选择器与标识」起个名字
                            </button>
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
                        removePseudoStyle(activePseudo);
                        updatePseudoStyle(activePseudo, patch);
                        // 套用动效时自动补 0.3s ease 过渡（否则变化是瞬间跳变）
                        if (!(selected.style as Record<string, string | undefined>).transition) {
                          updateStyle(elementId, { transition: 'all 0.30s ease' } as never);
                        }
                        endStyleEdit();
                      }}
                      onClearAll={() => removePseudoStyle(activePseudo)}
                      onPatch={(patch) => updatePseudoStyle(activePseudo, patch)}
                      onPatchBase={(patch) => updateStyle(elementId, patch as never)}
                      onDragStart={() => beginStyleEdit()}
                      onDragEnd={() => endStyleEdit()}
                    />
                    <AddPropertyMenu
                      type={elementType}
                      elementStyle={currentStyle as never}
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
                          patch[item.key] = (selected.style as Record<string, string | undefined>)?.[item.key] || '#1e88e5';
                        } else if (item.input === 'select' && item.options && item.options.length > 0) {
                          patch[item.key] = item.options[0];
                        } else if (item.input === 'number') {
                          patch[item.key] = (selected.style as Record<string, string | undefined>)?.[item.key]
                            || (item.unit ? '16' + item.unit : '16');
                        } else {
                          patch[item.key] = '';
                        }
                        updatePseudoStyle(activePseudo, patch);
                      }}
                    />
                    {hasProps && (
                      <div className="pseudo-delete-row">
                        <button className="btn-mini btn-danger" onClick={() => removePseudoStyle(activePseudo)}>
                          清空 :{activePseudo} 样式
                        </button>
                      </div>
                    )}
                    {Object.entries(currentStyle).map(([key, val]) => {
                      const item = getSchemaItem(key);
                      if (!item) return null;
                      const v = val ?? '';
                      const onVal = (nv: string) => updatePseudoStyle(activePseudo, { [key]: nv });
                      const onRm = () => removePseudoStyle(activePseudo, key);
                      return (
                        <div key={key} className="prop-row">
                          <div className="prop-row-header">
                            <span>{item.label}</span>
                            <button className="prop-remove" onClick={onRm} title="删除此属性">×</button>
                          </div>
                          <div className="prop-row-body">
                            {item.input === 'transform' && <TransformInput elementId={elementId} pseudo={activePseudo} />}
                            {item.input === 'shadow' && <BoxShadowInput elementId={elementId} pseudo={activePseudo} />}
                            {item.input === 'textShadow' && <TextShadowInput elementId={elementId} pseudo={activePseudo} />}
                            {item.input === 'opacity' && <OpacityInput elementId={elementId} pseudo={activePseudo} />}
                            {item.input === 'lineHeight' && <LineHeightInput elementId={elementId} pseudo={activePseudo} />}
                            {item.input === 'font' && <FontFamilyInput elementId={elementId} pseudo={activePseudo} />}
                            {item.input === 'color' && (
                              <ColorPicker elementId={elementId} styleKey={key} fallback={item.placeholder} pseudo={activePseudo} />
                            )}
                            {item.input === 'number' && item.unit && (
                              <NumberUnitInput elementId={elementId} schemaKey={key} unit={item.unit} allowAuto={item.allowAuto} pseudo={activePseudo} />
                            )}
                            {item.input === 'number' && !item.unit && (
                              <input type="number" className="prop-input" value={v} onChange={(e) => onVal(e.target.value)} />
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
  );
}
