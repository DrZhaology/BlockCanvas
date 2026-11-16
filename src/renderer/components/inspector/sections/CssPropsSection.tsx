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
import { useCallback, useEffect, useRef, useState } from 'react';
import { PROP_REMOVE_MS, propRemovalInFlight } from '../shared';

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
  /**
   * 「临时卡片」（v0.4.6）：中键搜到的属性如果不在这个列表里，就临时插在最上面。
   * 用户要求它**长在 CSS 属性里面**（而不是另起一张卡），所以做成插槽。
   */
  ghostSlot?: React.ReactNode;
};

export function CssPropsSection(props: CssPropsSectionProps) {
  const {
    open, onToggle, elementId, elementType, visibleSchema, elementStyle,
    justAddedKey, flashKey, onAdd, onRemove, onEdited, ghostSlot
  } = props;

  /**
   * 属性卡片的"重进 / 退出"（v0.4.6 第 46 批）
   * ----------------------------------------------------------------------------
   * 用户原话：「删除后先缩小，阴影变换一下，然后从右侧划出，这就是卡片删除的动画。
   *   同时 Ctrl + Z 或者 Ctrl + Y 卡片的重进和退出也要做好。」
   *
   * 两种来源都要动起来：
   *   · **进场**：新出现的一行（不管是"＋添加属性"加的，还是 Ctrl+Z 把删掉的恢复回来）
   *     → 给一次入场动画；
   *   · **退场**：一行从列表里消失。点 × 删除时 animateRemove 已经在那一行上挂了
   *     is-removing（自己播）；而 Ctrl+Y 重做、或别的入口让它凭空消失时没有任何动画机会
   *     → 这里补一条"幽灵行"，用同一段退场动画播完再摘掉。
   */
  const [enterKey, setEnterKey] = useState<string | null>(justAddedKey);
  const [ghosts, setGhosts] = useState<Array<{ key: string; label: string }>>([]);
  const prevSchema = useRef(visibleSchema);

  useEffect(() => {
    const now = visibleSchema;
    const nowKeys = new Set(now.map((x) => x.key));
    const gone = prevSchema.current.filter((x) => !nowKeys.has(x.key));
    const added = now.find((x) => !prevSchema.current.some((y) => y.key === x.key));
    prevSchema.current = now;

    // 进场
    if (added) setEnterKey(added.key);

    // 退场：点 × 那条自己会播（is-removing），别重复补
    if (gone.length > 0 && !propRemovalInFlight()) {
      setGhosts((prev) => [
        ...prev.filter((g) => !gone.some((x) => x.key === g.key)),
        ...gone.map((x) => ({ key: x.key, label: x.label }))
      ]);
      const t = window.setTimeout(() => {
        setGhosts((prev) => prev.filter((g) => !gone.some((x) => x.key === g.key)));
      }, PROP_REMOVE_MS + 40);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [visibleSchema]);

  /** 进场动画只播一次，别让 .is-just-added 一直挂着（挂着会阻止后续过渡） */
  const clearEnter = useCallback(() => setEnterKey(null), []);
  useEffect(() => {
    if (!enterKey) return;
    const t = window.setTimeout(clearEnter, 460);
    return () => window.clearTimeout(t);
  }, [enterKey, clearEnter]);

  const animKey = justAddedKey ?? enterKey;

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
            {ghostSlot}
            {visibleSchema.map((s) => (
              <PropertyRow
                key={s.key}
                schemaItem={s}
                elementId={elementId}
                elementType={elementType}
                onRemove={() => onRemove(s.key)}
                highlight={animKey === s.key}
                flash={flashKey === s.key}
                onEdited={() => { if (animKey === s.key) { clearEnter(); onEdited(); } }}
              />
            ))}
            {/* 凭空消失的行（Ctrl+Y 重做等）：补一条幽灵，播完同一段退场动画再摘掉 */}
            {ghosts.map((g) => (
              <div className="prop-row prop-ghost is-removing" key={'ghost-' + g.key}>
                <span className="prop-name">{g.label || g.key}</span>
              </div>
            ))}
          </div>
        </div>
      </Collapse>
    </div>
  );
}
