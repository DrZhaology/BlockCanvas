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
  let left = cr.left;
  let right = cr.right;
  let top = Math.max(wr.top, 0);
  let bottom = Math.min(wr.bottom, window.innerHeight);

  /**
   * v0.4.6 竖屏（data-shell='stack'）：**不要**和面板求交。
   *
   * 竖屏下左右面板是 `position: absolute` 的覆盖层、并且靠 translateX 收到屏幕外，
   * 它们的 getBoundingClientRect 落在画布外面（实测 right-pane-wrap x=420、w=379）。
   * 拿这些矩形去和视口带求交，会把红框收成一条 48px 的窄条
   * （截图里画布右侧那块莫名其妙的红色竖条就是它）。
   *
   * 而竖屏根本不需要这段逻辑：
   *   · 顶部没有任何栏（标题栏与多标签页条都不渲染）；
   *   · 底部两条操作栏是 `.app` 的**普通 flex 子项**，不在 `.canvas-wrap` 里，
   *     wrap 的矩形本身就是"真正能看见的那块"。
   * 所以直接用 wrap 的矩形。
   */
  const shell = document.querySelector('.app')?.getAttribute('data-shell');
  if (shell === 'stack') {
    return { left, right, top, bottom };
  }

  /**
   * ⚠ 用户反馈（实测图）："底部的边界墙不太对，bottom 的时候就会跑到最底部菜单下面，
   * 注意底部菜单上面算作浏览器视口；定位到左下/右下角时有部分跑到视口外。"
   *
   * 原因是布局是「底部元素面板」时，画布容器**伸到面板下面**（grid 里那块是被盖住的），
   * 于是 `.canvas-wrap` 的 rect 底边比"真正能看见的底"更低。这里把视口带
   * 和**周围面板的真实矩形**求交：
   *   · 面板在视口带下方 → 视口底下移到面板顶；
   *   · 面板在视口带上方 → 视口顶上移到面板底；
   *   · 面板在左右两侧且纵向穿过视口带 → 视口左右边界收进来。
   * 这样"底部菜单上面"才真的等于浏览器视口底。
   */
  const panels = Array.from(document.querySelectorAll('.toolbar, .project-tab-bar, .elem-pane-wrap, .right-pane-wrap, .snapshot-info-panel'));
  for (const p of panels) {
    const el = p as HTMLElement;
    if (!el || el === wrap) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const overlapX = Math.min(right, r.right) - Math.max(left, r.left) > 1;
    const overlapY = Math.min(bottom, r.top) - Math.max(top, r.bottom) > 1;
    // 面板压在视口带的下方（底部元素面板）
    if (overlapX && r.top >= top + 1 && r.top < bottom) bottom = Math.min(bottom, r.top);
    // 面板压在视口带的上方（工具栏 / 页签栏）
    if (overlapX && r.bottom > top && r.bottom <= bottom) top = Math.max(top, r.bottom);
    // 侧边面板纵向穿过视口带 → 收左右
    if (overlapY || (r.top <= top && r.bottom >= bottom)) {
      if (r.left > left && r.left < right) right = Math.min(right, r.left);
      if (r.right > left && r.right <= right) left = Math.max(left, r.right);
    }
  }
  if (bottom < top) bottom = top;
  if (right < left) right = left;
  return { left, right, top, bottom };
}

/**
 * 把「画布内浏览器视口」写进 CSS 变量，并让 fixed 元素钉在视口上。
 *
 * v0.4.6 重做（用户第三次反馈 fixed 依然不对）：
 *
 * 以前 fixed 元素的**包含块是 `.canvas`（整张画布）**，于是：
 *   · `bottom: 0` 解析成"画布底" —— 画布随内容长，元素直接跑到页面最底、越出视口；
 *   · 对齐到左下/右下角时，元素突破红框（用户实测的两个角）；
 *   · 面板里明明只有 left/top 两条，画布上却是按四条算的。
 *
 * 现在改成：画布里放一层 `.canvas-fixed-layer`，**尺寸和位置就等于红框**，
 * 并让它成为 fixed 后代的包含块（它自己带 translate，天然构成包含块）。
 * 于是 fixed 元素的 left/top/right/bottom 全部相对**视口**解析 —— 与浏览器完全一致：
 *   · `bottom: 0` = 贴视口底，无论画布多长；
 *   · 四角对齐就是四角，不会越界；
 *   · 面板里两条偏移，画布上就只按两条摆。
 *
 * 这里负责写四个几何量（画布 padding 盒坐标系，即绝对定位子元素的 0 点）：
 *   --bc-fl-left / --bc-fl-top / --bc-fl-w / --bc-fl-h
 * 外加让整层跟着滚动位移抵消的 --bc-fixed-shift。
 */
export function applyFixedShift(canvasEl: HTMLElement | null): void {
  if (!canvasEl) return;
  const vp = measureFixedViewport(canvasEl);
  if (!vp) return;
  const cr = canvasEl.getBoundingClientRect();
  const zoom = cr.width > 0 && canvasEl.offsetWidth > 0 ? cr.width / canvasEl.offsetWidth : 1;
  const z = zoom || 1;
  const wrap = canvasEl.closest('.canvas-wrap') as HTMLElement | null;

  /* 画布 padding 盒的左上角（client 坐标）。
     `clientLeft/clientTop` 是未缩放的 CSS 像素，要乘回 zoom 才能和 getBoundingClientRect 对齐。

     ⚠⚠ v0.4.7 修（一个把画布滚动彻底搞坏的 BUG）：
     视口层是 `position: absolute` + `translate: 0 var(--bc-fixed-shift)`，
     也就是说"滚动"由 translate 单独负责，`--bc-fl-top` 必须是**滚动不变量**。
     但 padTop 是**当前**滚动位置下的 client 坐标 —— 滚 2000 它比原来小 2000，
     于是 (vp.top - padTop) 凭空多出 2000，再加上 translate 的 2000，
     视口层一路滑到页面底部（实测滚 2000 后 top=4000，它把 scrollHeight 从 3064 顶到 4534）
     → 滚动条越滚越短、滑块永远停在中间、fixed 元素也跟着跑。
     所以这里把已经滚掉的量**减掉**，得到"滚动到 0 时"的那个偏移。
     （符号很快能验：滚 S 之后 cr.top 变成 cr.top₀ - S，要让结果等于 cr.top₀，
       就是 (vp.top - (cr.top₀ - S) - S)。） */
  const scrolledY = wrap?.scrollTop ?? 0;
  const scrolledX = wrap?.scrollLeft ?? 0;
  const padLeft = cr.left + canvasEl.clientLeft * z;
  const padTop = cr.top + canvasEl.clientTop * z;
  canvasEl.style.setProperty('--bc-fl-left', `${(vp.left - padLeft - scrolledX) / z}px`);
  canvasEl.style.setProperty('--bc-fl-top', `${(vp.top - padTop - scrolledY) / z}px`);
  canvasEl.style.setProperty('--bc-fl-w', `${Math.max(0, vp.right - vp.left) / z}px`);
  canvasEl.style.setProperty('--bc-fl-h', `${Math.max(0, vp.bottom - vp.top) / z}px`);

  /**
   * 位移量 = 滚动容器滚了多少（换算回画布内容坐标）。
   *
   * ⚠ 不能用 `vp.top - cr.top`：那是"画布顶相对视口顶"的差，里面还混着 wrap 的
   * padding-top（画布纸面留白），会少补一截 —— 第一版就是这么写的，实测滚 400
   * 只补了 376，元素飘了 24px。用 scrollTop / zoom 才是"内容被推上去多少"。
   */
  const shiftPx = Math.max(0, (wrap?.scrollTop ?? 0) / z);
  canvasEl.style.setProperty('--bc-fixed-shift', `${Math.round(shiftPx)}px`);
  // 视口高度也写出来，方便界面上标注（"视口 1280 × 764"）
  canvasEl.style.setProperty('--bc-fixed-vh', `${Math.round((vp.bottom - vp.top) / z)}px`);
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
