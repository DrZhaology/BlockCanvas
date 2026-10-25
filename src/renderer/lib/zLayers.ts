// BlockCanvas · 全程序 z-index 标准（v0.4.5 定稿）
//
// 背景：以前 z-index 散落在 26 个 CSS 分片里（0 / 1 / 2 / 25 / 30 / 60 / 61 / 80 / 86 … 9999），
// 加到第七八轮以后没人能说清"这个浮层到底盖在谁上面"，于是出现
// 「中键属性搜索框被下方元素面板拦腰截断」这类问题。
//
// 这里给出一条**从下到上的单一标尺**，每层之间留出足够空隙，中间要插新层就往空隙里塞。
// CSS 侧同名变量定义在 styles/00-theme-tokens.css 的「z-index 标尺」一节，
// JS 里需要动态设 z-index（Portal 到 body 的浮层）时用这里的 Z 常量 —— 两边必须一致。
//
// ┌── 层 ──────────────┬──────┬──────────────────────────────────────────────┐
// │ base               │   0  │ 常规文档内容                                 │
// │ sticky             │  10  │ 面板内的粘性表头 / 冻结列                     │
// │ canvasHint         │  30  │ 画布内部的角标、空画布提示                    │
// │ panelInline        │ 100  │ 留在面板内部的小浮层（单位下拉、行内菜单）     │
// │ canvasOverlay      │ 400  │ 框选矩形、行内合并外框、Alt 悬停框            │
// │ canvasBoxModel     │ 410  │ Alt 拖动时的盒模型覆盖层                      │
// │ canvasWalls        │ 420  │ 墙提示、对齐参考线、拖拽落点预览               │
// │ canvasBadge        │ 430  │ 拖动时的数值气泡                              │
// │ dragGhost          │ 460  │ 拖拽幽灵（要盖住画布全部覆盖层）               │
// │ toolbar            │ 560  │ 顶部工具栏、项目页签栏、只读快照条             │
// │ sheet              │ 700  │ 侧边/底部面板外壳（元素面板、右侧属性面板）     │
// │ popover            │ 750  │ 脱离容器的浮层：锚点面板、属性搜索、变量菜单    │
// │ sheetTop           │ 800  │ 首页浮层（盖过面板，仍在模态之下）             │
// │ modal              │ 900  │ 模态对话框（设置、项目中心、确认框…）          │
// │ modalTop           │ 960  │ 压在模态之上的模态（取色盘、字体选择器）        │
// │ toast              │ 980  │ 轻提示 / 气泡                                 │
// │ critical           │ 9999 │ 必须无条件在最上：更新遮罩、启动加载页          │
// └────────────────────┴──────┴──────────────────────────────────────────────┘

export const Z = {
  base: 0,
  sticky: 10,
  canvasHint: 30,
  panelInline: 100,
  canvasOverlay: 400,
  canvasBoxModel: 410,
  canvasWalls: 420,
  canvasBadge: 430,
  dragGhost: 460,
  toolbar: 560,
  sheet: 700,
  popover: 750,
  sheetTop: 800,
  modal: 900,
  modalTop: 960,
  toast: 980,
  critical: 9999
} as const;

export type ZLayer = keyof typeof Z;

/** 取某一层的数值（写成 `style={{ zIndex: z('popover') }}` 即可） */
export function z(layer: ZLayer): number {
  return Z[layer];
}

/** 取某一层的 CSS 变量写法（必须走内联样式时用） */
export function zVar(layer: ZLayer): string {
  return `var(--z-${layer.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())})`;
}