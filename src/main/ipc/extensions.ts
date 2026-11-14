// BlockCanvas · 扩展系统 IPC（ext:* / plg:* / tpl:*）
//
// 扩展分两类，共用目录约定 <data>/extensions/{plugins,resources}/<id>/：
//   · plugins    有 manifest.main（入口 JS）+ 可选 .disabled 文件控制启停
//   · resources  有 manifest.templates[]（模板资源包）
//
// 这一层只负责"文件怎么放、怎么读、怎么导入导出"。
// 插件**怎么跑**在渲染层（lib/pluginHost.ts）；能力白名单在 lib/pluginPermissions.ts。
//
// 五条必须保留的约定：
//   1. 启停用 .disabled 空文件（不改 manifest）—— 用户手改 manifest 时不会丢启用状态；
//   2. 导入 zip 要防 zip-slip：条目路径必须落在目标目录内（resolveInside 负责，跨平台语义）；
//   3. 导入时同名自动改名（name-2），绝不覆盖用户已装的扩展；
//   4. scan 要把 apiVersion / permissions 带回渲染层（v0.4.6 的插件能力白名单要用），
//      但**只回这两项** —— manifest 其它内容不进 IPC；
//   5. 单个模板 JSON 走 ext:import-json（并进 imported 包）。
import { ipcMain, shell } from 'electron';
import { join, basename, dirname } from 'node:path';
import {
  writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync, cpSync, unlinkSync
} from 'node:fs';
import { zipCreate, zipList } from '../zip';
import { resolveInside } from '../paths';
import { dataRoot } from '../userData';
import { showOpenDialog, showSaveDialog } from './context';

// ============ 扩展系统（extensions/ 迁移至 data/extensions/） ============
export function extRoot(): string {
  return join(dataRoot(), 'extensions');
}

export function isEnabled(kind: 'plugins' | 'resources', id: string): boolean {
  return !existsSync(join(extOf(kind, id), '.disabled'));
}
export function extOf(kind: 'plugins' | 'resources', id: string): string {
  return join(extRoot(), kind, id);
}

export function sanitizeId(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9_\-.]+/g, '-').replace(/^-+|-+$/g, '');
}

export function collectFiles(base: string, rel: string): { rel: string; abspath: string }[] {
  const out: { rel: string; abspath: string }[] = [];
  if (!existsSync(join(base, rel))) return out;
  for (const e of readdirSync(join(base, rel), { withFileTypes: true })) {
    const sub = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...collectFiles(base, sub));
    else if (e.isFile()) out.push({ rel: sub, abspath: join(base, sub) });
  }
  return out;
}

export function scanExtensions() {
  const result: {
    plugins: {
      id: string; name: string; version: string; author: string; description: string; enabled: boolean;
      error: string | null;
      /**
       * v0.4.6（R6-22）：把 manifest 原样带回去 —— 渲染层要按 `apiVersion` / `permissions`
       * 裁剪插件能拿到的宿主能力。只传这几个字段（不透传整个 manifest），
       * 避免把插件作者写的任意内容塞进 IPC。
       */
      manifest?: { apiVersion?: string; permissions?: string[] };
    }[];
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
          // v0.4.6（R6-22）：只回传裁剪所需的两项，其余 manifest 内容不过 IPC
          const manifest = {
            apiVersion: mf.apiVersion === undefined ? undefined : String(mf.apiVersion),
            permissions: Array.isArray(mf.permissions) ? mf.permissions.map((x: unknown) => String(x)) : undefined
          };
          result.plugins.push({ ...base, error: null, manifest });
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







export const IMPORTED_PKG_ID = 'imported';
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

/**
 * 一次性注册全部扩展相关通道（main.ts 只调这一个）。
 *
 * 为什么包一层函数而不是顶层直接 ipcMain.handle：main.ts 里仍有"窗口创建前不能注册的东西"，
 * 注册时机必须由 main.ts 决定；顶层执行会在 app ready 之前就跑。
 */
export function registerExtensionIpc(): void {
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
      const res = await showOpenDialog({ title: '选择要导入的资源包文件夹', properties: ['openDirectory'] });
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

  ipcMain.handle('ext:import-json', async () => {
    try {
      const res = await showOpenDialog({
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
      const res = await showOpenDialog({
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
        const res = await showSaveDialog({ defaultPath: `${fileName}.zip`, filters: [{ name: 'Zip 资源包', extensions: ['zip'] }] });
        if (res.canceled || !res.filePath) return { ok: false, canceled: true };
        writeFileSync(res.filePath, zipCreate(files));
        return { ok: true, path: res.filePath };
      }
      const res = await showOpenDialog({ title: '选择导出目标目录', properties: ['openDirectory', 'createDirectory'] });
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
      const res = await showSaveDialog({ defaultPath: defaultName || 'template.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
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
        const res = await showSaveDialog({ defaultPath: `${name}.zip`, filters: [{ name: 'Zip 资源包', extensions: ['zip'] }] });
        if (res.canceled || !res.filePath) return { ok: false, canceled: true };
        writeFileSync(res.filePath, zipCreate(files));
        return { ok: true, path: res.filePath };
      }
      const res = await showOpenDialog({ title: '选择导出目标目录', properties: ['openDirectory', 'createDirectory'] });
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
}
