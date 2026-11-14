// BlockCanvas · 元素工厂：新元素长什么样（R6-5）
//
// 这里决定"插一个元素进去，它默认是什么样"：
//   · defaultStyleFor   —— 每种标签的默认样式（这是最长的，126 行，全是业务决策）
//   · defaultAttrsFor   —— 默认 HTML 属性（img 的 alt、input 的 type…）
//   · defaultTextFor    —— 默认文案（按钮写"按钮"、标题写"标题"…）
//   · uuid              —— 新元素 id
//
// 为什么单独一个文件：这些是**纯数据决策**，跟 zustand 一点关系没有，
// 但以前埋在 store 里 200 行 —— 想调"默认按钮多大"要滚半天，
// 而且改它等于改"所有新插入元素的样子"，得能一眼看全。
//
// ⚠ 改这里会改变**所有新元素**的默认外观（已存在的元素不受影响）。
import type { ElementType, SceneElement, ElementStyle } from '@lib/types';


// ============ 工具：UUID ============
export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}


// 一些元素需要预设 HTML 原生属性
export function defaultAttrsFor(type: ElementType): SceneElement['attrs'] {
  switch (type) {
    case 'a': return { href: '#' };
    case 'input':
    case 'textarea':
      return {};
    case 'img':
      return { src: '', alt: '' };
    default: return undefined;
  }
}


// 按元素类型给个基础干净的默认样式（仅保留宽、高、背景等核心必要属性）
export function defaultStyleFor(type: ElementType): ElementStyle {
  switch (type) {
    case 'div':
    case 'section':
    case 'header':
    case 'nav':
    case 'footer':
    case 'main':
    case 'article':
    case 'aside':
      // v0.4.4：块级容器默认 8px 内边距（createElement 会同步写 visibleProps）。
      // ⚠ 必须写 4 个 longhand，不能写 `padding: '8px'` 简写 ——
      // 四值输入（TrblInput）读的是 paddingTop/... 4 个字段，写简写会显示 0,0,0,0，
      // 且用户编辑 longhand 时残留的简写会在 simplifyStyle 输出里反过来覆盖它（改不动）。
      // 4 边都有值 → 导出时 simplifyStyle 自动合并回 `padding: 8px` 简写，代码依旧干净。
      return {
        width: '100%',
        minHeight: '80px',
        paddingTop: '8px',
        paddingRight: '8px',
        paddingBottom: '8px',
        paddingLeft: '8px',
        backgroundColor: '#eaf2ff'
      };
    case 'h1':
      return { fontSize: '32px', fontWeight: '700' };
    case 'h2':
      return { fontSize: '24px', fontWeight: '700' };
    case 'h3':
      return { fontSize: '20px', fontWeight: '700' };
    case 'h4':
      return { fontSize: '16px', fontWeight: '700' };
    case 'p':
      return { lineHeight: '1.6' };
    case 'button':
      return {
        width: '120px',
        height: '36px',
        backgroundColor: '#1e88e5',
        color: '#ffffff',
        cursor: 'pointer'
      };
    case 'a':
      return { color: '#1e88e5', textDecoration: 'underline' };
    case 'span':
      return {
        backgroundColor: '#fff3cd'
      };
    case 'img':
      return {
        width: '200px',
        height: '120px',
        backgroundColor: '#e2e8f0'
      };
    case 'input':
      return {
        width: '200px',
        height: '32px',
        backgroundColor: '#ffffff'
      };
    case 'textarea':
      return {
        width: '280px',
        height: '80px',
        backgroundColor: '#ffffff'
      };
    case 'hr':
      return {
        width: '100%',
        height: '1px',
        backgroundColor: '#c8ccd4'
      };
    case 'table':
      return { width: '100%', minHeight: '60px', backgroundColor: '#ffffff' };
    case 'thead':
    case 'tbody':
    case 'tfoot':
      return {};
    case 'caption':
      return {
        paddingTop: '6px',
        paddingBottom: '6px',
        fontWeight: '600',
        textAlign: 'center'
      };
    case 'th':
    case 'td':
      return {
        minHeight: '32px',
        backgroundColor: type === 'th' ? '#f1f5f9' : '#ffffff'
      };
    case 'blockquote':
      return {
        minHeight: '40px',
        backgroundColor: '#f8fafc'
      };
    case 'code':
      return {
        backgroundColor: '#f1f5f9',
        color: '#be185d'
      };
    case 'mark':
      return { backgroundColor: '#fef08a', color: '#713f12' };
    case 'ul':
    case 'ol':
      return {
        width: '100%',
        minHeight: '32px',
        backgroundColor: '#f8fafc'
      };
    case 'li':
      return { minHeight: '24px' };
    case 'label':
      return { color: '#555555' };
    case 'form':
      return {
        width: '100%',
        minHeight: '80px',
        backgroundColor: '#f8fafc'
      };
    default:
      return { width: '100%', minHeight: '40px' };
  }
}


// 按元素类型给默认占位文案
export function defaultTextFor(type: ElementType): string | undefined {
  switch (type) {
    case 'h1': return '一级标题';
    case 'h2': return '二级标题';
    case 'h3': return '三级标题';
    case 'h4': return '四级标题';
    case 'p': return '这里是段落文字，可以双击编辑。';
    case 'button': return '按钮';
    case 'a': return '链接文字';
    case 'label': return '标签';
    case 'span': return '行内文字';
    case 'li': return '列表项';
    case 'th': return '表头';
    case 'td': return '单元格';
    case 'caption': return '表格标题';
    case 'img': return undefined;
    case 'hr': return undefined;
    case 'input': return undefined;
    case 'textarea': return undefined;
    case 'ul': return undefined;
    case 'ol': return undefined;
    case 'form': return undefined;
    // v0.4.5（用户反馈 C补12）：这些也都是"有内容才有意义"的元素。
    // 以前插入后是空的，在画布上是一个 0 尺寸的空盒子 —— 既看不见、也点不中，
    // 用户以为"插进去了但选不上"。统一给一段可立即编辑的默认文案。
    case 'h5': return '五级标题';
    case 'h6': return '六级标题';
    case 'strong': return '重点加粗';
    case 'em': return '斜体强调';
    case 'mark': return '高亮文字';
    case 'small': return '小字说明';
    case 'code': return 'code';
    case 'del': return '删除线';
    case 'sup': return '上标';
    case 'sub': return '下标';
    case 'blockquote': return '这里是一段引用内容。';
    case 'figcaption': return '图片说明文字';
    case 'pre': return '预格式化文本';
    default: return undefined;
  }
}
