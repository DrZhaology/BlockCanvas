import { useEffect, useRef, useState, useMemo, Fragment } from 'react';
import { useScene } from '@store/sceneStore';
import { exportHTML, type ExportResult } from '@lib/exporter';
import type { SceneElement } from '@lib/types';
import { useToolbar, dockOf, getSortedItems, type ToolbarItem } from '@store/toolbarStore';
import { dragSteps } from '@lib/drag';
import { widthLabel, widthToDevice, DEVICE_LIST, requestDevice } from '@lib/device';
import { runHealthCheck, hasBlocking } from '@lib/healthCheck';
import { HealthWizard } from './HealthWizard';

// BlockCanvas · 顶部工具栏（全按钮自由池）
//
// 所有按钮（编辑操作 / 输出 / 轮廓 / 设备切换 / 缩放 / 体检 / 设置 / 插件命令）
// 全部注册进 toolbarStore，每个按钮有三个停靠区可选（设置 → 工具栏管理 里调整）：
//   · main  —— 主区：一条可横向滚动的流水线（细滚动条 + scroll-snap 吸附到按钮）
//   · right —— 右侧固定区：常驻的手边工具（默认：设备切换 / 缩放 / 体检 / 设置）
//   · more  —— 「⋯更多」下拉：不占工具栏位置，点开可用（= 隐藏）
// 顺序全局共享一份，跨区拖拽有效；显隐 / 停靠 / 顺序全部持久化。
// 插件通过 toolbarStore.addItem 注册的按钮同样参与停靠管理。

const ZOOM_MIN = 50;   // % 最小
const ZOOM_MAX = 200;  // % 最大

export function Toolbar({ canvasWidth, onCanvasWidthChange, zoom, onZoomChange }: {
  canvasWidth: string;
  onCanvasWidthChange: (v: string) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
}) {
  const scene = useScene((s) => s.scene);
  const clipboard = useScene((s) => s.clipboard);
  const [tips, setTips] = useState<string | null>(null);
  const tipsTimer = useRef(0);
  // 缩放：按住百分比拖拽 / 双击手输
  const [zoomDrag, setZoomDrag] = useState<{ startX: number; startPct: number } | null>(null);
  const [zoomEdit, setZoomEdit] = useState(false);
  const [zoomEditVal, setZoomEditVal] = useState('');
  // 「⋯ 更多」下拉开合
  const [moreOpen, setMoreOpen] = useState(false);
  // 「导出前体检」向导：点 ⚠ 直接打开；导出/预览前若存在严重问题会先拦一道
  const [healthOpen, setHealthOpen] = useState(false);
  const pendingAfterHealth = useRef<(() => void) | null>(null);
  const runWithHealthGuard = (fn: () => void) => {
    const res = runHealthCheck(useScene.getState().scene.root);
    if (hasBlocking(res)) {
      pendingAfterHealth.current = fn;
      setHealthOpen(true);
      return;
    }
    fn();
  };
  const finishHealth = () => {
    const fn = pendingAfterHealth.current;
    pendingAfterHealth.current = null;
    if (fn) fn();
  };

  // 元素轮廓可视化：开启后所有画布元素显示暗蓝 dotted 边框（仅编辑器可见，不导出）
  const [outlines, setOutlines] = useState<boolean>(() => {
    try { return localStorage.getItem('bc-outlines') === '1'; } catch { return false; }
  });
  useEffect(() => {
    document.body.classList.toggle('bc-outlines-on', outlines);
    try { localStorage.setItem('bc-outlines', outlines ? '1' : '0'); } catch { /* ignore */ }
    return () => document.body.classList.remove('bc-outlines-on');
  }, [outlines]);

  const items = useToolbar((s) => s.items);
  const docks = useToolbar((s) => s.docks);
  const userOrder = useToolbar((s) => s.order);
  const pct = Math.round(zoom * 100);
  const device = widthToDevice(canvasWidth);

  // 点「⋯ 更多」之外关闭下拉
  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (e.target instanceof Element && !e.target.closest('.tb-more-wrap')) setMoreOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  // ⚠ 角标：只统计"问题条数"，具体清单由「导出前体检」向导展示（同一套 healthCheck 逻辑）
  const issueCount = useMemo(
    () => runHealthCheck(scene.root).reduce((n, i) => n + (i.severity === 'info' ? 0 : 1), 0),
    [scene.root]
  );

  // 4-C：导出/预览后检查样式健康度，toast 提示不打断操作
  const showExportTips = (result: ExportResult) => {
    const parts: string[] = [];
    if (result.warnings.length > 0) {
      const first = result.warnings[0];
      const more = result.warnings.length - 1;
      parts.push(`样式提示 ${result.warnings.length} 处，如 ${first.selector}：${first.reason}${more > 0 ? ` 等 ${more} 处` : ''}`);
    }
    if (result.unclassified.length > 0) {
      parts.push(`${result.unclassified.length} 个元素还没有类名：选中它后在属性面板「+ 类名」回车即可`);
    }
    if (parts.length === 0) return;
    const msg = parts.join('；');
    setTips(msg);
    window.clearTimeout(tipsTimer.current);
    tipsTimer.current = window.setTimeout(() => setTips(null), 6000);
  };

  // —— 内建操作 ——
  const doExport = () => runWithHealthGuard(exportNow);
  const doPreview = () => runWithHealthGuard(previewNow);

  const exportNow = async () => {
    const result = exportHTML(useScene.getState().scene);
    const res = await window.bc.exportHTML(result.html, 'index.html');
    if (!res.ok && !res.canceled) {
      alert('导出失败：' + (res.error ?? '未知错误'));
    } else if (res.ok && res.path) {
      showExportTips(result);
      alert('✨ HTML 网页导出成功！\n\n文件保存路径：\n' + res.path);
    }
  };
  const previewNow = async () => {
    const result = exportHTML(useScene.getState().scene);
    const res = await window.bc.previewOpen(result.html);
    if (!res.ok) alert('预览失败：' + (res.error ?? '未知错误'));
    else showExportTips(result);
  };
  const doExportTemplate = async () => {
    const st = useScene.getState();
    const root = st.scene.root;
    const sel = st.scene.selectedId;
    if (!sel || sel === root.id) return;
    const el = findNodeBy(root, sel);
    if (!el || el.id === root.id) return;
    const tree = structuredClone(el);
    const fallbackName = (tree.attrs?.className?.trim() || tree.type || 'template') + '.json';
    const res = await window.bc.exportTemplateSingle(tree, fallbackName);
    if (res.canceled) return;
    if (res.ok) alert('模板已导出：\n' + res.path);
    else alert('导出失败：' + (res.error ?? '未知错误'));
  };

  type ToolbarOp = {
    id: string; label: () => string; title: string; cls: string;
    onClick: () => void; disabled?: () => boolean; dock?: 'main' | 'right';
  };

  // —— 全部内建按钮（注册进 toolbarStore，停靠默认值见 dock 字段）——
  const OPS: ToolbarOp[] = [
    {
      id: 'copy', cls: 'tb-btn-ghost', dock: 'main', label: () => {
        const n = useScene.getState().scene.selectedIds.length;
        return n > 1 ? `⧉ 复制(${n})` : '⧉ 复制';
      },
      title: '复制 (Ctrl+C)\n多选：复制全部选中元素',
      onClick: () => { const st = useScene.getState(); if (st.scene.selectedIds.length) st.copyMany(st.scene.selectedIds); },
      disabled: () => useScene.getState().scene.selectedIds.length === 0
    },
    {
      id: 'cut', cls: 'tb-btn-ghost', dock: 'main', label: () => {
        const n = useScene.getState().scene.selectedIds.length;
        return n > 1 ? `✂ 剪切(${n})` : '✂ 剪切';
      },
      title: '剪切 (Ctrl+X)\n多选：剪切全部选中元素',
      onClick: () => { const st = useScene.getState(); if (st.scene.selectedIds.length) st.cutMany(st.scene.selectedIds); },
      disabled: () => useScene.getState().scene.selectedIds.length === 0
    },
    {
      id: 'paste', cls: 'tb-btn-ghost', dock: 'main', label: () => {
        const n = useScene.getState().scene.selectedIds.length;
        return n > 1 ? `⎘ 粘贴(${n})` : '⎘ 粘贴';
      },
      title: '粘贴 (Ctrl+V) — 插入到当前选中元素内部（无选中时插到画布末尾）',
      onClick: () => { const st = useScene.getState(); st.paste(st.scene.selectedId); },
      disabled: () => clipboard === null
    },
    {
      id: 'duplicate', cls: 'tb-btn-ghost', dock: 'main', label: () => '📑 副本', title: '原地创建副本 (Ctrl+D)',
      onClick: () => { const st = useScene.getState(); if (st.scene.selectedId) st.duplicateElement(st.scene.selectedId); },
      disabled: () => !useScene.getState().scene.selectedId
    },
    {
      id: 'delete', cls: 'tb-btn-ghost toolbar-del', dock: 'main', label: () => {
        const n = useScene.getState().scene.selectedIds.length;
        return n > 1 ? `🗑 删除(${n})` : '🗑 删除';
      },
      title: '删除 (Delete) — 多选时批量删除',
      onClick: () => { const st = useScene.getState(); if (st.scene.selectedIds.length) st.removeMany(st.scene.selectedIds); },
      disabled: () => useScene.getState().scene.selectedIds.length === 0
    },
    { id: 'preview', cls: 'tb-btn-ghost', dock: 'main', label: () => '▶ 预览', title: '在默认浏览器中预览 (Ctrl+P)', onClick: doPreview },
    { id: 'export-html', cls: 'tb-btn-primary', dock: 'main', label: () => '⬇ 导出 HTML', title: '导出 HTML 网页文件 (Ctrl+E)', onClick: doExport },
    {
      id: 'projects-center', cls: 'tb-btn-ghost', dock: 'main', label: () => '📁 全部项目',
      title: '浏览全部本地项目库与专属快照备份',
      onClick: () => window.dispatchEvent(new CustomEvent('bc:open-projects'))
    },
    {
      id: 'export-template', cls: 'tb-btn-ghost', dock: 'main', label: () => '🔖 导出元素模板',
      title: '把选中元素（含子级）导出为模板 JSON 文件',
      onClick: doExportTemplate,
      disabled: () => {
        const st = useScene.getState();
        return !st.scene.selectedId || st.scene.selectedId === st.scene.root.id;
      }
    },
    {
      id: 'clear-selection', cls: 'tb-btn-ghost', dock: 'main', label: () => '取消选中', title: '取消选中 (Esc)',
      onClick: () => useScene.getState().selectElement(null),
      disabled: () => !useScene.getState().scene.selectedId
    },
    {
      id: 'outline', cls: 'tb-btn-ghost tb-outline-btn', dock: 'main', label: () => '⬚ 轮廓',
      title: '显示元素轮廓：给画布所有元素加暗蓝色虚线框，方便看清 div 占位与嵌套；只是程序里的可视化辅助，导出的 HTML 不含',
      onClick: () => setOutlines((v) => !v)
    },
    {
      id: 'settings-entry', cls: 'tb-btn-icon', dock: 'right', label: () => '⚙',
      title: '偏好设置 (Ctrl+,)',
      onClick: () => window.dispatchEvent(new CustomEvent('bc:open-settings'))
    }
  ];

  // 块级组件（设备切换 / 缩放 / 体检）的默认停靠
  const BLOCKS: { id: string; label: string; order: number; dock: 'right' }[] = [
    { id: 'blk.device', label: '设备切换', order: 60, dock: 'right' },
    { id: 'blk.zoom', label: '缩放', order: 62, dock: 'right' },
    { id: 'blk.clsid', label: '导出前体检', order: 64, dock: 'right' }
  ];

  const opMap = useMemo(() => {
    const m = new Map<string, ToolbarOp>();
    for (const o of OPS) m.set(o.id, o);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 注册全部按钮（每次挂载执行一次；重复注册会原地刷新，停靠/顺序记忆不受影响）
  useEffect(() => {
    const orderOf: Record<string, number> = {
      'copy': 10, 'cut': 12, 'paste': 14, 'duplicate': 16, 'delete': 18,
      'preview': 30, 'export-html': 32, 'projects-center': 34,
      'export-template': 36, 'clear-selection': 38, 'outline': 40,
      'settings-entry': 66
    };
    const st = useToolbar.getState();
    for (const o of OPS) {
      st.addItem({
        id: o.id, label: o.label, title: o.title, cls: o.cls,
        order: orderOf[o.id] ?? 50,
        defaultDock: o.dock ?? 'main',
        defaultVisible: true
      });
    }
    for (const b of BLOCKS) {
      st.addItem({ id: b.id, label: b.label, block: true, order: b.order, defaultDock: b.dock, defaultVisible: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 画布宽度：自定义像素值显示在设备条上
  const WIDTH_OPTIONS = ['auto', '1440px', '768px', '375px'];
  const customWidth = canvasWidth !== 'auto' && !WIDTH_OPTIONS.includes(canvasWidth) ? canvasWidth : null;

  // —— 缩放：按住百分比左右拖拽（阻尼，最小 1%）——
  const zoomAccRef = useRef(0);
  const startZoomDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setZoomDrag({ startX: e.clientX, startPct: pct });
    zoomAccRef.current = 0;
    document.body.classList.add('bc-zoom-dragging');
    try {
      const el = e.currentTarget as unknown as { requestPointerLock?: () => unknown };
      if (typeof el.requestPointerLock === 'function') {
        const r = el.requestPointerLock();
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { /* CSS 兜底 */ });
      }
    } catch { /* CSS 兜底 */ }
  };
  const moveZoomDrag = (e: React.PointerEvent) => {
    if (!zoomDrag) return;
    const dx = document.pointerLockElement
      ? Math.round((zoomAccRef.current += e.movementX || 0))
      : e.clientX - zoomDrag.startX;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomDrag.startPct + dragSteps(dx)));
    onZoomChange(next / 100);
  };
  const endZoomDrag = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
    setZoomDrag(null);
    document.body.classList.remove('bc-zoom-dragging');
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* ignore */ }
  };
  const applyZoomEdit = () => {
    setZoomEdit(false);
    const n = parseInt(zoomEditVal, 10);
    if (Number.isNaN(n)) return;
    onZoomChange(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) / 100);
  };

  // —— 块级渲染 ——
  const widgetMap: Record<string, React.ReactNode> = {
    // 设备切换：无外框分段（纯胶囊高亮，不再框中框）
    'blk.device': (
      <div className="tb-block tb-device" title="设备断点：切换会同时改变画布宽度与编辑断点（也可拖动画布左右边缘自定义宽度）">
        <div className="tb-bp-seg">
          <button
            className={'tb-bp-btn' + (canvasWidth === 'auto' ? ' active' : '')}
            onClick={() => onCanvasWidthChange('auto')}
            title="自适应：画布铺满编辑区，适合日常编辑"
          >↔ 自适应</button>
          {DEVICE_LIST.map((d) => (
            <button
              key={d.id}
              className={'tb-bp-btn' + (canvasWidth !== 'auto' && device === d.id ? ' active' : '')}
              onClick={() => requestDevice(d.id)}
              title={d.hint}
            >{d.icon}{d.label}</button>
          ))}
        </div>
        <span className="tb-bp-width" title="当前画布宽度">
          {customWidth ? `自定义 ${widthLabel(customWidth)}` : widthLabel(canvasWidth)}
        </span>
      </div>
    ),
    // 缩放：拖百分比 / 双击手输；归位按钮只在偏离 100% 时出现
    'blk.zoom': (
      <div className="tb-zoom" title="按住百分比左右拖动缩放画布（最小 50%）；双击手输数值；Ctrl+滚轮亦可">
        {zoomEdit ? (
          <input
            className="tb-zoom-input"
            value={zoomEditVal}
            autoFocus
            onChange={(e) => setZoomEditVal(e.target.value)}
            onBlur={applyZoomEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyZoomEdit();
              if (e.key === 'Escape') setZoomEdit(false);
            }}
          />
        ) : (
          <span
            className={"tb-zoom-drag" + (zoomDrag ? ' dragging' : '')}
            onPointerDown={startZoomDrag}
            onPointerMove={moveZoomDrag}
            onPointerUp={endZoomDrag}
            onPointerCancel={endZoomDrag}
            onDoubleClick={() => { setZoomEdit(true); setZoomEditVal(String(pct)); }}
          >{pct}%</span>
        )}
        {zoom !== 1 && (
          <button className="tb-zoom-reset" onClick={() => onZoomChange(1)} title="恢复 100% 显示">⟲</button>
        )}
      </div>
    ),
    // 导出前体检
    'blk.clsid': (
      <button
        className={"tb-health-btn" + (issueCount > 0 ? ' has-issue' : '')}
        onClick={() => setHealthOpen(true)}
        title="导出前体检：未命名元素、重复 ID、伪类失效、同名样式不统一……按严重度列出并支持一键修复"
      >⚠{issueCount > 0 && <span className="tb-health-badge">{issueCount}</span>}</button>
    )
  };

  // 按全局排序渲染一个 item（块 / 内建按钮 / 插件按钮）
  const renderItem = (it: ToolbarItem) => {
    if (it.block) return <Fragment key={it.id}>{widgetMap[it.id] ?? null}</Fragment>;
    const op = opMap.get(it.id);
    if (op) {
      return (
        <button
          key={it.id}
          className={op.cls + (it.id === 'outline' && outlines ? ' active' : '')}
          title={op.title}
          onClick={op.onClick}
          disabled={op.disabled ? op.disabled() : false}
        >{op.label()}</button>
      );
    }
    // 插件按钮（label 支持函数 → 插件重注册时自动刷新状态文字）
    return (
      <button
        key={it.id}
        className={it.cls || 'tb-btn-ghost'}
        title={it.title}
        onClick={it.onClick}
        disabled={it.disabled ? it.disabled() : false}
      >{it.icon && <span className="tb-icon">{it.icon}</span>}{typeof it.label === 'function' ? it.label() : it.label}</button>
    );
  };

  // —— 三区分配：全局一个顺序，按 dock 分流 ——
  const sorted = useMemo(() => getSortedItems(items, userOrder), [items, userOrder]);
  const mainItems = useMemo(() => sorted.filter((it) => dockOf(it, docks) === 'main'), [sorted, docks]);
  const rightItems = useMemo(() => sorted.filter((it) => dockOf(it, docks) === 'right'), [sorted, docks]);
  const moreItems = useMemo(() => sorted.filter((it) => dockOf(it, docks) === 'more'), [sorted, docks]);

  // 选中变化 → 刷新禁用态（复制/粘贴等按钮的 disabled 是渲染时求值的）
  useScene((s) => s.scene.selectedIds.length);

  // 接收菜单"导出/预览"事件（固定按钮已含，事件兜底）
  useEffect(() => {
    const h = () => doExport();
    window.addEventListener('bc:export-html', h);
    const ph = () => doPreview();
    window.addEventListener('bc:preview', ph);
    return () => { window.removeEventListener('bc:export-html', h); window.removeEventListener('bc:preview', ph); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="toolbar">
      {/* —— 主区：可滚动流水线 —— */}
      <div className="tb-main" title="工具按钮：放不下时可左右滚动（自动对齐按钮）；在「设置 → 工具栏管理」里可自由调整">
        {mainItems.map(renderItem)}
      </div>

      {/* —— 右侧固定区 —— */}
      <div className="tb-right">
        {rightItems.map(renderItem)}

        {/* 「⋯ 更多」：收纳停靠为 more 的按钮 */}
        {moreItems.length > 0 && (
          <div className="tb-more-wrap">
            <button className="tb-more-btn" title={`还有 ${moreItems.length} 个按钮收在这里`} onClick={() => setMoreOpen((o) => !o)}>
              ⋯
            </button>
            {moreOpen && (
              <div className="tb-more-pop">
                {moreItems.map((it) => (
                  <button
                    key={it.id}
                    className="tb-more-item"
                    title={it.title}
                    onClick={() => { if (!it.block) it.onClick?.(); setMoreOpen(false); }}
                  >{it.icon && <span className="tb-icon">{it.icon}</span>}{typeof it.label === 'function' ? it.label() : it.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {tips && <div className="export-tips">{tips}</div>}

      {/* 导出前体检向导（Portal 到 body，不受工具栏高度限制） */}
      <HealthWizard
        open={healthOpen}
        onClose={() => { setHealthOpen(false); pendingAfterHealth.current = null; }}
        onFinish={finishHealth}
        finishLabel="继续"
      />
    </div>
  );
}

function findNodeBy(root: SceneElement, id: string): SceneElement | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const r = findNodeBy(c, id);
    if (r) return r;
  }
  return null;
}
