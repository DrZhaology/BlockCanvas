import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// BlockCanvas · 预加载层 (Preload)
// 向渲染进程安全注入原生能力与便携数据区中枢

contextBridge.exposeInMainWorld('bc', {
  // 导出与网页管理
  exportHTML: (html: string, defaultName?: string) =>
    ipcRenderer.invoke('export:html', html, defaultName),
  exportHTMLWithProject: (html: string, scene: unknown, defaultName?: string, projectName?: string) =>
    ipcRenderer.invoke('export:html-with-project', html, scene, defaultName, projectName),
  previewOpen: (html: string) =>
    ipcRenderer.invoke('preview:open', html),

  // 项目工程管理 (.bcproj)
  listProjects: () =>
    ipcRenderer.invoke('project:list'),
  saveProject: (projectData: { name?: string; scene: unknown; meta?: unknown }, saveAs = false, customPath?: string) =>
    ipcRenderer.invoke('project:save', projectData, saveAs, customPath),
  openProjectFile: (customPath?: string) =>
    ipcRenderer.invoke('project:open-file', customPath),
  deleteProject: (fileName: string, projectName?: string) =>
    ipcRenderer.invoke('project:delete', fileName, projectName),
  /** 重命名工程文件（只改磁盘文件名，不改容器内的项目名） */
  renameProject: (oldFileName: string, newName: string) =>
    ipcRenderer.invoke('project:rename', oldFileName, newName),

  // 自动备份与灾难恢复
  saveBackupSnapshot: (scene: unknown, projectName?: string, isAuto = true) =>
    ipcRenderer.invoke('backup:save-snapshot', scene, projectName, isAuto),
  getAutosaveBackup: (projectName?: string) =>
    ipcRenderer.invoke('backup:get-autosave', projectName),
  listBackups: (projectName?: string) =>
    ipcRenderer.invoke('backup:list', projectName),
  clearBackups: () =>
    ipcRenderer.invoke('backup:clear-all'),

  // 会话记忆 Session (类似 Notepad 原地自愈恢复)
  getSession: () =>
    ipcRenderer.invoke('session:get'),
  setSession: (sessionData: unknown) =>
    ipcRenderer.invoke('session:set', sessionData),

  // 便携数据区与配置
  getDataPaths: () =>
    ipcRenderer.invoke('data:get-paths'),
  getStorageStats: () =>
    ipcRenderer.invoke('data:get-storage-stats'),
  // 分类占用明细（统计与清理同源）
  getStorageBreakdown: () =>
    ipcRenderer.invoke('data:get-storage-breakdown'),
  clearStorageCategory: (id: string) =>
    ipcRenderer.invoke('data:clear-category', id),
  clearAllCleanable: () =>
    ipcRenderer.invoke('data:clear-all-cleanable'),
  clearAppCache: () =>
    ipcRenderer.invoke('data:clear-cache'),
  clearOrphanBackups: () =>
    ipcRenderer.invoke('data:clear-orphan-backups'),
  /** 预算兜底（L4）：下载目录保留最近 1 个 + 30 天过期清理；临时区预览只留最近 5 个 */
  enforceStorageBudgets: () =>
    ipcRenderer.invoke('data:enforce-budgets'),
  openDataPath: (target: string) =>
    ipcRenderer.invoke('data:open-path', target),
  getAppConfig: () =>
    ipcRenderer.invoke('cfg:get'),
  setAppConfig: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke('cfg:set', patch),

  // 自动更新
  checkUpdate: () =>
    ipcRenderer.invoke('update:check'),
  /** 发起更新（后台任务）：先把包下下来，下完自动解压 / 替换 / 重启 */
  applyUpdate: (assetUrl: string, fileName: string, version: string, tag: string) =>
    ipcRenderer.invoke('update:apply', assetUrl, fileName, version, tag),
  getLocalVersion: () =>
    ipcRenderer.invoke('update:get-version'),
  /** 单独下载某个发行版资产到 data/downloads/（更新中心「下载 zip」）—— 同样是后台任务 */
  downloadReleaseAsset: (assetUrl: string, fileName: string, tag?: string, title?: string) =>
    ipcRenderer.invoke('update:download-asset', assetUrl, fileName, tag, title),
  /** 阶段展示文案（version.json → package.json.bcStage） */
  getAppStage: () =>
    ipcRenderer.invoke('app:get-stage'),

  // ============ 后台任务（下载 / 更新）============
  /** 当前全部任务（新的在前） */
  listTasks: () => ipcRenderer.invoke('task:list'),
  pauseTask: (id: string) => ipcRenderer.invoke('task:pause', id),
  resumeTask: (id: string) => ipcRenderer.invoke('task:resume', id),
  cancelTask: (id: string) => ipcRenderer.invoke('task:cancel', id),
  dismissTask: (id: string) => ipcRenderer.invoke('task:dismiss', id),
  /** 在文件管理器里定位到这个任务下好的文件 */
  revealTask: (id: string) => ipcRenderer.invoke('task:reveal', id),
  /** 打开 / 定位任意路径（文件 → 定位，目录 → 打开） */
  revealPath: (p: string) => ipcRenderer.invoke('shell:reveal', p),
  /** 用系统默认浏览器打开外链（只放行 http/https） */
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  /** 任务列表变化推送（返回取消监听的函数） */
  onTasksChanged: (cb: (tasks: unknown) => void) => {
    const h = (_e: unknown, t: unknown) => cb(t);
    ipcRenderer.on('task:changed', h);
    return () => { ipcRenderer.removeListener('task:changed', h); };
  },

  // ============ 帮助文档 ============
  /** 开发态实时读盘；打包版返回 ok:false（渲染层用构建时内联的那份） */
  getReadme: () => ipcRenderer.invoke('help:get-readme'),
  /** 按 key 读三份文档之一：'intro' | 'manual' | 'history'（打包版 ok:false → 用内联份） */
  getDoc: (key: 'intro' | 'manual' | 'history') => ipcRenderer.invoke('help:get-doc', key),
  /** 开发态返回仓库根目录（帮助页里相对图片要用它拼绝对路径） */
  getAppRoot: () => ipcRenderer.invoke('help:get-root'),

  /** 兼容旧调用：更新进度（v0.4.4 起进度统一走 task:changed，这里仅保留签名） */
  onUpdateProgress: (cb: (p: { msg: string; pct?: number }) => void) => {
    const h = (_e: unknown, p: { msg: string; pct?: number }) => cb(p);
    ipcRenderer.on('update:progress', h);
    return () => { ipcRenderer.removeListener('update:progress', h); };
  },

  // 扩展与插件系统
  scanExtensions: () =>
    ipcRenderer.invoke('ext:scan'),
  readTemplate: (resourceId: string, templateId: string) =>
    ipcRenderer.invoke('ext:read-template', resourceId, templateId),
  getPluginSource: (id: string) =>
    ipcRenderer.invoke('plg:get-source', id),
  openExtensionsDir: () =>
    ipcRenderer.invoke('ext:open-dir'),
  setExtensionEnabled: (kind: 'plugins' | 'resources', id: string, enabled: boolean) =>
    ipcRenderer.invoke('ext:set-enabled', kind, id, enabled),
  deleteExtension: (kind: 'plugins' | 'resources', id: string) =>
    ipcRenderer.invoke('ext:delete', kind, id),
  importExtensionFolder: (kind: 'plugins' | 'resources') =>
    ipcRenderer.invoke('ext:import-folder', kind),
  importJsonTemplate: () =>
    ipcRenderer.invoke('ext:import-json'),
  importExtensionZip: (kind: 'plugins' | 'resources') =>
    ipcRenderer.invoke('ext:import-zip', kind),
  exportResource: (id: string, format: 'folder' | 'zip') =>
    ipcRenderer.invoke('ext:export-resource', id, format),
  createResourcePackage: (meta: { id?: string; name?: string; version?: string; author?: string; description?: string }) =>
    ipcRenderer.invoke('ext:create-package', meta),
  exportTemplateSingle: (tree: unknown, defaultName?: string) =>
    ipcRenderer.invoke('tpl:export-single', tree, defaultName),
  exportTemplatePackage: (
    tree: unknown,
    meta: { id?: string; name?: string; version?: string; author?: string; description?: string },
    format: 'folder' | 'zip'
  ) =>
    ipcRenderer.invoke('tpl:export-package', tree, meta, format),

  // 原生事件与辅助
  onMenu: (channel: string, cb: () => void) => {
    const listener = (_e: IpcRendererEvent) => cb();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  setNativeTheme: (source: 'dark' | 'light' | 'system') =>
    ipcRenderer.send('theme:set-source', source),
  pickImageSrc: (mode?: 'abs' | 'rel') =>
    ipcRenderer.invoke('img:pick-src', mode)
});
