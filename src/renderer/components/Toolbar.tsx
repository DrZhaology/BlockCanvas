import { useEffect, useRef, useState, useMemo, Fragment } from 'react';
import { useScene } from '@store/sceneStore';
import { exportHTML, type ExportResult } from '@lib/exporter';
import { styleToCssText, simplifyStyle } from '@lib/styleClass';
import type { SceneElement } from '@lib/types';
import { useToolbar, isVisibleOnBar, type ToolbarItem } from '@store/toolbarStore';
import { dragSteps } from '@lib/drag';
import { widthLabel } from '@lib/device';

// BlockCanvas · 顶部工具栏
// v0.4.1 重排：按「编辑 → 视图 → 检查 → 输出」四段式分组，段间用细分隔线明确界限，
// 按钮统一为同一套尺寸与配色（只有「导出 HTML」是主按钮），设置收敛为图标按钮靠最右。
// 左侧固定操作组不可改；右侧按 toolbarStore 的 order / visible 渲染（设置页可管理显隐）。

const ZOOM_MIN = 50;   // % 最小
const ZOOM_MAX = 200;  // % 最大

// 分组定义：id 对应 toolbarStore 里的 item id
const GROUPS: Array<{ key: string; ids: string[] }> = [
  { key: 'edit', ids: ['copy', 'cut', 'paste', 'duplicate', 'delete'] },
  { key: 'view', ids: ['blk.device', 'blk.zoom', 'outline'] },
  { key: 'inspect', ids: ['blk.clsid', 'export-template', 'clear-selection'] },
  { key: 'output', ids: ['preview', 'projects-center', 'export-html', 'settings-entry'] }
];

// 注册进 toolbarStore 的块级组件（渲染由 widgetMap 提供）
const BLOCKS: { id: string; label: string; order: number }[] = [
  { id: 'blk.device', label: '设备 / 画布宽度', order: 60 },
  { id: 'blk.zoom', label: '缩放', order: 70 },
  { id: 'blk.clsid', label: '类名/ID 检查', order: 80 }
];

export function Toolbar({ canvasWidth, onCanvasWidthChange, zoom, onZoomChange }: {
  canvasWidth: string;
  onCanvasWidthChange: (v: string) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
}) {
  const scene = useScene((s) => s.scene);
  const [tips, setTips] = useState<string | null>(null);
  const tipsTimer = useRef(0);
  // ⚠ 问题面板开合
  const [issuesOpen, setIssuesOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  // 缩放：按住百分比拖拽 / 双击手输
  const [zoomDrag, setZoomDrag] = useState<{ startX: number; startPct: number } | null>(null);
  const [zoomEdit, setZoomEdit] = useState(false);
  const [zoomEditVal, setZoomEditVal] = useState('');
  // 「⋯ 更多」下拉开合（只收纳插件命令）
  const [moreOpen, setMoreOpen] = useState(false);
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
  const visible = useToolbar((s) => s.visible);
  const itemMap = useMemo(() => {
    const m = new Map<string, ToolbarItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);
  const pluginItems = useMemo(
    () => [...items].filter((it) => it.id.startsWith('plg.')).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    [items]
  );
  const pct = Math.round(zoom * 100);

  // 点「⋯ 更多」之外关闭下拉
  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (e.target instanceof Element && !e.target.closest('.tb-more-wrap')) setMoreOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  // 4-F：扫描整棵树的样式健康问题（重新渲染时重算）
  const issues = useMemo(() => {
    const unnamed: { id: string; type: string }[] = [];
    const dupIds: { name: string; ids: string[] }[] = [];
    const conflicts: { name: string; count: number }[] = [];
    const clsStyles = new Map<string, string[]>();
    const idOwner = new Map<string, string[]>();
    const walk = (n: SceneElement): void => {
      if (n.id !== scene.root.id) {
        const cls = (n.attrs?.className ?? '').trim();
        const idv = (n.attrs?.id ?? '').trim();
        const rel = (n.attrs?.relSelector ?? '').trim();
        if (rel) {
          const list = clsStyles.get(rel) ?? [];
          list.push(styleToCssText(simplifyStyle(n.style)));
          clsStyles.set(rel, list);
        } else if (cls) {
          const list = clsStyles.get(cls) ?? [];
          list.push(styleToCssText(simplifyStyle(n.style)));
          clsStyles.set(cls, list);
        } else if (!idv) {
          unnamed.push({ id: n.id, type: n.type });
        }
        if (idv) {
          const list = idOwner.get(idv) ?? [];
          list.push(n.id);
          idOwner.set(idv, list);
        }
      }
      for (const c of n.children) walk(c);
    };
    walk(scene.root);
    for (const [name, list] of clsStyles) {
      if (new Set(list).size > 1) conflicts.push({ name, count: list.length });
    }
    for (const [name, ids] of idOwner) {
      if (ids.length > 1) dupIds.push({ name, ids });
    }
    return { unnamed, dupIds, conflicts, total: unnamed.length + dupIds.length + conflicts.length };
  }, [scene.root]);

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
  const doExport = async () => {
    const result = exportHTML(useScene.getState().scene);
    const res = await window.bc.exportHTML(result.html, 'index.html');
    if (!res.ok && !res.canceled) {
      alert('导出失败：' + (res.error ?? '未知错误'));
    } else if (res.ok && res.path) {
      showExportTips(result);
      alert('✨ HTML 网页导出成功！\n\n文件保存路径：\n' + res.path);
    }
  };
  const doPreview = async () => {
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

  // —— 全部按钮操作（统一注册进 toolbarStore，设置页可管理显隐）——
  type ToolbarOp = {
    id: string; label: () => string; title: string; cls: string;
    onClick: () => void; disabled?: () => boolean;
  };

  const OPS: ToolbarOp[] = [
    // —— 编辑组 ——
    {
      id: 'copy', cls: 'tb-btn-ghost',
      label: () => { const n = useScene.getState().scene.selectedIds.length; return '⧉ 复制' + (n > 1 ? `(${n})` : ''); },
      title: '复制 (Ctrl+C)\n多选：复制全部选中元素',
      onClick: () => { const st = useScene.getState(); if (st.scene.selectedIds.length) st.copyMany(st.scene.selectedIds); },
      disabled: () => useScene.getState().scene.selectedIds.length === 0
    },
    {
      id: 'cut', cls: 'tb-btn-ghost',
      label: () => { const n = useScene.getState().scene.selectedIds.length; return '✂ 剪切' + (n > 1 ? `(${n})` : ''); },
      title: '剪切 (Ctrl+X)\n多选：剪切全部选中元素',
      onClick: () => { const st = useScene.getState(); if (st.scene.selectedIds.length) st.cutMany(st.scene.selectedIds); },
      disabled: () => useScene.getState().scene.selectedIds.length === 0
    },
    {
      id: 'paste', cls: 'tb-btn-ghost',
      label: () => { const n = useScene.getState().scene.selectedIds.length; return '⎘ 粘贴' + (n > 1 ? `(${n})` : ''); },
      title: '粘贴 (Ctrl+V) — 插入到当前选中元素内部（无选中时插到画布末尾）',
      onClick: () => { const st = useScene.getState(); st.paste(st.scene.selectedId); },
      disabled: () => useScene.getState().clipboard === null
    },
    {
      id: 'duplicate', cls: 'tb-btn-ghost',
      label: () => '📑 副本', title: '原地创建副本 (Ctrl+D)',
      onClick: () => { const st = useScene.getState(); if (st.scene.selectedId) st.duplicateElement(st.scene.selectedId); },
      disabled: () => !useScene.getState().scene.selectedId
    },
    {
      id: 'delete', cls: 'tb-btn-ghost toolbar-del',
      label: () => { const n = useScene.getState().scene.selectedIds.length; return '🗑 删除' + (n > 1 ? `(${n})` : ''); },
      title: '删除 (Delete) — 多选时批量删除',
      onClick: () => { const st = useScene.getState(); if (st.scene.selectedIds.length) st.removeMany(st.scene.selectedIds); },
      disabled: () => useScene.getState().scene.selectedIds.length === 0
    },
    // —— 检查组 ——
    {
      id: 'export-template', cls: 'tb-btn-ghost',
      label: () => '🔖 导出元素模板', title: '把选中元素（含子级）导出为模板 JSON 文件',
      onClick: doExportTemplate,
      disabled: () => {
        const st = useScene.getState();
        return !st.scene.selectedId || st.scene.selectedId === st.scene.root.id;
      }
    },
    {
      id: 'clear-selection', cls: 'tb-btn-ghost',
      label: () => '取消选中', title: '取消选中 (Esc)',
      onClick: () => useScene.getState().selectElement(null),
      disabled: () => !useScene.getState().scene.selectedId
    },
    // —— 输出组 ——
    { id: 'preview', cls: 'tb-btn-ghost', label: () => '▶ 预览', title: '在默认浏览器中预览 (Ctrl+P)', onClick: doPreview },
    {
      id: 'projects-center', cls: 'tb-btn-soft', label: () => '📁 全部项目',
      title: '浏览全部本地项目库与专属快照备份',
      onClick: () => window.dispatchEvent(new CustomEvent('bc:open-projects'))
    },
    { id: 'export-html', cls: 'tb-btn-primary', label: () => '⬇ 导出 HTML', title: '导出 HTML 网页文件 (Ctrl+E)', onClick: doExport },
    {
      id: 'settings-entry', cls: 'tb-btn-icon', label: () => '⚙', title: '偏好设置 (Ctrl+,)',
      onClick: () => window.dispatchEvent(new CustomEvent('bc:open-settings'))
    }
  ];

  const opMap = useMemo(() => {
    const m = new Map<string, ToolbarOp>();
    for (const o of OPS) m.set(o.id, o);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // —— 注册右侧动态区的项（顺序与分组由 GROUPS 决定，这里只提供显隐默认值） ——
  useEffect(() => {
    const orderOf: Record<string, number> = {
      'export-template': 82,
      'clear-selection': 84,
      'outline': 74,
      'preview': 90,
      'projects-center': 92,
      'export-html': 94,
      'settings-entry': 96,
      'copy': 10, 'cut': 12, 'paste': 14, 'duplicate': 16, 'delete': 18
    };
    const reg: ToolbarItem[] = OPS.map((o) => ({
      id: o.id,
      label: o.label,
      title: o.title,
      order: orderOf[o.id] ?? 50,
      defaultVisible: true,
      cls: o.cls
    }));
    for (const it of reg) useToolbar.getState().addItem(it);
    for (const b of BLOCKS) {
      useToolbar.getState().addItem({ id: b.id, label: b.label, block: true, order: b.order, defaultVisible: true });
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

  // —— 各「块」的可变渲染 ——
  const widgetMap: Record<string, React.ReactNode> = {
    'blk.device': (
      <div className="tb-block tb-device" title="画布宽度：自适应 = 铺满编辑区；也可拖动画布左右边缘自定义。设备切换在画布顶部的设备条上">
        <span className="tb-block-label">画布</span>
        <select
          className="tb-width-select"
          value={customWidth ? 'custom' : canvasWidth}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'custom') return;
            onCanvasWidthChange(v);
          }}
        >
          {customWidth && <option value="custom">📏 自定义 {widthLabel(customWidth)}</option>}
          <option value="auto">自适应窗口</option>
          <option value="1440px">桌面 1440px</option>
          <option value="768px">平板 768px</option>
          <option value="375px">手机 375px</option>
        </select>
      </div>
    ),
    'blk.zoom': (
      <div className="tb-block tb-zoom" title="按住百分比左右拖动缩放画布（最小 1%）；双击手输数值；Ctrl+滚轮亦可">
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
        <button className="tb-zoom-reset" disabled={zoom === 1} onClick={() => onZoomChange(1)} title={zoom === 1 ? '当前已是 100%' : '恢复 100% 显示'}>⟲ 归位</button>
      </div>
    ),
    'blk.clsid': (
      <div className="issue-wrap" ref={popRef}>
        <button className={"issue-btn" + (issues.total > 0 ? ' has-issue' : '')} onClick={() => setIssuesOpen(!issuesOpen)} title="类名 / ID 问题：未命名（用行内样式）、重复 ID、同名样式不统一">
          ⚠{issues.total > 0 && <span className="issue-badge">{issues.total}</span>}
        </button>
        {issuesOpen && (
          <div className="issue-pop">
            <div className="issue-pop-title">类名 / ID 问题</div>
            {issues.unnamed.length > 0 && (
              <div className="issue-block">
                <div className="issue-block-head">{issues.unnamed.length} 个元素未设置类名 / ID（样式将用行内方式）</div>
                {issues.unnamed.slice(0, 8).map((u) => (
                  <button key={u.id} className="issue-item" onClick={() => { useScene.getState().selectElement(u.id); setIssuesOpen(false); window.dispatchEvent(new CustomEvent('bc:reveal-element', { detail: u.id })); }}>&lt;{u.type}&gt; 点此选中</button>
                ))}
                {issues.unnamed.length > 8 && <div className="issue-more">…还有 {issues.unnamed.length - 8} 个</div>}
              </div>
            )}
            {issues.conflicts.length > 0 && (
              <div className="issue-block">
                <div className="issue-block-head">{issues.conflicts.length} 个名称样式不统一（可在「类名」页签一键统一）</div>
                {issues.conflicts.map((c) => (
                  <button key={c.name} className="issue-item" onClick={() => { window.dispatchEvent(new CustomEvent('bc:open-class')); setIssuesOpen(false); }}>.{c.name}（{c.count} 个元素）→ 去统一</button>
                ))}
              </div>
            )}
            {issues.dupIds.length > 0 && (
              <div className="issue-block">
                <div className="issue-block-head">{issues.dupIds.length} 个 ID 重复使用</div>
                {issues.dupIds.map((d) => (
                  <button key={d.name} className="issue-item" onClick={() => { useScene.getState().selectElement(d.ids[1]); window.dispatchEvent(new CustomEvent('bc:reveal-element', { detail: d.ids[1] })); setIssuesOpen(false); }}>#{d.name} 重复 → 点此选中第二个</button>
                ))}
              </div>
            )}
            {issues.total === 0 && <div className="hint" style={{ margin: 8 }}>一切健康：所有元素都有类名 / ID，且同名样式统一。</div>}
            <button className="issue-go-cls" onClick={() => { window.dispatchEvent(new CustomEvent('bc:open-class')); setIssuesOpen(false); }}>打开「类名 / ID 总览」→</button>
          </div>
        )}
      </div>
    )
  };

  // 接收菜单"导出/预览"事件（固定按钮已含，事件兜底）
  useEffect(() => {
    const h = () => doExport();
    window.addEventListener('bc:export-html', h);
    const ph = () => doPreview();
    window.addEventListener('bc:preview', ph);
    return () => { window.removeEventListener('bc:export-html', h); window.removeEventListener('bc:preview', ph); };
  }, []);

  // 点击面板外关闭 ⚠
  useEffect(() => {
    if (!issuesOpen) return;
    const onDoc = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setIssuesOpen(false); };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [issuesOpen]);

  // 分组渲染：每个 item 先查 store 是否可见，再决定渲染成块 / 按钮 / 局部按钮
  const renderItem = (id: string) => {
    if (id === 'outline') {
      return (
        <button
          key={id}
          className={'tb-btn-ghost tb-outline-btn' + (outlines ? ' active' : '')}
          onClick={() => setOutlines((v) => !v)}
          title="显示元素轮廓：给画布所有元素加暗蓝色虚线框，方便看清 div 占位与嵌套；只是程序里的可视化辅助，导出的 HTML 不含"
        >⬚ 轮廓</button>
      );
    }
    const it = itemMap.get(id);
    if (it) {
      if (!isVisibleOnBar(it, visible)) return null;
      if (it.block) return <Fragment key={id}>{widgetMap[id]}</Fragment>;
    }
    const op = opMap.get(id);
    if (!op) return null;
    return (
      <button
        key={id}
        className={op.cls}
        title={op.title}
        onClick={op.onClick}
        disabled={op.disabled ? op.disabled() : false}
      >{op.label()}</button>
    );
  };

  return (
    <div className="toolbar">
      {GROUPS.map((g, gi) => {
        const nodes = g.ids.map(renderItem).filter(Boolean);
        if (nodes.length === 0) return null;
        return (
          <Fragment key={g.key}>
            {gi > 0 && <span className="tb-group-sep" />}
            <div className={'tb-group tb-group-' + g.key}>{nodes}</div>
          </Fragment>
        );
      })}

      {/* 「⋯ 更多」：收纳插件命令（无插件时不显示） */}
      {pluginItems.length > 0 && (
        <div className="tb-more-wrap">
          <button className="tb-more-btn" title="插件命令" onClick={() => setMoreOpen((o) => !o)}>
            ⋯ 更多
          </button>
          {moreOpen && (
            <div className="tb-more-pop">
              {pluginItems.map((it) => (
                <button
                  key={it.id}
                  className="tb-more-item"
                  title={it.title}
                  onClick={() => { it.onClick?.(); setMoreOpen(false); }}
                >{it.icon && <span className="tb-icon">{it.icon}</span>}{typeof it.label === 'function' ? it.label() : it.label}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {tips && <div className="export-tips">{tips}</div>}
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
