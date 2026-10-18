import { app } from 'electron';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, unlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { zipCreate, zipReadEntry, zipNames, looksLikeZip, type ZipEntry } from './zip';

// ============================================================================
// BlockCanvas · 工程文件容器（.bcproj）
// ----------------------------------------------------------------------------
// 历史：v1 = 一整坨美化 JSON。缺点（见 docs/技术选型-工程文件格式.md）：
//   · 缩进白占 ~52% 体积；· 没有随机访问（读一个元素也要 parse 全树）；
//   · 写永远全量；· 图片只能 base64；· 没有版本协商入口。
//
// v2 = **ZIP 容器**（和 .docx / .xlsx / .sketch / .fig 一个套路）：
//
//   demo.bcproj  (zip)
//   ├─ manifest.json   ← **第一个条目**：格式/版本/名称/元素数/sections/assets 清单
//   ├─ scene.json      ← 紧凑 JSON（解压即读、可 diff、可手改）
//   ├─ assets/<sha1>.<ext>   ← 二进制资源**原样**存（不再 base64）—— 预留
//   └─ blocks/main.json      ← 预留：Scratch 式积木程序（后续功能）
//
// 设计要点（为"后续扩展"服务）：
//   1. **manifest 先写、且小** → 只读它能列出工程（`readManifestOnly`），不必解 scene；
//   2. **schemaVersion 是整数**，且载入时校验 → 将来任何结构变更都有迁移入口；
//   3. **sections 是"清单"而不是"硬编码"** → 老程序读新文件时，
//      遇到不认识的 section（比如 blocks）直接忽略，不会崩；
//   4. 未知条目一律**原样保留**（`readProject` 会带回 extraEntries）→
//      老版本程序另存新版本文件时不会把新功能的数据吃掉。
//
// 兼容：读入时嗅探前 4 字节 `PK\x03\x04` → zip 走新路径，否则按 v1 JSON 解析。
//       **老文件永远能打开**；`migrateProjectFile()` 负责把它们原地升级成 v2。
// ============================================================================

export const PROJECT_FORMAT = 'BlockCanvas-Project';
/** 1 = 纯 JSON（旧）；2 = ZIP 容器（现）。整数，只增不减。 */
export const SCHEMA_VERSION = 2;

/** manifest 在容器里的固定路径（必须第一个写入） */
const MANIFEST = 'manifest.json';
/** 默认场景载荷路径 */
const SCENE = 'scene.json';

export type ContainerKind = 'zip' | 'json';

export interface ProjectAssetRef {
  /** 容器内路径，如 assets/ab12….png */
  path: string;
  /** 原始文件名（给人看的） */
  name: string;
  mime: string;
  bytes: number;
}

export interface ProjectMeta {
  elementCount?: number;
  description?: string;
  [k: string]: unknown;
}

/** manifest.json 的形状（容器里那份） */
export interface ProjectManifest {
  format: typeof PROJECT_FORMAT;
  schemaVersion: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  app: { name: string; version: string };
  meta: ProjectMeta;
  /** 载荷清单：section 名 → 容器内相对路径（不认识的 section 请忽略） */
  sections: Record<string, string>;
  /** 嵌入式二进制资源清单（现在默认空：图片仍走路径；将来"单文件工程"用它） */
  assets: ProjectAssetRef[];
  /** v1 兼容字段：老代码会读 payload.version（字符串） */
  version?: string;
}

/** `readProject()` 的返回：manifest 展开 + scene + 附加载荷 */
export interface ProjectPayload extends ProjectManifest {
  scene: unknown;
  /** 除 scene 外的其它 section（如 blocks），按名字取 */
  extraSections?: Record<string, unknown>;
  /** 本次读取来自哪种容器 */
  container?: ContainerKind;
}

export interface ReadResult {
  ok: boolean;
  payload?: ProjectPayload;
  container?: ContainerKind;
  error?: string;
}

export interface WriteProjectInput {
  name: string;
  scene: unknown;
  meta?: ProjectMeta;
  createdAt?: string;
  /** 附加 JSON 载荷：section 名 → 内容（如 { blocks: {...} }）。后续功能用，老程序会忽略。 */
  sections?: Record<string, unknown>;
  /** 嵌入式二进制资源 */
  assets?: { name: string; mime?: string; data: Buffer }[];
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function appInfo(): { name: string; version: string } {
  let version = '0.0.0';
  try { version = app.getVersion(); } catch { /* 未 ready 时忽略 */ }
  return { name: 'BlockCanvas', version };
}

function sha1Hex(buf: Buffer | string): string {
  return createHash('sha1').update(buf).digest('hex');
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    avif: 'image/avif', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf',
    json: 'application/json', txt: 'text/plain', md: 'text/markdown'
  };
  return map[ext] || 'application/octet-stream';
}

/** 原子写：先写 .tmp 再 rename（Windows / POSIX 都能"要么旧、要么新"） */
function atomicWrite(path: string, data: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* 忽略 */ }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 嗅探 / 只读 manifest
// ---------------------------------------------------------------------------

/** 这个文件是不是 v2 ZIP 容器 */
export function isZipContainer(buf: Buffer): boolean {
  return looksLikeZip(buf);
}

/** 探测文件容器类型（读前 4 字节，不做完整解析） */
export function sniffContainer(path: string): ContainerKind | 'unknown' {
  try {
    const fd = readFileSync(path);
    if (fd.length >= 4) return isZipContainer(fd) ? 'zip' : 'json';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface ManifestReadResult {
  ok: boolean;
  manifest?: ProjectManifest;
  container?: ContainerKind;
  /** 文件里实际声明的 schemaVersion（老 JSON 视为 1） */
  schemaVersion?: number;
  error?: string;
}

/**
 * **只读 manifest**（列表页 / 统计用，不解 scene）。
 * zip：只解压 manifest.json 一个条目；老 JSON：只能整份解析（并就地归一化）。
 */
export function readManifestOnly(path: string): ManifestReadResult {
  try {
    if (!existsSync(path)) return { ok: false, error: '文件不存在' };
    const buf = readFileSync(path);
    if (isZipContainer(buf)) {
      const raw = zipReadEntry(buf, MANIFEST);
      if (!raw) {
        // 容忍：没有 manifest 但至少有 scene.json 的容器
        const sceneRaw = zipReadEntry(buf, SCENE);
        if (!sceneRaw) return { ok: false, error: '容器里没有 manifest.json' };
        return {
          ok: true, container: 'zip', schemaVersion: 2,
          manifest: normalizeManifest({}, SCENE)
        };
      }
      const parsed = JSON.parse(raw.toString('utf8')) as Partial<ProjectManifest>;
      return { ok: true, container: 'zip', schemaVersion: parsed.schemaVersion ?? 2, manifest: normalizeManifest(parsed, SCENE) };
    }
    // 旧 JSON
    const parsed = JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
    const m = normalizeManifest(parsed, '<inline>');
    return { ok: true, container: 'json', schemaVersion: 1, manifest: m };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 把任意来源的 manifest 补全成规范形状（缺字段不报错，尽量给默认值） */
function normalizeManifest(src: Partial<ProjectManifest> & Record<string, unknown>, scenePath: string): ProjectManifest {
  const sections: Record<string, string> = { ...(src.sections || {}) };
  if (!sections.scene) sections.scene = scenePath;
  return {
    format: PROJECT_FORMAT,
    schemaVersion: typeof src.schemaVersion === 'number' ? src.schemaVersion : 1,
    name: String(src.name || '未命名网页'),
    createdAt: String(src.createdAt || src.updatedAt || nowIso()),
    updatedAt: String(src.updatedAt || nowIso()),
    app: (src.app as ProjectManifest['app']) || { name: 'BlockCanvas', version: '' },
    meta: (src.meta as ProjectMeta) || {},
    sections,
    assets: Array.isArray(src.assets) ? (src.assets as ProjectAssetRef[]) : [],
    version: typeof src.version === 'string' ? src.version : '2.0.0'
  };
}

// ---------------------------------------------------------------------------
// 读
// ---------------------------------------------------------------------------

/** 完整读取工程（zip 或 v1 JSON 都能读）。 */
export function readProject(path: string): ReadResult {
  try {
    if (!existsSync(path)) return { ok: false, error: '文件不存在' };
    const buf = readFileSync(path);

    if (isZipContainer(buf)) {
      const names = zipNames(buf);
      const manifestRaw = zipReadEntry(buf, MANIFEST);
      let manifest: ProjectManifest;
      if (manifestRaw) {
        manifest = normalizeManifest(JSON.parse(manifestRaw.toString('utf8')), SCENE);
      } else {
        manifest = normalizeManifest({}, names.includes(SCENE) ? SCENE : names.find((n) => n.endsWith('.json')) || SCENE);
      }

      const scenePath = manifest.sections.scene || SCENE;
      const sceneRaw = zipReadEntry(buf, scenePath);
      if (!sceneRaw) return { ok: false, error: `容器里找不到场景数据（${scenePath}）` };
      const scene = JSON.parse(sceneRaw.toString('utf8'));

      // 其它 section：认识的（现在是 blocks）读出来；不认识的忽略但**不丢**
      const extraSections: Record<string, unknown> = {};
      for (const [key, rel] of Object.entries(manifest.sections)) {
        if (key === 'scene') continue;
        const raw = zipReadEntry(buf, rel);
        if (!raw) continue;
        try { extraSections[key] = JSON.parse(raw.toString('utf8')); } catch { /* 非 JSON 的 section 忽略 */ }
      }

      const payload: ProjectPayload = { ...manifest, scene, extraSections, container: 'zip' };
      return { ok: true, payload, container: 'zip' };
    }

    // —— v1：纯 JSON ——
    const raw = JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
    const scene = raw.scene;
    if (!scene || typeof scene !== 'object') {
      return { ok: false, error: '文件不是有效的 BlockCanvas 工程文件（缺少 scene）' };
    }
    const manifest = normalizeManifest(raw as Partial<ProjectManifest>, '<inline>');
    const payload: ProjectPayload = { ...manifest, scene, container: 'json' };
    return { ok: true, payload, container: 'json' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 读取容器里的二进制资源（现在默认没有，留给"单文件工程"） */
export function readAsset(path: string, assetPath: string): Buffer | null {
  try {
    const buf = readFileSync(path);
    if (!isZipContainer(buf)) return null;
    return zipReadEntry(buf, assetPath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 写
// ---------------------------------------------------------------------------

export interface WriteResult {
  ok: boolean;
  bytes?: number;
  payload?: ProjectPayload;
  error?: string;
}

/**
 * 写工程（**始终写 v2 ZIP 容器**，原子替换）。
 * · 已存在的文件会**继承 createdAt**（不让"创建时间"每次保存都变）；
 * · 附带的 assets 按内容哈希命名 → 天然去重。
 */
export function writeProject(path: string, input: WriteProjectInput): WriteResult {
  try {
    let createdAt = input.createdAt;
    if (!createdAt && existsSync(path)) {
      const prev = readManifestOnly(path);
      if (prev.ok && prev.manifest?.createdAt) createdAt = prev.manifest.createdAt;
    }

    const entries: ZipEntry[] = [];
    const assetRefs: ProjectAssetRef[] = [];

    // 1) 资源（先算好，manifest 要引用它们）
    for (const a of input.assets || []) {
      const hash = sha1Hex(a.data).slice(0, 16);
      const ext = (a.name.split('.').pop() || 'bin').toLowerCase();
      const rel = `assets/${hash}.${ext}`;
      entries.push({ name: rel, data: a.data });
      assetRefs.push({ path: rel, name: a.name, mime: a.mime || guessMime(a.name), bytes: a.data.length });
    }

    // 2) 附加 section（如 blocks）
    const sections: Record<string, string> = { scene: SCENE };
    for (const [key, value] of Object.entries(input.sections || {})) {
      if (!key || key === 'scene') continue;
      const rel = `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      entries.push({ name: rel, data: Buffer.from(JSON.stringify(value), 'utf8') });
      sections[key] = rel;
    }

    // 3) manifest（必须**第一个**写：只读它就能列出工程）
    const manifest: ProjectManifest = {
      format: PROJECT_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      name: input.name || '未命名网页',
      createdAt: createdAt || nowIso(),
      updatedAt: nowIso(),
      app: appInfo(),
      meta: input.meta || {},
      sections,
      assets: assetRefs,
      version: `${SCHEMA_VERSION}.0.0`   // v1 兼容字段
    };
    entries.unshift({ name: MANIFEST, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });

    // 4) 场景（**紧凑 JSON**，不美化：省掉 ~48% 体积）
    entries.push({ name: SCENE, data: Buffer.from(JSON.stringify(input.scene), 'utf8') });

    const zipBuf = zipCreate(entries);
    atomicWrite(path, zipBuf);

    const payload: ProjectPayload = { ...manifest, scene: input.scene, extraSections: input.sections, container: 'zip' };
    return { ok: true, bytes: zipBuf.length, payload };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 给外部用：算一份内容哈希（快照去重） */
export function sceneHash(scene: unknown): string {
  return sha1Hex(JSON.stringify(scene) || '');
}

// ---------------------------------------------------------------------------
// 迁移：v1 纯 JSON → v2 ZIP 容器
// ---------------------------------------------------------------------------
//
// ⚠ 这段代码**长期保留**：用户机器上可能永远躺着老文件（外部拷来的、备份里的），
//   每次启动扫一遍是幂等的；已经是 v2 的文件直接跳过，零成本。

export type MigrateStatus = 'migrated' | 'already' | 'skipped' | 'failed';

export interface MigrateResult {
  status: MigrateStatus;
  from?: ContainerKind;
  error?: string;
}

/**
 * 把单个工程文件升级到当前 schemaVersion。
 * 流程：读 → 解析 → 写 `.tmp` → **读回校验**（结构 + 场景深比较）→ 原子替换。
 * 任何一步失败都**保留原文件不动**，返回 failed。
 */
export function migrateProjectFile(path: string): MigrateResult {
  try {
    if (!existsSync(path)) return { status: 'skipped', error: '文件不存在' };
    const buf = readFileSync(path);

    if (isZipContainer(buf)) {
      // 已是容器：检查 schemaVersion 是否落后（未来 v3 时在这里加升级分支）
      const m = readManifestOnly(path);
      if (m.ok && (m.schemaVersion ?? 2) >= SCHEMA_VERSION) return { status: 'already' };
      // 版本落后但还没有升级逻辑 → 先原样不动，等实现
      return { status: 'skipped', error: `容器 schemaVersion=${m.schemaVersion} 暂无升级路径` };
    }

    // —— v1 JSON → v2 ——
    const legacy = JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
    if (!legacy || typeof legacy.scene !== 'object' || legacy.scene === null) {
      return { status: 'skipped', error: '不是有效的工程文件（缺少 scene）' };
    }

    const name = String(legacy.name || basename(path).replace(/\.bcproj$/i, ''));
    const createdAt = String(legacy.createdAt || legacy.updatedAt || '');
    const meta = (legacy.meta as ProjectMeta) || {};

    const tmp = path + '.migrate.tmp';
    try { unlinkSync(tmp); } catch { /* 忽略 */ }

    const w = writeProject(tmp, { name, scene: legacy.scene, meta, createdAt: createdAt || undefined });
    if (!w.ok) {
      try { unlinkSync(tmp); } catch { /* 忽略 */ }
      return { status: 'failed', error: '写入容器失败：' + w.error };
    }

    // —— 读回校验：必须能解析，且场景内容一致 ——
    const back = readProject(tmp);
    if (!back.ok || !back.payload) {
      try { unlinkSync(tmp); } catch { /* 忽略 */ }
      return { status: 'failed', error: '读回校验失败：' + back.error };
    }
    const same = JSON.stringify(back.payload.scene) === JSON.stringify(legacy.scene);
    if (!same) {
      try { unlinkSync(tmp); } catch { /* 忽略 */ }
      return { status: 'failed', error: '读回校验失败：场景内容不一致' };
    }

    // —— 原子替换（先留一份 .v1.bak，迁移出问题时用户还能救）——
    try { renameSync(path, path + '.v1.bak'); } catch { /* 备份失败也继续 */ }
    try {
      renameSync(tmp, path);
    } catch (e) {
      // 替换失败：把备份还原回去，保证原文件可用
      try { if (!existsSync(path)) renameSync(path + '.v1.bak', path); } catch { /* 忽略 */ }
      return { status: 'failed', error: '替换失败：' + (e as Error).message };
    }
    return { status: 'migrated', from: 'json' };
  } catch (e) {
    return { status: 'failed', error: (e as Error).message };
  }
}

export interface MigrateAllStats {
  scanned: number;
  migrated: number;
  already: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * 只读**前 4 字节**判断这是不是老格式（纯 JSON）。
 * 为什么要它：迁移扫描绝大多数时候遇到的是已经是容器的文件，
 * 为了嗅探一下就 `readFileSync` 整份大工程是浪费（几十 MB 的工程会卡住主进程）。
 */
export function isLegacyJsonAt(path: string): boolean {
  let fd = -1;
  try {
    fd = openSync(path, 'r');
    const head = Buffer.alloc(4);
    const n = readSync(fd, head, 0, 4, 0);
    if (n < 4) return false;                                  // 空文件 / 太短：交给 migrateProjectFile 判 skipped
    return !(head[0] === 0x50 && head[1] === 0x4b);            // PK = 容器
  } catch {
    return false;
  } finally {
    if (fd >= 0) { try { closeSync(fd); } catch { /* 忽略 */ } }
  }
}

/** 收集一批目录下所有"待检查"的工程文件（绝对路径） */
function collectProjectFiles(dirs: string[]): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries: { name: string; isDir: boolean }[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    } catch { continue; }
    for (const e of entries) {
      if (e.isDir) continue;
      if (!/\.bcproj$/i.test(e.name)) continue;
      if (/\.(bak|tmp)$/i.test(e.name)) continue;
      out.push(join(dir, e.name));
    }
  }
  return out;
}

function tally(stats: MigrateAllStats, path: string, r: MigrateResult): void {
  if (r.status === 'migrated') stats.migrated += 1;
  else if (r.status === 'already') stats.already += 1;
  else if (r.status === 'skipped') stats.skipped += 1;
  else { stats.failed += 1; if (stats.errors.length < 10) stats.errors.push(`${basename(path)}: ${r.error}`); }
}

/** 扫描一批目录下的 .bcproj，把老格式升级成容器（幂等，可重复跑）。**同步版**：探针用。 */
export function migrateProjectFilesIn(dirs: string[]): MigrateAllStats {
  const stats: MigrateAllStats = { scanned: 0, migrated: 0, already: 0, skipped: 0, failed: 0, errors: [] };
  for (const path of collectProjectFiles(dirs)) {
    stats.scanned += 1;
    // 已是容器的：只看 4 个字节就跳过（不读整份文件）
    if (!isLegacyJsonAt(path)) { stats.already += 1; continue; }
    tally(stats, path, migrateProjectFile(path));
  }
  return stats;
}

/**
 * **异步分片版**：与同步版结果完全一致，但每处理一个文件就让出一次事件循环。
 *
 * 为什么必须分片：启动时后台迁移是"顺手做的事"，不能把主进程占住 ——
 * 一旦同步跑满，Chromium 的输入事件（悬停 / 点击）在那一瞬间会丢，
 * 表现为"鼠标明明在上面，悬停提示却不弹"（踩过一次，被表格探针逮到）。
 */
export async function migrateProjectFilesInAsync(
  dirs: string[],
  onProgress?: (done: number, total: number, stats: MigrateAllStats) => void
): Promise<MigrateAllStats> {
  const stats: MigrateAllStats = { scanned: 0, migrated: 0, already: 0, skipped: 0, failed: 0, errors: [] };
  const files = collectProjectFiles(dirs);
  for (let i = 0; i < files.length; i += 1) {
    const path = files[i];
    stats.scanned += 1;
    if (!isLegacyJsonAt(path)) stats.already += 1;
    else tally(stats, path, migrateProjectFile(path));
    onProgress?.(i + 1, files.length, stats);
    // 每 8 个文件多歇 30ms：让主进程喘口气，输入事件不受影响
    await new Promise<void>((r) => setTimeout(r, (i % 8 === 7) ? 30 : 0));
  }
  return stats;
}

/** 扫 data/projects 与 data/backups/<项目>/ 下的全部工程文件（同步版） */
export function migrateAllProjectFiles(projectsDir: string, backupsDir: string): MigrateAllStats {
  return migrateProjectFilesIn(projectDirs(projectsDir, backupsDir));
}

/** 同上的**异步分片版**（启动时后台用这个） */
export async function migrateAllProjectFilesAsync(
  projectsDir: string,
  backupsDir: string,
  onProgress?: (done: number, total: number, stats: MigrateAllStats) => void
): Promise<MigrateAllStats> {
  return migrateProjectFilesInAsync(projectDirs(projectsDir, backupsDir), onProgress);
}

/** data/projects + 每个项目的快照目录 */
function projectDirs(projectsDir: string, backupsDir: string): string[] {
  const dirs: string[] = [projectsDir];
  if (existsSync(backupsDir)) {
    try {
      for (const e of readdirSync(backupsDir, { withFileTypes: true })) {
        if (e.isDirectory()) dirs.push(join(backupsDir, e.name));
      }
    } catch { /* 忽略 */ }
  }
  return dirs;
}

/** 清理迁移过程可能留下的 .v1.bak / .tmp（可选，默认保留 .v1.bak 给用户兜底） */
export function cleanupMigrationTemp(dir: string): number {
  let n = 0;
  if (!existsSync(dir)) return 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      if (!/\.(migrate\.tmp)$/i.test(e.name)) continue;
      try { unlinkSync(join(dir, e.name)); n += 1; } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
  return n;
}
