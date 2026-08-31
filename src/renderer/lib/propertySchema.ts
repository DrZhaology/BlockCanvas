// BlockCanvas · CSS 属性 Schema
// 按需添加属性架构：所有可选 CSS 属性都在此声明
// Inspector 根据 schema 渲染对应输入组件，并管理"哪些属性已添加"

import type { ElementType } from './types';

/** 属性分类 */
export type PropertyCategory =
  | '盒模型'
  | '颜色'
  | '字体与排版'
  | '边框与阴影'
  | '列表'
  | '定位'
  | '多媒体'
  | 'Flex & Grid 布局'
  | '其他';

/** 输入控件类型 */
export type InputType =
  | 'text'
  | 'color'
  | 'select'
  | 'box4'
  | 'trbl'
  | 'number'
  | 'font'
  | 'transform'
  | 'shadow'
  | 'textShadow'
  | 'transition'
  | 'opacity'
  | 'lineHeight';

/** 一条属性定义 */
export interface PropertySchema {
  key: string;                   // ElementStyle 上的字段名（camelCase）
  label: string;                 // 中文显示名
  category: PropertyCategory;
  input: InputType;
  placeholder?: string;
  options?: string[];            // input === 'select' 时下拉选项
  /** select 选项的中文解释：option value → 人话。渲染成 "English · 中文" */
  optionLabels?: Record<string, string>;
  /** 作用对象标注：该属性作用在父容器上（管子元素排布）还是子元素上 */
  scope?: '父' | '子';
  /** input === 'number' 时的默认单位（如 'px'，单位下拉缺省选中它）；
   * trbl/box4 的"缺单位自动补全"单位也用它 */
  unit?: string;
  /** input === 'number' 时单位下拉可选列表（缺省 = CSS_UNITS） */
  units?: string[];
  /** input === 'number' 时是否允许 'auto'（占位"自动"），
   * 对 width/height/inset/margin 这类允许 auto 的属性有意义 */
  allowAuto?: boolean;
  /** trbl/box4 隐藏「单位」下拉：单位直接写在输入框里（如 10px、1rem），
   * 裸数字仍按 schema.unit 自动补；margin/padding 用 */
  hideUnit?: boolean;
  /** 仅这些元素类型不显示该属性（黑名单）。无 = 所有元素都可用 */
  excludeTypes?: ElementType[];
  /** 4 边拆分的"连锁"属性名（例如 padding 拆成 paddingTop 等）；
   * 仅在 input === 'box4' 时生效：box4 在 schema 上是单条 padding，渲染时展开成 4 边输入 */
  sides?: { key: string; label: string }[];
  /** "?" 帮助 */
  help?: { title: string; content: string };
}

// ============ 单位体系（数值输入"数字 + 单位下拉"） ============
export const CSS_UNITS = ['px', 'rem', 'em', '%', 'vw', 'vh', 'vmin', 'vmax', 'pt', 'pc', 'cm', 'mm', 'in', 'ch', 'ex'];

export const UNIT_LABELS: Record<string, string> = {
  px: '像素：屏幕上最小显示点，最常用',
  rem: '相对根元素字号：1rem = 根字号（默认 16px）',
  em: '相对当前元素字号：1em = 当前字号',
  '%': '相对父元素对应尺寸的百分比',
  vw: '视窗宽度的 1%（视窗 = 浏览器可见区域）',
  vh: '视窗高度的 1%',
  vmin: '视窗较矮一边的 1%',
  vmax: '视窗较高一边的 1%',
  pt: '磅：印刷单位，1pt ≈ 1.33px',
  pc: '派卡：印刷单位，1pc = 12pt',
  cm: '厘米：印刷/打印单位',
  mm: '毫米：印刷/打印单位',
  in: '英寸：印刷/打印单位，1in = 2.54cm',
  ch: '相对"0"字符的宽度',
  ex: '相对小写"x"字符的高度',
  auto: '自动：由浏览器计算（宽高/偏移常用）',
  custom: '自定义：输入复杂值（如 calc(100% - 20px)）'
};

export const UNIT_HELP_TEXT =
  '数值单位说明：\n' +
  '• px 像素 —— 最常用，1px = 屏幕上一个点\n' +
  '• % 百分比 —— 相对父元素的对应尺寸\n' +
  '• rem —— 相对根字号（默认 1rem = 16px）\n' +
  '• em —— 相对当前元素自身字号\n' +
  '• vw / vh —— 视窗宽度/高度的 1%\n' +
  '• vmin / vmax —— 视窗短边/长边的 1%\n' +
  '• pt / pc / cm / mm / in —— 印刷单位（打印输出用）\n' +
  '• ch / ex —— 相对字符尺寸的特殊单位\n\n' +
  '提示：数值框只输入数字，例如 30；单位单独用下拉选择。';

// ============ Schema 总表 ============
export const SCHEMA: PropertySchema[] = [
  // —— 盒模型 ——
  {
    key: 'width', label: '宽度 (width)', category: '盒模型', input: 'number', unit: 'px', allowAuto: true, scope: '子',
    placeholder: '例：300',
    help: { title: '宽度 width', content: '元素的左右方向尺寸（多宽）。auto = 宽度随内容与容器自动算。注：纯行内元素需先设 display 为 block/inline-block 才生效。' }
  },
  {
    key: 'height', label: '高度 (height)', category: '盒模型', input: 'number', unit: 'px', allowAuto: true, scope: '子',
    placeholder: '例：80',
    help: { title: '高度 height', content: '元素的上下方向尺寸（多高）。文字类建议留 auto 让它自己撑开，容器或图片可指定。' }
  },
  {
    key: 'minWidth', label: '最小宽度 (min-width)', category: '盒模型', input: 'number', unit: 'px', scope: '子',
    placeholder: '例：120',
    help: { title: '最小宽度 min-width', content: '宽度下限：再窄也不能小于它。常用于弹性容器防止被过度压缩。' }
  },
  {
    key: 'maxWidth', label: '最大宽度 (max-width)', category: '盒模型', input: 'number', unit: 'px', allowAuto: true, scope: '子',
    placeholder: '例：960',
    help: { title: '最大宽度 max-width', content: '宽度上限：再宽也不超过它。常用在正文段落上，防止文字拉太长难读。' }
  },
  {
    key: 'minHeight', label: '最小高度 (min-height)', category: '盒模型', input: 'number', unit: 'px', scope: '子',
    placeholder: '例：60',
    help: { title: '最小高度 min-height', content: '高度下限：内容再少高度也至少是这个值。' }
  },
  {
    key: 'maxHeight', label: '最大高度 (max-height)', category: '盒模型', input: 'number', unit: 'px', allowAuto: true, scope: '子',
    placeholder: '例：400',
    help: { title: '最大高度 max-height', content: '高度上限：超出部分配合 overflow 可实现内部滚动。' }
  },
  {
    key: 'padding', label: '内边距 (padding)', category: '盒模型', input: 'trbl', unit: 'px', hideUnit: true, scope: '子',
    sides: [
      { key: 'paddingTop', label: '上' },
      { key: 'paddingRight', label: '右' },
      { key: 'paddingBottom', label: '下' },
      { key: 'paddingLeft', label: '左' }
    ],
    placeholder: '10px',
    help: {
      title: '内边距 padding',
      content:
        '元素"边框以内、内容以外"的留白。\n' +
        '1~4 个值空格分开（上 右 下 左）：\n' +
        '• 1 个值：四周相同，如 16px\n' +
        '• 2 个值：上下 / 左右，如 10px 20px\n' +
        '• 4 个值：上 右 下 左 分别指定'
    }
  },
  {
    key: 'margin', label: '外边距 (margin)', category: '盒模型', input: 'trbl', unit: 'px', hideUnit: true, scope: '子',
    sides: [
      { key: 'marginTop', label: '上' },
      { key: 'marginRight', label: '右' },
      { key: 'marginBottom', label: '下' },
      { key: 'marginLeft', label: '左' }
    ],
    placeholder: '0 auto 或 16px',
    help: {
      title: '外边距 margin',
      content:
        '元素"边框以外"与其他元素之间的间距。\n' +
        '• 0 auto：块级元素水平居中常用\n' +
        '• 16px：四周留白 16px\n' +
        '注：纯行内元素（如 span/a）或图片需先将 display 设为 block 或 inline-block，居中外边距才生效。'
    }
  },
  {
    key: 'boxSizing', label: '盒模型计算 (box-sizing)', category: '盒模型', input: 'select', scope: '子',
    options: ['border-box', 'content-box'],
    optionLabels: { 'border-box': '宽高含内边距与边框 (border-box，推荐)', 'content-box': '宽高仅算内容 (content-box)' },
    help: {
      title: '盒模型 box-sizing',
      content: '决定 width/height 是否包含 padding 和 border。border-box 最符合直觉，排版不易溢出。'
    }
  },

  // —— 颜色 ——
  {
    key: 'backgroundColor', label: '背景颜色 (background-color)', category: '颜色', input: 'color', scope: '子',
    placeholder: '#ffffff / transparent / red',
    help: {
      title: '背景色 background-color',
      content: '元素背景填充色。支持 Hex (#fff)、RGB、RGBA (含透明度)、英文颜色名以及 transparent (设为透明)。'
    }
  },
  {
    key: 'color', label: '文字颜色 (color)', category: '颜色', input: 'color', scope: '子',
    placeholder: '#000000 / rgb(...) / black',
    excludeTypes: ['img', 'input', 'hr'],
    help: { title: '文字颜色 color', content: '文本字体的颜色。支持 hex/rgb/rgba/英文色名。' }
  },
  {
    key: 'opacity', label: '不透明度 (opacity)', category: '颜色', input: 'opacity', scope: '子',
    placeholder: '1 / 0.8 / 0.5 / 0',
    help: { title: '不透明度 opacity', content: '0~1 之间的小数，0 为完全透明，1 为完全不透明。' }
  },

  // —— 字体与排版 ——
  {
    key: 'fontSize', label: '字号大小 (font-size)', category: '字体与排版', input: 'number', unit: 'px', scope: '子',
    placeholder: '例：16',
    excludeTypes: ['img', 'hr'],
    help: { title: '字号 font-size', content: '文字大小。14~16px 是正文字号，20~32px 适合标题。' }
  },
  {
    key: 'fontWeight', label: '字体粗细 (font-weight)', category: '字体与排版', input: 'select', scope: '子',
    options: ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
    optionLabels: {
      normal: '常规标准 (400)',
      bold: '加粗明显 (700)',
      '100': '极细 (100)',
      '300': '细体 (300)',
      '400': '常规 (400)',
      '500': '中等加粗 (500)',
      '600': '半粗 (600)',
      '700': '加粗 (700)',
      '800': '特粗 (800)',
      '900': '极黑 (900)'
    },
    excludeTypes: ['img', 'hr'],
    help: { title: '字重 font-weight', content: '文字粗细：400 为常规，700 为加粗。' }
  },
  {
    key: 'fontFamily', label: '字体族 (font-family)', category: '字体与排版', input: 'font', scope: '子',
    excludeTypes: ['img', 'hr'],
    help: { title: '字体族 font-family', content: '选择常用中英文字体组合，并可配置备选降级字体。' }
  },
  {
    key: 'lineHeight', label: '文本行高 (line-height)', category: '字体与排版', input: 'lineHeight', scope: '子',
    placeholder: '1.6 / 24px',
    help: { title: '行高 line-height', content: '文字行与行之间的间距。推荐 1.5~1.8（正文）或 1.2（标题）。' }
  },
  {
    key: 'textAlign', label: '水平对齐 (text-align)', category: '字体与排版', input: 'select', scope: '子',
    options: ['left', 'center', 'right', 'justify'],
    optionLabels: { left: '左对齐 (left)', center: '居中对齐 (center)', right: '右对齐 (right)', justify: '两端对齐 (justify)' },
    excludeTypes: ['img', 'hr'],
    help: { title: '文字对齐 text-align', content: '控制块级元素内部文字的水平对齐方向。' }
  },
  {
    key: 'letterSpacing', label: '字间距 (letter-spacing)', category: '字体与排版', input: 'number', unit: 'px', scope: '子',
    placeholder: '例：2',
    excludeTypes: ['img', 'hr'],
    help: { title: '字间距 letter-spacing', content: '字符之间的额外间距。标题适度加大更具质感。' }
  },
  {
    key: 'textDecoration', label: '文本修饰线 (text-decoration)', category: '字体与排版', input: 'select', scope: '子',
    options: ['none', 'underline', 'line-through', 'overline'],
    optionLabels: {
      none: '无修饰线 (none)',
      underline: '下划线 (underline)',
      'line-through': '删除线 (line-through)',
      overline: '上划线 (overline)'
    },
    excludeTypes: ['img', 'hr'],
    help: { title: '文本修饰 text-decoration', content: '为文字添加下划线、删除线或取消链接默认下划线。' }
  },
  {
    key: 'textTransform', label: '大小写转换 (text-transform)', category: '字体与排版', input: 'select', scope: '子',
    options: ['none', 'capitalize', 'uppercase', 'lowercase'],
    optionLabels: {
      none: '保持原样 (none)',
      capitalize: '单词首字母大写 (capitalize)',
      uppercase: '全部大写 (uppercase)',
      lowercase: '全部小写 (lowercase)'
    },
    excludeTypes: ['img', 'hr'],
    help: { title: '大小写转换 text-transform', content: '英文自动转大写、小写或首字母大写。' }
  },
  {
    key: 'whiteSpace', label: '换行折行模式 (white-space)', category: '字体与排版', input: 'select', scope: '子',
    options: ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line'],
    optionLabels: {
      normal: '常规自动换行 (normal)',
      nowrap: '单行强制不换行 (nowrap)',
      pre: '保留所有空格换行 (pre)',
      'pre-wrap': '保留空格且自动折行 (pre-wrap)',
      'pre-line': '合并空格保留换行 (pre-line)'
    },
    excludeTypes: ['img', 'hr'],
    help: { title: '空白与换行 white-space', content: '控制文字排版时遇到空白字符和长句子时的换行策略。' }
  },
  {
    key: 'wordBreak', label: '单词断行 (word-break)', category: '字体与排版', input: 'select', scope: '子',
    options: ['normal', 'break-all', 'keep-all', 'break-word'],
    optionLabels: {
      normal: '标准断行 (normal)',
      'break-all': '允许任意字母断行 (break-all)',
      'keep-all': '中日韩词汇不断行 (keep-all)',
      'break-word': '超长单词自动截断 (break-word)'
    },
    excludeTypes: ['img', 'hr'],
    help: { title: '单词断行 word-break', content: '防止超长英文单词或连续 URL 撑破容器。' }
  },
  {
    key: 'direction', label: '文字阅读方向 (direction)', category: '字体与排版', input: 'select', scope: '子',
    options: ['ltr', 'rtl'],
    optionLabels: { ltr: '从左到右 (ltr · 中英文标准)', rtl: '从右到左 (rtl · 阿拉伯语)' },
    excludeTypes: ['img', 'hr'],
    help: { title: '文本方向 direction', content: '文字排版从左向右（标准）或从右向左。' }
  },

  // —— 边框与阴影 ——
  {
    key: 'border', label: '快速边框 (border 简写)', category: '边框与阴影', input: 'text', scope: '子',
    placeholder: '例：1px solid #e2e8f0',
    help: { title: '边框简写 border', content: '一次性设置：粗细 线型 颜色，例如 1px solid #cbd5e1。' }
  },
  {
    key: 'borderWidth', label: '边框粗细 (border-width)', category: '边框与阴影', input: 'box4', unit: 'px', scope: '子',
    sides: [
      { key: 'borderTopWidth', label: '上' },
      { key: 'borderRightWidth', label: '右' },
      { key: 'borderBottomWidth', label: '下' },
      { key: 'borderLeftWidth', label: '左' }
    ],
    placeholder: '1px',
    help: { title: '边框粗细 border-width', content: '上下左右四条边框的厚度，需配合边框样式与颜色生效。' }
  },
  {
    key: 'borderStyle', label: '边框线型 (border-style)', category: '边框与阴影', input: 'select', scope: '子',
    options: ['none', 'solid', 'dashed', 'dotted', 'double'],
    optionLabels: { none: '无边框 (none)', solid: '实线 (solid)', dashed: '虚线 (dashed)', dotted: '点线 (dotted)', double: '双实线 (double)' },
    help: { title: '边框线型 border-style', content: '边框的样式形状：实线、虚线、点线或无。' }
  },
  {
    key: 'borderColor', label: '边框颜色 (border-color)', category: '边框与阴影', input: 'color', scope: '子',
    placeholder: '#cbd5e1 / #ccc',
    help: { title: '边框颜色 border-color', content: '边框线条的颜色。' }
  },
  {
    key: 'borderRadius', label: '圆角弧度 (border-radius)', category: '边框与阴影', input: 'trbl', unit: 'px', scope: '子',
    sides: [
      { key: 'borderTopLeftRadius', label: '左上' },
      { key: 'borderTopRightRadius', label: '右上' },
      { key: 'borderBottomRightRadius', label: '右下' },
      { key: 'borderBottomLeftRadius', label: '左下' }
    ],
    placeholder: '8px',
    help: { title: '圆角 border-radius', content: '拐角的圆润程度。8px 为标准微圆角，9999px 或 50% 可制作胶囊或圆形。' }
  },
  {
    key: 'outline', label: '外轮廓线 (outline)', category: '边框与阴影', input: 'text', scope: '子',
    placeholder: '例：2px solid #2563eb',
    help: { title: '外轮廓线 outline', content: '绘制在边框外侧的轮廓线，不占据任何文档流空间。' }
  },
  {
    key: 'boxShadow', label: '盒子阴影 (box-shadow)', category: '边框与阴影', input: 'shadow', scope: '子',
    placeholder: '例：0 4px 6px rgba(0,0,0,0.1)',
    help: { title: '盒子阴影 box-shadow', content: '格式：水平偏移 垂直偏移 模糊度 扩散大小 颜色。' }
  },
  {
    key: 'textShadow', label: '文字阴影 (text-shadow)', category: '边框与阴影', input: 'textShadow', scope: '子',
    placeholder: '例：1px 1px 2px rgba(0,0,0,0.3)',
    excludeTypes: ['img', 'input', 'hr', 'textarea'],
    help: { title: '文字阴影 text-shadow', content: '专属于文本的阴影效果。' }
  },

  // —— 列表 ——
  {
    key: 'listStyleType', label: '列表标记类型 (list-style-type)', category: '列表', input: 'select', scope: '子',
    options: ['none', 'disc', 'circle', 'square', 'decimal', 'decimal-leading-zero', 'lower-alpha', 'upper-alpha', 'cjk-ideographic'],
    optionLabels: {
      none: '无标记 (none · 导航常去圆点)',
      disc: '实心圆点 (disc · 默认)',
      circle: '空心圆圈 (circle)',
      square: '实心方块 (square)',
      decimal: '阿拉伯数字 1, 2, 3 (decimal)',
      'decimal-leading-zero': '补零数字 01, 02, 03',
      'lower-alpha': '小写英文字母 a, b, c',
      'upper-alpha': '大写英文字母 A, B, C',
      'cjk-ideographic': '汉字数字 一、二、三'
    },
    help: { title: '列表标记 list-style-type', content: '定义 <ul>、<ol> 或 <li> 前方的小图标或序号样式。设为 none 可消除列表圆点。' }
  },
  {
    key: 'listStylePosition', label: '列表标记位置 (list-style-position)', category: '列表', input: 'select', scope: '子',
    options: ['outside', 'inside'],
    optionLabels: { outside: '标在行外 (outside · 默认)', inside: '标在行内 (inside · 紧贴文字)' },
    help: { title: '标记位置 list-style-position', content: '列表圆点或数字是在内容框外面缩进展示还是紧贴内部。' }
  },

  // —— 多媒体 ——
  {
    key: 'objectFit', label: '图片填充模式 (object-fit)', category: '多媒体', input: 'select', scope: '子',
    options: ['cover', 'contain', 'fill', 'none', 'scale-down'],
    optionLabels: {
      cover: '裁剪铺满 (cover · 保持比例填满容器)',
      contain: '完整显示 (contain · 保持比例留白)',
      fill: '拉伸填满 (fill · 不保比例)',
      none: '保持原图大小 (none)',
      'scale-down': '自适应缩小 (scale-down)'
    },
    help: { title: '图片缩放模式 object-fit', content: '固定宽高的图片在容器中如何缩放。cover 最常用（不变形铺满头像或卡片封面）。' }
  },
  {
    key: 'objectPosition', label: '图片焦点位置 (object-position)', category: '多媒体', input: 'select', scope: '子',
    options: ['center', 'top', 'bottom', 'left', 'right'],
    optionLabels: { center: '居中 (center)', top: '靠顶 (top)', bottom: '靠底 (bottom)', left: '靠左 (left)', right: '靠右 (right)' },
    help: { title: '焦点位置 object-position', content: '在 cover 裁剪模式下优先对准的中心点位置。' }
  },

  // —— 定位 ——
  {
    key: 'position', label: '定位模式 (position)', category: '定位', input: 'select', scope: '子',
    options: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
    optionLabels: {
      static: '普通文档流 (static · 默认)',
      relative: '相对自身偏移 (relative)',
      absolute: '脱离文档流绝对定位 (absolute)',
      fixed: '固定在视口不动 (fixed)',
      sticky: '吸顶停靠定位 (sticky)'
    },
    help: {
      title: '定位模式 position',
      content: '控制元素脱离或跟随正常文档流。设为 relative/absolute/fixed 后，上下左右偏移与 z-index 才会生效。'
    }
  },
  {
    key: 'top', label: '上偏移 (top)', category: '定位', input: 'number', unit: 'px', allowAuto: true, scope: '子',
    placeholder: '例：20',
    help: { title: '上偏移 top', content: '非 static 定位时距离顶部的距离。' }
  },
  {
    key: 'right', label: '右偏移 (right)', category: '定位', input: 'number', unit: 'px', allowAuto: true, scope: '子',
    placeholder: '例：20',
    help: { title: '右偏移 right', content: '非 static 定位时距离右侧的距离。' }
  },
  {
    key: 'bottom', label: '下偏移 (bottom)', category: '定位', input: 'number', unit: 'px', allowAuto: true, scope: '子',
    placeholder: '例：20',
    help: { title: '下偏移 bottom', content: '非 static 定位时距离底部的距离。' }
  },
  {
    key: 'left', label: '左偏移 (left)', category: '定位', input: 'number', unit: 'px', allowAuto: true, scope: '子',
    placeholder: '例：20',
    help: { title: '左偏移 left', content: '非 static 定位时距离左侧的距离。' }
  },
  {
    key: 'zIndex', label: '图层层级 (z-index)', category: '定位', input: 'number', scope: '子',
    placeholder: '例：10',
    help: { title: '层级 z-index', content: '数值越大图层越靠前覆盖。需 position 非 static 才生效。' }
  },

  // —— Flex & Grid 布局 ——
  {
    key: 'display', label: '显示模式 (display)', category: 'Flex & Grid 布局', input: 'select', scope: '父',
    options: ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'none'],
    optionLabels: {
      block: '块级 (block) · 独占整行',
      inline: '行内 (inline) · 不换行',
      'inline-block': '行内块 (inline-block) · 可设宽高',
      flex: '弹性布局 (flex) · 排列子元素',
      'inline-flex': '行内弹性 (inline-flex)',
      grid: '网格布局 (grid) · 行列网格排布',
      'inline-grid': '行内网格 (inline-grid)',
      none: '隐藏 (none) · 不占据空间'
    },
    help: {
      title: '显示模式 display',
      content:
        '控制容器自身的呈现方式及如何排布内部子元素：\n' +
        '• block 块级：默认独占整行\n' +
        '• flex 弹性：横排或竖排子元素，支持对齐与自动换行\n' +
        '• grid 网格：类似表格的二维网格，做多列卡片或复杂布局最强\n' +
        '• inline 行内 / inline-block 行内块 / none 隐藏'
    }
  },
  {
    key: 'flexDirection', label: '轴线方向 (flex-direction)', category: 'Flex & Grid 布局', input: 'select', scope: '父',
    options: ['row', 'row-reverse', 'column', 'column-reverse'],
    optionLabels: {
      row: '横排 (row) · 左到右',
      'row-reverse': '反向横排 (row-reverse) · 右到左',
      column: '竖排 (column) · 上到下',
      'column-reverse': '反向竖排 (column-reverse) · 下到上'
    },
    excludeTypes: ['img', 'input', 'hr', 'textarea', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label', 'li'],
    help: { title: '轴线方向 flex-direction', content: 'Flex 主轴方向：row 横排（默认）、column 竖排。控制里面子元素沿哪条轴线排布。' }
  },
  {
    key: 'flexWrap', label: '弹性换行 (flex-wrap)', category: 'Flex & Grid 布局', input: 'select', scope: '父',
    options: ['nowrap', 'wrap', 'wrap-reverse'],
    optionLabels: {
      nowrap: '不换行 (nowrap) · 单行挤压',
      wrap: '自动换行 (wrap) · 多卡片推荐',
      'wrap-reverse': '反向换行 (wrap-reverse)'
    },
    excludeTypes: ['img', 'input', 'hr', 'textarea', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label', 'li'],
    help: { title: '弹性换行 flex-wrap', content: '子元素一行排不下时是否折行：\n• nowrap 不换行（默认）\n• wrap 自动折行（排多张卡片推荐）' }
  },
  {
    key: 'justifyContent', label: '主轴对齐 (justify-content)', category: 'Flex & Grid 布局', input: 'select', scope: '父',
    options: ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'],
    optionLabels: {
      'flex-start': '开头靠拢 (flex-start)',
      'flex-end': '末尾靠拢 (flex-end)',
      center: '居中对齐 (center)',
      'space-between': '两端贴边平分 (space-between)',
      'space-around': '每项两侧等距 (space-around)',
      'space-evenly': '整体完全均分 (space-evenly)'
    },
    excludeTypes: ['img', 'input', 'hr', 'textarea', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label', 'li'],
    help: { title: '主轴对齐 justify-content', content: '子元素在主轴方向（默认横向）的分布位置：两端平分、居中、靠左等。' }
  },
  {
    key: 'alignItems', label: '交叉轴对齐 (align-items)', category: 'Flex & Grid 布局', input: 'select', scope: '父',
    options: ['stretch', 'flex-start', 'flex-end', 'center', 'baseline'],
    optionLabels: {
      stretch: '拉伸占满 (stretch)',
      'flex-start': '顶部对齐 (flex-start)',
      'flex-end': '底部对齐 (flex-end)',
      center: '垂直居中 (center)',
      baseline: '文字基线 (baseline)'
    },
    excludeTypes: ['img', 'input', 'hr', 'textarea', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label', 'li'],
    help: { title: '交叉轴对齐 align-items', content: '子元素在交叉轴（默认垂直方向）的对齐方式：垂直居中、拉伸等。' }
  },
  {
    key: 'gap', label: '元素间距 (gap)', category: 'Flex & Grid 布局', input: 'number', unit: 'px', scope: '父',
    placeholder: '例：16',
    excludeTypes: ['img', 'input', 'hr', 'textarea', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label', 'li'],
    help: { title: '元素间距 gap', content: 'Flex 或 Grid 容器内子元素之间的空隙大小。一次设定，全容器子项均匀生效。' }
  },
  {
    key: 'gridTemplateColumns', label: '网格列模板 (grid-template-columns)', category: 'Flex & Grid 布局', input: 'text', scope: '父',
    placeholder: '例：repeat(3, 1fr) 或 200px 1fr',
    excludeTypes: ['img', 'input', 'hr', 'textarea', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label', 'li'],
    help: {
      title: '网格列模板 grid-template-columns',
      content:
        '定义网格划分多少列、每列多宽：\n' +
        '• repeat(3, 1fr)：均分 3 列\n' +
        '• repeat(2, 1fr)：均分 2 列\n' +
        '• 240px 1fr：左侧固定 240px，右侧撑满剩余空间\n' +
        '• repeat(auto-fill, minmax(200px, 1fr))：自适应响应式卡片流'
    }
  },
  {
    key: 'gridTemplateRows', label: '网格行模板 (grid-template-rows)', category: 'Flex & Grid 布局', input: 'text', scope: '父',
    placeholder: '例：auto 或 100px 1fr',
    excludeTypes: ['img', 'input', 'hr', 'textarea', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label', 'li'],
    help: { title: '网格行模板 grid-template-rows', content: '定义网格每一行的高度。留空或 auto 表示由内容自动撑开。' }
  },
  {
    key: 'justifyItems', label: '单元格水平对齐 (justify-items)', category: 'Flex & Grid 布局', input: 'select', scope: '父',
    options: ['stretch', 'start', 'center', 'end'],
    optionLabels: {
      stretch: '拉伸铺满 (stretch)',
      start: '靠左对齐 (start)',
      center: '水平居中 (center)',
      end: '靠右对齐 (end)'
    },
    excludeTypes: ['img', 'input', 'hr', 'textarea', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label', 'li'],
    help: { title: '单元格水平对齐 justify-items', content: 'Grid 网格容器内所有子元素在各自单元格内的水平对齐。' }
  },
  {
    key: 'gridColumn', label: '跨列占据 (grid-column)', category: 'Flex & Grid 布局', input: 'text', scope: '子',
    placeholder: '例：span 2（跨2列）或 1 / -1（撑满整行）',
    help: { title: '跨列占据 grid-column', content: '控制当前元素在网格中跨越几列。例：span 2 表示占 2 列，1 / -1 占整行。' }
  },
  {
    key: 'alignSelf', label: '自身交叉轴对齐 (align-self)', category: 'Flex & Grid 布局', input: 'select', scope: '子',
    options: ['auto', 'flex-start', 'flex-end', 'center', 'baseline', 'stretch'],
    optionLabels: {
      auto: '跟随父容器 (auto)',
      'flex-start': '顶部靠齐 (flex-start)',
      'flex-end': '底部靠齐 (flex-end)',
      center: '垂直居中 (center)',
      baseline: '文字基线 (baseline)',
      stretch: '拉伸占满 (stretch)'
    },
    help: { title: '自身对齐 align-self', content: '覆盖父容器的统一对齐设置，单独控制当前子元素自身的垂直对齐位置。' }
  },
  {
    key: 'flexGrow', label: '放大分配比例 (flex-grow)', category: 'Flex & Grid 布局', input: 'number', scope: '子',
    placeholder: '例：1（均分剩余空间）',
    help: { title: '放大比例 flex-grow', content: '容器有多余空间时自身瓜分的比例。0 = 不放大；1 = 均分剩余空间。' }
  },
  {
    key: 'flexShrink', label: '缩小挤压比例 (flex-shrink)', category: 'Flex & Grid 布局', input: 'number', scope: '子',
    placeholder: '例：0（禁止被压缩）',
    help: { title: '缩小比例 flex-shrink', content: '空间不足时自身缩小的比例。1 = 正常等比缩小；0 = 禁止被挤压变形。' }
  },

  // —— 其他 ——
  {
    key: 'overflow', label: '溢出处理 (overflow)', category: '其他', input: 'select', scope: '父',
    options: ['visible', 'hidden', 'auto', 'scroll'],
    optionLabels: {
      visible: '内容溢出可见 (visible)',
      hidden: '溢出部分裁切 (hidden)',
      auto: '需要时出滚动条 (auto)',
      scroll: '总是显示滚动条 (scroll)'
    },
    help: { title: '溢出处理 overflow', content: '内容比元素框大放不下时怎么办：显示在外面、裁切掉或出现滚动条。' }
  },
  {
    key: 'cursor', label: '鼠标指针形状 (cursor)', category: '其他', input: 'select', scope: '子',
    options: ['default', 'pointer', 'text', 'crosshair', 'move', 'not-allowed', 'grab'],
    optionLabels: {
      default: '默认箭头 (default)',
      pointer: '手型/可点击 (pointer)',
      text: '工字输入 (text)',
      crosshair: '十字准星 (crosshair)',
      move: '四向移动 (move)',
      'not-allowed': '禁止符号 (not-allowed)',
      grab: '抓手 (grab)'
    },
    help: { title: '鼠标指针 cursor', content: '鼠标悬停在元素上时的指针形状。链接或按钮常用 pointer 手型。' }
  },
  {
    key: 'userSelect', label: '文本可选性 (user-select)', category: '其他', input: 'select', scope: '子',
    options: ['auto', 'none', 'text', 'all'],
    optionLabels: { auto: '自动默认 (auto)', none: '禁止选中文字 (none · 按钮防选中)', text: '可选中文本 (text)', all: '点击全选 (all)' },
    help: { title: '文本可选 user-select', content: '防止用户双击按钮时误选文字。' }
  },
  {
    key: 'pointerEvents', label: '鼠标交互响应 (pointer-events)', category: '其他', input: 'select', scope: '子',
    options: ['auto', 'none'],
    optionLabels: { auto: '正常响应点击 (auto)', none: '穿透忽略点击 (none · 背景装饰用)' },
    help: { title: '鼠标响应 pointer-events', content: '设为 none 时鼠标点击会穿透此元素点击下方。' }
  },
  {
    key: 'transition', label: '平滑过渡动画 (transition)', category: '其他', input: 'transition', scope: '子',
    placeholder: '例：all 0.3s ease / background 0.2s',
    help: { title: '平滑过渡动画 transition', content: '让颜色、大小、位置在状态改变（如 hover 悬停）时不再生硬突变，而是平滑渐变！\n\n常用写法：\n· all 0.3s ease —— 所有样式 0.3 秒平滑过渡 (推荐)\n· background 0.2s —— 仅背景色 0.2 秒过渡\n· transform 0.2s ease —— 仅位移/缩放过渡' }
  },
  {
    key: 'transform', label: '变换与缩放 (transform)', category: '其他', input: 'transform', scope: '子',
    placeholder: '例：scale(1.05) / translateY(-4px)',
    help: { title: '变换与缩放 transform', content: '用于实现微动效：\n· translateY(-4px) —— 向上悬浮 4px (卡片 hover 常用)\n· scale(1.05) —— 放大 1.05 倍\n· rotate(45deg) —— 旋转 45 度' }
  }
];

// ============ 元素 HTML 原生属性（class / id / src / alt / href）============
export interface AttrSchema {
  key: string;
  label: string;
  onlyTypes?: ElementType[];
  placeholder?: string;
  help?: { title: string; content: string };
}

export const ATTRS_SCHEMA: AttrSchema[] = [
  {
    key: 'className', label: '类名 Class', placeholder: '多个用空格分隔，例：btn primary',
    help: { title: '类名 Class', content: '给元素起一个名字，同类名 = 一起变。' }
  },
  {
    key: 'id', label: 'ID 唯一标识', placeholder: '页面内唯一 ID',
    help: { title: 'ID 唯一标识', content: '页面内必须唯一的标识符。' }
  },
  {
    key: 'src', label: '图片路径 src', onlyTypes: ['img'],
    placeholder: '相对路径 / 绝对路径 / 网络 URL',
    help: { title: '图片路径 src', content: '图片来源：支持相对路径 (如 ./images/pic.png)、网络 URL 或本地绝对路径。' }
  },
  {
    key: 'alt', label: '替代文字 alt', onlyTypes: ['img'],
    placeholder: '图片描述文字',
    help: { title: '替代文字 alt', content: '图片加载失败或读屏软件读出的描述文本。' }
  },
  {
    key: 'href', label: '跳转链接 href', onlyTypes: ['a'],
    placeholder: 'URL，例：https://... 或 #features',
    help: { title: '链接地址 href', content: '点击链接后跳转的目标网页或锚点。' }
  },
  {
    key: 'placeholder', label: '占位水印 placeholder', onlyTypes: ['input', 'textarea'],
    placeholder: '未输入时的水印提示',
    help: { title: '占位文字 placeholder', content: '输入框为空时显示的水印提示。' }
  },
  {
    key: 'typeAttr', label: '输入类型 type', onlyTypes: ['input'],
    placeholder: 'text / number / email / password / checkbox',
    help: { title: '类型 type', content: '输入框的类型，决定键盘与输入校验。' }
  }
];

// ============ 默认显示的属性（留空：按需添加，保持面板干脆精简） ============
export const DEFAULT_VISIBLE_PROPS: string[] = [];

// ============ 取 schema 项 ============
export function getSchemaItem(key: string): PropertySchema | undefined {
  return SCHEMA.find((s) => s.key === key);
}

// ============ 数值自动补单位 ============
export function applyUnit(v: string, unit?: string): string {
  if (!unit) return v;
  return v
    .split(/\s+/)
    .map((t) => (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? t + unit : t))
    .join(' ');
}

// ============ 动态属性适用性与禁用原因分析 ============
export interface ApplicabilityResult {
  applicable: boolean;
  disabledReason?: string;
}

export function checkApplicability(
  schemaItem: PropertySchema,
  type: ElementType,
  style?: Record<string, string | undefined>
): ApplicabilityResult {
  // 1. 标签黑名单
  if (schemaItem.excludeTypes && schemaItem.excludeTypes.includes(type)) {
    return { applicable: false, disabledReason: `<${type}> 元素天然不支持此属性` };
  }

  const s = style || {};
  const display = s.display || '';
  const position = s.position || 'static';
  const isPureInline = !display && ['span', 'a', 'strong', 'em', 'mark', 'small', 'code', 'del', 'sup', 'sub', 'label'].includes(type);

  // 2. 行内元素宽高
  if ((schemaItem.key === 'width' || schemaItem.key === 'height' || schemaItem.key === 'minHeight' || schemaItem.key === 'maxHeight') && isPureInline) {
    return { applicable: false, disabledReason: '行内元素宽高不生效，需先设 display 为 block 或 inline-block' };
  }

  // 3. 图片及行内元素外边距（特别是垂直外边距与 margin 居中）
  if (schemaItem.key === 'margin' && type === 'img' && !display) {
    return { applicable: false, disabledReason: '图片默认是行内元素，居中/垂直外边距不生效，建议先设置 display 为 block 或 flex' };
  }
  if (schemaItem.key === 'margin' && isPureInline) {
    return { applicable: false, disabledReason: '行内元素垂直外边距不生效，建议先设置 display 为 block 或 inline-block' };
  }

  // 4. Flex 容器属性
  const flexContainerProps = ['flexDirection', 'flexWrap', 'justifyContent', 'alignItems'];
  if (flexContainerProps.includes(schemaItem.key) && display !== 'flex' && display !== 'inline-flex') {
    return { applicable: false, disabledReason: '需先将显示模式 (display) 设为 flex 弹性布局' };
  }

  // 5. Grid 容器属性
  const gridContainerProps = ['gridTemplateColumns', 'gridTemplateRows', 'justifyItems'];
  if (gridContainerProps.includes(schemaItem.key) && display !== 'grid' && display !== 'inline-grid') {
    return { applicable: false, disabledReason: '需先将显示模式 (display) 设为 grid 网格布局' };
  }

  // 6. 定位偏移属性
  const posProps = ['top', 'right', 'bottom', 'left', 'zIndex'];
  if (posProps.includes(schemaItem.key) && (!position || position === 'static')) {
    return { applicable: false, disabledReason: '需先将定位模式 (position) 设为 relative、absolute 或 fixed' };
  }

  // 7. 列表专属属性
  const listProps = ['listStyleType', 'listStylePosition'];
  if (listProps.includes(schemaItem.key) && !['ul', 'ol', 'li'].includes(type)) {
    return { applicable: false, disabledReason: '仅适用于 <ul>、<ol> 或 <li> 列表元素' };
  }

  // 8. 多媒体属性
  const mediaProps = ['objectFit', 'objectPosition'];
  if (mediaProps.includes(schemaItem.key) && type !== 'img') {
    return { applicable: false, disabledReason: '仅适用于 <img> 图片元素' };
  }

  return { applicable: true };
}

export function isApplicable(schemaItem: PropertySchema, type: ElementType, style?: Record<string, string | undefined>): boolean {
  return checkApplicability(schemaItem, type, style).applicable;
}

// ============ 判断 ElementStyle 当前是否"已添加"该属性 ============
export function hasStyleValue(style: Record<string, string | undefined>, schemaItem: PropertySchema): boolean {
  if ((schemaItem.input === 'box4' || schemaItem.input === 'trbl') && schemaItem.sides) {
    return schemaItem.sides.some((s) => isPresent(style[s.key]));
  }
  return isPresent(style[schemaItem.key]);
}

function isPresent(v: string | undefined): boolean {
  return v != null;
}

// ============ 删除一条属性：从 style 清空 ============
export function clearStyleKeys(style: Record<string, string | undefined>, schemaItem: PropertySchema): Record<string, string | undefined> {
  const newStyle = { ...style };
  const keys = (schemaItem.input === 'box4' || schemaItem.input === 'trbl') && schemaItem.sides
    ? schemaItem.sides.map((s) => s.key)
    : [schemaItem.key];
  for (const k of keys) newStyle[k] = undefined;
  return newStyle;
}
