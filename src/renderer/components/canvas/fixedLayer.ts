// ============================================================================
// BlockCanvas · 画布内「浏览器视口层」（v0.4.6 重做）
// ----------------------------------------------------------------------------
// 为什么要多这一层（用户连着三轮反馈 fixed 不对，这是根治）：
//
//   以前 fixed 元素的包含块是 `.canvas` 本身 —— 也就是**整张画布**。
//   可画布会随内容长到 3000px，而"浏览器视口"只有一屏。于是：
//     · `bottom: 0` 解析成"画布底"，元素一松手就飞到页面最底下、越出红框；
//     · 对齐到左下 / 右下角时元素突破视口（用户实测的两个角）；
//     · 面板里只有两条偏移，画布上却按四条算（因为 bottom/right 指的框根本不一样）。
//
//   现在把 fixed 元素渲染进 `.canvas-fixed-layer`：这一层的**位置和尺寸就等于红框**，
//   并且它自带 translate（构成包含块），所以层内 fixed 元素的 left/top/right/bottom
//   全部相对视口解析 —— 与真实浏览器一字不差。
//
// 为什么用 portal 而不是挪数据：场景树是用户的数据结构（父子关系、层级、导出都靠它），
// 编辑器只是"换个地方画"，数据一个字都不能动。
// ============================================================================
import { createContext, useContext } from 'react';

/** 视口层 DOM 节点；null = 还没挂上（首帧），此时 fixed 元素照常原地渲染 */
export const FixedLayerContext = createContext<HTMLElement | null>(null);

export const useFixedLayer = (): HTMLElement | null => useContext(FixedLayerContext);
