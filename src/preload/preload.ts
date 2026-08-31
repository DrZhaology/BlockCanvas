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
  clearAppCache: () =>
    ipcRenderer.invoke('data:clear-cache'),
  clearOrphanBackups: () =>
    ipcRenderer.invoke('data:clear-orphan-backups'),
  openDataPath: (target: string) =>
    ipcRenderer.invoke('data:open-path', target),
  getAppConfig: () =>
    ipcRenderer.invoke('cfg:get'),
  setAppConfig: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke('cfg:set', patch),

  // 自动更新
  checkUpdate: () =>
    ipcRenderer.invoke('update:check'),
  applyUpdate: (assetUrl: string) =>
    ipcRenderer.invoke('update:apply', assetUrl),
  getLocalVersion: () =>
    ipcRenderer.invoke('update:get-version'),

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
