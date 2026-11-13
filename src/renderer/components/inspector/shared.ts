// BlockCanvas · 属性面板共享常量与小工具
//
// 这几样原来散在 Inspector.tsx 里（有的在文件顶部、有的夹在组件之间），
// 拆分后两边都要用，集中放这里。

/**
 * 「快捷助手属性是否显示到下方 CSS 列表」的全局开关 key。
 *
 * v0.4.4：改为**全局统一**（所有元素共用一份，不再按元素/选择器单独记忆），
 * 「设置 → 编辑器与画布」里是同一个开关，两边通过事件即时同步。
 */
export const HELPER_IN_CSS_KEY = 'bc-helper-in-css-global';

/** 属性行删除动画时长（ms）——与 CSS 里的 .prop-row 退场动画同值 */
export const PROP_REMOVE_MS = 340;

/** 播完退场动画再真正移除（元素可能不存在，静默跳过） */
export function animateRemove(el: Element | null, done: () => void): void {
  if (!el) { done(); return; }
  el.classList.add('is-removing');
  window.setTimeout(done, PROP_REMOVE_MS);
}
