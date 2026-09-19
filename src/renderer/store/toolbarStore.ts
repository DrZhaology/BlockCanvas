import { create } from 'zustand';

// BlockCanvas · 工具栏动态管理器（v0.4.3 全按钮自由池）
//
// 所有按钮（含编辑操作、设备切换、缩放、体检、设置、插件命令）全部注册进本 store：
//   · 每个按钮有「停靠区」dock：main = 主区（可滚动）/ right = 右侧固定区 / more = 收进「⋯更多」
//   · 顺序全局共享一份（拖拽排序跨区有效），显隐由 dock 派生（more = 隐藏）
//   · 显隐、顺序、停靠全部持久化到 localStorage；「恢复默认」一键清空
//
// 兼容：老版本只有 visible 开关（bc-toolbar-visible）。首次读到 docks 缺失时，
// 用 visible 推导初始停靠：false → more，true → 按钮的默认停靠。

export type ToolbarDock = 'main' | 'right' | 'more';

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

interface ToolbarState {
  items: ToolbarItem[];
  /** 停靠记忆：id → main | right | more（more = 收进更多 = 不直接显示） */
  docks: Record<string, ToolbarDock>;
  /** 用户自定义的排序（id 序列）；未列出的按 order 兜底 */
  order: string[];

  addItem: (it: ToolbarItem) => void;
  removeItem: (id: string) => void;
  setDock: (id: string, dock: ToolbarDock) => void;
  setOrder: (ids: string[]) => void;
  reset: () => void;
}

const LS_DOCK = 'bc-toolbar-dock';
const LS_VISIBLE = 'bc-toolbar-visible'; // 旧版显隐（只读迁移用）
const LS_ORDER = 'bc-toolbar-order';

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

export const useToolbar = create<ToolbarState>((set) => ({
  items: [],
  docks: {},
  order: load<string[]>(LS_ORDER, []),

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
      order: st.order.filter((x) => x !== id)
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
      } catch {}
      return { docks: {}, order: [] };
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
