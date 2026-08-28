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
  | 'figure'
  | 'blockquote'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'p'
  | 'span'
  | 'strong'
  | 'em'
  | 'mark'
  | 'small'
  | 'code'
  | 'del'
  | 'sup'
  | 'sub'
  | 'img'
  | 'button'
  | 'a'
  | 'input'
  | 'textarea'
  | 'label'
  | 'ul'
  | 'ol'
  | 'li'
  | 'table'
  | 'tr'
  | 'th'
  | 'td'
  | 'figcaption'
  | 'hr'
  | 'br'
  | 'form';

// 自闭合元素：无 children，渲染与导出都需特殊处理（Canvas.tsx 和 exporter.ts 共用）
export const SELF_CLOSING_TAGS: ReadonlySet<ElementType> = new Set(['img', 'input', 'hr', 'br']);

// 文本独占元素：有开闭标签，但 textarea 不允许 ReactNode 子元素，只能放文本内容
// （避免 textarea 走递归 children 分支渲染崩溃）
export const TEXT_ONLY_TAGS: ReadonlySet<ElementType> = new Set(['textarea']);

// 容器型元素：可接受子元素（用于元素面板分组与"插入到此容器"判断）
export const CONTAINER_TAGS: ReadonlySet<ElementType> = new Set([
  'div', 'section', 'header', 'nav', 'footer', 'main', 'article', 'aside',
  'figure', 'blockquote', 'ul', 'ol', 'li', 'table', 'tr', 'th', 'td', 'form'
]);

// 文本型元素：可有 text 内容，且在面板里允许编辑文字
export const TEXT_TAGS: ReadonlySet<ElementType> = new Set([
  'h1', 'h2', 'h3', 'h4', 'p', 'span',
  'strong', 'em', 'mark', 'small', 'code', 'del', 'sup', 'sub',
  'button', 'a', 'label', 'figcaption', 'blockquote', 'th', 'td'
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

  // —— Flex & Grid 布局 ——
  display?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;
  flexWrap?: string;
  alignContent?: string;
  alignSelf?: string;
  justifySelf?: string;
  flexGrow?: string;
  flexShrink?: string;

  // —— Grid 特有 ——
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridAutoFlow?: string;
  justifyItems?: string;
  gridColumn?: string;
  gridRow?: string;

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
    // 智能关系选择器：例如 ".hero > h1"、".card > p:first-of-type"
    // 设置后元素自身无需再起 class，导出直接生成对应后代/子代选择器规则
    relSelector?: string;
    [key: string]: string | undefined;
  };
  // 用户从"+ 添加属性"主动加过的 schema key 列表。
  // 即使对应 style 值被清空为空字符串，也保留在列表里 → 行不消失。
  // "×" 删除按钮显式调 removeVisibleProp 才从列表移除并清空 style。
  visibleProps?: string[];
  hidden?: boolean;
  locked?: boolean;
  // 子元素样式（关系选择器）：作用于该元素内部、匹配 sel 的后代/子代元素。
  // sel 支持 标签（p / h2 / a）、.类名、组合与空格（后代）、>（子代），如 ".card > p"。
  // css 存声明文本（编辑保真）；渲染/导出统一生成 `.父类名 sel { ... }` 规则。
  childStyles?: { sel: string; css: string }[];
  // 伪类样式：key 为伪类名（hover/active/focus/link），value 为该状态下的样式覆盖
  pseudoStyles?: Record<string, ElementStyle>;
}

export interface SceneGraph {
  root: SceneElement; // <body> 角色
  selectedId: string | null; // 当前选中元素（多选时的"主选中"，Ctrl+A/拷贝等以其为准）
  selectedIds: string[]; // 多选集合（阶段2：Ctrl+点击 / Ctrl+A / 拖框选中）
  // 用户全局 CSS 文本（阶段3）：进导出 <style> 块末尾，可覆盖自动生成的样式类
  globalCss?: string;
  // 页面快速设置（阶段4・D 批）：可视化常用项，导出顺序：自动样式 → 快速设置 → 高级 CSS
  // 「页面」页签可按需添加属性（+ 添加属性）：键存在（含空串）= 已添加；× 删除才移除键
  quickCss?: {
    bodyBg?: string; // 页面背景色（body）
    textColor?: string; // 文字颜色（body）
    fontFamily?: string; // 页面字体（body）
    linkColor?: string; // 链接颜色（a）
    bodyFontSize?: string; // 正文字号（body font-size）
    bodyLineHeight?: string; // 正文行高（body line-height）
    headingColor?: string; // 标题颜色（h1~h6）
    resetMargin?: string; // '1' = 导出时加 html,body 边距重置（去掉浏览器默认 8px 白边）；缺省 = 不加
    resetHeadingMargin?: string; // '1' = 重置标题/段落/列表等的浏览器默认外边距（等价于网站的 CSS Reset）；缺省 = 不加
  };
}
