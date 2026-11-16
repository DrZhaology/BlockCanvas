// BlockCanvas · 「同类名元素同步样式」（R6-5）
//
// 语义：**编辑即统一** —— 改了某个元素，同 className 的其它元素一起变。
// 这是"类 = 一种样子"的自然推论，也是用户最依赖的行为之一。
//
// 三条踩过的边界（都写进代码注释里了）：
//   · 只同步**样式**，不同步文本/属性（同名的两张卡片文案可以不同）；
//   · 相对/绝对定位的偏移**不跟着同步**（否则复制出来的卡片会叠在同一个位置）；
//   · 表格的 inner 结构不同步（表格有自己的 per-cell 规则，见 tableOps）。
import type { SceneElement } from '@lib/types';
import { deepClone, findParent } from './tree';


// 「编辑即统一」：node 有类名(classString)或关系选择器(relSelector)时，
// 把整棵树上所有同类名或同关系选择器的元素样式全量覆盖为 node 当前样式 —— 一改全改。
// 无类名且无关系选择器的元素（或 root）不触发联动。
/**
 * 「编辑即统一」：把改好的样式同步给"同一个名字"的元素。
 *
 * · 同名**类名**：全文档同步（类 = 一种样子，用户明确的可复用单元）。
 * · 同**关系选择器**：只在**同一个父容器下的兄弟**之间同步。
 *
 * ⚠ 为什么关系选择器要限定"同父"（v0.4.4 修）：
 *   关系选择器是"结构定位"（`.data-table > tbody > tr:nth-child(2) > td:nth-child(1)`），
 *   它长得一样**不代表是同一个元素** —— 文档里两张表都叫 `data-table` 时，
 *   两张表的同位置格子会拿到完全相同的选择器字符串。旧实现按字符串全文同步，
 *   于是"改表 A 的一格，表 B 的同一格跟着变"（用户报的"改第二行，第一行也被带动"）。
 *   而真正需要"组同步"的场景（给容器内同类子元素统一设置选择器）本来就是同父兄弟，
 *   所以限定同父既修掉误伤、又完整保留原本的组语义。
 */
export function syncClassmates(root: SceneElement, node: SceneElement): void {
  const cls = (node.attrs?.className ?? '').trim();
  const rel = (node.attrs?.relSelector ?? '').trim();
  if ((!cls && !rel) || node === root) return;
  const nodeParent = findParent(root, node.id);
  const targetStyle = deepClone(node.style);
  const targetVisible = node.visibleProps ? deepClone(node.visibleProps) : undefined;
  const targetPseudo = node.pseudoStyles ? deepClone(node.pseudoStyles) : undefined;
  const targetResponsive = node.responsive ? deepClone(node.responsive) : undefined;
  const copyTo = (n: SceneElement) => {
    n.style = deepClone(targetStyle);
    n.visibleProps = targetVisible ? deepClone(targetVisible) : undefined;
    n.pseudoStyles = targetPseudo ? deepClone(targetPseudo) : undefined;
    n.responsive = targetResponsive ? deepClone(targetResponsive) : undefined;
  };
  const walk = (n: SceneElement, parent: SceneElement | null): void => {
    if (n !== node) {
      if (cls && (n.attrs?.className ?? '').trim() === cls) {
        copyTo(n);
      } else if (rel && parent === nodeParent && (n.attrs?.relSelector ?? '').trim() === rel) {
        copyTo(n);
      }
    }
    for (const c of n.children) walk(c, n);
  };
  walk(root, null);
}