// BlockCanvas · 属性面板「选择器与标识」折叠区
//
// 三件事都在这里：类名芯片（可多个、同名共享样式）、关系选择器（不用起名也能挂规则）、
// 以及该元素适用的 HTML 原生属性（class 之外的那些：id / href / src / alt …）。
//
// 为什么它默认展开：新插入的元素最需要先确认"它叫什么名字"——
// 没有名字，伪类样式导出后一定不生效（见 PseudoSection 的提示）。
import type { ElementType, SceneElement } from '@lib/types';
import type { AttrSchema } from '@lib/propertySchema';
import { Icon } from '../../Icon';
import { HelpButton } from '../../HelpButton';
import { Collapse } from '../../Collapse';
import { ClassChipsRow, RelationalSelectorRow } from '../rows/SelectorRows';
import { AttrRow } from '../rows/AttrRow';
import { ImgPickerRow } from '../rows/ImgPickerRow';

export type IdentitySectionProps = {
  open: boolean;
  onToggle: () => void;
  elementId: string;
  element: SceneElement;
  elementType: ElementType;
  applicableAttrs: AttrSchema[];
};

export function IdentitySection(props: IdentitySectionProps) {
  const { open, onToggle, elementId, element, elementType, applicableAttrs } = props;

  return (
    <div className="inspector-sec">
      <div
        className="inspector-sec-head"
        onClick={onToggle}
        title="点击展开或收起选择器与标识"
      >
        <span>
          <span className="sec-caret"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /></span>
          选择器与标识
        </span>
        <HelpButton
          title="选择器与标识"
          content={'管理元素的命名与匹配机制：\n\n· 类名 Class：给元素命名，同名元素批量共享样式。\n· 关系选择器：无需起名，根据在父容器中的相对位置自动生成规则（如 .hero > h1）。\n· ID：页面内唯一的元素标识。'}
        />
      </div>
      <Collapse open={open}>
        <div className="inspector-sec-body">
          <ClassChipsRow elementId={elementId} element={element} />
          <RelationalSelectorRow elementId={elementId} element={element} />
          {elementType === 'img' && <ImgPickerRow elementId={elementId} />}
          {applicableAttrs
            .filter((a) => a.key !== 'className' && (elementType !== 'img' || a.key !== 'src'))
            .map((a) => (
              <AttrRow
                key={a.key}
                keyName={a.key}
                label={a.label}
                elementId={elementId}
                element={element}
                help={a.help}
              />
            ))}
        </div>
      </Collapse>
    </div>
  );
}
