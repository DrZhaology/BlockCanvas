import { create } from 'zustand';
import type { SceneGraph } from '@lib/types';
import { useScene } from './sceneStore';

// BlockCanvas · Windows Notepad 风格多工程标签页状态机 (TabStore)
// - 管理多个同时打开的网页工程标签
// - 自动记录未保存修改状态 (isDirty / • 标记)
// - 自动与 data/session.json 双向同步（关闭程序下次打开秒级原地恢复）

/** 标签种类：普通工程 / 只读快照预览（v0.4.5） */
export type TabKind = 'project' | 'snapshot';

/** 快照预览标签携带的来源信息 */
export interface SnapshotRef {
  /** 快照属于哪个项目（给人看的名字） */
  projectName: string;
  /** 原工程项目文件（绝对路径，可能为空：从"全部项目"列表点开时一定有） */
  projectPath?: string;
  /** 快照文件本身（绝对路径） */
  snapshotPath: string;
  /** 快照时间（ISO） */
  takenAt: string;
}

export interface ProjectTab {
  id: string;
  name: string;
  filePath?: string | null;
  isDirty?: boolean;
  scene: SceneGraph;
  /** 缺省 = 'project'（兼容旧会话） */
  kind?: TabKind;
  /** kind === 'snapshot' 时必填 */
  snapshot?: SnapshotRef;
}

/** 这个标签是不是"只读快照预览" */
export function isSnapshotTab(tab: ProjectTab | null | undefined): boolean {
  return !!tab && tab.kind === 'snapshot';
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
    selectedIds: [],
    // v0.4.5：新工程**不再预载**一套全局默认变量。
    // 以前每个新工程都自带同样的 15 个变量，看起来像"变量在项目之间共享"（用户反馈）。
    // 变量现在严格跟着工程走：空工程就是空的，需要默认集时到变量面板点「载入默认集」。
    tokens: []
  };
}

let nextId = 1;
function genTabId() {
  return 'tab-' + Date.now().toString(36) + '-' + (nextId++);
}

/**
 * 判断一个工程是不是「完全空」（v0.4.3）。
 * 用途：新建标签默认 isDirty=true（便于提示保存），但一不小心点出来的空项目
 * 关闭时不该再被拦一道 —— 凡是根容器没有任何子元素、且页面级 CSS / 设计变量
 * 都还是出厂状态的，就是"什么都没做过的空壳"，可以直接关。
 */
export function isEmptyProject(scene: SceneGraph | null | undefined): boolean {
  if (!scene || !scene.root) return true;
  const fresh = createEmptyScene();
  if (scene.root.children.length > 0) return false;
  if (JSON.stringify(scene.root.style ?? {}) !== JSON.stringify(fresh.root.style)) return false;
  const qc = scene.quickCss ?? {};
  for (const v of Object.values(qc)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return false;
  }
  const be = scene.bodyExtra ?? {};
  for (const v of Object.values(be)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return false;
  }
  const cur = scene.tokens ?? [];
  const def = fresh.tokens ?? [];
  if (cur.length !== def.length) return false;
  for (const t of cur) {
    const o = def.find((x) => x.name === t.name);
    if (!o || JSON.stringify(o) !== JSON.stringify(t)) return false;
  }
  return true;
}

let syncTimer: number = 0;
let isSwitchingTab = false; // 标记当前是否正处于切 tab 过程中，防止 subscribe 误判 dirty
function debouncePersistSession(get: () => TabState) {
  if (typeof window === 'undefined' || !window.bc) return;
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    const st = get();
    // 准备要存盘的纯数据快照
    // v0.4.5：只读快照标签**不写进会话**——下次启动不该莫名其妙恢复一个"快照预览"，
    // 用户要看快照随时能从「全部项目 → 历史快照」再点开。
    const persistTabs = st.tabs.filter((t) => t.kind !== 'snapshot');
    const payload = {
      activeTabId: persistTabs.some((t) => t.id === st.activeTabId)
        ? st.activeTabId
        : (persistTabs[persistTabs.length - 1]?.id ?? null),
      tabs: persistTabs.map((t) => ({
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
  activeTabId: string | null;

  loadSceneSilently: (scene: SceneGraph) => void;
  newTab: (name?: string, scene?: SceneGraph, filePath?: string | null, history?: { past?: SceneGraph[]; future?: SceneGraph[] }, kind?: TabKind, snapshot?: SnapshotRef) => string;
  closeTab: (tabId: string) => boolean;
  switchTab: (tabId: string) => void;
  updateActiveTabScene: (scene: SceneGraph, markDirty?: boolean) => void;
  onSceneChange: (scene: SceneGraph, isContentModified: boolean) => void;
  markActiveTabDirty: (isDirty?: boolean) => void;
  setTabSaved: (tabId: string, filePath: string, name?: string) => void;
  /** 工程文件在磁盘上被重命名后，同步更新打开了它的标签的 filePath */
  renameTabFilePath: (oldPath: string, newPath: string) => void;
  /** 快照覆盖回项目后：把已经打开的那个工程标签同步成新场景（并清掉未保存点） */
  applyRestoredScene: (filePath: string, scene: SceneGraph) => void;
  initFromSession: (session: { activeTabId: string | null; tabs: any[] }) => void;
}

export const useTabStore = create<TabState>((set, get) => ({
  // v0.4.5：启动时不预置「未命名项目 1」——没有标签就直接进首页（浏览器新标签页的体验）。
  // 会话恢复（initFromSession）拿到上次的标签时会自动填回来。
  tabs: [],
  activeTabId: null,

  // 静默载入场景：切 tab / 打开工程 / 恢复会话都用它 ——
  // setScene 会触发 sceneStore.subscribe，若不打 isSwitchingTab 标记，
  // "打开一个项目"会被误判成"内容修改" → 刚打开就挂着未保存圆点（用户反馈的混淆来源）。
  loadSceneSilently: (scene: SceneGraph) => {
    isSwitchingTab = true;
    useScene.getState().setScene(scene);
    requestAnimationFrame(() => { isSwitchingTab = false; });
  },

  newTab: (name, customScene, filePath = null, history, kind = 'project', snapshot) => {
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
      // 快照预览是只读的，永远不脏；普通工程未保存过就是脏的
      isDirty: kind === 'snapshot' ? false : !filePath,
      scene,
      kind,
      ...(snapshot ? { snapshot } : {})
    };

    set({
      tabs: [...updatedTabs, newT],
      activeTabId: newId
    });

    // 让画布渲染器载入新场景（静默：不算内容修改）
    get().loadSceneSilently(scene);
    // 撤销历史随工程保存（v0.4.4）：工程文件里带了 history 节就恢复 ——
    // 下次打开还能 Ctrl+Z 回退到上次关闭前的状态（条数由设置里的阈值控制）
    if (history && Array.isArray(history.past) && history.past.length > 0) {
      useScene.setState({
        history: { past: history.past.slice(), future: (history.future || []).slice() }
      });
    }
    debouncePersistSession(get);
    return newId;
  },

  closeTab: (tabId: string) => {
    const st = get();
    if (st.tabs.length <= 1) {
      // v0.4.4：关掉最后一个标签 → 进入「空页面」状态（一个标签都不留），
      // 不再自动补一个"未命名网页 1"—— 空页面上有大按钮，想开随时开。
      set({ tabs: [], activeTabId: null });
      useScene.getState().setScene(createEmptyScene());
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

  renameTabFilePath: (oldPath: string, newPath: string) => {
    const norm = (p: string) => String(p || '').replace(/[\\/]+/g, '/').toLowerCase();
    set((st) => ({
      tabs: st.tabs.map((t) =>
        t.filePath && norm(t.filePath) === norm(oldPath) ? { ...t, filePath: newPath } : t
      )
    }));
    debouncePersistSession(get);
  },

  // 快照覆盖回项目：如果原工程此刻正开着，直接把它的场景换掉（撤销栈清空、未保存点清掉），
  // 否则用户会看到"磁盘已经回退，画布还是旧内容"。
  applyRestoredScene: (filePath: string, scene: SceneGraph) => {
    const norm = (p: string) => String(p || '').replace(/[\\/]+/g, '/').toLowerCase();
    const st = get();
    const target = st.tabs.find((t) => t.filePath && norm(t.filePath) === norm(filePath));
    if (!target) return;
    set({
      tabs: st.tabs.map((t) => (t.id === target.id ? { ...t, scene, isDirty: false } : t))
    });
    if (st.activeTabId === target.id) {
      isSwitchingTab = true;
      useScene.getState().setScene(scene);
      useScene.setState({ history: { past: [], future: [] } });
      requestAnimationFrame(() => { isSwitchingTab = false; });
    }
    debouncePersistSession(get);
  },

  initFromSession: (session: { activeTabId: string | null; tabs: any[] }) => {
    if (!session || !Array.isArray(session.tabs)) return;
    // 空会话（上次退出时关掉了所有标签）→ 恢复成「空页面」状态，不自动补标签
    if (session.tabs.length === 0) {
      set({ tabs: [], activeTabId: null });
      useScene.getState().setScene(createEmptyScene());
      return;
    }
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

    get().loadSceneSilently(activeTab.scene);
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

