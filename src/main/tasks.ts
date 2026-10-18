import { app, shell, BrowserWindow } from 'electron';
import { join, dirname } from 'node:path';
import {
  existsSync, mkdirSync, statSync, rmSync, createWriteStream,
  writeFileSync, readFileSync, openSync, readSync, closeSync
} from 'node:fs';
import { dataRoot } from './userData';
import { DOWNLOAD_ORDER, mirrorById, finishUpdateFromZip, type MirrorDef } from './updater';

// ============================================================================
// BlockCanvas · 后台任务中枢（v0.4.4）
// ----------------------------------------------------------------------------
// 为什么要有这一层：
//   以前「下载 zip」的进度存在**渲染层组件里**（UpdateCenter 的 useState），于是
//     · 一离开更新页 / 一重启软件，进度与"已下载"就没了（用户反馈的原话）；
//     · 下载中不能暂停、不能继续、也没法在别处看到它在跑。
//   现在把「下载 / 更新」都变成**主进程里的任务**，渲染层只是订阅者：
//     · 任务状态写进 `data/tasks.json` → 重启后仍能看到「已完成」与「已中断（可继续）」；
//     · 进度走 `task:changed` 广播 → 工具栏「任务」按钮、更新中心页面同时看得到；
//     · 暂停保留已下载的分片文件，继续时用 HTTP Range 续传，不重头再来。
//
// 三条设计原则：
//   1. **状态只有一份**（主进程内存 + tasks.json），渲染层不允许自己记账；
//   2. **进度广播要节流**（200ms 一次），否则几十 MB 的包会把 IPC 打满、界面反而卡；
//   3. **任务记录有上限**（保留最近 40 条），别让 tasks.json 无限膨胀。
// ============================================================================

export type TaskKind = 'download' | 'update';
export type TaskStatus =
  | 'running'      // 正在跑
  | 'paused'       // 用户点「停止」——分片文件保留，可继续
  | 'interrupted'  // 上次没跑完就退出了 —— 分片文件保留，可继续
  | 'applying'     // （更新专属）下载完成，正在解压 / 替换 / 重启
  | 'done'
  | 'error'
  | 'canceled';

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  /** 人话标题，例如「下载 v0.4.2 的 zip」/「更新到 v0.4.4」 */
  title: string;
  /** 当前阶段说明（随进度刷新，例如「正在通过 gh-proxy 镜像下载… 12.3 / 48.0 MB」） */
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
  /** 关联的发行版 tag（更新中心据此判断"这个版本已经下过了"） */
  tag?: string;
  /** 要更新到的版本号（更新任务用：替换完成后拿它给程序文件夹改名） */
  version?: string;
  createdAt: string;
  updatedAt: string;
}

const MAX_TASKS = 40;
const BROADCAST_MS = 200;

/** 能被「继续」的状态 */
export const RESUMABLE: TaskStatus[] = ['paused', 'interrupted', 'error'];

// ============ 持久化 ============

let tasks: TaskRecord[] = [];
let loaded = false;

function tasksPath(): string {
  return join(dataRoot(), 'tasks.json');
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(readFileSync(tasksPath(), 'utf-8'));
    if (Array.isArray(raw)) {
      tasks = raw.filter((t: any) => t && typeof t.id === 'string') as TaskRecord[];
      // 上次退出时还在跑的任务 → 标记为"已中断"，分片文件仍在，用户可以点继续
      for (const t of tasks) {
        if (t.status === 'running' || t.status === 'applying') {
          t.status = 'interrupted';
          t.detail = t.kind === 'update'
            ? '更新被中断（程序已退出），可以重新发起'
            : '上次没下完就退出了 —— 点「继续」可以从断点接着下';
          t.updatedAt = new Date().toISOString();
        }
      }
    }
  } catch { /* 首次运行 / 文件损坏 → 空列表 */ }
}

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dataRoot(), { recursive: true });
      writeFileSync(tasksPath(), JSON.stringify(tasks), 'utf-8');
    } catch { /* 磁盘满 / 只读 → 忽略，不影响本次会话 */ }
  }, 400);
}

// ============ 广播 ============

function broadcast(): void {
  const payload = listTasks();
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('task:changed', payload); } catch { /* 窗口在关 */ }
  }
}

let lastBroadcast = 0;
let pendingBroadcast: NodeJS.Timeout | null = null;
/** 节流广播：高频进度最多 200ms 一次（完成/失败等关键状态用 broadcastNow） */
function broadcastThrottled(): void {
  const now = Date.now();
  if (now - lastBroadcast >= BROADCAST_MS) {
    lastBroadcast = now;
    broadcast();
    return;
  }
  if (pendingBroadcast) return;
  pendingBroadcast = setTimeout(() => {
    pendingBroadcast = null;
    lastBroadcast = Date.now();
    broadcast();
  }, BROADCAST_MS - (now - lastBroadcast));
}
function broadcastNow(): void {
  if (pendingBroadcast) { clearTimeout(pendingBroadcast); pendingBroadcast = null; }
  lastBroadcast = Date.now();
  broadcast();
}

// ============ 查询 ============

export function listTasks(): TaskRecord[] {
  load();
  // 新的在前（界面从上往下就是"最近发生的事"）
  return [...tasks].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getTask(id: string): TaskRecord | undefined {
  load();
  return tasks.find((t) => t.id === id);
}

function trim(): void {
  if (tasks.length <= MAX_TASKS) return;
  // 正在跑的 / 未完成的永不清除；其余按时间从旧到新淘汰
  const active = tasks.filter((t) => t.status === 'running' || t.status === 'applying' || RESUMABLE.includes(t.status));
  const rest = tasks
    .filter((t) => !active.includes(t))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  tasks = [...active, ...rest.slice(0, Math.max(0, MAX_TASKS - active.length))];
}

function touch(t: TaskRecord): void {
  t.updatedAt = new Date().toISOString();
  trim();
  scheduleSave();
}

// ============ 运行中的句柄 ============

interface Running {
  ctrl: AbortController;
  /** 用户点了「停止」→ true；区分"主动暂停"和"出错" */
  pausing: boolean;
}
const running = new Map<string, Running>();

// ============ 工具函数 ============

function newId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function safeName(name: string): string {
  return (name || 'BlockCanvas-asset.zip').replace(/[\\/:*?"<>|]/g, '_');
}

/** 收到的文件是不是 zip（"PK" 头）—— 防镜像把 HTML 错误页当成包塞回来 */
function isZipFile(path: string): boolean {
  try {
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(2);
    readSync(fd, buf, 0, 2, 0);
    closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4b;
  } catch {
    return false;
  }
}

/** 暂停 / 中断 / 出错的任务，磁盘上那半截文件还在吗（在 → 可以续传） */
export function partialSize(t: TaskRecord): number {
  try {
    if (!existsSync(t.dest)) return 0;
    const s = statSync(t.dest);
    if (!s.isFile()) return 0;
    // 已经下完的完整包：total 已知且吻合 → 视为"没有可续传的分片"，而是"已下载完"
    return s.size;
  } catch {
    return 0;
  }
}

// ============ 下载（可暂停 / 可续传） ============

/**
 * 真正的下载循环：多镜像回退 + Range 续传 + 可中断。
 * @param from 已经下载好的字节数（>0 时用 Range 续传）
 */
async function runDownload(t: TaskRecord, ctrl: AbortController, from: number): Promise<{ ok: boolean; mirror?: string; error?: string; aborted?: boolean }> {
  const errors: string[] = [];
  let start = from;

  for (const id of DOWNLOAD_ORDER) {
    const m: MirrorDef = mirrorById(id);
    const target = m.prefix ? m.prefix + t.url : t.url;
    t.mirror = m.name;
    t.detail = start > 0
      ? `正在通过 ${m.name} 续传（已 ${(start / 1048576).toFixed(1)} MB）…`
      : `正在通过 ${m.name} 下载…`;
    broadcastThrottled();

    try {
      const headers: Record<string, string> = { Accept: 'application/octet-stream' };
      if (start > 0) headers['Range'] = `bytes=${start}-`;
      const res = await fetch(target, { headers, signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      // 服务器不认 Range（200 而不是 206）→ 从头来，避免把两份内容拼在一起
      let appended = start;
      if (start > 0 && res.status !== 206) {
        appended = 0;
        start = 0;
        rmSync(t.dest, { force: true });
      }

      const len = Number(res.headers.get('content-length') || 0);
      const total = appended + len;
      if (total > 0) t.total = total;
      t.received = appended;

      const ws = createWriteStream(t.dest, appended > 0 ? { flags: 'a' } : { flags: 'w' });
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          t.received += value.length;
          if (!ws.write(Buffer.from(value))) {
            // 背压：等 drain，避免大包把内存顶满
            await new Promise<void>((r) => ws.once('drain', () => r()));
          }
          if (t.total > 0) {
            t.pct = Math.min(99, Math.floor((t.received / t.total) * 100));
            t.detail = `正在通过 ${m.name} 下载… ${(t.received / 1048576).toFixed(1)} / ${(t.total / 1048576).toFixed(1)} MB`;
          }
          broadcastThrottled();
        }
      } finally {
        await new Promise<void>((resolve) => ws.end(() => resolve()));
      }

      if (t.received < 1024 || !isZipFile(t.dest)) {
        throw new Error('下载内容不是有效的 zip（可能被镜像劫持或中断）');
      }
      t.pct = 100;
      t.total = t.received;
      return { ok: true, mirror: m.name };
    } catch (e: any) {
      if (ctrl.signal.aborted) return { ok: false, aborted: true };
      errors.push(`${m.name}：${e?.message || '失败'}`);
      // 换镜像重来时**保留**已下载的分片（下一个镜像同样支持 Range 就继续，
      // 不支持的话上面那段会自动清空重下）
      start = partialSize(t);
      broadcastThrottled();
    }
  }
  return { ok: false, error: errors.join('；') || '全部镜像均下载失败' };
}

// ============ 任务的对外操作 ============

export interface StartTaskInput {
  kind: TaskKind;
  url: string;
  fileName: string;
  title?: string;
  tag?: string;
  version?: string;
  /** 覆盖落盘目录（更新任务用安装目录下的 .update/） */
  destDir?: string;
}

/** 新建一个下载任务并立即开始（同一 URL 已在跑 → 直接返回那一条，不重复建） */
export function startTask(input: StartTaskInput): TaskRecord {
  load();
  const dup = tasks.find((t) => t.url === input.url && (t.status === 'running' || t.status === 'paused'));
  if (dup) { void resumeTask(dup.id); return dup; }

  const destDir = input.destDir ?? join(dataRoot(), 'downloads');
  mkdirSync(destDir, { recursive: true });
  const fileName = safeName(input.fileName);
  const now = new Date().toISOString();
  const t: TaskRecord = {
    id: newId(),
    kind: input.kind,
    title: input.title || (input.kind === 'update' ? '更新 BlockCanvas' : `下载 ${fileName}`),
    detail: '正在准备下载…',
    url: input.url,
    fileName,
    dest: join(destDir, fileName),
    status: 'running',
    received: 0,
    total: 0,
    pct: 0,
    tag: input.tag,
    version: input.version,
    createdAt: now,
    updatedAt: now
  };
  tasks.push(t);
  broadcastNow();
  void drive(t.id, 0);
  return t;
}

/** 跑一个任务（内部）。from = 续传起点 */
async function drive(id: string, from: number): Promise<void> {
  const t = getTask(id);
  if (!t) return;
  if (running.has(id)) return;

  const ctrl = new AbortController();
  const handle: Running = { ctrl, pausing: false };
  running.set(id, handle);
  t.status = 'running';
  t.error = undefined;
  if (t.kind === 'update') t.detail = '开始下载更新包…';
  touch(t);
  broadcastNow();

  const res = await runDownload(t, ctrl, from);
  running.delete(id);

  if (res.ok) {
    if (t.kind === 'download') {
      t.status = 'done';
      t.detail = `已下载到 ${t.dest}`;
      t.pct = 100;
      touch(t);
      broadcastNow();
      return;
    }
    // 更新任务：下载完 → 进入解压 / 替换阶段（这一步不能取消，锁编辑器）
    t.status = 'applying';
    t.detail = '下载完成，正在解压并替换程序…';
    touch(t);
    broadcastNow();
    const up = await finishUpdateFromZip(t.dest, t.version || '', (msg, pct) => {
      t.detail = msg;
      if (typeof pct === 'number') t.pct = Math.max(t.pct, pct);
      touch(t);
      broadcastThrottled();
    });
    if (up.ok) {
      t.status = 'done';
      t.detail = '更新完成，程序正在重启…';
      touch(t);
      broadcastNow();
      // 替换脚本已就位 —— 主进程退出交锁（与旧流程一致）
      setTimeout(() => app.exit(0), 400);
    } else {
      t.status = 'error';
      t.error = up.error;
      t.detail = `更新失败：${up.error}`;
      touch(t);
      broadcastNow();
    }
    return;
  }

  if (res.aborted) {
    if (handle.pausing) {
      t.status = t.received > 0 ? 'paused' : 'canceled';
      t.detail = t.received > 0
        ? `已暂停（已下载 ${(t.received / 1048576).toFixed(1)} MB）—— 点「继续」可接着下`
        : '已取消';
    } else {
      t.status = 'canceled';
      t.detail = '已取消';
    }
    touch(t);
    broadcastNow();
    return;
  }

  t.status = 'error';
  t.error = res.error;
  t.detail = `下载失败：${res.error}`;
  touch(t);
  broadcastNow();
}

/** 「停止」：中断但保留分片（可继续） */
export function pauseTask(id: string): TaskRecord | undefined {
  const t = getTask(id);
  if (!t) return undefined;
  const h = running.get(id);
  if (h) { h.pausing = true; h.ctrl.abort(); return t; }
  if (t.status === 'running') { t.status = 'paused'; touch(t); broadcastNow(); }
  return t;
}

/** 「继续」：从已下载的字节数续传（服务器不支持 Range 时自动重下） */
export function resumeTask(id: string): TaskRecord | undefined {
  const t = getTask(id);
  if (!t) return undefined;
  if (t.status === 'running' || t.status === 'applying') return t;
  const from = partialSize(t);
  // 分片已经和整包一样大 → 说明文件其实是完整的，直接进完成态
  if (from > 0 && from >= t.total && t.total > 0 && isZipFile(t.dest)) {
    t.received = from;
    t.pct = 100;
    if (t.kind === 'download') {
      t.status = 'done';
      t.detail = `已下载到 ${t.dest}`;
      touch(t);
      broadcastNow();
      return t;
    }
  }
  void drive(id, from);
  return t;
}

/** 「取消」：中断并删掉分片文件，记录也一并移除 */
export function cancelTask(id: string): void {
  const t = getTask(id);
  if (!t) return;
  const h = running.get(id);
  if (h) h.ctrl.abort();
  running.delete(id);
  try { rmSync(t.dest, { force: true }); } catch { /* 忽略 */ }
  tasks = tasks.filter((x) => x.id !== id);
  scheduleSave();
  broadcastNow();
}

/** 从列表里移除一条记录（不动磁盘文件） */
export function dismissTask(id: string): void {
  tasks = tasks.filter((x) => x.id !== id);
  scheduleSave();
  broadcastNow();
}

/** 在文件管理器里定位到这个任务下好的文件 */
export async function revealTask(id: string): Promise<string> {
  const t = getTask(id);
  if (!t) return '找不到这条任务';
  if (existsSync(t.dest)) {
    shell.showItemInFolder(t.dest);
    return '';
  }
  const dir = dirname(t.dest);
  if (existsSync(dir)) return await shell.openPath(dir);
  return '文件与目录都不存在（可能已被移动或删除）';
}

/** 程序退出前调用：正在跑的任务标记为"已中断"，并立刻把 tasks.json 落盘 */
export function flushTasksOnQuit(): void {
  load();
  for (const t of tasks) {
    if (t.status === 'running' || t.status === 'applying') {
      t.status = 'interrupted';
      t.detail = '程序退出，任务已中断（点「继续」可接着下）';
      t.updatedAt = new Date().toISOString();
    }
  }
  try {
    mkdirSync(dataRoot(), { recursive: true });
    writeFileSync(tasksPath(), JSON.stringify(tasks), 'utf-8');
  } catch { /* 忽略 */ }
}

/** 某张表/某个 tag 是否已经下载过（更新中心用来显示「已下载」） */
export function findDownloadedByTag(tag: string): TaskRecord | undefined {
  load();
  return tasks.find((t) => t.kind === 'download' && t.tag === tag && (t.status === 'done' || t.status === 'applying'));
}
