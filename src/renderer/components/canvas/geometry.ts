// BlockCanvas · 画布几何计算（纯函数，不碰 React）
//
// 这一层是 Alt 拖动/缩放能被"算清楚"的基础：包含块、热区、盒模型读数。
// 全部是纯函数（除了读 DOM 的 computed 样式），所以能单独推理与复用。
import { findNode } from '@store/sceneStore';
import type { AltBoxModelData, AltEdge } from './types';

/** 元素命中哪条边（贴边才算，避免整块都能拖）：四角用更大热区，角优先判定 */
export const EDGE_PX = 7;   // 边缘热区宽度（按住 Alt 后才生效）
export const CORNER_PX = 18; // 四角热区宽度（角上要"好抓"，比边大得多 —— 以前 7px 太精确，很难命中）

/** 一个样式值算不算"已经锚定了这一边"（空 / auto 都不算） */
export function hasSideValue(v: string | undefined): boolean {
  const s = String(v ?? '').trim();
  return s !== '' && s !== 'auto';
}

/**
 * 元素的**包含块内容盒**（client 坐标）。
 *
 * 为什么需要它：`position: absolute / fixed` 的 left/top 百分比与像素值都是相对
 * **包含块的内容盒**（padding box 再往里减掉 padding），而不是父元素的边框外边。
 * 以前拖动时直接拿 `parentElement.getBoundingClientRect()` 当基准，遇到带 padding/border
 * 的父容器就会偏一个 padding+border 的距离。
 *
 * v0.4.5 更正：**`fixed` 的包含块不是 DOM 父元素**，而是"视口" ——
 * 在编辑器里 `.canvas` 因为带了 transform 而成为 fixed 后代的包含块（扮演浏览器视口），
 * 所以 fixed 必须传 `.canvas`。以前按 DOM 父元素算，fixed 元素一拖就整体错位
 * （用户反馈"fixed 的定位非常糟糕"）。
 */
export function contentBoxOf(el: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const n = (v: string) => parseFloat(v) || 0;
  const left = r.left + el.clientLeft + n(cs.paddingLeft);
  const top = r.top + el.clientTop + n(cs.paddingTop);
  return {
    left,
    top,
    right: r.right - el.clientLeft - n(cs.paddingRight),
    bottom: r.bottom - el.clientTop - n(cs.paddingBottom)
  };
}

/**
 * 决定这一趟拖动**锚定在哪一边**（只在拖动开始时算一次）。
 *
 * 规则（v0.4.5）：
 *  1. `relative` / `sticky` 一律用 left / top —— 它们的偏移是"相对自身文档流原位"的位移，
 *     写 right/bottom 也能表达，但和"离父容器哪边近"没有关系，按距离反推会直接跳位。
 *  2. `absolute` / `fixed`：**优先沿用样式里已有的那一边**（我明明锚在右边，一拖就变左边很烦）；
 *     两边都没有（或都有）时，取距离更近的一边，中间留 8px 死区（避免横跨中线时反复争抢）。
 */
export function pickAxisSide(
  posKind: AltBoxModelData['posKind'],
  style: Record<string, string | undefined>,
  rect: DOMRect,
  cb: { left: number; top: number; right: number; bottom: number } | null
): { x: 'left' | 'right'; y: 'top' | 'bottom' } {
  if (posKind === 'relative' || posKind === 'sticky' || !cb) return { x: 'left', y: 'top' };
  const DEAD = 8;
  let x: 'left' | 'right' = 'left';
  let y: 'top' | 'bottom' = 'top';
  const hasL = hasSideValue(style.left);
  const hasR = hasSideValue(style.right);
  const hasT = hasSideValue(style.top);
  const hasB = hasSideValue(style.bottom);
  if (hasR && !hasL) x = 'right';
  else if (!hasL && !hasR && (cb.right - rect.right) < (rect.left - cb.left) - DEAD) x = 'right';
  if (hasB && !hasT) y = 'bottom';
  else if (!hasT && !hasB && (cb.bottom - rect.bottom) < (rect.top - cb.top) - DEAD) y = 'bottom';
  return { x, y };
}

/** 指针落在元素的哪条边 / 哪个角上（都不贴边时返回 null） */
export function edgeAt(rect: DOMRect, x: number, y: number): AltEdge | null {
  const dL = x - rect.left;
  const dR = rect.right - x;
  const dT = y - rect.top;
  const dB = rect.bottom - y;
  // 1) 先用大热区判"角"：横纵同时进入 CORNER_PX 才算角（角上既要改宽又要改高）
  const hCorner = dL <= CORNER_PX ? 'l' : dR <= CORNER_PX ? 'r' : '';
  const vCorner = dT <= CORNER_PX ? 't' : dB <= CORNER_PX ? 'b' : '';
  if (hCorner && vCorner) return (vCorner + hCorner) as AltEdge;
  // 2) 再用小热区判"边"
  const h = dL <= EDGE_PX ? 'l' : dR <= EDGE_PX ? 'r' : '';
  const v = dT <= EDGE_PX ? 't' : dB <= EDGE_PX ? 'b' : '';
  if (h && v) return (v + h) as AltEdge;
  if (h) return h as AltEdge;
  if (v) return v as AltEdge;
  return null;
}

/**
 * 读一个元素当前的盒模型（F12 那种四层盒的数值来源）。
 *
 * v0.4.5：`margin: auto` 在 computed 里会被解析成具体像素，所以"是不是 auto"
 * 只能回**场景样式**里读 —— 这就是它要接收 root 的原因。
 */
export function readBoxModel(el: HTMLElement, root: Parameters<typeof findNode>[0]): AltBoxModelData {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const n = (v: string) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
  const pos = cs.position;
  const posKind = (['relative', 'absolute', 'fixed', 'sticky'] as const).includes(pos as never)
    ? (pos as AltBoxModelData['posKind'])
    : 'static';
  const posLabel = pos === 'relative' ? '相对定位'
    : pos === 'absolute' ? '绝对定位'
      : pos === 'fixed' ? '固定定位'
        : pos === 'sticky' ? '粘性定位' : '常规流';
  // computed 会把 margin:auto 解析成具体像素，所以"是不是 auto"只能回场景样式里读
  const bcId = el.getAttribute('data-bc-id') || '';
  const node = bcId ? findNode(root, bcId) : null;
  const st = (node?.style ?? {}) as Record<string, string | undefined>;
  const autoSides = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'top', 'right', 'bottom', 'left']
    .filter((k) => String(st[k] ?? '').trim() === 'auto');
  /**
   * v0.4.7：**真正声明了的那几条偏移**。
   * Alt 悬停时只该标出这些（用户："fixed 的 Alt 显示还是四边都显示，说了两边！！"）。
   * 注意不能用 `autoSides` 的反面——没声明过的边既不在 autoSides 里、也不该被标出来，
   * 所以这里单独算一份"有值且不是 auto"的清单。
   */
  const setSides = (['top', 'right', 'bottom', 'left'] as const)
    .filter((k) => { const v = String(st[k] ?? '').trim(); return v !== '' && v !== 'auto'; });
  return {
    x: r.left, y: r.top, w: r.width, h: r.height,
    mt: n(cs.marginTop), mr: n(cs.marginRight), mb: n(cs.marginBottom), ml: n(cs.marginLeft),
    bt: n(cs.borderTopWidth), br: n(cs.borderRightWidth), bb: n(cs.borderBottomWidth), bl: n(cs.borderLeftWidth),
    pt: n(cs.paddingTop), pr: n(cs.paddingRight), pb: n(cs.paddingBottom), pl: n(cs.paddingLeft),
    posLabel,
    offsetX: pos === 'relative' ? n(cs.left) : 0,
    offsetY: pos === 'relative' ? n(cs.top) : 0,
    autoSides,
    setSides,
    insets: { top: cs.top, right: cs.right, bottom: cs.bottom, left: cs.left },
    posKind
  };
}
