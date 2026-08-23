import { create } from 'zustand';
import type { SceneElement, SceneGraph, ElementType, ElementStyle } from '@lib/types';
import { SELF_CLOSING_TAGS, TEXT_ONLY_TAGS, CONTAINER_TAGS } from '@lib/types';
import { SCHEMA } from '@lib/propertySchema';

// 把 schema 转成 key→item 映射，便于 removeVisibleProp 知道一条属性对应的 style 字段
const SCHEMA_LOOKUP = new Map<string, (typeof SCHEMA)[number]>();
for (const s of SCHEMA) SCHEMA_LOOKUP.set(s.key, s);

// ============ 工具：UUID ============
function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const genId = uuid;

// ============ 节点工厂 ============
export function createElement(type: ElementType, overrides: Partial<SceneElement> = {}): SceneElement {
  return {
    id: uuid(),
    type,
    children: [],
    style: defaultStyleFor(type),
    text: defaultTextFor(type),
    attrs: defaultAttrsFor(type),
    ...overrides
  };
}

// 一些元素需要预设 HTML 原生属性
function defaultAttrsFor(type: ElementType): SceneElement['attrs'] {
  switch (type) {
    case 'a': return { href: '#' };
    case 'input':
    case 'textarea':
      return {};
    case 'img':
      return { src: '', alt: '' };
    default: return undefined;
  }
}

// 按元素类型给个看得见的默认样式（小白拖出来不懵）
// 容器带默认 padding 8px：浏览器原生只有 body 有 8px 外边距，div 等没有默认间距，
// 导致"div 里插 div"内外两层贴死。给容器加 8px 内边距 = 内外元素之间保留空隙
// （导入导出一致，div 套 div 也能看出两层）。
function defaultStyleFor(type: ElementType): ElementStyle {
  switch (type) {
    case 'div':
    case 'section':
    case 'header':
    case 'nav':
    case 'footer':
    case 'main':
    case 'article':
    case 'aside':
      return {
        backgroundColor: '#d4e7ff', minHeight: '60px', boxSizing: 'border-box',
        padding: '8px'
      };
    case 'h1':
      return { fontSize: '32px', fontWeight: '700' };
    case 'h2':
      return { fontSize: '24px', fontWeight: '700' };
    case 'h3':
      return { fontSize: '20px', fontWeight: '700' };
    case 'h4':
      return { fontSize: '16px', fontWeight: '700' };
    case 'p':
      return { lineHeight: '1.6' };
    case 'button':
      return {
        paddingTop: '8px', paddingRight: '16px', paddingBottom: '8px', paddingLeft: '16px',
        backgroundColor: '#1e88e5', color: '#fff',
        borderStyle: 'none',
        borderTopLeftRadius: '4px', borderTopRightRadius: '4px',
        borderBottomRightRadius: '4px', borderBottomLeftRadius: '4px',
        cursor: 'pointer',
        boxSizing: 'border-box'
      };
    case 'a':
      return { color: '#1e88e5', textDecoration: 'underline' };
    case 'span':
      return {
        display: 'inline-block',
        paddingTop: '2px', paddingRight: '6px', paddingBottom: '2px', paddingLeft: '6px',
        backgroundColor: '#fff3cd',
        boxSizing: 'border-box'
      };
    case 'img':
      return {
        width: '200px', height: '120px',
        backgroundColor: '#eee',
        borderStyle: 'dashed', borderColor: '#bbb',
        borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
        boxSizing: 'border-box'
      };
    case 'input':
      return {
        paddingTop: '6px', paddingRight: '8px', paddingBottom: '6px', paddingLeft: '8px',
        borderStyle: 'solid', borderColor: '#ccc',
        borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
        borderTopLeftRadius: '4px', borderTopRightRadius: '4px',
        borderBottomRightRadius: '4px', borderBottomLeftRadius: '4px',
        boxSizing: 'border-box'
      };
    case 'textarea':
      return {
        width: '280px', height: '80px',
        paddingTop: '6px', paddingRight: '8px', paddingBottom: '6px', paddingLeft: '8px',
        borderStyle: 'solid', borderColor: '#ccc',
        borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
        borderTopLeftRadius: '4px', borderTopRightRadius: '4px',
        borderBottomRightRadius: '4px', borderBottomLeftRadius: '4px',
        boxSizing: 'border-box'
      };
    case 'hr':
      return {
        // 分割线可见性：borderTop 1px 实线 + 浅灰色（UA 默认 inset 边框在去掉样式后不可见）
        borderStyle: 'solid', borderColor: '#c8ccd4',
        borderTopWidth: '1px', borderBottomWidth: '0', borderRightWidth: '0', borderLeftWidth: '0',
        marginTop: '12px', marginRight: '0', marginBottom: '12px', marginLeft: '0',
        backgroundColor: 'transparent',
        boxSizing: 'border-box'
      };
    case 'ul':
    case 'ol':
      return {
        display: 'block',
        paddingTop: '0', paddingRight: '0', paddingBottom: '0', paddingLeft: '32px',
        minHeight: '40px',
        borderStyle: 'dashed', borderColor: '#e0e0e0',
        borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
        boxSizing: 'border-box'
      };
    case 'li':
      return { display: 'list-item' };
    case 'label':
      return {
        display: 'inline-block', fontSize: '13px', color: '#555',
        paddingTop: '2px', paddingRight: '6px', paddingBottom: '2px', paddingLeft: '6px',
        boxSizing: 'border-box'
      };
    case 'form':
      return {
        backgroundColor: '#f1f8f4', minHeight: '60px',
        borderStyle: 'dashed', borderColor: '#c8e6c9',
        borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
        padding: '8px',
        boxSizing: 'border-box'
      };
    default:
      return { minHeight: '32px' };
  }
}

// 按元素类型给默认占位文案
function defaultTextFor(type: ElementType): string | undefined {
  switch (type) {
    case 'h1': return '一级标题';
    case 'h2': return '二级标题';
    case 'h3': return '三级标题';
    case 'h4': return '四级标题';
    case 'p': return '这里是段落文字，可以双击编辑。';
    case 'button': return '按钮';
    case 'a': return '链接文字';
    case 'label': return '标签';
    case 'span': return '行内文字';
    case 'li': return '列表项';
    case 'img': return undefined;
    case 'hr': return undefined;
    case 'input': return undefined;
    case 'textarea': return undefined;
    case 'ul': return undefined;
    case 'ol': return undefined;
    case 'form': return undefined;
    default: return undefined;
  }
}

// ============ 深拷贝 ============
function deepClone<T>(x: T): T {
  return structuredClone(x);
}

// ============ 树查询 ============
export function findNode(root: SceneElement, id: string): SceneElement | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return null;
}

function findParent(root: SceneElement, id: string, parent: SceneElement | null = null): SceneElement | null {
  if (root.id === id) return parent;
  for (const c of root.children) {
    const r = findParent(c, id, root);
    if (r !== null) return r;
  }
  return null;
}
export { findParent };

// 判断 candidate 是否是 node 的祖先（node 向上能走到 candidate）
function isAncestorOf(root: SceneElement, candidateId: string, nodeId: string): boolean {
  let cur: SceneElement | null = null;
  const target = findNode(root, nodeId);
  if (!target) return false;
  cur = findParent(root, nodeId);
  while (cur && cur !== root) {
    if (cur.id === candidateId) return true;
    cur = findParent(root, cur.id);
  }
  return false;
}

// 从选中的 id 集合中剔除"祖先也同时被选中"的后代 id：
// 多选复制/剪切父+子时，子级已含在父级子树快照里，不能再单独复制一份，
// 否则粘贴会重复出现（父级带子级 + 独立子级）。只保留"顶层"选中。
function pruneDescendantIds(root: SceneElement, ids: string[]): string[] {
  const idSet = new Set(ids.filter((id) => id !== root.id));
  return [...idSet].filter((id) => {
    for (const other of idSet) {
      if (other !== id && isAncestorOf(root, other, id)) return false;
    }
    return true;
  });
}

// 当前元素在父级 children 数组中的索引；找不到返回 -1
function indexOfChild(parent: SceneElement, id: string): number {
  return parent.children.findIndex((c) => c.id === id);
}

// 判断 candidate 是否是 node 的后代（禁止把父级挪进自己子树）
function isDescendant(node: SceneElement, candidateId: string): boolean {
  if (node.id === candidateId) return true;
  for (const c of node.children) {
    if (isDescendant(c, candidateId)) return true;
  }
  return false;
}

// 自 node 起向上把隐藏的祖先链全部解除隐藏。
// 往隐藏容器里插入/粘贴元素 → 自动显示该容器（含各级隐藏祖先），
// 保证"插进 div 的东西"永远在画布可见，不会只在图层树里
function revealAncestors(root: SceneElement, node: SceneElement): void {
  let cur: SceneElement | null = node;
  while (cur && cur !== root) {
    cur.hidden = false;
    cur = findParent(root, cur.id);
  }
}

// ============ 给树里所有元素重新分配 id（粘贴用，避免 id 冲突） ============
function reassignIds(node: SceneElement): SceneElement {
  return {
    ...node,
    id: uuid(),
    children: node.children.map(reassignIds)
  };
}

// 把剪贴板内容（单个元素或数组）追加到 target.children，并把选区设为"刚粘贴的元素"
function appendPasted(scene: SceneGraph, target: SceneElement, clip: SceneElement | SceneElement[]): void {
  const items = Array.isArray(clip) ? clip : [clip];
  const inserted = items.map((it) => reassignIds(deepClone(it)));
  target.children.push(...inserted);
  scene.selectedIds = inserted.map((n) => n.id);
  scene.selectedId = inserted.length ? inserted[inserted.length - 1].id : null;
}

// ============ History ============
interface History {
  past: SceneGraph[];
  future: SceneGraph[];
}

// ============ Store ============
interface SceneStore {
  scene: SceneGraph;
  history: History;
  // 内部剪贴板：单个元素或元素数组（多选复制/剪切）。数组元素永不为空。
  clipboard: SceneElement | SceneElement[] | null;
  /** beginStyleEdit 标记了"连续编辑"进行中：结束时的 updateStyle/updateAttr 不再额外入栈
   *（检查点已在 beginStyleEdit 压入），防止一次编辑压两栈导致撤销回不到编辑前 */
  styleEditPending: boolean;

  // 增删
  addElement: (type: ElementType, parentId?: string | null) => void;
  removeElement: (id: string) => void;
  /** 批量删除（多选删除）：一次历史快照，逐个从树中移除 */
  removeMany: (ids: string[]) => void;
  duplicateElement: (id: string) => void;
  copyElement: (id: string) => void;
  /** 剪切：复制到剪贴板 + 删除自身（一条 undo） */
  cutElement: (id: string) => void;
  /** 多选复制：把整棵子树快照放入剪贴板（≥1 个元素） */
  copyMany: (ids: string[]) => void;
  /** 多选剪切：复制 + 批量删除（一条 undo） */
  cutMany: (ids: string[]) => void;
  pasteInto: (parentId: string) => void;
  /** 粘贴到具名兄弟末尾：refId=null 或 ref=root 时插到根末尾；否则插到 ref 父级末尾
   *  （即粘贴的元素与 refId 同级，放在该父容器的最后） */
  pasteSibling: (refId: string | null) => void;

  // 重排
  moveChild: (id: string, direction: 'up' | 'down') => void;
  reparent: (id: string, newParentId: string, insertIndex?: number) => void;

  // 扩展（阶段3・第二批）：模板资源包插入（整棵子树重新分配 id）
  insertTemplate: (tree: SceneElement, parentId?: string | null) => void;

  // 选中（多选：Ctrl+点击 / Ctrl+A / 拖框；selectedId 始终是"主选中"，多选时取最后一次点中的）
  selectElement: (id: string | null) => void;
  /** Ctrl+点击切换：在集合里加/减；加时把该元素设为"主选中" */
  toggleSelect: (id: string) => void;
  /** 整体替换选区（拖框/Ctrl+A 用）；空数组 = 清空 */
  selectMany: (ids: string[]) => void;

  // 改样式 / 文案 / 元名 / 锁定 / 隐藏
  updateStyle: (id: string, partial: Partial<ElementStyle>) => void;
  // 瞬态改样式（连续拖动用，不入历史，结束时调 commit 入栈一次）
  updateStyleTransient: (id: string, partial: Partial<ElementStyle>) => void;
  // 类名编辑即同步：同 classString 的元素统一样式后（全量写回），编辑一个 = 编辑全部。
  // 无类名的元素只改自身。
  // 类管理（「类名」页签）：把某名称（类/ID）下所有元素的样式统一为指定样式（一条 undo）
  unifyClassName: (name: string, style: ElementStyle) => void;
  // 标记一次连续编辑的开始：把当前 scene 推入 past 作为还原点
  beginStyleEdit: () => void;
  // 聚焦编辑会话（focus→blur）的收尾：只清标记不压栈
  endStyleEdit: () => void;
  // 改 HTML 原生属性 (class/id/src/alt/href 等)
  updateAttr: (id: string, key: string, value: string) => void;
  // 页面级：用户全局 CSS（导出进 <style> 末尾，可覆盖自动样式类）
  setGlobalCss: (text: string) => void;
  // 页面快速设置（4-D）：合并更新 body/a 可视化项，导出顺序：自动样式 → 快速设置 → 高级 CSS
  setQuickCss: (patch: Record<string, string | undefined>) => void;
  // 显式标记"已添加"的 CSS schema key（用户从"+ 添加属性"加入后即记入，
  // 即使值被清空也保留，避免 user 编辑值时属性行消失）
  addVisibleProp: (id: string, key: string) => void;
  removeVisibleProp: (id: string, key: string) => void;
  setText: (id: string, text: string) => void;
  renameElement: (id: string, name: string) => void; // 阶段1只用 type 当显示名，预留
  toggleHidden: (id: string) => void;
  toggleLocked: (id: string) => void;

  // 历史
  commit: () => void;
  undo: () => void;
  redo: () => void;

  // 整体
  setScene: (s: SceneGraph) => void;
}

// 初始空场景：一个 body 根
const initialRoot: SceneElement = createElement('div', {
  id: 'root',
  text: undefined,
  style: { width: '100%', height: '100%', backgroundColor: '#ffffff' }
});

const initialScene: SceneGraph = {
  root: initialRoot,
  selectedId: null,
  selectedIds: []
};

export const useScene = create<SceneStore>((set) => ({
  scene: initialScene,
  history: { past: [], future: [] },
  clipboard: null,
  styleEditPending: false,

  addElement: (type, parentId = null) => {
    set((st) => {
      const scene = deepClone(st.scene);
      let parent = parentId ? findNode(scene.root, parentId) : scene.root;
      if (!parent) parent = scene.root;
      // 选中项是自闭合元素（img/input/hr 等，没有子元素槽位）或文本独占（textarea）：
      // 不能静默丢弃插入，升级插入到它的父容器
      while (parent !== scene.root && (SELF_CLOSING_TAGS.has(parent.type) || TEXT_ONLY_TAGS.has(parent.type))) {
        parent = findParent(scene.root, parent.id) ?? scene.root;
      }
      const el = createElement(type);
      parent.children.push(el);
      revealAncestors(scene.root, parent);
      scene.selectedId = el.id;
      scene.selectedIds = [el.id];
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  // 插入模板（元素子树快照）：整棵树重新分配 id（防与现有元素撞车），插入选中容器
  insertTemplate: (tree, parentId = null) => {
    set((st) => {
      const scene = deepClone(st.scene);
      let parent = parentId ? findNode(scene.root, parentId) : scene.root;
      if (!parent) parent = scene.root;
      while (parent !== scene.root && (SELF_CLOSING_TAGS.has(parent.type) || TEXT_ONLY_TAGS.has(parent.type))) {
        parent = findParent(scene.root, parent.id) ?? scene.root;
      }
      // 深拷贝 + 全树换 id（模板可能被插入多次，id 必须唯一）
      const renew = (n: SceneElement): SceneElement => {
        const c = { ...n, id: genId() } as SceneElement;
        if (c.children) c.children = c.children.map(renew);
        return c;
      };
      const el = renew(deepClone(tree));
      parent.children.push(el);
      revealAncestors(scene.root, parent);
      scene.selectedId = el.id;
      scene.selectedIds = [el.id];
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  removeElement: (id) => {
    set((st) => {
      if (id === st.scene.root.id) return st;
      const scene = deepClone(st.scene);
      const parent = findParent(scene.root, id);
      if (!parent) return st;
      const idx = indexOfChild(parent, id);
      if (idx < 0) return st;
      parent.children.splice(idx, 1);
      scene.selectedIds = scene.selectedIds.filter((sid) => sid !== id);
      if (scene.selectedId === id) scene.selectedId = scene.selectedIds[0] ?? null;
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  removeMany: (ids) => {
    set((st) => {
      const pruned = pruneDescendantIds(st.scene.root, ids);
      if (pruned.length === 0) return st;
      const scene = deepClone(st.scene);
      const idSet = new Set(pruned);
      // 逐个从父节点的 children 里移除；被删元素的后代一并消失（不在集合里也无需处理）
      let removed = false;
      for (const id of pruned) {
        if (id === scene.root.id) continue;
        const parent = findParent(scene.root, id);
        if (!parent) continue;
        const idx = indexOfChild(parent, id);
        if (idx < 0) continue;
        parent.children.splice(idx, 1);
        removed = true;
      }
      if (!removed) return st;
      scene.selectedIds = scene.selectedIds.filter((sid) => !idSet.has(sid));
      if (scene.selectedId && idSet.has(scene.selectedId)) scene.selectedId = scene.selectedIds[0] ?? null;
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  duplicateElement: (id) => {
    set((st) => {
      if (id === st.scene.root.id) return st;
      const scene = deepClone(st.scene);
      const parent = findParent(scene.root, id);
      const node = parent ? findNode(scene.root, id) : null;
      if (!parent || !node) return st;
      const idx = indexOfChild(parent, id);
      if (idx < 0) return st;
      const copy = reassignIds(deepClone(node));
      parent.children.splice(idx + 1, 0, copy);
      scene.selectedId = copy.id;
      scene.selectedIds = [copy.id];
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  copyMany: (ids) => {
    set((st) => {
      const selected = pruneDescendantIds(st.scene.root, ids);
      const nodes: SceneElement[] = [];
      for (const id of selected) {
        const n = findNode(st.scene.root, id);
        if (n) nodes.push(deepClone(n));
      }
      if (nodes.length === 0) return st;
      return { clipboard: nodes.length === 1 ? nodes[0] : nodes };
    });
  },

  copyElement: (id) => {
    set((st) => {
      const node = findNode(st.scene.root, id);
      if (!node) return st;
      return { clipboard: deepClone(node) };
    });
  },

  // 多选剪切：把选中的子树拷进剪贴板，再从树里一次性移除（一条 undo）
  cutMany: (ids) => {
    set((st) => {
      const selected = pruneDescendantIds(st.scene.root, ids);
      if (selected.length === 0) return st;
      const nodes: SceneElement[] = [];
      for (const id of selected) {
        const n = findNode(st.scene.root, id);
        if (n) nodes.push(deepClone(n));
      }
      if (nodes.length === 0) return st;
      const scene = deepClone(st.scene);
      for (const id of selected) {
        const parent = findParent(scene.root, id);
        if (!parent) continue;
        const idx = indexOfChild(parent, id);
        if (idx >= 0) parent.children.splice(idx, 1);
      }
      scene.selectedIds = scene.selectedIds.filter((sid) => !selected.includes(sid));
      if (scene.selectedId && selected.includes(scene.selectedId)) {
        scene.selectedId = scene.selectedIds[0] ?? null;
      }
      return { scene, clipboard: nodes.length === 1 ? nodes[0] : nodes, history: pushPast(st.history, st.scene) };
    });
  },

  // 剪切：先把节点拷到剪贴板，再删除。copy 不入历史，删除入历史一次（一条 undo）
  cutElement: (id) => {
    set((st) => {
      if (id === st.scene.root.id) return st; // 根不可剪切
      const node = findNode(st.scene.root, id);
      if (!node) return st;
      const clip = deepClone(node);
      const scene = deepClone(st.scene);
      const parent = findParent(scene.root, id);
      if (!parent) return { clipboard: clip };
      const idx = indexOfChild(parent, id);
      if (idx < 0) return { clipboard: clip };
      parent.children.splice(idx, 1);
      scene.selectedIds = scene.selectedIds.filter((sid) => sid !== id);
      if (scene.selectedId === id) scene.selectedId = scene.selectedIds[0] ?? null;
      return { scene, clipboard: clip, history: pushPast(st.history, st.scene) };
    });
  },

  pasteInto: (parentId) => {
    set((st) => {
      if (!st.clipboard) return st;
      const scene = deepClone(st.scene);
      const parent = findNode(scene.root, parentId);
      if (!parent || SELF_CLOSING_TAGS.has(parent.type)) return st;
      appendPasted(scene, parent, st.clipboard);
      revealAncestors(scene.root, parent);
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  // 粘贴成兄弟：ref=null 或是根 → 插根末尾；否则插到 ref 父级末尾（与 ref 同级）
  pasteSibling: (refId) => {
    set((st) => {
      if (!st.clipboard) return st;
      const scene = deepClone(st.scene);
      let target: SceneElement;
      if (refId === null || refId === undefined || refId === st.scene.root.id) {
        target = scene.root;
      } else {
        const ref = findNode(scene.root, refId);
        if (!ref) return st;
        if (ref === scene.root) {
          target = scene.root;
        } else {
          const parent = findParent(scene.root, refId);
          if (!parent) return st;
          target = parent;
        }
      }
      if (SELF_CLOSING_TAGS.has(target.type)) return st;
      appendPasted(scene, target, st.clipboard);
      revealAncestors(scene.root, target);
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  moveChild: (id, direction) => {
    set((st) => {
      if (id === st.scene.root.id) return st;
      const scene = deepClone(st.scene);
      const parent = findParent(scene.root, id);
      if (!parent) return st;
      const idx = indexOfChild(parent, id);
      if (idx < 0) return st;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= parent.children.length) return st;
      const [moved] = parent.children.splice(idx, 1);
      parent.children.splice(target, 0, moved);
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  reparent: (id, newParentId, insertIndex) => {
    set((st) => {
      if (id === st.scene.root.id) return st;
      if (id === newParentId) return st;
      if (newParentId && isDescendant(findNode(st.scene.root, id)!, newParentId)) return st; // 禁止移进自己后代
      const scene = deepClone(st.scene);
      const oldParent = findParent(scene.root, id);
      const newParent = findNode(scene.root, newParentId);
      const node = findNode(scene.root, id);
      if (!oldParent || !newParent || !node) return st;
      if (SELF_CLOSING_TAGS.has(newParent.type)) return st;
      const oldIdx = indexOfChild(oldParent, id);
      if (oldIdx < 0) return st;
      oldParent.children.splice(oldIdx, 1);
      const at = insertIndex == null ? newParent.children.length : Math.min(insertIndex, newParent.children.length);
      newParent.children.splice(at, 0, node);
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  selectElement: (id) => set((st) => ({
    scene: {
      ...st.scene,
      selectedId: id,
      selectedIds: id == null ? [] : [id]
    }
  })),

  toggleSelect: (id) => set((st) => {
    if (id === st.scene.root.id) return st;
    const has = st.scene.selectedIds.includes(id);
    const selectedIds = has
      ? st.scene.selectedIds.filter((sid) => sid !== id)
      : [...st.scene.selectedIds, id];
    return {
      scene: {
        ...st.scene,
        selectedIds,
        // 加选 → 该元素成为主选中；反选掉主选中 → 主选中落到集合内最后一个
        selectedId: has
          ? (selectedIds.length ? selectedIds[selectedIds.length - 1] : null)
          : id
      }
    };
  }),

  selectMany: (ids) => set((st) => ({
    scene: {
      ...st.scene,
      selectedIds: ids,
      selectedId: ids.length ? ids[ids.length - 1] : null
    }
  })),

  // 改样式（入历史，单步操作；连续编辑收尾时检查点已在 beginStyleEdit 压栈，不再重复入栈）
  // 同 classString 的元素自动同步（编辑即统一：类 = 一种样子，改一个全改）
  updateStyle: (id, partial) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      node.style = { ...node.style, ...partial };
      syncClassmates(scene.root, node);
      // 会话中（beginStyleEdit 已压检查点）不重复入栈；单次提交（无会话）才入栈。
      // 注意：这里不能重置 styleEditPending —— 否则"聚焦→改→选单位→改"过程中
      // 第一个提交就把标记清掉，后续提交会多压快照（撤销看起来没反应）
      const push = !st.styleEditPending;
      return { scene, history: push ? pushPast(st.history, st.scene) : st.history };
    });
  },

  // 改样式（瞬态，不入历史）——用于颜色拖动等连续输入
  // 调用方在交互开始前调 beginStyleEdit() 标记起点、交互结束调 commit() 入栈一次
  updateStyleTransient: (id, partial) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      node.style = { ...node.style, ...partial };
      syncClassmates(scene.root, node);
      return { scene }; // 不动 history
    });
  },

  // 类名/ID 管理（「类名」页签）：把名称下所有元素的样式统一（先改第一个同名的，再全量写回）
  unifyClassName: (name, style) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const trimmed = name.trim();
      if (!trimmed) return st;
      const ids: string[] = [];
      const walk = (n: SceneElement): void => {
        const cls = (n.attrs?.className ?? '').trim();
        const idv = (n.attrs?.id ?? '').trim();
        if (cls === trimmed || (idv !== '' && idv === trimmed)) ids.push(n.id);
        for (const c of n.children) walk(c);
      };
      walk(scene.root);
      if (ids.length === 0) return st;
      // 写同一份（深拷贝防共享引用）
      const newStyle = deepClone(style);
      for (const sid of ids) {
        const n = findNode(scene.root, sid);
        if (n) n.style = { ...newStyle };
      }
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  // 标记一次"连续编辑"的开始：把当前 scene 推入 past 作为还原点
  // 之后调 updateStyleTransient 任意次都不进栈；收尾的 updateStyle 由 styleEditPending 兜底不重复入栈
  // 已在会话中（重复 focus）不重复压检查点，否则撤销会多跳一步
  beginStyleEdit: () => {
    set((st) => {
      if (st.styleEditPending) return st;
      return { styleEditPending: true, history: pushPast(st.history, st.scene) };
    });
  },

  // 结束一次"聚焦编辑"会话：清掉标记（不压栈）。
  // 会话 = focus 到 blur；beginStyleEdit 在 focus 压检查点，blur 收尾提交后调用本函数。
  endStyleEdit: () => {
    set(() => ({ styleEditPending: false }));
  },

  // 改 HTML 原生属性（class / id / src / alt / href 等）
  updateAttr: (id, key, value) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      if (!node.attrs) node.attrs = {};
      if (value === '') delete node.attrs[key];
      else node.attrs[key] = value;
      const push = !st.styleEditPending;
      return { scene, history: push ? pushPast(st.history, st.scene) : st.history };
    });
  },

  // 页面级全局 CSS（入历史；配合 beginStyleEdit/endStyleEdit 会话：blur 一次性提交）
  setGlobalCss: (text) => {
    set((st) => {
      const push = !st.styleEditPending;
      return {
        scene: { ...st.scene, globalCss: text },
        history: push ? pushPast(st.history, st.scene) : st.history
      };
    });
  },

  // 页面快速设置（阶段4・D）：可视化改 body/a 常用属性，会生成 CSS 放进导出
  setQuickCss: (patch) => {
    set((st) => {
      const push = !st.styleEditPending;
      return {
        scene: { ...st.scene, quickCss: { ...(st.scene.quickCss ?? {}), ...patch } },
        history: push ? pushPast(st.history, st.scene) : st.history
      };
    });
  },

  addVisibleProp: (id, key) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      const list = node.visibleProps ?? [];
      if (!list.includes(key)) list.push(key);
      node.visibleProps = list;
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  removeVisibleProp: (id, key) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      // 移出列表
      if (node.visibleProps) {
        node.visibleProps = node.visibleProps.filter((k) => k !== key);
        if (node.visibleProps.length === 0) node.visibleProps = undefined;
      }
      // 清空对应 style 字段（含 4 边拆分）
      const item = SCHEMA_LOOKUP.get(key);
      if (item) {
        const keys = (item.input === 'box4' || item.input === 'trbl') && item.sides
          ? item.sides.map((s) => s.key)
          : [item.key];
        for (const k of keys) (node.style as Record<string, string | undefined>)[k] = undefined;
      }
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  setText: (id, text) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      node.text = text;
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  renameElement: (_id, _name) => {
    // 阶段1：暂未实现自定义命名，UI 仅展示 type
  },

  toggleHidden: (id) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      node.hidden = !node.hidden;
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  toggleLocked: (id) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      node.locked = !node.locked;
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  // 连续编辑收尾（如颜色拖动结束）：入栈一次并清标记。
  // 若会话已由 beginStyleEdit 压过检查点（本会话内瞬态编辑多次），不再重复入栈。
  commit: () => set((st) => ({
    history: st.styleEditPending ? st.history : pushPast(st.history, st.scene),
    styleEditPending: false
  })),
  undo: () =>
    set((st) => {
      if (st.history.past.length === 0) return st;
      const past = [...st.history.past];
      const prev = past.pop()!;
      return {
        scene: prev,
        styleEditPending: false,
        history: { past, future: [st.scene, ...st.history.future] }
      };
    }),
  redo: () =>
    set((st) => {
      if (st.history.future.length === 0) return st;
      const [next, ...rest] = st.history.future;
      return {
        scene: next,
        styleEditPending: false,
        history: { past: [...st.history.past, st.scene], future: rest }
      };
    }),

  setScene: (s) => set(() => ({ scene: s, history: { past: [], future: [] }, styleEditPending: false }))
}));

function pushPast(h: History, snapshot: SceneGraph): History {
  const past = [...h.past, snapshot];
  if (past.length > 200) past.shift();
  return { past, future: [] };
}

// 「编辑即统一」：node 有类名(classString)时，把整棵树上所有同 classString 的
// 元素样式全量覆盖为 node 当前样式 —— 类 = 一种样子，改一个全跟着变。
// 无类名元素（或 root）不触发联动。
function syncClassmates(root: SceneElement, node: SceneElement): void {
  const cls = (node.attrs?.className ?? '').trim();
  if (!cls || node === root) return;
  const target = deepClone(node.style);
  const walk = (n: SceneElement): void => {
    if (n !== node && (n.attrs?.className ?? '').trim() === cls) {
      n.style = { ...target };
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
}

// re-export for components
export { CONTAINER_TAGS, SELF_CLOSING_TAGS };
