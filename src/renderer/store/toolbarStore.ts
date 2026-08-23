import { create } from 'zustand';

// BlockCanvas · 工具栏动态管理器（托盘式）
// 布局遵循「像 Windows 开始键左侧的固定区 + 右下角托盘」思路：
//  - 左侧固定组：核心操作（复制…导出 HTML），在 Toolbar 里硬编码，不可改、不参与托盘。
//  - 中间动态区 + 托盘「⋯」：其余按钮（导出元素模板、取消选中、插件命令）按需显隐。
//    显隐与排序全部靠鼠标拖拽：拖出托盘到工具栏=显示，拖回托盘=隐藏，拖拽互调=排序。
//    固定按钮不再出现在托盘管理面板里（那部分已删）。
// 记忆：每个动态按钮的「显示/隐藏」与「顺序」都持久化到 localStorage。

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
  /** 附加 class（btn-primary / btn-ghost / toolbar-del / tb-danger 等） */
  cls?: string;
  /** 默认插入位（值越小越靠前；用户拖拽排序后以 order 为准） */
  order: number;
  /** 是否默认显示在工具栏；默认 false = 藏进托盘（插件命令默认藏） */
  defaultVisible?: boolean;
  /** 块级组件（画布宽度 / 缩放 / 类名ID）：渲染由 Toolbar 的 widgetMap 按 id 提供，本项只占排序/显隐位 */
  block?: boolean;
}

interface ToolbarState {
  items: ToolbarItem[];
  /** 显示在工具栏（vs 藏在托盘）；默认来自 defaultVisible，用户可改 */
  visible: Record<string, boolean>;
  /** 用户自定义的排序（id 序列）；未列出的按 order 兜底 */
  order: string[];

  addItem: (it: ToolbarItem) => void;
  removeItem: (id: string) => void;
  setVisible: (id: string, on: boolean) => void;
  setOrder: (ids: string[]) => void;
}

const LS_VISIBLE = 'bc-toolbar-visible';
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

export const useToolbar = create<ToolbarState>((set) => ({
  items: [],
  visible: load<Record<string, boolean>>(LS_VISIBLE, {}),
  order: load<string[]>(LS_ORDER, []),

  addItem: (it) =>
    set((st) => {
      const idx = st.items.findIndex((x) => x.id === it.id);
      if (idx >= 0) {
        // 已存在：用新项替换（插件常借此刷新文案/动作），位置保留
        const items = [...st.items];
        items[idx] = { ...items[idx], ...it };
        return { items };
      }
      return { items: [...st.items, it] };
    }),

  removeItem: (id) =>
    set((st) => ({
      items: st.items.filter((x) => x.id !== id),
      visible: Object.fromEntries(Object.entries(st.visible).filter(([k]) => k !== id)),
      order: st.order.filter((x) => x !== id)
    })),

  setVisible: (id, on) =>
    set((st) => {
      const visible = { ...st.visible, [id]: on };
      save(LS_VISIBLE, visible);
      return { visible };
    }),

  setOrder: (ids) =>
    set((st) => {
      // 只保留仍存在的 id，防止删除后残留
      const clean = ids.filter((id) => st.items.some((x) => x.id === id));
      save(LS_ORDER, clean);
      return { order: clean };
    })
}));

// 某按钮此刻是否「显示在工具栏」
export function isVisibleOnBar(it: ToolbarItem, visible: Record<string, boolean>): boolean {
  return visible[it.id] ?? !!it.defaultVisible;
}

// 把 items 按「用户排序优先，其余按 order/id」排成展示序列
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