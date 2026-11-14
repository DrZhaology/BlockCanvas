// BlockCanvas · Alt 交互的「状态 + 事件接线」
//
// 这个 hook 只负责三件事：
//   ① 存状态（悬停 / 拖拽 ref / 覆盖层要的数据）
//   ② 接事件（pointermove、pointerdown capture、wheel）
//   ③ 把每帧的计算交给 altDragMove.ts（那边是纯计算，改起来不影响 React 生命周期）
//
// 依赖：geometry.ts 提供几何/盒模型，walls.ts 提供墙与吸附，"墙外改父子关系"的实现保留但默认关闭。
import { useRef, useState } from 'react';
import { findNode, useScene } from '@store/sceneStore';
import { MEDIA_TAGS, TEXT_TAGS } from '@lib/types';
import { boundsFor, ALT_REPARENT_ENABLED } from './walls';
import { contentBoxOf, hasSideValue, pickAxisSide, readBoxModel, edgeAt } from './geometry';
import { applyAltDragMove, finishAltDrag, type AltDragCtx } from './altDragMove';
import type { AltBoxModelData, AltDragState, AltHover, Bar, Bounds } from './types';

/** 播放锁定时要定格的帧：30fps 的第 30 帧 ≈ 1 秒 */
export const LOCK_FRAME_SEC = 1;

export type AltDragOptions = {
  /** 当前缩放（要 ÷ zoom 才能把 client px 换成 CSS px） */
  zoom: number;
  /** 基准视口高度（fixed 的空气墙 / 首屏线） */
  viewportHeight?: number;
  /** 画布元素（fixed 的包含块 = 它，相当于浏览器视口） */
  canvasRef: React.RefObject<HTMLDivElement | null>;
  /** Ctrl+滚轮缩放请求 */
  onZoomChange?: (next: number) => void;
  /** 中键点击元素 = 打开属性搜索框 */
  onMiddlePress?: (id: string, x: number, y: number) => void;
};

export function useAltDrag({ zoom, viewportHeight = 900, canvasRef, onZoomChange, onMiddlePress }: AltDragOptions) {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const viewportHeightRef = useRef(viewportHeight);
  viewportHeightRef.current = viewportHeight;

  const [altHover, setAltHover] = useState<AltHover | null>(null);
  const altHoverRef = useRef<AltHover | null>(null);
  altHoverRef.current = altHover;

  // Alt 拖拽中"实时边界框"的 rAF 句柄：样式写入 → React 提交 → 下一帧量真实 rect 再画框，
  // 保证拖动过程中橙色边界 1:1 跟手（以前拖动时框直接消失，松手才回来）
  const altLiveRaf = useRef(0);
  const [altBadge, setAltBadge] = useState<{ x: number; y: number; text: string } | null>(null);
  // v0.4.4：Alt 拖动时临时把画布加长（向下拖到边也能继续走），松手恢复原长度
  const [altPad, setAltPad] = useState(0);
  const altPadRef = useRef(0);
  // v0.4.5：按住 Alt 拖动时，按浏览器 F12 的方式把盒模型画出来
  const [boxModel, setBoxModel] = useState<AltBoxModelData | null>(null);
  /**
   * Alt+滚轮之后的短暂"不要弹盒模型"窗口（v0.4.5 第十六批）。
   * 用户原话：「Alt + 滚轮不要触发页面上的盒模型显示。」
   * 滚轮本身会带出 pointermove 事件，若不挡一下，刚清掉的盒模型会立刻又出现。
   */
  const wheelNoBoxUntil = useRef(0);
  // 撞到"墙"时闪一下的那条边（橙色），告诉用户"这是限制不是 BUG"
  const [wallFlash, setWallFlash] = useState<Bar | null>(null);
  // Alt 拖动中"当前可达边界"的常显提示线（橙色细线）
  const [wallHints, setWallHints] = useState<Bar[]>([]);
  const [dropTarget, setDropTarget] = useState<{ id: string; rect: { x: number; y: number; w: number; h: number } } | null>(null);
  // Alt 移动时的"吸附对齐参考线"（PowerPoint 风格）
  const [guides, setGuides] = useState<{ x: number | null; y: number | null; box: { left: number; top: number; right: number; bottom: number } | null } | null>(null);
  const wallFlashTimer = useRef(0);
  // v0.4.5：「拿着元素」（改父子关系）时的鼠标幽灵 + 停留 1 秒预览
  const altGhostRef = useRef<HTMLElement | null>(null);
  const altPreviewTimer = useRef(0);
  const altPreviewRef = useRef<string | null>(null);
  const altDragRef = useRef<AltDragState | null>(null);
  // 被标了 Alt 光标属性的元素（CSS 按 data-bc-alt 切换 resize/move/pointer 光标）
  const altTaggedRef = useRef<HTMLElement | null>(null);

  // ── 幽灵 / 墙闪烁 / 光标标记 这些小工具（与计算无关，留在这里） ──────────────
  const spawnAltGhost = (srcEl: HTMLElement, rect: DOMRect) => {
    if (altGhostRef.current) return;
    const g = srcEl.cloneNode(true) as HTMLElement;
    g.removeAttribute('data-bc-id');
    g.querySelectorAll('[data-bc-id]').forEach((n) => n.removeAttribute('data-bc-id'));
    g.classList.add('bc-alt-ghost');
    // 按元素真实大小定缩放：小元素 0.5 倍；很高的元素压到 ~200px 高，避免幽灵过大
    const sc = Math.min(0.5, Math.max(0.16, 200 / Math.max(rect.height, 80)));
    g.style.transform = `translate(0, 0) scale(${sc})`;
    document.body.appendChild(g);
    altGhostRef.current = g;
  };
  const moveAltGhost = (x: number, y: number) => {
    const g = altGhostRef.current;
    if (!g) return;
    g.style.transform = g.style.transform.replace(/translate\([^)]*\)/, `translate(${x + 18}px, ${y + 18}px)`);
  };
  const removeAltGhost = () => {
    window.clearTimeout(altPreviewTimer.current);
    altPreviewRef.current = null;
    document.querySelectorAll('.bc-drop-preview').forEach((n) => n.classList.remove('bc-drop-preview'));
    altGhostRef.current?.remove();
    altGhostRef.current = null;
  };
  const flashWall = (b: Bar | null) => {
    if (!b) return;
    setWallFlash(b);
    window.clearTimeout(wallFlashTimer.current);
    wallFlashTimer.current = window.setTimeout(() => setWallFlash(null), 620);
  };
  const tagAltCursor = (el: HTMLElement | null, kind: string) => {
    if (altTaggedRef.current && altTaggedRef.current !== el) {
      altTaggedRef.current.removeAttribute('data-bc-alt');
      altTaggedRef.current = null;
    }
    if (el) {
      el.setAttribute('data-bc-alt', kind);
      altTaggedRef.current = el;
    }
  };

  // ── 每帧用的上下文（传给 altDragMove.ts） ────────────────────────────────────
  const ctx: AltDragCtx = {
    zoomRef, viewportHeightRef, canvasRef, altPadRef,
    setAltPad, setWallHints, setAltBadge, setGuides, setDropTarget, setBoxModel,
    flashWall, spawnAltGhost, moveAltGhost, removeAltGhost,
    altPreviewTimer, altPreviewRef,
    scheduleAltLiveBox: () => scheduleAltLiveBox(),
    normalizePositionedMargin: (d) => normalizePositionedMargin(d),
    growCanvasForDrag: (y) => growCanvasForDrag(y)
  };

  /** Alt 拖拽进行中：下一帧量一次元素真实 rect，让悬停高亮框实时跟随（拖动中不再消失） */
  const scheduleAltLiveBox = () => {
    if (altLiveRaf.current) return;
    altLiveRaf.current = requestAnimationFrame(() => {
      altLiveRaf.current = 0;
      const d = altDragRef.current;
      if (!d) return;
      const el = document.querySelector(`.canvas [data-bc-id="${CSS.escape(d.id)}"]`) as HTMLElement | null;
      if (!el) return;
      try {
        const r = el.getBoundingClientRect();
        setAltHover({ id: d.id, edge: d.edge, mode: d.mode, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
        setBoxModel(readBoxModel(el, useScene.getState().scene.root));
      } catch { /* 忽略 */ }
    });
  };

  /**
   * v0.4.5：把定位元素的 margin 折算进偏移、并把 margin 归零。
   *
   * 用户反馈：「我是说在更改 position 的时候，有些状态例如 fixed 要能拖动的时候 margin
   * 也能自动修改，现在 margin 被锁死了用起来很难受！」
   *
   * 原因：`absolute` / `fixed` 的视觉位置 = 偏移(left/top/right/bottom) + margin。
   * 元素一旦带上 `margin: auto`（「水平居中」就是写这个）或一个非零 margin，
   * 拖动只改偏移，margin 把差量全吃掉 —— 表现出来就是"拖了没反应"。
   *
   * 做法（一条撤销、视觉位置不变）：把当前 rect 到包含块的距离量出来，直接写成偏移，
   * 同时把四边 margin 归零。这样之后每一像素拖动都 1:1 落在元素上。
   */
  const normalizePositionedMargin = (d: AltDragState) => {
    if (d.posKind !== 'absolute' && d.posKind !== 'fixed') return;
    const el = document.querySelector(`.canvas [data-bc-id="${CSS.escape(d.id)}"]`) as HTMLElement | null;
    if (!el) return;
    const cs = getComputedStyle(el);
    const z = zoomRef.current || 1;
    const vals = [cs.marginLeft, cs.marginRight, cs.marginTop, cs.marginBottom].map((v) => parseFloat(v) || 0);
    const style = (findNode(useScene.getState().scene.root, d.id)?.style ?? {}) as Record<string, string | undefined>;
    const hasAuto = (['marginLeft', 'marginRight', 'marginTop', 'marginBottom'] as const)
      .some((k) => String(style[k] ?? '').trim() === 'auto');
    if (!hasAuto && vals.every((v) => v === 0)) return; // 本来就是干净的
    const cbEl = d.isFixed
      ? (el.closest('.canvas') as HTMLElement | null)
      : (el.offsetParent as HTMLElement | null);
    if (!cbEl) return;
    const cb = contentBoxOf(cbEl);
    const r = el.getBoundingClientRect();
    const offL = (r.left - cb.left) / z;
    const offT = (r.top - cb.top) / z;
    const offR = (cb.right - r.right) / z;
    const offB = (cb.bottom - r.bottom) / z;
    const patch: Record<string, string | undefined> = {
      marginLeft: '0', marginRight: '0', marginTop: '0', marginBottom: '0'
    };
    /**
     * v0.4.6：**钉住的轴不许归一化**。
     *
     * 「居中钉死」的写法是「两侧 0 + 外边距 auto」。这段归一化会把 margin 抹成 0、
     * 只留一侧的偏移 —— 等于一拖动就把钉死拆了（实测：left:0/right:0/margin:auto
     * 拖完变成 left:401/margin:0）。所以先认出钉住的轴，跳过它。
     */
    const on = (v?: string) => v !== undefined && v !== '' && v !== 'auto';
    const auto = (v?: string) => (v ?? '') === 'auto';
    const pinX = on(style.left) && on(style.right) && auto(style.marginLeft) && auto(style.marginRight);
    const pinY = on(style.top) && on(style.bottom) && auto(style.marginTop) && auto(style.marginBottom);
    d.pinX = pinX;
    d.pinY = pinY;
    if (pinX) { delete patch.marginLeft; delete patch.marginRight; }
    if (pinY) { delete patch.marginTop; delete patch.marginBottom; }
    if (!pinX) {
      if (d.axisSide.x === 'right') { patch.right = Math.round(offR) + 'px'; patch.left = undefined; }
      else { patch.left = Math.round(offL) + 'px'; patch.right = undefined; }
    }
    if (!pinY) {
      if (d.axisSide.y === 'bottom') { patch.bottom = Math.round(offB) + 'px'; patch.top = undefined; }
      else { patch.top = Math.round(offT) + 'px'; patch.bottom = undefined; }
    }
    useScene.getState().updateStyle(d.id, patch as never);
    // 记录归一化后的基准，后续 resize / 方向判断都用它
    d.startLeft = d.axisSide.x === 'right' ? offR : offL;
    d.startTop = d.axisSide.y === 'bottom' ? offB : offT;
    d.startMarginL = 0;
    d.startMarginT = 0;
  };

  /**
   * v0.4.5：Alt 拖动时让画布"无限长"。
   *
   * 用户反馈：「让按住 Alt 后拖动元素的时候画布变成无限长度，不是还要我往下拖动，画布才变长。」
   * 以前只有在元素**已经撞到画布下沿**时才把画布加长 180px 一档 —— 所以体感是
   * "我得先往下拖、拖到边，画布才长一点"，非常卡顿。
   * 现在改成**按鼠标位置主动预留**：指针下方永远留半个视口的空白（且至少 400px）。
   */
  const growCanvasForDrag = (clientY: number) => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const cr = canvasEl.getBoundingClientRect();
    const need = Math.max(400, Math.ceil(clientY + window.innerHeight * 0.5 - cr.bottom));
    if (need > altPadRef.current + 40) {
      altPadRef.current = need;
      setAltPad(need);
    }
  };

  // ── 事件 ────────────────────────────────────────────────────────────────────
  const onAltDragMove = (ev: PointerEvent) => {
    const d = altDragRef.current;
    if (!d) return;
    applyAltDragMove(d, ev, ctx);
  };

  const onAltDragUp = () => {
    const d = altDragRef.current;
    altDragRef.current = null;
    if (altLiveRaf.current) { cancelAnimationFrame(altLiveRaf.current); altLiveRaf.current = 0; }
    window.removeEventListener('pointermove', onAltDragMove);
    window.removeEventListener('pointerup', onAltDragUp);
    document.body.classList.remove('bc-alt-dragging');
    document.body.classList.remove('bc-alt-fonting');
    setAltBadge(null);
    setBoxModel(null);
    setGuides(null);
    setWallHints([]);
    // 松手：画布长度恢复原样
    altPadRef.current = 0;
    setAltPad(0);
    removeAltGhost(); // 幽灵 + 停留预览一律清掉（幂等）
    if (!d) return;
    finishAltDrag(d, ctx);
  };

  // Alt 悬停：算出"鼠标下面是谁、贴着哪条边、该进入哪种模式"，并给出对应的光标
  const onWrapPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.altKey || altDragRef.current) {
      if (altHover) setAltHover(null);
      tagAltCursor(null, '');
      return;
    }
    const el = (e.target as HTMLElement)?.closest?.('.canvas [data-bc-id]') as HTMLElement | null;
    if (!el || el.getAttribute('data-bc-locked') === '1') {
      if (altHover) setAltHover(null);
      setBoxModel(null);
      tagAltCursor(null, '');
      return;
    }
    const id = el.getAttribute('data-bc-id')!;
    const node = findNode(useScene.getState().scene.root, id);
    if (!node) { if (altHover) setAltHover(null); setBoxModel(null); tagAltCursor(null, ''); return; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // 行内元素（display:inline，如 span/strong/a）不参与"贴边改大小" —— 它没有块级盒，
    // 强行 resize 既不符合直觉、也容易误触；行内文字走"左右拖改字号"。
    // v0.4.5（用户反馈 C补5）：图片/视频/音频的**默认 display 也是 inline**，
    // 但它们明明是替换元素、能正常改尺寸 —— 以前被这条一起排除，导致"多媒体完全不能缩放"。
    const isReplacedMedia = node.type === 'img' || MEDIA_TAGS.has(node.type);
    const isInline = cs.display === 'inline' && !isReplacedMedia;
    const edge = isInline ? null : edgeAt(r, e.clientX, e.clientY);
    const isText = TEXT_TAGS.has(node.type);
    const mode = edge ? 'resize' as const : isText ? 'font' as const : 'move' as const;
    // 角光标要区分两种对角：tl/br = 左上-右下(nwse)；tr/bl = 右上-左下(nesw)
    const cursorKind = mode !== 'resize' ? mode
      : edge === 'l' || edge === 'r' ? 'x'
        : edge === 't' || edge === 'b' ? 'y'
          : (edge === 'tl' || edge === 'br') ? 'nwse' : 'nesw';
    tagAltCursor(el, cursorKind);
    const next: AltHover = { id, edge, mode, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
    // v0.4.5：Alt **悬停**就把盒模型浮层显示出来（以前只在拖动中出现）。
    // 放在"位置未变就提前 return"之前 —— 否则鼠标停在同一元素上时浮层永远不会挂载。
    // ⚠ 但 Alt+滚轮刚用过的 0.8 秒内不弹（用户明确要求"滚轮不要触发盒模型"）。
    if (!altDragRef.current && Date.now() > wheelNoBoxUntil.current) setBoxModel(readBoxModel(el, useScene.getState().scene.root));
    const prev = altHoverRef.current;
    if (prev && prev.id === id && prev.edge === edge && prev.mode === mode
      && Math.abs(prev.rect.x - next.rect.x) < 0.5 && Math.abs(prev.rect.y - next.rect.y) < 0.5
      && Math.abs(prev.rect.w - next.rect.w) < 0.5 && Math.abs(prev.rect.h - next.rect.h) < 0.5) return;
    setAltHover(next);
  };

  // Alt + 按下：开始一次"可能发生的"拖拽（真正开始改样式要等指针移动超过阈值，
  // 否则单纯 Alt+单击仍按老规矩 = 选中父级）
  const onWrapPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    // 画布内任何一次按下（除了按在就地编辑框里）都先把正在编辑的文案提交掉 ——
    // 画布会 preventDefault，焦点不会转移 → 光靠 blur 不可靠，这里主动提交。
    const t0 = e.target as HTMLElement | null;
    if (!t0?.classList?.contains('canvas-inline-text-input')) {
      window.dispatchEvent(new CustomEvent('bc:commit-inline'));
    }
    // 点画布 = 离开右侧属性面板的输入框：主动 blur。
    // 画布的 pointerdown 会 preventDefault()，焦点不会自然转移 → 焦点留在输入框里，
    // 之后按 Ctrl+Z / Ctrl+Y 会被输入框"吃掉"（用户反馈：选中元素后撤销没反应）。
    const ae = document.activeElement as HTMLElement | null;
    if (ae && ae !== document.body && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)
      && !ae.closest('.canvas')) {
      ae.blur();
    }
    // 鼠标中键 = 打开"属性搜索"框（敲属性名 → Enter → 右侧面板定位高亮）
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      const el = t0?.closest?.('.canvas [data-bc-id]') as HTMLElement | null;
      if (el) onMiddlePress?.(el.getAttribute('data-bc-id')!, e.clientX, e.clientY);
      return;
    }
    if (!e.altKey || e.button !== 0) return;
    // 已经有一次 Alt 拖拽在跑：不要用新的锚点覆盖它（会造成"闪一下又回弹"）
    if (altDragRef.current) return;
    const h = altHoverRef.current;
    if (!h) return;
    e.preventDefault();
    e.stopPropagation();
    const root = useScene.getState().scene.root;
    const el = document.querySelector(`.canvas [data-bc-id="${CSS.escape(h.id)}"]`) as HTMLElement | null;
    if (!el) return;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const pos = cs.position;
    const positioned = pos === 'absolute' || pos === 'fixed' || pos === 'relative';
    const bounds: Bounds = boundsFor(el, rect, viewportHeightRef.current);
    const parentNode = findNode(root, h.id);
    const posKind = (['relative', 'absolute', 'fixed', 'sticky'] as const).includes(pos as never)
      ? (pos as 'relative' | 'absolute' | 'fixed' | 'sticky')
      : 'static';
    const isFixed = pos === 'fixed';
    // 定位基准：优先计算后的 left/top（缺省时按"当前实际位置 - 定位父级内容盒"补一个，
    // 这样 right/bottom 锚定或 left/top:auto 的元素第一次拖动不会跳变）
    // v0.4.5：**fixed 的包含块是 `.canvas`（模拟浏览器视口）**，不是它的 DOM 父元素 ——
    // 浏览器里 fixed 相对视口定位，按父元素算偏移会整体错位。
    const cbEl = isFixed
      ? (el.closest('.canvas') as HTMLElement | null)
      : (el.offsetParent as HTMLElement | null);
    const cb = cbEl ? contentBoxOf(cbEl) : null;
    const parsedLeft = parseFloat(cs.left);
    const parsedTop = parseFloat(cs.top);
    const startLeft = Number.isFinite(parsedLeft) ? parsedLeft : (cb ? rect.left - cb.left : 0);
    const startTop = Number.isFinite(parsedTop) ? parsedTop : (cb ? rect.top - cb.top : 0);
    const startMarginL = Number.isFinite(parseFloat(cs.marginLeft)) ? parseFloat(cs.marginLeft) : 0;
    const startMarginT = Number.isFinite(parseFloat(cs.marginTop)) ? parseFloat(cs.marginTop) : 0;
    // 这一趟拖动锚定在哪一边（决定后中途不再变，避免 left/right 来回争抢造成的抖动）
    const styleNow = (findNode(root, h.id)?.style ?? {}) as Record<string, string | undefined>;
    const axisSide = pickAxisSide(posKind, styleNow, rect, cb);
    /**
     * v0.4.5：**双边约束**判定 + 起始右/下偏移。
     * left+right（且没写 width）→ 横向尺寸由两边撑出来 → 拖动要"两边一起平移"；
     * top+bottom（且没写 height）同理。startRight/startBottom 取起始值，
     * 平移时用 `起始值 ∓ 位移` 直接算，避免每帧按距离反推带来的夹取误差。
     */
    const stretchX = positioned && hasSideValue(styleNow.left) && hasSideValue(styleNow.right) && !hasSideValue(styleNow.width);
    const stretchY = positioned && hasSideValue(styleNow.top) && hasSideValue(styleNow.bottom) && !hasSideValue(styleNow.height);
    const parsedRight = parseFloat(cs.right);
    const parsedBottom = parseFloat(cs.bottom);
    const startRight = hasSideValue(styleNow.right)
      ? (Number.isFinite(parsedRight) ? parsedRight : (cb ? cb.right - rect.right : 0))
      : (cb ? cb.right - rect.right : 0);
    const startBottom = hasSideValue(styleNow.bottom)
      ? (Number.isFinite(parsedBottom) ? parsedBottom : (cb ? cb.bottom - rect.bottom : 0))
      : (cb ? cb.bottom - rect.bottom : 0);
    altDragRef.current = {
      id: h.id, mode: h.mode, edge: h.edge,
      startX: e.clientX, startY: e.clientY,
      rect,
      startW: rect.width, startH: rect.height,
      positioned, isFixed, posKind,
      startLeft, startTop, startMarginL, startMarginT,
      startRight, startBottom, stretchX, stretchY,
      pinX: false, pinY: false,
      bounds,
      walls: [bounds.barL, bounds.barR, bounds.barT, bounds.barB].filter(Boolean) as Bar[],
      reparent: false,
      dropId: null,
      parentId: parentNode?.id ?? null,
      startFont: parseFloat(cs.fontSize) || 16,
      engaged: false,
      lastX: e.clientX,
      lastY: e.clientY,
      axisSide
    };
    window.addEventListener('pointermove', onAltDragMove);
    window.addEventListener('pointerup', onAltDragUp);
  };

  /**
   * 精准微调：把元素沿纵向挪 delta 个 CSS 像素（v0.4.5 第十六批）。
   *   · 定位元素 → 改它当前锚定的那一边（top 或 bottom，只动一条）；
   *   · 普通流元素 → 改 marginTop（这是流式布局里唯一"位移"的表达方式）。
   * 绝对/固定定位的负值由 store 统一钳到 0（见 sceneStore.updateStyle）。
   */
  const nudgeElement = (id: string, delta: number) => {
    const node = findNode(useScene.getState().scene.root, id);
    if (!node) return;
    const cs = node.style as Record<string, string | undefined>;
    const pos = cs.position ?? 'static';
    const positioned = pos === 'absolute' || pos === 'fixed' || pos === 'relative' || pos === 'sticky';
    const z = zoomRef.current || 1;
    const step = delta / z;
    if (!positioned) {
      const cur = parseFloat(cs.marginTop ?? '') || 0;
      useScene.getState().updateStyle(id, { marginTop: Math.round(cur + step) + 'px' } as never);
      return;
    }
    // relative / sticky 的偏移是相对自身原位的位移 → 用 top
    const useBottom = pos !== 'relative' && pos !== 'sticky'
      && hasSideValue(cs.bottom) && !hasSideValue(cs.top);
    const key = useBottom ? 'bottom' : 'top';
    const cur = parseFloat(cs[key] ?? '') || 0;
    // bottom 方向相反：往下挪 = bottom 变小
    const nextVal = useBottom ? cur - step : cur + step;
    useScene.getState().updateStyle(id, { [key]: Math.round(nextVal) + 'px' } as never);
  };

  /**
   * Alt + 滚轮 / Ctrl + 滚轮。
   *
   * 三种语义（v0.4.5 第十六批定稿）：
   *   ① Alt + 按住拖动中 + 滚轮 = 滚动页面（同时把拖拽基准 rect 一起平移，否则元素会"瞬移"）
   *   ② Alt + 滚轮（没在拖）= 精准微调位置（1px/格，Shift = 10px）—— 用户明确要求
   *   ③ Ctrl + 滚轮 = 缩放画布（4%/格）
   */
  const onCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const drag = altDragRef.current;

    // ① Alt + 按住拖动中 + 滚轮 = 滚动画布。
    // 画布滚动 S 像素后，元素在屏幕上的位置整体上移了 S，但基准 `d.rect` 还是旧的
    // —— 下一帧算出来的目标位置就凭空多了 S 的偏差，看起来就是"瞬移"。
    // 修法：把基准 rect（以及纵向墙）一起平移 S，元素才会**跟着内容走**。
    if (e.altKey && drag?.engaged && drag.mode === 'move') {
      e.preventDefault();
      const wrapEl = canvasRef.current?.parentElement;
      const before = wrapEl?.scrollTop ?? 0;
      wrapEl?.scrollBy({ top: e.deltaY });
      const scrolled = (wrapEl?.scrollTop ?? 0) - before;
      if (scrolled !== 0) {
        drag.rect = { ...drag.rect, top: drag.rect.top - scrolled };
        drag.bounds = {
          ...drag.bounds,
          minY: drag.bounds.minY - scrolled,
          maxY: Number.isFinite(drag.bounds.maxY) ? drag.bounds.maxY - scrolled : drag.bounds.maxY,
          barT: drag.bounds.barT ? { ...drag.bounds.barT, y: drag.bounds.barT.y - scrolled } : drag.bounds.barT,
          barB: drag.bounds.barB ? { ...drag.bounds.barB, y: drag.bounds.barB.y - scrolled } : drag.bounds.barB
        };
      }
      return;
    }

    // ② Alt + 滚轮（没在拖动）= 精准微调位置。
    // 用户原话：「Alt + 滚轮不要触发页面上的盒模型显示；只有 Alt + 鼠标放到一个元素上
    //            但不按住，可以显示盒模型和定位等；Alt + 滚轮是精准定位。」
    if (e.altKey && !drag) {
      e.preventDefault();
      // 滚轮期间不弹盒模型（用户明确要求），并且挡掉随后 pointermove 立刻又把它带出来
      wheelNoBoxUntil.current = Date.now() + 800;
      setBoxModel(null);
      const hover = altHoverRef.current;
      if (hover) {
        // 步长按用户选择：1px / 格，按住 Shift 加速到 10px
        const step = e.shiftKey ? 10 : 1;
        const delta = e.deltaY < 0 ? -step : step;
        nudgeElement(hover.id, delta);
      }
      return;
    }

    // 滚轮时先收掉 Alt 悬停高亮（避免缩放时还挂着"可编辑"虚线框与光标）
    if (altHover) setAltHover(null);
    tagAltCursor(null, '');
    // Ctrl+滚轮 = 缩放（Alt 已经让给"精准微调"了）
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (!canvasRef.current) return;
    const oldZoom = zoomRef.current;
    // 分度更细（4%/格，以前 10%/格）：滚起来"费力一点"但精度更高
    const dir = e.deltaY < 0 ? 1 : -1;
    const next = Math.min(2, Math.max(0.5, Math.round(oldZoom * (1 + dir * 0.04) * 100) / 100));
    if (next === oldZoom) return;
    onZoomChange?.(next);
  };

  /** 松开 Alt 时清掉悬停态（拖动中的状态由 onAltDragUp 收） */
  const clearAltState = () => {
    document.body.classList.remove('bc-alt-down');
    tagAltCursor(null, '');
    setAltHover(null);
    setBoxModel(null);
  };

  /** 组件卸载时必须清理的定时器 / rAF */
  const dispose = () => {
    document.body.classList.remove('bc-alt-down');
    tagAltCursor(null, '');
    window.clearTimeout(wallFlashTimer.current);
    if (altLiveRaf.current) { cancelAnimationFrame(altLiveRaf.current); altLiveRaf.current = 0; }
    window.removeEventListener('pointermove', onAltDragMove);
    window.removeEventListener('pointerup', onAltDragUp);
    removeAltGhost();
  };

  return {
    altHover,
    altDragRef,
    altPad,
    boxModel,
    altBadge,
    wallFlash,
    wallHints,
    dropTarget,
    guides,
    wheelNoBoxUntil,
    onWrapPointerMove,
    onWrapPointerDownCapture,
    onCanvasWheel,
    clearAltState,
    dispose,
    /** 供探针/调试用：当前"改父子关系"总开关 */
    reparentEnabled: ALT_REPARENT_ENABLED
  };
}

export type AltDragApi = ReturnType<typeof useAltDrag>;
