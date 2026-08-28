import { create } from 'zustand';
import type { SceneGraph } from '@lib/types';
import { useScene } from './sceneStore';

// BlockCanvas · Windows Notepad 风格多工程标签页状态机 (TabStore)
// - 管理多个同时打开的网页工程标签
// - 自动记录未保存修改状态 (isDirty / • 标记)
// - 自动与 data/session.json 双向同步（关闭程序下次打开秒级原地恢复）

export interface ProjectTab {
  id: string;
  name: string;
  filePath?: string | null;
  isDirty?: boolean;
  scene: SceneGraph;
}

export function createEmptyScene(): SceneGraph {
  return {
    root: {
      id: 'root',
      type: 'div',
      children: [],
      style: { width: '100%', minHeight: '600px', backgroundColor: '#ffffff' }
    },
    selectedId: null,
    selectedIds: []
  };
}

let nextId = 1;
function genTabId() {
  return 'tab-' + Date.now().toString(36) + '-' + (nextId++);
}

let syncTimer: number = 0;
let isSwitchingTab = false; // 标记当前是否正处于切 tab 过程中，防止 subscribe 误判 dirty
function debouncePersistSession(get: () => TabState) {
  if (typeof window === 'undefined' || !window.bc) return;
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    const st = get();
    // 准备要存盘的纯数据快照
    const payload = {
      activeTabId: st.activeTabId,
      tabs: st.tabs.map((t) => ({
        id: t.id,
        name: t.name,
        filePath: t.filePath || null,
        isDirty: !!t.isDirty,
        scene: t.id === st.activeTabId ? useScene.getState().scene : t.scene
      }))
    };
    window.bc.setSession(payload);
  }, 400);
}

interface TabState {
  tabs: ProjectTab[];
  activeTabId: string;

  newTab: (name?: string, scene?: SceneGraph, filePath?: string | null) => string;
  closeTab: (tabId: string) => boolean;
  switchTab: (tabId: string) => void;
  updateActiveTabScene: (scene: SceneGraph, markDirty?: boolean) => void;
  onSceneChange: (scene: SceneGraph, isContentModified: boolean) => void;
  markActiveTabDirty: (isDirty?: boolean) => void;
  setTabSaved: (tabId: string, filePath: string, name?: string) => void;
  initFromSession: (session: { activeTabId: string | null; tabs: any[] }) => void;
}

const initialScene = createEmptyScene();
const initialTab: ProjectTab = {
  id: 'tab-default',
  name: '未命名项目 1',
  filePath: null,
  isDirty: false,
  scene: initialScene
};

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,

  newTab: (name, customScene, filePath = null) => {
    const st = get();
    const curIndex = st.tabs.length + 1;
    const tabName = name || `未命名项目 ${curIndex}`;
    const scene = customScene || createEmptyScene();
    const newId = genTabId();

    // 先把当前激活标签的 scene 存回 tabs 数组
    const curScene = useScene.getState().scene;
    const updatedTabs = st.tabs.map((t) => (t.id === st.activeTabId ? { ...t, scene: curScene } : t));

    const newT: ProjectTab = {
      id: newId,
      name: tabName,
      filePath,
      isDirty: !filePath,
      scene
    };

    set({
      tabs: [...updatedTabs, newT],
      activeTabId: newId
    });

    // 让画布渲染器载入新场景
    useScene.getState().setScene(scene);
    debouncePersistSession(get);
    return newId;
  },

  closeTab: (tabId: string) => {
    const st = get();
    if (st.tabs.length <= 1) {
      // 最后一个标签关闭：自动重置为新的空白网页
      const empty = createEmptyScene();
      const newId = genTabId();
      const freshTab: ProjectTab = {
        id: newId,
        name: '未命名网页 1',
        filePath: null,
        isDirty: false,
        scene: empty
      };
      set({
        tabs: [freshTab],
        activeTabId: newId
      });
      useScene.getState().setScene(empty);
      debouncePersistSession(get);
      return true;
    }

    const idx = st.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return false;

    const remaining = st.tabs.filter((t) => t.id !== tabId);
    let nextActive = st.activeTabId;

    if (st.activeTabId === tabId) {
      const nextTab = remaining[Math.max(0, idx - 1)] || remaining[0];
      nextActive = nextTab.id;
      useScene.getState().setScene(nextTab.scene);
    }

    set({
      tabs: remaining,
      activeTabId: nextActive
    });

    debouncePersistSession(get);
    return true;
  },

  switchTab: (targetTabId: string) => {
    const st = get();
    if (targetTabId === st.activeTabId) return;
    const target = st.tabs.find((t) => t.id === targetTabId);
    if (!target) return;

    // 存下当前 tab 的最新 scene
    const curScene = useScene.getState().scene;
    const updatedTabs = st.tabs.map((t) => (t.id === st.activeTabId ? { ...t, scene: curScene } : t));

    isSwitchingTab = true;
    set({
      tabs: updatedTabs,
      activeTabId: targetTabId
    });

    useScene.getState().setScene(target.scene);
    // 等下一帧让 subscribe 走完后再解除标记
    requestAnimationFrame(() => { isSwitchingTab = false; });
    debouncePersistSession(get);
  },

  updateActiveTabScene: (scene: SceneGraph, markDirty = false) => {
    set((st) => {
      const tabs = st.tabs.map((t) =>
        t.id === st.activeTabId
          ? { ...t, scene, isDirty: markDirty ? true : t.isDirty }
          : t
      );
      return { tabs };
    });
    debouncePersistSession(get);
  },

  // onSceneChange：由 sceneStore.subscribe 触发。
  // 核心逻辑：只有真正的内容变更才改 isDirty；切换 tab 时的 setScene 不触脏。
  onSceneChange: (scene: SceneGraph, isContentModified: boolean) => {
    set((st) => {
      const curTab = st.tabs.find((t) => t.id === st.activeTabId);
      if (!curTab) return st;
      // 只在真正有内容修改时更新 dirty 状态
      const newDirty = isContentModified ? true : curTab.isDirty;
      return {
        tabs: st.tabs.map((t) =>
          t.id === st.activeTabId ? { ...t, scene, isDirty: newDirty } : t
        )
      };
    });
    debouncePersistSession(get);
  },

  markActiveTabDirty: (isDirty = true) => {
    set((st) => {
      const tabs = st.tabs.map((t) => (t.id === st.activeTabId ? { ...t, isDirty } : t));
      return { tabs };
    });
    debouncePersistSession(get);
  },

  setTabSaved: (tabId: string, filePath: string, name?: string) => {
    set((st) => {
      const pName = name || filePath.replace(/^.*[\\/]/, '').replace(/\.bcproj$/i, '');
      const curScene = useScene.getState().scene;
      const tabs = st.tabs.map((t) =>
        t.id === tabId
          ? { ...t, filePath, name: pName, isDirty: false, scene: t.id === st.activeTabId ? curScene : t.scene }
          : t
      );
      return { tabs };
    });
    debouncePersistSession(get);
  },

  initFromSession: (session: { activeTabId: string | null; tabs: any[] }) => {
    if (!session || !Array.isArray(session.tabs) || session.tabs.length === 0) return;
    const loadedTabs: ProjectTab[] = session.tabs.map((t, idx) => ({
      id: t.id || genTabId(),
      name: t.name || `未命名网页 ${idx + 1}`,
      filePath: t.filePath || null,
      isDirty: !!t.isDirty,
      scene: t.scene || createEmptyScene()
    }));

    const activeId = (session.activeTabId && loadedTabs.some((x) => x.id === session.activeTabId))
      ? session.activeTabId
      : loadedTabs[0].id;

    const activeTab = loadedTabs.find((x) => x.id === activeId) || loadedTabs[0];

    set({
      tabs: loadedTabs,
      activeTabId: activeId
    });

    useScene.getState().setScene(activeTab.scene);
  }
}));

if (typeof window !== 'undefined') {
  const store = (window as any).__tabStore = useTabStore;
  // 暴露内部防抖标记供 sceneStore.subscribe 判断是否正处于切 tab 过程中
  Object.defineProperty(store, '__isSwitchingTab', {
    get: () => isSwitchingTab,
    configurable: true
  });
}

