// BlockCanvas 渲染进程向主进程暴露的 API（由 preload 注入）
declare global {
  interface ScanResult {
    plugins: { id: string; name: string; version: string; author: string; description: string; enabled: boolean; error: string | null }[];
    resources: {
      id: string; name: string; version: string; author: string; description: string;
      templates: { id: string; name: string; description: string }[];
      enabled: boolean; error: string | null;
    }[];
    errors: string[];
  }
  interface Window {
    bc: {
      exportHTML: (html: string, defaultName?: string) => Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>;
      previewOpen: (html: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      scanExtensions: () => Promise<ScanResult>;
      readTemplate: (resourceId: string, templateId: string) => Promise<{ ok: boolean; template?: any; error?: string }>;
      getPluginSource: (id: string) => Promise<{ ok: boolean; source?: string; error?: string }>;
      openExtensionsDir: () => Promise<{ ok: boolean; error?: string }>;
      setExtensionEnabled: (kind: 'plugins' | 'resources', id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
      deleteExtension: (kind: 'plugins' | 'resources', id: string) => Promise<{ ok: boolean; error?: string }>;
      importExtensionFolder: (kind: 'plugins' | 'resources') => Promise<{ ok: boolean; id?: string; name?: string; error?: string; canceled?: boolean }>;
      importJsonTemplate: () => Promise<{ ok: boolean; id?: string; tplId?: string; name?: string; error?: string; canceled?: boolean }>;
      importExtensionZip: (kind: 'plugins' | 'resources') => Promise<{ ok: boolean; id?: string; name?: string; error?: string; canceled?: boolean }>;
      exportResource: (id: string, format: 'folder' | 'zip') => Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>;
      createResourcePackage: (meta: { id?: string; name?: string; version?: string; author?: string; description?: string }) => Promise<{ ok: boolean; id?: string; path?: string; error?: string }>;
      exportTemplateSingle: (tree: unknown, defaultName?: string) => Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>;
      exportTemplatePackage: (
        tree: unknown,
        meta: { id?: string; name?: string; version?: string; author?: string; description?: string },
        format: 'folder' | 'zip'
      ) => Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>;
      onMenu: (channel: string, cb: () => void) => () => void;
      pickImageSrc: () => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
    };
  }
}
export {};
