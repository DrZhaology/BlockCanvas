// BlockCanvas · 更新与任务 IPC（update:* / task:* / app:get-stage）
//
// 两件事放一个文件，因为它们本来就是一对：
//   · 更新要下载 110MB 的包 —— 那是**任务**，进度要能在工具栏「任务」里看到；
//   · 任务面板要能暂停 / 恢复 / 取消 / 定位到下载文件。
// 拆开会让"更新进度"与"任务进度"两套状态又分家（v0.4.4 踩过一次：同一条 IPC 上的
// 轻量进度污染了全局 busy，点一下"下载 zip"就弹全屏遮罩并卡死在最后一帧）。
//
// 一条必须保留的语义：**下载 ≠ 安装**。update:download-asset 只落盘，
// 不替换程序文件；真正的替换在 update:apply。用户下载完随时可以放弃，不该有副作用。
import { app, ipcMain } from 'electron';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  getLocalVersion, getAppStage, fetchReleases, buildUpdateList, getMirrorInfo,
  resolveInstallDir, updateLogPath, ulog
} from '../updater';
import {
  listTasks, startTask, pauseTask, resumeTask, cancelTask, dismissTask, revealTask
} from '../tasks';

export function registerUpdateIpc(): void {
  ipcMain.handle('update:get-version', () => getLocalVersion());

  // v0.4.5：更新日志路径（界面可以给一个"打开日志"入口）
  ipcMain.handle('update:log-path', () => {
    try {
      ulog(`查询日志路径（当前版本 ${getLocalVersion()}）`);
      return updateLogPath();
    } catch {
      return '';
    }
  });

  ipcMain.handle('update:log-tail', (_evt, maxLines = 200) => {
    try {
      const p = updateLogPath();
      if (!existsSync(p)) return '';
      const lines = readFileSync(p, 'utf8').split(/\r?\n/);
      return lines.slice(Math.max(0, lines.length - Math.max(1, Number(maxLines) || 200))).join('\n');
    } catch {
      return '';
    }
  });

  ipcMain.handle('app:get-stage', () => getAppStage());

  ipcMain.handle('update:check', async () => {
    const localVer = getLocalVersion();
    // per_page=100：够覆盖"当前版本 + 往前 5 个 + 往后的全部版本"
    const fetched = await fetchReleases(100);
    if (!fetched) {
      return {
        ok: false,
        isDev: !app.isPackaged,
        localVersion: localVer,
        platform: process.platform,
        mirrors: getMirrorInfo(),
        error: '三个来源都连不上（NexaCode 镜像 / gh-proxy 镜像 / GitHub 直连）。请检查网络，并关闭 Watt Toolkit / Clash 等后台代理后重试。'
      };
    }
    const built = buildUpdateList(localVer, fetched.list, fetched.source);
    return {
      ok: true,
      isDev: !app.isPackaged,
      platform: process.platform,
      mirrors: getMirrorInfo(),
      ...built
    };
  });

  ipcMain.handle('update:apply', async (_evt, assetUrl: string, fileName: string, version: string, tag: string) => {
    if (!assetUrl) return { ok: false, error: '未找到下载地址' };
    if (!app.isPackaged) {
      return { ok: false, error: '当前处于源码开发模式（pnpm dev），没有可替换的安装目录。自动更新仅对打包后的便携版生效。' };
    }
    // v0.4.4：更新也是一个「后台任务」（可暂停/续传/取消，进度在工具栏「任务」按钮里也看得到）。
    // 下载包就放在安装目录的 .update/ 下，替换脚本用完会连目录一起删掉。
    const t = startTask({
      kind: 'update',
      url: assetUrl,
      fileName: fileName || 'update.zip',
      title: `更新到 v${version || ''}`.trim(),
      tag,
      version,
      destDir: join(resolveInstallDir(), '.update')
    });
    return { ok: true, taskId: t.id };
  });

  ipcMain.handle('update:download-asset', async (_evt, assetUrl: string, fileName: string, tag?: string, title?: string) => {
    if (!assetUrl) return { ok: false, error: '缺少下载地址' };
    const t = startTask({ kind: 'download', url: assetUrl, fileName, tag, title });
    return { ok: true, taskId: t.id, path: t.dest };
  });

  ipcMain.handle('task:list', () => listTasks());
  ipcMain.handle('task:pause', (_evt, id: string) => { pauseTask(id); return listTasks(); });
  ipcMain.handle('task:resume', (_evt, id: string) => { resumeTask(id); return listTasks(); });
  ipcMain.handle('task:cancel', (_evt, id: string) => { cancelTask(id); return listTasks(); });
  ipcMain.handle('task:dismiss', (_evt, id: string) => { dismissTask(id); return listTasks(); });
  ipcMain.handle('task:reveal', async (_evt, id: string) => {
    const err = await revealTask(id);
    return { ok: !err, error: err || undefined };
  });

}
