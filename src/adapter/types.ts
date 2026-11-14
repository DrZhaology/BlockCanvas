// BlockCanvas · 宿主能力接口（R6-11）
//
// 渲染层是**纯 Web 应用**（0 个文件 import `node:*` 或 `electron`），所有系统能力都走
// `window.bc.*`。这个文件把那 70 多个方法收敛成**一份类型**，让两种宿主各自实现：
//
//   Electron 宿主：现有的 preload（src/preload/preload.ts）—— 行为一行不改
//   浏览器宿主：新增 src/adapter/browser.ts（IndexedDB + OPFS + <input file>）
//
// 为什么先抽接口而不是直接写浏览器实现：
//   没有接口的话，"哪些方法浏览器做不到"只能靠试 —— 抽出来之后 TypeScript 会把
//   每个缺口指出来，而且浏览器版可以明确写出"这个能力不可用"而不是静默失败。
//
// ⚠ 这份类型是从 renderer/global.d.ts 里**原样搬过来**的（不新增、不改名），
//   目的是让 preload 与 browser adapter 满足同一个契约。

/** 工程文件摘要（项目列表用） */
export interface ProjectFileInfo {
  fileName: string;
  filePath: string;
  name: string;
  size: number;
  updatedAt: string;
  elementCount?: number;
  previewText?: string;
  backupCount?: number;
  external?: boolean;
  missing?: boolean;
  kind?: 'page' | 'site' | 'external' | 'missing';
  pageCount?: number;
}

/** 扩展扫描结果 */
export interface ScanResult {
  plugins: {
    id: string; name: string; version: string; author: string; description: string;
    enabled: boolean; error: string | null;
    manifest?: { apiVersion?: string; permissions?: string[] };
  }[];
  resources: {
    id: string; name: string; version: string; author: string; description: string;
    categories?: { id: string; name: string; description: string }[];
    templates: { id: string; name: string; description: string; category?: string }[];
    enabled: boolean; error: string | null;
  }[];
  errors: string[];
}

/**
 * 一个方法"这台宿主能不能做"。
 *
 * 浏览器版里，做不到的方法返回这个统一形状，而不是抛错 —— 调用方可以据此
 * 显示"这个功能在网页版不可用"，而不是让用户点了没反应。
 */
export type UnavailableResult = { ok: false; unavailable: true; error: string };

export function unavailable(what: string): UnavailableResult {
  return { ok: false, unavailable: true, error: `${what}在网页版不可用` };
}
