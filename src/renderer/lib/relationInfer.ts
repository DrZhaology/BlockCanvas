// BlockCanvas · 智能关系选择器推导算法
// 核心逻辑：从目标元素向上查找最近的有类名或 ID 的祖先容器（锚点），
// 根据同类兄弟节点数量与序号（优先使用 :nth-of-type，防止插图等跨标签操作破坏序号），
// 自动推导出 1~3 个最干净、可读性最高的关系选择器供用户一键应用。

import type { SceneElement } from './types';

export interface RelCandidate {
  selector: string;
  label: string;
  description: string;
  recommended?: boolean;
  /** 是否是面向所有同类子代的分组规则（如 .hero > p，而非 .hero > p:first-of-type） */
  isGroup?: boolean;
}

export interface RelInferResult {
  ok: boolean;
  error?: string;
  anchorName?: string;
  candidates: RelCandidate[];
}

/** 向上查找一条通往目标 id 的路径节点数组 [root, ..., target] */
function findNodePath(root: SceneElement, targetId: string): SceneElement[] | null {
  if (root.id === targetId) return [root];
  for (const c of root.children) {
    const p = findNodePath(c, targetId);
    if (p) return [root, ...p];
  }
  return null;
}

/** 查找最近的带 className 或 id 的祖先容器 */
function findNearestAnchor(path: SceneElement[], rootId: string): { anchorNode: SceneElement; anchorIndex: number; anchorSel: string } | null {
  for (let i = path.length - 2; i >= 0; i--) {
    const node = path[i];
    if (node.id === rootId) continue;
    const cls = (node.attrs?.className ?? '').trim();
    const idv = (node.attrs?.id ?? '').trim();
    if (cls || idv) {
      const anchorSel = cls ? '.' + cls.split(/\s+/)[0] : '#' + idv;
      return { anchorNode: node, anchorIndex: i, anchorSel };
    }
  }
  return null;
}

/** 为单元素智能推导关系选择器推荐列表 */
export function inferRelationalSelectors(root: SceneElement, elementId: string): RelInferResult {
  const path = findNodePath(root, elementId);
  if (!path || path.length < 2) {
    return { ok: false, error: '根元素无法关联父级', candidates: [] };
  }

  const target = path[path.length - 1];
  const parent = path[path.length - 2];
  const anchor = findNearestAnchor(path, root.id);

  if (!anchor) {
    return {
      ok: false,
      error: '上层没有带类名或 ID 的父容器。请先给外层容器（如 section、div、header 等）起个类名。',
      candidates: []
    };
  }

  const { anchorNode, anchorIndex, anchorSel } = anchor;
  const tag = target.type;
  const candidates: RelCandidate[] = [];
  const isDirectChild = anchorNode.id === parent.id;

  if (isDirectChild) {
    const sameTagSiblings = parent.children.filter((c) => c.type === tag);
    const totalSame = sameTagSiblings.length;
    const selfIndex = sameTagSiblings.findIndex((c) => c.id === target.id) + 1;

    if (totalSame === 1) {
      candidates.push({
        selector: `${anchorSel} > ${tag}`,
        label: `${anchorSel} > ${tag}`,
        description: `容器内唯一的 <${tag}>，标准直接子代选择器（最推荐）`,
        recommended: true,
        isGroup: true
      });
      candidates.push({
        selector: `${anchorSel} ${tag}`,
        label: `${anchorSel} ${tag}`,
        description: `后代选择器，匹配内部任意深度的 <${tag}>`,
        isGroup: true
      });
    } else {
      if (selfIndex === 1) {
        candidates.push({
          selector: `${anchorSel} > ${tag}:first-of-type`,
          label: `${anchorSel} > ${tag}:first-of-type`,
          description: `容器内第 1 个 <${tag}>（插图不影响序号）`,
          recommended: true,
          isGroup: false
        });
      } else if (selfIndex === totalSame) {
        candidates.push({
          selector: `${anchorSel} > ${tag}:last-of-type`,
          label: `${anchorSel} > ${tag}:last-of-type`,
          description: `容器内最后 1 个 <${tag}>`,
          recommended: true,
          isGroup: false
        });
      } else {
        candidates.push({
          selector: `${anchorSel} > ${tag}:nth-of-type(${selfIndex})`,
          label: `${anchorSel} > ${tag}:nth-of-type(${selfIndex})`,
          description: `容器内第 ${selfIndex} 个 <${tag}>（同标签排号）`,
          recommended: true,
          isGroup: false
        });
      }

      candidates.push({
        selector: `${anchorSel} > ${tag}`,
        label: `全部同类: ${anchorSel} > ${tag}`,
        description: `让容器内全部 ${totalSame} 个 <${tag}> 共享这套选择器与样式（自动批量应用）`,
        isGroup: true
      });
    }
  } else {
    const intermediate = path.slice(anchorIndex + 1, path.length - 1);
    const deepTagPath = intermediate.map((n) => n.type).concat(tag).join(' > ');

    candidates.push({
      selector: `${anchorSel} ${tag}`,
      label: `${anchorSel} ${tag}`,
      description: `后代选择器：命中 ${anchorSel} 内部任意层级的 <${tag}>`,
      recommended: true,
      isGroup: true
    });

    candidates.push({
      selector: `${anchorSel} > ${deepTagPath}`,
      label: `${anchorSel} > ${deepTagPath}`,
      description: `完整层级子代路径（严格按结构匹配）`,
      isGroup: true
    });
  }

  return {
    ok: true,
    anchorName: anchorSel,
    candidates
  };
}

/** 为多选元素智能推导共同关系选择器 */
export function inferMultiRelationalSelectors(root: SceneElement, elementIds: string[]): RelInferResult {
  if (elementIds.length < 2) return { ok: false, error: '至少需要选择 2 个元素', candidates: [] };

  const paths = elementIds.map((id) => findNodePath(root, id)).filter(Boolean) as SceneElement[][];
  if (paths.length !== elementIds.length) {
    return { ok: false, error: '部分选中元素未找到路径', candidates: [] };
  }

  // 找它们公共的父级/祖先
  const anchors = paths.map((p) => findNearestAnchor(p, root.id));
  if (anchors.some((a) => !a)) {
    return { ok: false, error: '选中的元素上层没有带类名或 ID 的公共父容器，请先给父容器命名。', candidates: [] };
  }

  // 是否拥有同一个直接父级锚点
  const firstAnchor = anchors[0]!;
  const sameAnchor = anchors.every((a) => a!.anchorNode.id === firstAnchor.anchorNode.id);

  if (!sameAnchor) {
    return { ok: false, error: '选中的元素不在同一个父容器内，无法统一推导。', candidates: [] };
  }

  const { anchorSel } = firstAnchor;
  const elements = paths.map((p) => p[p.length - 1]);
  const types = new Set(elements.map((e) => e.type));
  const candidates: RelCandidate[] = [];

  if (types.size === 1) {
    const tag = [...types][0];
    candidates.push({
      selector: `${anchorSel} > ${tag}`,
      label: `${anchorSel} > ${tag}`,
      description: `给全部选中的 <${tag}> 统一设置子代选择器（最推荐）`,
      recommended: true,
      isGroup: true
    });
    candidates.push({
      selector: `${anchorSel} ${tag}`,
      label: `${anchorSel} ${tag}`,
      description: `后代选择器：命中 ${anchorSel} 内所有 <${tag}>`,
      isGroup: true
    });
  } else {
    // 混合标签类型
    candidates.push({
      selector: `${anchorSel} > *`,
      label: `${anchorSel} > *`,
      description: `通配直接子元素：命中容器内所有子项`,
      recommended: true,
      isGroup: true
    });
  }

  return {
    ok: true,
    anchorName: anchorSel,
    candidates
  };
}
