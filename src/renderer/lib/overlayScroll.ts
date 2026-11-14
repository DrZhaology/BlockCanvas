// ============================================================================
// BlockCanvas · 自绘滚动条（v0.4.6）
// ----------------------------------------------------------------------------
// 用户原话：
//   「滚动条不要在浏览器自带的改样式了，滚动条是有体积的，在文档流，所以有时候会抽搐，
//     这个要改的代码比较多。滚动条你直接自己写一个，脱离文档流的，这样根源解决抽搐。
//     横屏也简单显示。这个样式极简，只有一个长条圆角的竖条或者横条，有轻微的交互。」
//
// 为什么必须"自己画"：
//   浏览器原生滚动条**占布局宽度**。一条 9px 的竖条出现/消失，内容可用宽度就 9px 抖动
//   —— 表现就是面板里的文字、按钮在滚动到临界点时"抽一下"。以前用 `scrollbar-gutter: stable`
//   占位去打补丁，但那只解决了"宽度跳"，没解决"滚动条本身难看且粗细不可控"。
//
// 现在的做法（业内叫 overlay scrollbar）：
//   · 原生滚动条**彻底隐藏**（`scrollbar-width: none` + `::-webkit-scrollbar { display:none }`）
//     → 不再占宽度，也不再因为出现/消失导致重排；
//   · 自己画一根 3px 的圆角长条，`position: fixed` 贴在滚动容器右边缘/下边缘
//     （fixed 是"脱离文档流"的关键：它不参与任何布局计算，画在哪都不影响内容）；
//   · 滚动时才显形、静止 0.9s 后淡出，悬停加粗到 5px，可以按住拖 —— 就是"轻微的交互"。
//
// 三条硬约束（踩过坑才知道）：
//   1. **绝不能进布局**：thumb 一律 position:fixed + pointer-events:auto 仅在自己身上；
//   2. **不能让滚动事件卡帧**：滚动回调只做一次 rAF 合批，不在事件里读 getBoundingClientRect
//      之外的任何东西，也不触发 React 渲染（纯 DOM 操作）；
//   3. **画布里的用户页面不接管**：`.canvas` 内是用户设计的那张网页，它的滚动条应当和
//      导出后一模一样，所以那条子树保持浏览器原生滚动条（CSS 里做的例外）。
// ============================================================================

/** 竖条宽度（静止）；悬停加粗到 5px 由 CSS 负责 */
const BAR_W = 3;
/** 两端的留白：贴容器内边缘，但不糊住内容 */
const INSET = 2;
/** 最短的滑块（内容再长也不至于细成一根线，拖不住） */
const MIN_LEN = 26;
/** 静止多久后淡出 */
const FADE_MS = 900;

interface Track {
  el: HTMLElement;
  /** 竖向滑块 */
  v: HTMLDivElement | null;
  /** 横向滑块 */
  h: HTMLDivElement | null;
  /** 尺寸/内容变化的观察者 */
  ro?: ResizeObserver;
  mo?: MutationObserver;
  fadeTimer: number;
}

const tracks = new Map<HTMLElement, Track>();
let layer: HTMLDivElement | null = null;
let installed = false;
/** 滚动/尺寸变化合批到一帧 */
let rafId = 0;

function ensureLayer(): HTMLDivElement {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'bc-osb-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

/** 这个元素现在需不需要滚动条？ */
function measurable(el: HTMLElement): { y: boolean; x: boolean } {
  const st = getComputedStyle(el);
  const auto = (v: string) => v === 'auto' || v === 'scroll' || v === 'overlay';
  const y = auto(st.overflowY) && el.scrollHeight > el.clientHeight + 1;
  const x = auto(st.overflowX) && el.scrollWidth > el.clientWidth + 1;
  return { y, x };
}

function makeBar(axis: 'y' | 'x'): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'bc-osb-thumb is-' + axis;
  d.dataset.axis = axis;
  return d;
}

function drop(t: Track) {
  t.v?.remove();
  t.h?.remove();
  t.ro?.disconnect();
  t.mo?.disconnect();
  window.clearTimeout(t.fadeTimer);
  tracks.delete(t.el);
}

function schedule() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    for (const t of tracks.values()) paint(t);
  });
}

/** 把一条 thumb 摆到该在的位置（纯几何，不读除 rect 之外的布局） */
function paint(t: Track) {
  const el = t.el;
  if (!el.isConnected) { drop(t); return; }
  const need = measurable(el);
  const r = el.getBoundingClientRect();
  const inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
    r.top < window.innerHeight && r.left < window.innerWidth;

  // —— 竖向 ——
  if (need.y && inView) {
    if (!t.v) { t.v = makeBar('y'); ensureLayer().appendChild(t.v); bindDrag(t, t.v, 'y'); }
    const ratio = el.clientHeight / Math.max(1, el.scrollHeight);
    const len = Math.max(MIN_LEN, Math.round(r.height * ratio));
    const maxScroll = el.scrollHeight - el.clientHeight;
    const top = r.top + INSET + (maxScroll > 0 ? (el.scrollTop / maxScroll) * (r.height - len - INSET * 2) : 0);
    const right = window.innerWidth - r.right;
    const show = el.matches(':hover') || Date.now() - (t as unknown as { lastScroll: number }).lastScroll < FADE_MS;
    Object.assign(t.v.style, {
      left: `${Math.round(window.innerWidth - right - INSET - BAR_W)}px`,
      top: `${Math.round(top)}px`,
      width: `${BAR_W}px`,
      height: `${len}px`
    } as CSSStyleDeclaration);
    t.v.classList.toggle('is-visible', show);
  } else if (t.v) {
    t.v.remove(); t.v = null;
  }

  // —— 横向 ——
  if (need.x && inView) {
    if (!t.h) { t.h = makeBar('x'); ensureLayer().appendChild(t.h); bindDrag(t, t.h, 'x'); }
    const ratio = el.clientWidth / Math.max(1, el.scrollWidth);
    const len = Math.max(MIN_LEN, Math.round(r.width * ratio));
    const maxScroll = el.scrollWidth - el.clientWidth;
    const left = r.left + INSET + (maxScroll > 0 ? (el.scrollLeft / maxScroll) * (r.width - len - INSET * 2) : 0);
    const show = el.matches(':hover') || Date.now() - (t as unknown as { lastScroll: number }).lastScroll < FADE_MS;
    Object.assign(t.h.style, {
      left: `${Math.round(left)}px`,
      top: `${Math.round(r.bottom - INSET - BAR_W)}px`,
      width: `${len}px`,
      height: `${BAR_W}px`
    } as CSSStyleDeclaration);
    t.h.classList.toggle('is-visible', show);
  } else if (t.h) {
    t.h.remove(); t.h = null;
  }
}

/** 按住滑块拖动 = 滚动容器（鼠标拖拽是最容易被忽略但绝不能缺的一条） */
function bindDrag(t: Track, bar: HTMLDivElement, axis: 'y' | 'x') {
  bar.addEventListener('pointerdown', (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    bar.setPointerCapture(ev.pointerId);
    bar.classList.add('is-dragging');
    const el = t.el;
    const start = axis === 'y' ? ev.clientY : ev.clientX;
    const startScroll = axis === 'y' ? el.scrollTop : el.scrollLeft;
    const r = el.getBoundingClientRect();
    const trackLen = axis === 'y' ? r.height : r.width;
    const barLen = axis === 'y' ? bar.offsetHeight : bar.offsetWidth;
    const maxScroll = axis === 'y'
      ? el.scrollHeight - el.clientHeight
      : el.scrollWidth - el.clientWidth;
    const perPx = maxScroll / Math.max(1, trackLen - barLen);
    const move = (e: PointerEvent) => {
      const d = (axis === 'y' ? e.clientY : e.clientX) - start;
      if (axis === 'y') el.scrollTop = startScroll + d * perPx;
      else el.scrollLeft = startScroll + d * perPx;
      markScrolled(t);
      schedule();
    };
    const up = () => {
      bar.classList.remove('is-dragging');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });
}

function markScrolled(t: Track) {
  (t as unknown as { lastScroll: number }).lastScroll = Date.now();
  if (t.v) t.v.classList.add('is-visible');
  if (t.h) t.h.classList.add('is-visible');
  window.clearTimeout(t.fadeTimer);
  t.fadeTimer = window.setTimeout(() => {
    t.v?.classList.remove('is-visible');
    t.h?.classList.remove('is-visible');
  }, FADE_MS);
}

/** 登记一个滚动容器 */
function observe(el: HTMLElement) {
  if (tracks.has(el)) return;
  const need = measurable(el);
  if (!need.y && !need.x) return;
  const t: Track = { el, v: null, h: null, fadeTimer: 0 };
  (t as unknown as { lastScroll: number }).lastScroll = 0;
  tracks.set(el, t);
  try {
    t.ro = new ResizeObserver(() => schedule());
    t.ro.observe(el);
  } catch { /* 老内核没有也不影响主流程 */ }
  schedule();
}

/** 扫描一棵子树里所有"能滚的"元素 */
function scan(root: ParentNode) {
  if (!(root instanceof HTMLElement) && !(root instanceof Document)) return;
  if (root instanceof HTMLElement) {
    if (root.matches('.canvas, .canvas *')) { /* 用户页面不接管 */ }
    else if (!root.closest('.canvas')) observe(root);
  }
  const all = (root as ParentNode).querySelectorAll?.('.app *, [data-bc-scroll]');
  if (!all) return;
  for (const n of all) {
    if (!(n instanceof HTMLElement)) continue;
    if (n.closest('.canvas')) continue;      // 用户设计的页面保持原生滚动条
    observe(n);
  }
}

/**
 * 装上自绘滚动条。**全程序只调一次**（App 挂载时）。
 * 返回卸载函数，供热更新 / 探针清理用。
 */
export function installOverlayScrollbars(): () => void {
  if (installed) return () => { /* 已装 */ };
  installed = true;
  ensureLayer();

  const onScroll = (ev: Event) => {
    const t = ev.target;
    if (t instanceof HTMLElement) {
      const track = tracks.get(t);
      if (track) markScrolled(track);
    }
    schedule();
  };
  // capture 阶段拿得到所有滚动（scroll 不冒泡）
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  const onResize = () => schedule();
  window.addEventListener('resize', onResize);

  // 新出现的面板 / 抽屉 / 弹层 → 自动接管
  const mo = new MutationObserver((records) => {
    let dirty = false;
    for (const rec of records) {
      for (const n of rec.addedNodes) {
        if (n instanceof HTMLElement) { scan(n); dirty = true; }
      }
    }
    if (dirty) schedule();
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // 初始一轮（等首屏渲染完）
  requestAnimationFrame(() => scan(document));
  // 切换视图 / 切标签后布局会变，低频补扫（800ms 一次，几乎无成本）
  const tick = window.setInterval(() => schedule(), 800);

  return () => {
    installed = false;
    document.removeEventListener('scroll', onScroll, { capture: true } as never);
    window.removeEventListener('resize', onResize);
    mo.disconnect();
    window.clearInterval(tick);
    for (const t of [...tracks.values()]) drop(t);
    layer?.remove();
    layer = null;
  };
}
