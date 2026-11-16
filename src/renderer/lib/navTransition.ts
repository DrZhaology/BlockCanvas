// ============================================================================
// BlockCanvas · 页内「右进右出」转场（v0.4.7 第 47 批）
// ----------------------------------------------------------------------------
// 用户原话：
//   「设置页面进入时会多闪烁一次。而且我说的设置页面的动画，是点进的一个大设置项后，
//     右边相当于页面从右边划入，退出时从右边从左往右划出。你只貌似做了进入设置页面的
//     动画，不是设置页面内部的动画。」
//
// 为什么不用"给容器加一段 CSS animation"：
//   · 列表 → 详情：旧内容是**直接被卸载**的，没有机会播自己的退场（所以看起来只有"进"没有"出"）；
//   · 想给"退出"加动画就得让旧内容在 DOM 里多活 200ms 并且绝对定位叠在新内容上，
//     两套布局一叠就开始漏 padding / 滚动位置 / 焦点。
//   View Transitions 天生解决这个：浏览器自己给旧状态拍一张快照，退场动画作用在快照上，
//   真实 DOM 已经换成新的了。所以这里只做两件事：
//     ① 出发前给容器挂上 `view-transition-name`（这样快照只覆盖内容区，
//        底下那两条操作栏不参与 —— 用户要求「下方的工具栏不要死板的闪烁一下」）；
//     ② 在 <html> 上打 `data-vtset="fwd|back"`，让 CSS 决定四段动画往哪个方向播。
//
// 不做大而全：只服务"同一个页面内部的两级切换"（设置页列表 ⇄ 详情）。
// ============================================================================
import { canViewTransition, withViewTransition } from './viewTransition';

export type NavDir = 'fwd' | 'back';

/** 转场窗口：铺完 CSS 动画（最长 240ms）再多留一点，然后撤标记 */
const CLEANUP_MS = 460;

/**
 * 在「页内两级切换」的转场里执行状态变更。
 *
 * @param dir   'fwd' = 进下一级（新内容从右侧划入）；'back' = 退上一级（旧内容往右划出）
 * @param apply 真正的 setState
 * @param el    要参与转场的容器（默认取当前设置页根节点）
 */
export function withNavTransition(dir: NavDir, apply: () => void, el?: HTMLElement | null): void {
  const target = el ?? document.querySelector<HTMLElement>('.fluent-settings-page');
  // 不支持 / 开了"减少动态效果" / 找不到容器：直接切（不是错误，只是没有动画）
  if (!target || !canViewTransition()) {
    apply();
    return;
  }
  const html = document.documentElement;
  // ⚠ 必须**在** startViewTransition 之前挂名字：浏览器拍"旧状态"快照时就要认得它
  target.classList.add('bc-vt-nav');
  html.dataset.vtset = dir;
  withViewTransition(apply);
  window.setTimeout(() => {
    target.classList.remove('bc-vt-nav');
    delete html.dataset.vtset;
  }, CLEANUP_MS);
}

export default withNavTransition;
