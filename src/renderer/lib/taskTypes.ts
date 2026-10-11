// BlockCanvas · 后台任务的类型定义（主进程 tasks.ts 与渲染层共用的一份描述）
// 主进程是唯一"真相来源"，渲染层只负责展示与下发操作（暂停/继续/取消）。

export type TaskKind = 'download' | 'update';

export type TaskStatus =
  | 'running'      // 正在跑（下载中）
  | 'paused'       // 用户点了「停止」——分片保留，可继续
  | 'interrupted'  // 上次没跑完就退出了 —— 分片保留，可继续
  | 'applying'     // （更新）下载完成，正在解压 / 替换 / 重启
  | 'done'
  | 'error'
  | 'canceled';

export interface BgTask {
  id: string;
  kind: TaskKind;
  title: string;
  detail: string;
  url: string;
  fileName: string;
  dest: string;
  status: TaskStatus;
  received: number;
  total: number;
  pct: number;
  mirror?: string;
  error?: string;
  tag?: string;
  version?: string;
  createdAt: string;
  updatedAt: string;
}

/** 还在进行中（需要显示进度）的状态 */
export const ACTIVE_STATUS: TaskStatus[] = ['running', 'applying'];
/** 可以点「继续」的状态 */
export const RESUMABLE_STATUS: TaskStatus[] = ['paused', 'interrupted', 'error'];

export function isActive(t: BgTask): boolean {
  return ACTIVE_STATUS.includes(t.status);
}

export function fmtMB(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  running: '进行中',
  paused: '已暂停',
  interrupted: '已中断',
  applying: '正在应用',
  done: '已完成',
  error: '失败',
  canceled: '已取消'
};
