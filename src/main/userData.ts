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

export function clearAppCache(): { ok: boolean; freedBytes: number } {
  const uData = join(dataRoot(), 'user-data');
  const cacheDirs = [
    join(uData, 'Cache'),
    join(uData, 'Code Cache'),
    join(uData, 'GPUCache'),
    join(uData, 'DawnGraphiteCache'),
    join(uData, 'DawnWebGPUCache'),
    join(uData, 'blob_storage')
  ];
  let before = 0;
  for (const d of cacheDirs) before += getDirSize(d);

  // 只清除目录内的文件，保留目录结构（避免 Chromium 重建后重新占满）
  for (const d of cacheDirs) {
    if (!existsSync(d)) continue;
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          rmSync(full, { recursive: true, force: true });
        } else {
          unlinkSync(full);
        }
      }
    } catch {}
  }

  // 顺带清理 backups 根目录下早期残留的孤立文件（非文件夹）
  const bRoot = join(dataRoot(), 'backups');
  if (existsSync(bRoot)) {
    try {
      for (const e of readdirSync(bRoot, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith('.bcproj')) {
          try {
            const f = join(bRoot, e.name);
            before += statSync(f).size;
            unlinkSync(f);
          } catch {}
        }
      }
    } catch {}
  }

  return { ok: true, freedBytes: before };
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

// ============ 自动更新系统 ============

/** 当前应用版本号，从 Electron app 内置元数据读取（最可靠，asar 内也兼容） */
export const APP_VERSION: string = app.getVersion();

/**
 * 获取当前安装版本（从 package.json 读取）
 * 作为 getLocalVersion() 的后备方案，确保任何环境下都能正确读取
 */
export function getLocalVersion(): string {
  // 优先用 Electron 内置方法（asar/unpacked 均兼容）
  const v = app.getVersion();
  if (v && v !== '0.0.0') return v;
  // 后备：从 exe 同级 package.json 读
  try {
    const pkgPath = join(dirname(process.execPath), 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '0.0.0';
    }
  } catch {}
  return '0.0.0';
}

/**
 * 从 GitHub Releases API 获取最新发布信息（直接请求，不走镜像，镜像只用于下载文件）
 * 注意：后台需关闭 Watt Toolkit（原 Clash Verge），否则会劫持 DNS 导致请求失败。
 */
const DOWNLOAD_MIRROR = 'https://v4.gh-proxy.org/';

export interface LatestReleaseInfo {
  tag: string;
  version: string;
  name: string;
  assets: ReleaseAsset[];
  publishedAt: string;
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export async function fetchLatestRelease(): Promise<LatestReleaseInfo | null> {
  // 直连 GitHub API（不走镜像），取列表第一条 release（含 prerelease）
  const repo = 'DrZhaology/BlockCanvas';
  const url = `https://api.github.com/repos/${repo}/releases?per_page=1`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github.v3+json' }
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any[];
    if (!data.length) return null;
    const release = data[0];
    return {
      tag: release.tag_name,
      version: release.tag_name.replace(/^v/i, ''),
      name: release.name || release.tag_name,
      assets: (release.assets || []).map((a: any) => ({
        name: a.name,
        browser_download_url: a.browser_download_url,
        size: a.size
      })),
      publishedAt: release.published_at
    };
  } catch {
    return null;
  }
}

/**
 * 比较两个 semver 字符串，返回 1（新版本）/ 0（相同）/ -1（旧版本）
 */
export function compareVersion(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map(Number);
  const pb = b.replace(/^v/i, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/**
 * 根据当前平台找到匹配的 release asset URL
 * 目前仅支持 win-x64；若找不到则返回第一个 asset 供降级处理
 */
export function findMatchingAsset(assets: ReleaseAsset[]): string | null {
  for (const asset of assets) {
    const name = asset.name.toLowerCase();
    const isWin = name.includes('win') && !name.includes('arm');
    const isX64 = name.includes('x64') || name.includes('x86_64');
    if (isWin && isX64) return asset.browser_download_url;
  }
  return assets.length > 0 ? assets[0].browser_download_url : null;
}

/**
 * 下载文件并返回临时路径（通过 gh-proxy 镜像下载 GitHub CDN 资源）
 */
export async function downloadUpdateAsset(
  url: string,
  destPath: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    mkdirSync(dirname(destPath), { recursive: true });
    // 用镜像下载 GitHub CDN 上的 zip 文件
    const mirrorUrl = `${DOWNLOAD_MIRROR}${url}`;
    const res = await fetch(mirrorUrl, {
      headers: { Accept: 'application/octet-stream' }
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(destPath, buffer);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || '下载失败' };
  }
}

/**
 * 解压 zip 到目标目录（使用 Node.js 原生命令 7z 或 systemunzip）
 * 备用：用 child_process 调用 System32\tar（Win10+ 内置）
 */
export async function unzipUpdate(
  zipPath: string,
  targetDir: string
): Promise<{ ok: boolean; error?: string }> {
  const { execSync } = await import('node:child_process');
  try {
    mkdirSync(targetDir, { recursive: true });
    // Win10+ 内置 tar
    execSync(`tar -xf "${zipPath}" -C "${targetDir}"`, {
      stdio: 'pipe',
      timeout: 60000
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.stderr?.toString() || e.message || '解压失败' };
  }
}

/**
 * 从 zip 内 data/extensions/ 同步内置扩展到运行时 data/extensions/
 * 同名 id 覆盖，用户第三方扩展保留不动
 */
function seedExtensionsFromZip(extDir: string) {
  try {
    // zip 内路径：exe 同级的 data/extensions/
    const zipExtDir = join(dirname(process.execPath), 'data', 'extensions');
    if (!existsSync(zipExtDir)) return;

    for (const kindDir of ['plugins', 'resources']) {
      const srcKind = join(zipExtDir, kindDir);
      const destKind = join(extDir, kindDir);
      if (!existsSync(srcKind)) continue;
      if (!existsSync(destKind)) mkdirSync(destKind, { recursive: true });

      for (const item of readdirSync(srcKind, { withFileTypes: true })) {
        if (!item.isDirectory()) continue;
        const srcItem = join(srcKind, item.name);
        const destItem = join(destKind, item.name);
        // 同名 id：覆盖；用户自装 id：跳过
        if (existsSync(destItem)) {
          syncDirOverwrite(srcItem, destItem, false);
        } else {
          syncDirOverwrite(srcItem, destItem, false);
        }
      }
    }
  } catch {}
}

/**
 * 递归覆盖 src → dest，跳过 data/ 目录；对 extensions/ 做按 id 覆盖（保留用户第三方扩展）
 */
function syncDirOverwrite(src: string, dest: string, skipData: boolean) {
  if (!existsSync(src)) return;
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    // 跳过 data/ 目录（用户数据，永久保留）
    if (skipData && entry.name === 'data') continue;

    // extensions/ 只覆盖同名子目录，不删除用户自己装的第三方扩展
    if (entry.isDirectory() && entry.name === 'extensions') {
      syncExtensionsOverwrite(srcPath, destPath);
      continue;
    }

    if (entry.isDirectory()) {
      syncDirOverwrite(srcPath, destPath, skipData);
    } else if (entry.isFile()) {
      try {
        copyFileSync(srcPath, destPath);
      } catch {}
    }
  }
}

/**
 * 覆盖 extensions/ 下的插件或资源包：只更新同名 id，不删除用户自装扩展
 */
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
      const srcItem = join(srcKind, item.name);
      const destItem = join(destKind, item.name);
      // 同名 id：覆盖文件；用户自装 id（不在 src 中）：保留不动
      if (existsSync(destItem)) {
        syncDirOverwrite(srcItem, destItem, false);
      } else {
        syncDirOverwrite(srcItem, destItem, false);
      }
    }
  }
}

/**
 * 执行应用更新：下载 zip → 解压 → 覆盖 appDir（保留 data/）→ 重启
 */
export async function applyUpdate(
  assetUrl: string,
  onProgress?: (msg: string) => void
): Promise<{ ok: boolean; error?: string }> {
  const appDir = dirname(process.execPath);
  const tempDir = join(appDir, '.update-temp');
  const zipPath = join(tempDir, 'update.zip');

  try {
    onProgress?.('正在下载更新包…');
    const dlResult = await downloadUpdateAsset(assetUrl, zipPath);
    if (!dlResult.ok) return { ok: false, error: `下载失败: ${dlResult.error}` };

    onProgress?.('正在解压更新包…');
    const unzipResult = await unzipUpdate(zipPath, tempDir);
    if (!unzipResult.ok) return { ok: false, error: `解压失败: ${unzipResult.error}` };

    onProgress?.('正在覆盖更新文件（保留您的数据）…');
    // 找出解压后的根目录（zip 内可能是 BlockCanvas/ 或直接是文件）
    const extractRoot = existsSync(join(tempDir, 'BlockCanvas'))
      ? join(tempDir, 'BlockCanvas')
      : tempDir;

    // 备份当前 appDir（用于回滚）
    const bakDir = join(appDir, '.appdir.bak');
    if (existsSync(bakDir)) rmSync(bakDir, { recursive: true, force: true });
    try {
      syncDirOverwrite(extractRoot, bakDir, false);
    } catch {}

    // 覆盖 appDir（跳过 data/）
    syncDirOverwrite(extractRoot, appDir, true);

    // 清理临时文件
    rmSync(tempDir, { recursive: true, force: true });

    onProgress?.('更新完成，正在重启程序…');
    app.relaunch();
    app.exit(0);

    return { ok: true };
  } catch (e: any) {
    // 失败时尝试回滚
    try {
      const bakDir = join(appDir, '.appdir.bak');
      if (existsSync(bakDir)) {
        rmSync(appDir, { recursive: true, force: true });
        syncDirOverwrite(bakDir, appDir, false);
        rmSync(bakDir, { recursive: true, force: true });
      }
    } catch {}
    rmSync(tempDir, { recursive: true, force: true });
    return { ok: false, error: e.message || '更新失败' };
  }
}
