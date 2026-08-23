import { useEffect, useState } from 'react';
import { Toolbar } from '@comp/Toolbar';
import { ElementPanel } from '@comp/ElementPanel';
import { Canvas } from '@comp/Canvas';
import { Inspector } from '@comp/Inspector';
import { LayerTree } from '@comp/LayerTree';
import { ErrorBoundary } from '@comp/ErrorBoundary';
import { ExtensionManager } from '@comp/ExtensionManager';
import { AboutModal } from '@comp/About';
import { useScene } from '@store/sceneStore';
import { refreshPlugins } from '@lib/pluginHost';
import type { SceneElement } from '@lib/types';

// BlockCanvas · 主界面
// 阶段1：顶部窄工具栏 + 左中右三栏
// 阶段4・F版2：布局可切换（设置菜单 / 事件）——
//   - 'left'：左=元素/模板，中=画布，右=属性（原版）
//   - 'bottom'：上=画布+右属性，下=元素/模板（默认，画布最大）
//   zoom 提升到 App：归位按钮在工具栏；菜单设置里也可切布局

type RightTab = 'layers' | 'inspector';
const RIGHT_TAB_KEY = 'bc-right-tab';
// 画布宽度：'auto' = 跟随编辑区（自适应），或具体像素 '<n>px'，或预设断点 '375px'/'768px'/'1440px'
const CANVAS_WIDTH_KEY = 'bc-canvas-width';
// 布局模式：'left' 左栏布局 / 'bottom' 底部栏布局（默认，画布最大）
const LAYOUT_KEY = 'bc-layout';
// bottom 面板高度 / right 面板宽度（可拖手调，最小约为默认 70%）
const BOTTOM_HEIGHT_KEY = 'bc-bottom-height';
const RIGHT_WIDTH_KEY = 'bc-right-width';
// 左侧布局下元素面板宽度（可拖动调宽，仅 left 布局生效）
const LEFT_WIDTH_KEY = 'bc-left-width';
const LEFT_WIDTH_DEFAULT = 230;
const LEFT_WIDTH_MIN = 160;
const BOTTOM_HEIGHT_DEFAULT = 250;
const BOTTOM_HEIGHT_MIN = 175;
const RIGHT_WIDTH_DEFAULT = 320;
const RIGHT_WIDTH_MIN = 224;

export default function App() {
  const [rightTab, setRightTab] = usePersistentState<RightTab>(RIGHT_TAB_KEY, 'inspector');
  const [canvasWidth, setCanvasWidth] = usePersistentState<string>(CANVAS_WIDTH_KEY, 'auto');
  const [layout, setLayout] = usePersistentState<'left' | 'bottom'>(LAYOUT_KEY, 'bottom');
  const [bottomHeight, setBottomHeight] = usePersistentState<number>(BOTTOM_HEIGHT_KEY, BOTTOM_HEIGHT_DEFAULT);
  const [rightWidth, setRightWidth] = usePersistentState<number>(RIGHT_WIDTH_KEY, RIGHT_WIDTH_DEFAULT);
  const [leftWidth, setLeftWidth] = usePersistentState<number>(LEFT_WIDTH_KEY, LEFT_WIDTH_DEFAULT);
  const [zoom, setZoom] = useState(1);
  // 全页视图切换：'editor' 编辑器（默认） / 'extensions' 扩展管理
  const [view, setView] = useState<'editor' | 'extensions'>('editor');
  // 关于弹窗
  const [showAbout, setShowAbout] = useState(false);
  // Toolbar/Canvas 共用：setZoom 直接可用（Canvas 传函数式更新）
  const applyZoom = (fn: (z: number) => number) => setZoom(fn);

  // 阶段1补：不再强制选中后切到属性页
  // 用户可在图层页中查看选中行（LayerTree 内部自动滚动定位）
  // 用户主动点 Tab 切换控制权交给用户

  useKeyboardShortcuts();

  // 启动 / 刷新插件宿主（插件启用、禁用、导入、删除后由扩展管理页派发 bc:plugins-changed）
  useEffect(() => {
    refreshPlugins();
    const onPluginsChanged = () => refreshPlugins();
    window.addEventListener('bc:plugins-changed', onPluginsChanged);
    return () => window.removeEventListener('bc:plugins-changed', onPluginsChanged);
  }, []);

  // 菜单"设置"事件：切换布局 / 打开扩展 / 打开类名管理 / 关于
  // 生产走 IPC（bc.onMenu），测试里 window.dispatchEvent(new CustomEvent('menu:…')) 兜底转发
  useEffect(() => {
    const onSetLayout = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === 'left' || v === 'bottom') setLayout(v);
    };
    const toLeft = () => setLayout('left');
    const toBottom = () => setLayout('bottom');
    const openExt = () => setView('extensions');
    const openClass = () => window.dispatchEvent(new CustomEvent('bc:open-class'));
    const openAbout = () => setShowAbout(true);
    window.addEventListener('bc:set-layout', onSetLayout);
    window.addEventListener('menu:layout-left', toLeft);
    window.addEventListener('menu:layout-bottom', toBottom);
    window.addEventListener('menu:ext', openExt);
    window.addEventListener('menu:class-manager', openClass);
    window.addEventListener('menu:about', openAbout);
    const offs = [
      window.bc.onMenu('menu:layout-left', toLeft),
      window.bc.onMenu('menu:layout-bottom', toBottom),
      window.bc.onMenu('menu:ext', openExt),
      window.bc.onMenu('menu:class-manager', openClass),
      window.bc.onMenu('menu:about', openAbout)
    ];
    return () => {
      window.removeEventListener('bc:set-layout', onSetLayout);
      window.removeEventListener('menu:layout-left', toLeft);
      window.removeEventListener('menu:layout-bottom', toBottom);
      window.removeEventListener('menu:ext', openExt);
      window.removeEventListener('menu:class-manager', openClass);
      window.removeEventListener('menu:about', openAbout);
      offs.forEach((off) => off && off());
    };
  }, [setLayout, setView]);

  return (
    <div className="app">
      {view === 'extensions' ? (
        <ExtensionManager onBack={() => setView('editor')} />
      ) : (
        <>
      <Toolbar
        canvasWidth={canvasWidth}
        onCanvasWidthChange={setCanvasWidth}
        zoom={zoom}
        onZoomChange={setZoom}
      />
      <div className="workspace" data-layout={layout} style={{ '--bc-bottom-height': bottomHeight + 'px', '--bc-right-width': rightWidth + 'px', '--bc-left-width': leftWidth + 'px' } as React.CSSProperties}>
        <div className="elem-pane-wrap">
          <ErrorBoundary label="元素面板"><ElementPanel /></ErrorBoundary>
          {layout === 'left' && (
            <div className="panel-resizer panel-resizer-left"
              onMouseDown={(e) => startResize(e, 'left', setLeftWidth, LEFT_WIDTH_MIN, leftWidth)}>
              <div className="panel-resizer-handle" />
            </div>
          )}
        </div>
        <div className="canvas-area">
          <ErrorBoundary label="画布"><Canvas canvasWidth={canvasWidth} zoom={zoom} onZoomChange={applyZoom} onUserResize={(px) => setCanvasWidth(px + 'px')} /></ErrorBoundary>
          {layout === 'bottom' && (
            <div className="panel-resizer panel-resizer-horizontal"
              onMouseDown={(e) => startResize(e, 'bottom', setBottomHeight, BOTTOM_HEIGHT_MIN, bottomHeight)}>
              <div className="panel-resizer-handle" />
            </div>
          )}
        </div>
        <div className="right-pane-wrap">
          <div className="panel-resizer panel-resizer-vertical"
            onMouseDown={(e) => startResize(e, 'right', setRightWidth, RIGHT_WIDTH_MIN, rightWidth)}>
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

// 拖手：鼠标按下后全局监听 mousemove，按方向改 state；最小值约束；拖手位置贴面板边缘
// 光标按拖拽方向固定：bottom 用 ns-resize（竖向），left/right 用 col-resize（横向），
// 防止拖拽过程中在子元素上光标闪变。
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
  const vertical = dir === 'bottom'; // 竖向拖拽
  // 底部面板上限：不能超过工作区高度除留一条最小编辑区，否则按钮会冲出屏幕最下方
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
function useKeyboardShortcuts() {
  useEffect(() => {
    const triggerUndo = () => useScene.getState().undo();
    const triggerRedo = () => useScene.getState().redo();
    const triggerCopy = () => {
      const st = useScene.getState();
      if (st.scene.selectedIds.length > 0) st.copyMany(st.scene.selectedIds);
    };
    // 剪切 = 复制 + 删除（一条 undo）
    const triggerCut = () => {
      const st = useScene.getState();
      if (st.scene.selectedIds.length > 0) st.cutMany(st.scene.selectedIds);
    };
    const triggerPaste = () => {
      const st = useScene.getState();
      const id = st.scene.selectedId;
      if (!st.clipboard) return;
      st.pasteSibling(id);
    };
    const triggerDuplicate = () => {
      const st = useScene.getState();
      if (st.scene.selectedId) st.duplicateElement(st.scene.selectedId);
    };
    const triggerDelete = () => {
      const st = useScene.getState();
      if (st.scene.selectedIds.length > 0) st.removeMany(st.scene.selectedIds);
    };
    // Ctrl+A 全选：所有可见、未锁定的元素
    const triggerSelectAll = () => {
      const st = useScene.getState();
      const ids: string[] = [];
      const walk = (n: SceneElement) => {
        for (const c of n.children) {
          if (!c.hidden && !c.locked) ids.push(c.id);
          walk(c);
        }
      };
      walk(st.scene.root);
      st.selectMany(ids);
    };

    const onKey = (e: KeyboardEvent) => {
      // 编辑文字时不触发
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
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); triggerDelete(); return; }
      if (e.key === 'Escape') { e.preventDefault(); useScene.getState().selectElement(null); return; }
    };
    window.addEventListener('keydown', onKey);

    // 订阅菜单事件
    const offs = [
      window.bc.onMenu('menu:undo', triggerUndo),
      window.bc.onMenu('menu:redo', triggerRedo),
      window.bc.onMenu('menu:copy', triggerCopy),
      window.bc.onMenu('menu:cut', triggerCut),
      window.bc.onMenu('menu:paste', triggerPaste),
      window.bc.onMenu('menu:duplicate', triggerDuplicate),
      window.bc.onMenu('menu:delete', triggerDelete),
      window.bc.onMenu('menu:export-html', () => {
        // 触发导出（Toolbar 已有逻辑，这里复用同一做法）
        // 通过自定义事件让 Toolbar 自己处理，避免重复 logic
        window.dispatchEvent(new CustomEvent('bc:export-html'));
      }),
      window.bc.onMenu('menu:preview', () => {
        window.dispatchEvent(new CustomEvent('bc:preview'));
      })
    ];

    return () => {
      window.removeEventListener('keydown', onKey);
      offs.forEach((off) => off && off());
    };
  }, []);
}

// ============ 简易持久化 hook ============
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
