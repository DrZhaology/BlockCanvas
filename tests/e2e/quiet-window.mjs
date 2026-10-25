// ============================================================================
// BlockCanvas · 测试窗口"安静启动"（v0.4.5 第 12 批）
// ----------------------------------------------------------------------------
// 用户反馈：「我在干别的事情的时候总会弹出 BlockCanvas 的窗口，很烦……
//            要么默认折叠只留任务栏图标（但不知道会不会影响截图），
//            要么新开的窗口不要是整个桌面的『焦点』。可以给所有的脚本都做一下。」
//
// 结论：**不折叠**（折叠/最小化会让 Chromium 把渲染节流，截图容易拿到空白帧），
// 改用「显示但不激活」：
//   · 主进程侧：`BC_NO_FOCUS=1` 时窗口 `show:false` 创建，`ready-to-show` 后 `showInactive()`。
//     `showInactive()` 是系统级"显示但不抢前台焦点"，窗口照常渲染、照常能截图、任务栏有图标。
//   · 脚本侧：本文件再兜一层（万一某些路径的窗口还是拿到了焦点），并统一提供 env。
//
// 用法（所有探针/截图脚本都走这两个）：
//   import { QUIET_ENV, quietWindow } from './quiet-window.mjs';
//   const env = { ...process.env, BC_DATA_DIR: DATA_DIR, ...QUIET_ENV };
//   const app = await electron.launch({ ..., env });
//   const win = await app.firstWindow();
//   await quietWindow(app);
// ============================================================================

/** 加进 electron.launch 的 env：让主进程用 showInactive 显示窗口 */
export const QUIET_ENV = { BC_NO_FOCUS: '1' };

/**
 * 兜底：把已经出现的窗口"去焦点"。
 *
 * ⚠ 只做 blur，不做 minimize/hide —— 最小化会让 Chromium 认为页面不可见，
 *   rAF 与动画被节流、`page.screenshot()` 可能拿到空白帧，探针会莫名其妙变红。
 *   也不动 `focusable`（设成 false 在 Windows 上会连任务栏激活都失去，反而更怪）。
 */
export async function quietWindow(app) {
  try {
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isDestroyed()) continue;
        try { w.blur(); } catch { /* 忽略 */ }
        try { w.setAlwaysOnTop(false); } catch { /* 忽略 */ }
      }
    });
  } catch { /* 拿不到窗口就忽略，不影响测试 */ }
}

/** 常用组合：给 `electron.launch` 的 env 加上安静启动开关 */
export function quietEnv(base, extra = {}) {
  return { ...base, ...QUIET_ENV, ...extra };
}