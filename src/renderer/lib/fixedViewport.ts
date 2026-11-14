// ============================================================================
// BlockCanvas · 画布内「浏览器视口」（v0.4.6 · fixed 的参照面）
// ----------------------------------------------------------------------------
// 用户原话：
//   「把浏览器的视口，在画布内部做成一个也是固定的像浏览器一样的视口：画布的左右就是
//     左边缘和右边缘，上下边缘根据工具栏的变化始终变化。在工具栏下面，下方插入元素面板
//     的上面，面板变了，这个视口也变。视口始终固定。呈现矩形，固定红色。
//     Alt 的时候，fixed 的元素就只能在这个视口内部移动。同时不会触发画布的上下滚动。」
//
// 为什么要它：以前 `fixed` 的参照物是**整张画布**（画布随内容长，短页面 600、长页面 3000），
// 于是 `bottom: 0` 永远贴不到"首屏底部"，长页面上又跑得没影 —— 这就是用户说的
// "我插入的 div 已经在 2400px 的 div 下面了，改成 fixed 直接乱了"。
//
// 现在的定义：
//   · 左右 = 画布左右边缘（页面宽度就是浏览器视口宽度）；
//   · 上下 = `.canvas-wrap` 的**可见带**（工具栏下面、插入元素面板上面）——
//     面板一改高度，这条带子跟着变，fixed 的可动范围也跟着变；
//   · 元素滚动时**钉在视口上**（浏览器里 fixed 就是这样），靠给 .canvas 写
//     `--bc-fixed-shift` 抵消滚动位移实现；
//   · 缩放画布 / 拖动画布宽度时 fixed 元素**暂时隐藏**（用户："显示了反麻烦"）——
//     那时候画布尺寸和视口不成比例，画出来的位置一定是骗人的。
// ============================================================================

export interface FixedViewport {
  /** 屏幕坐标（client） */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 量出当前"画布内浏览器视口"的屏幕矩形 */
export function measureFixedViewport(canvasEl: HTMLElement | null): FixedViewport | null {
  if (!canvasEl) return null;
  const wrap = canvasEl.closest('.canvas-wrap') as HTMLElement | null;
  const cr = canvasEl.getBoundingClientRect();
  if (!wrap) return { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom };
  const wr = wrap.getBoundingClientRect();
  return {
    left: cr.left,
    right: cr.right,
    // 上下取可见带：内容滚到 wrap 的 padding 下面时也不会算进去
    top: Math.max(wr.top, 0),
    bottom: Math.min(wr.bottom, window.innerHeight)
  };
}

/**
 * 把 `fixed` 元素钉在视口上：写 `--bc-fixed-shift`（画布内容坐标系里的位移）。
 *
 * 推导：`.canvas` 有 `transform: scale(zoom)`，所以它是 fixed 后代的**包含块**，
 * fixed 元素的 top 是"距画布顶"的距离。要让它看起来"距视口顶"，就得补上
 * 画布顶相对视口顶偏移的那段 —— 滚动时画布顶跑到视口顶上面，位移为正。
 */
export function applyFixedShift(canvasEl: HTMLElement | null): void {
  if (!canvasEl) return;
  const vp = measureFixedViewport(canvasEl);
  if (!vp) return;
  const cr = canvasEl.getBoundingClientRect();
  const zoom = cr.width > 0 && canvasEl.offsetWidth > 0 ? cr.width / canvasEl.offsetWidth : 1;
  const wrap = canvasEl.closest('.canvas-wrap') as HTMLElement | null;
  /**
   * 位移量 = 滚动容器滚了多少（换算回画布内容坐标）。
   *
   * ⚠ 不能用 `vp.top - cr.top`：那是"画布顶相对视口顶"的差，里面还混着 wrap 的
   * padding-top（画布纸面留白），会少补一截 —— 第一版就是这么写的，实测滚 400
   * 只补了 376，元素飘了 24px。用 scrollTop / zoom 才是"内容被推上去多少"。
   */
  const shiftPx = Math.max(0, (wrap?.scrollTop ?? 0) / (zoom || 1));
  canvasEl.style.setProperty('--bc-fixed-shift', `${Math.round(shiftPx)}px`);
  // 视口高度也写出来，方便界面上标注（"视口 1280 × 764"）
  canvasEl.style.setProperty('--bc-fixed-vh', `${Math.round((vp.bottom - vp.top) / (zoom || 1))}px`);
}

/**
 * 缩放/改宽度期间把 fixed 元素藏起来（用户要求）。
 * 用 body 上的类 + 一个短定时器：连续滚轮缩放时不断续命，停手 420ms 后恢复。
 */
let hideTimer = 0;
export function hideFixedTemporarily(): void {
  document.body.classList.add('bc-fixed-hidden');
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => document.body.classList.remove('bc-fixed-hidden'), 420);
}
