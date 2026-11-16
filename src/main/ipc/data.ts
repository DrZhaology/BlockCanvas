// BlockCanvas · 数据目录与存储统计 IPC（data:*）
//
// 支撑「设置 → 存储与自动备份」那一页：看得见占用、清得掉垃圾。
// 全部是同步只读统计 + 明确的删除动作，没有后台任务。
//
// 一条必须保留的语义：clear 系列**只删可再生的东西**（缓存 / 预览 / 下载临时），
// 绝不碰工程文件与用户备份 —— 清理按钮不该有"点一下工程没了"的可能。
import { app, ipcMain } from 'electron';
import { join } from 'node:path';
import { dataRoot } from '../userData';
import {
  getStorageStats, getStorageBreakdown, clearStorageCategory, clearAllCleanable,
  clearOrphanBackups, enforceStorageBudgets
} from '../storage';
import { extRoot } from './extensions';

export function registerDataIpc(): void {
  ipcMain.handle('data:get-paths', () => ({
    dataRoot: dataRoot(),
    userDataDir: app.getPath('userData'),
    extDir: extRoot(),
    projectsDir: join(dataRoot(), 'projects'),
    backupsDir: join(dataRoot(), 'backups')
  }));

  ipcMain.handle('data:get-storage-stats', () => getStorageStats());
  // 分类占用明细（统计与清理共用同一份清单 → 不会再出现"显示的和清的不是一回事"）
  ipcMain.handle('data:get-storage-breakdown', () => getStorageBreakdown());
  ipcMain.handle('data:clear-category', (_e, id: string) => clearStorageCategory(id as never));
  ipcMain.handle('data:clear-all-cleanable', () => clearAllCleanable());
  // 兼容旧入口（一键清缓存 = 清"可清"的那几类）
  ipcMain.handle('data:clear-cache', () => clearAllCleanable());
  ipcMain.handle('data:clear-orphan-backups', () => clearOrphanBackups());
  // 预算兜底（探针可直接调，验证"下载目录 / 临时区有上限"）
  ipcMain.handle('data:enforce-budgets', () => enforceStorageBudgets());

}
