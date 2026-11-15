// ============================================================================
// BlockCanvas · v0.4.6 竖屏「情境栏」（第三层菜单）
// ----------------------------------------------------------------------------
// 用户原话：
//   「还有个第三层菜单，但不是一直放固定按钮的，需要时出现按钮，按钮从右到左依次出现，
//     没有固定位置，先到的先排右边。选中元素时，二层菜单上面的第三层菜单显示一个按钮：
//     取消选中。画布被缩放的时候（宽度被调整不算），显示按钮：还原大小。」
//
// 布局事实（改之前先看这里）：
//   · 它挂在第二条操作栏**内部、工具栏之上**，所以视觉上就是"第二条栏上面多出来的一层"；
//   · 空清单 → 高度 0，既不占位也不可见；有按钮 → 44px，高度变化走 180ms 过渡；
//   · 按钮排列用 row-reverse：DOM 里**先到的贴右边**，后来的依次往左排（先到先排右）；
//   · 本组件只负责"怎么显示"，**不负责判断该显示什么** —— 业务判定在 App.tsx，
//     这样它不会知道"选中元素""缩放倍数"这些概念，也就不会跟着业务乱改。
// ============================================================================
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type PortraitContextAction = {
  /** 唯一标识。同 key 再次出现时更新原来那颗，而不是再加一颗 */
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
};

/** 退场时长：必须和 37 号分片里 .pt-ctx 的高度过渡、ptCtxOut 动画保持一致 */
const EXIT_MS = 180;

type CtxItem = {
  action: PortraitContextAction;
  /** true = 已经从 actions 里消失，正在播淡出，播完才真正卸载 */
  leaving: boolean;
};

/**
 * 第三层「情境栏」：按需出现的按钮条，永远贴着第二条栏的上沿、靠右排。
 *
 * 为什么要维护一份 items 而不是直接 map(actions)：
 *   直接 map 的话按钮被移除时 DOM 立刻消失，淡出动画根本没机会播；
 *   这里把"消失"先标成 leaving 留在原地，EXIT_MS 之后再真正摘掉。
 */
export function PortraitContextBar(props: { actions: PortraitContextAction[] }) {
  const { actions } = props;
  const [items, setItems] = useState<CtxItem[]>(
    () => actions.map((action) => ({ action, leaving: false }))
  );

  // 同步外部给的动作清单：
  //   · 还在的 → 换成新的动作本体（onClick 可能是新闭包，不换会点到旧状态）
  //   · 新来的 → **追加到末尾**（row-reverse 下末尾 = 最左，先到的仍然在右边）
  //   · 消失的 → 标成 leaving 原地留着播淡出
  useEffect(() => {
    setItems((prev) => {
      const wanted = new Map(actions.map((a) => [a.key, a]));
      const known = new Set(prev.map((it) => it.action.key));
      const next: CtxItem[] = prev.map((it) => {
        const live = wanted.get(it.action.key);
        return live ? { action: live, leaving: false } : { action: it.action, leaving: true };
      });
      for (const a of actions) if (!known.has(a.key)) next.push({ action: a, leaving: false });

      // 内容一模一样就返回旧数组：父组件每次渲染都会传新数组（哪怕是空数组字面量），
      // 不拦一下的话每次父渲染都会白换一次 state，多一轮无意义的重渲染。
      const same = next.length === prev.length && next.every((it, i) => {
        const p = prev[i];
        return p.leaving === it.leaving
          && p.action.key === it.action.key
          && p.action.label === it.action.label
          && p.action.onClick === it.action.onClick
          && p.action.icon === it.action.icon;
      });
      return same ? prev : next;
    });
  }, [actions]);

  // 退场计时：只要还有 leaving 的按钮，等淡出播完（EXIT_MS）再把它们摘掉
  const hasLeaving = items.some((it) => it.leaving);
  useEffect(() => {
    if (!hasLeaving) return;
    const timer = window.setTimeout(() => {
      setItems((prev) => prev.filter((it) => !it.leaving));
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [hasLeaving, items]);

  /** 只剩"正在退场"的按钮时也算空 —— 容器立刻开始收高，收的过程正好盖住淡出，
   *  比"先淡出完再收高"短一半，也不会让人看见一条空着的 44px 带子。 */
  const empty = !items.some((it) => !it.leaving);

  // 一个按钮都没有（退场也播完了）→ **整层不渲染**。
  // 只写 data-empty 的话，容器本身还是 44px 高的一排（.pt-ctx-row 有 pointer-events: auto），
  // 会在第二条栏上面留一条透明横带，把画布上那一带的点击全吃掉。
  if (items.length === 0) return null;

  return (
    <div
      className="pt-ctx"
      data-empty={empty ? 'true' : 'false'}
      aria-hidden={empty ? 'true' : undefined}
    >
      <div className="pt-ctx-row" role="group" aria-label="情境操作">
        {items.map(({ action, leaving }) => (
          <button
            key={action.key}
            type="button"
            className="pt-ctx-btn"
            data-key={action.key}
            data-leaving={leaving ? 'true' : 'false'}
            tabIndex={leaving ? -1 : undefined}
            onClick={action.onClick}
          >
            {action.icon && <span className="pt-ctx-ico" aria-hidden="true">{action.icon}</span>}
            <span className="pt-ctx-label">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default PortraitContextBar;
