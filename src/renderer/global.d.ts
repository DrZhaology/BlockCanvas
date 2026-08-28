// BlockCanvas 渲染进程向主进程暴露的 API（由 preload 注入）

export interface ProjectFileInfo {
  fileName: string;
  filePath: string;
  name: string;
  size: number;
  updatedAt: string;
  elementCount?: number;
  previewText?: string;
  backupCount?: number;
}

export interface DataPathsInfo {
  dataRoot: string;
  userDataDir: string;
  extDir: string;
  projectsDir: string;
  backupsDir: string;
}

export interface StorageStatsInfo {
  cacheSize: number;
  backupsSize: number;
  projectsSize: number;
  extensionsSize: number;
  totalSize: number;
  orphanBackupsCount: number;
}

declare global {
  interface ScanResult {
    plugins: { id: string; name: string; version: string; author: string; description: string; enabled: boolean; error: string | null }[];
    resources: {
      id: string; name: string; version: string; author: string; description: string;
      categories?: { id: string; name: string; description: string }[];
      templates: { id: string; name: string; description: string; category?: string }[];
      enabled: boolean; error: string | null;
    }[];
    errors: string[];
  }
  interface Window {
    bc: {
      // 导出与网页管理
      exportHTML: (html: string, defaultName?: string) => Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>;
      exportHTMLWithProject: (html: string, scene: unknown, defaultName?: string, projectName?: string) => Promise<{ ok: boolean; htmlPath?: string; projectPath?: string; error?: string; canceled?: boolean }>;
      previewOpen: (html: string) => Promise<{ ok: boolean; path?: string; error?: string }>;

      // 项目工程管理 (.bcproj)
      listProjects: () => Promise<ProjectFileInfo[]>;
      saveProject: (projectData: { name?: string; scene: unknown; meta?: unknown }, saveAs?: boolean, customPath?: string) => Promise<{ ok: boolean; path?: string; name?: string; error?: string; canceled?: boolean }>;
      openProjectFile: (customPath?: string) => Promise<{ ok: boolean; project?: any; path?: string; error?: string; canceled?: boolean }>;
      deleteProject: (fileName: string, projectName?: string) => Promise<{ ok: boolean; error?: string }>;

      // 自动备份与灾难恢复
      saveBackupSnapshot: (scene: unknown, projectName?: string, isAuto?: boolean) => Promise<{ ok: boolean; timestamp?: string; error?: string }>;
      getAutosaveBackup: (projectName?: string) => Promise<{ ok: boolean; autosave?: any; updatedAt?: string; elementCount?: number }>;
      listBackups: (projectName?: string) => Promise<ProjectFileInfo[]>;
      clearBackups: () => Promise<{ ok: boolean; error?: string }>;

      // 会话记忆 Session (类似 Notepad 原地自愈恢复)
      getSession: () => Promise<{ activeTabId: string | null; tabs: any[]; updatedAt: string } | null>;
      setSession: (sessionData: { activeTabId: string | null; tabs: any[] }) => Promise<boolean>;

      // 便携数据区与配置
      getDataPaths: () => Promise<DataPathsInfo>;
      getStorageStats: () => Promise<StorageStatsInfo>;
      clearAppCache: () => Promise<{ ok: boolean; freedBytes: number }>;
      clearOrphanBackups: () => Promise<{ ok: boolean; cleanedCount: number; freedBytes: number }>;
      openDataPath: (target: string) => Promise<string | undefined>;
      getAppConfig: () => Promise<Record<string, any>>;
      setAppConfig: (patch: Record<string, unknown>) => Promise<Record<string, any>>;

      // 自动更新
      checkUpdate: () => Promise<{
        ok: boolean;
        error?: string;
        localVersion?: string;
        latestVersion?: string;
        releaseName?: string;
        publishedAt?: string;
        hasUpdate: boolean;
        downloadUrl?: string;
        assets?: { name: string; browser_download_url: string; size: number }[];
      }>;
      applyUpdate: (assetUrl: string) => Promise<{ ok: boolean; error?: string }>;
      getLocalVersion: () => Promise<string>;

      // 扩展与插件
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
      setNativeTheme: (source: 'dark' | 'light' | 'system') => void;
      pickImageSrc: (mode?: 'abs' | 'rel') => Promise<{ ok: boolean; path?: string; absPath?: string; error?: string; canceled?: boolean }>;
    };
    __sceneStore?: any;
  }
}
export {};
