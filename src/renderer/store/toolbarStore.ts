import { create } from 'zustand';

// BlockCanvas · 工具栏动态管理器（v0.4.2 全按钮自由池 + 二级工具组）
//
// 所有按钮（含编辑操作、设备切换、缩放、体检、设置、插件命令）全部注册进本 store：
//   · 每个按钮有「停靠区」dock：main = 主区（可滚动）/ right = 右侧固定区 / more = 收进「⋯更多」
//   · 顺序全局共享一份（拖拽排序跨区有效），显隐由 dock 派生（more = 隐藏）
//   · v0.4.2 新增「二级工具组」groups：若干按钮可打包成一个组按钮，
//     鼠标浮在组按钮上即展开组内工具（不再让工具栏横向堆满）。
//     —— 组内成员的最终停靠以「组」的 dock 为准（组移到右侧，成员一起走）。
//   · 显隐、顺序、停靠、工具组全部持久化到 localStorage；「恢复默认」一键清空
//
// 兼容：老版本只有 visible 开关（bc-toolbar-visible）。首次读到 docks 缺失时，
// 用 visible 推导初始停靠：false → more，true → 按钮的默认停靠。

export type ToolbarDock = 'main' | 'right' | 'more';
/** 工具组停靠区只允许放在可见区（主区 / 右侧），不能放进「更多」 */
export type ToolbarGroupDock = 'main' | 'right';

export interface ToolbarItem {
  /** 稳定 id（跨会话记忆），插件 id 统一加 "plg." 前缀避免重名 */
  id: string;
  /** 按钮文字：静态字符串或动态函数（插件可借此刷新文案）。块级项做托盘展示名用 */
  label?: string | (() => string);
  /** 前导图标（emoji / 短字符） */
  icon?: string;
  /** 悬浮提示 */
  title?: string;
  onClick?: () => void;
  /** 动态禁用（返回 true 禁用） */
  disabled?: () => boolean;
  /** 附加 class（btn-primary / tb-btn-ghost / toolbar-del 等） */
  cls?: string;
  /** 默认插入位（值越小越靠前；用户拖拽排序后以 order 为准） */
  order: number;
  /** 默认停靠区（未记忆时用它；默认 main） */
  defaultDock?: ToolbarDock;
  /** 兼容旧字段：默认是否显示（false = 默认收进更多）。新代码请用 defaultDock */
  defaultVisible?: boolean;
  /** 块级组件（设备切换 / 缩放 / 体检）：渲染由 Toolbar 的 widgetMap 按 id 提供，本项只占排序/停靠位 */
  block?: boolean;
}

/** 二级工具组：把若干按钮折叠成一个「组按钮」，鼠标悬浮展开里面的工具 */
export interface ToolbarGroup {
  /** 稳定 id（跨会话记忆），形如 "grp.xxx" */
  id: string;
  /** 组按钮显示名（悬浮面板顶部作为组标题） */
  label: string;
  /** 组按钮前导图标 */
  icon?: string;
  /** 组内成员（成员仍各自保留 order，用于组内排序） */
  itemIds: string[];
  /** 组停靠区：主区 / 右侧 */
  dock: ToolbarGroupDock;
  order: number;
}

interface ToolbarState {
  items: ToolbarItem[];
  /** 停靠记忆：id → main | right | more（more = 收进更多 = 不直接显示） */
  docks: Record<string, ToolbarDock>;
  /** 用户自定义的排序（id 序列）；未列出的按 order 兜底 */
  order: string[];
  /** 二级工具组（v0.4.2） */
  groups: ToolbarGroup[];

  addItem: (it: ToolbarItem) => void;
  removeItem: (id: string) => void;
  setDock: (id: string, dock: ToolbarDock) => void;
  setOrder: (ids: string[]) => void;
  reset: () => void;

  // —— 工具组 ——
  addGroup: (label: string, dock: ToolbarGroupDock, itemIds?: string[]) => string;
  removeGroup: (id: string) => void;
  renameGroup: (id: string, label: string) => void;
  setGroupDock: (id: string, dock: ToolbarGroupDock) => void;
  /** 把按钮加入某组（自动从原组移出，保证一个按钮只属于一个组） */
  addToGroup: (groupId: string, itemId: string) => void;
  /** 把按钮移出其所在组（回到自身 dock 决定的位置） */
  removeFromGroup: (itemId: string) => void;
  /** 重置某组成员（拖拽排序 / 批量整理用） */
  setGroupMembers: (groupId: string, itemIds: string[]) => void;
}

const LS_DOCK = 'bc-toolbar-dock';
const LS_VISIBLE = 'bc-toolbar-visible'; // 旧版显隐（只读迁移用）
const LS_ORDER = 'bc-toolbar-order';
const LS_GROUPS = 'bc-toolbar-groups';

/** 出厂默认工具组（首次运行 / 「恢复默认布局」时使用） */
export const DEFAULT_GROUPS: ToolbarGroup[] = [
  {
    id: 'grp.clipboard',
    label: '剪贴板',
    icon: '✂️',
    itemIds: ['copy', 'cut', 'paste'],
    dock: 'main',
    order: 10
  },
  {
    id: 'grp.device',
    label: '设备',
    icon: '📱',
    itemIds: ['blk.device'],
    dock: 'right',
    order: 59
  }
];

function load<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 静默 */ }
}

/** 从旧版 visible 记忆推导初始停靠（只在 docks 尚无记忆时用一次） */
function migrateDocks(items: ToolbarItem[]): Record<string, ToolbarDock> {
  const saved = load<Record<string, ToolbarDock> | null>(LS_DOCK, null);
  if (saved) return saved;
  const legacy = load<Record<string, boolean>>(LS_VISIBLE, {});
  const out: Record<string, ToolbarDock> = {};
  for (const it of items) {
    const v = legacy[it.id];
    if (v === false) out[it.id] = 'more';
    else if (v === true) out[it.id] = it.defaultDock ?? 'main';
  }
  return out;
}

let groupSeq = 0;
function newGroupId(): string {
  groupSeq += 1;
  return 'grp.' + Date.now().toString(36) + '.' + groupSeq;
}

export const useToolbar = create<ToolbarState>((set) => ({
  items: [],
  docks: {},
  order: load<string[]>(LS_ORDER, []),
  groups: load<ToolbarGroup[] | null>(LS_GROUPS, null) ?? DEFAULT_GROUPS,

  addItem: (it) =>
    set((st) => {
      const idx = st.items.findIndex((x) => x.id === it.id);
      let items: ToolbarItem[];
      if (idx >= 0) {
        // 已存在：用新项替换（插件常借此刷新文案/动作），位置与停靠保留
        items = [...st.items];
        items[idx] = { ...items[idx], ...it };
      } else {
        items = [...st.items, it];
      }
      // 首批按钮注册完成后做一次旧显隐迁移（只在没有任何停靠记忆时）
      const docks = Object.keys(st.docks).length > 0 ? st.docks : migrateDocks(items);
      return { items, docks };
    }),

  removeItem: (id) =>
    set((st) => ({
      items: st.items.filter((x) => x.id !== id),
      docks: Object.fromEntries(Object.entries(st.docks).filter(([k]) => k !== id)),
      order: st.order.filter((x) => x !== id),
      groups: st.groups.map((g) => ({ ...g, itemIds: g.itemIds.filter((x) => x !== id) }))
    })),

  setDock: (id, dock) =>
    set((st) => {
      const docks = { ...st.docks, [id]: dock };
      save(LS_DOCK, docks);
      return { docks };
    }),

  setOrder: (ids) =>
    set((st) => {
      // 只保留仍存在的 id，防止删除后残留
      const clean = ids.filter((id) => st.items.some((x) => x.id === id));
      save(LS_ORDER, clean);
      return { order: clean };
    }),

  reset: () =>
    set(() => {
      try {
        localStorage.removeItem(LS_DOCK);
        localStorage.removeItem(LS_VISIBLE);
        localStorage.removeItem(LS_ORDER);
        localStorage.removeItem(LS_GROUPS);
      } catch {}
      return { docks: {}, order: [], groups: DEFAULT_GROUPS };
    }),

  // —————————————— 工具组 ——————————————
  addGroup: (label, dock, itemIds = []) => {
    const id = newGroupId();
    set((st) => {
      const groups = [...st.groups, { id, label, dock, itemIds, order: 50 }];
      save(LS_GROUPS, groups);
      return { groups };
    });
    return id;
  },

  removeGroup: (id) =>
    set((st) => {
      const groups = st.groups.filter((g) => g.id !== id);
      save(LS_GROUPS, groups);
      return { groups };
    }),

  renameGroup: (id, label) =>
    set((st) => {
      const groups = st.groups.map((g) => (g.id === id ? { ...g, label } : g));
      save(LS_GROUPS, groups);
      return { groups };
    }),

  setGroupDock: (id, dock) =>
    set((st) => {
      const groups = st.groups.map((g) => (g.id === id ? { ...g, dock } : g));
      save(LS_GROUPS, groups);
      return { groups };
    }),

  addToGroup: (groupId, itemId) =>
    set((st) => {
      const groups = st.groups.map((g) => {
        const without = g.itemIds.filter((x) => x !== itemId);
        if (g.id === groupId) return { ...g, itemIds: [...without, itemId] };
        return { ...g, itemIds: without };
      });
      save(LS_GROUPS, groups);
      return { groups };
    }),

  removeFromGroup: (itemId) =>
    set((st) => {
      const groups = st.groups.map((g) => ({ ...g, itemIds: g.itemIds.filter((x) => x !== itemId) }));
      save(LS_GROUPS, groups);
      return { groups };
    }),

  setGroupMembers: (groupId, itemIds) =>
    set((st) => {
      const groups = st.groups.map((g) => (g.id === groupId ? { ...g, itemIds } : g));
      save(LS_GROUPS, groups);
      return { groups };
    })
}));

/** 某按钮此刻的停靠区（未记忆 → 默认停靠；旧 defaultVisible=false → more） */
export function dockOf(it: ToolbarItem, docks: Record<string, ToolbarDock>): ToolbarDock {
  const d = docks[it.id];
  if (d) return d;
  if (it.defaultVisible === false) return 'more';
  return it.defaultDock ?? 'main';
}

/** 兼容旧调用：是否「直接显示在工具栏」（= 停靠不是 more） */
export function isVisibleOnBar(it: ToolbarItem, docks: Record<string, ToolbarDock>): boolean {
  return dockOf(it, docks) !== 'more';
}

/** 把 items 按「用户排序优先，其余按 order/id」排成展示序列 */
export function getSortedItems(items: ToolbarItem[], order: string[]): ToolbarItem[] {
  const index = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ia = index.has(a.id) ? index.get(a.id)! : Number.POSITIVE_INFINITY;
    const ib = index.has(b.id) ? index.get(b.id)! : Number.POSITIVE_INFINITY;
    if (ia !== ib) return ia - ib;
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
}

/** itemId → 所属工具组 */
export function groupOfItem(itemId: string, groups: ToolbarGroup[]): ToolbarGroup | undefined {
  return groups.find((g) => g.itemIds.includes(itemId));
}

/** 取某组在「已排序 item 序列」中的成员（顺序跟随全局排序） */
export function orderedMembers(g: ToolbarGroup, sorted: ToolbarItem[]): ToolbarItem[] {
  return sorted.filter((it) => g.itemIds.includes(it.id));
}
