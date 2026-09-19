import { useEffect, useState, useCallback } from 'react';
import { Toolbar } from '@comp/Toolbar';
import { ElementPanel } from '@comp/ElementPanel';
import { Canvas } from '@comp/Canvas';
import { CanvasOverlays } from '@comp/CanvasOverlays';
import { Inspector } from '@comp/Inspector';
import { LayerTree } from '@comp/LayerTree';
import { ErrorBoundary } from '@comp/ErrorBoundary';
import { ProjectsCenter } from '@comp/ProjectsCenter';
import { Settings, type SettingsSection } from '@comp/Settings';
import { ProjectTabBar } from '@comp/ProjectTabBar';
import { AboutModal } from '@comp/About';
import { ShortcutsModal } from '@comp/ShortcutsModal';
import { useScene, findNode } from '@store/sceneStore';
import { useTabStore } from '@store/tabStore';
import { refreshPlugins } from '@lib/pluginHost';
import { withViewTransition } from '@lib/viewTransition';
import { DEVICE_LIST, widthToBreakpoint, type DeviceId } from '@lib/device';
import { tokensToRootCss } from '@lib/designTokens';

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
const RIGHT_WIDTH_DEFAULT = 416;
const RIGHT_WIDTH_MIN = 340;

export type AppView = 'editor' | 'projects' | 'settings';

export default function App() {
  const [rightTab, setRightTabRaw] = usePersistentState<RightTab>(RIGHT_TAB_KEY, 'inspector');
  // v0.4.4：页签切换不再走 View Transition —— VT 的旧帧快照会让文字"停一会儿"。
  // 改为内容重挂载 + 轻量入场动画（见 .tab-body 的 bcSwapIn）。
  const setRightTab = (t: RightTab) => setRightTabRaw(t);
  const [canvasWidth, setCanvasWidth] = usePersistentState<string>(CANVAS_WIDTH_KEY, 'auto');
  const [layout, setLayout] = usePersistentState<'left' | 'bottom'>(LAYOUT_KEY, 'bottom');
  const [bottomHeight, setBottomHeight] = usePersistentState<number>(BOTTOM_HEIGHT_KEY, BOTTOM_HEIGHT_DEFAULT);
  const [rightWidth, setRightWidth] = usePersistentState<number>(RIGHT_WIDTH_KEY, RIGHT_WIDTH_DEFAULT);
  const [leftWidth, setLeftWidth] = usePersistentState<number>(LEFT_WIDTH_KEY, LEFT_WIDTH_DEFAULT);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<AppView>('editor');
  // 所有「整页切换」都走原生视图过渡：旧页面淡出 + 新页面淡入
  // （不重挂载视图、不丢状态；宿主不支持或系统开了"减少动态效果"时自动降级为直接切换）
  const switchView = useCallback((next: AppView) => {
    withViewTransition(() => setView((cur) => (cur === next ? cur : next)));
  }, []);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('personalization');
  const [showAbout, setShowAbout] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [_updating, setUpdating] = useState(false);
  const [pocketExpanded, setPocketExpanded] = useState(() => {
    try {
      return localStorage.getItem('bc-elem-tab') === 'templates' && localStorage.getItem('bc-pocket-expanded') === 'true';
    } catch {
      return false;
    }
  });
  const applyZoom = (fn: (z: number) => number) => setZoom(fn);

  // 属性面板内容越来越多，旧的 384px 默认宽度会显得很挤。
  // 这里做一次性迁移：老用户若仍是窄面板，悄悄放宽到新的默认宽度（之后可再手动拖窄）。
  useEffect(() => {
    try {
      if (localStorage.getItem('bc-right-width-widened') === '1') return;
      localStorage.setItem('bc-right-width-widened', '1');
      if (rightWidth < 400) setRightWidth(RIGHT_WIDTH_DEFAULT);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useKeyboardShortcuts(switchView, () => setShowShortcuts(true));

  // 0. 设备 / 断点 / 画布宽度 三合一同步
  //    - 画布宽度变化 → 自动推导当前编辑断点（电脑 / 平板 / 手机）
  //    - 任意地方广播 bc:set-device → 反推标准画布宽度
  useEffect(() => {
    const bp = widthToBreakpoint(canvasWidth);
    if (useScene.getState().activeBreakpoint !== bp) {
      useScene.getState().setActiveBreakpoint(bp);
    }
  }, [canvasWidth]);

  useEffect(() => {
    const onSetDevice = (e: Event) => {
      const d = (e as CustomEvent).detail as DeviceId;
      const target = DEVICE_LIST.find((x) => x.id === d);
      if (target) setCanvasWidth(target.width);
    };
    window.addEventListener('bc:set-device', onSetDevice);
    return () => window.removeEventListener('bc:set-device', onSetDevice);
  }, [setCanvasWidth]);

  // 设计变量 → 注入文档根，让画布里的 var(--bc-*) 立刻生效（所见即所得，无需额外解析）
  const tokens = useScene((s) => s.scene.tokens);
  useEffect(() => {
    let el = document.getElementById('bc-design-tokens') as HTMLStyleElement | null;
    const css = tokensToRootCss(tokens ?? []);
    if (!css) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = 'bc-design-tokens';
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, [tokens]);

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
    const openProjects = () => switchView('projects');
    const openSettings = (sec?: SettingsSection) => {
      setSettingsSection(sec || 'personalization');
      switchView('settings');
    };
    const openClass = () => {
      switchView('editor');
      setRightTab('inspector');
      window.dispatchEvent(new CustomEvent('bc:open-class'));
    };
    const openAbout = () => setShowAbout(true);

    const onNewTab = () => {
      useTabStore.getState().newTab();
      switchView('editor');
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
        switchView('editor');
      }
    };

    const onExportHtml = () => {
      window.dispatchEvent(new CustomEvent('bc:export-html'));
    };

    const onPreview = () => {
      window.dispatchEvent(new CustomEvent('bc:preview'));
    };

    const onSetPocket = (e: Event) => {
      const v = (e as CustomEvent).detail;
      setPocketExpanded(typeof v === 'boolean' ? v : (prev) => !prev);
    };

    window.addEventListener('bc:set-layout', onSetLayout);
    window.addEventListener('bc:set-pocket', onSetPocket);
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
      window.removeEventListener('bc:set-pocket', onSetPocket);
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
  }, [setLayout, switchView]);

  return (
    <div className="app">
      {view === 'projects' ? (
        <ProjectsCenter
          onBack={() => switchView('editor')}
        />
      ) : view === 'settings' ? (
        <Settings
          onBack={() => switchView('editor')}
          onOpenWebManager={() => switchView('projects')}
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
          {(() => {
            const effectiveBottomHeight = pocketExpanded
              ? Math.max(520, Math.round(window.innerHeight * 0.65))
              : bottomHeight;
            const effectiveLeftWidth = pocketExpanded
              ? Math.max(580, Math.round(window.innerWidth * 0.45))
              : leftWidth;

            return (
              <div
                className={"workspace" + (pocketExpanded ? " pocket-expanded" : "")}
                data-layout={layout}
                style={{
                  '--bc-bottom-height': effectiveBottomHeight + 'px',
                  '--bc-right-width': rightWidth + 'px',
                  '--bc-left-width': effectiveLeftWidth + 'px'
                } as React.CSSProperties}
              >
                <div className="elem-pane-wrap">
                  <ErrorBoundary label="元素面板"><ElementPanel /></ErrorBoundary>
                  {layout === 'left' && (
                    <div
                      className={"panel-resizer panel-resizer-left" + (pocketExpanded ? " is-disabled" : "")}
                      onMouseDown={(e) => {
                        if (pocketExpanded) return;
                        startResize(e, 'left', setLeftWidth, LEFT_WIDTH_MIN, leftWidth);
                      }}
                      title={pocketExpanded ? "已撑开口袋，宽度调整已锁定" : undefined}
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
                  <CanvasOverlays />
                  {layout === 'bottom' && (
                    <div
                      className={"panel-resizer panel-resizer-horizontal" + (pocketExpanded ? " is-disabled" : "")}
                      onMouseDown={(e) => {
                        if (pocketExpanded) return;
                        startResize(e, 'bottom', setBottomHeight, BOTTOM_HEIGHT_MIN, bottomHeight);
                      }}
                      title={pocketExpanded ? "已撑开口袋，高度调整已锁定" : undefined}
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
                    <div className="tab-body" key={rightTab}>
                      <ErrorBoundary label="右侧面板">
                        {rightTab === 'layers' ? <LayerTree /> : <Inspector />}
                      </ErrorBoundary>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}
      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
      <ShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
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
function useKeyboardShortcuts(setView: (v: AppView) => void, onOpenShortcuts?: () => void) {
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

    // 像素级方向键微调（选中的第一个元素）
    const triggerNudge = (axis: 'x' | 'y', delta: number) => {
      const st = useScene.getState();
      const id = st.scene.selectedId;
      if (!id) return;
      const node = findNode(st.scene.root, id);
      if (!node) return;

      st.beginStyleEdit();
      const pos = node.style.position;
      if (pos === 'absolute' || pos === 'fixed' || pos === 'relative') {
        if (axis === 'x') {
          const curLeft = parseFloat(node.style.left || '0') || 0;
          st.updateStyle(id, { left: Math.round(curLeft + delta) + 'px' });
        } else {
          const curTop = parseFloat(node.style.top || '0') || 0;
          st.updateStyle(id, { top: Math.round(curTop + delta) + 'px' });
        }
      } else {
        // 常规流式元素：微调对应方向的外边距
        if (axis === 'x') {
          const curMargin = parseFloat(node.style.marginLeft || '0') || 0;
          st.updateStyle(id, { marginLeft: Math.round(curMargin + delta) + 'px' });
        } else {
          const curMargin = parseFloat(node.style.marginTop || '0') || 0;
          st.updateStyle(id, { marginTop: Math.round(curMargin + delta) + 'px' });
        }
      }
      st.endStyleEdit();
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

      // 快捷键速查表
      if ((e.key === '?' || (e.shiftKey && e.key === '/')) && !mod) {
        e.preventDefault();
        onOpenShortcuts?.();
        return;
      }

      // 方向键微调
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowUp') { e.preventDefault(); triggerNudge('y', -step); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); triggerNudge('y', step); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); triggerNudge('x', -step); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); triggerNudge('x', step); return; }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [setView, onOpenShortcuts]);
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
