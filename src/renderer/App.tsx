import { useEffect, useState } from 'react';
import { Toolbar } from '@comp/Toolbar';
import { ElementPanel } from '@comp/ElementPanel';
import { Canvas } from '@comp/Canvas';
import { Inspector } from '@comp/Inspector';
import { LayerTree } from '@comp/LayerTree';
import { ErrorBoundary } from '@comp/ErrorBoundary';
import { ProjectsCenter } from '@comp/ProjectsCenter';
import { Settings, type SettingsSection } from '@comp/Settings';
import { ProjectTabBar } from '@comp/ProjectTabBar';
import { AboutModal } from '@comp/About';
import { useScene } from '@store/sceneStore';
import { useTabStore } from '@store/tabStore';
import { refreshPlugins } from '@lib/pluginHost';

// BlockCanvas · 主界面
// - 顶部：Windows 11 记事本风格项目多标签栏 (ProjectTabBar)
// - 视图中枢：'editor' (画布编辑) | 'web-manager' (项目与网页管理库) | 'settings' (Fluent 偏好设置)
// - 会话自愈：启动自动从 data/session.json 恢复上次打开的所有标签页与草稿
// - 自动备份：根据用户设定时间间隔自动快照至 data/backups/

type RightTab = 'layers' | 'inspector';
const RIGHT_TAB_KEY = 'bc-right-tab';
const CANVAS_WIDTH_KEY = 'bc-canvas-width';
const LAYOUT_KEY = 'bc-layout';
const BOTTOM_HEIGHT_KEY = 'bc-bottom-height';
const RIGHT_WIDTH_KEY = 'bc-right-width';
const LEFT_WIDTH_KEY = 'bc-left-width';
const LEFT_WIDTH_DEFAULT = 230;
const LEFT_WIDTH_MIN = 160;
const BOTTOM_HEIGHT_DEFAULT = 250;
const BOTTOM_HEIGHT_MIN = 175;
const RIGHT_WIDTH_DEFAULT = 320;
const RIGHT_WIDTH_MIN = 224;

export type AppView = 'editor' | 'projects' | 'settings';

export default function App() {
  const [rightTab, setRightTab] = usePersistentState<RightTab>(RIGHT_TAB_KEY, 'inspector');
  const [canvasWidth, setCanvasWidth] = usePersistentState<string>(CANVAS_WIDTH_KEY, 'auto');
  const [layout, setLayout] = usePersistentState<'left' | 'bottom'>(LAYOUT_KEY, 'bottom');
  const [bottomHeight, setBottomHeight] = usePersistentState<number>(BOTTOM_HEIGHT_KEY, BOTTOM_HEIGHT_DEFAULT);
  const [rightWidth, setRightWidth] = usePersistentState<number>(RIGHT_WIDTH_KEY, RIGHT_WIDTH_DEFAULT);
  const [leftWidth, setLeftWidth] = usePersistentState<number>(LEFT_WIDTH_KEY, LEFT_WIDTH_DEFAULT);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<AppView>('editor');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('personalization');
  const [showAbout, setShowAbout] = useState(false);
  const [_updating, setUpdating] = useState(false);
  const applyZoom = (fn: (z: number) => number) => setZoom(fn);

  useKeyboardShortcuts(setView);

  // 1. 启动时像 Windows 11 记事本一样秒级恢复上次会话
  useEffect(() => {
    (async () => {
      try {
        const session = await window.bc.getSession();
        if (session && session.tabs && session.tabs.length > 0) {
          useTabStore.getState().initFromSession(session);
        }
      } catch (e) {
        console.warn('恢复会话失败:', e);
      }
    })();
  }, []);

  // 2. 定时自动备份：按用户配置的毫秒数执行，按项目名称分别隔离保存
  useEffect(() => {
    let timer: number = 0;
    const startBackupTimer = async () => {
      const cfg = await window.bc.getAppConfig();
      const interval = typeof cfg.autoBackupInterval === 'number' ? cfg.autoBackupInterval : 60000;
      if (interval <= 0) return;

      timer = window.setInterval(() => {
        const sc = useScene.getState().scene;
        const tabs = useTabStore.getState().tabs;
        const activeId = useTabStore.getState().activeTabId;
        const curTab = tabs.find((t) => t.id === activeId);
        if (sc.root.children.length > 0) {
          window.bc.saveBackupSnapshot(sc, curTab?.name, true);
        }
      }, interval);
    };

    startBackupTimer();
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, []);

  // 3. 启动 / 刷新插件宿主
  useEffect(() => {
    refreshPlugins();
    const onPluginsChanged = () => refreshPlugins();
    window.addEventListener('bc:plugins-changed', onPluginsChanged);
    return () => window.removeEventListener('bc:plugins-changed', onPluginsChanged);
  }, []);

  // 4. 启动延迟检测更新（5秒后静默检查，有更新则弹窗）
  useEffect(() => {
    const checkAndNotify = async () => {
      try {
        const cfg = await window.bc.getAppConfig();
        const lastCheck = cfg.lastCheckUpdate as string | undefined;
        if (lastCheck && Date.now() - new Date(lastCheck).getTime() < 24 * 3600 * 1000) return;
        await window.bc.setAppConfig({ lastCheckUpdate: new Date().toISOString() });
      } catch {}

      try {
        const result = await window.bc.checkUpdate();
        if (!result.ok || !result.hasUpdate) return;
        // 弹窗通知
        setTimeout(() => {
          const confirmed = confirm(
            `发现新版本 ${result.latestVersion}！\n\n当前版本：${result.localVersion}\n${result.releaseName ? '版本说明：' + result.releaseName + '\n' : ''}是否立即下载并更新？`
          );
          if (confirmed && result.downloadUrl) {
            handleApplyUpdate(result.downloadUrl);
          }
        }, 500);
      } catch {}
    };
    const timer = window.setTimeout(checkAndNotify, 5000);
    return () => window.clearTimeout(timer);
  }, []);

  const handleApplyUpdate = async (assetUrl: string) => {
    setUpdating(true);
    try {
      const res = await window.bc.applyUpdate(assetUrl);
      if (!res.ok) alert('更新失败：' + (res.error || '未知错误'));
    } finally {
      setUpdating(false);
    }
  };

  const checkAndUpdateManually = async () => {
    try {
      const result = await window.bc.checkUpdate();
      if (!result.ok) { alert('检测更新失败：' + (result.error || '未知错误')); return; }
      if (!result.hasUpdate) {
        alert(`当前已是最新版本 ${result.localVersion}，无需更新。`);
        return;
      }
      const confirmed = confirm(
        `发现新版本 ${result.latestVersion}！\n\n当前版本：${result.localVersion}\n${result.releaseName ? '版本说明：' + result.releaseName + '\n' : ''}是否立即下载并更新？`
      );
      if (confirmed && result.downloadUrl) {
        handleApplyUpdate(result.downloadUrl);
      }
    } catch (e: any) {
      alert('检测更新失败：' + (e.message || '未知错误'));
    }
  };

  // 4. 菜单 & 事件路由监听
  useEffect(() => {
    const onSetLayout = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === 'left' || v === 'bottom') setLayout(v);
    };
    const toLeft = () => setLayout('left');
    const toBottom = () => setLayout('bottom');
    const openProjects = () => setView('projects');
    const openSettings = (sec?: SettingsSection) => {
      setSettingsSection(sec || 'personalization');
      setView('settings');
    };
    const openClass = () => {
      setView('editor');
      setRightTab('inspector');
      window.dispatchEvent(new CustomEvent('bc:open-class'));
    };
    const openAbout = () => setShowAbout(true);

    const onNewTab = () => {
      useTabStore.getState().newTab();
      setView('editor');
    };

    const onSaveProject = async () => {
      const tabs = useTabStore.getState().tabs;
      const activeId = useTabStore.getState().activeTabId;
      const curTab = tabs.find((t) => t.id === activeId);
      if (!curTab) return;
      const curScene = useScene.getState().scene;

      if (curTab.filePath) {
        const res = await window.bc.saveProject({ name: curTab.name, scene: curScene }, false, curTab.filePath);
        if (res.ok) useTabStore.getState().setTabSaved(curTab.id, curTab.filePath, curTab.name);
      } else {
        const res = await window.bc.saveProject({ name: curTab.name, scene: curScene }, true);
        if (res.ok && res.path) useTabStore.getState().setTabSaved(curTab.id, res.path, res.name);
      }
    };

    const onSaveProjectAs = async () => {
      const tabs = useTabStore.getState().tabs;
      const activeId = useTabStore.getState().activeTabId;
      const curTab = tabs.find((t) => t.id === activeId);
      if (!curTab) return;
      const curScene = useScene.getState().scene;
      const res = await window.bc.saveProject({ name: curTab.name, scene: curScene }, true);
      if (res.ok && res.path) useTabStore.getState().setTabSaved(curTab.id, res.path, res.name);
    };

    const onOpenProject = async () => {
      const res = await window.bc.openProjectFile();
      if (res.ok && res.project?.scene) {
        useTabStore.getState().newTab(res.project.name || '已打开工程', res.project.scene, res.path);
        setView('editor');
      }
    };

    const onExportHtml = () => {
      window.dispatchEvent(new CustomEvent('bc:export-html'));
    };

    const onPreview = () => {
      window.dispatchEvent(new CustomEvent('bc:preview'));
    };

    window.addEventListener('bc:set-layout', onSetLayout);
    window.addEventListener('bc:open-projects', openProjects);
    window.addEventListener('bc:open-settings', () => openSettings());
    window.addEventListener('menu:layout-left', toLeft);
    window.addEventListener('menu:layout-bottom', toBottom);
    window.addEventListener('menu:ext', () => openSettings('extensions'));
    window.addEventListener('menu:web-manager', openProjects);
    window.addEventListener('menu:settings', () => openSettings());
    window.addEventListener('menu:class-manager', openClass);
    window.addEventListener('menu:about', openAbout);
    window.addEventListener('menu:check-update', () => checkAndUpdateManually());
    window.addEventListener('menu:new-tab', onNewTab);
    window.addEventListener('menu:save-project', onSaveProject);
    window.addEventListener('menu:save-project-as', onSaveProjectAs);
    window.addEventListener('menu:open-project', onOpenProject);
    window.addEventListener('menu:export-html', onExportHtml);
    window.addEventListener('menu:preview', onPreview);

    const offs = [
      window.bc.onMenu('menu:layout-left', toLeft),
      window.bc.onMenu('menu:layout-bottom', toBottom),
      window.bc.onMenu('menu:ext', () => openSettings('extensions')),
      window.bc.onMenu('menu:web-manager', openProjects),
      window.bc.onMenu('menu:settings', () => openSettings()),
      window.bc.onMenu('menu:class-manager', openClass),
      window.bc.onMenu('menu:about', openAbout),
      window.bc.onMenu('menu:check-update', () => checkAndUpdateManually()),
      window.bc.onMenu('menu:new-tab', onNewTab),
      window.bc.onMenu('menu:save-project', onSaveProject),
      window.bc.onMenu('menu:save-project-as', onSaveProjectAs),
      window.bc.onMenu('menu:open-project', onOpenProject),
      window.bc.onMenu('menu:export-html', onExportHtml),
      window.bc.onMenu('menu:preview', onPreview)
    ];

    return () => {
      window.removeEventListener('bc:set-layout', onSetLayout);
      window.removeEventListener('bc:open-projects', openProjects);
      window.removeEventListener('bc:open-settings', () => openSettings());
      window.removeEventListener('menu:layout-left', toLeft);
      window.removeEventListener('menu:layout-bottom', toBottom);
      window.removeEventListener('menu:ext', () => openSettings('extensions'));
      window.removeEventListener('menu:web-manager', openProjects);
      window.removeEventListener('menu:settings', () => openSettings());
      window.removeEventListener('menu:class-manager', openClass);
      window.removeEventListener('menu:about', openAbout);
      window.removeEventListener('menu:check-update', () => checkAndUpdateManually());
      window.removeEventListener('menu:new-tab', onNewTab);
      window.removeEventListener('menu:save-project', onSaveProject);
      window.removeEventListener('menu:save-project-as', onSaveProjectAs);
      window.removeEventListener('menu:open-project', onOpenProject);
      window.removeEventListener('menu:export-html', onExportHtml);
      window.removeEventListener('menu:preview', onPreview);
      offs.forEach((off) => off && off());
    };
  }, [setLayout, setView]);

  return (
    <div className="app">
      {view === 'projects' ? (
        <ProjectsCenter
          onBack={() => setView('editor')}
        />
      ) : view === 'settings' ? (
        <Settings
          onBack={() => setView('editor')}
          onOpenWebManager={() => setView('projects')}
          initialSection={settingsSection}
          layout={layout}
          onLayoutChange={setLayout}
          canvasWidth={canvasWidth}
          onCanvasWidthChange={setCanvasWidth}
        />
      ) : (
        <>
          <ProjectTabBar />
          <Toolbar
            canvasWidth={canvasWidth}
            onCanvasWidthChange={setCanvasWidth}
            zoom={zoom}
            onZoomChange={setZoom}
          />
          <div
            className="workspace"
            data-layout={layout}
            style={{
              '--bc-bottom-height': bottomHeight + 'px',
              '--bc-right-width': rightWidth + 'px',
              '--bc-left-width': leftWidth + 'px'
            } as React.CSSProperties}
          >
            <div className="elem-pane-wrap">
              <ErrorBoundary label="元素面板"><ElementPanel /></ErrorBoundary>
              {layout === 'left' && (
                <div
                  className="panel-resizer panel-resizer-left"
                  onMouseDown={(e) => startResize(e, 'left', setLeftWidth, LEFT_WIDTH_MIN, leftWidth)}
                >
                  <div className="panel-resizer-handle" />
                </div>
              )}
            </div>
            <div className="canvas-area">
              <ErrorBoundary label="画布">
                <Canvas
                  canvasWidth={canvasWidth}
                  zoom={zoom}
                  onZoomChange={applyZoom}
                  onUserResize={(px) => setCanvasWidth(px + 'px')}
                />
              </ErrorBoundary>
              {layout === 'bottom' && (
                <div
                  className="panel-resizer panel-resizer-horizontal"
                  onMouseDown={(e) => startResize(e, 'bottom', setBottomHeight, BOTTOM_HEIGHT_MIN, bottomHeight)}
                >
                  <div className="panel-resizer-handle" />
                </div>
              )}
            </div>
            <div className="right-pane-wrap">
              <div
                className="panel-resizer panel-resizer-vertical"
                onMouseDown={(e) => startResize(e, 'right', setRightWidth, RIGHT_WIDTH_MIN, rightWidth)}
              >
                <div className="panel-resizer-handle" />
              </div>
              <div className="right-pane">
                <div className="tab-bar">
                  <button
                    className={"tab-btn" + (rightTab === 'layers' ? ' active' : '')}
                    onClick={() => setRightTab('layers')}
                  >图层</button>
                  <button
                    className={"tab-btn" + (rightTab === 'inspector' ? ' active' : '')}
                    onClick={() => setRightTab('inspector')}
                  >属性</button>
                </div>
                <div className="tab-body">
                  <ErrorBoundary label="右侧面板">
                    {rightTab === 'layers' ? <LayerTree /> : <Inspector />}
                  </ErrorBoundary>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
    </div>
  );
}

function startResize(
  e: React.MouseEvent,
  dir: 'bottom' | 'right' | 'left',
  setter: (v: number) => void,
  min: number,
  initial: number
) {
  e.preventDefault();
  const startY = e.clientY;
  const startX = e.clientX;
  const vertical = dir === 'bottom';
  const wsEl = (e.currentTarget as HTMLElement).closest('.workspace') as HTMLElement | null;
  const bottomMax = wsEl ? Math.max(min, wsEl.clientHeight - 60) : Infinity;
  document.body.classList.add(vertical ? 'bc-resizing-ns' : 'bc-resizing-col');
  const onMove = (ev: MouseEvent) => {
    if (dir === 'bottom') {
      setter(Math.min(bottomMax, Math.max(min, initial + (startY - ev.clientY))));
    } else if (dir === 'right') {
      setter(Math.max(min, initial - (ev.clientX - startX)));
    } else {
      setter(Math.max(min, initial + (ev.clientX - startX)));
    }
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.classList.remove('bc-resizing-ns');
    document.body.classList.remove('bc-resizing-col');
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ============ 全局快捷键 + 菜单事件 ============
function useKeyboardShortcuts(setView: (v: AppView) => void) {
  useEffect(() => {
    const triggerUndo = () => useScene.getState().undo();
    const triggerRedo = () => useScene.getState().redo();
    const triggerCopy = () => {
      const st = useScene.getState();
      if (st.scene.selectedIds.length > 0) st.copyMany(st.scene.selectedIds);
    };
    const triggerCut = () => {
      const st = useScene.getState();
      if (st.scene.selectedIds.length > 0) st.cutMany(st.scene.selectedIds);
    };
    const triggerPaste = () => {
      const st = useScene.getState();
      const id = st.scene.selectedId;
      if (!st.clipboard) return;
      st.paste(id);
    };
    const triggerDuplicate = () => {
      const st = useScene.getState();
      if (st.scene.selectedId) st.duplicateElement(st.scene.selectedId);
    };
    const triggerDelete = () => {
      const st = useScene.getState();
      if (st.scene.selectedIds.length > 0) st.removeMany(st.scene.selectedIds);
    };
    const triggerSelectAll = () => {
      const st = useScene.getState();
      const ids: string[] = [];
      const walk = (n: any) => {
        for (const c of n.children) {
          if (!c.hidden && !c.locked) ids.push(c.id);
          walk(c);
        }
      };
      walk(st.scene.root);
      st.selectMany(ids);
    };

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); triggerUndo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); triggerRedo(); return; }
      if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); triggerCopy(); return; }
      if (mod && e.key.toLowerCase() === 'x') { e.preventDefault(); triggerCut(); return; }
      if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); triggerPaste(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); triggerDuplicate(); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); triggerSelectAll(); return; }
      if (mod && e.key === ',') { e.preventDefault(); setView('settings'); return; }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        useTabStore.getState().newTab();
        setView('editor');
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(e.shiftKey ? 'menu:save-project-as' : 'menu:save-project'));
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('menu:open-project'));
        return;
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('bc:export-html'));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); triggerDelete(); return; }
      if (e.key === 'Escape') { e.preventDefault(); useScene.getState().selectElement(null); return; }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [setView]);
}

function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [state, setStateRaw] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? JSON.parse(s) as T : initial;
    } catch { return initial; }
  });
  const setState = (v: T) => {
    setStateRaw(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  };
  return [state, setState];
}
