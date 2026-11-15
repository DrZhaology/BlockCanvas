import { create } from 'zustand';
import type { SceneElement, SceneGraph, ElementType, ElementStyle, Breakpoint } from '@lib/types';
import { SELF_CLOSING_TAGS, TEXT_ONLY_TAGS, CONTAINER_TAGS } from '@lib/types';
import { SCHEMA } from '@lib/propertySchema';
import { flyOutElement } from '@lib/elLeave';
import type { TokenEntry } from '@lib/designTokens';
// v0.4.6（R6-5）：树查询与样式合并搬到 store/scene/*（纯函数，可单测）
import {
  deepClone, findNode, findParent, findFirstWithToken, findFirstWithRel,
  pruneDescendantIds, indexOfChild, isDescendant, revealHost
} from './scene/tree';
import { getEffectiveStyle } from './scene/style';
import { stripAncestorChildStyles } from './scene/childStyles';
import { pushPast, type History as SceneHistory } from './scene/history';
import { reassignIds, appendPasted } from './scene/structure';
import { syncClassmates } from './scene/sync';
import { uuid, defaultAttrsFor, defaultStyleFor, defaultTextFor } from './scene/factory';

/**
 * v0.4.6：**保持对外导出不变**。
 *
 * `findNode` / `findParent` / `getEffectiveStyle` 有 40+ 个调用点从 `@store/sceneStore` 导入，
 * 搬实现时不能顺手改调用方（那会让"重构"变成"大范围改业务代码"，风险高且 diff 噪音大）。
 * 所以这里原样 re-export —— 调用方一行不用改，实现已经分层。
 */
export { findNode, findParent, getEffectiveStyle };

// 把 schema 转成 key→item 映射，便于 removeVisibleProp 知道一条属性对应的 style 字段
const SCHEMA_LOOKUP = new Map<string, (typeof SCHEMA)[number]>();
for (const s of SCHEMA) SCHEMA_LOOKUP.set(s.key, s);
const genId = uuid;

// ============ 节点工厂 ============
// 需要默认内边距的块级容器（div 及同类容器）：
// 新插入自带 8px padding —— 嵌套/堆叠不会完全叠在一起看不出层次，
// 且写入 visibleProps 让右侧「CSS 样式属性」把"内边距"行列出来（可改可清）。
const PADDED_CONTAINER_TYPES: ReadonlySet<ElementType> = new Set([
  'div', 'section', 'header', 'nav', 'footer', 'main', 'article', 'aside'
]);

export function createElement(type: ElementType, overrides: Partial<SceneElement> = {}): SceneElement {
  return {
    id: uuid(),
    type,
    children: [],
    style: defaultStyleFor(type),
    text: defaultTextFor(type),
    attrs: defaultAttrsFor(type),
    ...(PADDED_CONTAINER_TYPES.has(type) ? { visibleProps: ['padding'] } : {}),
    ...overrides
  };
}

// ============ Store ============
export interface SceneStore {
  scene: SceneGraph;
  history: SceneHistory;
  // 内部剪贴板：单个元素或元素数组（多选复制/剪切）。数组元素永不为空。
  clipboard: SceneElement | SceneElement[] | null;
  /** beginStyleEdit 标记了"连续编辑"进行中：结束时的 updateStyle/updateAttr 不再额外入栈
   *（检查点已在 beginStyleEdit 压入），防止一次编辑压两栈导致撤销回不到编辑前 */
  styleEditPending: boolean;
  /** 当前编辑所处的响应式断点（桌面 / 平板 / 手机） */
  activeBreakpoint: Breakpoint;
  setActiveBreakpoint: (bp: Breakpoint) => void;
  /**
   * 伪类实时预览（v0.4.4）：在右侧选中 :hover / :active / :focus / :link 时，
   * 画布把该伪类的样式**临时叠加**到选中元素上，让用户立刻看到效果。
   * 纯编辑器状态，不进工程文件、不进撤销栈。
   *
   * 为什么需要：没有类名/ID 的元素在画布上是**内联样式**，内联永远压过 `:hover` 规则，
   * 所以"伪类设置完全没用"（用户反馈）。有类名时真实 :hover 仍可正常悬停预览。
   */
  previewPseudo: string | null;
  setPreviewPseudo: (p: string | null) => void;

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
  /** 粘贴：优先插入到当前选中元素的内部；若选中的是自闭合/无法包含子级的叶子元素，自动降级粘贴到其父容器；未选中则插到画布根末尾 */
  paste: (selectedId?: string | null) => void;
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
  updateStyle: (id: string, partial: Partial<ElementStyle>, breakpointOverride?: Breakpoint) => void;
  // 瞬态改样式（连续拖动用，不入历史，结束时调 commit 入栈一次）
  updateStyleTransient: (id: string, partial: Partial<ElementStyle>, breakpointOverride?: Breakpoint) => void;
  // 清空指定属性或断点的响应式覆盖（还原继承电脑端）
  clearBreakpointOverride: (id: string, propKey?: string, breakpoint?: Breakpoint) => void;
  // 类名编辑即同步：同 classString 的元素统一样式后（全量写回），编辑一个 = 编辑全部。
  // 无类名的元素只改自身。
  // 类管理（「类名」页签）：把某名称（类/ID）下所有元素的样式统一为指定样式（一条 undo）。
  // kind='class'：匹配 className 中**包含该 token** 的元素；kind='id'：只精确匹配 attrs.id
  //（分开匹配，修复旧版 class/id 同名互相误伤的问题）
  unifyClassName: (name: string, style: ElementStyle, kind?: 'class' | 'id') => void;
  // 批量重命名类名 token：所有 className 含 oldName 的元素换成 newName（一条 undo）
  renameClassToken: (oldName: string, newName: string) => void;
  // 批量移除类名 token：所有 className 含该 token 的元素移除它（一条 undo）
  removeClassToken: (name: string) => void;
  // 子元素样式（关系选择器）：整体替换某元素的 childStyles 列表（配合 begin/end 会话一条 undo）
  setChildStyles: (id: string, list: { sel: string; css: string }[]) => void;
  // 设置单元素的关系选择器（如 .hero > h1）；applyToSiblings 为 true 时自动同步给容器内同标签的所有直接子元素
  setRelSelector: (id: string, selector: string | null, applyToSiblings?: boolean) => void;
  // 多选元素批量设置关系选择器
  setMultiRelSelector: (ids: string[], selector: string | null) => void;
  // 标记一次连续编辑的开始：把当前 scene 推入 past 作为还原点
  beginStyleEdit: () => void;
  // 聚焦编辑会话（focus→blur）的收尾：只清标记不压栈
  endStyleEdit: () => void;
  // 改 HTML 原生属性 (class/id/src/alt/href 等)
  updateAttr: (id: string, key: string, value: string) => void;
  // 富文本片段样式（v0.4.4d）：把文字里 [start, end) 这一段包成带内联样式的 run
  //（导出成 `<span style="…">选中文字</span>`，**不走 CSS 选择器**，只影响这一段）
  applyTextRunStyle: (id: string, start: number, end: number, patch: Partial<ElementStyle>) => void;
  // 页面级：用户全局 CSS（导出进 <style> 末尾，可覆盖自动样式类）
  setGlobalCss: (text: string) => void;
  // 页面快速设置（4-D）：合并更新 body/a 可视化项，导出顺序：自动样式 → 快速设置 → 高级 CSS
  setQuickCss: (patch: Record<string, string | undefined>) => void;
  // 设计变量（v0.4.0）：整份替换 tokens 列表（增 / 删 / 改名 / 改值都走这里，算一步撤销）
  setTokens: (tokens: TokenEntry[]) => void;
  // 显式标记"已添加"的 CSS schema key（用户从"+ 添加属性"加入后即记入，
  // 即使值被清空也保留，避免 user 编辑值时属性行消失）
  addVisibleProp: (id: string, key: string) => void;
  removeVisibleProp: (id: string, key: string) => void;
  // 伪类样式（:hover/:active/:focus/:link 等）更新与移除
  updatePseudoStyle: (id: string, pseudo: string, patch: Record<string, string>) => void;
  removePseudoStyle: (id: string, pseudo: string, key?: string) => void;
  setText: (id: string, text: string) => void;
  renameElement: (id: string, name: string) => void; // 阶段1只用 type 当显示名，预留
  toggleHidden: (id: string) => void;
  toggleLocked: (id: string) => void;
  /**
   * v0.4.3 表格：设置这张 <table> 是否参与「导出前体检」（缺省 = 不参与）。
   * 纯编辑器侧标记，不进导出；开关在表格编辑器右侧面板。
   */
  setHealthCheck: (id: string, on: boolean) => void;
  /** v0.4.3 表格编辑：写 HTML 原生属性（colspan / rowspan / scope 等）；value 传 undefined 即删除该属性 */
  setNodeAttr: (id: string, key: string, value: string | undefined) => void;
  /**
   * v0.4.3 表格编辑：整体替换某节点的子树（表格结构操作都走它 —— 一条 undo）。
   * 新树的 id 由调用方负责（tableOps 里已保证沿用旧 id，避免选中态丢失）。
   */
  replaceSubtree: (id: string, next: SceneElement) => void;

  // 历史
  commit: () => void;
  undo: () => void;
  redo: () => void;

  // 插入时是否智能继承同级选择器与样式（非根容器内有效）
  autoInherit: boolean;
  setAutoInherit: (v: boolean) => void;

  // 整体
  setScene: (s: SceneGraph) => void;
  /** 右侧面板板块开合记忆（存进 scene.uiState → 随工程文件保存；不触发脏标记、不进撤销栈） */
  setInspectorSec: (key: string, val: { identity: boolean; layout: boolean; css: boolean; pseudo: boolean }) => void;
  /** 「页面」栏两大板块开合记忆（body 设置 / 全局样式），同样存 scene.uiState */
  setPageSec: (patch: { body?: boolean; global?: boolean }) => void;
  /** 变量面板分组开合记忆（按分组名），同样存 scene.uiState */
  setTokenGroupOpen: (group: string, open: boolean) => void;
  /** 页面「全局样式」：任意 CSS 属性（key=属性名），undefined/空串 = 删除该属性；走撤销栈 */
  setBodyExtra: (patch: Record<string, string | undefined>) => void;
  /** 基准视口高度（v0.4.6 / R6-16）：fixed 的空气墙 + 画布最小高度；走撤销栈 */
  setViewportHeight: (px: number) => void;
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
  activeBreakpoint: 'desktop',
  setActiveBreakpoint: (bp) => set({ activeBreakpoint: bp }),
  previewPseudo: null,
  setPreviewPseudo: (p) => set({ previewPseudo: p }),
  autoInherit: typeof localStorage !== 'undefined' ? localStorage.getItem('bc-auto-inherit') !== '0' : true,
  setAutoInherit: (v) => {
    try { localStorage.setItem('bc-auto-inherit', v ? '1' : '0'); } catch {}
    set(() => ({ autoInherit: v }));
  },

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

      // 智能继承：仅在【非根容器】（parent !== scene.root）内部且开启 autoInherit 开关时触发。
      // 画布根节点（body）下的直接子元素均为独立的大板块（如 Header, Hero, Main, Section, Footer），绝不自动继承！
      if (st.autoInherit && parent !== scene.root) {
        const siblingWithRel = parent.children.find((c) => {
          const r = (c.attrs?.relSelector ?? '').trim();
          if (!r) return false;
          if (/:(?:first|last|nth)-/.test(r)) return false;
          const match = r.match(/[>\s]+([a-zA-Z0-9_\-*]+)$/);
          return match && (match[1] === type || match[1] === '*');
        });
        if (siblingWithRel) {
          if (!el.attrs) el.attrs = {};
          el.attrs.relSelector = siblingWithRel.attrs!.relSelector;
          el.style = { ...deepClone(siblingWithRel.style) };
        } else {
          // 类名继承检查：若现有同类型直接子元素全部带有相同的非空类名（如所有 div 都是 card）
          const sameTypeSiblings = parent.children.filter((c) => c.type === type && (c.attrs?.className ?? '').trim());
          if (sameTypeSiblings.length > 0 && sameTypeSiblings.length === parent.children.filter((c) => c.type === type).length) {
            const commonCls = sameTypeSiblings[0].attrs!.className!.trim();
            if (sameTypeSiblings.every((c) => c.attrs!.className!.trim() === commonCls)) {
              if (!el.attrs) el.attrs = {};
              el.attrs.className = commonCls;
              el.style = { ...deepClone(sameTypeSiblings[0].style) };
            }
          }
        }
      }

      parent.children.push(el);
      revealHost(scene.root, parent);
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
      revealHost(scene.root, parent);
      scene.selectedId = el.id;
      scene.selectedIds = [el.id];
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  removeElement: (id) => {
    // v0.4.6：退场动画。节点马上要从 DOM 消失，先留一个按原位钉住的影子淡出
    // （纯视觉，不碰状态；见 lib/elLeave.ts）。
    flyOutElement(id);
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
    // 同上：每个被点名的元素各留一个影子（后代跟着父级一起消失，不必单独播）
    for (const id of ids) flyOutElement(id);
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
      revealHost(scene.root, parent);
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  // 粘贴（新逻辑）：优先插入到当前选中元素的内部；若选中的是自闭合/文本独占元素（无法容纳子级），降级插入到其父容器；若无选中则插到画布根末尾
  paste: (selectedId = null) => {
    set((st) => {
      if (!st.clipboard) return st;
      const scene = deepClone(st.scene);
      let target: SceneElement;
      if (!selectedId || selectedId === st.scene.root.id) {
        target = scene.root;
      } else {
        const selNode = findNode(scene.root, selectedId);
        target = selNode ?? scene.root;
      }
      // 降级保护：自闭合或文本独占元素无法拥有子元素，自动退回其父级容器
      while (target !== scene.root && (SELF_CLOSING_TAGS.has(target.type) || TEXT_ONLY_TAGS.has(target.type))) {
        target = findParent(scene.root, target.id) ?? scene.root;
      }
      appendPasted(scene, target, st.clipboard);
      revealHost(scene.root, target);
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  // 兼容别名
  pasteSibling: (refId) => {
    useScene.getState().paste(refId);
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
  updateStyle: (id, partial, breakpointOverride) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      /**
       * v0.4.5 第十六批（用户反馈）：「为什么 left right top bottom 甚至能达到负数，不对。」
       *
       * 绝对 / 固定定位的元素是"相对包含块排位置"的：偏移出现负数就意味着它跑到容器外面
       * —— 在设计工具里这几乎总是误操作（拖过头、粘贴来的脏数据），而且会让元素"消失"，
       * 用户完全找不到它去哪了。
       *
       * 所以这里统一钳到 >= 0。注意**只钳这两种定位**：
       *   · relative / sticky 的偏移是"相对自身原位的位移"，负数完全合法（往上/往左挪）；
       *   · margin 允许负数（负外边距是常见技巧）。
       */
      const posAfter = (partial as Record<string, string | undefined>).position
        ?? (node.style as Record<string, string | undefined>).position
        ?? 'static';
      const clampOffsets = posAfter === 'absolute' || posAfter === 'fixed';
      const OFFSET_KEYS = new Set(['left', 'right', 'top', 'bottom']);
      const clamped: Record<string, string | undefined> = { ...(partial as Record<string, string | undefined>) };
      if (clampOffsets) {
        for (const k of Object.keys(clamped)) {
          if (!OFFSET_KEYS.has(k)) continue;
          const v = clamped[k];
          if (v === undefined || v === '' || v === 'auto') continue;
          const n = parseFloat(v);
          // 只管纯 px 数值（calc()/百分比/var() 原样放过）
          if (Number.isFinite(n) && /^-?\d*\.?\d+(px)?$/.test(String(v).trim()) && n < 0) {
            clamped[k] = '0' + (String(v).trim().endsWith('px') ? 'px' : '');
          }
        }
      }
      // 先消解祖先 childStyles 的压制 —— 否则模板子元素"改了没反应"（特异性被盖住）
      stripAncestorChildStyles(scene.root, node, Object.keys(partial).filter((k) => k !== 'src' && k !== 'alt'));
      const bp = breakpointOverride ?? st.activeBreakpoint;
      if (bp === 'desktop') {
        for (const [k, v] of Object.entries(clamped)) {
          if (v === undefined) {
            delete (node.style as Record<string, string | undefined>)[k];
          } else {
            node.style[k] = v;
          }
        }
      } else {
        if (!node.responsive) node.responsive = {};
        if (!node.responsive[bp]) node.responsive[bp] = {};
        const curBpStyle = node.responsive[bp]!;
        for (const [k, v] of Object.entries(clamped)) {
          if (v === undefined || v === '') {
            delete (curBpStyle as Record<string, string | undefined>)[k];
          } else {
            (curBpStyle as Record<string, string | undefined>)[k] = v;
          }
        }
        if (Object.keys(curBpStyle).length === 0) {
          delete node.responsive[bp];
          if (Object.keys(node.responsive).length === 0) node.responsive = undefined;
        }
      }
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
  updateStyleTransient: (id, partial, breakpointOverride) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      stripAncestorChildStyles(scene.root, node, Object.keys(partial).filter((k) => k !== 'src' && k !== 'alt'));
      const bp = breakpointOverride ?? st.activeBreakpoint;
      if (bp === 'desktop') {
        for (const [k, v] of Object.entries(partial)) {
          if (v === undefined) {
            delete (node.style as Record<string, string | undefined>)[k];
          } else {
            node.style[k] = v;
          }
        }
      } else {
        if (!node.responsive) node.responsive = {};
        if (!node.responsive[bp]) node.responsive[bp] = {};
        const curBpStyle = node.responsive[bp]!;
        for (const [k, v] of Object.entries(partial)) {
          if (v === undefined || v === '') {
            delete (curBpStyle as Record<string, string | undefined>)[k];
          } else {
            (curBpStyle as Record<string, string | undefined>)[k] = v;
          }
        }
        if (Object.keys(curBpStyle).length === 0) {
          delete node.responsive[bp];
          if (Object.keys(node.responsive).length === 0) node.responsive = undefined;
        }
      }
      syncClassmates(scene.root, node);
      return { scene }; // 不动 history
    });
  },

  clearBreakpointOverride: (id, propKey, breakpoint) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node || !node.responsive) return st;
      const bp = breakpoint ?? st.activeBreakpoint;
      if (bp === 'desktop') return st;
      if (!node.responsive[bp]) return st;

      if (propKey) {
        delete (node.responsive[bp] as Record<string, string | undefined>)[propKey];
        if (Object.keys(node.responsive[bp]!).length === 0) {
          delete node.responsive[bp];
        }
      } else {
        delete node.responsive[bp];
      }
      if (Object.keys(node.responsive).length === 0) {
        node.responsive = undefined;
      }
      syncClassmates(scene.root, node);
      const push = !st.styleEditPending;
      return { scene, history: push ? pushPast(st.history, st.scene) : st.history };
    });
  },

  // 类名/ID 管理（「类名」页签）：把名称下所有元素的样式统一（写回同一份样式，一条 undo）
  // kind='class' 按 className 的单个 token 包含匹配；kind='id' 只精确匹配 attrs.id
  unifyClassName: (name, style, kind = 'class') => {
    set((st) => {
      const scene = deepClone(st.scene);
      const trimmed = name.trim();
      if (!trimmed) return st;
      const ids: string[] = [];
      const walk = (n: SceneElement): void => {
        if (kind === 'class') {
          const cls = (n.attrs?.className ?? '').trim();
          if (cls.split(/\s+/).includes(trimmed)) ids.push(n.id);
        } else {
          const idv = (n.attrs?.id ?? '').trim();
          if (idv === trimmed) ids.push(n.id);
        }
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

  // 批量重命名类名 token：className 里逐 token 替换（一条 undo）
  renameClassToken: (oldName, newName) => {
    set((st) => {
      const from = oldName.trim();
      const to = newName.trim();
      if (!from || !to || from === to) return st;
      const scene = deepClone(st.scene);
      let changed = false;
      const walk = (n: SceneElement): void => {
        const cls = (n.attrs?.className ?? '').trim();
        if (cls) {
          const tokens = cls.split(/\s+/);
          if (tokens.includes(from)) {
            const next = tokens.map((t) => (t === from ? to : t)).join(' ');
            if (!n.attrs) n.attrs = {};
            n.attrs.className = next;
            changed = true;
          }
        }
        for (const c of n.children) walk(c);
      };
      walk(scene.root);
      if (!changed) return st;
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  // 批量移除类名 token：从所有元素的 className 中删掉它（一条 undo；class 清空即删除属性）
  removeClassToken: (name) => {
    set((st) => {
      const target = name.trim();
      if (!target) return st;
      const scene = deepClone(st.scene);
      let changed = false;
      const walk = (n: SceneElement): void => {
        const cls = (n.attrs?.className ?? '').trim();
        if (cls && cls.split(/\s+/).includes(target)) {
          const next = cls.split(/\s+/).filter((t) => t !== target).join(' ');
          if (!n.attrs) n.attrs = {};
          if (next) {
            n.attrs.className = next;
          } else {
            delete n.attrs.className;
          }
          changed = true;
        }
        for (const c of n.children) walk(c);
      };
      walk(scene.root);
      if (!changed) return st;
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
  // className 特殊协调（类名 = 一套衣服）：
  //  - 加入一个已存在的类名 → 立刻穿上该组的样式（数据与显示同时变，不留幽灵冲突）
  //  - 移除后不再有任何类名 → 把当前生效的组样式物化到元素自己（外观不变地"脱下来"）
  // 富文本片段样式（v0.4.4d）：把文字里 [start, end) 这一段单独套样式。
  // 做法：把整段文字归一化成 runs（无则整段一个 run）→ 在 start/end 处切开 → 给覆盖到的 run 打补丁。
  // 导出成 `<span style="…">…</span>`（内联，不用选择器），画布与导出同源。
  applyTextRunStyle: (id, start, end, patch) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      const full = node.text ?? '';
      const a = Math.max(0, Math.min(start, full.length));
      const b = Math.max(a, Math.min(end, full.length));
      if (a >= b) return st;

      // 1. 归一化成 runs（保证拼接 == full，否则退回整段一个 run）
      let runs: { text: string; style?: ElementStyle }[] =
        node.runs && node.runs.length
          ? node.runs.map((r) => ({ text: r.text, style: r.style ? { ...r.style } : undefined }))
          : [{ text: full }];
      if (runs.map((r) => r.text).join('') !== full) runs = [{ text: full }];

      // 2. 在 at 处切开（保持每段样式不变）
      const splitAt = (rs: typeof runs, at: number) => {
        if (at <= 0) return rs;
        const out: typeof runs = [];
        let pos = 0;
        for (const r of rs) {
          const len = r.text.length;
          if (at > pos && at < pos + len) {
            out.push({ text: r.text.slice(0, at - pos), style: r.style ? { ...r.style } : undefined });
            out.push({ text: r.text.slice(at - pos), style: r.style ? { ...r.style } : undefined });
          } else {
            out.push(r);
          }
          pos += len;
        }
        return out;
      };
      runs = splitAt(runs, a);
      runs = splitAt(runs, b);

      // 3. 给落在 [a,b) 内的 run 打补丁
      let pos = 0;
      for (const r of runs) {
        const rs = pos;
        const re = pos + r.text.length;
        pos = re;
        if (rs >= a && re <= b && re > rs) {
          const next: Record<string, string | undefined> = { ...(r.style ?? {}) };
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '') delete next[k];
            else next[k] = v;
          }
          r.style = Object.keys(next).length ? (next as ElementStyle) : undefined;
        }
      }

      // 4. 落库：没有样式的 run 去掉 style 字段，保持数据干净
      node.runs = runs.map((r) => (r.style && Object.keys(r.style).length ? r : { text: r.text }));
      node.text = runs.map((r) => r.text).join('');
      const push = !st.styleEditPending;
      return { scene, history: push ? pushPast(st.history, st.scene) : st.history };
    });
  },

  updateAttr: (id, key, value) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      if (!node.attrs) node.attrs = {};

      if (key === 'relSelector') {
        const val = value.trim();
        if (val === '') {
          delete node.attrs.relSelector;
        } else {
          node.attrs.relSelector = val;
          // 查找是否有其他同名关系选择器的元素，若有则同步继承其样式
          const existing = findFirstWithRel(scene.root, val, id);
          if (existing) {
            node.style = { ...deepClone(existing.style) };
          }
        }
        const push = !st.styleEditPending;
        return { scene, history: push ? pushPast(st.history, st.scene) : st.history };
      }

      if (key !== 'className') {
        if (value === '') delete node.attrs[key];
        else node.attrs[key] = value;
        const push = !st.styleEditPending;
        return { scene, history: push ? pushPast(st.history, st.scene) : st.history };
      }

      const oldTokens = (node.attrs?.className ?? '').trim().split(/\s+/).filter(Boolean);
      const newTokens = value.trim().split(/\s+/).filter(Boolean);
      const added = newTokens.filter((t) => !oldTokens.includes(t));

      // 先收集（匹配靠 attrs，须在改 attrs 之前）：每个新增 token 的"组内第一个他人成员"
      const groupStyle: ElementStyle | null = (() => {
        for (const t of added) {
          const first = findFirstWithToken(scene.root, t, id);
          if (first) return deepClone(first.style);
        }
        return null;
      })();
      // 移除后变裸元素 → 物化旧组第一个成员的样式（自己是唯一成员则保持原样）
      const materialize: ElementStyle | null =
        oldTokens.length > 0 && newTokens.length === 0
          ? (() => {
              const first = findFirstWithToken(scene.root, oldTokens[0], id);
              return first ? deepClone(first.style) : null;
            })()
          : null;

      if (newTokens.length === 0) delete node.attrs.className;
      else node.attrs.className = newTokens.join(' ');

      if (groupStyle) node.style = { ...deepClone(groupStyle) };
      else if (materialize) node.style = { ...materialize };

      const push = !st.styleEditPending;
      return { scene, history: push ? pushPast(st.history, st.scene) : st.history };
    });
  },

  // 子元素样式（关系选择器）：整体替换列表（Inspector 编辑后 blur 提交；会话内不入栈多次）
  setChildStyles: (id, list) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      const cleaned = list
        .map((c) => ({ sel: (c.sel ?? '').trim(), css: (c.css ?? '').trim() }))
        .filter((c) => c.sel !== '');
      if (cleaned.length === 0) delete node.childStyles;
      else node.childStyles = cleaned;
      const push = !st.styleEditPending;
      return { scene, history: push ? pushPast(st.history, st.scene) : st.history };
    });
  },

  // 设置单元素的关系选择器（如 .hero > h1）；applyToSiblings 为 true 时自动同步给容器内同标签的所有直接子元素
  setRelSelector: (id, selector, applyToSiblings = false) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      if (!node.attrs) node.attrs = {};

      const sel = (selector ?? '').trim();
      if (!sel) {
        delete node.attrs.relSelector;
      } else {
        node.attrs.relSelector = sel;
        // 如果同名关系选择器在别处已有样式，继承之
        const existing = findFirstWithRel(scene.root, sel, id);
        if (existing) {
          node.style = { ...deepClone(existing.style) };
        }
        const parent = findParent(scene.root, id);
        if (applyToSiblings && parent) {
          // 提取选择器目标标签类型（例如 .hero > p -> p，.cards > * -> *）
          const match = sel.match(/[>\s]+([a-zA-Z0-9_\-*]+)(?::[a-zA-Z0-9_\-]+)?$/);
          const targetTag = match ? match[1] : node.type;
          for (const c of parent.children) {
            if (c.id !== id && (c.type === targetTag || targetTag === '*')) {
              if (!c.attrs) c.attrs = {};
              c.attrs.relSelector = sel;
              c.style = { ...deepClone(node.style) };
            }
          }
        }
      }
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  // 多选元素批量设置关系选择器
  setMultiRelSelector: (ids, selector) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const sel = (selector ?? '').trim();
      let firstStyle: ElementStyle | null = null;
      for (const id of ids) {
        const node = findNode(scene.root, id);
        if (!node) continue;
        if (!firstStyle) firstStyle = deepClone(node.style);
        if (!node.attrs) node.attrs = {};
        if (!sel) {
          delete node.attrs.relSelector;
        } else {
          node.attrs.relSelector = sel;
          if (firstStyle) node.style = { ...deepClone(firstStyle) };
        }
      }
      return { scene, history: pushPast(st.history, st.scene) };
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

  // 设计变量（v0.4.0）：整份替换。调用方（变量面板）负责保证列表完整，
  // 这里只管写回并入栈 —— 因此一次「加 / 删 / 改名」在撤销栈里都是一步。
  setTokens: (tokens) => {
    set((st) => {
      // 与 setQuickCss 一致：若调用方已用 beginStyleEdit 开了一次会话，就不重复压栈，
      // 这样「变量改名 + 连带改所有引用」在撤销栈里仍然只有一步。
      const push = !st.styleEditPending;
      return {
        scene: { ...st.scene, tokens },
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
      syncClassmates(scene.root, node);
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  removeVisibleProp: (id, key) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      // 删属性时也要消解祖先 childStyles（否则容器规则会继续把值"补"回来，看起来删不掉）
      const delKeys = (() => {
        const item = SCHEMA_LOOKUP.get(key);
        if (item) {
          return (item.input === 'box4' || item.input === 'trbl') && item.sides
            ? item.sides.map((s) => s.key)
            : [item.key];
        }
        return [key];
      })();
      stripAncestorChildStyles(scene.root, node, delKeys);
      // 移出列表
      if (node.visibleProps) {
        node.visibleProps = node.visibleProps.filter((k) => k !== key);
        if (node.visibleProps.length === 0) node.visibleProps = undefined;
      }
      // 彻底删除对应 style 字段（含 4 边拆分）
      const item = SCHEMA_LOOKUP.get(key);
      if (item) {
        const keys = (item.input === 'box4' || item.input === 'trbl') && item.sides
          ? item.sides.map((s) => s.key)
          : [item.key];
        for (const k of keys) {
          delete (node.style as Record<string, string | undefined>)[k];
        }
      } else {
        delete (node.style as Record<string, string | undefined>)[key];
      }
      // 关键：全量同步给所有同类名、同关系选择器的元素，防止样式不一致导致类名ID冲突！
      syncClassmates(scene.root, node);
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  updatePseudoStyle: (id, pseudo, patch) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      if (!node.pseudoStyles) node.pseudoStyles = {};
      const current = node.pseudoStyles[pseudo] ?? {};
      const next = { ...current };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) {
          delete next[k];
        } else {
          next[k] = v;
        }
      }
      if (Object.keys(next).length === 0) {
        delete node.pseudoStyles[pseudo];
        if (Object.keys(node.pseudoStyles).length === 0) node.pseudoStyles = undefined;
      } else {
        node.pseudoStyles[pseudo] = next;
      }
      syncClassmates(scene.root, node);
      const push = !st.styleEditPending;
      return { scene, history: push ? pushPast(st.history, st.scene) : st.history };
    });
  },

  removePseudoStyle: (id, pseudo, key) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node || !node.pseudoStyles) return st;
      if (!key) {
        // 清空整个伪类状态
        delete node.pseudoStyles[pseudo];
        if (Object.keys(node.pseudoStyles).length === 0) node.pseudoStyles = undefined;
      } else {
        // 清除单个属性
        if (node.pseudoStyles[pseudo]) {
          delete node.pseudoStyles[pseudo][key];
          if (Object.keys(node.pseudoStyles[pseudo]).length === 0) {
            delete node.pseudoStyles[pseudo];
            if (Object.keys(node.pseudoStyles).length === 0) node.pseudoStyles = undefined;
          }
        }
      }
      syncClassmates(scene.root, node);
      const push = !st.styleEditPending;
      return { scene, history: push ? pushPast(st.history, st.scene) : st.history };
    });
  },

  setText: (id, text) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      node.text = text;
      // 有富文本片段时：文本改了就无法保证片段仍然对齐 → 尽量保留，保不住就整段退回纯文本
      if (node.runs && node.runs.length) {
        if (node.runs.map((r) => r.text).join('') !== text) node.runs = undefined;
      }
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  renameElement: (_id, _name) => {
    // 阶段1：暂未实现自定义命名，UI 仅展示 type
  },

  setNodeAttr: (id, key, value) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      const attrs = { ...(node.attrs ?? {}) };
      if (value === undefined || value === '') delete attrs[key];
      else attrs[key] = value;
      node.attrs = Object.keys(attrs).length > 0 ? attrs : undefined;
      return { scene, history: pushPast(st.history, st.scene) };
    });
  },

  replaceSubtree: (id, next) => {
    set((st) => {
      const scene = deepClone(st.scene);
      if (id === scene.root.id) {
        // 根节点：保留原 id，只换内容
        scene.root = { ...next, id: scene.root.id };
        return { scene, history: pushPast(st.history, st.scene) };
      }
      const parent = findParent(scene.root, id);
      if (!parent) return st;
      const idx = indexOfChild(parent, id);
      if (idx < 0) return st;
      parent.children[idx] = next;
      return { scene, history: pushPast(st.history, st.scene) };
    });
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

  // v0.4.3 表格：这张表是否参与「导出前体检」（一条 undo；缺省 = 不参与）
  setHealthCheck: (id, on) => {
    set((st) => {
      const scene = deepClone(st.scene);
      const node = findNode(scene.root, id);
      if (!node) return st;
      // v0.4.3 起"参与体检"是默认值，所以关掉时必须**显式写 false**：
      // 删标记等于回到默认的"参与"，开关会立刻弹回去，看起来像点不动。
      node.healthCheck = on;
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

  // 撤销栈属于当前文档：切换 / 打开 / 新建标签一律清空（沿用上一个标签的历史会导致
  // 切标签后 Ctrl+Z 把别的标签的内容恢复进来，也会让"这个空画布有没有历史"判断失真）。
  setScene: (s) => set(() => ({ scene: s, history: { past: [], future: [] }, styleEditPending: false })),

  // 面板板块开合记忆（v0.4.4）：写入 scene.uiState，随工程文件 / 会话草稿一起保存。
  // 刻意**不走 beginStyleEdit/pushPast**：折叠个面板不该产生撤销记录，也不该让工程
  // 挂上"未保存"圆点（subscribe 的脏判断只看 root/globalCss/quickCss/撤销栈，不会误伤）。
  // 页面「全局样式」：任意 CSS 属性（并进 body 规则）。与 setQuickCss 同一套会话语义：
  // focus/blur 之间用 beginStyleEdit/endStyleEdit 收束，一条撤销。
  setBodyExtra: (patch) => {
    set((st) => {
      const push = !st.styleEditPending;
      const next: Record<string, string> = { ...(st.scene.bodyExtra ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        // v0.4.4 修：**空串要保留** —— 「添加属性」先写入空值再等用户填，
        // 以前这里把空串当成删除，导致点了添加按钮什么也不出现（全局样式加不了属性）。
        // 导出时会跳过空值，所以保留空键不会污染 CSS。
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      return {
        scene: { ...st.scene, bodyExtra: next },
        history: push ? pushPast(st.history, st.scene) : st.history
      };
    });
  },

  // 基准视口高度（v0.4.6 / R6-16）：
  //  · 画布最小高度 = 它（短页面也能看见整屏，fixed: bottom:0 有落点）；
  //  · fixed 元素的拖动墙止步于这条线（"首屏线"）。
  // 走撤销栈：用户改了它也算一次可回退的编辑。
  setViewportHeight: (px) => {
    set((st) => {
      const next = Math.max(320, Math.min(4000, Math.round(px)));
      if ((st.scene.viewportHeight ?? 900) === next) return st;
      const push = !st.styleEditPending;
      return {
        scene: { ...st.scene, viewportHeight: next },
        history: push ? pushPast(st.history, st.scene) : st.history
      };
    });
  },

  setPageSec: (patch) => set((st) => ({
    scene: {
      ...st.scene,
      uiState: {
        ...(st.scene.uiState || {}),
        pageSec: { ...(st.scene.uiState?.pageSec || {}), ...patch }
      }
    }
  })),

  setTokenGroupOpen: (group, open) => set((st) => ({
    scene: {
      ...st.scene,
      uiState: {
        ...(st.scene.uiState || {}),
        tokenGroups: { ...(st.scene.uiState?.tokenGroups || {}), [group]: open }
      }
    }
  })),

  setInspectorSec: (key, val) => set((st) => ({
    scene: {
      ...st.scene,
      uiState: {
        ...(st.scene.uiState || {}),
        inspectorSec: { ...(st.scene.uiState?.inspectorSec || {}), [key]: val }
      }
    }
  }))
}));

// re-export for components
export { CONTAINER_TAGS, SELF_CLOSING_TAGS };

if (typeof window !== 'undefined') {
  (window as any).__sceneStore = useScene;

  // 自动与多标签页 (TabStore) 联动：
  // 严格区分：只有真正的 DOM 树内容/样式/属性/全局设置修改才标记未保存 dirty（点亮小圆点 •）；
  // 纯选区变化 (selectedId/selectedIds) 只同步状态，绝不误触小圆点！
  let lastSceneRef = useScene.getState().scene;
  let lastPastLen = useScene.getState().history.past.length;
  // 防抖标记：subscribe 回调可能在同一次 setState 批次中被多次触发，用本标记去重
  let dirtyFlagScheduled = false;

  useScene.subscribe((state) => {
    if (state.scene === lastSceneRef) return;
    if (dirtyFlagScheduled) return;
    dirtyFlagScheduled = true;
    requestAnimationFrame(() => { dirtyFlagScheduled = false; });

    const prev = lastSceneRef;
    lastSceneRef = state.scene;

    // 判断是否发生了实质内容修改：
    //  - root 树对象引用变了（增删改元素 / 样式变更）
    //  - 全局 CSS / 快速设置变了
    //  - 撤销历史有新条目入栈（表明用户执行了不可逆操作）
    const curPastLen = state.history.past.length;
    const isContentModified =
      prev.root !== state.scene.root ||
      prev.globalCss !== state.scene.globalCss ||
      prev.quickCss !== state.scene.quickCss ||
      prev.bodyExtra !== state.scene.bodyExtra ||
      prev.viewportHeight !== state.scene.viewportHeight ||
      curPastLen > lastPastLen;

    lastPastLen = curPastLen;

    const ts = (window as any).__tabStore;
    if (ts && typeof ts.getState === 'function' && !ts.__isSwitchingTab) {
      ts.getState().onSceneChange(state.scene, isContentModified);
    }
  });
}
