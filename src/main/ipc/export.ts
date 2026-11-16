// BlockCanvas · 导出相关 IPC（export:*）
//
// 集中处理"把编辑器做出来的东西写到磁盘"：单页 HTML / HTML+工程副本 / 网站文件夹 / 目录记忆。
//
// 四条必须原样保留的行为（改造前就有的，探针和用户都依赖）：
//   1. **自动化环境变量**：`BC_AUTO_EXPORT_PATH`（给文件路径）/ `BC_AUTO_EXPORT_DIR`（给目录）
//      直接跳过对话框 —— probe-table 等探针靠它无人值守导出。
//   2. **跨盘符**：图片在 D:、导出到 E: 时无法写相对路径 → 保留绝对路径并**计数**，
//      让界面能提示"有 N 个素材是绝对路径，换机器会丢"。
//   3. **重名不覆盖**：同目录导出两次变成 `a-2.png`。
//   4. **拷不过去就内联**：素材复制失败时退回 data URI（宁可文件大，也不破图）。
//
// 以及一条 v0.4.5 的：export:site 会顺手存一份 .bcproj 副本（HTML 逆向成本高，双写防丢）。
import { app, ipcMain, shell } from 'electron';
import { join, basename, dirname, relative as relativePath, isAbsolute as isAbsolutePath } from 'node:path';
import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dataRoot } from '../userData';
import { collectSceneAssets, resolveCachedAsset } from '../assets';
import { writeProject } from '../projectFile';
import { startManualTask, updateManualTask, finishManualTask } from '../tasks';
import { showSaveDialog, showOpenDialog } from './context';

// ── 导出目录记忆（data/export-dirs.json） ────────────────────────────────
function exportDirsPath(): string {
  return join(dataRoot(), 'export-dirs.json');
}

function readExportDirs(): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(exportDirsPath(), 'utf-8'));
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function rememberExportDir(key: string, dir: string): void {
  if (!key || !dir) return;
  try {
    const all = readExportDirs();
    all[key] = dir;
    writeFileSync(exportDirsPath(), JSON.stringify(all, null, 2), 'utf-8');
  } catch { /* 记不住不影响导出 */ }
}

/** 取上次导出目录（没有就退到下载目录 / 数据根） */
function lastExportDir(key: string): string {
  const saved = key ? readExportDirs()[key] : '';
  if (saved && existsSync(saved)) return saved;
  try {
    const d = app.getPath('downloads');
    if (d && existsSync(d)) return d;
  } catch { /* 忽略 */ }
  return dataRoot();
}

/** 文件 → 相对 baseDir 的写法（跨盘符时 crossDrive=true） */
function toRelFromPath(file: string, baseDir: string): { rel: string; crossDrive: boolean } {
  try {
    const r = relativePath(baseDir, file).replace(/\\/g, '/');
    if (r.startsWith('..') && isAbsolutePath(r)) return { rel: file, crossDrive: true };
    return { rel: r, crossDrive: false };
  } catch {
    return { rel: file, crossDrive: true };
  }
}

/** 在目标目录里取一个不冲突的文件名（a.png → a-2.png） */
function uniqueFileName(dir: string, name: string): string {
  const base = basename(name);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let candidate = base;
  let i = 2;
  while (existsSync(join(dir, candidate))) {
    candidate = `${stem}-${i}${ext}`;
    i += 1;
    if (i > 999) break;
  }
  return candidate;
}

const MEDIA_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.opus': 'audio/opus'
};

function mediaMimeOf(p: string): string {
  const ext = (p.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  return MEDIA_MIME[ext] ?? 'application/octet-stream';
}

/** 把一个媒体引用解析成本机真实文件路径（bc-img:// / 绝对 / 相对都吃） */
function resolveMediaFile(raw: string, projectDir: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^bc-img:\/\//i.test(s)) {
    const kind = (s.match(/^bc-img:\/\/(asset|file)\//i) || [])[1] || 'file';
    const enc = s.replace(/^bc-img:\/\/(asset|file)\//i, '');
    try {
      const dec = decodeURIComponent(enc);
      if (kind === 'asset') return resolveCachedAsset(dec) || '';
      return existsSync(dec) ? dec : '';
    } catch {
      return '';
    }
  }
  if (/^file:\/\//i.test(s)) {
    try {
      const p = decodeURIComponent(s.replace(/^file:\/\/\/?/i, ''));
      return existsSync(p) ? p : '';
    } catch { return ''; }
  }
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\') || s.startsWith('/')) {
    return existsSync(s) ? s : '';
  }
  if (projectDir) {
    const p = join(projectDir, s.replace(/^\.\//, ''));
    if (existsSync(p)) return p;
  }
  return '';
}

function countNodes(node: unknown): number {
  let n = 0;
  const walk = (x: unknown) => {
    if (!x || typeof x !== 'object') return;
    n += 1;
    const kids = (x as { children?: unknown[] }).children;
    if (Array.isArray(kids)) for (const k of kids) walk(k);
  };
  walk(node);
  return Math.max(0, n - 1);
}

// ============================================================================
export function registerExportIpc(): void {
  /** 拿上次的导出目录（渲染层用在按钮上显示"上次导到 D:/site"） */
  ipcMain.handle('export:last-dir', (_evt, key: string) => lastExportDir(String(key || '')));

  /** 单页 HTML */
  ipcMain.handle('export:html', async (_evt, html: string, defaultName = 'index.html') => {
    const autoPath = process.env['BC_AUTO_EXPORT_PATH'];
    if (autoPath) {
      try {
        mkdirSync(dirname(autoPath), { recursive: true });
        writeFileSync(autoPath, html, 'utf-8');
        return { ok: true, path: autoPath };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }
    const defaultDir = app.getPath('downloads') || join(dataRoot(), 'projects');
    const res = await showSaveDialog({
      title: '导出 HTML 网页文件',
      defaultPath: join(defaultDir, defaultName),
      filters: [{ name: 'HTML 网页文件', extensions: ['html', 'htm'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      mkdirSync(join(res.filePath, '..'), { recursive: true });
      writeFileSync(res.filePath, html, 'utf-8');
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  /** HTML + 同目录 .bcproj（HTML 逆向成本高，双写防丢） */
  ipcMain.handle('export:html-with-project', async (
    _evt, html: string, scene: unknown, defaultName = 'index.html', projectName = '我的网页'
  ) => {
    try {
      const autoPath = process.env['BC_AUTO_EXPORT_PATH'];
      let htmlPath = '';
      if (autoPath) {
        mkdirSync(dirname(autoPath), { recursive: true });
        writeFileSync(autoPath, html, 'utf-8');
        htmlPath = autoPath;
      } else {
        const defaultDir = app.getPath('downloads') || join(dataRoot(), 'projects');
        const res = await showSaveDialog({
          title: '导出 HTML 网页文件（同时保存工程）',
          defaultPath: join(defaultDir, defaultName),
          filters: [{ name: 'HTML 网页文件', extensions: ['html', 'htm'] }]
        });
        if (res.canceled || !res.filePath) return { ok: false, canceled: true };
        mkdirSync(join(res.filePath, '..'), { recursive: true });
        writeFileSync(res.filePath, html, 'utf-8');
        htmlPath = res.filePath;
      }
      const projectPath = htmlPath.replace(/\.html?$/i, '.bcproj');
      try {
        const c = collectSceneAssets(scene);
        writeProject(projectPath, {
          name: projectName,
          scene: c.scene,
          assets: c.assets,
          meta: { elementCount: countNodes((scene as { root?: unknown })?.root) }
        });
      } catch { /* 工程副本失败不影响网页导出 */ }
      return { ok: true, htmlPath, projectPath };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  /**
   * 导出"网站文件夹"：index.html + assets/*（直接扔到静态托管就能上线）。
   * 会挂一个可见任务，进度能在工具栏「任务」里看到。
   */
  ipcMain.handle('export:site', async (_evt, payload: {
    html: string; scene: unknown; projectName?: string; projectPath?: string;
  }) => {
    const { html, scene, projectName = '我的网页', projectPath = '' } = payload || ({} as never);
    const key = String(projectPath || projectName || '').trim();

    // ① 先定导出目录：自动化环境变量优先，否则问用户
    let outDir = '';
    const autoFile = process.env['BC_AUTO_EXPORT_PATH'];
    let htmlFileName = 'index.html';
    const autoDir = process.env['BC_AUTO_EXPORT_DIR'];
    if (autoFile) {
      outDir = dirname(autoFile);
      htmlFileName = basename(autoFile);
    } else if (autoDir) {
      outDir = autoDir;
    } else {
      const res = await showOpenDialog({
        title: '选择导出位置（会在这个文件夹里生成 index.html 与 assets/）',
        defaultPath: lastExportDir(key),
        properties: ['openDirectory', 'createDirectory']
      });
      if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true };
      outDir = res.filePaths[0];
    }

    const task = startManualTask({
      kind: 'export',
      title: `导出网站《${projectName}》`,
      detail: '准备导出…',
      dest: outDir
    });

    try {
      mkdirSync(outDir, { recursive: true });
      const assetsDir = join(outDir, 'assets');
      const projectDir = projectPath ? join(projectPath, '..') : '';

      // ② 收集 HTML 里所有本地媒体引用
      const refs = new Set<string>();
      for (const m of html.matchAll(/(?:bc-img:\/\/(?:asset|file)\/[^"'\\\s)]+)/g)) refs.add(m[0]);
      const total = refs.size;
      updateManualTask(task.id, {
        detail: total > 0 ? `正在处理 ${total} 个媒体文件…` : '正在写入 HTML…',
        pct: 5,
        total
      });

      let outHtml = html;
      let copied = 0;
      let crossDrive = 0;
      let idx = 0;
      for (const ref of refs) {
        idx += 1;
        updateManualTask(task.id, {
          detail: `正在处理媒体 ${idx}/${total}…`,
          pct: 5 + Math.round((idx / Math.max(1, total)) * 80)
        });
        const file = resolveMediaFile(ref, projectDir);
        if (!file || !existsSync(file)) continue;
        const rel = toRelFromPath(file, outDir);
        if (rel.crossDrive) crossDrive += 1;
        // 拷进 assets/（重名加序号）
        let destName = '';
        try {
          mkdirSync(assetsDir, { recursive: true });
          destName = uniqueFileName(assetsDir, basename(file));
          copyFileSync(file, join(assetsDir, destName));
          copied += 1;
        } catch {
          // 拷不过去就退回内联 data URI（宁可文件大，也不破图）
          try {
            const buf = readFileSync(file);
            outHtml = outHtml.split(ref).join(`data:${mediaMimeOf(file)};base64,${buf.toString('base64')}`);
          } catch { /* 彻底读不到就保持原样 */ }
          continue;
        }
        outHtml = outHtml.split(ref).join(`assets/${destName}`);
      }

      updateManualTask(task.id, { detail: '正在写入 HTML 文件…', pct: 88 });
      const htmlPath = join(outDir, htmlFileName);
      writeFileSync(htmlPath, outHtml, 'utf-8');

      // ③ 顺手存一份工程副本（与以前一致：HTML + bcproj 双写）
      updateManualTask(task.id, { detail: '正在保存工程副本…', pct: 94 });
      let savedProject = '';
      try {
        const c = collectSceneAssets(scene);
        const projPath = join(outDir, `${projectName}.bcproj`);
        const w = writeProject(projPath, {
          name: projectName,
          scene: c.scene,
          assets: c.assets,
          meta: { elementCount: countNodes((scene as { root?: unknown })?.root) }
        });
        if (w.ok) savedProject = projPath;
      } catch { /* 工程副本失败不影响网页导出 */ }

      rememberExportDir(key, outDir);
      finishManualTask(task.id, {
        ok: true,
        detail: `已导出到 ${outDir}（复制 ${copied} 个媒体文件${crossDrive > 0 ? `，${crossDrive} 个跨盘符保留绝对路径` : ''}）`
      });
      return { ok: true, outDir, htmlPath, copied, crossDrive, projectPath: savedProject };
    } catch (e) {
      finishManualTask(task.id, { ok: false, error: (e as Error).message });
      return { ok: false, error: (e as Error).message };
    }
  });

  /** 在系统文件管理器里打开导出目录 */
  ipcMain.handle('export:open-dir', async (_evt, dir: string) => {
    try {
      const d = String(dir ?? '');
      if (d && existsSync(d)) await shell.openPath(d);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}
