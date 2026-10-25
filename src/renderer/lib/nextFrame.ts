// BlockCanvas · 「下一帧」的可靠版（v0.4.5 第 12 批）
//
// 为什么需要它：`requestAnimationFrame` 在**窗口最小化 / 页面被判定为隐藏**时会被 Chromium
// 暂停（即使设了 `backgroundThrottling: false`，隐藏页面的 rAF 也会被掐）。
//
// 我们有几处关键流程是"等下一帧再做"：
//   · 加载页淡出（等主界面画出第一帧）
//   · 切标签时解除 isSwitchingTab 标记
//   · 面板展开动画
// 一旦窗口被最小化，这些 rAF 永远不触发 → 加载页永远挡在最上层、切标签状态卡住。
// 真实用户也会遇到（最小化着等工程打开）。
//
// 所以统一用 `nextFrame()`：优先 rAF，同时挂一个 ~32ms 的定时器兜底，谁先来用谁。
// 语义与 rAF 一致（"尽快，但不早于当前任务"），只是**保证一定会执行**。

export function nextFrame(fn: () => void): () => void {
  let done = false;
  let raf = 0;
  let timer = 0;
  const run = () => {
    if (done) return;
    done = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    try { fn(); } catch { /* 单个回调出错不影响别人 */ }
  };
  try { raf = requestAnimationFrame(run); } catch { /* 环境不支持 rAF，只靠定时器 */ }
  timer = window.setTimeout(run, 32);
  return () => {
    if (done) return;
    done = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
  };
}

/** 连等两帧（用于"等新内容真的画出来"）——同样带定时器兜底 */
export function nextFrames(fn: () => void): () => void {
  let cancel2: (() => void) | null = null;
  const c1 = nextFrame(() => { cancel2 = nextFrame(fn); });
  return () => { c1(); cancel2?.(); };
}