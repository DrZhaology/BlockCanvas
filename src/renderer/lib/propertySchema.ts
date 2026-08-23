// BlockCanvas · CSS 属性 Schema
// 按需添加属性架构：所有可选 CSS 属性都在此声明
// Inspector 根据 schema 渲染对应输入组件，并管理"哪些属性已添加"

import type { ElementType } from './types';

/** 属性分类 */
export type PropertyCategory =
  | '盒模型'
  | '颜色'
  | '字体'
  | '边框'
  | '阴影'
  | '定位'
  | 'Flex 布局'
  | '其他';

/** 输入控件类型 */
export type InputType = 'text' | 'color' | 'select' | 'box4' | 'trbl' | 'number';

/**
 * 简写类型说明（trbl = top/right/bottom/left）：
 * - input === 'box4'：4 个输入框分别填（保留给 borderWidth）
 * - input === 'trbl'：单个输入框，填 1~4 个值（空格分隔，按 上 右 下 左），
 *   如 10px / 0 auto / 8px 16px 4px 2px；内部拆成 4 边字段存储

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
  /** 仅这些元素类型不显示该属性（黑名单）。无 = 所有元素都可用 */
  excludeTypes?: ElementType[];
  /** 4 边拆分的"连锁"属性名（例如 padding 拆成 paddingTop 等）；
   * 仅在 input === 'box4' 时生效：box4 在 schema 上是单条 padding，渲染时展开成 4 边输入 */
  sides?: { key: string; label: string }[];
  /** "?" 帮助 */
  help?: { title: string; content: string };
}

// ============ 单位体系（数值输入"数字 + 单位下拉"） ============
// 数字框只收数字；单位用下拉选。options 顺序即下拉顺序，px 放最前。
export const CSS_UNITS = ['px', 'rem', 'em', '%', 'vw', 'vh', 'vmin', 'vmax', 'pt', 'pc', 'cm', 'mm', 'in', 'ch', 'ex'];

// 每个单位的人话解释：下拉 option 的 title + "?" 帮助共用
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

// 数值属性 "?" 帮助里统一附上的单位讲解（渲染时按需追加）
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
    key: 'width', label: '宽度 Width', category: '盒模型', input: 'number', unit: 'px', allowAuto: true,
    placeholder: '例：300',
    help: { title: '宽度 Width', content: '元素的左右方向尺寸（多宽）。auto = 宽度随内容与容器自动算（默认）。填数字 + 单位下拉即可。' }
  },
  {
    key: 'height', label: '高度 Height', category: '盒模型', input: 'number', unit: 'px', allowAuto: true,
    placeholder: '例：80',
    help: { title: '高度 Height', content: '元素的上下方向尺寸（多高）。文字类元素建议留 auto 让它自己撑开，图片/容器才写死。' }
  },
  {
    key: 'minHeight', label: '最小高度 Min-Height', category: '盒模型', input: 'number', unit: 'px',
    placeholder: '例：60',
    help: { title: '最小高度 Min-Height', content: '内容再少，高度也至少是这个值。空容器常用：避免「插进去了却看不见」。' }
  },
  {
    key: 'maxWidth', label: '最大宽度 Max-Width', category: '盒模型', input: 'number', unit: 'px', allowAuto: true,
    placeholder: '例：960',
    help: { title: '最大宽度 Max-Width', content: '宽度上限：再宽也不超过它。常用在整段内容上，防止一行文字拉太长难读。auto = 不限制（默认）。' }
  },
  {
    key: 'padding', label: '内边距 padding', category: '盒模型', input: 'trbl', unit: 'px',
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
        '比喻：相框里照片与相框边之间的白纸边。\n' +
        '一个输入框即可，填 1~4 个值（空格分隔，顺序：上 右 下 左）：\n' +
        '• 1 个值：四周相同，如 10px\n' +
        '• 2 个值：上下 / 左右，如 0 auto\n' +
        '• 3 个值：上 / 左右 / 下\n' +
        '• 4 个值：上 右 下 左 分别，如 8px 4px 8px 4px'
    }
  },
  {
    key: 'margin', label: '外边距 margin', category: '盒模型', input: 'trbl', unit: 'px',
    sides: [
      { key: 'marginTop', label: '上' },
      { key: 'marginRight', label: '右' },
      { key: 'marginBottom', label: '下' },
      { key: 'marginLeft', label: '左' }
    ],
    placeholder: '10px',
    help: {
      title: '外边距 margin',
      content:
        '元素"边框以外"与其他元素之间的间距。\n' +
        '比喻：相框与墙上其他相框之间的距离。\n' +
        '与 padding 的区别：padding 在边框内，margin 在边框外。\n' +
        '填法同 padding：1 个值四周相同，如 10px；2 个值上下/左右，如 0 auto。'
    }
  },
  {
    key: 'boxSizing', label: '盒模型尺寸 Box-Sizing', category: '盒模型', input: 'select',
    options: ['content-box', 'border-box'],
    optionLabels: { 'content-box': '宽高只算内容', 'border-box': '宽高含内边距和边框' },
    help: {
      title: '盒模型 Box-Sizing',
      content:
        '决定 width/height 是否包含 padding 和 border。\n' +
        '• content-box（默认）：width 仅含内容\n' +
        '• border-box：width 含 padding 和 border\n' +
        '"border-box" 在做布局时几乎总是更好用，因为它计算直观。'
    }
  },

  // —— 颜色 ——
  {
    key: 'backgroundColor', label: '背景色 Background', category: '颜色', input: 'color',
    placeholder: '#ffffff / rgb(...) / red',
    help: {
      title: '背景色 Background-Color',
      content:
        '元素背景填充色。支持：\n' +
        '• #hex：#fff / #1e88e5\n' +
        '• rgb()：rgb(30,136,229)\n' +
        '• rgba()：rgba(30,136,229,0.5)，最后一位是透明度 0-1\n' +
        '• 英文色名：red / orange / yellow / green / blue / black / white 等 17 种基本色'
    }
  },
  {
    key: 'color', label: '文字颜色 Text Color', category: '颜色', input: 'color',
    placeholder: '#000000 / rgb(...) / black',
    excludeTypes: ['img', 'input', 'hr', 'textarea'],
    help: { title: '文字颜色 Text Color', content: '文本字体的颜色。值同"背景色"，支持 hex/rgb/rgba/英文色名。' }
  },
  {
    key: 'opacity', label: '不透明度 Opacity', category: '颜色', input: 'text',
    placeholder: '0 ~ 1，例：0.5',
    help: { title: '不透明度 Opacity', content: '整个元素（连同里面的内容）的透明程度：0 = 完全看不见，1 = 完全不透明，0.5 = 半透明。' }
  },

  // —— 字体 ——
  {
    key: 'fontSize', label: '字号 Font-Size', category: '字体', input: 'number', unit: 'px',
    placeholder: '例：16',
    excludeTypes: ['img', 'input', 'hr', 'textarea'],
    help: { title: '字号 Font-Size', content: '文字大小。16px 是常见正文大小，20px 上下适合小标题。数字 + 单位下拉即可。' }
  },
  {
    key: 'fontWeight', label: '字重 Font-Weight', category: '字体', input: 'select',
    options: ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
    optionLabels: { normal: '常规（400）', bold: '加粗（700）' },
    excludeTypes: ['img', 'input', 'hr', 'textarea'],
    help: { title: '字重 Font-Weight', content: '字的粗细：常规 400 与加粗 700 最常用；100~900 数字越大越粗（中间档位不是每种字体都有）。' }
  },
  {
    key: 'fontFamily', label: '字体 Font-Family', category: '字体', input: 'text',
    placeholder: '例："Microsoft YaHei", sans-serif',
    excludeTypes: ['img', 'input', 'hr', 'textarea'],
    help: { title: '字体 Font-Family', content: '按顺序尝试使用，前一个不存在则用后一个。中文常用 "Microsoft YaHei", sans-serif。' }
  },
  {
    key: 'lineHeight', label: '行高 Line-Height', category: '字体', input: 'text',
    placeholder: '例：1.6 / 24px',
    excludeTypes: ['img', 'input', 'hr', 'textarea'],
    help: { title: '行高 Line-Height', content: '每行文字之间的高度：数字越大，行距越松，段落越透气。读长文建议 1.5~1.8（无单位 = 字号的倍数）。' }
  },
  {
    key: 'textAlign', label: '文字对齐 Text-Align', category: '字体', input: 'select',
    options: ['left', 'center', 'right', 'justify'],
    optionLabels: { left: '左对齐', center: '居中', right: '右对齐', justify: '两端对齐' },
    excludeTypes: ['img', 'input', 'hr', 'textarea'],
    help: { title: '文字对齐 Text-Align', content: '文字在元素里水平摆在哪：左对齐（中文默认）/ 居中 / 右对齐 / 两端对齐（最后一行保持左对齐）。' }
  },
  {
    key: 'letterSpacing', label: '字间距 Letter-Spacing', category: '字体', input: 'number', unit: 'px',
    placeholder: '例：2',
    excludeTypes: ['img', 'input', 'hr', 'textarea'],
    help: { title: '字间距 letter-spacing', content: '字符之间的额外间距。正值展开（适合做标题），负值收紧。' }
  },

  // —— 边框 ——
  {
    key: 'borderWidth', label: '边框宽度 Border-Width', category: '边框', input: 'box4', unit: 'px',
    sides: [
      { key: 'borderTopWidth', label: '上' },
      { key: 'borderRightWidth', label: '右' },
      { key: 'borderBottomWidth', label: '下' },
      { key: 'borderLeftWidth', label: '左' }
    ],
    placeholder: '1px',
    help: { title: '边框宽度 Border-Width', content: '边框线条的粗细。要能看见，还得搭配「边框样式 Border-Style」选实线 solid、并给「边框颜色 Border-Color」上色。' }
  },
  {
    key: 'borderStyle', label: '边框样式 Border-Style', category: '边框', input: 'select',
    options: ['none', 'solid', 'dashed', 'dotted', 'double'],
    optionLabels: { none: '无', solid: '实线', dashed: '虚线', dotted: '点线', double: '双实线' },
    help: { title: '边框样式 Border-Style', content: '边框的线条形状：\n• none 无\n• solid 实线\n• dashed 虚线\n• dotted 点线\n• double 双实线' }
  },
  {
    key: 'borderColor', label: '边框颜色 Border-Color', category: '边框', input: 'color',
    placeholder: '#ccc / rgb(...) / black',
    help: { title: '边框颜色 border-color', content: '边框线条颜色。值同"背景色"格式。' }
  },
  {
    key: 'borderRadius', label: '圆角 Border-Radius', category: '边框', input: 'trbl', unit: 'px',
    sides: [
      { key: 'borderTopLeftRadius', label: '左上' },
      { key: 'borderTopRightRadius', label: '右上' },
      { key: 'borderBottomRightRadius', label: '右下' },
      { key: 'borderBottomLeftRadius', label: '左下' }
    ],
    placeholder: '8px',
    help: {
      title: '圆角 Border-Radius',
      content:
        '边框拐角的弧度。50% 可做圆形，8px 是常见的"圆角"程度。\n' +
        '填法同 padding：1 个值四角相同；2 个值 左上右下 / 右上左下；\n' +
        '4 个值按 左上 右上 右下 左下。'
    }
  },

  // —— 阴影 ——
  {
    key: 'boxShadow', label: '盒子阴影 Box-Shadow', category: '阴影', input: 'text',
    placeholder: '例：0 2px 6px rgba(0,0,0,0.15)',
    help: {
      title: '盒子阴影 Box-Shadow',
      content:
        '格式：水平偏移 垂直偏移 模糊距离 阴影大小 颜色\n' +
        '例：0 2px 6px rgba(0,0,0,0.15)\n' +
        '  = 水平 0、垂直 2、模糊 6、不变大、黑色 15% 透明'
    }
  },
  {
    key: 'textShadow', label: '文字阴影 Text-Shadow', category: '阴影', input: 'text',
    placeholder: '例：1px 1px 2px rgba(0,0,0,0.3)',
    excludeTypes: ['img', 'input', 'hr', 'textarea'],
    help: { title: '文字阴影 Text-Shadow', content: '同 box-shadow 格式，但只给文字加阴影。' }
  },

  // —— 定位 ——
  {
    key: 'position', label: '定位模式 Position', category: '定位', input: 'select',
    options: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
    optionLabels: {
      static: '跟随文档流（默认）',
      relative: '占位不变，相对自身偏移',
      absolute: '脱离文档流，相对最近定位祖先',
      fixed: '脱离文档流，相对视窗固定',
      sticky: '滚动到阈值后固定'
    },
    help: {
      title: '定位 Position',
      content:
        'static（默认）：跟随文档流\n' +
        'relative：占流式位置但相对自身偏移\n' +
        'absolute：脱离文档流，相对最近的非 static 祖先定位\n' +
        'fixed：脱离文档流，相对视窗定位\n' +
        'sticky：先跟随文档流，滚动到阈值时变 fixed。\n\n' +
        '阶段 3：absolute/fixed 切到后画布会开启自由拖动。'
    }
  },
  {
    key: 'top', label: '上偏移 Top', category: '定位', input: 'number', unit: 'px', allowAuto: true,
    placeholder: '例：20',
    help: { title: '上偏移 Top', content: '定位非 static 时，距离参考顶部的距离。auto 表示由浏览器自动计算。' }
  },
  {
    key: 'right', label: '右偏移 Right', category: '定位', input: 'number', unit: 'px', allowAuto: true,
    placeholder: '例：20',
    help: { title: '右偏移 Right', content: '定位非 static 时，距离参考右侧的距离。' }
  },
  {
    key: 'bottom', label: '下偏移 Bottom', category: '定位', input: 'number', unit: 'px', allowAuto: true,
    placeholder: '例：20',
    help: { title: '下偏移 Bottom', content: '定位非 static 时，距离参考底部的距离。' }
  },
  {
    key: 'left', label: '左偏移 Left', category: '定位', input: 'number', unit: 'px', allowAuto: true,
    placeholder: '例：20',
    help: { title: '左偏移 Left', content: '定位非 static 时，距离参考左侧的距离。' }
  },
  {
    key: 'zIndex', label: '图层层级 Z-Index', category: '定位', input: 'number',
    placeholder: '例：10',
    help: { title: '图层层级 Z-Index', content: '值越大越在前。需先设 position 非 static 才生效。' }
  },

  // —— Flex 布局 ——
  {
    key: 'display', label: '显示模式 Display', category: 'Flex 布局', input: 'select',
    options: ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'none', 'grid'],
    optionLabels: {
      block: '块级（独占一行）',
      inline: '行内（不换行）',
      'inline-block': '行内块（可设宽高）',
      flex: '弹性横排（排子元素）',
      'inline-flex': '行内弹性容器',
      none: '隐藏（不显示）',
      grid: '网格布局'
    },
    help: {
      title: '显示模式 Display',
      content:
        'block 块级（独占一行）；inline 行内（不换行）；inline-block 行内但可设宽高；\n' +
        'flex 弹性布局（横向排列子元素，可设对齐方式）；grid 网格；none 不显示。'
    }
  },
  {
    key: 'flexDirection', label: '轴线方向 Flex-Direction', category: 'Flex 布局', input: 'select', scope: '父',
    options: ['row', 'row-reverse', 'column', 'column-reverse'],
    optionLabels: {
      row: '横排（左→右）',
      'row-reverse': '横排（右→左）',
      column: '竖排（上→下）',
      'column-reverse': '竖排（下→上）'
    },
    excludeTypes: ['img', 'input', 'hr', 'textarea', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label', 'li'],
    help: { title: '轴线方向 Flex-Direction', content: '主轴方向：row 横排（默认）、column 竖排。作用在父容器上，控制里面子元素怎么排。需先设 display:flex。' }
  },
  {
    key: 'justifyContent', label: '主轴对齐 Justify-Content', category: 'Flex 布局', input: 'select', scope: '父',
    options: ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'],
    optionLabels: {
      'flex-start': '开头对齐',
      'flex-end': '结尾对齐',
      center: '居中',
      'space-between': '两端对齐，中间平分',
      'space-around': '每个子项两侧等距',
      'space-evenly': '完全均分'
    },
    excludeTypes: ['img', 'input', 'hr', 'textarea', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label', 'li'],
    help: { title: '主轴对齐 Justify-Content', content: '子元素们在主轴上（默认横向）整体摆在哪：靠左 / 靠右 / 居中 / 两端分开 / 均匀带间距分布。作用在父容器上。' }
  },
  {
    key: 'alignItems', label: '交叉轴对齐 Align-Items', category: 'Flex 布局', input: 'select', scope: '父',
    options: ['stretch', 'flex-start', 'flex-end', 'center', 'baseline'],
    optionLabels: {
      stretch: '拉伸占满',
      'flex-start': '顶部对齐',
      'flex-end': '底部对齐',
      center: '垂直居中',
      baseline: '按文字基线对齐'
    },
    excludeTypes: ['img', 'input', 'hr', 'textarea', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label', 'li'],
    help: { title: '交叉轴对齐 Align-Items', content: '子元素们在另一条轴上（默认纵向）对齐：拉伸占满 / 顶部 / 底部 / 垂直居中 / 按文字底线。作用在父容器上。' }
  },
  {
    key: 'gap', label: '子元素间距 Gap', category: 'Flex 布局', input: 'number', unit: 'px', scope: '父',
    placeholder: '例：8',
    excludeTypes: ['img', 'input', 'hr', 'textarea', 'h1', 'h2', 'h3', 'h4', 'p', 'span', 'button', 'a', 'label', 'li'],
    help: { title: '子元素间距 Gap', content: '一排/一列子元素之间留多少空白。作用在父容器上，一次管所有直接子元素，不用挨个设外边距。' }
  },

  // —— 其他 ——
  {
    key: 'overflow', label: '溢出处理 Overflow', category: '其他', input: 'select',
    options: ['visible', 'hidden', 'auto', 'scroll'],
    optionLabels: {
      visible: '内容溢出也能看到',
      hidden: '溢出部分裁掉',
      auto: '需要时自动出滚动条',
      scroll: '总是显示滚动条'
    },
    help: { title: '溢出 Overflow', content: '内容比元素框大放不下时怎么办：显示在外面（默认）/ 裁掉看不见 / 需要时加滚动条 / 总是显示滚动条。' }
  },
  {
    key: 'cursor', label: '鼠标指针 Cursor', category: '其他', input: 'select',
    options: ['default', 'pointer', 'text', 'crosshair', 'move', 'not-allowed', 'grab'],
    optionLabels: {
      default: '默认箭头',
      pointer: '手形（可点击）',
      text: '工字（可输入）',
      crosshair: '十字准星',
      move: '四向移动',
      'not-allowed': '禁止符号',
      grab: '抓手'
    },
    help: { title: '鼠标指针 cursor', content: '鼠标悬停在元素上时的指针形状。pointer 手形（链接/可点击）、text 工字（可输入）。' }
  }
];

// ============ 元素 HTML 原生属性（class / id / src / alt / href）============
// 这部分不走 CSS style，单独一区管理
export interface AttrSchema {
  key: string;
  label: string;
  /** 仅这些元素类型才显示该属性 */
  onlyTypes?: ElementType[];
  placeholder?: string;
  help?: { title: string; content: string };
}

export const ATTRS_SCHEMA: AttrSchema[] = [
  {
    key: 'className', label: '类名 Class', placeholder: '多个用空格分隔，例： btn primary',
    help: { title: '类名 Class', content: '给元素起一个名字，同类名 = 一起变：\n\n1. 这里填 banner\n2. 「属性 → 页面」的全局 CSS 里写 .banner { background-color: gold; }\n\n多个元素填同名（如 btn）= 它们共用一套样式。名字支持字母、数字、横线、下划线，多个名字用空格分开。' }
  },
  {
    key: 'id', label: 'ID', placeholder: '页面内唯一标识',
    help: { title: 'ID 唯一标识', content: '页面内必须唯一的标识符。后续 Blockly 编程用 ID 定位元素。' }
  },
  {
    key: 'src', label: '图片路径 src', onlyTypes: ['img'],
    placeholder: 'URL 或本地绝对路径',
    help: { title: '图片路径 src', content: '图片来源：可以是 http:// 链接或本地文件路径。' }
  },
  {
    key: 'alt', label: '替代文字 Alt', onlyTypes: ['img'],
    placeholder: '图片描述',
    help: { title: '替代文字 alt', content: '图片加载失败或被屏幕阅读器读时显示的描述文字。' }
  },
  {
    key: 'href', label: '链接地址 href', onlyTypes: ['a'],
    placeholder: 'URL，例：https://...',
    help: { title: '链接地址 href', content: '点击链接后跳转的地址。# 表示当前页（占位）。' }
  },
  {
    key: 'placeholder', label: '占位文字 Placeholder', onlyTypes: ['input', 'textarea'],
    placeholder: '未输入时的提示',
    help: { title: '占位文字 placeholder', content: '输入框空着时显示的水印文字，提示用户该填什么。' }
  },
  {
    key: 'typeAttr', label: '类型 Type', onlyTypes: ['input'],
    placeholder: 'text / number / email / password / ...',
    help: { title: '类型 Type', content: '输入框的类型，决定键盘与校验。常用：text/number/email/password/checkbox/radio。' }
  }
];

// ============ 默认显示的两个基础属性 ============
// 用户反馈"默认只保留宽度和高度"
export const DEFAULT_VISIBLE_PROPS = ['width', 'height'];

// ============ 取 schema 项 ============
export function getSchemaItem(key: string): PropertySchema | undefined {
  return SCHEMA.find((s) => s.key === key);
}

// ============ 数值自动补单位 ============
// 输入 '300' + unit 'px' → '300px'；已有单位/百分比/关键字（auto、1.6 等）原样保留。
// 空白分隔的多个 token 各自处理（trbl 简写共用）。
export function applyUnit(v: string, unit?: string): string {
  if (!unit) return v;
  return v
    .split(/\s+/)
    .map((t) => (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? t + unit : t))
    .join(' ');
}

// ============ 一条属性是否对该元素类型适用 ============
export function isApplicable(schemaItem: PropertySchema, type: ElementType): boolean {
  if (!schemaItem.excludeTypes) return true;
  return !schemaItem.excludeTypes.includes(type);
}

// ============ 判断 ElementStyle 当前是否"已添加"该属性 ============
// box4/trbl 类型：4 边任一有值（含空字符串）即视为已添加，防止用户清空文本框后面板消失
// 其他类型：对应 key 在 style 里"存在"（即便空字符串）即视为已添加
export function hasStyleValue(style: Record<string, string | undefined>, schemaItem: PropertySchema): boolean {
  if ((schemaItem.input === 'box4' || schemaItem.input === 'trbl') && schemaItem.sides) {
    return schemaItem.sides.some((s) => isPresent(style[s.key]));
  }
  return isPresent(style[schemaItem.key]);
}

// 与 isNonEmpty 区别：空字符串也算"已存在"——防止清空输入框时面板丢属性
function isPresent(v: string | undefined): boolean {
  return v != null;
}

// ============ 删除一条属性：把对应 key（含 4 边）从 style 清空 ============
export function clearStyleKeys(style: Record<string, string | undefined>, schemaItem: PropertySchema): Record<string, string | undefined> {
  const newStyle = { ...style };
  const keys = (schemaItem.input === 'box4' || schemaItem.input === 'trbl') && schemaItem.sides
    ? schemaItem.sides.map((s) => s.key)
    : [schemaItem.key];
  for (const k of keys) newStyle[k] = undefined;
  return newStyle;
}
