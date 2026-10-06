import { app } from 'electron';
import { join, dirname } from 'node:path';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, rmSync, copyFileSync
} from 'node:fs';

// BlockCanvas · 纯便携数据区与项目备份中枢 (data/)
// 目录结构（绿色便携版，全部在 data/ 下）：
//   data/
//   ├── user-data/       (Chromium 隔离区)
//   ├── config.json      (全局偏好设置)
//   ├── session.json     (Notepad 式会话记忆与未保存草稿，退出秒级原地自愈)
//   ├── projects/        (.bcproj 本地项目文件)
//   ├── backups/         (按项目隔离的专属备份与快照目录)
//   │   ├── _general/    (未命名或全局自动草稿)
//   │   └── <项目名>/    (该项目专属的时间戳快照与历史)
//   └── extensions/      (运行时插件/资源包：用户第三方扩展存储位置)
//   注意：所有扩展（内置种子 + 用户安装）均统一在 data/extensions/，exe 旁不再保留扩展目录。

export function dataRoot(): string {
  // 测试隔离：E2E / CI 可通过 BC_DATA_DIR 指向临时目录，绝不污染用户的真实 data/。
  // 仅在显式设置该环境变量时生效，正常使用（双击 exe / pnpm dev）完全不受影响。
  const override = process.env['BC_DATA_DIR'];
  if (override && override.trim()) return override.trim();
  const base = app.isPackaged
    ? (process.env['PORTABLE_EXECUTABLE_DIR'] || dirname(process.execPath))
    : app.getAppPath();
  return join(base, 'data');
}

export function initDataDirectories(): { dataDir: string; extDir: string; projectsDir: string; backupsDir: string } {
  const dRoot = dataRoot();
  const userDataDir = join(dRoot, 'user-data');
  const extDir = join(dRoot, 'extensions');
  const projectsDir = join(dRoot, 'projects');
  const backupsDir = join(dRoot, 'backups');

  [
    dRoot,
    userDataDir,
    extDir,
    join(extDir, 'plugins'),
    join(extDir, 'resources'),
    projectsDir,
    backupsDir,
    join(backupsDir, '_general')
  ].forEach((dir) => {
    if (!existsSync(dir)) {
      try { mkdirSync(dir, { recursive: true }); } catch {}
    }
  });

  try { app.setPath('userData', userDataDir); } catch {}
  ensureInitialConfig();
  seedExtensionsFromZip(extDir);

  // 启动自愈与自动清洁检查
  const cfg = readAppConfig();
  if (cfg.autoCleanCacheOnStartup) {
    clearAppCache();
  }
  if (cfg.autoCleanOrphansOnStartup) {
    clearOrphanBackups();
  }

  return { dataDir: dRoot, extDir, projectsDir, backupsDir };
}

function ensureInitialConfig() {
  const cfgPath = join(dataRoot(), 'config.json');
  if (!existsSync(cfgPath)) {
    try {
      writeFileSync(cfgPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    } catch {}
  }
}

// ============ 配置文件 config.json ============
export interface AppConfig {
  autoBackupInterval?: number;       // 毫秒，默认 60000 (1分钟)
  maxSnapshots?: number;             // 每个项目保留快照数量，默认 15
  autoRestoreSession?: boolean;       // 默认 true (类似 Notepad 原地恢复)
  autoCleanCacheOnStartup?: boolean; // 默认 false (开启后每次启动自动清理 Chromium 临时缓存)
  autoCleanOrphansOnStartup?: boolean; // 默认 true (启动时自动清理已删除项目的残留快照)
  lastCheckUpdate?: string;          // 上次检测更新的时间戳 ISO 字符串
  [key: string]: any;
}

const DEFAULT_CONFIG: AppConfig = {
  autoBackupInterval: 60000,
  maxSnapshots: 15,
  autoRestoreSession: true,
  autoCleanCacheOnStartup: false,
  autoCleanOrphansOnStartup: true
};

export function readAppConfig(): AppConfig {
  const cfgPath = join(dataRoot(), 'config.json');
  if (!existsSync(cfgPath)) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(cfgPath, 'utf-8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeAppConfig(patch: Partial<AppConfig>): AppConfig {
  const cfgPath = join(dataRoot(), 'config.json');
  const current = readAppConfig();
  const updated = { ...current, ...patch };
  try {
    writeFileSync(cfgPath, JSON.stringify(updated, null, 2), 'utf-8');
  } catch {}
  return updated;
}

// ============ 会话记忆 session.json ============
export interface SessionTab {
  id: string;
  name: string;
  filePath?: string | null;
  isDirty?: boolean;
  scene: any;
}

export interface AppSession {
  activeTabId: string | null;
  tabs: SessionTab[];
  updatedAt: string;
}

export function readSession(): AppSession | null {
  const sPath = join(dataRoot(), 'session.json');
  if (!existsSync(sPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(sPath, 'utf-8'));
    if (raw && Array.isArray(raw.tabs) && raw.tabs.length > 0) return raw;
  } catch {}
  return null;
}

export function writeSession(session: { activeTabId: string | null; tabs: SessionTab[] }): boolean {
  const sPath = join(dataRoot(), 'session.json');
  try {
    const payload: AppSession = {
      ...session,
      updatedAt: new Date().toISOString()
    };
    writeFileSync(sPath, JSON.stringify(payload, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ============ 项目与备份管理 ============
export interface ProjectFileInfo {
  fileName: string;
  filePath: string;
  name: string;
  size: number;
  updatedAt: string;
  elementCount?: number;
  previewText?: string;
  backupCount?: number; // 该项目专属的快照数量
}

export function sanitizeProjectFolder(name: string): string {
  return (name || '').trim().replace(/[\\/:*?"<>|]+/g, '_') || '_general';
}

export function listProjects(): ProjectFileInfo[] {
  const dir = join(dataRoot(), 'projects');
  if (!existsSync(dir)) return [];
  const list: ProjectFileInfo[] = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (!f.isFile() || !f.name.toLowerCase().endsWith('.bcproj')) continue;
    const full = join(dir, f.name);
    try {
      const stat = statSync(full);
      const raw = JSON.parse(readFileSync(full, 'utf-8'));
      const projName = raw.name || f.name.replace(/\.bcproj$/i, '');
      const backupDir = join(dataRoot(), 'backups', sanitizeProjectFolder(projName));
      const backupCount = existsSync(backupDir)
        ? readdirSync(backupDir).filter((x) => x.endsWith('.bcproj')).length
        : 0;

      list.push({
        fileName: f.name,
        filePath: full,
        name: projName,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        elementCount: raw.meta?.elementCount ?? countNodes(raw.scene?.root),
        previewText: raw.meta?.description || '',
        backupCount
      });
    } catch {}
  }
  return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/** 取得某个项目专属的历史备份与快照列表 */
export function listProjectBackups(projectName?: string): ProjectFileInfo[] {
  const folderName = sanitizeProjectFolder(projectName || '_general');
  const dir = join(dataRoot(), 'backups', folderName);
  if (!existsSync(dir)) return [];
  const list: ProjectFileInfo[] = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (!f.isFile() || !f.name.toLowerCase().endsWith('.bcproj')) continue;
    const full = join(dir, f.name);
    try {
      const stat = statSync(full);
      const raw = JSON.parse(readFileSync(full, 'utf-8'));
      list.push({
        fileName: f.name,
        filePath: full,
        name: f.name === 'autosave.bcproj' ? '自动保存草稿 (最新)' : (raw.name || f.name),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        elementCount: countNodes(raw.scene?.root)
      });
    } catch {}
  }
  return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/** 保存项目专属快照 */
export function saveProjectSnapshotFile(scene: any, projectName?: string, isAuto = true): string {
  const folderName = sanitizeProjectFolder(projectName || '_general');
  const bDir = join(dataRoot(), 'backups', folderName);
  if (!existsSync(bDir)) mkdirSync(bDir, { recursive: true });

  const payload = {
    format: 'BlockCanvas-Project',
    version: '1.0.0',
    name: projectName || (isAuto ? '自动保存草稿' : '历史快照'),
    updatedAt: new Date().toISOString(),
    scene
  };

  // 1. 最新快照
  const latestFile = join(bDir, 'autosave.bcproj');
  writeFileSync(latestFile, JSON.stringify(payload, null, 2), 'utf-8');

  // 2. 时间戳轮转快照
  const now = new Date();
  const timeTag = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const snapFile = join(bDir, `snapshot-${timeTag}.bcproj`);
  writeFileSync(snapFile, JSON.stringify(payload, null, 2), 'utf-8');

  // 3. 按配置清理该项目的超额快照
  const cfg = readAppConfig();
  const maxLimit = typeof cfg.maxSnapshots === 'number' ? cfg.maxSnapshots : 15;
  cleanOldProjectSnapshots(folderName, maxLimit);

  return payload.updatedAt;
}

export function cleanOldProjectSnapshots(folderName: string, maxLimit: number) {
  const bDir = join(dataRoot(), 'backups', folderName);
  if (!existsSync(bDir)) return;
  try {
    const snaps = readdirSync(bDir)
      .filter((f) => f.startsWith('snapshot-') && f.endsWith('.bcproj'))
      .sort();
    if (snaps.length > maxLimit) {
      for (const old of snaps.slice(0, snaps.length - maxLimit)) {
        try { unlinkSync(join(bDir, old)); } catch {}
      }
    }
  } catch {}
}

export function deleteProjectBackupFolder(projectName: string) {
  const folderName = sanitizeProjectFolder(projectName);
  const bDir = join(dataRoot(), 'backups', folderName);
  if (existsSync(bDir)) {
    try { rmSync(bDir, { recursive: true, force: true }); } catch {}
  }
}

// ============ 缓存与磁盘占用统计及自动清理 ============
export interface StorageStats {
  cacheSize: number;          // Chromium 渲染/字节码/GPU 临时缓存字节数
  backupsSize: number;        // 历史快照与备份总占用
  projectsSize: number;       // 项目工程文件占用
  extensionsSize: number;     // 扩展与插件占用
  totalSize: number;          // data/ 总占用字节数
  orphanBackupsCount: number; // 孤立无主的快照文件夹数量
}

export function getDirSize(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dirPath, e.name);
      if (e.isDirectory()) {
        total += getDirSize(full);
      } else if (e.isFile()) {
        try { total += statSync(full).size; } catch {}
      }
    }
  } catch {}
  return total;
}

export function getStorageStats(): StorageStats {
  const dRoot = dataRoot();
  const uData = join(dRoot, 'user-data');
  const cacheDirs = [
    join(uData, 'Cache'),
    join(uData, 'Code Cache'),
    join(uData, 'GPUCache'),
    join(uData, 'DawnGraphiteCache'),
    join(uData, 'DawnWebGPUCache'),
    join(uData, 'blob_storage')
  ];

  let cacheSize = 0;
  for (const d of cacheDirs) cacheSize += getDirSize(d);

  const backupsDir = join(dRoot, 'backups');
  const backupsSize = getDirSize(backupsDir);

  const projectsDir = join(dRoot, 'projects');
  const projectsSize = getDirSize(projectsDir);

  const extensionsDir = join(dRoot, 'extensions');
  const extensionsSize = getDirSize(extensionsDir);

  const totalSize = getDirSize(dRoot);

  // 统计已删除项目的孤立残留备份数
  const projects = listProjects();
  const validNames = new Set(projects.map((p) => sanitizeProjectFolder(p.name)));
  for (const p of projects) {
    validNames.add(sanitizeProjectFolder(p.fileName.replace(/\.bcproj$/i, '')));
  }
  validNames.add('_general');

  let orphanBackupsCount = 0;
  if (existsSync(backupsDir)) {
    try {
      for (const e of readdirSync(backupsDir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (!validNames.has(e.name)) orphanBackupsCount++;
        } else if (e.isFile() && e.name.endsWith('.bcproj')) {
          orphanBackupsCount++;
        }
      }
    } catch {}
  }

  return {
    cacheSize,
    backupsSize,
    projectsSize,
    extensionsSize,
    totalSize,
    orphanBackupsCount
  };
}

/**
 * 递归深度清理目录下的所有文件，保留空目录结构；遇锁跳过，最大化安全释放空间
 */
function cleanDirFilesRecursively(dir: string): number {
  if (!existsSync(dir)) return 0;
  let freed = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        freed += cleanDirFilesRecursively(full);
        try { rmSync(full, { recursive: false }); } catch {}
      } else if (e.isFile()) {
        try {
          const sz = statSync(full).size;
          unlinkSync(full);
          freed += sz;
        } catch {}
      }
    }
  } catch {}
  return freed;
}

export async function clearAppCache(): Promise<{ ok: boolean; freedBytes: number }> {
  // 1. 调用 Chromium 内部 session 清理接口（清除内存与活动网络缓存）
  try {
    const { session } = await import('electron');
    if (session && session.defaultSession) {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData({
        storages: ['shadercache', 'cachestorage']
      });
    }
  } catch {}

  const uData = join(dataRoot(), 'user-data');
  const cacheDirs = [
    join(uData, 'Cache'),
    join(uData, 'Code Cache'),
    join(uData, 'GPUCache'),
    join(uData, 'DawnGraphiteCache'),
    join(uData, 'DawnWebGPUCache'),
    join(uData, 'blob_storage')
  ];

  let freedBytes = 0;

  // 2. 递归深度逐文件清空缓存目录（保留目录壳防重构报错）
  for (const d of cacheDirs) {
    if (existsSync(d)) {
      freedBytes += cleanDirFilesRecursively(d);
    }
  }

  // 3. 顺带清理 backups 根目录下早期残留的孤立文件（非文件夹）
  const bRoot = join(dataRoot(), 'backups');
  if (existsSync(bRoot)) {
    try {
      for (const e of readdirSync(bRoot, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith('.bcproj')) {
          try {
            const f = join(bRoot, e.name);
            freedBytes += statSync(f).size;
            unlinkSync(f);
          } catch {}
        }
      }
    } catch {}
  }

  return { ok: true, freedBytes };
}

export function clearOrphanBackups(): { ok: boolean; cleanedCount: number; freedBytes: number } {
  const projects = listProjects();
  const validNames = new Set(projects.map((p) => sanitizeProjectFolder(p.name)));
  for (const p of projects) {
    validNames.add(sanitizeProjectFolder(p.fileName.replace(/\.bcproj$/i, '')));
  }
  validNames.add('_general');

  const bRoot = join(dataRoot(), 'backups');
  if (!existsSync(bRoot)) return { ok: true, cleanedCount: 0, freedBytes: 0 };

  let count = 0;
  let freed = 0;

  try {
    for (const e of readdirSync(bRoot, { withFileTypes: true })) {
      const full = join(bRoot, e.name);
      if (e.isDirectory()) {
        if (!validNames.has(e.name)) {
          freed += getDirSize(full);
          try { rmSync(full, { recursive: true, force: true }); count++; } catch {}
        }
      } else if (e.isFile() && e.name.endsWith('.bcproj')) {
        freed += statSync(full).size;
        try { unlinkSync(full); count++; } catch {}
      }
    }
  } catch {}

  return { ok: true, cleanedCount: count, freedBytes: freed };
}

function countNodes(node: any): number {
  if (!node) return 0;
  let count = 1;
  if (Array.isArray(node.children)) {
    for (const c of node.children) count += countNodes(c);
  }
  return count;
}

/**
 * 从「种子扩展目录」同步内置扩展到运行时 data/extensions/
 * 同名 id 覆盖，用户第三方扩展保留不动
 */
function seedExtensionsFromZip(extDir: string) {
  try {
    // 种子路径：exe 同级的 data/extensions/
    const seedExtDir = join(dirname(process.execPath), 'data', 'extensions');
    if (!existsSync(seedExtDir)) return;

    for (const kindDir of ['plugins', 'resources']) {
      const srcKind = join(seedExtDir, kindDir);
      const destKind = join(extDir, kindDir);
      if (!existsSync(srcKind)) continue;
      if (!existsSync(destKind)) mkdirSync(destKind, { recursive: true });

      for (const item of readdirSync(srcKind, { withFileTypes: true })) {
        if (!item.isDirectory()) continue;
        const srcItem = join(srcKind, item.name);
        const destItem = join(destKind, item.name);
        syncDirOverwrite(srcItem, destItem, false);
      }
    }
  } catch {}
}

/** 递归覆盖 src → dest；skipData 为 true 时跳过 data/ 目录 */
function syncDirOverwrite(src: string, dest: string, skipData: boolean) {
  if (!existsSync(src)) return;
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (skipData && entry.name === 'data') continue;

    if (entry.isDirectory() && entry.name === 'extensions') {
      syncExtensionsOverwrite(srcPath, destPath);
      continue;
    }

    if (entry.isDirectory()) {
      syncDirOverwrite(srcPath, destPath, skipData);
    } else if (entry.isFile()) {
      try { copyFileSync(srcPath, destPath); } catch {}
    }
  }
}

/** 覆盖 extensions/ 下的插件或资源包：只更新同名 id，不删除用户自装扩展 */
function syncExtensionsOverwrite(srcExt: string, destExt: string) {
  if (!existsSync(srcExt)) return;
  if (!existsSync(destExt)) mkdirSync(destExt, { recursive: true });

  for (const kindDir of ['plugins', 'resources']) {
    const srcKind = join(srcExt, kindDir);
    const destKind = join(destExt, kindDir);
    if (!existsSync(srcKind)) continue;
    if (!existsSync(destKind)) mkdirSync(destKind, { recursive: true });

    for (const item of readdirSync(srcKind, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      syncDirOverwrite(join(srcKind, item.name), join(destKind, item.name), false);
    }
  }
}

// ============ 自动更新系统 ============
// v0.4.3 起，整套自动更新逻辑搬到了独立模块 src/main/updater.ts：
//   · 发行版读取（多镜像回退：NexaCode → gh-proxy(v4) → GitHub 直连）
//   · 版本列表构建（当前 + 往前 5 个只读 + 当前及往后全部可更新）
//   · 多镜像下载（gh-proxy(v4) → NexaCode → GitHub 直连）+ zip 完整性校验
//   · 跨平台替换（Windows robocopy / macOS·Linux rsync），始终排除 data/ 用户数据
// 这里不再保留任何更新相关代码，避免两份实现漂移。
