// BlockCanvas · 样式写入的规则化（R6-5）
//
// 从 sceneStore.updateStyle 里搬出来的"写入前必须遵守的规则"。特征是：
// **给定一份样式补丁 + 当前定位方式，返回可以真正写进场景的补丁**。纯函数，可单测。
//
// 现在只有一条规则（偏移钳制），但它踩过用户明确投诉，而且边界很容易写错：
//   · 只钳 absolute / fixed —— relative / sticky 的偏移是"相对自身原位的位移"，
//     负数完全合法（往上/往左挪），钳了就没法用了；
//   · margin 允许负数（负外边距是常见布局技巧），不能一起钳；
//   · **只钳纯 px 数值** —— calc() / 百分比 / var() 原样放过（钳了会算错）。
import type { SceneElement, ElementStyle } from '@lib/types';

/** 定位偏移的四个键（只有它们会被钳） */
export const OFFSET_KEYS = new Set(['left', 'right', 'top', 'bottom']);

/** 纯 px 数值（可带 px 后缀、可负、可小数）—— 只有这种才钳 */
const PURE_PX = /^-?\d*\.?\d+(px)?$/;

export type StylePatch = Record<string, string | undefined>;

/**
 * 把补丁里"不该是负数"的定位偏移钳到 0。
 *
 * @param partial 本次要写入的补丁
 * @param currentPosition 元素**当前**的定位方式（补丁里带 position 时以补丁为准）
 *
 * 返回新对象（不改入参）。例：
 *   clampOffsets({ left: '-40px' }, 'absolute')  → { left: '0px' }
 *   clampOffsets({ left: '-40px' }, 'relative')  → { left: '-40px' }   // 位移量，合法
 *   clampOffsets({ left: 'calc(100% - 20px)' }, 'absolute') → 原样
 */
export function clampOffsets(partial: StylePatch, currentPosition: string): StylePatch {
  const posAfter = partial.position ?? currentPosition ?? 'static';
  // 只有这两种定位是"相对包含块排位置"，负偏移会跑到容器外
  const shouldClamp = posAfter === 'absolute' || posAfter === 'fixed';
  const out: StylePatch = { ...partial };
  if (!shouldClamp) return out;

  for (const k of Object.keys(out)) {
    if (!OFFSET_KEYS.has(k)) continue;
    const v = out[k];
    if (v === undefined || v === '' || v === 'auto') continue;
    const s = String(v).trim();
    if (!PURE_PX.test(s)) continue;          // calc/百分比/var 原样放过
    const n = parseFloat(s);
    if (Number.isFinite(n) && n < 0) {
      out[k] = '0' + (s.endsWith('px') ? 'px' : '');
    }
  }
  return out;
}

/**
 * 计算元素在指定断点下的级联有效样式（Desktop → Tablet → Mobile）。
 *
 * 语义就是 CSS 的层叠：后一个断点覆盖前一个，最终叠在基础样式上。
 * desktop 直接返回 `node.style`（不复制 —— 调用方只读，复制反而增加 GC 压力）。
 */
export function getEffectiveStyle(node: SceneElement, breakpoint: 'desktop' | 'tablet' | 'mobile' = 'desktop'): ElementStyle {
  if (breakpoint === 'desktop') return node.style;
  const tabStyle = node.responsive?.tablet ?? {};
  if (breakpoint === 'tablet') return { ...node.style, ...tabStyle };
  const mobStyle = node.responsive?.mobile ?? {};
  return { ...node.style, ...tabStyle, ...mobStyle };
}

/**
 * 把补丁写进"对应断点的那一层"。
 *
 * 三条边界（都踩过）：
 *   · `undefined` = 删除该属性；空串在**断点层**也是删除（表示"回到继承"），
 *     但在**基础层**是保留（用户的输入框可能正处于空态）；
 *   · 写完断点层如果空了，要把那一层连同 responsive 本身一起删掉 ——
 *     否则工程文件里会留一堆 `{ tablet: {}, mobile: {} }` 的空壳；
 *   · 返回是否"层被清空"，方便调用方决定要不要再清理 responsive。
 */
export function applyPatchToLayer(
  node: SceneElement,
  patch: StylePatch,
  breakpoint: 'desktop' | 'tablet' | 'mobile'
): { layerEmptied: boolean } {
  if (breakpoint === 'desktop') {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (node.style as StylePatch)[k];
      else node.style[k] = v;
    }
    return { layerEmptied: false };
  }

  if (!node.responsive) node.responsive = {};
  if (!node.responsive[breakpoint]) node.responsive[breakpoint] = {};
  const layer = node.responsive[breakpoint] as StylePatch;

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '') delete layer[k];
    else layer[k] = v;
  }

  if (Object.keys(layer).length === 0) {
    delete node.responsive[breakpoint];
    if (Object.keys(node.responsive).length === 0) node.responsive = undefined;
    return { layerEmptied: true };
  }
  return { layerEmptied: false };
}
