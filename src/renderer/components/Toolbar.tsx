import { useEffect, useRef, useState, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useScene } from '@store/sceneStore';
import { exportHTML, type ExportResult } from '@lib/exporter';
import type { SceneElement } from '@lib/types';
import {
  useToolbar, dockOf, getSortedItems,
  type ToolbarItem, type ToolbarDock, type ToolbarGroup
} from '@store/toolbarStore';
import { dragSteps } from '@lib/drag';
import { widthLabel, widthToDevice, DEVICE_LIST, requestDevice } from '@lib/device';
import { runHealthCheck, hasBlocking } from '@lib/healthCheck';
import { HealthWizard } from './HealthWizard';

// BlockCanvas · 顶部工具栏（全按钮自由池 + 二级工具组）
//
// 所有按钮（编辑操作 / 输出 / 轮廓 / 设备切换 / 缩放 / 体检 / 插件命令）
// 全部注册进 toolbarStore，每个按钮有三个停靠区可选（设置 → 工具栏管理 里调整）：
//   · main  —— 主区：一条可横向滚动的流水线（细滚动条；竖向滚轮即可左右滚）
//   · right —— 右侧固定区：常驻的手边工具（同样可横向滚动、可放工具组）
//   · more  —— 「⋯更多」下拉：不占工具栏位置，点开可用（= 隐藏）
//
// v0.4.2 新增「二级工具组」：把若干按钮打包成一个组按钮，鼠标悬浮在组按钮上
// 即展开组内工具（弹出面板通过 Portal 渲染到 body，不会被工具栏横向滚动区裁切）。
// 默认出厂已把「剪切/复制/粘贴」折成「剪贴板」组、「电脑/平板/手机」折成「设备」组。
// 顺序全局共享一份，跨区拖拽有效；显隐 / 停靠 / 顺序 / 分组全部持久化。

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
  const groups = useToolbar((s) => s.groups);
  const pct = Math.round(zoom * 100);
  const device = widthToDevice(canvasWidth);
  // 「⋯ 更多」按钮锚点（弹出面板走 Portal，不会被工具栏横向滚动区裁切）
  const moreWrapRef = useRef<HTMLDivElement>(null);

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
      'export-template': 36, 'clear-selection': 38, 'outline': 40
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

  // —— 分组查找表 + 三区分配 ——
  const sorted = useMemo(() => getSortedItems(items, userOrder), [items, userOrder]);
  const groupByItem = useMemo(() => {
    const m = new Map<string, ToolbarGroup>();
    for (const g of groups) for (const id of g.itemIds) m.set(id, g);
    return m;
  }, [groups]);

  // 组内成员的最终停靠跟随「组」；独立按钮用自身 dock
  const placementOf = (it: ToolbarItem): ToolbarDock => {
    const g = groupByItem.get(it.id);
    return g ? g.dock : dockOf(it, docks);
  };
  const visibleItems = useMemo(() => sorted.filter((it) => placementOf(it) !== 'more'), [sorted, docks, groupByItem]);
  const mainItems = useMemo(() => visibleItems.filter((it) => placementOf(it) === 'main'), [visibleItems, docks, groupByItem]);
  const rightItems = useMemo(() => visibleItems.filter((it) => placementOf(it) === 'right'), [visibleItems, docks, groupByItem]);
  const moreItems = useMemo(() => sorted.filter((it) => placementOf(it) === 'more'), [sorted, docks, groupByItem]);

  // 把一个停靠区的 item 序列渲染出来：组内成员折叠成一个组按钮（位置取组内第一个成员）
  const renderArea = (list: ToolbarItem[]) => {
    const done = new Set<string>();
    const nodes: React.ReactNode[] = [];
    for (const it of list) {
      const g = groupByItem.get(it.id);
      if (!g) { nodes.push(renderItem(it)); continue; }
      if (done.has(g.id)) continue;
      done.add(g.id);
      const members = list.filter((x) => groupByItem.get(x.id)?.id === g.id);
      if (members.length === 0) continue;
      nodes.push(<ToolbarGroupButton key={g.id} group={g} members={members} renderItem={renderItem} />);
    }
    return nodes;
  };

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
      {/* —— 主区：可滚动流水线（竖向滚轮直接左右滚） —— */}
      <div className="tb-main bc-hscroll" title="工具按钮：放不下时可左右滚动（滚轮直接左右滚，不必按 Shift）；在「设置 → 工具栏管理」里可自由调整 / 分组">
        {renderArea(mainItems)}
      </div>

      {/* —— 右侧固定区：常驻手边工具（空间不够时同样可左右滚动） —— */}
      <div className="tb-right bc-hscroll">
        {renderArea(rightItems)}

        {/* 「⋯ 更多」：收纳停靠为 more 的按钮 */}
        {moreItems.length > 0 && (
          <div className="tb-more-wrap" ref={moreWrapRef}>
            <button className="tb-more-btn" title={`还有 ${moreItems.length} 个按钮收在这里`} onClick={() => setMoreOpen((o) => !o)}>
              ⋯
            </button>
            <AnchoredPanel
              open={moreOpen}
              anchorRef={moreWrapRef}
              onClose={() => setMoreOpen(false)}
              className="tb-more-panel"
              align="right"
            >
              {moreItems.map((it) => (
                <button
                  key={it.id}
                  className="tb-more-item"
                  title={it.title}
                  onClick={() => { if (!it.block) it.onClick?.(); setMoreOpen(false); }}
                >{it.icon && <span className="tb-icon">{it.icon}</span>}{typeof it.label === 'function' ? it.label() : it.label}</button>
              ))}
            </AnchoredPanel>
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

// ============ 通用「锚点弹出面板」 ============
// 弹出内容 Portal 到 body 用 fixed 定位，因此不受工具栏横向滚动区 overflow 裁切；
// 统一处理：外部点击 / Esc / 滚动 / 缩放 关闭，并在靠近屏幕底部时自动向上翻转。
function AnchoredPanel(props: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  align?: 'left' | 'right';
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: React.ReactNode;
}) {
  const { open, anchorRef, onClose, className, align = 'left', onMouseEnter, onMouseLeave, children } = props;
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const panelW = 360;
      const rawLeft = align === 'right' ? r.right - panelW : r.left;
      const left = Math.min(Math.max(8, rawLeft), Math.max(8, window.innerWidth - panelW - 8));
      const below = r.bottom + 240 < window.innerHeight;
      setPos({ left, top: below ? r.bottom + 6 : r.top - 6, below });
    };
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target;
      if (t instanceof Element && (anchorRef.current?.contains(t) || t.closest('.tb-anchored-panel'))) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    const onScroll = () => closeRef.current();
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchorRef, align]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      className={'tb-anchor-pos' + (pos.below ? '' : ' above')}
      style={{ left: pos.left, top: pos.top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* 带上 toolbar 类名 → 复用工具栏里那套按钮语言（ghost/soft/primary/icon 与设备分段等） */}
      <div className={'toolbar tb-anchored-panel ' + (className ?? '')}>{children}</div>
    </div>,
    document.body
  );
}

// ============ 二级工具组：悬浮展开组内工具 ============
// 组按钮本身只占一个位置；鼠标浮上去弹出组内工具（走 AnchoredPanel → Portal 到 body）。
// 带开合延迟，避免鼠标扫过时乱闪。
function ToolbarGroupButton(props: {
  group: ToolbarGroup;
  members: ToolbarItem[];
  renderItem: (it: ToolbarItem) => React.ReactNode;
}) {
  const { group, members, renderItem } = props;
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const openTimer = useRef(0);
  const closeTimer = useRef(0);

  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  const scheduleOpen = () => {
    clearTimers();
    openTimer.current = window.setTimeout(() => setOpen(true), 80);
  };
  const scheduleClose = () => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => setOpen(false), 220);
  };

  useEffect(() => () => clearTimers(), []);

  return (
    <div className="tb-grp" onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose}>
      <button
        ref={btnRef}
        className={'tb-grp-btn' + (open ? ' open' : '')}
        title={`${group.label}：鼠标浮上来展开组内 ${members.length} 个工具`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="tb-grp-ico">{group.icon ?? '▦'}</span>
        <span className="tb-grp-label">{group.label}</span>
        <span className="tb-grp-caret">▾</span>
      </button>
      <AnchoredPanel
        open={open}
        anchorRef={btnRef}
        onClose={() => setOpen(false)}
        className="tb-grp-panel"
        onMouseEnter={clearTimers}
        onMouseLeave={scheduleClose}
      >
        <div className="tb-grp-pop-title">
          <span className="tb-grp-ico">{group.icon ?? '▦'}</span>{group.label}
          <span className="tb-grp-pop-count">{members.length} 个工具</span>
        </div>
        <div className="tb-grp-pop-body bc-hscroll">{members.map(renderItem)}</div>
      </AnchoredPanel>
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
