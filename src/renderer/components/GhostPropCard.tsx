// ============================================================================
// BlockCanvas · 幽灵属性卡片（v0.4.6）
// ----------------------------------------------------------------------------
// 用户原话（第二次提，上一次做错了方向）：
//   「快捷助手关闭了显示到下方 CSS 属性的时候，中键搜索属性的时候，临时做一个幽灵卡片，
//     颜色做的不一样。这个你不要写提示，直接写进 F1 文档里面。
//     这个卡片关闭当前选中元素的属性面板后就下次进来不显示了。颜色要不一样。」
//
// 它是什么：
//   「显示到下方 CSS 属性」关掉之后，快捷助手代管的那几条属性（display / gap / 背景渐变…）
//   不再出现在下方列表里，于是"我知道这条属性存在，但没地方改"。
//   中键搜到它时，就把这条属性**临时**放在这张异色卡片里直接改 —— 改完不用管，换个元素就没了。
//
// 三条硬规矩（都是用户明确要求的）：
//   1. **没有关闭按钮**：它只跟着"当前选中的这个元素"活着，离开这个元素自然消失。
//      （上一次我加了个 ×，用户反馈"这是幽灵卡片放置混淆"——那个 × 让人以为要手动管理它。）
//   2. **颜色必须和其它卡片不一样**：这里是紫色系，一眼能看出"这不是正式属性行"。
//   3. **卡片里不写任何说明文字**：用法写进 F1 使用手册，不在界面上唠叨。
// ============================================================================
import { SCHEMA } from '@lib/propertySchema';
import { getPluginProperties } from '@lib/pluginHost';
import type { ElementType } from '@lib/types';
import { PropertyRow } from './inspector/rows/PropertyRow';
import { Icon } from './Icon';

export function GhostPropCard(props: {
  elementId: string;
  elementType: ElementType;
  /** 中键搜中的属性 key（最近的在前，最多几条） */
  keys: string[];
  /** 中键定位时要闪一下的那个 key（和列表里的行同一套闪烁） */
  flashKey?: string | null;
}) {
  const { elementId, elementType, keys, flashKey } = props;
  if (keys.length === 0) return null;
  const all = [...SCHEMA, ...getPluginProperties()];
  const items = keys
    .map((k) => all.find((s) => s.key === k))
    .filter((s): s is typeof all[number] => Boolean(s));
  if (items.length === 0) return null;

  return (
    <div className="ghost-prop-card" data-bc-ghost-card="1">
      <div className="ghost-prop-card-head">
        <Icon name="target" size={12} />
        <span>临时卡片</span>
      </div>
      <div className="ghost-prop-card-body">
        {items.map((it) => (
          <PropertyRow
            key={it.key}
            schemaItem={it as never}
            elementId={elementId}
            elementType={elementType}
            flash={flashKey === it.key}
            // 幽灵卡片不提供"删除这条属性"：它不是列表里的一行，删什么删
            // v0.4.6：连 × 都不画（用户明确「临时卡片不要有 ×」）
            noRemove
            onRemove={() => { /* 无操作 */ }}
          />
        ))}
      </div>
    </div>
  );
}

export default GhostPropCard;
