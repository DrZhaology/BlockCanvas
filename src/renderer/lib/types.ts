// BlockCanvas · 场景模型类型定义
// 一切元素节点最终序列化进 SceneGraph，是单一数据源

export type ElementType =
  | 'div'
  | 'section'
  | 'header'
  | 'nav'
  | 'footer'
  | 'main'
  | 'article'
  | 'aside'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'p'
  | 'span'
  | 'img'
  | 'button'
  | 'a'
  | 'input'
  | 'textarea'
  | 'label'
  | 'ul'
  | 'ol'
  | 'li'
  | 'hr'
  | 'form';

// 自闭合元素：无 children，渲染与导出都需特殊处理（Canvas.tsx 和 exporter.ts 共用）
export const SELF_CLOSING_TAGS: ReadonlySet<ElementType> = new Set(['img', 'input', 'hr']);

// 文本独占元素：有开闭标签，但 textarea 不允许 ReactNode 子元素，只能放文本内容
// （避免 textarea 走递归 children 分支渲染崩溃）
export const TEXT_ONLY_TAGS: ReadonlySet<ElementType> = new Set(['textarea']);

// 容器型元素：可接受子元素（用于元素面板分组与"插入到此容器"判断）
export const CONTAINER_TAGS: ReadonlySet<ElementType> = new Set([
  'div', 'section', 'header', 'nav', 'footer', 'main', 'article', 'aside', 'ul', 'ol', 'li', 'form'
]);

// 文本型元素：可有 text 内容，且在面板里允许编辑文字
export const TEXT_TAGS: ReadonlySet<ElementType> = new Set([
  'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label'
]);

// 阶段0只动 background-color；这里预留完整字段方便阶段2直接补
export interface ElementStyle {
  // —— 基础尺寸 ——
  width?: string;
  height?: string;
  minHeight?: string;
  minWidth?: string;
  maxHeight?: string;
  maxWidth?: string;

  // —— 内边距 padding（4 边拆分）——
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;

  // —— 外边距 margin（4 边拆分）——
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;

  // —— 边框宽度（4 边拆分）——
  borderTopWidth?: string;
  borderRightWidth?: string;
  borderBottomWidth?: string;
  borderLeftWidth?: string;
  borderStyle?: string;
  borderColor?: string;
  // —— 圆角（4 角拆分）——
  borderTopLeftRadius?: string;
  borderTopRightRadius?: string;
  borderBottomRightRadius?: string;
  borderBottomLeftRadius?: string;

  // —— 颜色 / 不透明度 ——
  backgroundColor?: string;
  color?: string;
  opacity?: string;

  // —— 字体 ——
  fontSize?: string;
  fontWeight?: string;
  fontFamily?: string;
  lineHeight?: string;
  textAlign?: string;
  letterSpacing?: string;

  // —— 阴影 ——
  boxShadow?: string;
  textShadow?: string;

  // —— 定位 ——
  position?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  zIndex?: string;

  // —— Flex ——
  display?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  flexWrap?: string;

  // —— 其他 ——
  overflow?: string;
  cursor?: string;
  boxSizing?: string;
  textDecoration?: string;

  // —— img 属性（不是 CSS，依附 style 但不进 <style> 块）——
  src?: string;
  alt?: string;

  // 索引签名：兼容未来扩展（如 hover 状态、animation 等）
  [key: string]: string | undefined;
}

export interface SceneElement {
  id: string; // UUID，稳定
  type: ElementType;
  text?: string; // 文本内容（h1/p/button 等用）
  children: SceneElement[]; // 流式布局：子元素按数组顺序堆叠
  style: ElementStyle; // 内联样式
  attrs?: {
    // HTML 原生属性（非 CSS）
    className?: string;
    id?: string;
    href?: string;
    placeholder?: string;
    typeAttr?: string;
    [key: string]: string | undefined;
  };
  // 用户从"+ 添加属性"主动加过的 schema key 列表。
  // 即使对应 style 值被清空为空字符串，也保留在列表里 → 行不消失。
  // "×" 删除按钮显式调 removeVisibleProp 才从列表移除并清空 style。
  visibleProps?: string[];
  hidden?: boolean;
  locked?: boolean;
}

export interface SceneGraph {
  root: SceneElement; // <body> 角色
  selectedId: string | null; // 当前选中元素（多选时的"主选中"，Ctrl+A/拷贝等以其为准）
  selectedIds: string[]; // 多选集合（阶段2：Ctrl+点击 / Ctrl+A / 拖框选中）
  // 用户全局 CSS 文本（阶段3）：进导出 <style> 块末尾，可覆盖自动生成的样式类
  globalCss?: string;
  // 页面快速设置（阶段4・D 批）：可视化常用项，导出顺序：自动样式 → 快速设置 → 高级 CSS
  quickCss?: {
    bodyBg?: string; // 页面背景色（body）
    textColor?: string; // 文字颜色（body）
    fontFamily?: string; // 页面字体（body）
    linkColor?: string; // 链接颜色（a）
  };
}
