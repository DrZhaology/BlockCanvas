import { app } from 'electron';
import { join, dirname, basename } from 'node:path';
import {
  existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, chmodSync, readFileSync
} from 'node:fs';
import { installUnitDir } from './paths';
import { dataRoot } from './userData';

// ============================================================================
// 更新日志（v0.4.5）
// ----------------------------------------------------------------------------
// 更新出问题时用户只能说"更新失败了"，我们连哪一步、哪个镜像、什么错误都看不到。
// 这里把关键事件按天写进 data/logs/update-YYYYMMDD.log：
//   · 应用启动（版本号）
//   · 拉取发行版信息（哪个镜像成功/失败）
//   · 开始下载 / 下载完成 / 校验失败 / 安装开始与结束
// 原则：**日志失败绝不影响更新本身**（全部 try-catch 吞掉）。
// ============================================================================
let _logPath = '';
export function updateLogPath(): string {
  if (_logPath) return _logPath;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const dir = join(dataRoot(), 'logs');
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch { /* 忽略 */ }
  _logPath = join(dir, `update-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.log`);
  return _logPath;
}

/** 写一条更新日志（永不抛错） */
export function ulog(msg: string): void {
  try {
    writeFileSync(updateLogPath(), `[${new Date().toISOString()}] ${msg}\n`, { flag: 'a' });
  } catch { /* 日志写不进去也不该影响更新 */ }
}

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

/**
 * 当前阶段展示文案（「关于」页用）。
 * 来源：根目录 version.json 的 stage → tools/sync-version.mjs 写进 package.json 的 bcStage
 * （package.json 会随 asar 一起打包，所以打包后也读得到）。读不到就返回空串。
 */
export function getAppStage(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf-8'));
    return String(pkg.bcStage ?? '');
  } catch { /* 忽略 */ }
  return '';
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
export const DOWNLOAD_ORDER = ['ghproxy-v4', 'nexacode', 'direct'];

export function mirrorById(id: string): MirrorDef {
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
  ulog(`拉取发行版列表（per_page=${perPage}）`);
  for (const id of READ_ORDER) {
    const m = mirrorById(id);
    try {
      const data = await fetchJsonWithTimeout(wrap(m.prefix, raw), 12000);
      if (!Array.isArray(data) || data.length === 0) {
        ulog(`  ${m.name}：返回空列表，换下一个源`);
        continue;
      }
      ulog(`  ${m.name}：成功，${data.length} 条发行版`);
      return { list: data.map(mapRawRelease), source: m.name };
    } catch (e) {
      ulog(`  ${m.name}：失败（${(e as Error).message}），换下一个源`);
    }
  }
  ulog('所有镜像都失败了：拿不到发行版信息');
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

/** 历史版本（当前版本之前）最多返回几条 —— 列表默认只显示前几条，靠「查看更多」逐段展开 */
const OLDER_LIMIT = 30;

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

// ============ 下载 ============
// v0.4.4 起，"下载"整体挪到了 `main/tasks.ts`（后台任务 + 断点续传 + 暂停/继续/取消）。
// 这里只保留「拿到的 zip 之后怎么替换程序本体」——见下面的 finishUpdateFromZip()。
// 之所以挪走：下载进度以前存在渲染层组件里，一离开更新页 / 一重启就丢，
// 而且没法暂停续传、也没法在别处（工具栏「任务」按钮）看到它在跑。

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

/** 程序主目录（要被替换的目标所在的**上一层**）—— 用于放 `.update` 与生成改名计划 */
export function resolveInstallDir(): string {
  const unit = installUnitDir();               // macOS = /Applications/Xxx.app；Win/Linux = exe 所在目录
  const execDir = dirname(process.execPath);
  // macOS：unit 是 .app 本身 → 返回它所在的那一层（/Applications）
  return unit === execDir ? execDir : dirname(unit);
}

/**
 * 版本化的文件夹名：把结尾的版本号换掉。
 *   `BlockCanvas`            → `BlockCanvas-v0.4.4`
 *   `BlockCanvas-v0.4.3`     → `BlockCanvas-v0.4.4`
 *   `BlockCanvas-portable`   → `BlockCanvas-portable-v0.4.4`
 * 这样用户一眼就知道手上这包是哪个版本，多版本共存时也不会互相覆盖。
 */
export function versionedFolderName(current: string, version: string): string {
  const base = String(current || '').replace(/[-_ ]?v?\d+(?:\.\d+)*$/i, '').trim() || 'BlockCanvas';
  return version ? `${base}-v${version}` : base;
}

/**
 * 拿到更新包之后的收尾：解压 → 找到程序本体 → 生成"程序退出后执行"的替换脚本 → 拉起独立进程。
 * 调用方负责：① 先把 zip 下到 `<installDir>/.update/update.zip`；② 本函数返回 ok 后自行 `app.exit(0)` 交出文件锁。
 *
 * v0.4.4 的变化：
 *   · 下载不再在这里做（挪到了 tasks.ts，可暂停/续传/看进度）；
 *   · **替换脚本挪到系统临时目录执行** —— 因为收尾还要把程序文件夹改名，
 *     脚本若待在被改名的目录里，`%~f0`/`$0` 这些自我引用会立刻失效；
 *   · 替换完成后自动把程序文件夹改成 `<原名>-v<新版本>`（权限不够时请求一次 UAC）。
 */
export async function finishUpdateFromZip(
  zipPath: string,
  version: string,
  onProgress?: (msg: string, pct?: number) => void
): Promise<{ ok: boolean; error?: string }> {
  if (!app.isPackaged) {
    return { ok: false, error: '当前处于源码开发模式（pnpm dev / pnpm build 直接运行），没有可替换的安装目录。自动更新仅对打包后的便携版生效。' };
  }
  const installDir = resolveInstallDir();
  const updateDir = join(installDir, '.update');
  const stagingDir = join(updateDir, 'staging');
  const workDir = join(app.getPath('temp'), `bc-updater-${Date.now().toString(36)}`);

  /**
   * 失败收尾：解压出来的 staging 一律清掉（**保留 `.update/update.zip`** —— 用户点重试不用重新下载）。
   * 失败路径不清理的话，`.update/` 会一次比一次大（老版本就是这样留残渣的）。
   */
  const fail = (error: string): { ok: false; error: string } => {
    try { rmSync(stagingDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    return { ok: false, error };
  };

  try {
    if (!existsSync(zipPath)) return fail('更新包不存在（可能已被清理），请重新下载。');
    rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(stagingDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });

    // 1. 解压
    onProgress?.('正在解压更新包…', 100);
    const unz = await unzipUpdate(zipPath, stagingDir);
    if (!unz.ok) return fail(`解压失败：${unz.error}`);

    // 2. 找到程序本体所在层
    const extractRoot = findExtractRoot(stagingDir);
    if (!extractRoot) {
      return fail('更新包内容异常：没有找到程序本体（Windows 找 BlockCanvas.exe / macOS 找 BlockCanvas.app / Linux 找 blockcanvas），下载可能不完整。');
    }

    // 2b. 计算"真正要覆盖的目标"（三平台语义不同，见 paths.ts）
    //   · Windows / Linux：目标 = exe 所在目录（extractRoot 与 installDir 同层）
    //   · macOS：目标 = **Xxx.app 包本身**。旧实现把目标设成 installDir（= /Applications），
    //     再对它做 `rsync --delete`，会把用户其它 App 全删掉 —— 这里修掉。
    const isMac = process.platform === 'darwin';
    let syncSrc = extractRoot;
    let syncDst = installDir;
    if (isMac) {
      const bundle = readdirSync(extractRoot, { withFileTypes: true })
        .find((e) => e.isDirectory() && /\.app$/i.test(e.name));
      if (bundle) {
        syncSrc = join(extractRoot, bundle.name);
        syncDst = join(installDir, bundle.name);
      }
    }

    // 3. 目标文件夹名（带版本号）；已一致就不改名
    //    macOS 改的是 `.app` 包名（不能去改 /Applications 这个名字），其它平台改程序文件夹名
    const parent = isMac ? installDir : dirname(installDir);
    const oldName = isMac ? basename(syncDst) : basename(installDir);
    const newName = isMac
      ? `${versionedFolderName(basename(syncDst, '.app'), version)}.app`
      : versionedFolderName(oldName, version);

    // 4. 生成替换脚本（放在临时目录，不随程序文件夹改名而失效）
    onProgress?.('正在准备替换脚本…', 100);
    const scriptPath = process.platform === 'win32'
      ? writeWindowsScript(workDir, updateDir, extractRoot, installDir, { parent, oldName, newName })
      : writePosixScript(workDir, updateDir, syncSrc, syncDst, { parent, oldName, newName });

    // 5. 拉起独立进程执行替换；主进程随后退出交出文件锁
    onProgress?.('准备就绪，正在重启以完成更新…', 100);
    const { spawn } = await import('node:child_process');
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', scriptPath], { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  } catch (e: any) {
    return fail(e?.message || '更新失败');
  }
}

interface RenamePlan { parent: string; oldName: string; newName: string }

/** Windows：robocopy /E /PURGE（排除 data / .update）→ 删掉 .update → 改名 → 启动新程序 */
function writeWindowsScript(workDir: string, updateDir: string, src: string, dst: string, plan: RenamePlan): string {
  const batPath = join(workDir, 'apply-update.bat');
  const psPath = join(workDir, 'rename-folder.ps1');
  const exeName = basename(process.execPath);
  const needRename = plan.oldName !== plan.newName;

  // 改名脚本：先直接改；改不动（例如装在 Program Files / 目录被占）再请求一次 UAC 提权重试。
  const ps = [
    'param([string]$Parent, [string]$Old, [string]$New, [string]$Elevated = "0")',
    '$ErrorActionPreference = "SilentlyContinue"',
    '$src = Join-Path $Parent $Old',
    '$dst = Join-Path $Parent $New',
    'if (-not (Test-Path -LiteralPath $src)) { exit 0 }',
    'if ($Old -eq $New) { exit 0 }',
    'if (Test-Path -LiteralPath $dst) { exit 0 }   # 目标已存在 → 不动，避免覆盖',
    'try { Rename-Item -LiteralPath $src -NewName $New -ErrorAction Stop; exit 0 } catch { }',
    'if ($Elevated -eq "1") { exit 1 }',
    '# 普通权限改不动 → 请求一次 UAC 授权后重试（用户会在屏幕上看到系统授权框）',
    'try {',
    '  Start-Process -FilePath "powershell" -Verb RunAs -Wait -ErrorAction Stop -ArgumentList @(',
    '    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath,',
    '    "-Parent", $Parent, "-Old", $Old, "-New", $New, "-Elevated", "1"',
    '  )',
    '} catch { }',
    'exit 0'
  ].join('\r\n');
  writeFileSync(psPath, ps, 'utf-8');

  const targetNew = join(plan.parent, plan.newName);
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
    '  echo 更新失败：文件替换出错。程序未受影响，可重开软件重试。',
    `  rem 清掉解压出来的临时文件（.update\\update.zip 留着，重试不用重新下载）`,
    `  rmdir /s /q "${join(updateDir, 'staging')}"`,
    '  pause',
    '  exit /b 1',
    ')',
    `rmdir /s /q "${updateDir}"`,
    ...(needRename ? [
      'rem —— 把程序文件夹名换成带版本号的（可能需要一次 UAC 授权）——',
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}" -Parent "${plan.parent}" -Old "${plan.oldName}" -New "${plan.newName}"`
    ] : []),
    'set "TARGET="',
    ...(needRename ? [`if exist "${join(targetNew, exeName)}" set "TARGET=${targetNew}"`] : []),
    `if not defined TARGET set "TARGET=${dst}"`,
    'start "" "%TARGET%\\' + exeName + '"',
    'rem —— 收尾：把整个工作目录（apply-update.bat + rename-folder.ps1）删干净 ——',
    'rem 两个坑（都踩过，别改回去）：',
    'rem   ① 不能写在 exit 之后 —— 那样永远执行不到（老版本就是这么留了一行死代码）；',
    'rem   ② 不能在同一个 cmd 里直接删自己 —— 脚本正在被 cmd 读，文件是锁着的，',
    'rem      所以用 start /b 起一个**独立进程**，等 3 秒后连目录一起删。',
    'set "BC_WORKDIR=%~dp0."',
    'start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Remove-Item -LiteralPath $env:BC_WORKDIR -Recurse -Force -ErrorAction SilentlyContinue"',
    'exit /b 0'
  ].join('\r\n');
  writeFileSync(batPath, bat, 'utf-8');
  return batPath;
}

/** macOS / Linux：rsync（优先）或 tar 覆盖 → 删掉 .update → 改名 → 启动新程序 */
function writePosixScript(workDir: string, updateDir: string, src: string, dst: string, plan: RenamePlan): string {
  const shPath = join(workDir, 'apply-update.sh');
  const execPath = process.execPath;
  const targetNew = join(plan.parent, plan.newName);
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
  if (plan.oldName !== plan.newName) {
    lines.push(
      '# —— 把程序文件夹名换成带版本号的 ——',
      `PARENT="${plan.parent}"`,
      `OLD="${plan.oldName}"`,
      `NEW="${plan.newName}"`,
      'if [ -d "$PARENT/$OLD" ] && [ ! -e "$PARENT/$NEW" ]; then mv "$PARENT/$OLD" "$PARENT/$NEW" 2>/dev/null || true; fi',
      `TARGET="${dst}"`,
      `[ -d "${targetNew}" ] && TARGET="${targetNew}"`
    );
  } else {
    lines.push(`TARGET="${dst}"`);
  }
  if (process.platform === 'darwin') {
    // macOS：TARGET 就是 .app 包路径本身（见 finishUpdateFromZip 里 syncDst 的计算）
    lines.push(`open -n "$TARGET" 2>/dev/null || (nohup "${execPath}" >/dev/null 2>&1 &)`);
  } else {
    lines.push(`nohup "$TARGET/$(basename "${execPath}")" >/dev/null 2>&1 &`);
  }
  // 收尾：连工作目录一起删（不只是脚本自己）——POSIX 允许删除正在执行的脚本本身，
  // 文件句柄在 unlink 后依然有效，后面的行照样能跑完。
  lines.push('rm -rf "$(dirname "$0")"');
  writeFileSync(shPath, lines.join('\n') + '\n', 'utf-8');
  try { chmodSync(shPath, 0o755); } catch { /* 忽略 */ }
  return shPath;
}
