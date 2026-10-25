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
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { basename, extname, join } from 'path';
import { nativeImage } from 'electron';
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
 *
 * v0.4.5：加了 `onProgress(done, total)` 回调 —— 启动加载页要显示**真实进度**，
 * 而"解包素材"正是一个大工程最耗时、也是唯一能分步计数的一段。
 */
export function extractProjectAssets(
  projectPath: string,
  manifest?: ProjectManifest | null,
  onProgress?: (done: number, total: number) => void
): number {
  const list = manifest?.assets ?? [];
  if (list.length === 0) { onProgress?.(0, 0); return 0; }
  const dir = assetCacheDir();
  let n = 0;
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    const name = String(a.path || '').replace(/^assets\//, '');
    if (name) {
      const target = join(dir, name);
      if (!existsSync(target)) {
        const buf = readAsset(projectPath, a.path);
        if (buf) {
          try {
            writeFileSync(target, buf);
            n += 1;
          } catch { /* 单个失败不影响其它 */ }
        }
      }
    }
    // 每 4 个报一次，够顺滑又不会把 IPC 打爆
    const done = i + 1;
    if (onProgress && (done % 4 === 0 || done === list.length)) onProgress(done, list.length);
  }
  onProgress?.(list.length, list.length);
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
  /** v0.4.5：缩略图地址（图片才有；没有则为 null → 界面用原图兜底） */
  thumbUrl?: string | null;
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

/** 列出素材缓存里的文件（新的在前）。图片会附带缩略图地址（v0.4.5，避免首屏解码全尺寸原图） */
export function listAssetCache(): CachedAsset[] {
  try {
    const dir = assetCacheDir();
    const out: CachedAsset[] = [];
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      try {
        const st = statSync(join(dir, f.name));
        const kind = kindOfName(f.name);
        out.push({
          name: f.name,
          url: `${ASSET_PREFIX}${f.name}`,
          thumbUrl: kind === 'image' ? assetThumbUrl(f.name) : null,
          bytes: st.size,
          mtime: st.mtime.toISOString(),
          kind
        });
      } catch { /* 单个文件读不到就跳过 */ }
    }
    return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

// ============================================================================
// 素材缩略图磁盘缓存（v0.4.5 第 10 批）
// ----------------------------------------------------------------------------
// 用户反馈：「现在动不动一个视频占用很大的内容，要优化」「素材库首屏还是会卡」。
//
// 素材库网格以前直接 `<img src="bc-img://asset/...">` 加载**原图**：
// 50 张 4K 图 = 50 次全尺寸解码（每张约 33MB RGBA），一进素材页就吃掉 1.5GB+。
// 网格里每张缩略图实际只显示 62px 高。
//
// 现在：主进程用 Electron 的 nativeImage 生成一张 256px 的 webp 缩略图，
// 存到 data/cache/thumbs/<原文件名>.<尺寸>.webp，界面加载缩略图 URL。
//   · 缩略图只生成一次（内容哈希命名 → 原图变了名字就变了，天然不会过期）；
//   · 生成失败（损坏文件 / 不支持的格式）就回退用原图，绝不因此让素材"消失"。
// ============================================================================
const THUMB_SIZE = 256;

export function thumbCacheDir(): string {
  const dir = join(dataRoot(), 'cache', 'thumbs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** 这个素材在缩略图缓存里的文件名（带尺寸，便于将来换尺寸时并存）。
 *  实际编码是 JPEG（nativeImage 直接吐 JPEG 字节，体积最小），所以扩展名用 .jpg，别写 .webp。 */
export function thumbNameOf(assetName: string): string {
  return `${String(assetName).replace(/\.[^.]+$/, '')}.${THUMB_SIZE}.jpg`;
}

/** 协议层用：`bc-img://asset/<name>` → 缩略图文件的绝对路径（不存在返回 null） */
export function resolveThumbPath(assetName: string): string | null {
  try {
    const clean = String(assetName || '').replace(/^\/+/, '');
    if (!clean || clean.includes('..')) return null;
    const p = join(thumbCacheDir(), thumbNameOf(clean));
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/**
 * 取（必要时生成）某个图片素材的缩略图。
 * 返回可直接给 `<img src>` 的 URL；返回 null 表示"没有缩略图，请用原图"。
 */
export function assetThumbUrl(assetName: string): string | null {
  try {
    const clean = String(assetName || '').replace(/^\/+/, '');
    if (!clean || clean.includes('..')) return null;
    const src = resolveCachedAsset(clean);
    if (!src) return null;
    // 只给图片做缩略图（视频/音频没有可解码的静态帧）
    if (kindOfName(clean) !== 'image') return null;
    const target = join(thumbCacheDir(), thumbNameOf(clean));
    if (existsSync(target)) return `${ASSET_PREFIX}${clean}?thumb=${THUMB_SIZE}`;
    const img = nativeImage.createFromPath(src);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    // 原图本来就比缩略图小 → 没必要再生成（直接用原图更清晰）
    if (size.width <= THUMB_SIZE && size.height <= THUMB_SIZE) return null;
    const ratio = Math.min(THUMB_SIZE / size.width, THUMB_SIZE / size.height);
    const resized = img.resize({
      width: Math.max(1, Math.round(size.width * ratio)),
      height: Math.max(1, Math.round(size.height * ratio)),
      quality: 'good'
    });
    const buf = resized.toJPEG(82);
    if (!buf || buf.length === 0) return null;
    writeFileSync(target, buf);
    return `${ASSET_PREFIX}${clean}?thumb=${THUMB_SIZE}`;
  } catch {
    return null;   // 任何失败都回退原图
  }
}

/** 缩略图缓存占用（给存储面板统计 / 清理用） */
export function thumbCacheBytes(): number {
  const dir = thumbCacheDir();
  if (!existsSync(dir)) return 0;
  let total = 0;
  try {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      try { total += statSync(join(dir, f.name)).size; } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
  return total;
}

/** 清空缩略图缓存（可再生成，安全） */
export function clearThumbCache(): number {
  const dir = thumbCacheDir();
  if (!existsSync(dir)) return 0;
  let freed = 0;
  try {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const full = join(dir, f.name);
      try { freed += statSync(full).size; unlinkSync(full); } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
  return freed;
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