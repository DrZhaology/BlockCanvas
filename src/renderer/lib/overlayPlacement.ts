// BlockCanvas · 浮层统一「避让」机制（v0.4.5）
//
// 要解决的问题（用户原话）：
//   ①「中键选中元素弹出的那个框，有些部分会被下方工具栏拦住」；
//   ②「一些弹窗元素的统一的『避让』机制也要统一」；
//   ③「点击 var 按钮的弹出框有时候会跑到窗口外面」。
//
// 以前每个浮层各写各的定位：有的 `position:absolute; right:0`（跑到面板外就出画），
// 有的 `top: calc(100% + 4px)`（贴着屏幕底边就掉出去），有的干脆不定位交给 DOM 顺序。
// 现在统一成一个纯函数：**给锚点矩形 + 自己的尺寸，返回一个绝不会跑出窗口、
// 也不会压住"必须避让区"的位置**。
//
// 「必须避让区」= 页面上标了 `data-bc-avoid` 的元素（顶部工具栏、页签栏、底部元素面板、
// 右侧属性面板…）。这些是"用户正在用的操作区"，浮层宁可缩小/翻转也不能盖住它们。

export interface Rect { left: number; top: number; right: number; bottom: number }

export interface PlaceInput {
  /** 锚点矩形：一般是要在其旁边弹出的那个按钮/输入框的 getBoundingClientRect() */
  anchor: Rect;
  /** 浮层自身尺寸（首帧先以 visibility:hidden 渲染量出来再定位） */
  width: number;
  height: number;
  /** 水平对齐：right = 浮层右边缘对齐锚点右边缘（默认 left） */
  align?: 'left' | 'right';
  /** 与锚点的间距 */
  gap?: number;
  /** 与窗口边缘的安全边距 */
  margin?: number;
  /** 必须避让的矩形（默认由调用方用 collectAvoidRects() 采好传进来） */
  avoid?: Rect[];
  /** 空间不足时是否允许收缩高度（返回 maxHeight；false 则只保证不出窗口） */
  shrink?: boolean;
  /** 优先在上方弹出（例如锚点本身就贴着底部） */
  preferAbove?: boolean;
}

export interface Placement {
  left: number;
  top: number;
  /** 非 null 时调用方要把这个值写到浮层的 max-height 上 */
  maxHeight: number | null;
  /** 是否落在锚点上方（调用方可以据此加 `above` 类做箭头/动画方向） */
  above: boolean;
}

/**
 * 采出页面上所有 `data-bc-avoid` 元素的矩形。
 *
 * `anchorEl` = 浮层的锚点元素。**凡是"包含锚点"的避让区都跳过** ——
 * 例如属性面板里的一个 var 按钮，它本身就长在 `.right-pane-wrap` 里，
 * 那个面板是它的"家"，不是它要躲开的东西。
 */
export function collectAvoidRects(anchorEl?: Element | null): Rect[] {
  const out: Rect[] = [];
  if (typeof document === 'undefined') return out;
  document.querySelectorAll<HTMLElement>('[data-bc-avoid]').forEach((el) => {
    if (anchorEl && (el === anchorEl || el.contains(anchorEl))) return;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  });
  return out;
}

const overlapsX = (a: Rect, b: { left: number; right: number }) => a.right > b.left + 1 && a.left < b.right - 1;

/**
 * 计算浮层位置。纯函数、无副作用，方便被探针直接调用验证。
 *
 * 步骤：
 *   1. 先按"锚点下方"试放；放不下就看上方；上下都放不下 → 选空间更大的一侧并收缩高度；
 *   2. 左右夹在窗口内（永远不出窗口 —— 这就是"跑到窗口外面"的根治）；
 *   3. 逐条检查避让区：压到底部面板上就整体上移到面板上沿，压到顶部工具栏就整体下移。
 */
export function placeOverlay(input: PlaceInput): Placement {
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 6;
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
  const w = Math.min(input.width, Math.max(80, vw - margin * 2));
  const h = input.height;
  const avoid = input.avoid ?? [];

  // —— 1. 垂直方向：下方 / 上方 / 收缩 ——
  const spaceBelow = vh - margin - (input.anchor.bottom + gap);
  const spaceAbove = (input.anchor.top - gap) - margin;
  let below: boolean;
  if (input.preferAbove) below = spaceAbove >= h && spaceAbove > spaceBelow;
  else below = spaceBelow >= h || spaceBelow >= spaceAbove;
  // 翻转后仍然放不下 → 选空间更大的一侧，后面再收缩
  if (below && spaceBelow < h && spaceAbove > spaceBelow) below = false;
  if (!below && spaceAbove < h && spaceBelow > spaceAbove) below = true;

  let top = below ? input.anchor.bottom + gap : input.anchor.top - gap - h;
  let maxHeight: number | null = null;

  // 上边不能出窗口
  if (top < margin) {
    if (input.shrink !== false) {
      maxHeight = Math.max(120, input.anchor.top - gap - margin);
      top = margin;
    } else {
      top = margin;
    }
  }
  // 下边不能出窗口
  if (top + h > vh - margin) {
    const avail = vh - margin - top;
    if (input.shrink !== false) {
      // 下方空间够不够放一个"能看"的最小高度？不够就整体上移
      if (avail < 160) {
        top = Math.max(margin, vh - margin - h);
      } else {
        maxHeight = avail;
      }
    } else {
      top = Math.max(margin, vh - margin - h);
    }
  }

  // —— 2. 水平方向：夹在窗口内 ——
  const rawLeft = (input.align ?? 'left') === 'right' ? input.anchor.right - w : input.anchor.left;
  let left = Math.min(Math.max(margin, rawLeft), Math.max(margin, vw - w - margin));

  // —— 3. 避让区：不许压在"操作区"上 ——
  const effH = Math.min(h, maxHeight ?? h);
  for (const a of avoid) {
    const rect = { left, right: left + w, top, bottom: top + effH };
    if (!(rect.bottom > a.top + 1 && rect.top < a.bottom - 1)) continue;
    if (!overlapsX(a, rect)) continue;
    const isBottomBar = a.top > vh * 0.5;
    if (isBottomBar) {
      const newTop = a.top - gap - effH;
      if (newTop >= margin) {
        top = newTop;
      } else {
        // 上移放不下 → 压到顶部工具栏之下，并收缩
        const lower = avoid.filter((x) => x.top <= vh * 0.5).reduce((m, x) => Math.max(m, x.bottom), margin);
        top = lower + gap;
        maxHeight = Math.max(120, a.top - gap - top);
      }
    } else {
      top = a.bottom + gap;
      maxHeight = Math.max(120, vh - margin - top);
    }
  }

  return { left: Math.round(left), top: Math.round(top), maxHeight, above: !below };
}

/** 便捷版：直接吃 DOM 元素（第一次量尺寸用） */
export function placeOverlayForAnchor(
  anchorEl: Element,
  panelEl: Element,
  opts: { align?: 'left' | 'right'; gap?: number; margin?: number; shrink?: boolean; preferAbove?: boolean } = {}
): Placement {
  const a = anchorEl.getBoundingClientRect();
  const p = panelEl.getBoundingClientRect();
  return placeOverlay({
    anchor: { left: a.left, top: a.top, right: a.right, bottom: a.bottom },
    width: p.width,
    height: p.height,
    avoid: collectAvoidRects(anchorEl),
    ...opts
  });
}