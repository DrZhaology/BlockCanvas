// 启动后确保进入编辑器。
//
// v0.4.5 起应用**启动时不再预置「未命名项目 1」**：没有标签就直接进首页
// （类似浏览器新标签页）。探针/截图脚本需要编辑器 UI，所以先等首屏渲染出来，
// 看到首页就点「新建项目」把标签建出来。
export async function ensureEditor(win) {
  // 首帧可能还没挂载 React：先等「首页」或「编辑器」任意一个出现
  await win.waitForSelector('.empty-home, .toolbar', { timeout: 20000 }).catch(() => {});
  const home = await win.locator('.empty-home').count().catch(() => 0);
  if (home === 0) return;
  // 首页三个快捷按钮：打开工程 / 新建项目 / 全部项目
  await win.locator('.empty-home .eh-btn').nth(1).click();
  await win.waitForSelector('.toolbar', { timeout: 15000 });
}
