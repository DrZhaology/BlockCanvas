// BlockCanvas · 结构操作的纯函数（R6-5）
//
// 这里放"改树形状"时必须做的机械活，全部是纯函数：
//   · reassignIds   粘贴时给整棵子树换新 id（否则同一个 id 出现两次 → 选中/样式全乱）
//   · appendPasted  把剪贴板内容挂到目标节点下（单个或多个）
//
// 为什么单独一个文件：这些是"复制粘贴能不能用"的地基，
// 而复制粘贴出错（id 冲突、顺序反了）最难在手测里发现 —— 抽出来才能单测。
import type { SceneElement, SceneGraph } from '@lib/types';
import { deepClone } from './tree';

/** uuid v4（这里用平台原生 crypto.randomUUID，比自实现可靠） */
export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'x'.repeat(8).replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

/** 给整棵子树重新分配 id（粘贴用，避免与现有节点冲突） */

// ============ 给树里所有元素重新分配 id（粘贴用，避免 id 冲突） ============
export function reassignIds(node: SceneElement): SceneElement {
  return {
    ...node,
    id: uuid(),
    children: node.children.map(reassignIds)
  };
}


// 把剪贴板内容（单个元素或数组）追加到 target.children，并把选区设为"刚粘贴的元素"
export function appendPasted(scene: SceneGraph, target: SceneElement, clip: SceneElement | SceneElement[]): void {
  const items = Array.isArray(clip) ? clip : [clip];
  const inserted = items.map((it) => reassignIds(deepClone(it)));
  target.children.push(...inserted);
  scene.selectedIds = inserted.map((n) => n.id);
  scene.selectedId = inserted.length ? inserted[inserted.length - 1].id : null;
}