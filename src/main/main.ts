import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell, nativeTheme, type MenuItemConstructorOptions } from 'electron';
import { join, basename, dirname } from 'node:path';
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync, cpSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { zipCreate, zipList } from './zip';

// electron-vite 在 dev 模式下注入 ELECTRON_RENDERER_URL；
// 其余情况（构建产物 / 自动化测试直接 electron .）一律加载打包 HTML。
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

// ============ 本地图片协议 ============
// 画布预览本地图片时用 bc-img://file/<encodeURIComponent(绝对路径)> 加载，
// 否则 http 页面加载 file:// 路径会被浏览器拦截（"Not allowed to load local resource"）。
// 必须在 app ready 之前注册特权声明。
protocol.registerSchemesAsPrivileged([
  { scheme: 'bc-img', privileges: { standard: true, secure: true } }
]);

// ============ 自定义中文菜单 ============
// 阶段1：基础菜单 + 快捷键。后续阶段接入"保存工程/打开工程"。
function buildMenu(win: BrowserWindow): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '导出 HTML…',
          accelerator: 'CmdOrCtrl+E',
          click: () => win.webContents.send('menu:export-html')
        },
        {
          label: '在浏览器中预览…',
          accelerator: 'CmdOrCtrl+P',
          click: () => win.webContents.send('menu:preview')
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
      // 4-F 版2：设置放在帮助右边（用户要求）：布局切换 + 插件入口 + 打开扩展文件夹
      label: '设置',
      submenu: [
        { label: '左侧布局（元素面板在左）', click: () => win.webContents.send('menu:layout-left') },
        { label: '底部布局（元素面板在下方）', click: () => win.webContents.send('menu:layout-bottom') },
        { type: 'separator' },
        { label: '插件与资源包…', click: () => win.webContents.send('menu:ext') },
        { label: '打开扩展文件夹…', click: () => shell.openPath(extRoot()) },
        { type: 'separator' },
        { label: '类名 / ID 管理…', click: () => win.webContents.send('menu:class-manager') }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

async function createWindow() {
  // 应用图标：取自 build/icon.png（由 src/renderer/assets/logo.svg 渲染导出）。
  // 开发/未打包阶段路径存在即生效；打包后 exe 图标已内嵌到 BlockCanvas.exe，
  // 此处不存在时不再传 icon（避免出现悬空路径）。
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

  // 插件/深色模式：跟随应用切换原生窗口 chrome（含顶部菜单栏）的明暗。
  // 渲染进程的 CSS 改不到原生菜单栏，原生 chrome 只能通过 nativeTheme.themeSource 控制。
  ipcMain.on('theme:set-source', (_evt, source: unknown) => {
    nativeTheme.themeSource = source === 'dark' || source === 'light' ? source : 'system';
  });

  // dev 与生产都不自动开 DevTools（Fn/F12 或「视图→开发者工具」可手动打开）
  if (devServerUrl) {
    await win.loadURL(devServerUrl);
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

ipcMain.handle('export:html', async (_evt, html: string, defaultName = 'index.html') => {
  // 自动化测试钩子：设置 BC_EXPORT_PATH 后跳过保存对话框，直接写到指定文件
  const autoPath = process.env['BC_EXPORT_PATH'];
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
  const res = await dialog.showSaveDialog({
    title: '导出 HTML',
    defaultPath: defaultName,
    filters: [{ name: 'HTML', extensions: ['html'] }]
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

// ============ 扩展系统（阶段3・第二批） ============
// 所有扩展统一放程序目录 extensions/ 下（用户决策：不用 AppData，绿色便携）：
//   extensions/plugins/<id>/manifest.json   —— 插件（3-3 起执行）
//   extensions/resources/<id>/manifest.json —— 资源包（模板库）
// 打包后（便携文件夹版）：extensions/ 放在 exe 旁边、可写，方便用户随时增删插件/资源包；
// 开发/未打包：程序根目录。
function extRoot(): string {
  const base = app.isPackaged
    ? (process.env['PORTABLE_EXECUTABLE_DIR'] || dirname(process.execPath))
    : app.getAppPath();
  return join(base, 'extensions');
}

// 扩展是否启用：文件夹内有 .disabled 标记文件即视为被禁用（扫描/加载跳过，文件保留）
function isEnabled(kind: 'plugins' | 'resources', id: string): boolean {
  return !existsSync(join(extOf(kind, id), '.disabled'));
}
function extOf(kind: 'plugins' | 'resources', id: string): string {
  return join(extRoot(), kind, id);
}

// 目录 id 清洗：小写字母数字 + _-.，其余替换成 -，去首尾 -；空返回 ''
function sanitizeId(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9_\-.]+/g, '-').replace(/^-+|-+$/g, '');
}

// 递归收集目录下所有文件的相对路径
function collectFiles(base: string, rel: string): { rel: string; abspath: string }[] {
  const out: { rel: string; abspath: string }[] = [];
  for (const e of readdirSync(join(base, rel), { withFileTypes: true })) {
    const sub = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...collectFiles(base, sub));
    else if (e.isFile()) out.push({ rel: sub, abspath: join(base, sub) });
  }
  return out;
}

// 扫描全部扩展（只读 manifest，插件不执行）
function scanExtensions() {
  const result: {
    plugins: { id: string; name: string; version: string; author: string; description: string; enabled: boolean; error: string | null }[];
    resources: {
      id: string; name: string; version: string; author: string; description: string;
      templates: { id: string; name: string; description: string }[];
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
          const templates = mf.templates.map((t: any) => ({
            id: String(t.id),
            name: String(t.name ?? t.id),
            description: String(t.description ?? '')
          }));
          result.resources.push({ ...base, templates, error: null });
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

// 读取插件入口源码：把 main 指向的 JS 以文本下发渲染进程执行。
// 只读源码、不在主进程执行任何插件代码（插件在渲染进程 new Function 求值）。
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

// 读取资源包里的模板文件（返回元素快照树；导入时由渲染进程重新分配 id）
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

// 打开扩展文件夹（方便用户自己放插件/资源包）
ipcMain.handle('ext:open-dir', async () => {
  try {
    const err = await shell.openPath(extRoot());
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// ============ 扩展：启用/禁用 ============
// 禁用 = 在扩展目录写一个 .disabled 标记（文件保留可随时恢复）；启用 = 删掉标记
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

// ============ 扩展：删除（移到回收站，可恢复） ============
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

// ============ 扩展：导入 ============
// 导入整个资源包文件夹（含 manifest.json），复制进 extensions/<kind>/<id>
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

// 导入单个模板 JSON：放进统一的"我的导入"资源包（templates/ 下，并同步 manifest）
const IMPORTED_PKG_ID = 'imported';
function ensureImportedPackage() {
  const dir = extOf('resources', IMPORTED_PKG_ID);
  const mfPath = join(dir, 'manifest.json');
  if (existsSync(mfPath)) {
    try { return JSON.parse(readFileSync(mfPath, 'utf-8')); } catch { /* 继续重建 */ }
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

// 导入 zip 压缩资源包：解包后还原成扩展目录结构
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
      if (e.name.endsWith('/')) continue; // 目录条目跳过
      const rel = e.name.replace(/^\/+/, '').split('/').map(sanitizeId).join('/');
      const out = join(target, rel);
      if (!out.startsWith(target + '\\') && out !== target) continue; // 防路径穿越
      mkdirSync(join(out, '..'), { recursive: true });
      writeFileSync(out, e.data);
    }
    return { ok: true, id, name: String(mf.name ?? id) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// ============ 扩展：导出（资源包 → 文件夹 / zip） ============
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

// ============ 模板导出（画布选中元素） ============
// 导出单个选中元素为模板 JSON
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

// 导出选中元素为完整资源包（manifest + templates/）：format = 'folder' | 'zip'
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

// ============ 生成资源包结构（界面输入元信息 → 生成目录骨架） ============
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
    const readme = '给模板文件夹里加模板的步骤：\n' +
      '\n' +
      '1. 用 BlockCanvas 导出单个模板 JSON（选中元素 → 更多 → 导出为模板 JSON）。\n' +
      '2. 把那个 .json 文件放入本目录 templates\\ 下。\n' +
      '3. 打开 manifest.json，在 templates 数组里追加一项，例如：\n' +
      '   { "id": "my-tpl", "name": "模板显示名", "description": "一句话说明", "file": "templates/文件名.json" }\n' +
      '4. 保存后回到 BlockCanvas 点「重新扫描」即可在模板页看到。\n' +
      '\n' +
      'templates 目录里可放多个模板文件，manifest.json 每项对应一个。\n';
    writeFileSync(join(target, 'templates', '说明.txt'), readme, 'utf-8');
    return { ok: true, id, path: target };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// 浏览器预览：把导出的 HTML 写进系统临时目录，用默认浏览器打开。
// 用户在同一设备上直接对比画布与真实浏览器渲染（同一 Chromium 引擎，1px = 1px）。
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

// 图片路径选择：让用户选一个本地文件，返回绝对路径；模式 = 'abs' 返回绝对路径，'rel' 返回相对当前工程的相对路径
ipcMain.handle('img:pick-src', async () => {
  const res = await dialog.showOpenDialog({
    title: '选择本地图片',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'] }
    ]
  });
  if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
  return { ok: true, path: res.filePaths[0] };
});

app.whenReady().then(() => {
  // bc-img://file/<encodeURIComponent(C:\path\to\img.png)> → 读本地文件返回
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
