// BlockCanvas 渲染进程向主进程暴露的 API（由 preload 注入）

import type { BgTask } from '@lib/taskTypes';

export interface ProjectFileInfo {
  fileName: string;
  filePath: string;
  name: string;
  size: number;
  updatedAt: string;
  elementCount?: number;
  previewText?: string;
  backupCount?: number;
  /** v0.4.5：来自 data/projects 以外（从别处导入/打开的工程） */
  external?: boolean;
  /** v0.4.5：登记过但磁盘上已经不在（被移动/删除） */
  missing?: boolean;
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

/** 存储分类（统计与清理同源，口径互斥可加和） */
export type StorageCategoryId =
  | 'chromiumCache' | 'temp' | 'downloads'
  | 'userState' | 'projects' | 'backups' | 'extensions' | 'other';

export interface StorageCategoryInfo {
  id: StorageCategoryId;
  label: string;
  bytes: number;
  cleanable: boolean;
  hint: string;
}

export interface StorageBreakdownInfo {
  dataRoot: string;
  dataTotal: number;
  tempTotal: number;
  systemTempBytes: number;
  grandTotal: number;
  categories: StorageCategoryInfo[];
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
      /** v0.4.5：把外部工程从列表移除（不动磁盘文件） */
      forgetExternalProject: (filePath: string) => Promise<boolean>;
      /** v0.4.5：抢救损坏的工程文件（只读，返回能救出来的场景） */
      salvageProject: (filePath: string) => Promise<{
        ok: boolean;
        scene?: unknown;
        name?: string;
        notes: string[];
        error?: string;
      }>;
      /** v0.4.5：更新日志路径（排障用） */
      updateLogPath: () => Promise<string>;
      /** v0.4.5：读更新日志尾部若干行 */
      updateLogTail: (maxLines?: number) => Promise<string>;
      /** v0.4.5：素材库列表 */
      listAssets: () => Promise<Array<{
        name: string;
        url: string;
        bytes: number;
        mtime: string;
        kind: 'image' | 'video' | 'audio' | 'other';
      }>>;
      /** v0.4.5：导入素材到库（弹文件选择框） */
      importAssets: () => Promise<{
        ok: boolean;
        canceled?: boolean;
        items?: Array<{ name: string; url: string; bytes: number; mtime: string; kind: 'image' | 'video' | 'audio' | 'other' }>;
      }>;
      saveProject: (projectData: { name?: string; scene: unknown; meta?: unknown; history?: { past?: unknown[]; future?: unknown[] } }, saveAs?: boolean, customPath?: string) => Promise<{ ok: boolean; path?: string; name?: string; error?: string; canceled?: boolean }>;
      openProjectFile: (customPath?: string) => Promise<{ ok: boolean; project?: any; path?: string; error?: string; canceled?: boolean; container?: string; history?: { past?: any[]; future?: any[] } }>;
      deleteProject: (fileName: string, projectName?: string) => Promise<{ ok: boolean; error?: string }>;
      renameProject: (oldFileName: string, newName: string) => Promise<{ ok: boolean; fileName?: string; path?: string; error?: string }>;

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
      getStorageBreakdown: () => Promise<StorageBreakdownInfo>;
      clearStorageCategory: (id: StorageCategoryId) => Promise<{ ok: boolean; freedBytes: number; error?: string }>;
      clearAllCleanable: () => Promise<{ ok: boolean; freedBytes: number }>;
      clearAppCache: () => Promise<{ ok: boolean; freedBytes: number }>;
      clearOrphanBackups: () => Promise<{ ok: boolean; cleanedCount: number; freedBytes: number }>;
      /** 预算兜底（L4）：下载目录 + 临时区上限 */
      enforceStorageBudgets: () => Promise<{ removed: number; freedBytes: number; detail: { downloadsRemoved: number; previewsRemoved: number; tmpEvicted: number } }>;
      openDataPath: (target: string) => Promise<string | undefined>;
      getAppConfig: () => Promise<Record<string, any>>;
      setAppConfig: (patch: Record<string, unknown>) => Promise<Record<string, any>>;

      // 自动更新（v0.4.3：软件内更新页面 + 多镜像回退）
      checkUpdate: () => Promise<{
        ok: boolean;
        isDev?: boolean;
        error?: string;
        localVersion?: string;
        hasUpdate?: boolean;
        platform?: string;
        /** 实际命中的读取镜像名 */
        source?: string;
        /** 读取 / 下载的镜像尝试顺序（用于界面提示） */
        mirrors?: { read: string[]; download: string[] };
        /** 展示列表：全部更新项 + 当前版本 + 往前 5 个历史版本（最新在前） */
        entries?: Array<{
          tag: string;
          version: string;
          name: string;
          publishedAt: string;
          prerelease: boolean;
          body: string;
          assets: { name: string; browser_download_url: string; size: number }[];
          updateable: boolean;
          isCurrent: boolean;
          asset: { url: string; name: string; size: number } | null;
        }>;
        /** 最新的可更新版本 */
        latest?: {
          tag: string;
          version: string;
          name: string;
          publishedAt: string;
          prerelease: boolean;
          asset: { url: string; name: string; size: number } | null;
        } | null;
      }>;
      applyUpdate: (assetUrl: string, fileName: string, version: string, tag: string) => Promise<{ ok: boolean; error?: string; taskId?: string }>;
      onUpdateProgress: (cb: (p: { msg: string; pct?: number }) => void) => () => void;
      getLocalVersion: () => Promise<string>;
      /** 阶段展示文案（version.json → package.json.bcStage） */
      getAppStage: () => Promise<string>;
      /** 单独下载发行版资产到 data/downloads/（不替换程序）—— 后台任务 */
      downloadReleaseAsset: (assetUrl: string, fileName: string, tag?: string, title?: string) => Promise<{ ok: boolean; path?: string; error?: string; taskId?: string }>;

      // ============ 后台任务（下载 / 更新，v0.4.4）============
      listTasks: () => Promise<BgTask[]>;
      pauseTask: (id: string) => Promise<BgTask[]>;
      resumeTask: (id: string) => Promise<BgTask[]>;
      cancelTask: (id: string) => Promise<BgTask[]>;
      dismissTask: (id: string) => Promise<BgTask[]>;
      revealTask: (id: string) => Promise<{ ok: boolean; error?: string }>;
      revealPath: (p: string) => Promise<{ ok: boolean; error?: string }>;
      /** 用系统默认浏览器打开外链（只放行 http/https） */
      openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
      onTasksChanged: (cb: (tasks: BgTask[]) => void) => () => void;

      // ============ 帮助文档（README.md）============
      getReadme: () => Promise<{ ok: boolean; text?: string; path?: string; source?: string; bundled?: boolean }>;
      getDoc: (key: 'intro' | 'manual' | 'history') => Promise<{ ok: boolean; text?: string; path?: string; source?: string; bundled?: boolean; error?: string }>;
      getAppRoot: () => Promise<string>;

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
      /** v0.4.5：系统层要求打开某个 .bcproj（双击文件 / 第二个实例 / macOS open-file） */
      onOpenProjectPath: (cb: (path: string) => void) => () => void;
      /** v0.4.5：启动加载页的真实进度（主进程逐条播报） */
      onLoadProgress: (cb: (p: { id: string; label: string; percent: number }) => void) => () => void;
      setNativeTheme: (source: 'dark' | 'light' | 'system') => void;
      pickImageSrc: (mode?: 'abs' | 'rel') => Promise<{ ok: boolean; path?: string; absPath?: string; error?: string; canceled?: boolean }>;
      /** 首页背景用：选择图片 / 视频文件（返回绝对路径，渲染层用 bc-img:// 显示） */
      pickMediaSrc: (kind: 'image' | 'video' | 'audio') => Promise<{ ok: boolean; path?: string; absPath?: string; error?: string; canceled?: boolean }>;
    };
    __sceneStore?: any;
  }
}
export {};
