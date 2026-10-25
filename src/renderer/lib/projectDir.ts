// BlockCanvas · 当前工程的目录（v0.4.5 第 15 批）
//
// 为什么单独一个小模块：媒体路径要按"工程文件所在目录"解析相对路径，
// 但这件事横跨三处 —— tabStore（知道 filePath）、Canvas（要渲染）、exporter（要导出）。
// 放进 zustand store 会让 Canvas 每次路径变化都重渲染整棵场景树；
// 放成模块级变量 + 订阅，谁需要谁来取，最小侵入。
//
// 约定：`filePath` 为 null（未保存的新工程）时，目录回落到 data/projects
// —— 与主进程 bc-img 协议的候选目录一致，这样"还没保存也能看到图"。

import { dirname, normalizeSlashes } from './mediaPath';

let currentDir = '';

/** 设置当前工程文件路径（null = 未保存的新工程） */
export function setProjectFilePath(filePath: string | null | undefined): void {
  const p = String(filePath ?? '').trim();
  if (!p) { currentDir = ''; return; }
  currentDir = dirname(normalizeSlashes(p));
}

/** 取当前工程目录（未保存时为空串 —— 调用方自己决定回落到哪） */
export function getProjectDir(): string {
  return currentDir;
}
