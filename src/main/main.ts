import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell, nativeTheme, session, type MenuItemConstructorOptions } from 'electron';
import { join, basename, dirname, relative } from 'node:path';
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync, cpSync, unlinkSync, statSync, renameSync, openSync, readSync, closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isAbsolutePathAny, resolveInside, toWebPath, previewDir, runtimeTempDir } from './paths';
import * as pathUtils from './paths';
import { zipCreate, zipList } from './zip';
import {
  dataRoot, initDataDirectories, readAppConfig, writeAppConfig, listProjects,
  listProjectBackups, saveProjectSnapshotFile, deleteProjectBackupFolder
} from './userData';
import { readSession, writeSession } from './session';
import {
  getStorageStats, getStorageBreakdown, clearStorageCategory, clearAllCleanable,
  clearOrphanBackups, runStartupCleanup, enforceStorageBudgets, DEFAULT_PREVIEW_KEEP
} from './storage';
import {
  readProject, writeProject, readManifestOnly, migrateAllProjectFilesAsync
} from './projectFile';
import * as projectFileApi from './projectFile';
import {
  getLocalVersion, getAppStage, fetchReleases, buildUpdateList, getMirrorInfo,
  resolveInstallDir
} from './updater';
import {
  listTasks, startTask, pauseTask, resumeTask, cancelTask, dismissTask, revealTask,
  flushTasksOnQuit
} from './tasks';

// 启动最优先：初始化纯便携数据区 data/，隔离系统盘
initDataDirectories();

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
}

// electron-vite 在 dev 模式下注入 ELECTRON_RENDERER_URL；
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

// ============ 本地图片协议 ============
protocol.registerSchemesAsPrivileged([
  { scheme: 'bc-img', privileges: { standard: true, secure: true } }
]);

// ============ 自定义中文菜单 ============
function buildMenu(win: BrowserWindow): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建项目标签 (New Tab)',
          accelerator: 'CmdOrCtrl+N',
          click: () => win.webContents.send('menu:new-tab')
        },
        {
          label: '打开项目 (.bcproj)…',
          accelerator: 'CmdOrCtrl+O',
          click: () => win.webContents.send('menu:open-project')
        },
        {
          label: '保存项目 (.bcproj)',
          accelerator: 'CmdOrCtrl+S',
          click: () => win.webContents.send('menu:save-project')
        },
        {
          label: '项目另存为…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => win.webContents.send('menu:save-project-as')
        },
        { type: 'separator' },
        {
          label: '导出 HTML 网页…',
          accelerator: 'CmdOrCtrl+E',
          click: () => win.webContents.send('menu:export-html')
        },
        {
          label: '在浏览器中预览',
          accelerator: 'CmdOrCtrl+P',
          click: () => win.webContents.send('menu:preview')
        },
        { type: 'separator' },
        {
          label: '浏览本地项目库 (data/projects/)',
          click: () => shell.openPath(join(dataRoot(), 'projects'))
        },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => win.webContents.send('menu:undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: () => win.webContents.send('menu:redo') },
        { type: 'separator' },
        { label: '复制元素', accelerator: 'CmdOrCtrl+C', click: () => win.webContents.send('menu:copy') },
        { label: '剪切元素', accelerator: 'CmdOrCtrl+X', click: () => win.webContents.send('menu:cut') },
        { label: '粘贴元素', accelerator: 'CmdOrCtrl+V', click: () => win.webContents.send('menu:paste') },
        { label: '原地副本', accelerator: 'CmdOrCtrl+D', click: () => win.webContents.send('menu:duplicate') },
        { label: '删除元素', accelerator: 'Delete', click: () => win.webContents.send('menu:delete') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '使用手册（帮助中心）', accelerator: 'F1', click: () => win.webContents.send('menu:help') },
        { type: 'separator' },
        { label: '键盘快捷键速查表', accelerator: 'Shift+/', click: () => win.webContents.send('menu:shortcuts') },
        { label: '检测更新…', click: () => win.webContents.send('menu:check-update') },
        { type: 'separator' },
        { label: '关于 BlockCanvas', click: () => win.webContents.send('menu:about') }
      ]
    },
    {
      label: '设置',
      submenu: [
        { label: '偏好设置…', accelerator: 'CmdOrCtrl+,', click: () => win.webContents.send('menu:settings') },
        { type: 'separator' },
        { label: '左侧布局（元素面板在左）', click: () => win.webContents.send('menu:layout-left') },
        { label: '底部布局（元素面板在下方）', click: () => win.webContents.send('menu:layout-bottom') },
        { type: 'separator' },
        { label: '插件与资源包…', click: () => win.webContents.send('menu:ext') },
        { label: '打开便携数据文件夹 (data/)…', click: () => shell.openPath(dataRoot()) },
        { label: '打开扩展文件夹 (extensions/)…', click: () => shell.openPath(extRoot()) },
        { type: 'separator' },
        { label: '检测更新…', click: () => win.webContents.send('menu:check-update') },
        { type: 'separator' },
        { label: '类名 / ID 总览…', click: () => win.webContents.send('menu:class-manager') }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

async function createWindow() {
  // 字体库需要 Local Font Access API（window.queryLocalFonts）：
  // 默认权限策略会拒绝 'local-fonts'，这里显式放行（只读字体族名，无文件访问）。
  // （Electron 33 的类型定义尚未收录 'local-fonts'，用字符串比较。）
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback((permission as string) === 'local-fonts');
  });

  // 窗口/任务栏图标：统一用三色 Logo。
  // · 开发态：build/icon.png（仓库里就是三色 Logo）
  // · 打包态：electron-builder 通过 extraResources 把它复制到 resources/icon.png ——
  //   因为 build/** 不进 asar，以前打包后这里找不到文件，任务栏就回落到 exe 的旧图标。
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icon.png');
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'BlockCanvas 积木画布',
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    backgroundColor: '#f3f3f3',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  // Windows 任务栏分组/图标缓存按 AppUserModelID 走，显式设成和 electron-builder 一致的 appId
  if (process.platform === 'win32') app.setAppUserModelId('com.blockcanvas.app');

  Menu.setApplicationMenu(buildMenu(win));

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

  if (devServerUrl) {
    await win.loadURL(devServerUrl);
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// ============ 数据区路径与配置 IPC ============
ipcMain.handle('data:get-paths', () => ({
  dataRoot: dataRoot(),
  userDataDir: app.getPath('userData'),
  extDir: extRoot(),
  projectsDir: join(dataRoot(), 'projects'),
  backupsDir: join(dataRoot(), 'backups')
}));

ipcMain.handle('data:get-storage-stats', () => getStorageStats());
// 分类占用明细（统计与清理共用同一份清单 → 不会再出现"显示的和清的不是一回事"）
ipcMain.handle('data:get-storage-breakdown', () => getStorageBreakdown());
ipcMain.handle('data:clear-category', (_e, id: string) => clearStorageCategory(id as never));
ipcMain.handle('data:clear-all-cleanable', () => clearAllCleanable());
// 兼容旧入口（一键清缓存 = 清"可清"的那几类）
ipcMain.handle('data:clear-cache', () => clearAllCleanable());
ipcMain.handle('data:clear-orphan-backups', () => clearOrphanBackups());
// 预算兜底（探针可直接调，验证"下载目录 / 临时区有上限"）
ipcMain.handle('data:enforce-budgets', () => enforceStorageBudgets());

// ============ 自动更新 IPC ============
ipcMain.handle('update:get-version', () => getLocalVersion());
// 「关于」页的阶段文案（来源 version.json → tools/sync-version.mjs → package.json.bcStage）
ipcMain.handle('app:get-stage', () => getAppStage());

ipcMain.handle('update:check', async () => {
  const localVer = getLocalVersion();
  // per_page=100：够覆盖"当前版本 + 往前 5 个 + 往后的全部版本"
  const fetched = await fetchReleases(100);
  if (!fetched) {
    return {
      ok: false,
      isDev: !app.isPackaged,
      localVersion: localVer,
      platform: process.platform,
      mirrors: getMirrorInfo(),
      error: '三个来源都连不上（NexaCode 镜像 / gh-proxy 镜像 / GitHub 直连）。请检查网络，并关闭 Watt Toolkit / Clash 等后台代理后重试。'
    };
  }
  const built = buildUpdateList(localVer, fetched.list, fetched.source);
  return {
    ok: true,
    isDev: !app.isPackaged,
    platform: process.platform,
    mirrors: getMirrorInfo(),
    ...built
  };
});

ipcMain.handle('update:apply', async (_evt, assetUrl: string, fileName: string, version: string, tag: string) => {
  if (!assetUrl) return { ok: false, error: '未找到下载地址' };
  if (!app.isPackaged) {
    return { ok: false, error: '当前处于源码开发模式（pnpm dev），没有可替换的安装目录。自动更新仅对打包后的便携版生效。' };
  }
  // v0.4.4：更新也是一个「后台任务」（可暂停/续传/取消，进度在工具栏「任务」按钮里也看得到）。
  // 下载包就放在安装目录的 .update/ 下，替换脚本用完会连目录一起删掉。
  const t = startTask({
    kind: 'update',
    url: assetUrl,
    fileName: fileName || 'update.zip',
    title: `更新到 v${version || ''}`.trim(),
    tag,
    version,
    destDir: join(resolveInstallDir(), '.update')
  });
  return { ok: true, taskId: t.id };
});

// 「下载 zip」：只落盘到 data/downloads/，不替换程序 —— 同样是后台任务，
// 于是可以随时暂停/继续，也能在工具栏「任务」按钮里看到它，重启后记录还在。
ipcMain.handle('update:download-asset', async (_evt, assetUrl: string, fileName: string, tag?: string, title?: string) => {
  if (!assetUrl) return { ok: false, error: '缺少下载地址' };
  const t = startTask({ kind: 'download', url: assetUrl, fileName, tag, title });
  return { ok: true, taskId: t.id, path: t.dest };
});

// ============ 后台任务 IPC（下载 / 更新的统一出口） ============
ipcMain.handle('task:list', () => listTasks());
ipcMain.handle('task:pause', (_evt, id: string) => { pauseTask(id); return listTasks(); });
ipcMain.handle('task:resume', (_evt, id: string) => { resumeTask(id); return listTasks(); });
ipcMain.handle('task:cancel', (_evt, id: string) => { cancelTask(id); return listTasks(); });
ipcMain.handle('task:dismiss', (_evt, id: string) => { dismissTask(id); return listTasks(); });
ipcMain.handle('task:reveal', async (_evt, id: string) => {
  const err = await revealTask(id);
  return { ok: !err, error: err || undefined };
});
// 「打开 zip 所在的文件夹」用：给一个文件路径就定位到它，给目录就打开目录。
ipcMain.handle('shell:reveal', async (_evt, p: string) => {
  if (!p) return { ok: false, error: '缺少路径' };
  try {
    if (existsSync(p) && statSync(p).isDirectory()) return { ok: !(await shell.openPath(p)) };
    shell.showItemInFolder(p);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || '打开失败' };
  }
});

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

// ============ 帮助文档（项目介绍 / 使用手册 / 开发历程） ============
// 「打包时硬编码、运行时直读」：
//   · 打包版（asar）里没有这些 .md（electron-builder 排除了 docs/**，根目录也只剩 out/**），
//     渲染层用的是构建时内联进去的那几份（vite `?raw`）；
//   · 开发态（pnpm dev）则走这里**实时读盘**，改完文档刷新就能看到，不用重新构建。
const HELP_DOCS: Record<string, string> = {
  intro: 'README.md',
  manual: 'docs/使用手册.md',
  history: 'docs/开发历程.md'
};
ipcMain.handle('help:get-doc', (_evt, key: string) => {
  if (app.isPackaged) return { ok: false, bundled: true };
  const rel = HELP_DOCS[key];
  if (!rel) return { ok: false, source: 'none', error: '未知文档' };
  const candidates = [
    join(app.getAppPath(), rel),
    join(process.cwd(), rel)
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const text = readFileSync(p, 'utf-8');
        return { ok: true, text, path: p, source: 'disk' };
      }
    } catch { /* 试下一个 */ }
  }
  return { ok: false, source: 'none' };
});
// 兼容旧调用（只读 README）
ipcMain.handle('help:get-readme', () => {
  if (app.isPackaged) return { ok: false, bundled: true };
  const candidates = [
    join(app.getAppPath(), 'README.md'),
    join(process.cwd(), 'README.md')
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const text = readFileSync(p, 'utf-8');
        return { ok: true, text, path: p, source: 'disk' };
      }
    } catch { /* 试下一个 */ }
  }
  return { ok: false, source: 'none' };
});
// 帮助页里的相对图片（docs/screenshots/xxx.png）在开发态指向仓库里的真实文件
ipcMain.handle('help:get-root', () => (app.isPackaged ? '' : app.getAppPath()));

ipcMain.handle('cfg:get', () => readAppConfig());
ipcMain.handle('cfg:set', (_evt, patch: Record<string, any>) => writeAppConfig(patch));

// ============ 项目工程管理 (.bcproj) ============
ipcMain.handle('project:list', () => listProjects());

/**
 * 工程名 → 安全文件名：**保留中文等 Unicode 字符**，只剔除 Windows 文件名的非法字符。
 * （修复：以前用 sanitizeId 只留 a-z0-9，中文名整个被清空 → 首次保存弹出的默认文件名
 *   永远是 "project.bcproj"。文件名不是元素 ID，就该让"演示站点"存成"演示站点.bcproj"。）
 */
function safeFileName(s: string): string {
  return (s || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')   // Windows 非法字符 → 空格
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')        // 首尾的点/空格（Windows 不允许结尾带点）
    .slice(0, 80);
}

// 重命名工程文件（项目中心里的"改文件名"）：只改磁盘文件名，**不改**容器内的项目名
// —— 项目名（标签页）与文件名是两个东西，分开管理（用户口径）。
ipcMain.handle('project:rename', async (_evt, oldFileName: string, newName: string) => {
  try {
    const base = safeFileName(String(newName || '').replace(/\.bcproj$/i, ''));
    if (!base) return { ok: false, error: '文件名无效' };
    const dir = join(dataRoot(), 'projects');
    const from = join(dir, oldFileName);
    const to = join(dir, `${base}.bcproj`);
    if (!existsSync(from)) return { ok: false, error: '找不到工程文件' };
    if (to !== from && existsSync(to)) return { ok: false, error: '同名文件已存在' };
    renameSync(from, to);
    return { ok: true, fileName: `${base}.bcproj`, path: to };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('project:save', async (_evt, projectData: { name?: string; scene: any; meta?: any }, saveAs = false, customPath?: string) => {
  try {
    const pName = (projectData.name || '未命名网页').trim();
    const cleanName = safeFileName(pName) || 'project';
    const defaultFullDir = join(dataRoot(), 'projects');
    let targetPath = customPath;

    if (!targetPath) {
      if (saveAs) {
        // 关键修复：默认路径传入完整绝对路径，文件选择器自动跳转定位至 BlockCanvas\data\projects\
        const res = await dialog.showSaveDialog({
          title: '保存项目工程文件 (.bcproj)',
          defaultPath: join(defaultFullDir, `${cleanName}.bcproj`),
          filters: [{ name: 'BlockCanvas 工程文件', extensions: ['bcproj', 'json'] }]
        });
        if (res.canceled || !res.filePath) return { ok: false, canceled: true };
        targetPath = res.filePath;
      } else {
        // 默认存进 data/projects/
        targetPath = join(defaultFullDir, `${cleanName}.bcproj`);
      }
    }

    // 撤销历史随工程保存（v0.4.4）：sections.history = { past, future }，条数受
    // config.undoHistoryLimit 控制（默认 100，设 0 = 不保存）。ZIP 容器的多 section
    // 能力在这里派上用场：老版本程序读到不认识的 section 会忽略但保留，不会丢数据。
    const sections: Record<string, unknown> = {};
    try {
      const limit = Math.max(0, Math.floor(Number(readAppConfig().undoHistoryLimit ?? 100) || 0));
      const h = (projectData as any).history;
      if (limit > 0 && h && Array.isArray(h.past) && h.past.length > 0) {
        sections.history = {
          savedAt: new Date().toISOString(),
          limit,
          past: h.past.slice(-limit),
          future: (Array.isArray(h.future) ? h.future : []).slice(0, Math.min(limit, 50))
        };
      }
    } catch { /* 历史保存失败不影响工程保存 */ }

    // v2：写 ZIP 容器（manifest.json + scene.json），原子替换、自动继承 createdAt
    const w = writeProject(targetPath, {
      name: pName,
      scene: projectData.scene,
      meta: {
        ...(projectData.meta || {}),
        elementCount: countNodes(projectData.scene?.root)
      },
      sections
    });
    if (!w.ok) return { ok: false, error: w.error || '写入工程文件失败' };
    return { ok: true, path: targetPath, name: pName };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('project:open-file', async (_evt, customPath?: string) => {
  try {
    let targetPath = customPath;
    if (!targetPath) {
      const res = await dialog.showOpenDialog({
        title: '打开项目工程文件',
        defaultPath: join(dataRoot(), 'projects'),
        properties: ['openFile'],
        filters: [{ name: 'BlockCanvas 工程文件', extensions: ['bcproj', 'json'] }]
      });
      if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
      targetPath = res.filePaths[0];
    }
    if (!existsSync(targetPath)) return { ok: false, error: '文件不存在' };
    // v1（纯 JSON）与 v2（ZIP 容器）都能读
    const r = readProject(targetPath);
    if (!r.ok || !r.payload) return { ok: false, error: r.error || '文件不是有效的 BlockCanvas 工程文件' };
    return {
      ok: true, project: r.payload, path: targetPath, container: r.container,
      // 随工程保存的撤销历史（老工程没有这一节 → undefined）
      history: (r.payload as any)?.extraSections?.history
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('project:delete', async (_evt, fileName: string, projectName?: string) => {
  try {
    const full = join(dataRoot(), 'projects', fileName);
    let innerName = '';
    if (existsSync(full)) {
      // 容器或旧 JSON 都能取到内部 name（只读 manifest，不解 scene）
      const m = readManifestOnly(full);
      innerName = m.ok && m.manifest ? m.manifest.name : '';
      unlinkSync(full);
    }
    // 1. 按文件名清理对应快照目录
    const fBase = fileName.replace(/\.bcproj$/i, '');
    deleteProjectBackupFolder(fBase);
    // 2. 按项目内部 name 清理对应快照目录
    if (innerName && innerName !== fBase) {
      deleteProjectBackupFolder(innerName);
    }
    // 3. 按前端传入的 projectName 清理
    if (projectName && projectName !== fBase && projectName !== innerName) {
      deleteProjectBackupFolder(projectName);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// ============ 会话记忆 Session (类似 Notepad 原地自愈恢复) ============
ipcMain.handle('session:get', () => readSession());
ipcMain.handle('session:set', (_evt, sessionData: any) => writeSession(sessionData));

// ============ 自动备份与崩溃恢复 (按项目隔离专属快照) ============
ipcMain.handle('backup:save-snapshot', async (_evt, scene: any, projectName?: string, isAuto = true) => {
  try {
    const time = saveProjectSnapshotFile(scene, projectName, isAuto);
    return { ok: true, timestamp: time };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('backup:get-autosave', (_evt, projectName?: string) => {
  try {
    const folder = (projectName || '_general').trim().replace(/[\\/:*?"<>|]+/g, '_');
    const f = join(dataRoot(), 'backups', folder, 'autosave.bcproj');
    if (!existsSync(f)) return { ok: false };
    const r = readProject(f);
    if (!r.ok || !r.payload) return { ok: false };
    const stat = statSync(f);
    return { ok: true, autosave: r.payload, updatedAt: stat.mtime.toISOString(), elementCount: countNodes((r.payload.scene as any)?.root) };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('backup:list', (_evt, projectName?: string) => listProjectBackups(projectName));

ipcMain.handle('backup:clear-all', async () => {
  try {
    const bDir = join(dataRoot(), 'backups');
    if (existsSync(bDir)) {
      for (const f of readdirSync(bDir)) {
        try { unlinkSync(join(bDir, f)); } catch {}
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// ============ 导出 HTML 与同步保存项目工程 ============
ipcMain.handle('export:html', async (_evt, html: string, defaultName = 'index.html') => {
  const autoPath = process.env['BC_AUTO_EXPORT_PATH'];
  if (autoPath) {
    try {
      const dir = join(autoPath, '..');
      mkdirSync(dir, { recursive: true });
      writeFileSync(autoPath, html, 'utf-8');
      return { ok: true, path: autoPath };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  const defaultDir = app.getPath('downloads') || join(dataRoot(), 'projects');
  const res = await dialog.showSaveDialog({
    title: '导出 HTML 网页文件',
    defaultPath: join(defaultDir, defaultName),
    filters: [{ name: 'HTML 网页文件', extensions: ['html', 'htm'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    const dir = join(res.filePath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(res.filePath, html, 'utf-8');
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// 导出 HTML 的同时自动保存同名 .bcproj 项目文件（HTML 逆向成本高，双写防丢）
ipcMain.handle('export:html-with-project', async (_evt, html: string, scene: any, defaultName = 'index.html', projectName = '我的网页') => {
  try {
    const res = await dialog.showSaveDialog({
      title: '导出 HTML 与项目文件',
      defaultPath: defaultName,
      filters: [{ name: 'HTML 网页文件', extensions: ['html'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    const htmlPath = res.filePath;
    const projectPath = htmlPath.replace(/\.html?$/i, '') + '.bcproj';

    writeFileSync(htmlPath, html, 'utf-8');

    const w = writeProject(projectPath, {
      name: projectName,
      scene,
      meta: { elementCount: countNodes(scene?.root) }
    });
    if (!w.ok) return { ok: false, error: w.error || '写入工程文件失败' };

    return { ok: true, htmlPath, projectPath };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// ============ 扩展系统（extensions/ 迁移至 data/extensions/） ============
function extRoot(): string {
  return join(dataRoot(), 'extensions');
}

function isEnabled(kind: 'plugins' | 'resources', id: string): boolean {
  return !existsSync(join(extOf(kind, id), '.disabled'));
}
function extOf(kind: 'plugins' | 'resources', id: string): string {
  return join(extRoot(), kind, id);
}

function sanitizeId(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9_\-.]+/g, '-').replace(/^-+|-+$/g, '');
}

function collectFiles(base: string, rel: string): { rel: string; abspath: string }[] {
  const out: { rel: string; abspath: string }[] = [];
  if (!existsSync(join(base, rel))) return out;
  for (const e of readdirSync(join(base, rel), { withFileTypes: true })) {
    const sub = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...collectFiles(base, sub));
    else if (e.isFile()) out.push({ rel: sub, abspath: join(base, sub) });
  }
  return out;
}

function scanExtensions() {
  const result: {
    plugins: { id: string; name: string; version: string; author: string; description: string; enabled: boolean; error: string | null }[];
    resources: {
      id: string; name: string; version: string; author: string; description: string;
      categories: any[];
      templates: { id: string; name: string; description: string; category?: string }[];
      enabled: boolean; error: string | null;
    }[];
    errors: string[];
  } = { plugins: [], resources: [], errors: [] };

  const scanKind = (kind: 'plugins' | 'resources') => {
    const dir = join(extRoot(), kind);
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const mfPath = join(dir, entry.name, 'manifest.json');
      if (!existsSync(mfPath)) {
        result.errors.push(`${kind}/${entry.name}: 缺少 manifest.json`);
        continue;
      }
      try {
        const mf = JSON.parse(readFileSync(mfPath, 'utf-8'));
        const expectedType = kind === 'plugins' ? 'plugin' : 'resource';
        if (mf.type !== expectedType) {
          result.errors.push(`${kind}/${entry.name}: manifest.type 应为 "${expectedType}"`);
          continue;
        }
        const base = {
          id: String(mf.id ?? entry.name),
          name: String(mf.name ?? entry.name),
          version: String(mf.version ?? ''),
          author: String(mf.author ?? ''),
          description: String(mf.description ?? ''),
          enabled: isEnabled(kind, entry.name)
        };
        if (kind === 'plugins') {
          if (!mf.main) throw new Error('缺少 main 字段（插件入口文件）');
          result.plugins.push({ ...base, error: null });
        } else {
          if (!Array.isArray(mf.templates) || mf.templates.length === 0) throw new Error('缺少 templates 列表（资源包至少一个模板）');
          const categories: any[] = Array.isArray(mf.categories) ? mf.categories : [];
          const templates = mf.templates.map((t: any) => ({
            id: String(t.id),
            name: String(t.name ?? t.id),
            description: String(t.description ?? ''),
            category: t.category ? String(t.category) : undefined
          }));
          result.resources.push({ ...base, categories, templates, error: null });
        }
      } catch (e) {
        result.errors.push(`${kind}/${entry.name}: ${(e as Error).message}`);
      }
    }
  };

  scanKind('plugins');
  scanKind('resources');
  return result;
}

ipcMain.handle('ext:scan', () => scanExtensions());

ipcMain.handle('plg:get-source', async (_evt, id: string) => {
  try {
    const dir = extOf('plugins', id);
    const mfPath = join(dir, 'manifest.json');
    if (!existsSync(mfPath)) return { ok: false, error: '插件不存在' };
    if (!isEnabled('plugins', id)) return { ok: false, error: '插件已禁用' };
    const mf = JSON.parse(readFileSync(mfPath, 'utf-8'));
    if (!mf.main) return { ok: false, error: 'manifest 缺少 main 字段' };
    const mainPath = join(dir, String(mf.main));
    if (!existsSync(mainPath)) return { ok: false, error: '入口文件缺失：' + mf.main };
    const source = readFileSync(mainPath, 'utf-8');
    return { ok: true, source };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('ext:read-template', async (_evt, resourceId: string, templateId: string) => {
  const mfPath = join(extRoot(), 'resources', resourceId, 'manifest.json');
  if (!existsSync(mfPath)) return { ok: false, error: '资源包不存在' };
  try {
    const mf = JSON.parse(readFileSync(mfPath, 'utf-8'));
    const tpl = (mf.templates ?? []).find((t: any) => t.id === templateId);
    if (!tpl) return { ok: false, error: '模板不存在' };
    const tplPath = join(extRoot(), 'resources', resourceId, tpl.file);
    if (!existsSync(tplPath)) return { ok: false, error: '模板文件缺失' };
    const tree = JSON.parse(readFileSync(tplPath, 'utf-8'));
    if (!tree || typeof tree.type !== 'string') return { ok: false, error: '模板内容不是有效元素树' };
    return { ok: true, template: tree };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('ext:open-dir', async () => {
  try {
    const err = await shell.openPath(extRoot());
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('ext:set-enabled', async (_evt, kind: 'plugins' | 'resources', id: string, enabled: boolean) => {
  try {
    const dir = extOf(kind, id);
    if (!existsSync(join(dir, 'manifest.json'))) return { ok: false, error: '扩展不存在' };
    const marker = join(dir, '.disabled');
    if (enabled) {
      if (existsSync(marker)) unlinkSync(marker);
    } else if (!existsSync(marker)) {
      writeFileSync(marker, '');
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('ext:delete', async (_evt, kind: 'plugins' | 'resources', id: string) => {
  try {
    const dir = extOf(kind, id);
    if (!existsSync(join(dir, 'manifest.json'))) return { ok: false, error: '扩展不存在' };
    await shell.trashItem(dir);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('ext:import-folder', async (_evt, kind: 'plugins' | 'resources') => {
  try {
    const res = await dialog.showOpenDialog({ title: '选择要导入的资源包文件夹', properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    const src = res.filePaths[0];
    const mf = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf-8'));
    const id = sanitizeId(mf.id || basename(src));
    const target = extOf(kind, id);
    if (existsSync(target)) return { ok: false, error: `已存在同名扩展「${id}」，请先重命名或删除` };
    cpSync(src, target, { recursive: true });
    return { ok: true, id, name: String(mf.name ?? id) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

const IMPORTED_PKG_ID = 'imported';
function ensureImportedPackage() {
  const dir = extOf('resources', IMPORTED_PKG_ID);
  const mfPath = join(dir, 'manifest.json');
  if (existsSync(mfPath)) {
    try { return JSON.parse(readFileSync(mfPath, 'utf-8')); } catch {}
  }
  mkdirSync(join(dir, 'templates'), { recursive: true });
  const mf = {
    type: 'resource', id: IMPORTED_PKG_ID, name: '我的导入', version: '1.0.0',
    author: '', description: '通过「导入模板」功能收集的单个模板', templates: []
  };
  writeFileSync(mfPath, JSON.stringify(mf, null, 2), 'utf-8');
  return mf;
}

ipcMain.handle('ext:import-json', async () => {
  try {
    const res = await dialog.showOpenDialog({
      title: '选择要导入的模板 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    const src = res.filePaths[0];
    const tree = JSON.parse(readFileSync(src, 'utf-8'));
    if (!tree || typeof tree.type !== 'string') return { ok: false, error: '不是有效的元素树 JSON' };
    const mf = ensureImportedPackage();
    const dir = extOf('resources', IMPORTED_PKG_ID);
    const i = mf.templates.length;
    const tplId = `import-${Date.now().toString(36)}`;
    const tplName = sanitizeId(basename(src, '.json')) || `模板${i + 1}`;
    writeFileSync(join(dir, 'templates', tplName + '.json'), JSON.stringify(tree, null, 2), 'utf-8');
    mf.templates.push({ id: tplId, name: basename(src, '.json') || `模板${i + 1}`, description: '', file: `templates/${tplName}.json` });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(mf, null, 2), 'utf-8');
    return { ok: true, id: IMPORTED_PKG_ID, tplId, name: mf.name };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('ext:import-zip', async (_evt, kind: 'plugins' | 'resources') => {
  try {
    const res = await dialog.showOpenDialog({
      title: '选择要导入的 zip 资源包',
      properties: ['openFile'],
      filters: [{ name: 'Zip 资源包', extensions: ['zip'] }]
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    const entries = zipList(readFileSync(res.filePaths[0]));
    const mfEntry = entries.find((e) => e.name.toLowerCase() === 'manifest.json' || e.name.toLowerCase().endsWith('/manifest.json'));
    if (!mfEntry) return { ok: false, error: 'zip 里找不到 manifest.json' };
    const mf = JSON.parse(Buffer.from(mfEntry.data).toString('utf8'));
    const id = sanitizeId(mf.id || basename(res.filePaths[0], '.zip'));
    const target = extOf(kind, id);
    if (existsSync(target)) return { ok: false, error: `已存在「${id}」` };
    mkdirSync(target, { recursive: true });
    for (const e of entries) {
      if (e.name.endsWith('/')) continue;
      const rel = e.name.replace(/^\/+/, '').split('/').map(sanitizeId).join('/');
      // 防 zip-slip：用 isInside（基于 path.relative）而不是 `startsWith(target + '\\')` ——
      // 后者在 macOS/Linux 上恒为假，会导致扩展 zip 一个文件都解不出来（v0.4.4 修）。
      const out = resolveInside(target, rel);
      if (!out) continue;
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, e.data);
    }
    return { ok: true, id, name: String(mf.name ?? id) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('ext:export-resource', async (_evt, id: string, format: 'folder' | 'zip') => {
  try {
    const srcDir = extOf('resources', id);
    if (!existsSync(join(srcDir, 'manifest.json'))) return { ok: false, error: '资源包不存在' };
    const mf = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf-8'));
    const files = collectFiles(srcDir, '').map((f) => ({ name: f.rel, data: readFileSync(f.abspath) }));
    const fileName = sanitizeId(mf.name || id);
    if (format === 'zip') {
      const res = await dialog.showSaveDialog({ defaultPath: `${fileName}.zip`, filters: [{ name: 'Zip 资源包', extensions: ['zip'] }] });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      writeFileSync(res.filePath, zipCreate(files));
      return { ok: true, path: res.filePath };
    }
    const res = await dialog.showOpenDialog({ title: '选择导出目标目录', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    const target = join(res.filePaths[0], id);
    if (existsSync(target)) return { ok: false, error: '目标目录已存在同名文件夹' };
    cpSync(srcDir, target, { recursive: true });
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('tpl:export-single', async (_evt, tree: unknown, defaultName?: string) => {
  try {
    const res = await dialog.showSaveDialog({ defaultPath: defaultName || 'template.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    writeFileSync(res.filePath, JSON.stringify(tree, null, 2), 'utf-8');
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('tpl:export-package', async (_evt, tree: unknown, meta: { id?: string; name?: string; version?: string; author?: string; description?: string }, format: 'folder' | 'zip') => {
  try {
    const id = sanitizeId(String(meta?.id)) || 'template';
    const name = String(meta?.name || '模板');
    const mf = {
      type: 'resource', id, name,
      version: String(meta?.version || '1.0.0'),
      author: String(meta?.author || ''),
      description: String(meta?.description || ''),
      templates: [{ id: 't1', name, description: String(meta?.description || ''), file: `templates/${id}.json` }]
    };
    const files = [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(mf, null, 2), 'utf-8') },
      { name: `templates/${id}.json`, data: Buffer.from(JSON.stringify(tree, null, 2), 'utf-8') }
    ];
    if (format === 'zip') {
      const res = await dialog.showSaveDialog({ defaultPath: `${name}.zip`, filters: [{ name: 'Zip 资源包', extensions: ['zip'] }] });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      writeFileSync(res.filePath, zipCreate(files));
      return { ok: true, path: res.filePath };
    }
    const res = await dialog.showOpenDialog({ title: '选择导出目标目录', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    const target = join(res.filePaths[0], id);
    if (existsSync(target)) return { ok: false, error: '目标目录已存在同名文件夹' };
    mkdirSync(target, { recursive: true });
    mkdirSync(join(target, 'templates'), { recursive: true });
    writeFileSync(join(target, 'manifest.json'), files[0].data);
    writeFileSync(join(target, 'templates', `${id}.json`), files[1].data);
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('ext:create-package', async (_evt, meta: { id?: string; name?: string; version?: string; author?: string; description?: string }) => {
  try {
    const id = sanitizeId(String(meta?.id)) || 'my-package';
    const target = extOf('resources', id);
    if (existsSync(target)) return { ok: false, error: `「${id}」已存在，请换个名称` };
    mkdirSync(join(target, 'templates'), { recursive: true });
    const mf = {
      type: 'resource', id,
      name: String(meta?.name || '资源包名称'),
      version: String(meta?.version || '1.0.0'),
      author: String(meta?.author || ''),
      description: String(meta?.description || ''),
      templates: []
    };
    writeFileSync(join(target, 'manifest.json'), JSON.stringify(mf, null, 2), 'utf-8');
    const readme = '给模板文件夹里加模板的步骤：\n\n1. 用 BlockCanvas 导出单个模板 JSON\n2. 放入 templates\\ 并在 manifest.json 声明\n';
    writeFileSync(join(target, 'templates', '说明.txt'), readme, 'utf-8');
    return { ok: true, id, path: target };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('preview:open', async (_evt, html: string) => {
  try {
    // v0.4.4：预览页收进 <data>/tmp/preview，并只保留最近 N 个 —— 不再散落系统 Temp、不再无限增长。
    // 为什么仍带时间戳而不是固定文件名：浏览器会按 URL 缓存，复用同一文件名可能显示上一次的内容。
    const dir = previewDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `bc-preview-${Date.now()}.html`);
    writeFileSync(file, html, 'utf-8');
    pruneOldPreviews(dir, PREVIEW_KEEP);
    const err = await shell.openPath(file);
    if (err) return { ok: false, error: err };
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

/** 预览目录只保留最近 N 个（防止"每预览一次就多一个文件"）——阈值与存储预算共用一处 */
const PREVIEW_KEEP = DEFAULT_PREVIEW_KEEP;
function pruneOldPreviews(dir: string, keep: number): number {
  let n = 0;
  try {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /^bc-preview-.*\.html$/i.test(e.name))
      .map((e) => {
        const full = join(dir, e.name);
        let mtime = 0;
        try { mtime = statSync(full).mtimeMs; } catch { /* 忽略 */ }
        return { full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);          // 新的在前
    for (const f of files.slice(keep)) {
      try { unlinkSync(f.full); n += 1; } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
  return n;
}

ipcMain.handle('img:pick-src', async (_evt, mode: 'abs' | 'rel' = 'rel') => {
  const res = await dialog.showOpenDialog({
    title: '选择本地图片',
    properties: ['openFile'],
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'] }
    ]
  });
  if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
  const absPath = res.filePaths[0];
  if (mode === 'rel') {
    const base = app.isPackaged ? dirname(process.execPath) : app.getAppPath();
    let rel = toWebPath(relative(base, absPath));
    if (!rel.startsWith('.') && !rel.startsWith('/')) rel = './' + rel;
    return { ok: true, path: rel, absPath };
  }
  return { ok: true, path: absPath, absPath };
});

// 首页背景：选择图片 / 视频文件（只返回路径，不复制；渲染层用 bc-img:// 预览）
ipcMain.handle('media:pick-src', async (_evt, kind: 'image' | 'video' = 'image') => {
  const isVideo = kind === 'video';
  const res = await dialog.showOpenDialog({
    title: isVideo ? '选择本地视频' : '选择本地图片',
    properties: ['openFile'],
    filters: isVideo
      ? [{ name: '视频文件', extensions: ['mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v'] }]
      : [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'] }]
  });
  if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
  return { ok: true, path: res.filePaths[0], absPath: res.filePaths[0] };
});

function countNodes(node: any): number {
  if (!node) return 0;
  let count = 1;
  if (Array.isArray(node.children)) {
    for (const c of node.children) count += countNodes(c);
  }
  return count;
}

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
  protocol.handle('bc-img', async (request) => {
    try {
      const url = new URL(request.url);
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
