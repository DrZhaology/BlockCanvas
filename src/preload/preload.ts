import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// BlockCanvas · 预加载
// 通过 contextBridge 把必要 API 暴露给渲染进程；
// 菜单点击通过 ipc 事件传给渲染进程，渲染进程自己决定怎么处理（解耦）

contextBridge.exposeInMainWorld('bc', {
  exportHTML: (html: string, defaultName?: string) =>
    ipcRenderer.invoke('export:html', html, defaultName),
  previewOpen: (html: string) => ipcRenderer.invoke('preview:open', html),
  scanExtensions: () => ipcRenderer.invoke('ext:scan'),
  readTemplate: (resourceId: string, templateId: string) => ipcRenderer.invoke('ext:read-template', resourceId, templateId),
  getPluginSource: (id: string) => ipcRenderer.invoke('plg:get-source', id),
  openExtensionsDir: () => ipcRenderer.invoke('ext:open-dir'),
  setExtensionEnabled: (kind: 'plugins' | 'resources', id: string, enabled: boolean) =>
    ipcRenderer.invoke('ext:set-enabled', kind, id, enabled),
  deleteExtension: (kind: 'plugins' | 'resources', id: string) =>
    ipcRenderer.invoke('ext:delete', kind, id),
  importExtensionFolder: (kind: 'plugins' | 'resources') => ipcRenderer.invoke('ext:import-folder', kind),
  importJsonTemplate: () => ipcRenderer.invoke('ext:import-json'),
  importExtensionZip: (kind: 'plugins' | 'resources') => ipcRenderer.invoke('ext:import-zip', kind),
  exportResource: (id: string, format: 'folder' | 'zip') => ipcRenderer.invoke('ext:export-resource', id, format),
  createResourcePackage: (meta: { id?: string; name?: string; version?: string; author?: string; description?: string }) =>
    ipcRenderer.invoke('ext:create-package', meta),
  exportTemplateSingle: (tree: unknown, defaultName?: string) =>
    ipcRenderer.invoke('tpl:export-single', tree, defaultName),
  exportTemplatePackage: (
    tree: unknown,
    meta: { id?: string; name?: string; version?: string; author?: string; description?: string },
    format: 'folder' | 'zip'
  ) => ipcRenderer.invoke('tpl:export-package', tree, meta, format),
  onMenu: (channel: string, cb: () => void) => {
    const listener = (_e: IpcRendererEvent) => cb();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  setNativeTheme: (source: 'dark' | 'light' | 'system') => ipcRenderer.send('theme:set-source', source),
  pickImageSrc: () => ipcRenderer.invoke('img:pick-src')
});
