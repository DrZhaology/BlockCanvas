import { session } from 'electron';
import { join } from 'node:path';
import { existsSync, readdirSync, statSync, unlinkSync, rmSync } from 'node:fs';
import { dataRoot, listProjects, sanitizeProjectFolder, readAppConfig } from './userData';
import { sessionDraftBytes } from './session';
import { systemTempDir } from './paths';

// ============================================================================
// BlockCanvas · 存储与缓存统一管理（v0.4.4）
// ----------------------------------------------------------------------------
// 为什么要单独一个模块：以前"统计"和"清理"各自写了一份**硬编码目录清单**
// （`getStorageStats` 一份、`clearAppCache` 一份），两边一旦不同步就会出现
// "显示 2.6 MB，清完还是 2.6 MB" 这类"识别不准"的问题。
//
// 现在规则收敛成一条：**统计与清理共用同一份 `CACHE_ENTRIES` 清单**，
// 并且分类口径严格互斥、可加和 —— 所有分类之和 === 实际总占用（不再"对不上账"）。
//
// 三类目录的处置原则（写死在代码里，别凭感觉删）：
//   · 可清（缓存）：删了只会让下次启动稍慢，**不丢任何用户数据**
//   · 不可清（状态）：界面偏好 / 会话 / 站点数据 —— 删了用户会发现"设置被重置"
//   · 用户数据：项目 / 快照 / 扩展 —— 只能由用户显式删除
// ============================================================================

/** Chromium profile 下**可以安全删除**的目录（全部是可再生成的缓存/字典） */
const CACHE_ENTRIES = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'ShaderCache',
  'Dictionaries',
  'Shared Dictionary',
  'component_crx_cache',
  'extensions_crx_cache',
  'blob_storage'
];

/**
 * Chromium profile 下**绝对不能清**的目录（状态，不是缓存）。
 * 这份清单存在的意义：将来有人往 CACHE_ENTRIES 里加东西时，先在这里对照一眼。
 */
export const STATE_ENTRIES = [
  'Local Storage',
  'Session Storage',
  'WebStorage',
  'IndexedDB',
  'Service Worker',
  'Network',          // Cookies / 站点状态（本应用离线，但保守起见不动）
  'Preferences',
  'Local State',
  'Crashpad',         // 崩溃转储（诊断用）
  'SharedStorage'
];

/** 系统临时目录里"属于我们"的文件名前缀（**只按这些精确前缀匹配，绝不扫全目录**） */
const TEMP_PATTERNS: RegExp[] = [
  /^bc-preview-.*\.html$/i,   // 浏览器预览落盘
  /^bc-updater-.*$/i,         // 更新替换脚本工作目录
  /^bc-tmp-.*$/i              // 预留
];

export type StorageCategoryId =
  | 'chromiumCache' | 'temp' | 'downloads'
  | 'userState' | 'projects' | 'backups' | 'extensions' | 'other';

export interface StorageCategory {
  id: StorageCategoryId;
  label: string;
  bytes: number;
  /** 是否允许"一键清理" */
  cleanable: boolean;
  /** 给用户看的一句话说明 */
  hint: string;
}

export interface StorageBreakdown {
  dataRoot: string;
  /** data/ 目录总占用 */
  dataTotal: number;
  /** 临时文件分类总占用（= data/tmp + 系统 Temp 里我们的文件） */
  tempTotal: number;
  /** 其中"在 data/ 之外"的那部分：系统 Temp */
  systemTempBytes: number;
  /** 合计（= dataTotal + systemTempBytes） */
  grandTotal: number;
  /** 分类占用（**互斥且可加和**：所有分类之和 === grandTotal） */
  categories: StorageCategory[];
  orphanBackupsCount: number;
}

/** 兼容旧调用方（Settings 里旧字段名） */
export interface StorageStats {
  cacheSize: number;
  backupsSize: number;
  projectsSize: number;
  extensionsSize: number;
  totalSize: number;
  orphanBackupsCount: number;
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

export function getDirSize(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let total = 0;
  try {
    for (const e of readdirSync(dirPath, { withFileTypes: true })) {
      const full = join(dirPath, e.name);
      if (e.isDirectory()) total += getDirSize(full);
      else if (e.isFile()) { try { total += statSync(full).size; } catch { /* 忽略 */ } }
    }
  } catch { /* 忽略 */ }
  return total;
}

/** 递归清空目录内容但**保留目录壳**（Chromium 会重建，壳留着更稳） */
function cleanDirFilesRecursively(dir: string): number {
  if (!existsSync(dir)) return 0;
  let freed = 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        freed += cleanDirFilesRecursively(full);
        try { rmSync(full, { recursive: false }); } catch { /* 被占用就跳过 */ }
      } else if (e.isFile()) {
        try { const sz = statSync(full).size; unlinkSync(full); freed += sz; } catch { /* 被占用就跳过 */ }
      }
    }
  } catch { /* 忽略 */ }
  return freed;
}

function userDataDir(): string {
  return join(dataRoot(), 'user-data');
}

/** 系统临时目录里属于我们的条目（文件或目录）——用于回收**旧版本**的遗留文件 */
function listTempEntries(): { path: string; isDir: boolean; bytes: number }[] {
  const out: { path: string; isDir: boolean; bytes: number }[] = [];
  // ⚠ 用「操作系统真正的临时目录」而不是 app.getPath('temp')：
  //    后者在开启便携临时目录后已经指向 <data>/tmp/system，扫它就找不到老版本留下的文件了。
  const tmp = systemTempDir();
  if (!tmp || !existsSync(tmp)) return out;
  try {
    for (const e of readdirSync(tmp, { withFileTypes: true })) {
      if (!TEMP_PATTERNS.some((re) => re.test(e.name))) continue;   // 只认自己的前缀
      const full = join(tmp, e.name);
      try {
        if (e.isDirectory()) out.push({ path: full, isDir: true, bytes: getDirSize(full) });
        else if (e.isFile()) out.push({ path: full, isDir: false, bytes: statSync(full).size });
      } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
  return out;
}

function getTempSize(): number {
  return listTempEntries().reduce((a, b) => a + b.bytes, 0);
}

/** 统计孤立快照（项目已被删、备份还留着） */
function countOrphanBackups(): number {
  const backupsDir = join(dataRoot(), 'backups');
  if (!existsSync(backupsDir)) return 0;
  const valid = new Set<string>();
  for (const p of listProjects()) {
    valid.add(sanitizeProjectFolder(p.name));
    valid.add(sanitizeProjectFolder(p.fileName.replace(/\.bcproj$/i, '')));
  }
  valid.add('_general');
  let n = 0;
  try {
    for (const e of readdirSync(backupsDir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!valid.has(e.name)) n += 1; }
      else if (e.isFile() && e.name.endsWith('.bcproj')) n += 1;
    }
  } catch { /* 忽略 */ }
  return n;
}

// ---------------------------------------------------------------------------
// 统计（分类互斥、可加和）
// ---------------------------------------------------------------------------

export function getStorageBreakdown(): StorageBreakdown {
  const dRoot = dataRoot();
  const uData = userDataDir();

  // —— Chromium 缓存：与清理共用同一份清单 ——
  let chromiumCache = 0;
  for (const name of CACHE_ENTRIES) chromiumCache += getDirSize(join(uData, name));

  // —— 界面偏好 / 会话草稿：这两类都是"你的状态"，绝不清 ——
  //    · user-data 里除缓存外的部分（Local Storage / Preferences…）
  //    · data/session/ 下的未保存草稿（每个未保存标签一份容器）
  const userDataTotal = getDirSize(uData);
  const sessionBytes = sessionDraftBytes();
  const userState = Math.max(0, userDataTotal - chromiumCache) + sessionBytes;

  const projectsBytes = getDirSize(join(dRoot, 'projects'));
  const backupsBytes = getDirSize(join(dRoot, 'backups'));
  const extensionsBytes = getDirSize(join(dRoot, 'extensions'));
  const downloadsBytes = getDirSize(join(dRoot, 'downloads'));
  // 临时文件 = 程序目录里的 data/tmp（预览页 / 更新脚本工作目录）+ 系统 Temp 里遗留的我们的文件
  const localTempBytes = getDirSize(join(dRoot, 'tmp'));
  const systemTempBytes = getTempSize();
  const tempTotal = localTempBytes + systemTempBytes;

  const dataTotal = getDirSize(dRoot);
  // —— 其它：data/ 总占用 - 已分类部分（保证**所有 data 类之和 === dataTotal**，账目对得上）——
  const other = Math.max(0, dataTotal - (userDataTotal + sessionBytes + projectsBytes + backupsBytes + extensionsBytes + downloadsBytes + localTempBytes));

  const categories: StorageCategory[] = [
    { id: 'chromiumCache', label: 'Chromium 运行缓存', bytes: chromiumCache, cleanable: true, hint: '渲染 / 脚本编译 / GPU 的临时文件，清理不影响任何项目数据' },
    { id: 'temp', label: '临时文件（预览 / 更新 / 系统 Temp）', bytes: tempTotal, cleanable: true, hint: '浏览器预览页与更新脚本的工作文件，程序用完就该删掉' },
    { id: 'downloads', label: '更新包下载', bytes: downloadsBytes, cleanable: true, hint: '手动下载的更新 zip，装完就没用了' },
    { id: 'userState', label: '界面偏好与未保存草稿', bytes: userState, cleanable: false, hint: '窗口布局 / 面板宽度 / 各标签的未保存编辑内容 —— 清掉会"设置被重置 + 草稿丢失"' },
    { id: 'projects', label: '项目工程文件 (.bcproj)', bytes: projectsBytes, cleanable: false, hint: '你的作品本体，只能自己删' },
    { id: 'backups', label: '历史快照与备份', bytes: backupsBytes, cleanable: false, hint: '自动备份，可用"清理孤立快照"回收已删项目的部分' },
    { id: 'extensions', label: '扩展与插件包', bytes: extensionsBytes, cleanable: false, hint: '插件 / 资源包' },
    { id: 'other', label: '其它', bytes: other, cleanable: false, hint: 'config.json / session.json / tasks.json 等小文件' }
  ];

  return {
    dataRoot: dRoot,
    dataTotal,
    tempTotal,
    systemTempBytes,
    // 合计 = data/ 全部 + **只有系统 Temp 那部分**在 data/ 之外
    //（data/tmp 已经在 dataTotal 里了，不能再加一次 —— 否则"分类之和 ≠ 合计"）
    grandTotal: dataTotal + systemTempBytes,
    categories,
    orphanBackupsCount: countOrphanBackups()
  };
}

/** 旧接口（设置页历史字段），由 breakdown 派生，保证两边永远一致 */
export function getStorageStats(): StorageStats {
  const b = getStorageBreakdown();
  const pick = (id: StorageCategoryId) => b.categories.find((c) => c.id === id)?.bytes ?? 0;
  return {
    cacheSize: pick('chromiumCache') + pick('temp'),
    backupsSize: pick('backups'),
    projectsSize: pick('projects'),
    extensionsSize: pick('extensions'),
    totalSize: b.grandTotal,
    orphanBackupsCount: b.orphanBackupsCount
  };
}

// ---------------------------------------------------------------------------
// 清理（按分类）
// ---------------------------------------------------------------------------

/** 清 Chromium 缓存（内存态 + 磁盘态） */
export async function clearChromiumCache(): Promise<number> {
  // 1. 让 Chromium 自己关掉在用的缓存句柄（否则文件被占用删不掉）
  try {
    if (session?.defaultSession) {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData({ storages: ['shadercache', 'cachestorage'] });
    }
  } catch { /* 忽略 */ }

  // 2. 逐文件清空（清单与统计同源）
  let freed = 0;
  const uData = userDataDir();
  for (const name of CACHE_ENTRIES) freed += cleanDirFilesRecursively(join(uData, name));
  return freed;
}

/**
 * 清临时文件：`data/tmp/{preview,system}` 的内容 + 系统 Temp 里属于我们的文件。
 * ⚠ **保留 `preview` / `system` 两个目录壳** —— `system` 正被 Chromium 当作临时目录用，
 *    把目录本身删掉会让内核在运行中写不进去。
 */
export function clearOurTempFiles(): number {
  let freed = 0;
  // ① 程序目录里的临时区：只清内容，保留目录壳
  const localTmp = join(dataRoot(), 'tmp');
  for (const sub of ['preview', 'system']) {
    const d = join(localTmp, sub);
    if (existsSync(d)) freed += cleanDirFilesRecursively(d);
  }
  // ② 系统 Temp 里的历史遗留（老版本写的）
  for (const e of listTempEntries()) {
    try {
      if (e.isDir) rmSync(e.path, { recursive: true, force: true });
      else unlinkSync(e.path);
      freed += e.bytes;
    } catch { /* 被占用就跳过 */ }
  }
  return freed;
}

/** 清下载目录里的更新包（保留最近一次下载，避免用户刚下完就被清掉） */
export function clearDownloads(keepLatest = 1): number {
  const dir = join(dataRoot(), 'downloads');
  if (!existsSync(dir)) return 0;
  let files: { path: string; mtime: number; size: number }[] = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const full = join(dir, e.name);
      try { const st = statSync(full); files.push({ path: full, mtime: st.mtimeMs, size: st.size }); } catch { /* 忽略 */ }
    }
  } catch { return 0; }
  files.sort((a, b) => b.mtime - a.mtime);      // 新的在前
  let freed = 0;
  for (const f of files.slice(keepLatest)) {
    try { unlinkSync(f.path); freed += f.size; } catch { /* 忽略 */ }
  }
  return freed;
}

/** 单个分类的当前占用（比 getStorageBreakdown 轻，用于清理前后算差值） */
function categoryBytes(id: StorageCategoryId): number {
  switch (id) {
    case 'chromiumCache': {
      const uData = userDataDir();
      return CACHE_ENTRIES.reduce((a, n) => a + getDirSize(join(uData, n)), 0);
    }
    case 'temp': return getTempSize();
    case 'downloads': return getDirSize(join(dataRoot(), 'downloads'));
    default: return 0;
  }
}

/**
 * 统一入口：按分类清理。
 *
 * **释放字节数用"清理前后实测差值"**，而不是"我删了几个文件"——
 * 因为 Chromium 自己也会在清理过程中回收/重建缓存（`session.clearCache()` 删掉的那部分
 * 我们数不到）。用差值才能保证：**界面上看到的减少量 === 弹窗里报的数字**。
 */
export async function clearStorageCategory(id: StorageCategoryId): Promise<{ ok: boolean; freedBytes: number; error?: string }> {
  const before = categoryBytes(id);
  try {
    switch (id) {
      case 'chromiumCache': await clearChromiumCache(); break;
      case 'temp': clearOurTempFiles(); break;
      case 'downloads': clearDownloads(1); break;
      default:
        return { ok: false, freedBytes: 0, error: '这一类是你的数据，不能自动清理（请到对应页面手动删除）。' };
    }
    const after = categoryBytes(id);
    return { ok: true, freedBytes: Math.max(0, before - after) };
  } catch (e) {
    return { ok: false, freedBytes: 0, error: (e as Error).message };
  }
}

/** 一键清理全部"可清"分类 */
export async function clearAllCleanable(): Promise<{ ok: boolean; freedBytes: number }> {
  let freed = 0;
  for (const id of ['chromiumCache', 'temp', 'downloads'] as StorageCategoryId[]) {
    const r = await clearStorageCategory(id);
    freed += r.freedBytes;
  }
  return { ok: true, freedBytes: freed };
}

/** 清孤立快照（项目已删、备份还在） */
export function clearOrphanBackups(): { ok: boolean; cleanedCount: number; freedBytes: number } {
  const backupsDir = join(dataRoot(), 'backups');
  if (!existsSync(backupsDir)) return { ok: true, cleanedCount: 0, freedBytes: 0 };

  const valid = new Set<string>();
  for (const p of listProjects()) {
    valid.add(sanitizeProjectFolder(p.name));
    valid.add(sanitizeProjectFolder(p.fileName.replace(/\.bcproj$/i, '')));
  }
  valid.add('_general');

  let count = 0;
  let freed = 0;
  try {
    for (const e of readdirSync(backupsDir, { withFileTypes: true })) {
      const full = join(backupsDir, e.name);
      if (e.isDirectory()) {
        if (!valid.has(e.name)) {
          freed += getDirSize(full);
          try { rmSync(full, { recursive: true, force: true }); count += 1; } catch { /* 忽略 */ }
        }
      } else if (e.isFile() && e.name.endsWith('.bcproj')) {
        try { freed += statSync(full).size; unlinkSync(full); count += 1; } catch { /* 忽略 */ }
      }
    }
  } catch { /* 忽略 */ }
  return { ok: true, cleanedCount: count, freedBytes: freed };
}

// ---------------------------------------------------------------------------
// 启动自愈
// ---------------------------------------------------------------------------

/**
 * 启动时按配置做清理。**必须在 `app.setPath('userData', …)` 之后调用**
 * （否则 `session.clearCache()` 清的是默认 userData，不是我们的 data/user-data）。
 */
export async function runStartupCleanup(): Promise<void> {
  let cfg;
  try { cfg = readAppConfig(); } catch { return; }

  // ① 我们的临时文件（默认开：它本来就是"用完就该没"的东西，且旧版本从不清 → 顺带回收历史遗留）
  if (cfg.autoCleanTempOnStartup !== false) {
    try { clearOurTempFiles(); } catch { /* 忽略 */ }
  }
  if (cfg.autoCleanCacheOnStartup) {
    try { await clearChromiumCache(); } catch { /* 忽略 */ }
  }
  if (cfg.autoCleanOrphansOnStartup) {
    try { clearOrphanBackups(); } catch { /* 忽略 */ }
  }
}
