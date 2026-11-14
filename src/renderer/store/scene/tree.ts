// BlockCanvas · 场景树的纯工具（R6-5）
//
// 这些函数从 sceneStore.ts 搬出来，特征是**纯函数、不碰 zustand、不碰历史栈**：
// 给定一棵树和一个 id，回答"它在哪 / 谁是谁的父级 / 谁是谁的祖先"。
//
// 为什么值得单独一个文件：
//   · 它们是"结构操作"的地基（reparent / 删除 / 粘贴 / 多选清理全要用）；
//   · 纯函数可以**直接单测** —— 以前埋在 1600 行的 store 里只能靠 E2E 黑盒验证；
//   · 递归实现有个容易写错的点（`findParent` 的 parent 参数语义），集中一处好审。
import type { SceneElement } from '@lib/types';

/** 深拷贝（走原生 structuredClone：比 JSON 往返快，且能处理 Map/Set/Date） */
export function deepClone<T>(x: T): T {
  return structuredClone(x);
}

/** 按 id 找节点（深度优先，找不到返回 null） */
export function findNode(root: SceneElement, id: string): SceneElement | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return null;
}

/**
 * 找父级（根节点返回 null）。
 *
 * ⚠ `parent` 参数是"递归传下来的当前父"，不要从外部传 —— 它存在只是为了递归时带着答案走。
 * 这个签名容易误用（以前有调用方传了 root 进去，结果根节点的父级成了它自己）。
 */
export function findParent(
  root: SceneElement,
  id: string,
  parent: SceneElement | null = null
): SceneElement | null {
  if (root.id === id) return parent;
  for (const c of root.children) {
    const r = findParent(c, id, root);
    if (r !== null) return r;
  }
  return null;
}

/** 找第一个 className 含某 token 的元素（可排除某个 id）——"该类的样子"以它为准 */
export function findFirstWithToken(root: SceneElement, token: string, excludeId?: string): SceneElement | null {
  const walk = (n: SceneElement): SceneElement | null => {
    if (n.id !== excludeId) {
      const cls = (n.attrs?.className ?? '').trim();
      if (cls && cls.split(/\s+/).includes(token)) return n;
    }
    for (const c of n.children) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  return walk(root);
}

/** 找第一个 relSelector 相同的元素（可排除某个 id） */
export function findFirstWithRel(root: SceneElement, rel: string, excludeId?: string): SceneElement | null {
  const walk = (n: SceneElement): SceneElement | null => {
    if (n.id !== excludeId) {
      const r = (n.attrs?.relSelector ?? '').trim();
      if (r && r === rel) return n;
    }
    for (const c of n.children) {
      const res = walk(c);
      if (res) return res;
    }
    return null;
  };
  return walk(root);
}

/** candidateId 是不是 nodeId 的祖先（node 向上能走到 candidate） */
export function isAncestorOf(root: SceneElement, candidateId: string, nodeId: string): boolean {
  if (candidateId === nodeId) return false;
  const target = findNode(root, nodeId);
  if (!target) return false;
  let cur = findParent(root, nodeId);
  while (cur && cur !== root) {
    if (cur.id === candidateId) return true;
    cur = findParent(root, cur.id);
  }
  return false;
}

/** candidateId 是不是 node 的后代（含自身） */
export function isDescendant(node: SceneElement, candidateId: string): boolean {
  if (node.id === candidateId) return true;
  for (const c of node.children) {
    if (isDescendant(c, candidateId)) return true;
  }
  return false;
}

/**
 * 从 id 列表里剔除"自己的某个祖先也在列表里"的那些 id。
 *
 * 为什么需要：多选删除/复制时，如果同时选了父与子，按子处理的会重复操作
 * （删了父之后子已经不存在了）。
 */
export function pruneDescendantIds(root: SceneElement, ids: string[]): string[] {
  return ids.filter((id) => {
    const node = findNode(root, id);
    if (!node) return true;
    return !ids.some((other) => other !== id && findNode(root, other) && isDescendant(findNode(root, other)!, id));
  });
}

/** 子节点在父级 children 里的下标（找不到返回 -1） */
export function indexOfChild(parent: SceneElement, id: string): number {
  return parent.children.findIndex((c) => c.id === id);
}

/** 把 node 及其所有后代的祖先链展开（用于"选中了隐藏元素里的子元素"时让父级可见） */
export function revealAncestors(root: SceneElement, node: SceneElement): void {
  const chain: SceneElement[] = [];
  let cur = findParent(root, node.id);
  while (cur) {
    chain.unshift(cur);
    cur = findParent(root, cur.id);
  }
  for (const n of chain) n.hidden = false;
}
