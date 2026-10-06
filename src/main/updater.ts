import { app } from 'electron';
import { join, dirname, basename } from 'node:path';
import {
  existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, chmodSync, readFileSync,
  openSync, readSync, closeSync, createWriteStream
} from 'node:fs';

// ============================================================================
// BlockCanvas · 自动更新中枢（v0.4.3 重写）
// ----------------------------------------------------------------------------
// 三条铁律：
//  1. **读取与下载都做镜像回退**，全程自动、用户无感（不弹窗、不要求手动重试）：
//       读取发行版信息：NexaCode 镜像 → gh-proxy(v4) → GitHub 直连
//       下载更新包：    gh-proxy(v4) → NexaCode → GitHub 直连
//     （"程序自带的镜像"就是 v4.gh-proxy.org，与下载首选一致，已去重）
//  2. **用户数据永远不碰**：便携版的全部数据都在软件目录 `data/` 下，
//     更新时只替换程序本体（排除 data / .update），删掉 data 程序也能自己重建。
//  3. **平台适配**：Windows（robocopy）、macOS / Linux（rsync，兜底 tar）——
//     各自生成"程序退出后由独立进程执行"的替换脚本，再自动重启。
//     Android 等到阶段 6 再做。
//
// ⚠ 本文件只做"能跑通语法与流程"的实现；真实替换效果需要打包成便携版后实测。
// ============================================================================

export const REPO = 'DrZhaology/BlockCanvas';

/** 当前应用版本号（Electron 内置元数据，asar / portable 都可靠） */
export const APP_VERSION: string = app.getVersion();

/** 获取当前安装版本（优先 Electron 元数据，兜底 exe 同级 package.json） */
export function getLocalVersion(): string {
  const v = app.getVersion();
  if (v && v !== '0.0.0') return v;
  try {
    const pkgPath = join(dirname(process.execPath), 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '0.0.0';
    }
  } catch { /* 忽略 */ }
  return '0.0.0';
}

// ============ 镜像源 ============

export interface MirrorDef {
  id: string;
  name: string;
  /** 前缀（空 = 直连）；统一按「前缀 + 原始 GitHub URL」拼接（gh-proxy 系镜像的通用约定） */
  prefix: string;
}

export const MIRRORS: MirrorDef[] = [
  { id: 'ghproxy-v4', name: 'gh-proxy 镜像 (v4)', prefix: 'https://v4.gh-proxy.org/' },
  { id: 'nexacode', name: 'NexaCode 镜像', prefix: 'https://gh.nexacode.dpdns.org/' },
  { id: 'direct', name: 'GitHub 直连', prefix: '' }
];

/** 读取发行版信息的尝试顺序：NexaCode 优先 */
const READ_ORDER = ['nexacode', 'ghproxy-v4', 'direct'];
/** 下载更新包的尝试顺序：gh-proxy v4 优先（Cloudflare 节点，理论上最稳） */
const DOWNLOAD_ORDER = ['ghproxy-v4', 'nexacode', 'direct'];

function mirrorById(id: string): MirrorDef {
  return MIRRORS.find((m) => m.id === id) || MIRRORS[MIRRORS.length - 1];
}
function wrap(prefix: string, url: string): string {
  return prefix ? prefix + url : url;
}

/** 供界面展示的镜像说明 */
export function getMirrorInfo(): { read: string[]; download: string[] } {
  return {
    read: READ_ORDER.map((id) => mirrorById(id).name),
    download: DOWNLOAD_ORDER.map((id) => mirrorById(id).name)
  };
}

// ============ 发行版数据 ============

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface LatestReleaseInfo {
  tag: string;
  version: string;
  name: string;
  assets: ReleaseAsset[];
  publishedAt: string;
  prerelease?: boolean;
  body?: string;
}

export interface ReleaseFetchResult {
  list: LatestReleaseInfo[];
  /** 实际命中的镜像名（界面上会显示"经由 xxx 获取"） */
  source: string;
}

function mapRawRelease(release: any): LatestReleaseInfo {
  return {
    tag: release.tag_name,
    version: String(release.tag_name || '').replace(/^v/i, ''),
    name: release.name || release.tag_name,
    assets: (release.assets || []).map((a: any) => ({
      name: a.name,
      browser_download_url: a.browser_download_url,
      size: a.size
    })),
    publishedAt: release.published_at,
    prerelease: !!release.prerelease,
    body: typeof release.body === 'string' ? release.body : ''
  };
}

async function fetchJsonWithTimeout(url: string, ms: number): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 拉取发行版列表（最新在前，含预发行版）。
 * 依次尝试 NexaCode → gh-proxy(v4) → GitHub 直连，任何一个成功即返回；
 * 全部失败才返回 null（界面提示：请关闭 Watt Toolkit / Clash 等代理后重试）。
 */
export async function fetchReleases(perPage = 100): Promise<ReleaseFetchResult | null> {
  const raw = `https://api.github.com/repos/${REPO}/releases?per_page=${perPage}`;
  for (const id of READ_ORDER) {
    const m = mirrorById(id);
    try {
      const data = await fetchJsonWithTimeout(wrap(m.prefix, raw), 12000);
      if (!Array.isArray(data) || data.length === 0) continue;
      return { list: data.map(mapRawRelease), source: m.name };
    } catch { /* 换下一个源 */ }
  }
  return null;
}

/** 兼容旧调用：取最新一条 */
export async function fetchLatestRelease(): Promise<LatestReleaseInfo | null> {
  const r = await fetchReleases(1);
  return r && r.list.length > 0 ? r.list[0] : null;
}

/** 比较两个 semver：1（a 新）/ 0（相同）/ -1（a 旧） */
export function compareVersion(a: string, b: string): number {
  const pa = String(a).replace(/^v/i, '').split('.').map((x) => Number(x) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// ============ 平台资产匹配 ============

export interface MatchedAsset {
  url: string;
  name: string;
  size: number;
}

/**
 * 按当前平台匹配发行版资产（只看名称关键词 —— 很多资产都是 zip，单看后缀分不出来）。
 *   win32  → win / windows / win64 / win-x64
 *   darwin → mac / darwin / osx / dmg
 *   linux  → linux / appimage / deb
 * 找不到 → null（该平台这一版没有对应构建，可检测不可更新）
 */
export function findMatchingAsset(assets: ReleaseAsset[]): MatchedAsset | null {
  const plat = process.platform as string;
  const score = (name: string): number => {
    const n = name.toLowerCase();
    let hit = 0;
    switch (plat) {
      case 'win32':
        if (/(^|[^a-z])(win|windows|win64|win-x64|win32)([^a-z]|$)/.test(n) || n.includes('windows')) hit += 2;
        if (/(mac|darwin|osx|linux|android|apk|ios|iphone|ipa|arm64|arm)/.test(n)) hit -= 4;
        if (n.includes('x64')) hit += 1;
        if (n.includes('portable') || n.endsWith('.zip')) hit += 1;
        break;
      case 'darwin':
        if (/(mac|darwin|osx|dmg)/.test(n)) hit += 2;
        if (/(win|windows|linux|android|apk|ios|iphone)/.test(n)) hit -= 4;
        if (/(arm64|aarch64|universal)/.test(n)) hit += 1;
        if (n.endsWith('.dmg') || n.endsWith('.zip')) hit += 1;
        break;
      case 'linux':
        if (/(linux|appimage|deb|tar\.gz)/.test(n)) hit += 2;
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

// ============ 版本列表（当前 + 往前 5 个只读 + 当前及往后全部可更新） ============

export interface UpdateVersionEntry {
  tag: string;
  version: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  body: string;
  assets: ReleaseAsset[];
  /** 版本号 ≥ 本地版本 → 可以点「更新到这一版」；更低的老版本只做信息展示 */
  updateable: boolean;
  /** 是否就是当前安装的版本 */
  isCurrent: boolean;
  /** 本平台匹配到的资产（不可更新 / 无匹配资产时为 null） */
  asset: MatchedAsset | null;
}

export interface UpdateListResult {
  localVersion: string;
  /** 展示列表：最新在前。= 全部更新项 + 当前版本 + 往前 5 个历史版本 */
  entries: UpdateVersionEntry[];
  /** 最新的"可更新"版本（没有则 null） */
  latest: UpdateVersionEntry | null;
  /** 本地版本是否落后于某个更新项 */
  hasUpdate: boolean;
  /** 命中镜像名 */
  source: string;
}

/** 历史版本（当前版本之前）最多展示几条 —— 纯信息展示，不带更新按钮 */
const OLDER_LIMIT = 5;

export function buildUpdateList(localVersion: string, releases: LatestReleaseInfo[], source: string): UpdateListResult {
  const sorted = [...releases].sort((a, b) => compareVersion(b.version, a.version)); // 新 → 旧
  const newer = sorted.filter((r) => compareVersion(r.version, localVersion) > 0);
  const equal = sorted.filter((r) => compareVersion(r.version, localVersion) === 0);
  const older = sorted.filter((r) => compareVersion(r.version, localVersion) < 0).slice(0, OLDER_LIMIT);

  const toEntry = (r: LatestReleaseInfo): UpdateVersionEntry => {
    const cmp = compareVersion(r.version, localVersion);
    const updateable = cmp >= 0;
    return {
      tag: r.tag,
      version: r.version,
      name: r.name,
      publishedAt: r.publishedAt,
      prerelease: !!r.prerelease,
      body: r.body || '',
      assets: r.assets,
      updateable,
      isCurrent: cmp === 0,
      asset: updateable ? findMatchingAsset(r.assets) : null
    };
  };

  const entries = [...newer, ...equal, ...older].map(toEntry);
  const updateCandidates = entries.filter((e) => e.updateable);
  const latest = updateCandidates.length > 0 ? updateCandidates[0] : null;
  return {
    localVersion,
    entries,
    latest,
    hasUpdate: newer.length > 0,
    source
  };
}

// ============ 下载（多镜像回退 + zip 完整性校验） ============

interface DownloadHooks {
  onProgress?: (pct: number, mb: number, totalMb: number) => void;
  /** 切换镜像 / 阶段提示（"正在通过 NexaCode 镜像下载…"） */
  onNotice?: (msg: string) => void;
}

function isZipFile(path: string): boolean {
  try {
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(2);
    readSync(fd, buf, 0, 2, 0);
    closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4b; // "PK"
  } catch {
    return false;
  }
}

/**
 * 下载更新包：按 gh-proxy(v4) → NexaCode → GitHub 直连 依次尝试。
 * 每个源下载完成后校验 zip 头（"PK"），损坏/被劫持成 HTML 就自动换下一个源。
 */
export async function downloadUpdateAsset(
  url: string,
  destPath: string,
  hooks?: DownloadHooks
): Promise<{ ok: boolean; error?: string; mirror?: string }> {
  mkdirSync(dirname(destPath), { recursive: true });
  const errors: string[] = [];

  for (const id of DOWNLOAD_ORDER) {
    const m = mirrorById(id);
    const target = wrap(m.prefix, url);
    hooks?.onNotice?.(`正在通过 ${m.name} 下载更新包…`);
    try {
      const res = await fetch(target, { headers: { Accept: 'application/octet-stream' } });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const total = Number(res.headers.get('content-length') || 0);
      const totalMb = Math.round((total / 1048576) * 10) / 10;
      const reader = res.body.getReader();
      const ws = createWriteStream(destPath);
      let received = 0;
      let lastPct = -1;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.length;
        ws.write(Buffer.from(value));
        if (hooks?.onProgress && total > 0) {
          const pct = Math.min(99, Math.floor((received / total) * 100));
          if (pct !== lastPct) {
            lastPct = pct;
            hooks.onProgress(pct, Math.round((received / 1048576) * 10) / 10, totalMb);
          }
        }
      }
      await new Promise<void>((resolve, reject) => {
        ws.on('error', reject);
        ws.end(() => resolve());
      });

      if (received < 1024 || !isZipFile(destPath)) {
        throw new Error('下载内容不是有效的 zip（可能被镜像劫持或中断）');
      }
      hooks?.onProgress?.(100, Math.round((received / 1048576) * 10) / 10, totalMb);
      return { ok: true, mirror: m.name };
    } catch (e: any) {
      errors.push(`${m.name}：${e?.message || '失败'}`);
      try { rmSync(destPath, { force: true }); } catch { /* 忽略 */ }
    }
  }
  return { ok: false, error: errors.join('；') || '全部镜像均下载失败' };
}

// ============ 解压 / 替换 ============

async function unzipUpdate(zipPath: string, targetDir: string): Promise<{ ok: boolean; error?: string }> {
  const { execSync } = await import('node:child_process');
  try {
    mkdirSync(targetDir, { recursive: true });
    // Windows 10+ 内置 tar；macOS / Linux 也都有 tar
    execSync(`tar -xf "${zipPath}" -C "${targetDir}"`, { stdio: 'pipe', timeout: 180000 });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: (e?.stderr?.toString() || e?.message || '解压失败') };
  }
}

/** 在解压目录里找出"真正含程序本体"的那一层（兼容 zip 内有/没有顶层目录） */
function findExtractRoot(stagingDir: string): string | null {
  const plat = process.platform;
  const match = (dir: string): boolean => {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (plat === 'win32') return entries.some((e) => e.isFile() && /^blockcanvas\.exe$/i.test(e.name));
    if (plat === 'darwin') return entries.some((e) => e.isDirectory() && /^blockcanvas\.app$/i.test(e.name));
    return entries.some((e) => e.isFile() && /^blockcanvas$/i.test(e.name));
  };
  const walk = (dir: string, depth: number): string | null => {
    if (depth > 2) return null;
    if (match(dir)) return dir;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const r = walk(join(dir, e.name), depth + 1);
      if (r) return r;
    }
    return null;
  };
  return walk(stagingDir, 0);
}

/** 程序主目录（要被替换的目标） */
function resolveInstallDir(): string {
  const execDir = dirname(process.execPath);
  // macOS：execPath 在 Xxx.app/Contents/MacOS 里面 → 替换目标是包含 .app 的那一层目录
  if (process.platform === 'darwin' && /\.app[\\/]Contents[\\/]MacOS$/i.test(execDir)) {
    return dirname(dirname(dirname(execDir)));
  }
  return execDir;
}

/**
 * 执行应用更新（Windows / macOS / Linux）。
 * 步骤：下载（多镜像回退）→ 解压 → 找到程序根 → 生成"退出后执行"的替换脚本
 *      （排除 data / .update，其余全部替换）→ 启动独立进程 → 主进程退出交锁。
 */
export async function applyUpdate(
  assetUrl: string,
  onProgress?: (msg: string, pct?: number) => void
): Promise<{ ok: boolean; error?: string }> {
  const installDir = resolveInstallDir();
  const updateDir = join(installDir, '.update');
  const stagingDir = join(updateDir, 'staging');
  const zipPath = join(updateDir, 'update.zip');

  if (!app.isPackaged) {
    return { ok: false, error: '当前处于源码开发模式（pnpm dev / pnpm build 直接运行），没有可替换的安装目录。自动更新仅对打包后的便携版生效。' };
  }

  try {
    rmSync(updateDir, { recursive: true, force: true });
    mkdirSync(stagingDir, { recursive: true });

    // 1. 下载（多镜像回退 + zip 校验）
    onProgress?.('准备下载更新包…', 0);
    const dl = await downloadUpdateAsset(assetUrl, zipPath, {
      onProgress: (pct, mb, totalMb) => onProgress?.(`正在下载更新包… ${mb} / ${totalMb} MB`, pct),
      onNotice: (msg) => onProgress?.(msg, 0)
    });
    if (!dl.ok) return { ok: false, error: `下载失败：${dl.error}` };
    onProgress?.(`下载完成（经由 ${dl.mirror}）`, 100);

    // 2. 解压
    onProgress?.('正在解压更新包…', 100);
    const unz = await unzipUpdate(zipPath, stagingDir);
    if (!unz.ok) return { ok: false, error: `解压失败：${unz.error}` };

    // 3. 找到程序本体所在层
    const extractRoot = findExtractRoot(stagingDir);
    if (!extractRoot) {
      return { ok: false, error: '更新包内容异常：没有找到程序本体（Windows 找 BlockCanvas.exe / macOS 找 BlockCanvas.app / Linux 找 blockcanvas），下载可能不完整。' };
    }

    // 4. 生成"程序退出后执行"的替换脚本
    onProgress?.('正在准备替换脚本…', 100);
    const scriptPath = process.platform === 'win32'
      ? writeWindowsScript(updateDir, extractRoot, installDir)
      : writePosixScript(updateDir, extractRoot, installDir);

    // 5. 启动独立进程执行替换，然后本进程退出（交出文件锁）
    onProgress?.('准备就绪，正在重启以完成更新…', 100);
    const { spawn } = await import('node:child_process');
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', scriptPath], { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' });
    child.unref();

    setTimeout(() => { app.exit(0); }, 400);
    return { ok: true };
  } catch (e: any) {
    try { rmSync(updateDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    return { ok: false, error: e?.message || '更新失败' };
  }
}

/** Windows：robocopy /E /PURGE，排除 data 与 .update（用户数据永不被删/覆盖） */
function writeWindowsScript(updateDir: string, src: string, dst: string): string {
  const batPath = join(updateDir, 'apply-update.bat');
  const exeName = basename(process.execPath);
  const bat = [
    '@echo off',
    'rem BlockCanvas 自动更新脚本（主进程生成，程序退出后由独立进程执行）',
    'chcp 65001 >nul',
    'title BlockCanvas Updater',
    'rem 等主进程完全退出、释放文件锁',
    'timeout /t 3 /nobreak >nul',
    `robocopy "${src}" "${dst}" /E /PURGE /XD "data" ".update" /R:3 /W:2 /NFL /NDL /NJH /NJS /NP`,
    'rem robocopy 退出码 0-7 都算成功，8 以上才是错误',
    'if errorlevel 8 (',
    '  echo 更新失败：文件替换出错。更新包保留在 .update 目录，程序未受影响。',
    '  pause',
    '  exit /b 1',
    ')',
    `rmdir /s /q "${updateDir}"`,
    `start "" "${join(dst, exeName)}"`,
    'exit /b 0',
    'del "%~f0"'
  ].join('\r\n');
  writeFileSync(batPath, bat, 'utf-8');
  return batPath;
}

/** macOS / Linux：rsync（优先）或 tar 覆盖，排除 data 与 .update，然后重启 */
function writePosixScript(updateDir: string, src: string, dst: string): string {
  const shPath = join(updateDir, 'apply-update.sh');
  const execPath = process.execPath;
  const lines = [
    '#!/bin/sh',
    '# BlockCanvas 自动更新脚本（主进程生成，程序退出后由独立进程执行）',
    'sleep 3',
    `SRC="${src}"`,
    `DST="${dst}"`,
    'if command -v rsync >/dev/null 2>&1; then',
    '  rsync -a --delete --exclude "data" --exclude ".update" "$SRC/" "$DST/"',
    'else',
    '  # 无 rsync 时的兜底：tar 做覆盖式复制（同样排除 data / .update）',
    '  ( cd "$SRC" && tar cf - --exclude "data" --exclude ".update" . ) | ( cd "$DST" && tar xf - )',
    'fi',
    `rm -rf "${updateDir}"`
  ];
  if (process.platform === 'darwin') {
    lines.push(`open -n "${join(dst, 'BlockCanvas.app')}" 2>/dev/null || (nohup "${execPath}" >/dev/null 2>&1 &)`);
  } else {
    lines.push(`nohup "${execPath}" >/dev/null 2>&1 &`);
  }
  lines.push('rm -f "$0"');
  writeFileSync(shPath, lines.join('\n') + '\n', 'utf-8');
  try { chmodSync(shPath, 0o755); } catch { /* 忽略 */ }
  return shPath;
}
