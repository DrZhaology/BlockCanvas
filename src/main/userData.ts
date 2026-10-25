import { app } from 'electron';
import { join } from 'node:path';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, rmSync, copyFileSync
} from 'node:fs';
import { portableBaseDir, resolveWritableDir } from './paths';
import { zipCreate, type ZipEntry } from './zip';
import { readManifestOnly, sceneHash, SCHEMA_VERSION } from './projectFile';

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

/** 已解析的 data 根目录（首次初始化时确定；之后保持不变，避免运行中路径漂移） */
let resolvedDataRoot: string | null = null;

export function dataRoot(): string {
  // 测试隔离：E2E / CI 可通过 BC_DATA_DIR 指向临时目录，绝不污染用户的真实 data/。
  // 仅在显式设置该环境变量时生效，正常使用（双击 exe / pnpm dev）完全不受影响。
  const override = process.env['BC_DATA_DIR'];
  if (override && override.trim()) return override.trim();
  if (resolvedDataRoot) return resolvedDataRoot;
  // 默认落在「便携目录 / data」；若该处不可写，initDataDirectories() 会改成用户级目录。
  resolvedDataRoot = join(portableBaseDir(), 'data');
  return resolvedDataRoot;
}

/**
 * 确定 data/ 的最终落点（跨平台安全版）：
 *   · 优先「程序所在目录 / data」= 真·绿色便携；
 *   · 若该处不可写（macOS 把 App 放进 /Applications、程序装在只读盘…），
 *     自动退到用户级目录（`<appData>/BlockCanvas/data`），保证任何平台都能正常跑起来。
 * 开发态 / BC_DATA_DIR 覆盖时行为与以前完全一致。
 */
function resolveDataRoot(): string {
  const override = process.env['BC_DATA_DIR'];
  if (override && override.trim()) {
    resolvedDataRoot = override.trim();
    return resolvedDataRoot;
  }
  resolvedDataRoot = resolveWritableDir('data');
  return resolvedDataRoot;
}

export function initDataDirectories(): { dataDir: string; extDir: string; projectsDir: string; backupsDir: string } {
  const dRoot = resolveDataRoot();
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

  // 启动自愈（清缓存 / 孤立快照 / 我们自己的临时文件）挪到了 main.ts：
  // 必须等 app.setPath('userData') 生效后再做，见 storage.ts 的 runStartupCleanup()。

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
  /** 配置结构版本（整数）。改结构时 +1，并在 migrateConfig() 里补一条升级分支。 */
  schemaVersion?: number;
  autoBackupInterval?: number;       // 毫秒，默认 60000 (1分钟)
  maxSnapshots?: number;             // 每个项目保留快照数量，默认 15
  maxBackupBytes?: number;           // 每个项目快照总体积上限，默认 200 MB
  autoRestoreSession?: boolean;       // 默认 true (类似 Notepad 原地恢复)
  autoCleanCacheOnStartup?: boolean; // 默认 false (开启后每次启动自动清理 Chromium 临时缓存)
  autoCleanOrphansOnStartup?: boolean; // 默认 true (启动时自动清理已删除项目的残留快照)
  autoCleanTempOnStartup?: boolean;   // 默认 true (启动时清理我们自己在系统 Temp 里留下的文件)
  usePortableTemp?: boolean;          // 默认 true (把运行时/内核临时目录也收进 <data>/tmp/system)
  lastCheckUpdate?: string;          // 上次检测更新的时间戳 ISO 字符串
  [key: string]: any;
}

/** 当前配置结构版本 */
const CONFIG_SCHEMA_VERSION = 2;

const DEFAULT_CONFIG: AppConfig = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  autoBackupInterval: 60000,
  maxSnapshots: 15,
  maxBackupBytes: 200 * 1024 * 1024,
  autoRestoreSession: true,
  autoCleanCacheOnStartup: false,
  autoCleanOrphansOnStartup: true,
  autoCleanTempOnStartup: true,
  usePortableTemp: true
};

/**
 * 配置结构升级：`config.json` 保持**人类可读的 JSON**（用户会手改），
 * 但必须有版本号，否则将来改结构没有迁移入口。
 * 返回 { cfg, changed }，changed=true 时调用方负责回写。
 */
function migrateConfig(raw: Record<string, any>): { cfg: AppConfig; changed: boolean } {
  let changed = false;
  const v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;

  // v1 → v2：补上快照体积预算
  if (v < 2) {
    if (raw.maxBackupBytes === undefined) raw.maxBackupBytes = 200 * 1024 * 1024;
    raw.schemaVersion = 2;
    changed = true;
  }
  // 未来的 v3 / v4 … 在这里继续往下加分支即可（旧文件逐级升上来）

  return { cfg: { ...DEFAULT_CONFIG, ...raw }, changed };
}

export function readAppConfig(): AppConfig {
  const cfgPath = join(dataRoot(), 'config.json');
  if (!existsSync(cfgPath)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, any>;
    const { cfg, changed } = migrateConfig(raw);
    if (changed) {
      // 升级后立刻回写，避免每次启动都重复迁移
      try { writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8'); } catch { /* 忽略 */ }
    }
    return cfg;
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

// ============ 会话记忆 ============
// 已迁到 src/main/session.ts（轻量索引 session.json + 按需草稿 data/session/<tabId>.bcproj）。
// 这里不再保留实现，避免出现"两份会话逻辑"。

// ============ 项目与备份管理 ============
/**
 * 项目类型（v0.4.5 第 14 批）。
 *
 * 用户要求：「不同的项目类型要单独标注，可以有这几种：网页项目、网站项目（对应后续的多网页管理，
 * 这一轮没让你做）、外部项目（不在 data/project），以及别的，所有的解释都在上方的小问号。」
 */
export type ProjectKind = 'page' | 'site' | 'external' | 'missing';

export interface ProjectFileInfo {
  fileName: string;
  filePath: string;
  name: string;
  size: number;
  updatedAt: string;
  elementCount?: number;
  previewText?: string;
  backupCount?: number; // 该项目专属的快照数量
  /** v0.4.5：来自 data/projects 以外（用户从别处导入的工程） */
  external?: boolean;
  /** v0.4.5：登记过但磁盘上已经不在了（被移动/删除），列表里置灰提示 */
  missing?: boolean;
  /** v0.4.5：项目类型（列表里单独标注） */
  kind?: ProjectKind;
  /** v0.4.5：页面数（多页工程 > 1；现在恒为 1，为下一轮的多页管理预留） */
  pageCount?: number;
}

/** 外部工程登记表（data/external-projects.json） */
export interface ExternalProjectEntry {
  path: string;
  name?: string;
  addedAt: string;
}

function externalRegistryPath(): string {
  return join(dataRoot(), 'external-projects.json');
}

const normPath = (p: string) => String(p || '').replace(/[\\/]+/g, '/').toLowerCase();

export function readExternalRegistry(): ExternalProjectEntry[] {
  try {
    const p = externalRegistryPath();
    if (!existsSync(p)) return [];
    const arr = JSON.parse(readFileSync(p, 'utf8'));
    if (!Array.isArray(arr)) return [];
    return arr.filter((e: ExternalProjectEntry) => e && typeof e.path === 'string' && e.path.trim());
  } catch {
    return [];
  }
}

function writeExternalRegistry(list: ExternalProjectEntry[]): void {
  try {
    mkdirSync(dataRoot(), { recursive: true });
    writeFileSync(externalRegistryPath(), JSON.stringify(list, null, 2), 'utf8');
  } catch { /* 登记失败不影响打开工程 */ }
}

/** 把一个位于 data/projects 之外的工程登记进列表（重复登记自动去重） */
export function registerExternalProject(filePath: string, name?: string): void {
  const p = String(filePath || '').trim();
  if (!p) return;
  const defaultDir = join(dataRoot(), 'projects');
  if (normPath(p).startsWith(normPath(defaultDir) + '/')) return; // 默认目录里的不用登记
  const list = readExternalRegistry();
  const hit = list.find((e) => normPath(e.path) === normPath(p));
  if (hit) {
    if (name) hit.name = name;
  } else {
    list.push({ path: p, name, addedAt: new Date().toISOString() });
  }
  writeExternalRegistry(list);
}

/** 从列表里移除一个外部工程（不动磁盘文件） */
export function forgetExternalProject(filePath: string): boolean {
  const list = readExternalRegistry();
  const next = list.filter((e) => normPath(e.path) !== normPath(filePath));
  if (next.length === list.length) return false;
  writeExternalRegistry(next);
  return true;
}

export function sanitizeProjectFolder(name: string): string {
  return (name || '').trim().replace(/[\\/:*?"<>|]+/g, '_') || '_general';
}

/**
 * 从 manifest 推断项目类型与页面数。
 *
 * 现在只有「网页项目」（单页）一种；多页工程（网站项目）是下一轮的事，
 * 但这里先把判定写出来 —— 只要 manifest.meta.pageCount > 1 就自动标成「网站项目」，
 * 将来实现多页时**列表侧不用再改**。
 */
function kindOfManifest(m: { meta?: Record<string, unknown> } | null | undefined): { kind: ProjectKind; pageCount: number } {
  const raw = Number((m?.meta as Record<string, unknown> | undefined)?.pageCount ?? 1);
  const pageCount = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  return { kind: pageCount > 1 ? 'site' : 'page', pageCount };
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
      // 只读 manifest（zip 容器只需解压 manifest.json 一个条目，不解 scene）
      const m = readManifestOnly(full);
      if (!m.ok || !m.manifest) continue;
      const projName = m.manifest.name || f.name.replace(/\.bcproj$/i, '');
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
        elementCount: m.manifest.meta?.elementCount ?? 0,
        previewText: m.manifest.meta?.description || '',
        backupCount,
        ...kindOfManifest(m.manifest)
      });
    } catch {}
  }

  // v0.4.5：把"外部工程"（用户从别处导入的）也并进列表。
  // 文件被移动/删掉的保留一条 missing 记录，让用户知道"它去哪了"，
  // 而不是无声消失、以为工程丢了。
  for (const e of readExternalRegistry()) {
    const full = e.path;
    const base = full.replace(/^.*[\\/]/, '');
    if (!existsSync(full)) {
      list.push({
        fileName: base,
        filePath: full,
        name: e.name || base.replace(/\.bcproj$/i, ''),
        size: 0,
        updatedAt: e.addedAt || new Date(0).toISOString(),
        elementCount: 0,
        previewText: '文件已不在原位置（可能被移动或删除）',
        backupCount: 0,
        external: true,
        missing: true,
        kind: 'missing',
        pageCount: 1
      });
      continue;
    }
    try {
      const stat = statSync(full);
      const m = readManifestOnly(full);
      const projName = (m.ok && m.manifest?.name) || e.name || base.replace(/\.bcproj$/i, '');
      const backupDir = join(dataRoot(), 'backups', sanitizeProjectFolder(projName));
      const backupCount = existsSync(backupDir)
        ? readdirSync(backupDir).filter((x) => x.endsWith('.bcproj')).length
        : 0;
      list.push({
        fileName: base,
        filePath: full,
        name: projName,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        elementCount: (m.ok && m.manifest?.meta?.elementCount) || 0,
        previewText: (m.ok && m.manifest?.meta?.description) || '',
        backupCount,
        external: true,
        // 外部工程即使有多个页面也优先标「外部项目」—— 位置信息对用户更重要
        kind: 'external',
        pageCount: m.ok && m.manifest ? kindOfManifest(m.manifest).pageCount : 1
      });
    } catch { /* 单个外部工程读不出来就跳过 */ }
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
      const m = readManifestOnly(full);
      if (!m.ok || !m.manifest) continue;
      list.push({
        fileName: f.name,
        filePath: full,
        name: f.name === 'autosave.bcproj' ? '自动保存草稿 (最新)' : (m.manifest.name || f.name),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        elementCount: m.manifest.meta?.elementCount ?? 0
      });
    } catch {}
  }
  return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * 保存项目专属快照（v2 ZIP 容器）。
 *
 * 相对旧实现的三个关键优化：
 *  1. **内容没变就不写**（内存里记住上次的场景哈希）—— 定时器照跑，磁盘不动；
 *  2. **一次压缩、两处落盘**：`zipCreate()` 只做一次，同一个 Buffer 写 `autosave` 与 `snapshot`，
 *     不再"两份全量各自序列化一遍"；
 *  3. **数量 + 体积双预算**（`maxSnapshots` 与 `maxBackupBytes`），防止某个大工程把磁盘吃满。
 *
 * 返回值：本次写入的时间戳；**内容未变时返回空串**（调用方无需区分，仅用于测试断言）。
 */
const lastSnapshotHash = new Map<string, string>();

export function saveProjectSnapshotFile(scene: any, projectName?: string, isAuto = true): string {
  const folderName = sanitizeProjectFolder(projectName || '_general');
  const bDir = join(dataRoot(), 'backups', folderName);
  if (!existsSync(bDir)) mkdirSync(bDir, { recursive: true });

  // 1. 内容去重：和上次一模一样就不写盘
  const hash = sceneHash(scene);
  if (lastSnapshotHash.get(folderName) === hash) {
    // 仍然按配置清理一次（避免"没变化 → 不清理 → 超额文件永远留着"）
    const cfg0 = readAppConfig();
    cleanOldProjectSnapshots(folderName, typeof cfg0.maxSnapshots === 'number' ? cfg0.maxSnapshots : 15, cfg0.maxBackupBytes);
    return '';
  }
  lastSnapshotHash.set(folderName, hash);

  const name = projectName || (isAuto ? '自动保存草稿' : '历史快照');
  const now = new Date();
  const updatedAt = now.toISOString();

  // 2. 生成**一次**容器内容，然后复用同一个 Buffer 写两处
  const entries: ZipEntry[] = [
    {
      name: 'manifest.json',
      data: Buffer.from(JSON.stringify({
        format: 'BlockCanvas-Project',
        schemaVersion: SCHEMA_VERSION,
        name,
        createdAt: updatedAt,
        updatedAt,
        app: { name: 'BlockCanvas', version: '' },
        meta: { elementCount: countNodes(scene?.root) },
        sections: { scene: 'scene.json' },
        assets: [],
        version: `${SCHEMA_VERSION}.0.0`
      }, null, 2), 'utf8')
    },
    { name: 'scene.json', data: Buffer.from(JSON.stringify(scene), 'utf8') }
  ];
  const zipBuf = zipCreate(entries);

  // 最新快照（崩溃恢复用）
  const latestFile = join(bDir, 'autosave.bcproj');
  writeFileSync(latestFile, zipBuf);

  // 时间戳轮转快照
  const timeTag = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const snapFile = join(bDir, `snapshot-${timeTag}.bcproj`);
  writeFileSync(snapFile, zipBuf);

  // 3. 按配置清理该项目的超额快照（数量 + 体积双预算）
  const cfg = readAppConfig();
  cleanOldProjectSnapshots(folderName, typeof cfg.maxSnapshots === 'number' ? cfg.maxSnapshots : 15, cfg.maxBackupBytes);

  return updatedAt;
}

/**
 * 清理超额快照：**数量**上限 + **体积**上限（两个都要满足）。
 * 体积上限默认 200 MB/项目（可在 config.json 里用 maxBackupBytes 覆盖）。
 */
export function cleanOldProjectSnapshots(folderName: string, maxLimit: number, maxBytes?: number) {
  const bDir = join(dataRoot(), 'backups', folderName);
  if (!existsSync(bDir)) return;
  const budget = typeof maxBytes === 'number' && maxBytes > 0 ? maxBytes : 200 * 1024 * 1024;
  try {
    const snaps = readdirSync(bDir)
      .filter((f) => f.startsWith('snapshot-') && f.endsWith('.bcproj'))
      .sort();                                    // 时间戳命名 → 字典序即时间序
    // ① 数量预算
    const over = snaps.length - maxLimit;
    const toDelete = over > 0 ? snaps.slice(0, over) : [];
    for (const old of toDelete) {
      try { unlinkSync(join(bDir, old)); } catch {}
    }
    // ② 体积预算：从最老的开始删，直到总量达标（至少保留 1 份）
    let kept = snaps.slice(toDelete.length);
    let total = 0;
    const sizes = new Map<string, number>();
    for (const f of kept) {
      try { const s = statSync(join(bDir, f)).size; sizes.set(f, s); total += s; } catch { /* 忽略 */ }
    }
    while (total > budget && kept.length > 1) {
      const oldest = kept.shift()!;
      try { unlinkSync(join(bDir, oldest)); } catch {}
      total -= sizes.get(oldest) || 0;
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

function countNodes(node: any): number {
  if (!node) return 0;
  let count = 1;
  if (Array.isArray(node.children)) {
    for (const c of node.children) count += countNodes(c);
  }
  return count;
}

/**
 * 从「内置扩展源目录」同步内置扩展到运行时 data/extensions/
 * 同名 id 覆盖，用户第三方扩展保留不动。
 *
 * v0.4.5 目录统一：源码里的扩展**只放** `builtin-extensions/`（仓库根目录不再有 extensions/），
 * 运行时**只读** data/extensions/。这里负责把内置的那份种进去，用户装的那份不受影响。
 *   · 打包后：随包分发的 resources/builtin-extensions
 *   · 开发态：仓库根的 builtin-extensions
 */
function seedExtensionsFromZip(extDir: string) {
  try {
    const seedExtDir = app.isPackaged
      ? join(process.resourcesPath, 'builtin-extensions')
      : join(app.getAppPath(), 'builtin-extensions');
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
