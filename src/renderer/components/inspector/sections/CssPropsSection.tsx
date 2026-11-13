// BlockCanvas · 属性面板「CSS 样式属性」折叠区
//
// 这是用户看到的主列表：按需添加的属性逐条渲染成 PropertyRow。
// 拆出来的原因：它在 ElementPropsBody 里是最后一段内联 JSX，跟"哪些属性该显示"的
// 判定逻辑（60 行注释 + 6 条规则）混在一起，改一边要看另一边。
import type { ElementType } from '@lib/types';
import type { PropertySchema } from '@lib/propertySchema';
import { Icon } from '../../Icon';
import { HelpButton } from '../../HelpButton';
import { Collapse } from '../../Collapse';
import { AddPropertyMenu } from '../../AddPropertyMenu';
import { PropertyRow } from '../rows/PropertyRow';

export type CssPropsSectionProps = {
  open: boolean;
  onToggle: () => void;
  elementId: string;
  elementType: ElementType;
  /** 当前应该显示的属性列表（由父级按"值存在 / 显式添加 / 助手代管"三条规则算好） */
  visibleSchema: PropertySchema[];
  elementStyle: Record<string, string | undefined>;
  justAddedKey: string | null;
  flashKey: string | null;
  onAdd: (key: string, value?: string) => void;
  onRemove: (key: string) => void;
  onEdited: () => void;
};

export function CssPropsSection(props: CssPropsSectionProps) {
  const {
    open, onToggle, elementId, elementType, visibleSchema, elementStyle,
    justAddedKey, flashKey, onAdd, onRemove, onEdited
  } = props;

  return (
    <div className="inspector-sec">
      <div
        className="inspector-sec-head"
        onClick={onToggle}
        title="点击展开或收起 CSS 样式属性"
      >
        <span>
          <span className="sec-caret"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /></span>
          CSS 样式属性
          {visibleSchema.length > 0 && <span className="sec-count">({visibleSchema.length})</span>}
        </span>
        <HelpButton
          title="CSS 样式属性"
          content={'点击「+ 添加属性」按需添加颜色、字体、边框、阴影等。\n· 点击右侧「?」可查看各属性详细用法，点击「×」可随时移除。'}
        />
      </div>
      <Collapse open={open}>
        <div className="inspector-sec-body">
          <AddPropertyMenu
            type={elementType}
            elementStyle={elementStyle as never}
            visibleKeys={visibleSchema.map((s) => s.key)}
            onAdd={onAdd}
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
                onRemove={() => onRemove(s.key)}
                highlight={justAddedKey === s.key}
                flash={flashKey === s.key}
                onEdited={() => { if (justAddedKey === s.key) onEdited(); }}
              />
            ))}
          </div>
        </div>
      </Collapse>
    </div>
  );
}
