// ============================================================================
// BlockCanvas · 工程素材（v0.4.5）
// ----------------------------------------------------------------------------
// 解决的问题：以前元素里引用本地图片写的是 `bc-img://file/<绝对路径>`，
// 换台机器（或把工程换目录）打开就丢图 —— 因为那只指向"你电脑上的某个文件"。
//
// 现在的做法：
//   保存 → 扫一遍场景，把所有 bc-img://file/xxx 指向的文件读进来，
//          按内容 sha1 命名塞进 .bcproj 的 assets/，同时把引用改写成
//          `bc-img://asset/<hash>.<ext>`（容器内引用，与机器无关）。
//   打开 → 把 assets/ 里的资源解到 data/cache/assets/，协议直接从那里服务。
//
// 为什么不改写文件名/不建注册表：内容哈希天然去重，同一张图被十个元素引用也只存一份；
// 协议按 hash 取文件，不需要知道它原来叫什么、在哪。
// ============================================================================
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { basename, extname, join } from 'path';
import { dataRoot } from './userData';
import { readAsset, type ProjectManifest } from './projectFile';

/** 解出来的素材缓存目录 */
export function assetCacheDir(): string {
  const dir = join(dataRoot(), 'cache', 'assets');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** 容器内引用前缀（写进场景的形式） */
const ASSET_PREFIX = 'bc-img://asset/';
/** 本地文件引用（扫描源） */
const FILE_REF_RE = /bc-img:\/\/file\/([^"'\\\s)]+)/g;

export interface CollectResult {
  /** 改写后的场景（引用已换成 bc-img://asset/...） */
  scene: unknown;
  /** 需要写进容器的二进制 */
  assets: { name: string; data: Buffer; mime?: string }[];
  /** 引用过但文件已经不在的路径（保存时提示用） */
  missing: string[];
  /** 被收集的资源数 */
  count: number;
}

function mimeOfName(name: string): string {
  const ext = extname(name).replace('.', '').toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    m4v: 'video/mp4', ogv: 'video/ogg', ogg: 'video/ogg', mp3: 'audio/mpeg',
    wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4'
  };
  return map[ext] ?? 'application/octet-stream';
}

/** 把素材写进缓存（已存在就跳过：内容哈希即文件名，天然幂等） */
function writeCache(name: string, data: Buffer): void {
  try {
    const target = join(assetCacheDir(), name.replace(/^assets\//, ''));
    if (existsSync(target)) return;
    writeFileSync(target, data);
  } catch { /* 缓存写失败不影响保存 */ }
}

/**
 * 扫描场景里所有 `bc-img://file/...` 引用，读文件、算哈希、写缓存，并返回改写后的场景。
 * 用"字符串化再解析"的方式做替换：场景里引用可能出现在 style / 伪类 / 任意文本里，
 * 逐个属性走容易漏，直接对 JSON 文本替换最稳。
 */
export function collectSceneAssets(scene: unknown): CollectResult {
  const assets: { name: string; data: Buffer; mime?: string }[] = [];
  const missing: string[] = [];
  const map = new Map<string, string>(); // encodedPath -> 容器内哈希名
  let json = '';
  try {
    json = JSON.stringify(scene ?? null);
  } catch {
    return { scene, assets, missing, count: 0 };
  }

  for (const m of json.matchAll(FILE_REF_RE)) {
    const encoded = m[1];
    if (map.has(encoded)) continue;
    let abs = '';
    try { abs = decodeURIComponent(encoded); } catch { abs = encoded; }
    if (!abs || !existsSync(abs)) {
      missing.push(abs || encoded);
      map.set(encoded, '');   // 标记为"已知缺失"，避免重复统计
      continue;
    }
    try {
      const data = readFileSync(abs);
      const hash = createHash('sha1').update(data).digest('hex').slice(0, 16);
      const ext = (extname(abs).replace('.', '') || 'bin').toLowerCase();
      const name = `${hash}.${ext}`;
      map.set(encoded, name);
      writeCache(name, data);
      assets.push({ name: basename(abs), data, mime: mimeOfName(abs) });
    } catch {
      missing.push(abs);
      map.set(encoded, '');
    }
  }

  // 只替换收集成功的（缺失的保持原样，用户还能看到"图挂了"而不是静默消失）
  let rewritten = json;
  for (const [encoded, name] of map) {
    if (!name) continue;
    rewritten = rewritten.split(`bc-img://file/${encoded}`).join(`${ASSET_PREFIX}${name}`);
  }

  let nextScene: unknown = scene;
  if (rewritten !== json) {
    try { nextScene = JSON.parse(rewritten); } catch { nextScene = scene; }
  }
  return { scene: nextScene, assets, missing, count: assets.length };
}

/**
 * 打开工程时把容器里的 assets/ 解到缓存目录，让 `bc-img://asset/...` 能被协议读到。
 * 已存在的跳过（内容哈希 = 幂等）。
 */
export function extractProjectAssets(projectPath: string, manifest?: ProjectManifest | null): number {
  const list = manifest?.assets ?? [];
  if (list.length === 0) return 0;
  const dir = assetCacheDir();
  let n = 0;
  for (const a of list) {
    const name = String(a.path || '').replace(/^assets\//, '');
    if (!name) continue;
    const target = join(dir, name);
    if (existsSync(target)) continue;
    const buf = readAsset(projectPath, a.path);
    if (!buf) continue;
    try {
      writeFileSync(target, buf);
      n += 1;
    } catch { /* 单个失败不影响其它 */ }
  }
  return n;
}

/** 协议里 `bc-img://asset/<name>` → 缓存里的绝对路径（不存在返回 null） */
export function resolveCachedAsset(name: string): string | null {
  const clean = String(name || '').replace(/^\/+/, '');
  if (!clean || clean.includes('..')) return null;
  const p = join(assetCacheDir(), clean);
  return existsSync(p) ? p : null;
}

// ============================================================================
// 素材库（v0.4.5）：把缓存目录里的素材列出来给界面用
// ============================================================================
export interface CachedAsset {
  /** 缓存里的文件名（内容哈希 + 扩展名） */
  name: string;
  /** 直接能放进 src / background-image 的地址 */
  url: string;
  bytes: number;
  mtime: string;
  kind: 'image' | 'video' | 'audio' | 'other';
}

function kindOfName(name: string): CachedAsset['kind'] {
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]) ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'm4a', 'aac', 'opus'].includes(ext)) return 'audio';
  return 'other';
}

/** 列出素材缓存里的文件（新的在前） */
export function listAssetCache(): CachedAsset[] {
  try {
    const dir = assetCacheDir();
    const out: CachedAsset[] = [];
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      try {
        const st = statSync(join(dir, f.name));
        out.push({
          name: f.name,
          url: `${ASSET_PREFIX}${f.name}`,
          bytes: st.size,
          mtime: st.mtime.toISOString(),
          kind: kindOfName(f.name)
        });
      } catch { /* 单个文件读不到就跳过 */ }
    }
    return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

/** 把一个本地文件收进素材缓存（内容哈希命名，天然去重），返回它在库里的条目 */
export function importAssetToCache(srcPath: string): CachedAsset | null {
  try {
    if (!srcPath || !existsSync(srcPath)) return null;
    const data = readFileSync(srcPath);
    const hash = createHash('sha1').update(data).digest('hex').slice(0, 16);
    const ext = (extname(srcPath).replace('.', '') || 'bin').toLowerCase();
    const name = `${hash}.${ext}`;
    writeCache(name, data);
    const st = statSync(join(assetCacheDir(), name));
    return {
      name,
      url: `${ASSET_PREFIX}${name}`,
      bytes: st.size,
      mtime: st.mtime.toISOString(),
      kind: kindOfName(name)
    };
  } catch {
    return null;
  }
}