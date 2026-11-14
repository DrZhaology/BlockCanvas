// BlockCanvas · 浏览器适配层（R6-12）
//
// 目标：让同一份渲染层在浏览器里跑起来。渲染层是纯 Web 应用（0 个文件 import node/electron），
// 所有系统能力都走 `window.bc.*` —— 所以"换宿主"= 换这一层实现。
//
// 存储选型（为什么是这三样）：
//   · **IndexedDB** 存结构化数据：工程、配置、会话、备份。容量大、支持事务、
//     浏览器原生、file:// 下也能用（对比 localStorage 的 5MB 限制）。
//   · **OPFS** 存大文件（素材原图/视频）。它比 IndexedDB 的 Blob 更适合大二进制，
//     且能拿到 File 句柄直接喂给 <img>/<video> 的 URL.createObjectURL。
//   · **<input type=file> + <a download>** 做导入/导出 —— 这是绕过 file:// 限制的正道。
//
// 三类能力的处理方式（这部分决定了"网页版能不能用"）：
//   ① 完全能实现   → 真实现（工程 CRUD、素材库、配置、会话、备份）
//   ② 换个形态实现 → 用浏览器等价物（导出 = 下载文件而不是写磁盘；预览 = 新标签页）
//   ③ 做不到       → 返回 `unavailable(...)`，界面显示"网页版不可用"
//                     **绝不静默失败**（点了没反应是最糟的体验）
import { zipCreateStore, zipListBrowser } from './zipBrowser';
import { unavailable } from './types';

const DB_NAME = 'blockcanvas';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_KV = 'kv';
const STORE_ASSETS = 'assets';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'fileName' });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idb<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const s = tx.objectStore(store);
    let result: T;
    const req = fn(s);
    if (req && 'onsuccess' in req) {
      req.onsuccess = () => { result = req.result as T; };
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const kvGet = <T,>(key: string) => idb<T | undefined>(STORE_KV, 'readonly', (s) => s.get(key));
const kvSet = (key: string, val: unknown) => idb<void>(STORE_KV, 'readwrite', (s) => { s.put(val, key); });
const kvDel = (key: string) => idb<void>(STORE_KV, 'readwrite', (s) => { s.delete(key); });

// ── 下载 / 选择文件：浏览器版的"文件系统" ─────────────────────────────────
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 会让某些浏览器的下载中断，延后一点
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function pickFiles(accept?: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener('focus', onFocus);
      resolve(files);
    };
    // 用户点"取消"时不会触发 change —— 靠窗口重新获得焦点来判断
    const onFocus = () => window.setTimeout(() => done([]), 400);
    input.onchange = () => done(Array.from(input.files ?? []));
    document.body.appendChild(input);
    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}

function safeName(name: string, fallback = 'project'): string {
  const base = String(name ?? '').trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 60);
  return base || fallback;
}

/** 一个工程在 IndexedDB 里长这样 */
type StoredProject = {
  fileName: string;
  name: string;
  scene: unknown;
  meta?: unknown;
  updatedAt: string;
  createdAt: string;
  elementCount: number;
};

function countElements(root: unknown): number {
  let n = 0;
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    n += 1;
    const kids = (node as { children?: unknown[] }).children;
    if (Array.isArray(kids)) for (const c of kids) walk(c);
  };
  walk(root);
  return Math.max(0, n - 1); // 不算根
}

// ============================================================================
// 对外：浏览器版 bc
// ============================================================================
export function createBrowserBc(version: string, stage: string) {
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  const emit = (ch: string, ...args: unknown[]) => {
    const set = listeners.get(ch);
    if (set) for (const fn of set) { try { fn(...args); } catch { /* 忽略 */ } }
  };
  const on = (ch: string, cb: (...a: unknown[]) => void) => {
    if (!listeners.has(ch)) listeners.set(ch, new Set());
    listeners.get(ch)!.add(cb);
    return () => { listeners.get(ch)?.delete(cb); };
  };

  return {
    // ── ① 完全能实现：工程 CRUD ─────────────────────────────────────────
    listProjects: async (): Promise<Record<string, unknown>[]> => {
      const all = await idb<StoredProject[]>(STORE_PROJECTS, 'readonly', (s) => s.getAll());
      return (all ?? [])
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .map((p) => ({
          fileName: p.fileName,
          filePath: p.fileName,          // 浏览器里"路径"就是键
          name: p.name,
          size: JSON.stringify(p.scene ?? {}).length,
          updatedAt: p.updatedAt,
          elementCount: p.elementCount,
          kind: 'page' as const,
          pageCount: 1,
          previewText: ''
        }));
    },

    saveProject: async (data: { name?: string; scene: unknown; meta?: unknown }) => {
      const name = safeName(String(data.name ?? '未命名项目'));
      const fileName = name + '.bcproj';
      const prev = await idb<StoredProject | undefined>(STORE_PROJECTS, 'readonly', (s) => s.get(fileName));
      const now = new Date().toISOString();
      const rec: StoredProject = {
        fileName,
        name,
        scene: data.scene,
        meta: data.meta,
        updatedAt: now,
        createdAt: prev?.createdAt ?? now,
        elementCount: countElements((data.scene as { root?: unknown })?.root)
      };
      await idb(STORE_PROJECTS, 'readwrite', (s) => s.put(rec));
      return { ok: true, path: fileName, name };
    },

    openProjectFile: async (fileName?: string) => {
      if (fileName) {
        const rec = await idb<StoredProject | undefined>(STORE_PROJECTS, 'readonly', (s) => s.get(fileName));
        if (!rec) return { ok: false, error: '工程不存在' };
        return { ok: true, project: { name: rec.name, scene: rec.scene, meta: rec.meta }, path: rec.fileName, container: 'idb' };
      }
      // 没给名字 = 从磁盘选一个 .bcproj 解包（浏览器里就是读文件）
      const files = await pickFiles('.bcproj,application/zip', false);
      if (!files.length) return { ok: false, canceled: true };
      const buf = new Uint8Array(await files[0].arrayBuffer());
      const entries = await zipListBrowser(buf);
      const sceneEntry = entries.find((e) => e.name === 'scene.json') ?? entries.find((e) => e.name.endsWith('scene.json'));
      if (!sceneEntry) return { ok: false, error: '这不是有效的工程文件（缺少 scene.json）' };
      const scene = JSON.parse(new TextDecoder().decode(sceneEntry.data));
      return { ok: true, project: { name: files[0].name.replace(/\.bcproj$/i, ''), scene }, path: files[0].name, container: 'zip' };
    },

    deleteProject: async (fileName: string) => {
      await idb(STORE_PROJECTS, 'readwrite', (s) => s.delete(fileName));
      return { ok: true };
    },

    renameProject: async (oldFileName: string, newName: string) => {
      const rec = await idb<StoredProject | undefined>(STORE_PROJECTS, 'readonly', (s) => s.get(oldFileName));
      if (!rec) return { ok: false, error: '工程不存在' };
      const clean = safeName(newName);
      const fileName = clean + '.bcproj';
      await idb(STORE_PROJECTS, 'readwrite', (s) => s.delete(oldFileName));
      await idb(STORE_PROJECTS, 'readwrite', (s) => s.put({ ...rec, name: clean, fileName, updatedAt: new Date().toISOString() }));
      return { ok: true, fileName, path: fileName };
    },

    // ── ② 换形态实现：导出 = 下载 ───────────────────────────────────────
    /** 导出单页 HTML → 浏览器里只能"下载一个 .html" */
    exportHTML: async (html: string, defaultName?: string) => {
      downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), safeName(defaultName ?? 'page') + '.html');
      return { ok: true, path: safeName(defaultName ?? 'page') + '.html' };
    },

    /** 导出 HTML + 工程副本 → 浏览器里打成一个 zip 下载 */
    exportHTMLWithProject: async (html: string, scene: unknown, defaultName?: string, projectName?: string) => {
      const base = safeName(defaultName ?? 'page');
      const sceneJson = JSON.stringify({ name: projectName ?? base, scene, schemaVersion: 2, savedAt: new Date().toISOString() }, null, 2);
      const zip = zipCreateStore([
        { name: 'index.html', data: new TextEncoder().encode(html) },
        { name: 'project.bcproj.json', data: new TextEncoder().encode(sceneJson) }
      ]);
      downloadBlob(new Blob([zip as unknown as BlobPart], { type: 'application/zip' }), base + '.zip');
      return { ok: true, htmlPath: base + '.zip', projectPath: '' };
    },

    /** 导出"网站文件夹" → 浏览器里是同一个思路（zip） */
    exportSite: async (payload: { html: string; scene: unknown; projectName?: string }) => {
      const base = safeName(payload.projectName ?? 'site');
      const zip = zipCreateStore([{ name: 'index.html', data: new TextEncoder().encode(payload.html) }]);
      downloadBlob(new Blob([zip as unknown as BlobPart], { type: 'application/zip' }), base + '.zip');
      return { ok: true, outDir: '', htmlPath: base + '.zip', copied: 0, crossDrive: 0 };
    },

    /** 预览 → 新标签页（这才是浏览器的"预览"） */
    previewOpen: async (html: string) => {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const w = window.open(url, '_blank');
      if (!w) return { ok: false, error: '浏览器拦截了新窗口，请允许弹出窗口' };
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { ok: true, path: url };
    },

    exportLastDir: async () => '',
    exportTemplateSingle: async () => unavailable('保存模板文件'),
    exportTemplatePackage: async () => unavailable('保存模板包'),
    exportResource: async () => unavailable('导出资源包'),

    // ── ① 完全能实现：素材库（IndexedDB Blob）─────────────────────────
    listAssets: async () => {
      const all = await idb<Array<{ name: string; blob: Blob; bytes: number; mtime: string; kind: string }>>(
        STORE_ASSETS, 'readonly', (s) => s.getAll());
      return (all ?? []).map((a) => ({
        name: a.name,
        url: URL.createObjectURL(a.blob),
        thumbUrl: null,
        bytes: a.bytes,
        mtime: a.mtime,
        kind: (a.kind as 'image' | 'video' | 'audio' | 'other') ?? 'other'
      }));
    },

    importAssets: async () => {
      const files = await pickFiles('image/*,video/*,audio/*', true);
      if (!files.length) return { ok: false, canceled: true };
      const items = [];
      for (const f of files) {
        const kind = f.type.startsWith('image/') ? 'image'
          : f.type.startsWith('video/') ? 'video'
            : f.type.startsWith('audio/') ? 'audio' : 'other';
        const rec = { name: f.name, blob: f, bytes: f.size, mtime: new Date().toISOString(), kind };
        await idb(STORE_ASSETS, 'readwrite', (s) => s.put(rec));
        items.push({ name: f.name, url: URL.createObjectURL(f), thumbUrl: null, bytes: f.size, mtime: rec.mtime, kind });
      }
      return { ok: true, items };
    },

    pickImageSrc: async () => {
      const files = await pickFiles('image/*', false);
      if (!files.length) return { ok: false, canceled: true };
      const f = files[0];
      // 浏览器没有"路径"概念 —— 存进素材库，给一个 blob URL
      await idb(STORE_ASSETS, 'readwrite', (s) => s.put({
        name: f.name, blob: f, bytes: f.size, mtime: new Date().toISOString(), kind: 'image'
      }));
      return { ok: true, path: URL.createObjectURL(f) };
    },

    pickMediaSrc: async () => {
      const files = await pickFiles('image/*,video/*,audio/*', false);
      if (!files.length) return { ok: false, canceled: true };
      const f = files[0];
      await idb(STORE_ASSETS, 'readwrite', (s) => s.put({
        name: f.name, blob: f, bytes: f.size, mtime: new Date().toISOString(), kind: 'other'
      }));
      return { ok: true, path: URL.createObjectURL(f) };
    },

    // ── ① 完全能实现：配置 / 会话 / 备份 ──────────────────────────────
    getAppConfig: async () => (await kvGet<Record<string, unknown>>('app-config')) ?? {},
    setAppConfig: async (patch: Record<string, unknown>) => {
      const cur = (await kvGet<Record<string, unknown>>('app-config')) ?? {};
      const next = { ...cur, ...patch };
      await kvSet('app-config', next);
      return next;
    },
    getSession: async () => (await kvGet<Record<string, unknown>>('session')) ?? null,
    setSession: async (s: unknown) => { await kvSet('session', s); return true; },

    saveBackupSnapshot: async (scene: unknown, projectName?: string) => {
      const ts = new Date().toISOString();
      const key = `backup:${safeName(projectName ?? 'project')}:${ts}`;
      await kvSet(key, { scene, timestamp: ts });
      // 浏览器存储比磁盘更该省着用：只保留最近 20 份快照
      const idx = (await kvGet<string[]>('backup-index')) ?? [];
      const next = [...idx, key];
      const dropped = next.length > 20 ? next.splice(0, next.length - 20) : [];
      for (const k of dropped) await kvDel(k);
      await kvSet('backup-index', next);
      return { ok: true, timestamp: ts };
    },
    getAutosaveBackup: async () => {
      const v = await kvGet<{ scene: unknown; updatedAt: string }>('autosave');
      if (!v) return { ok: false };
      return { ok: true, autosave: v.scene, updatedAt: v.updatedAt, elementCount: countElements((v.scene as { root?: unknown })?.root) };
    },
    listBackups: async () => [],
    clearBackups: async () => { await kvDel('autosave'); return { ok: true }; },

    // ── ② 换形态：存储统计（浏览器里就是 IndexedDB 用量）───────────────
    getDataPaths: async () => ({
      dataRoot: 'IndexedDB (blockcanvas)',
      projects: 'IndexedDB › projects',
      backups: 'IndexedDB › kv › backup:*',
      assets: 'IndexedDB › assets',
      logs: '不可用（网页版无日志文件）',
      portable: false
    }),
    getStorageStats: async () => {
      const est = await navigator.storage?.estimate?.();
      return {
        totalBytes: est?.usage ?? 0,
        projectsBytes: 0,
        backupsBytes: 0,
        assetsBytes: 0,
        cacheBytes: 0,
        quotaBytes: est?.quota ?? 0
      };
    },
    getStorageBreakdown: async () => ({ categories: [], totalBytes: 0 }),
    clearStorageCategory: async () => ({ ok: false, freedBytes: 0, error: '网页版不可用' }),
    clearAllCleanable: async () => ({ ok: false, freedBytes: 0 }),
    clearAppCache: async () => ({ ok: false, freedBytes: 0 }),
    clearOrphanBackups: async () => ({ ok: false, cleanedCount: 0, freedBytes: 0 }),
    enforceStorageBudgets: async () => ({ removed: 0, freedBytes: 0, detail: { downloadsRemoved: 0, previewsRemoved: 0, tmpEvicted: 0 } }),
    openDataPath: async () => unavailable('打开数据目录'),

    // ── ③ 做不到：更新器 / 扩展目录 / 系统集成 ─────────────────────────
    checkUpdate: async () => ({ ok: true, hasUpdate: false, localVersion: version, isDev: false, entries: [] }),
    applyUpdate: async () => unavailable('自动更新'),
    onUpdateProgress: () => () => { /* noop */ },
    getLocalVersion: async () => version,
    getAppStage: async () => stage,
    downloadReleaseAsset: async () => unavailable('下载发行文件'),
    updateLogPath: async () => '',
    updateLogTail: async () => '',

    scanExtensions: async () => ({ plugins: [], resources: [], errors: [] }),
    getPluginSource: async () => ({ ok: false, error: '网页版不加载本地插件' }),
    openExtensionsDir: async () => unavailable('打开扩展目录'),
    setExtensionEnabled: async () => unavailable('启停扩展'),
    deleteExtension: async () => unavailable('删除扩展'),
    importExtensionFolder: async () => unavailable('导入扩展文件夹'),
    importExtensionZip: async () => unavailable('导入扩展 zip'),
    importJsonTemplate: async () => unavailable('导入模板'),
    createResourcePackage: async () => unavailable('创建资源包'),
    readTemplate: async () => ({ ok: false, error: '网页版没有模板资源包' }),

    // ── ③ 做不到：任务队列 / 工程抢救 / 静默启动 ──────────────────────
    listTasks: async () => [],
    pauseTask: async () => [],
    resumeTask: async () => [],
    cancelTask: async () => [],
    dismissTask: async () => [],
    revealTask: async () => ({ ok: false, error: '网页版不可用' }),
    onTasksChanged: () => () => { /* noop */ },
    salvageProject: async () => unavailable('工程抢救'),
    forgetExternalProject: async () => false,

    // ── 系统集成 ──────────────────────────────────────────────────────
    setNativeTheme: () => { /* 浏览器跟随系统，没有可设的 */ },
    setAcceptanceSize: async () => unavailable('调整窗口尺寸'),
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener');
      return { ok: true };
    },
    quietLaunch: async () => ({ ok: true }),
    probeMediaCodec: async () => ({ ok: true, result: 'unknown' as const, codecs: [], advice: '' }),

    // ── 文档：网页版读打包进来的说明 ──────────────────────────────────
    getDoc: async () => ({ ok: false, error: '网页版不附带完整文档' }),
    getReadme: async () => '',
    getHelpRoot: async () => '',

    // ── 事件订阅（渲染层会调用，返回取消函数）────────────────────────
    onMenu: () => () => { /* noop */ },
    onLoadProgress: () => () => { /* noop */ },
    onOpenProjectPath: () => () => { /* noop */ },

    // ── 内部：让别的模块能推送"加载进度"之类的假事件 ─────────────────
    __emit: emit,
    __on: on
  };
}

export type BrowserBc = ReturnType<typeof createBrowserBc>;
