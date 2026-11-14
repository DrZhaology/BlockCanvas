// BlockCanvas · 宿主选择（R6-11 / R6-13）
//
// 同一个渲染层要能在两种宿主里跑：
//   · Electron：`window.bc` 由 preload 注入（**这里什么都不做**，行为零变化）
//   · 浏览器：没有 preload → 由本模块在启动前注入一份浏览器实现
//
// 判断依据：`window.bc` 是否已存在。这是最可靠的信号 ——
// preload 在 document start 阶段就注入完了，早于任何渲染层代码。
//
// 为什么要"先检测再注入"而不是编译期二选一：
//   单文件 HTML 构建和 Electron 构建共用同一份渲染层源码，运行时选择才能少维护一套构建。
import { createBrowserBc } from './browser';

export type HostKind = 'electron' | 'browser';

export function detectHost(): HostKind {
  return typeof window !== 'undefined' && window.bc ? 'electron' : 'browser';
}

/**
 * 在渲染之前调用：如果没有 `window.bc`，就装上浏览器实现。
 *
 * 返回值告诉调用方"现在是哪种宿主"，界面据此决定要不要提示"网页版有些功能不可用"。
 */
export function installHost(version: string, stage: string): HostKind {
  if (typeof window === 'undefined') return 'browser';
  if (window.bc) return 'electron';

  const bc = createBrowserBc(version, stage);
  // 浏览器实现里多挂了 __emit / __on 两个内部方法，对外仍按 window.bc 的类型使用
  (window as unknown as Record<string, unknown>).bc = bc;
  // 给界面一个明确标记（CSS / 探针 / "网页版"提示都要用）
  document.documentElement.setAttribute('data-bc-host', 'browser');
  console.info('[BlockCanvas] 浏览器宿主已就绪：工程存在 IndexedDB，导出走下载。');
  return 'browser';
}
