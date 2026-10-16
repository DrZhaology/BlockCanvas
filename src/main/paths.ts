import nodePath from 'node:path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { app } from 'electron';

// ============================================================================
// BlockCanvas · 跨平台路径统一模块（v0.4.4）
// ----------------------------------------------------------------------------
// 为什么要单独一个模块：以前路径逻辑散在 main.ts / updater.ts / userData.ts 里，
// 出现了几处**只在 Windows 上碰巧能跑**的写法（硬编码 `\`、只认盘符的绝对路径判断、
// macOS 包内写数据…）。这里把"三平台语义"集中成一处，谁要拼路径都从这里拿。
//
// 三平台关键差异（本模块负责抹平）：
//   · 分隔符：Windows `\`，POSIX `/`           → toWebPath / fromWebPath
//   · 绝对路径：`C:\x` / `C:/x` / `\\srv\share`（Win）、`/x`（POSIX） → isAbsolutePathAny
//   · 目录包含：`startsWith(parent + '\\')` 在 POSIX 上永远为假 → isInside（用 relative）
//   · 程序目录：macOS 的可执行文件在 `Xxx.app/Contents/MacOS` 里，数据/替换目标都不同 → installUnitDir
// ============================================================================

/** node:path 的实现类型（默认 = 当前平台；测试里可传 win32 / posix 验证三平台语义） */
export type PathApi = typeof nodePath;

// ---------------------------------------------------------------------------
// 纯函数区（不依赖 electron，可在任意平台单测）
// ---------------------------------------------------------------------------

/**
 * 是否是绝对路径（**三平台通用**判断）。
 *   POSIX ：`/home/u/a.png`、`//srv/share`
 *   Windows：`C:\a\b`、`C:/a/b`、`\\srv\share\a`
 * 注意：不要再用 `/^[a-zA-Z]:[\\/]/` 这种"只认 Windows 盘符"的写法 ——
 * 那会把 macOS/Linux 的 `/Users/…` 当成相对路径去拼，结果永远 404。
 */
export function isAbsolutePathAny(p: string): boolean {
  const s = String(p ?? '').trim();
  if (!s) return false;
  return nodePath.posix.isAbsolute(s) || nodePath.win32.isAbsolute(s);
}

/**
 * 本机路径 → **Web / URL / zip 条目**风格（一律正斜杠）。
 * 用在：`bc-img://` 协议、导出 HTML 里的资源引用、zip 内部条目名。
 */
export function toWebPath(p: string): string {
  return String(p ?? '').replace(/\\/g, '/');
}

/**
 * Web 风格路径（正斜杠）→ 本机路径。
 *   Windows：`a/b/c` → `a\b\c`（盘符保持 `C:/x` → `C:\x` 也能被 Node 接受，这里统一规范化）
 *   POSIX  ：原样返回（`/` 就是本机分隔符）
 */
export function fromWebPath(p: string, platform: NodeJS.Platform = process.platform): string {
  const s = String(p ?? '');
  if (platform !== 'win32') return s;
  return nodePath.win32.normalize(s.replace(/\//g, '\\'));
}

/**
 * `child` 是否位于 `parent` 目录内（含两者相同）。
 *
 * ⚠ 这是本模块存在的**首要原因**：以前解压 zip 时写的是
 *   `out.startsWith(target + '\\')` —— 在 macOS/Linux 上 `join()` 产出的是 `/`，
 *   这个判断**恒为假**，于是"导入扩展 zip"在非 Windows 上一个文件都解不出来。
 * 用 `path.relative` 判断与分隔符无关，三平台语义一致。
 *
 * @param api 传 `nodePath.win32` / `nodePath.posix` 可验证另一种平台的语义（单测用）
 */
export function isInside(child: string, parent: string, api: PathApi = nodePath): boolean {
  if (!child || !parent) return false;
  const rel = api.relative(parent, child);
  if (rel === '') return true;                 // 同一个路径
  if (api.isAbsolute(rel)) return false;       // 不同盘符 / 根
  return !rel.startsWith('..' + api.sep) && rel !== '..';
}

/**
 * 用**指定平台**的语义判断包含关系（三平台适配的自检入口）。
 * 例：`isInsideOn('posix', '/app/ext/a.txt', '/app/ext') === true`
 *     `isInsideOn('win32', 'C:\\App\\ext\\a.txt', 'C:\\App\\ext') === true`
 */
export function isInsideOn(platform: 'win32' | 'posix', child: string, parent: string): boolean {
  return isInside(child, parent, platform === 'win32' ? nodePath.win32 : nodePath.posix);
}

/**
 * 把 zip 里的一条相对条目，安全地解析成 `baseDir` 内的本机绝对路径。
 * 越界（`../` 逃逸、绝对路径条目）一律返回 `null` —— 防 zip-slip，且三平台行为一致。
 */
export function resolveInside(baseDir: string, relEntry: string, platform: NodeJS.Platform = process.platform): string | null {
  const raw = String(relEntry ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw) return null;
  const parts = raw.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.some((s) => s === '..')) return null;      // 拒绝任何上跳
  const abs = fromWebPath(nodePath.posix.join(baseDir.replace(/\\/g, '/'), ...parts), platform);
  const base = fromWebPath(baseDir.replace(/\\/g, '/'), platform);
  return isInside(abs, base, platform === 'win32' ? nodePath.win32 : nodePath.posix) ? abs : null;
}

// ---------------------------------------------------------------------------
// 程序目录区（依赖 electron app）
// ---------------------------------------------------------------------------

/** 缓存的"数据区根目录"（首次解析后固定，避免运行中被环境变化影响） */
let cachedBase: string | null = null;

/**
 * 便携数据区（`data/`）应该放在哪一层的**根目录**。
 *
 *   · 开发态（pnpm dev）：仓库根目录（`app.getAppPath()`）
 *   · 打包态 Windows/Linux：exe 所在目录（真·绿色便携，不碰 AppData）
 *   · 打包态 macOS：可执行文件在 `Xxx.app/Contents/MacOS` 里，
 *     **绝不能**把 `data/` 写进 `.app` 包内（会破坏包完整性、且 /Applications 下只读）
 *     → 取"包含 .app 的那一层目录"
 *   · 环境变量 `PORTABLE_EXECUTABLE_DIR`（electron-builder portable 目标）优先
 */
export function portableBaseDir(): string {
  if (cachedBase) return cachedBase;
  const env = process.env['PORTABLE_EXECUTABLE_DIR'];
  if (env && env.trim()) {
    cachedBase = env.trim();
    return cachedBase;
  }
  if (!app.isPackaged) {
    cachedBase = app.getAppPath();
    return cachedBase;
  }
  const unit = installUnitDir();          // macOS = Xxx.app 本身；Win/Linux = exe 所在目录
  const execDir = nodePath.dirname(process.execPath);
  // unit !== execDir ⇒ 说明确实处在 .app 包里 → 数据放在 .app 同级
  cachedBase = unit === execDir ? execDir : nodePath.dirname(unit);
  return cachedBase;
}

/**
 * 程序"可替换单元"目录 —— 自动更新真正要覆盖的那一层：
 *   · Windows / Linux：exe（或可执行文件）所在目录
 *   · macOS：`Xxx.app` **包本身**（不是它的父目录！
 *     父目录往往是 `/Applications`，对它做 `rsync --delete` 会把别的 App 全删掉）
 */
export function installUnitDir(): string {
  const execDir = nodePath.dirname(process.execPath);
  if (process.platform === 'darwin' && /\.app[\\/]Contents[\\/]MacOS$/i.test(execDir)) {
    return nodePath.dirname(nodePath.dirname(execDir)); // → /Applications/BlockCanvas.app
  }
  return execDir;
}

/** 含 `installUnitDir()` 的那一层目录（macOS = /Applications；Win = exe 所在目录） */
export function installParentDir(): string {
  return nodePath.dirname(installUnitDir());
}

/**
 * 真正安全的"可写数据区"：先试便携目录，写不进去（例如 macOS 把 App 放进 /Applications、
 * 或程序被装在只读盘）再退到用户级目录 —— 保证任何平台都不会因为权限直接崩。
 * 返回最终选定的目录（已确保存在）。
 */
export function resolveWritableDir(joinSeg: string): string {
  const primary = nodePath.join(portableBaseDir(), joinSeg);
  if (isWritable(primary)) return primary;
  const fallback = nodePath.join(safeUserDataRoot(), joinSeg);
  try { mkdirSync(fallback, { recursive: true }); } catch { /* 兜底失败就交回 primary，由调用方 try/catch */ }
  return isWritable(fallback) ? fallback : primary;
}

/** 探针式可写判断：能建目录 + 能写一个 0 字节文件，就算可写 */
export function isWritable(dir: string): boolean {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const probe = nodePath.join(dir, '.bc-write-probe');
    writeFileSync(probe, '');
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** 用户级兜底目录（不依赖 electron 的 app.getPath，避免调用时机限制） */
function safeUserDataRoot(): string {
  const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
  try {
    const appData = app.getPath('appData');
    if (appData) return nodePath.join(appData, 'BlockCanvas');
  } catch { /* app 未 ready 时 getPath 会抛，忽略 */ }
  return nodePath.join(home, '.blockcanvas');
}

/** 仅供测试：清掉 portableBaseDir 的缓存 */
export function __resetPortableBaseCache(): void {
  cachedBase = null;
}
