import { app, BrowserWindow, ipcMain, Menu, protocol, net, shell, nativeTheme, session } from 'electron';
import { join, dirname } from 'node:path';
import { mkdirSync, readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isAbsolutePathAny, runtimeTempDir } from './paths';
import * as pathUtils from './paths';
import { dataRoot, initDataDirectories, readAppConfig } from './userData';
import { runStartupCleanup } from './storage';
import { migrateAllProjectFilesAsync } from './projectFile';
import * as projectFileApi from './projectFile';
// v0.4.6（R6-4）：IPC 按域拆到 ipc/* —— 这里只留注册调用
import { registerExportIpc } from './ipc/export';
import { registerExtensionIpc, extRoot } from './ipc/extensions';
import { registerProjectIpc } from './ipc/project';
import { registerUpdateIpc } from './ipc/update';
import { registerDataIpc } from './ipc/data';
import { registerSystemIpc } from './ipc/system';
// v0.4.6（R6-18）：媒体编码探测 —— 挂 <video> 之前先读容器头，避开原生解码器报错
import { probeCodec, codecAdvice } from './codecProbe';
// v0.4.5：工程素材（保存时收集本地图片/视频进容器，打开时解包到缓存）
import { resolveCachedAsset, resolveThumbPath } from './assets';
import { getLocalVersion, getAppStage, ulog } from './updater';
import { flushTasksOnQuit } from './tasks';
// v0.4.6：窗口改为无系统标题栏，菜单模板搬到 ./menu.ts（标题栏自绘，这里只负责快捷键）
import { buildAppMenu } from './menu';

// 启动最优先：初始化纯便携数据区 data/，隔离系统盘
initDataDirectories();

/**
 * v0.4.5 第 12 批：**自动化模式下"窗口在屏幕外也要继续渲染"**。
 *
 * 窗口被移到屏幕外（或最小化、或被别的窗口完全遮住）时，Chromium 默认会认为
 * "用户看不到"，于是停掉合成器与 rAF —— 后果是截图空白、动画冻住、加载页收不了尾。
 * 这三个开关正是关掉那套省电逻辑。只在安静模式加，正常启动完全不受影响。
 */
if (process.env['BC_NO_FOCUS'] === '1') {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

// 把运行时临时目录也收进程序目录（便携化）：Chromium 内核/下载暂存等一律写 <data>/tmp/system。
// 必须在 app ready **之前**设置才生效；不可写时自动退回系统 Temp（resolveWritableDir 已兜底）。
try {
  if (readAppConfig().usePortableTemp !== false) {
    const rt = runtimeTempDir();
    mkdirSync(rt, { recursive: true });
    app.setPath('temp', rt);
  }
} catch { /* 失败就用系统 Temp，不影响功能 */ }

// 探针钩子：开发态把跨平台路径工具挂到主进程 global，E2E 可用 app.evaluate 直接验证
// （打包态不挂，避免把内部工具暴露给正式产物）
if (!app.isPackaged) {
  (globalThis as unknown as Record<string, unknown>)['__bcPaths'] = pathUtils;
  (globalThis as unknown as Record<string, unknown>)['__bcProjectFile'] = projectFileApi;
  // v0.4.6（R6-18）：编码探测是"读二进制头"的活，靠 E2E 黑盒太贵 —— 挂出来直接单测
  (globalThis as unknown as Record<string, unknown>)['__bcCodec'] = {
    probe: (filePath: string, ext: string) => probeCodec(filePath, ext),
    advice: (codecs: string[]) => codecAdvice(codecs)
  };
}

// electron-vite 在 dev 模式下注入 ELECTRON_RENDERER_URL；
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

/**
 * 是否处于"安静启动"模式（自动化脚本/探针/截图用）。
 *
 * v0.4.5 第 12 批：窗口**从创建起就不可激活**（见 createWindow 里的 focusable:false），
 * 这样 Windows 的"空闲时把后台窗口顶到前台"也不会发生。
 * 主进程里所有会抢前台的动作（focus / restore / show）都要先问这个开关。
 */
function isQuietLaunch(): boolean {
  return process.env['BC_NO_FOCUS'] === '1';
}

// ============ 应用图标（窗口 / 任务栏 / 原生弹窗 / 子窗口统一用三色 Logo） ============
// v0.4.5 修复：以前只有主窗口传了 icon，原生文件对话框、开发者工具这类"单独弹出的窗口"
// 会回落到 Electron 默认原子图标（用户看到的任务栏里两个图标不一致）。
// 现在：① 应用级 AppUserModelID 提前到 ready 之前设置；② 任何新建窗口（含 DevTools）在
// browser-window-created 里统一补图标；③ 所有 dialog 都挂到主窗口上（模态 + 继承窗口图标）。
function appIconPath(): string | null {
  const p = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icon.png');
  return existsSync(p) ? p : null;
}

// ============ 本地图片协议 ============
protocol.registerSchemesAsPrivileged([
  { scheme: 'bc-img', privileges: { standard: true, secure: true } }
]);

// ============ 「双击 .bcproj 直接用 BlockCanvas 打开」 ============
//
// 用户反馈：「直接打开 .bcproj 后缀的项目现在完全不会」。查下来是两段都缺：
//   ① 打包配置里已经登记了文件关联（electron-builder fileAssociations），
//      但主进程**从来没有读过命令行参数** —— 双击时 Windows 会把文件路径塞进 argv[1]，
//      程序照常启动、照常恢复会话，那个路径被直接丢掉了；
//   ② 没有单实例锁：文件已经被打开着时再双击一个工程，会**再起一个进程**
//      （两个进程同时写 data/ 目录，风险很大）。
//
// 现在：单实例锁 + 三种入口（首次启动的 argv / 第二个实例的 argv / macOS 的 open-file）
// 统一走 openProjectFromOs()，最终给渲染进程发 `bc:open-project-path`。
let pendingOsOpenPath: string | null = null;

/** 从命令行里挑出 .bcproj 路径（跳过 - 开头的开关；不认其它扩展名，避免误开无关文件） */
function extractProjectPathFromArgv(argv: string[]): string | null {
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-')) continue;
    const p = a.replace(/^"|"$/g, '');
    if (!/\.bcproj$/i.test(p)) continue;
    if (existsSync(p)) return p;
  }
  return null;
}

/** 把"要打开哪个工程"这件事交给渲染进程；窗口还没建好就先记下来，等它加载完再发 */
function openProjectFromOs(p: string | null) {
  if (!p) return;
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.webContents.isLoading()) {
    pendingOsOpenPath = p;
    return;
  }
  // v0.4.5：自动化模式下**不要** restore/focus —— 那两步正是"突然弹到最前面"的来源
  if (!isQuietLaunch()) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  win.webContents.send('bc:open-project-path', p);
}

/** 窗口加载完成时把"启动时攒下的待打开工程"发出去 */
function flushPendingOsOpen() {
  if (!pendingOsOpenPath) return;
  const p = pendingOsOpenPath;
  pendingOsOpenPath = null;
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send('bc:open-project-path', p);
}

// 单实例：拿不到锁说明已经有一个在跑 → 把参数交给那个实例，自己退出
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    openProjectFromOs(extractProjectPathFromArgv(argv));
  });
  // macOS：Finder 里双击文档走的是 open-file 事件（不是 argv）
  app.on('open-file', (e, p) => {
    e.preventDefault();
    openProjectFromOs(p);
  });
}

// ============ 启动加载页的**真实**进度通道 ============
// 用户要求：「做一个加载的页面，可以包含 BlockCanvas 的 Logo，显示真实的加载进度，
//           与主界面要过渡丝滑。」
// 这里只负责"报数"：每一步真的有进展才发一条，绝不用定时器凑进度。
export function emitLoad(id: string, label: string, percent: number) {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('bc:load-progress', { id, label, percent: Math.max(0, Math.min(100, Math.round(percent))) });
    }
  } catch { /* 窗口没了就算了 */ }
}


async function createWindow() {
  // 字体库需要 Local Font Access API（window.queryLocalFonts）：
  // 默认权限策略会拒绝 'local-fonts'，这里显式放行（只读字体族名，无文件访问）。
  // （Electron 33 的类型定义尚未收录 'local-fonts'，用字符串比较。）
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback((permission as string) === 'local-fonts');
  });

  // 窗口/任务栏图标：统一用三色 Logo（路径见 appIconPath，开发态 build/icon.png，
  // 打包态 resources/icon.png —— build/** 不进 asar，以前打包后这里找不到文件，
  // 任务栏就回落到 exe 的旧图标）。
  const iconPath = appIconPath();

  /**
   * v0.4.5 第 12 批（第 4 次修复）：**移到屏幕外 + 显示但不激活**。
   *
   * 用户三次反馈的演进：
   *   1. `showInactive()`：不抢焦点，但窗口**仍盖在屏幕上**（z 序在最前）→ "每次打开都要在最上面"。
   *   2. `focusable:false`（WS_EX_NOACTIVATE）：真不抢前台了，但**最小化按钮失效**（用户报的）。
   *   3. `minimize()` 最小化启动：不打扰了，但 Chromium 会**暂停渲染** →
   *      截图空白 / rAF 停摆 / 加载页收不了尾（探针直接红了，这是真 BUG 不是测试问题）。
   *
   * 所以现在：**窗口正常显示（可最小化、可还原、按钮全好）+ 移到屏幕外 + 不激活**。
   *   · `showInactive()`  → 不夺焦点，系统也不会把它顶到你面前；
   *   · `setPosition(-32000, -32000)` → 屏幕上什么都看不到，不挡任何东西；
   *   · 配合下面三条 Chromium 开关 → 即使"在屏幕外/被判遮挡"也**照常渲染**，
   *     所以截图、动画、加载页全都正常；
   *   · 任务栏图标保留（用户点它就能把窗口叫回来，位置也在屏幕内）。
   *
   * 正常双击启动（没有 BC_NO_FOCUS）行为完全不变。
   */
  const noFocus = process.env['BC_NO_FOCUS'] === '1';
  /**
   * v0.4.6（R6-7）：外壳最小宽度从 960 放开到 360。
   *
   * 以前锁 960：编辑器外壳根本压不到手机宽度，所以"窄屏外壳"这件事**根本不存在**
   * （不是做得不好）。现在放开，才能：
   *   · 在竖屏显示器上按 412×915 / 390×844 验收真实手机布局；
   *   · 为 Web 版与将来的安卓外壳打基础。
   *
   * 900 以下由渲染层切 `data-shell="narrow"`（左右面板改抽屉 / 覆盖层）。
   * 开发态可以用环境变量 BC_MIN_WIN_WIDTH 临时调（探针固定窗口尺寸时会用到）。
   */
  const minWinW = Math.max(320, Number(process.env['BC_MIN_WIN_WIDTH'] ?? 360) || 360);
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: minWinW,
    minHeight: 560,
    title: 'BlockCanvas 积木画布',
    ...(iconPath ? { icon: iconPath } : {}),
    backgroundColor: '#f3f3f3',
    /**
     * v0.4.6：**去掉系统标题栏**（用户：上边那条整条都是主题色，很难看；
     * 三个窗口按钮又小又丑，文件/编辑/视图应当放进自己画的那条栏里）。
     *
     * frame:false 之后：
     *   · 系统不再画标题栏和菜单条 —— Windows 11 会把强调色铺满整条，这正是要消掉的；
     *   · 窗口拖拽 / 双击最大化 / 边缘缩放由渲染层的 -webkit-app-region 与原生 thickframe 负责；
     *   · 菜单仍然注册（见 ./menu.ts），只为保住 Ctrl+S / F1 / F12 这些 accelerator。
     */
    frame: false,
    // 自动化模式：先不显示（首帧就绪后再"不激活地显示 + 移到屏幕外"）
    ...(noFocus ? { show: false, skipTaskbar: false } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 窗口在屏幕外/被遮挡时也不要让 Chromium 停掉渲染（否则截图空白、rAF 停摆）
      ...(noFocus ? { backgroundThrottling: false } : {})
    }
  });
  // Windows 任务栏分组/图标缓存按 AppUserModelID 走，显式设成和 electron-builder 一致的 appId
  if (process.platform === 'win32') app.setAppUserModelId('com.blockcanvas.app');

  Menu.setApplicationMenu(buildAppMenu(win));

  // v0.4.6：自绘标题栏要知道"现在是不是最大化"（决定按钮图标与窗口圆角/描边）。
  // 双击标题栏、Win+↑、拖到屏幕顶端都会最大化 —— 那些都不是从我们界面点的，
  // 所以必须由主进程主动推，界面才跟得上。
  const pushWinState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('bc:win-state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
  };
  win.on('maximize', pushWinState);
  win.on('unmaximize', pushWinState);
  win.on('enter-full-screen', pushWinState);
  win.on('leave-full-screen', pushWinState);

  // —— 阻止"应用内导航"（v0.4.4e）——
  // 帮助文档里的超链接（相对路径 / 锚点）若交给浏览器默认行为，会真的把整个窗口导航走
  //（dev 下就会跳到 http://localhost/...，用户看到的正是这个）。这里统一拦掉：
  // 需要打开外链的地方一律走 shell:open-external（只放行 http/https，用系统浏览器打开）。
  win.webContents.on('will-navigate', (e, url) => {
    const dev = devServerUrl;
    if (dev && url.startsWith(dev)) return;   // 开发态热更新允许
    if (url.startsWith('file://')) return;    // 本地文件（打包态页面）允许
    e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  ipcMain.on('theme:set-source', (_evt, source: unknown) => {
    nativeTheme.themeSource = source === 'dark' || source === 'light' ? source : 'system';
  });

  // v0.4.5：加载完成后把"启动时攒下的待打开工程"（双击 .bcproj 启动的那条路径）发给渲染进程。
  // 放在 did-finish-load 而不是 loadURL 之后立刻发：渲染进程的监听器要等 React 挂载才有。
  win.webContents.on('did-finish-load', () => { flushPendingOsOpen(); });

  // 自动化模式：**不激活地显示，并移到屏幕外**（屏幕上什么都不出现，但渲染照常）。
  //
  // 顺序很关键：先 showInactive（此时窗口还在屏幕内、不抢焦点），再移到屏幕外 ——
  // 反过来（先移出去再 show）在某些 Windows 版本上会让窗口"从未映射"，截图拿不到画面。
  if (noFocus) {
    const park = () => {
      if (win.isDestroyed()) return;
      try {
        if (!win.isVisible()) win.showInactive();
        win.setPosition(-32000, -32000, false);
        win.setSkipTaskbar(false);   // 保住任务栏图标
      } catch { /* 忽略 */ }
    };
    win.once('ready-to-show', park);
    win.webContents.once('did-finish-load', () => {
      setTimeout(park, 0);
      setTimeout(park, 500);
    });
  }

  if (devServerUrl) {
    await win.loadURL(devServerUrl);
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// ============ 数据区与存储统计（data:*） ============
// v0.4.6（R6-4）：整块搬到 ipc/data.ts（它要用 extRoot，所以放在扩展模块之后）
registerDataIpc();

// 「打开 zip 所在的文件夹」用：给一个文件路径就定位到它，给目录就打开目录。
// 帮助中心里的外链（GitHub / 文档站）用系统默认浏览器打开。
// 只放行 http/https —— 避免被别的协议（file:、自定义 scheme）当跳板用。
ipcMain.handle('shell:open-external', async (_evt, url: string) => {
  try {
    if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: '只允许打开 http / https 链接' };
    await shell.openExternal(url);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || '打开失败' };
  }
});

ipcMain.handle('data:open-path', async (_evt, target: string) => {
  const p = target === 'data' ? dataRoot() : target === 'extensions' ? extRoot() : join(dataRoot(), target);
  return shell.openPath(p);
});
// ============ 系统集成（shell:* · help:* · cfg:* · preview:* · pick-src） ============
// v0.4.6（R6-4）：整块搬到 ipc/system.ts
registerUpdateIpc();
registerProjectIpc();
registerExportIpc();
registerExtensionIpc();
registerSystemIpc();

/** bc-img 协议要按扩展名给 Content-Type（视频缺它会被 Chromium 当二进制拒绝播放） */
const MEDIA_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', ogg: 'video/ogg', mov: 'video/quicktime'
};
function mediaMimeOf(p: string): string {
  const ext = (p.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]) ?? '';
  return MEDIA_MIME[ext] ?? 'application/octet-stream';
}

app.whenReady().then(() => {
  // 启动就记一条：出问题时至少能确认"是不是这个版本、这个时间开的"
  ulog(`应用启动 v${getLocalVersion()}（${getAppStage()}）`);
  // 应用级身份：必须在任何窗口/弹窗出现之前设置，任务栏才会把主窗口、原生对话框、
  // 开发者工具都归到同一个 BlockCanvas 图标下（而不是其中一个变成 Electron 原子）。
  if (process.platform === 'win32') app.setAppUserModelId('com.blockcanvas.app');

  // 兜底：任何后建的窗口（DevTools、预览子窗、将来的多窗口）没显式给 icon 时补上三色 Logo。
  // 用 'once' 不行——每建一个窗口都要生效，所以是常驻监听；已设过 icon 的窗口不覆盖。
  app.on('browser-window-created', (_e, w) => {
    const icon = appIconPath();
    if (!icon) return;
    try {
      if (!w.isDestroyed()) w.setIcon(icon);
    } catch { /* 某些窗口类型不支持 setIcon，忽略 */ }
  });

  protocol.handle('bc-img', async (request) => {
    try {
      const url = new URL(request.url);
      // v0.4.5：bc-img://asset/<hash>.<ext> —— 工程容器里的素材（开机解包到缓存目录）。
      // 这是"换机器不丢图"的关键：引用不再指向某台电脑上的绝对路径。
      if (url.host === 'asset') {
        // v0.4.5 第 10 批：`?thumb=256` → 返回磁盘上的缩略图。
        // 素材库网格每格只显示 62px 高，没必要为它解码 4K 原图（每张约 33MB RGBA）。
        // 缩略图生成失败（损坏/不支持格式）就往下走原图，绝不让素材"消失"。
        if (url.searchParams.has('thumb')) {
          const thumbPath = resolveThumbPath(decodeURIComponent(url.pathname));
          if (thumbPath && existsSync(thumbPath)) {
            const buf = readFileSync(thumbPath);
            return new Response(buf, {
              status: 200,
              headers: {
                'Content-Type': 'image/jpeg',
                'Content-Length': String(buf.length),
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=31536000, immutable'
              }
            });
          }
        }
        const cached = resolveCachedAsset(decodeURIComponent(url.pathname));
        if (!cached) return new Response(null, { status: 404 });
        const buf = readFileSync(cached);
        return new Response(buf, {
          status: 200,
          headers: {
            'Content-Type': mediaMimeOf(cached),
            'Content-Length': String(buf.length),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        });
      }
      let rawPath = decodeURIComponent(url.pathname.replace(/^\/file\//i, '').replace(/^\//, ''));
      if (!rawPath) return new Response(null, { status: 400 });

      // 如果是相对路径，自动基于当前项目目录 / app 根目录 / data 目录解析
      // （绝对路径判断用跨平台版：Windows 盘符 / UNC 与 POSIX 的 `/xxx` 都算绝对路径）
      if (!isAbsolutePathAny(rawPath)) {
        const cleanRel = rawPath.replace(/^\.?\/+/, '');
        const candidates = [
          join(dataRoot(), 'projects', cleanRel),
          join(dataRoot(), cleanRel),
          join(app.getAppPath(), cleanRel),
          join(dirname(process.execPath), cleanRel)
        ];
        for (const cand of candidates) {
          if (existsSync(cand)) {
            rawPath = cand;
            break;
          }
        }
      }

      if (!existsSync(rawPath)) return new Response(null, { status: 404 });
      const mime = mediaMimeOf(rawPath);
      // CORS 放开：首页要采样画面算平均亮度（canvas.getImageData 不能读跨域污染的画布）；
      // 图片/视频都是用户自己机器上的文件，放开只读没有安全影响。
      const cors: Record<string, string> = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        'Accept-Ranges': 'bytes'
      };

      // —— Range 请求（视频拖动进度 / 边下边播）——
      // 以前直接 net.fetch(file://) 不支持 206，Chromium 的视频解码器拿不到分段 → 一片白。
      const range = request.headers.get('Range');
      if (range) {
        const st = statSync(rawPath);
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= st.size) end = st.size - 1;
        if (start > end) {
          return new Response(null, { status: 416, headers: { ...cors, 'Content-Range': `bytes */${st.size}` } });
        }
        const len = end - start + 1;
        const buf = Buffer.alloc(len);
        const fd = openSync(rawPath, 'r');
        try { readSync(fd, buf, 0, len, start); } finally { closeSync(fd); }
        return new Response(buf as any, {
          status: 206,
          headers: {
            ...cors,
            'Content-Type': mime,
            'Content-Length': String(len),
            'Content-Range': `bytes ${start}-${end}/${st.size}`
          }
        });
      }

      const res = await net.fetch(pathToFileURL(rawPath).toString());
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      const ct = headers.get('Content-Type');
      if (!ct || ct === 'application/octet-stream') headers.set('Content-Type', mime);
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response(null, { status: 400 });
    }
  });

  createWindow();

  // 首次启动时若命令行里带了 .bcproj（双击文件启动），窗口还没加载完 → 先记下，
  // did-finish-load 时再发给渲染进程。
  {
    const fromArgv = extractProjectPathFromArgv(process.argv);
    if (fromArgv) {
      pendingOsOpenPath = fromArgv;
      ulog(`启动参数里带工程文件：${fromArgv}`);
    }
  }

  // 启动自愈：清我们自己在系统 Temp 里留下的文件（默认开）/ Chromium 缓存 / 孤立快照。
  // 必须在这里（app ready 之后）：storage 里要用到 session，且 userData 已重定向到 data/user-data。
  void runStartupCleanup();

  // 后台静默迁移：老版本留下的纯 JSON .bcproj → v2 ZIP 容器。
  // 幂等（已是容器的只看 4 字节就跳过），**这段代码长期保留**。
  //
  // ⚠ 两个约束（都踩过坑，别改回去）：
  //   1. 必须**分片让出事件循环**（migrateAllProjectFilesAsync）——同步跑满会把主进程占住，
  //      那一瞬 Chromium 的输入事件会丢，表现为"鼠标在上面悬停提示却不弹"；
  //   2. 延迟到启动 3 秒后 —— 躲开"窗口刚出来、用户/探针正在交互"的那一段。
  setTimeout(() => {
    void (async () => {
      try {
        const stats = await migrateAllProjectFilesAsync(join(dataRoot(), 'projects'), join(dataRoot(), 'backups'));
        if (stats.migrated > 0 || stats.failed > 0) {
          console.log('[project-migrate]', JSON.stringify(stats));
        }
      } catch (e) {
        console.warn('[project-migrate] 失败：', (e as Error).message);
      }
    })();
  }, 3000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 退出前把后台任务落盘：正在跑的任务标成"已中断"（分片文件保留），
// 下次启动时用户可以在工具栏「任务」按钮里看到它并点「继续」。
app.on('before-quit', () => {
  try { flushTasksOnQuit(); } catch { /* 忽略 */ }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
