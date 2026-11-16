// BlockCanvas · 主进程 IPC 的公共上下文
//
// 拆 main.ts 之前，那些"几十个 handler 都要用"的东西（当前窗口、保存/打开对话框、
// 应用图标、加载进度、数据根）必须先有个统一出处 —— 否则每个 ipc/* 都要自己再写一遍，
// 拆了等于没拆。
//
// 约定：这里只放**无状态的取值**和**极薄的小工具**；
// 真正的业务逻辑仍然在各模块自己的文件里（ipc/project.ts、ipc/assets.ts …）。
import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'node:path';
import { dataRoot } from '../userData';

/** 当前主窗口（多窗口场景一律取第一个，与改造前一致） */
export function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

/** 对话框的父窗口：有主窗口就挂在它上面（模态居中），没有就独立弹 */
export function dialogParent(): BrowserWindow | undefined {
  const w = mainWindow();
  return w && !w.isDestroyed() ? w : undefined;
}

export function showSaveDialog(opts: Electron.SaveDialogOptions) {
  const parent = dialogParent();
  return parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts);
}

export function showOpenDialog(opts: Electron.OpenDialogOptions) {
  const parent = dialogParent();
  return parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts);
}

/** 应用图标（打包态取 resources/icon.png，开发态取 build/icon.png；都没有就返回 null） */
export function appIconPath(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'icon.png'),
    join(app.getAppPath(), 'build', 'icon.png'),
    join(app.getAppPath(), 'resources', 'icon.png')
  ];
  for (const p of candidates) {
    try {
      // 用同步检查避免引入 fs 的额外依赖面（这里只在建窗时调一次）
      if (require('node:fs').existsSync(p)) return p;
    } catch { /* 忽略 */ }
  }
  return null;
}

/** 加载页进度（渲染层的 LoadingScreen 订阅它） */
export function emitLoad(id: string, label: string, percent: number): void {
  const w = mainWindow();
  if (w && !w.isDestroyed()) {
    w.webContents.send('app:load-progress', { id, label, percent });
  }
}

/** 数据根目录（= 便携 data/），给需要拼路径的模块用 */
export function dataDir(): string {
  return dataRoot();
}

/** 把"用户选的路径"统一成可写进工程的 web 路径（正斜杠） */
export function toWeb(p: string): string {
  return String(p).replace(/\\/g, '/');
}
