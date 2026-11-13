// BlockCanvas · sticky 的可视化（R6-17）
//
// 背景：`position: sticky` 的效果只有在"页面滚动"时才看得见 —— 画布自己不滚
// （滚的是外层 .canvas-wrap），所以编辑器里 sticky 元素和 static 长得一模一样，
// 用户没法判断"我设的 top: 20px 到底挂住了没有"。
//
// 做法（把**生效条件**可视化，而不是模拟一个不可信的滚动预览）：
//   · 给 sticky 元素挂 data-bc-sticky="armed|idle"：
//       armed = 有吸附距离，会挂住；
//       idle  = 没写 top/bottom —— **永远不会吸附**（最容易犯的错，必须显性提示）。
//   · 在元素角上显示「粘 距上 20px」，一眼看出以什么为吸附线。
//   · 选中的 sticky 元素旁画一条半透明吸附线。
//
// 为什么不做"真实滚动模拟"：画布外面还套着 transform: scale(zoom)，
// 在 transform 里再造一个滚动上下文，行为一定和浏览器不完全一致 ——
// 宁可给准确的信息（吸附线在哪、有没有生效），也不给"看起来像但不可信"的预览。
import { useEffect } from 'react';
import { useScene } from '@store/sceneStore';
import type { SceneElement } from '@lib/types';

export type StickyInfo = {
  /** 有吸附距离 = armed；没写 = idle（永不吸附） */
  state: 'armed' | 'idle';
  /** 生效的吸附边（CSS 语义：top 优先于 bottom） */
  side: 'top' | 'bottom' | 'left' | 'right' | null;
  /** 吸附距离（原样，可能带单位） */
  offset: string;
  /** 是否还写了 left/right —— 横向吸附要求滚动容器能横向滚，通常不生效 */
  horizontal: boolean;
};

const str = (v: string | undefined) => String(v ?? '').trim();
const has = (v: string) => v !== '' && v !== 'auto';

/** 从**场景样式**（不是 computed）解析 sticky 吸附信息 —— 纯函数，好测 */
export function readSticky(style: Record<string, string | undefined>): StickyInfo | null {
  if (str(style.position) !== 'sticky') return null;
  const t = str(style.top);
  const b = str(style.bottom);
  const l = str(style.left);
  const r = str(style.right);
  const horizontal = has(l) || has(r);
  // CSS 语义：同时写 top/bottom 时元素被夹在两线之间；单边时以写的那个为准。
  // 这里按"最先决定位置的那条"取，和 BoxModel 覆盖层的展示口径保持一致。
  if (has(t)) return { state: 'armed', side: 'top', offset: t, horizontal };
  if (has(b)) return { state: 'armed', side: 'bottom', offset: b, horizontal };
  if (has(l)) return { state: 'armed', side: 'left', offset: l, horizontal };
  if (has(r)) return { state: 'armed', side: 'right', offset: r, horizontal };
  return { state: 'idle', side: null, offset: '', horizontal: false };
}

function findById(n: SceneElement, id: string): SceneElement | null {
  if (n.id === id) return n;
  for (const c of n.children) {
    const hit = findById(c, id);
    if (hit) return hit;
  }
  return null;
}

/** 角标文案（探针也断言这个，保持唯一来源） */
export function stickyBadgeText(info: StickyInfo): string {
  if (info.state === 'idle') return '粘 未设距离';
  const map = { top: '上', bottom: '下', left: '左', right: '右' } as const;
  return `粘 距${map[info.side!]} ${info.offset}`;
}

/** 属性面板 / 快捷助手用的一句话说明 */
export function stickyHint(info: StickyInfo | null): string {
  if (!info) return '';
  if (info.state === 'idle') {
    return '粘性定位没写 top / bottom —— 它永远不会吸附，看起来和普通元素一样。给个 top: 20px 试试。';
  }
  const where = info.side === 'top' ? '顶部' : info.side === 'bottom' ? '底部' : info.side === 'left' ? '左侧' : '右侧';
  return `滚动时元素先跟随内容，直到距${where} ${info.offset} 处开始吸附（画布上已标出吸附线）。`;
}

/**
 * 给画布里所有 sticky 元素挂上状态标记。
 *
 * 必须在「场景变化」与「画布重渲染」之后跑：sticky 判定依赖 computed position
 * （用户可能通过类名规则设的 sticky），而"有没有写距离"只能回场景样式读。
 */
export function useStickyMarks(root: SceneElement, deps: unknown[]): void {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.canvas [data-bc-id]')) as HTMLElement[];
    const touched: HTMLElement[] = [];
    for (const el of els) {
      const id = el.getAttribute('data-bc-id')!;
      const node = findById(root, id);
      // 先按场景样式判定（比 computed 更可靠地知道"写没写"），再用 computed 确认真的生效
      const info = readSticky((node?.style ?? {}) as Record<string, string | undefined>);
      if (!info || getComputedStyle(el).position !== 'sticky') {
        el.removeAttribute('data-bc-sticky');
        el.removeAttribute('data-bc-sticky-label');
        continue;
      }
      el.setAttribute('data-bc-sticky', info.state);
      el.setAttribute('data-bc-sticky-label', stickyBadgeText(info));
      touched.push(el);
    }
    return () => {
      for (const el of touched) {
        el.removeAttribute('data-bc-sticky');
        el.removeAttribute('data-bc-sticky-label');
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** 当前选中元素的 sticky 信息（属性面板显示提示用） */
export function useSelectedStickyInfo(): StickyInfo | null {
  const selectedId = useScene((s) => s.scene.selectedId);
  const root = useScene((s) => s.scene.root);
  if (!selectedId) return null;
  const node = findById(root, selectedId);
  return readSticky((node?.style ?? {}) as Record<string, string | undefined>);
}
