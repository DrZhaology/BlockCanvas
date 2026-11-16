// BlockCanvas · 容器「子元素样式」与子元素自身样式的冲突消解（v0.4.4d）
//
// 背景（这是模板元素"改了没反应"的根因）：
//   模板插入的元素（如 .cards-row 里的 .card-title）的样式是由**父容器的 childStyles**
//   生成的规则 `.cards-row .card-title { margin: … }` 提供的，而子元素自己的样式挂在
//   `.card-title { … }` 上。
//   CSS 特异性：`.cards-row .card-title`(0,2,0) > `.card-title`(0,1,0)
//   → **用户选中子元素改样式，写进去也不生效**（被容器规则盖住）。
//   这就是「模板元素选中后里面的样式都不能修改」的根因。
//
// 解决：当用户改动某元素的某几个 CSS 属性时，把同名的声明从**指向它的祖先 childStyles**
//   里剔除 —— 于是子元素自己的样式重新生效（改得动）。
//   只按"类名 token / 精确标签"匹配，且仅当子元素自身有类名时才处理，避免误伤。
//
// 为什么单独一个文件：这两段逻辑互相咬合（选择器匹配 + 键剔除），
// 而又都是**纯函数**（给定 root / target / keys 就出结果），可以脱离 zustand 单测。
import type { SceneElement } from '@lib/types';
import { cssTextToObject, styleToCssText } from '@lib/styleClass';

// ============================================================================
// 容器「子元素样式」（childStyles）与子元素自身样式的冲突消解（v0.4.4d）
// ----------------------------------------------------------------------------
// 背景：模板插入的元素（如 .cards-row 里的 .card-title）的样式是由**父容器的
//   childStyles** 生成的规则 `.cards-row .card-title { margin: ... }` 提供的，
//   而子元素自己的样式挂在 `.card-title { ... }` 上。
//   CSS 特异性：`.cards-row .card-title`(0,2,0) > `.card-title`(0,1,0) →
//   **用户选中子元素改样式，写进 .card-title 也不生效**（被容器规则盖住）。
//   这正是"模板元素选中后里面的样式都不能修改"的根因。
// 解决：当用户改动某元素的某几个 CSS 属性时，把同名的声明从**指向它的祖先
//   childStyles** 里剔除 —— 于是子元素自己的样式重新生效（改得动）。
//   只按"类名 token / 精确标签"匹配，且仅当子元素自身有类名时才处理，避免误伤。
// ============================================================================

/** 该 childStyles 选择器是否指向这个子节点（宽松匹配：类名 token 或精确标签） */
function childSelectorTargets(sel: string, node: SceneElement): boolean {
  const s = (sel ?? '').trim();
  if (!s) return false;
  const last = s.split(/[\s>+~]+/).filter(Boolean).pop() || '';
  if (!last) return false;
  const tokens = (node.attrs?.className ?? '').trim().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (last.includes('.' + t)) return true;
  }
  const tag = last.replace(/[.:#[].*$/, '').toLowerCase();
  return !!tag && tag === node.type;
}


/** 把 keys 这些 CSS 属性从"路径上所有祖先的、指向 target 的 childStyles"里删掉 */
function stripAncestorChildStyles(root: SceneElement, target: SceneElement, keys: string[]): void {
  if (!target.attrs?.className) return; // 无类名的元素走行内样式，天然盖过 childStyles，无需处理
  const walk = (n: SceneElement): boolean => {
    let contains = false;
    for (const c of n.children) {
      if (c === target) { contains = true; break; }
      if (walk(c)) { contains = true; break; }
    }
    // n 的子树里含 target → n 就是"祖先"，清掉它 childStyles 里命中 target 的同名声明
    if (contains && n.childStyles?.length) {
      for (const cs of n.childStyles) {
        if (!childSelectorTargets(cs.sel, target)) continue;
        const obj = cssTextToObject(cs.css);
        let changed = false;
        for (const k of keys) { if (k in obj) { delete obj[k]; changed = true; } }
        if (changed) cs.css = styleToCssText(obj);
      }
    }
    return contains;
  };
  walk(root);
}

export { childSelectorTargets, stripAncestorChildStyles };
