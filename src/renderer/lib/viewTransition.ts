import { flushSync } from 'react-dom';

// BlockCanvas · 视图切换动画工具
//
// 用浏览器原生的 View Transitions API 实现「旧页面淡出 + 新页面淡入」：
//  · 不重挂载视图组件 → 不会丢状态、不会重复触发副作用；
//  · 旧帧由浏览器截图，退场动画是"真的"，不是靠蒙混；
//  · 不支持的宿主 / 系统开启了"减少动态效果"时，自动降级为直接切换。
//
// 使用要点：所有会引发"页面/页签整体替换"的 setState 都从这里走，
// 并且用 flushSync 让 React 的 DOM 变更同步落地，浏览器才能正确截取新帧。

type StartViewTransition = (cb: () => void) => { finished: Promise<unknown> };

function getDoc(): (Document & { startViewTransition?: StartViewTransition }) | null {
  try {
    return document as Document & { startViewTransition?: StartViewTransition };
  } catch {
    return null;
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 是否可用原生视图过渡 */
export function canViewTransition(): boolean {
  const doc = getDoc();
  return Boolean(doc && typeof doc.startViewTransition === 'function') && !prefersReducedMotion();
}

let running = false;

/**
 * 在「视图过渡」中执行状态变更。
 * 不支持或已在过渡中时，退化为普通同步执行（功能不受影响，只是没有动画）。
 */
export function withViewTransition(apply: () => void) {
  const doc = getDoc();
  if (!doc || typeof doc.startViewTransition !== 'function' || prefersReducedMotion() || running) {
    apply();
    return;
  }
  running = true;
  try {
    const t = doc.startViewTransition(() => {
      // flushSync：同步提交 React 更新，保证浏览器截图时 DOM 已是新状态
      flushSync(apply);
    });
    Promise.resolve(t.finished)
      .catch(() => { /* 过渡被取消属正常情况 */ })
      .finally(() => { running = false; });
  } catch {
    running = false;
    apply();
  }
}

export default withViewTransition;
