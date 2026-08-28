import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell, nativeTheme, type MenuItemConstructorOptions } from 'electron';
import { join, basename, dirname, relative } from 'node:path';
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync, cpSync, unlinkSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { zipCreate, zipList } from './zip';
import {
  dataRoot, initDataDirectories, readAppConfig, writeAppConfig, listProjects,
  listProjectBackups, saveProjectSnapshotFile, deleteProjectBackupFolder,
  readSession, writeSession, getStorageStats, clearAppCache, clearOrphanBackups,
  getLocalVersion, fetchLatestRelease, compareVersion, findMatchingAsset, applyUpdate
} from './userData';

// 启动最优先：初始化纯便携数据区 data/，隔离系统盘
initDataDirectories();

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
        { label: '关于 BlockCanvas', click: () => win.webContents.send('menu:about') }
      ]
    },
    {
      label: '设置',
      submenu: [
        { label: '⚙️ 偏好设置…', accelerator: 'CmdOrCtrl+,', click: () => win.webContents.send('menu:settings') },
        { type: 'separator' },
        { label: '左侧布局（元素面板在左）', click: () => win.webContents.send('menu:layout-left') },
        { label: '底部布局（元素面板在下方）', click: () => win.webContents.send('menu:layout-bottom') },
        { type: 'separator' },
        { label: '插件与资源包…', click: () => win.webContents.send('menu:ext') },
        { label: '打开便携数据文件夹 (data/)…', click: () => shell.openPath(dataRoot()) },
        { label: '打开扩展文件夹 (extensions/)…', click: () => shell.openPath(extRoot()) },
        { type: 'separator' },
        { label: '🔄 检测更新…', click: () => win.webContents.send('menu:check-update') },
        { type: 'separator' },
        { label: '类名 / ID 总览…', click: () => win.webContents.send('menu:class-manager') }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

async function createWindow() {
  const iconPath = join(app.getAppPath(), 'build', 'icon.png');
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

  Menu.setApplicationMenu(buildMenu(win));

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
ipcMain.handle('data:clear-cache', () => clearAppCache());
ipcMain.handle('data:clear-orphan-backups', () => clearOrphanBackups());

// ============ 自动更新 IPC ============
ipcMain.handle('update:get-version', () => getLocalVersion());

ipcMain.handle('update:check', async () => {
  const localVer = getLocalVersion();
  const release = await fetchLatestRelease();
  if (!release) return { ok: false, error: '无法连接到更新服务器' };
  const cmp = compareVersion(localVer, release.version);
  return {
    ok: true,
    localVersion: localVer,
    latestVersion: release.version,
    releaseName: release.name,
    publishedAt: release.publishedAt,
    hasUpdate: cmp < 0,
    downloadUrl: findMatchingAsset(release.assets),
    assets: release.assets
  };
});

ipcMain.handle('update:apply', async (_evt, assetUrl: string, onProgress?: (msg: string) => void) => {
  if (!assetUrl) return { ok: false, error: '未找到下载地址' };
  return await applyUpdate(assetUrl, onProgress);
});

ipcMain.handle('data:open-path', async (_evt, target: string) => {
  const p = target === 'data' ? dataRoot() : target === 'extensions' ? extRoot() : join(dataRoot(), target);
  return shell.openPath(p);
});

ipcMain.handle('cfg:get', () => readAppConfig());
ipcMain.handle('cfg:set', (_evt, patch: Record<string, any>) => writeAppConfig(patch));

// ============ 项目工程管理 (.bcproj) ============
ipcMain.handle('project:list', () => listProjects());

ipcMain.handle('project:save', async (_evt, projectData: { name?: string; scene: any; meta?: any }, saveAs = false, customPath?: string) => {
  try {
    const pName = (projectData.name || '未命名网页').trim();
    const cleanName = sanitizeId(pName) || 'project';
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

    const payload = {
      format: 'BlockCanvas-Project',
      version: '1.0.0',
      name: pName,
      updatedAt: new Date().toISOString(),
      meta: {
        ...(projectData.meta || {}),
        elementCount: countNodes(projectData.scene?.root)
      },
      scene: projectData.scene
    };

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf-8');
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
    const raw = JSON.parse(readFileSync(targetPath, 'utf-8'));
    if (!raw || !raw.scene || typeof raw.scene !== 'object') {
      return { ok: false, error: '文件不是有效的 BlockCanvas 工程文件' };
    }
    return { ok: true, project: raw, path: targetPath };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('project:delete', async (_evt, fileName: string, projectName?: string) => {
  try {
    const full = join(dataRoot(), 'projects', fileName);
    let innerName = '';
    if (existsSync(full)) {
      try {
        const raw = JSON.parse(readFileSync(full, 'utf-8'));
        innerName = raw.name || '';
      } catch {}
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
    const raw = JSON.parse(readFileSync(f, 'utf-8'));
    const stat = statSync(f);
    return { ok: true, autosave: raw, updatedAt: stat.mtime.toISOString(), elementCount: countNodes(raw.scene?.root) };
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

    const projectPayload = {
      format: 'BlockCanvas-Project',
      version: '1.0.0',
      name: projectName,
      updatedAt: new Date().toISOString(),
      meta: { elementCount: countNodes(scene?.root) },
      scene
    };
    writeFileSync(projectPath, JSON.stringify(projectPayload, null, 2), 'utf-8');

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
      const out = join(target, rel);
      if (!out.startsWith(target + '\\') && out !== target) continue;
      mkdirSync(join(out, '..'), { recursive: true });
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
    const file = join(app.getPath('temp'), `bc-preview-${Date.now()}.html`);
    writeFileSync(file, html, 'utf-8');
    const err = await shell.openPath(file);
    if (err) return { ok: false, error: err };
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

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
    let rel = relative(base, absPath).replace(/\\/g, '/');
    if (!rel.startsWith('.') && !rel.startsWith('/')) rel = './' + rel;
    return { ok: true, path: rel, absPath };
  }
  return { ok: true, path: absPath, absPath };
});

function countNodes(node: any): number {
  if (!node) return 0;
  let count = 1;
  if (Array.isArray(node.children)) {
    for (const c of node.children) count += countNodes(c);
  }
  return count;
}

app.whenReady().then(() => {
  protocol.handle('bc-img', async (request) => {
    try {
      const url = new URL(request.url);
      const rawPath = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (!rawPath) return new Response(null, { status: 400 });
      return await net.fetch(pathToFileURL(rawPath).toString());
    } catch {
      return new Response(null, { status: 400 });
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
