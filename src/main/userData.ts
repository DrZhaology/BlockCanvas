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
 * 从 GitHub Releases API 获取发布列表（直接请求，不走镜像，镜像只用于下载文件）。
 * 含预发行版（prerelease），按 GitHub 返回顺序（最新在前）。
 * 注意：后台需关闭 Watt Toolkit（原 Clash Verge），否则会劫持 DNS 导致请求失败。
 */
const DOWNLOAD_MIRROR = 'https://v4.gh-proxy.org/';

export interface LatestReleaseInfo {
  tag: string;
  version: string;
  name: string;
  assets: ReleaseAsset[];
  publishedAt: string;
  prerelease?: boolean;
  body?: string;
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

/** 拉取发布列表（最新在前，含预发行版） */
export async function fetchReleases(perPage = 10): Promise<LatestReleaseInfo[] | null> {
  const repo = 'DrZhaology/BlockCanvas';
  const url = `https://api.github.com/repos/${repo}/releases?per_page=${perPage}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github.v3+json' }
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any[];
    if (!Array.isArray(data)) return null;
    return data.map((release) => ({
      tag: release.tag_name,
      version: release.tag_name.replace(/^v/i, ''),
      name: release.name || release.tag_name,
      assets: (release.assets || []).map((a: any) => ({
        name: a.name,
        browser_download_url: a.browser_download_url,
        size: a.size
      })),
      publishedAt: release.published_at,
      prerelease: !!release.prerelease,
      body: typeof release.body === 'string' ? release.body : ''
    }));
  } catch {
    return null;
  }
}

/** 兼容旧调用：取最新一条 */
export async function fetchLatestRelease(): Promise<LatestReleaseInfo | null> {
  const list = await fetchReleases(1);
  return list && list.length > 0 ? list[0] : null;
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
 * v0.4.1：按当前平台匹配发行版资产。
 * 只认"名称关键词"（很多资产是 zip 但平台不同，单看后缀分不出来）：
 *   win32  → win / windows / win64 / win-x64（排除 mac/linux/android/ios/arm 关键词）
 *   darwin → mac / darwin / osx / dmg
 *   linux  → linux / appimage / deb
 *   android→ android / apk
 *   ios    → ios / iphone / ipa
 * 找不到 → 返回 null（表示"该平台这一版没有对应构建"，可检测但不可更新）。
 */
export interface MatchedAsset {
  url: string;
  name: string;
  size: number;
}

export function findMatchingAsset(assets: ReleaseAsset[]): MatchedAsset | null {
  const plat = process.platform as string;
  const score = (name: string): number => {
    const n = name.toLowerCase();
    let hit = 0;
    switch (plat as string) {
      case 'win32':
        if (/(^|[^a-z])(win|windows|win64|win-x64|win32)([^a-z]|$)/.test(n) || n.includes('windows')) hit += 2;
        if (/(mac|darwin|osx|linux|android|apk|ios|iphone|ipa|arm64|arm)/.test(n)) hit -= 4;
        if (n.includes('x64')) hit += 1;
        if (n.includes('portable') || n.endsWith('.zip')) hit += 1;
        break;
      case 'darwin':
        if (/(mac|darwin|osx|dmg)/.test(n)) hit += 2;
        if (/(win|linux|android|apk|ios|iphone)/.test(n)) hit -= 4;
        if (/(arm64|aarch64)/.test(n)) hit += 1;
        break;
      case 'linux':
        if (/(linux|appimage|deb)/.test(n)) hit += 2;
        if (/(win|mac|darwin|osx|android|apk|ios|iphone)/.test(n)) hit -= 4;
        break;
      case 'android':
        if (/(android|apk)/.test(n)) hit += 2;
        break;
      case 'ios':
        if (/(ios|iphone|ipa)/.test(n)) hit += 2;
        break;
    }
    return hit;
  };
  let best: { asset: ReleaseAsset; hit: number } | null = null;
  for (const asset of assets) {
    const hit = score(asset.name);
    if (hit > 0 && (!best || hit > best.hit)) best = { asset, hit };
  }
  if (!best) return null;
  return { url: best.asset.browser_download_url, name: best.asset.name, size: best.asset.size };
}

/**
 * 下载文件（流式写盘，走 gh-proxy 镜像加速 GitHub CDN）。
 * onProgress(pct 0~100, 已下载 MB, 总 MB)
 */
export async function downloadUpdateAsset(
  url: string,
  destPath: string,
  onProgress?: (pct: number, mb: number, totalMb: number) => void
): Promise<{ ok: boolean; error?: string }> {
  try {
    mkdirSync(dirname(destPath), { recursive: true });
    const mirrorUrl = `${DOWNLOAD_MIRROR}${url}`;
    const res = await fetch(mirrorUrl, {
      headers: { Accept: 'application/octet-stream' }
    });
    if (!res.ok || !res.body) return { ok: false, error: `HTTP ${res.status}` };

    const total = Number(res.headers.get('content-length') || 0);
    const totalMb = Math.round((total / 1048576) * 10) / 10;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastPct = -1;
    // 流式读入内存（便携版 zip 一般 < 150MB，可接受）；写入临时文件
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        if (onProgress && total > 0) {
          const pct = Math.min(99, Math.floor((received / total) * 100));
          if (pct !== lastPct) {
            lastPct = pct;
            onProgress(pct, Math.round((received / 1048576) * 10) / 10, totalMb);
          }
        }
      }
    }
    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    writeFileSync(destPath, buffer);
    onProgress?.(100, Math.round((buffer.length / 1048576) * 10) / 10, totalMb);
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
 * v0.4.1 重写：执行应用更新
 *
 * 过去的 BUG：正在运行的 Electron 无法覆盖自己的 exe / app.asar（文件被进程锁定），
 * copyFileSync 失败又被 catch {} 静默吞掉 —— 结果就是"下载成功但完全没替换"。
 *
 * 新方案（标准便携应用自更新流程）：
 *   1. 下载 zip → 解压到 <appDir>/.update/staging/（新版本完整目录）；
 *   2. 校验 staging 里有 BlockCanvas.exe（防下载损坏）；
 *   3. 生成 <appDir>/.update/apply-update.bat，由【独立 detached 进程】执行：
 *        等主进程退出 → robocopy staging→appDir（/PURGE 清理旧文件，/XD data 排除用户数据）
 *        → 删除 .update 全部临时文件 → 重新启动程序。
 *   4. 主进程直接退出，把文件锁交出去。
 *
 * data/ 兼容性（最高优先级）：
 *   · robocopy /XD data —— staging 里的 data/ 不覆盖用户数据，旧 data 不被 /PURGE 删除；
 *   · 新版本对 data/ 只做向后兼容（工程文件 .bcproj / session.json / config.json 结构只加不改）。
 */
export async function applyUpdate(
  assetUrl: string,
  onProgress?: (msg: string, pct?: number) => void
): Promise<{ ok: boolean; error?: string }> {
  const appDir = dirname(process.execPath);
  const updateDir = join(appDir, '.update');
  const stagingDir = join(updateDir, 'staging');
  const zipPath = join(updateDir, 'update.zip');

  // 覆盖动作只能发生在程序退出后 —— 开发模式（源码运行）没有可替换的安装目录
  if (!app.isPackaged) {
    return { ok: false, error: '当前处于源码开发模式（pnpm dev），没有可替换的安装目录。请使用打包后的便携版进行更新。' };
  }

  try {
    // 0. 清掉上一次更新可能留下的残留
    rmSync(updateDir, { recursive: true, force: true });
    mkdirSync(stagingDir, { recursive: true });

    // 1. 下载（流式 + 进度）
    onProgress?.('正在通过镜像下载更新包…', 0);
    const dl = await downloadUpdateAsset(assetUrl, zipPath, (pct, mb, totalMb) => {
      onProgress?.(`正在下载更新包… ${mb} / ${totalMb} MB`, pct);
    });
    if (!dl.ok) return { ok: false, error: `下载失败：${dl.error}` };

    // 2. 解压
    onProgress?.('正在解压更新包…', 100);
    const unz = await unzipUpdate(zipPath, stagingDir);
    if (!unz.ok) return { ok: false, error: `解压失败：${unz.error}` };

    // zip 内可能有顶层目录（BlockCanvas/），也可能直接是文件 —— 找到真正含 exe 的根
    let extractRoot = stagingDir;
    if (existsSync(join(stagingDir, 'BlockCanvas', 'BlockCanvas.exe'))) {
      extractRoot = join(stagingDir, 'BlockCanvas');
    } else if (!existsSync(join(stagingDir, 'BlockCanvas.exe'))) {
      // 再找一层：staging 下唯一目录且里面有 exe
      const entries = readdirSync(stagingDir, { withFileTypes: true });
      const dir = entries.find((e) => e.isDirectory() && existsSync(join(stagingDir, e.name, 'BlockCanvas.exe')));
      if (dir) extractRoot = join(stagingDir, dir.name);
      else return { ok: false, error: '更新包内容异常：未找到 BlockCanvas.exe（下载可能不完整）' };
    }

    // 3. 生成退出后执行的替换批处理
    //    robocopy 要点：
    //      /E        复制子目录（含空目录）
    //      /PURGE    删除目标中源里没有的文件 → 清掉旧版本残留（"没有任何多余文件"）
    //      /XD data  排除用户数据目录：不覆盖、也不被 /PURGE 删除（data 永久保留）
    //      /R:2 /W:2 文件占用时重试 2 次
    const batPath = join(updateDir, 'apply-update.bat');
    const bat = [
      '@echo off',
      'rem BlockCanvas 自动更新脚本（由主进程生成，程序退出后由独立进程执行）',
      'chcp 65001 >nul',
      'title BlockCanvas Updater',
      'rem 等主进程完全退出、释放文件锁',
      'timeout /t 3 /nobreak >nul',
      `robocopy "${extractRoot}" "${appDir}" /E /PURGE /XD "data" ".update" /R:2 /W:2 /NFL /NDL /NJH /NJS /NP`,
      'rem robocopy 退出码 0-7 都是成功；8 以上才是错误',
      `if errorlevel 8 (`,
      `  echo 更新失败：文件替换出错。更新包保留在 .update 目录，程序未受影响。`,
      `  pause`,
      `  exit /b 1`,
      `)`,
      `rem 清理全部临时文件（zip / staging / 本脚本所在目录）`,
      `rmdir /s /q "${updateDir}"`,
      'rem 重新启动程序',
      `start "" "${join(appDir, 'BlockCanvas.exe')}"`,
      'exit /b 0',
      `del "%~f0"`
    ].join('\r\n');
    writeFileSync(batPath, bat, 'utf-8');

    // 4. 启动独立进程执行替换，然后本进程退出（交出文件锁）
    onProgress?.('准备就绪，正在重启以完成更新…', 100);
    const { spawn } = await import('node:child_process');
    const child = spawn('cmd.exe', ['/c', batPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();

    // 给批处理一点启动时间，然后退出主进程（文件锁随进程消失）
    setTimeout(() => {
      app.exit(0);
    }, 300);

    return { ok: true };
  } catch (e: any) {
    // 此阶段尚未触碰现有程序文件 —— 只需清理临时目录即可，无需回滚
    try { rmSync(updateDir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: e.message || '更新失败' };
  }
}
