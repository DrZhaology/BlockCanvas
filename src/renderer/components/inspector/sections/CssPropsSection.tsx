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

/** 每个元素"见过的属性 key"（模块级：跨重挂载、跨撤销/重做都记得住） */
const KNOWN_PROPS = new Map<string, Set<string>>();

export function CssPropsSection(props: CssPropsSectionProps) {
  const {
    open, onToggle, elementId, elementType, visibleSchema, elementStyle,
    justAddedKey, flashKey, onAdd, onRemove, onEdited, ghostSlot
  } = props;

  /**
   * 进场：新出现的一行（"＋添加属性"加的，或 Ctrl+Z 把删掉的恢复回来）→ 从右边滑入。
   * 用户原话（v0.4.7）：「css属性加入元素的时候，做进入动画就是直接从右边滑入，
   *   别的属性卡片让位置」
   */
  const [enterKey, setEnterKey] = useState<string | null>(null);
  /**
   * 「上一帧见过的属性 key」的记忆（v0.4.7，修 Ctrl+Z / Ctrl+Y 没有动画）。
   *
   * 为什么不能只靠组件内的 ref：
   *   撤销 / 重做会整棵场景树换掉，右侧面板容器 `key={rightTab}` 随之**重挂载**
   *   （换元素时也重挂），组件内 ref 全部归零 ——
   *   "这一帧比上一帧多了哪一条 / 少了哪一条"就无从判断，
   *   于是 Ctrl+Z 恢复回来的卡片**没有进场动画**、Ctrl+Y 删掉的卡片**没有退场动画**。
   *   用户原话：「Ctrl + Z 和 Ctrl + Y 的时候卡片有对应的进入和退出动画，和上面的一样。」
   *   所以这份记忆放模块级、按元素 id 分开存。
   */
  const knownRef = useRef<Set<string> | null>(null);
  const known = knownRef.current ?? KNOWN_PROPS.get(elementId) ?? null;
  if (knownRef.current === null) knownRef.current = known ?? new Set<string>();

  /** 「凭空消失」的行（Ctrl+Y 重做 / 换断点等）：补一个同尺寸骨架播退场，播完摘掉 */
  const [gone, setGone] = useState<Array<{ key: string; label: string }>>([]);
  const goneTimers = useRef<number[]>([]);

  useEffect(() => {
    const now = visibleSchema;
    const nowKeys = new Set(now.map((x) => x.key));
    /**
     * ⚠ 必须先做一份"上一帧的快照"，再写回记忆。
     *   以前写成 `const bit = 同一个 Set 引用` → 下面 `bit.add(...)` 会**同时**改掉
     *   用来判定新增的那个集合，于是 `now.find(x => !bit.has(x.key))` 永远为假，
     *   新加的行拿不到 .is-just-added（用户："新加的行没有进场动画"）。
     *   这里用 `new Set(bit)` 隔开读与写。
     */
    const prev = new Set(knownRef.current ?? []);
    const bit = knownRef.current ?? new Set<string>();
    const removed = [...prev].filter((k) => !nowKeys.has(k));
    const added = now.find((x) => !prev.has(x.key));

    for (const k of nowKeys) bit.add(k);
    for (const k of removed) bit.delete(k);
    knownRef.current = bit;
    KNOWN_PROPS.set(elementId, bit);

    if (added) setEnterKey(added.key);

    /**
     * 退场：**点 × 的由 beginRemove 自己播**（它在 state 里挂了 is-removing）；
     * 而 Ctrl+Y 重做、换断点、换元素这些"凭空消失"没有任何动画机会 —— 这里补骨架行。
     *
     * ⚠ 上一版踩过的坑：清理定时器写在 effect 的 return 里，依赖是 [visibleSchema]，
     *   列表每变一次就把定时器清掉 → 骨架行**永远留在列表底部**
     *   （用户截图："最下面不知道为什么出现了这些属性的文字，重复了"）。
     *   现在定时器存 ref，只在卸载时清，不随列表变化重置。
     */
    if (removed.length > 0 && !propRemovalInFlight()) {
      const allNow = visibleSchema;
      setGone((prev) => [
        ...prev.filter((g) => !removed.includes(g.key)),
        ...removed.map((k) => ({
          key: k,
          label: allNow.find((x) => x.key === k)?.label ?? k
        }))
      ]);
      const t = window.setTimeout(() => {
        setGone((prev) => prev.filter((g) => !removed.includes(g.key)));
      }, PROP_REMOVE_MS + 40);
      goneTimers.current.push(t);
    }
  }, [visibleSchema, elementId]);

  // 卸载时把还没跑完的定时器收掉（只在卸载跑，不随列表变化）
  useEffect(() => () => { goneTimers.current.forEach((t) => window.clearTimeout(t)); }, []);

  /** 进场动画只播一次，别让 .is-just-added 一直挂着（挂着会阻止后续过渡） */
  const clearEnter = useCallback(() => setEnterKey(null), []);
  useEffect(() => {
    if (!enterKey) return undefined;
    const t = window.setTimeout(clearEnter, 460);
    return () => window.clearTimeout(t);
  }, [enterKey, clearEnter]);

  const animKey = justAddedKey ?? enterKey;

  /**
   * 手动点 × 的退场（v0.4.7，用户第 2 条）：
   *   「退出的时候，是卡片手动删除的时候加入退出动画！为什么我手动点删除反而没有动画！」
   *
   * 以前有两个原因叠在一起，所以"点了删除像没动画"：
   *   ① 调用方传的是 `e.currentTarget` —— 那颗 18×18 的 × 按钮，
   *      `.is-removing` 挂在透明小按钮上，卡片本体一动不动；
   *   ② 就算挂对了，CSS 只动 transform/opacity、**不收高度** ——
   *      卡片滑出去时还占着原来那块高度，340ms 后节点被删，下面的卡片"啪"地跳上来，
   *      用户要的"别的卡片把退出的空位补上"根本没发生。
   *
   * 现在：先把 key 记进 removing（React 保证类一直在，不会被他处重渲染抹掉），
   * 同时把**这一行的真实高度**写成内联 `--bc-row-h` —— CSS 关键帧用它当收缩起点，
   * 高度才能真正从 h 收到 0（`auto` 是不可动画的，必须给具体像素）。
   */
  const [removingKeys, setRemovingKeys] = useState<string[]>([]);
  /** 最近一次量到的行高：给"凭空消失"的骨架行当高度用 */
  const lastRowH = useRef(0);

  const beginRemove = (key: string, cardEl?: HTMLElement | null) => {
    // 先把高度钉成具体像素（必须在加类之前，否则首帧就没有收缩起点）
    const el = cardEl ?? document.querySelector<HTMLElement>(`.props-list > .prop-row[data-prop-key="${CSS.escape(key)}"]`);
    if (el) {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) {
        lastRowH.current = h;
        el.style.setProperty('--bc-row-h', `${h}px`);
      }
    }
    setRemovingKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    window.setTimeout(() => {
      onRemove(key);
      setRemovingKeys((prev) => prev.filter((k) => k !== key));
    }, PROP_REMOVE_MS);
  };

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
          {visibleSchema.length === 0 && gone.length === 0 && (
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
                onRemove={(card) => beginRemove(s.key, card)}
                removing={removingKeys.includes(s.key)}
                highlight={animKey === s.key && !removingKeys.includes(s.key)}
                flash={flashKey === s.key}
                onEdited={() => { if (animKey === s.key) { clearEnter(); onEdited(); } }}
              />
            ))}
            {/* 凭空消失的行（Ctrl+Y 重做 / 换断点等）：补一个同尺寸骨架播同一段退场动画。
                ⚠ 它**必须**排在最后一个真实行之后、而且只活 PROP_REMOVE_MS ——
                  以前用 effect return 清定时器，幽灵永远摘不掉（用户截图里那三行）。
                `--bc-row-h` 取最近一次量到的真实行高：不收高度的话，
                下面那些卡片会在 340ms 之后整体跳一下（正是用户说的"没有补位"）。 */}
            {gone.map((g) => (
              <div
                className="prop-row prop-gone is-removing"
                key={'gone-' + g.key}
                style={lastRowH.current > 0 ? { ['--bc-row-h' as string]: `${lastRowH.current}px` } : undefined}
              >
                <div className="prop-row-header"><span>{g.label || g.key}</span></div>
              </div>
            ))}
          </div>
        </div>
      </Collapse>
    </div>
  );
}
