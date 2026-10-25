// 启动后确保进入编辑器。
//
// v0.4.5 起应用**启动时不再预置「未命名项目 1」**：没有标签就直接进首页
// （类似浏览器新标签页）。探针/截图脚本需要编辑器 UI，所以先等首屏渲染出来，
// 看到首页就点「新建项目」把标签建出来。

/**
 * v0.4.5：等启动加载页彻底消失。
 *
 * 加载页盖在最上层（z-index 最高档）、最短显示 520ms + 淡出 300ms，
 * 期间它会拦住所有点击 —— 探针如果"看到首页就开始点"，就会随机超时
 * （实测就是这样：单跑能过、串跑偶发 `locator.fill: Timeout`）。
 * 所以所有需要交互的探针都应该先过这一关。
 */
export async function waitSplashGone(win, timeout = 15000) {
  await win.waitForSelector('.bc-loading', { state: 'detached', timeout }).catch(() => {});
}

export async function ensureEditor(win) {
  // 首帧可能还没挂载 React：先等「首页」或「编辑器」任意一个出现
  await win.waitForSelector('.empty-home, .toolbar', { timeout: 20000 }).catch(() => {});
  // 再等加载页退场，否则后面的点击会被它拦掉
  await waitSplashGone(win);
  const home = await win.locator('.empty-home').count().catch(() => 0);
  if (home === 0) return;
  // 首页三个快捷按钮：打开工程 / 新建项目 / 全部项目
  await win.locator('.empty-home .eh-btn').nth(1).click();
  await win.waitForSelector('.toolbar', { timeout: 15000 });
  await waitSplashGone(win);
}