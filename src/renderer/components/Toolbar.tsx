import { useEffect, useRef, useState, useMemo } from 'react';
import { useScene } from '@store/sceneStore';
import { exportHTML, type ExportResult } from '@lib/exporter';
import { styleToCssText, simplifyStyle } from '@lib/styleClass';
import type { SceneElement } from '@lib/types';
import { useToolbar, type ToolbarItem } from '@store/toolbarStore';
import { dragSteps } from '@lib/drag';

// BlockCanvas · 顶部工具栏
//  - 左固定组：复制/剪切/粘贴/副本/删除 ｜ 预览/导出HTML —— 不可改。
//  - 右侧动态区（右对齐）：画布宽度块 / 缩放块 / 类名ID块 + 导出元素模板 / 取消选中，
//    按默认序渲染；最右端「⋯ 更多」收纳插件命令。
//  - 缩放块：按住百分比左右拖拽微调（阻尼），双击手输数值；旁置「归位」。

const ZOOM_MIN = 50;   // % 最小
const ZOOM_MAX = 200;  // % 最大

// 三块统一 id（注册进 toolbarStore，占排序/显隐位；渲染由下方 widgetMap 提供）
const BLOCKS: { id: string; label: string; order: number }[] = [
  { id: 'blk.canvas-width', label: '画布宽度', order: 60 },
  { id: 'blk.zoom', label: '缩放', order: 70 },
  { id: 'blk.clsid', label: '类名/ID', order: 80 }
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

  // 右侧动态区：内置按钮（含三块）按默认序排；插件命令（plg. 前缀）收进「⋯ 更多」
  const items = useToolbar((s) => s.items);
  const allSorted = useMemo(
    () => [...items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    [items]
  );
  const barItems = allSorted.filter((it) => !it.id.startsWith('plg.'));
  const pluginItems = allSorted.filter((it) => it.id.startsWith('plg.'));
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
        if (cls) {
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
      parts.push(`${result.unclassified.length} 个元素还没有类名：在「属性 → 类名 Class」起个名字，或用「类名管理」统一管理`);
    }
    if (parts.length === 0) return;
    const msg = parts.join('；');
    setTips(msg);
    window.clearTimeout(tipsTimer.current);
    tipsTimer.current = window.setTimeout(() => setTips(null), 6000);
  };

  // —— 内建操作（用 getState 取最新，供固定/动态按钮复用）——
  const doExport = async () => {
    const result = exportHTML(useScene.getState().scene);
    const res = await window.bc.exportHTML(result.html, 'index.html');
    if (!res.ok && !res.canceled) {
      alert('导出失败：' + (res.error ?? '未知错误'));
    } else if (res.ok) {
      showExportTips(result);
      console.log('已导出：', res.path);
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

  // —— 左侧固定操作组（布局固定，用户不可改）——
  const fixedOps: {
    id: string; label: string | (() => string); title: string; cls?: string;
    onClick: () => void; disabled?: () => boolean;
  }[] = [
    {
      id: 'copy', label: () => { const n = useScene.getState().scene.selectedIds.length; return '⧉ 复制' + (n > 1 ? `(${n})` : ''); },
      title: '复制 (Ctrl+C)\n多选：复制全部选中元素',
      onClick: () => { const st = useScene.getState(); if (st.scene.selectedIds.length) st.copyMany(st.scene.selectedIds); },
      disabled: () => useScene.getState().scene.selectedIds.length === 0
    },
    {
      id: 'cut', label: () => { const n = useScene.getState().scene.selectedIds.length; return '✂ 剪切' + (n > 1 ? `(${n})` : ''); },
      title: '剪切 (Ctrl+X)\n多选：剪切全部选中元素',
      onClick: () => { const st = useScene.getState(); if (st.scene.selectedIds.length) st.cutMany(st.scene.selectedIds); },
      disabled: () => useScene.getState().scene.selectedIds.length === 0
    },
    {
      id: 'paste', label: () => { const n = useScene.getState().scene.selectedIds.length; return '⎘ 粘贴' + (n > 1 ? `(${n})` : ''); },
      title: '粘贴 (Ctrl+V) — 插入到选中层级末尾（无选中时插到画布末尾）',
      onClick: () => { const st = useScene.getState(); st.pasteSibling(st.scene.selectedId); },
      disabled: () => useScene.getState().clipboard === null
    },
    {
      id: 'duplicate', label: '⛏ 副本', title: '原地副本 (Ctrl+D)',
      onClick: () => { const st = useScene.getState(); if (st.scene.selectedId) st.duplicateElement(st.scene.selectedId); },
      disabled: () => !useScene.getState().scene.selectedId
    },
    {
      id: 'delete', label: () => { const n = useScene.getState().scene.selectedIds.length; return '🗑 删除' + (n > 1 ? `(${n})` : ''); },
      title: '删除 (Delete) — 多选时批量删除', cls: 'toolbar-del',
      onClick: () => { const st = useScene.getState(); if (st.scene.selectedIds.length) st.removeMany(st.scene.selectedIds); },
      disabled: () => useScene.getState().scene.selectedIds.length === 0
    },
    {
      id: 'preview', label: '▶ 预览', title: '在默认浏览器中预览 (Ctrl+P)', cls: 'btn-ghost',
      onClick: doPreview
    },
    {
      id: 'export-html', label: '⬇ 导出 HTML', title: '导出 HTML (Ctrl+E)', cls: 'btn-primary',
      onClick: doExport
    }
  ];

  // —— 注册右侧动态区的项 ——
  useEffect(() => {
    // 动态按钮（导出元素模板 / 取消选中）
    const dynamic: ToolbarItem[] = [
      {
        id: 'export-template', label: '🔖 导出元素模板', title: '把选中元素（含子级）导出为模板 JSON 文件',
        order: 7, defaultVisible: true, cls: 'btn-ghost',
        onClick: doExportTemplate,
        disabled: () => {
          const st = useScene.getState();
          return !st.scene.selectedId || st.scene.selectedId === st.scene.root.id;
        }
      },
      {
        id: 'clear-selection', label: '取消选中', title: '取消选中 (Esc)', order: 8, defaultVisible: true, cls: 'btn-ghost',
        onClick: () => useScene.getState().selectElement(null),
        disabled: () => !useScene.getState().scene.selectedId
      }
    ];
    for (const it of dynamic) useToolbar.getState().addItem(it);
    // 三个块级组件（画布宽度 / 缩放 / 类名ID）：渲染由 widgetMap 提供
    for (const b of BLOCKS) {
      useToolbar.getState().addItem({ id: b.id, label: b.label, block: true, order: b.order, defaultVisible: true });
    }
  }, []);

  // 画布宽度：自定义像素值显示在选择框里
  const WIDTH_OPTIONS = ['auto', '1440px', '768px', '375px'];
  const customWidth = canvasWidth !== 'auto' && !WIDTH_OPTIONS.includes(canvasWidth) ? canvasWidth : null;

  const labelOf = (it: { label?: string | (() => string); id: string }) => (typeof it.label === 'function' ? it.label() : (it.label ?? it.id));
  const disabledOf = (it: { disabled?: () => boolean }) => (it.disabled ? it.disabled() : false);

  // —— 缩放：按住百分比左右拖拽（阻尼，最小 1%） ——
  const startZoomDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setZoomDrag({ startX: e.clientX, startPct: pct });
    document.body.classList.add('bc-zoom-dragging');
  };
  const moveZoomDrag = (e: React.PointerEvent) => {
    if (!zoomDrag) return;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomDrag.startPct + dragSteps(e.clientX - zoomDrag.startX)));
    onZoomChange(next / 100);
  };
  const endZoomDrag = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
    setZoomDrag(null);
    document.body.classList.remove('bc-zoom-dragging');
  };
  // 双击手输缩放
  const applyZoomEdit = () => {
    setZoomEdit(false);
    const n = parseInt(zoomEditVal, 10);
    if (Number.isNaN(n)) return;
    onZoomChange(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) / 100);
  };

  // —— 三个块的可变渲染（每渲染重建，拿到最新 props，块才能用当前 props 交互） ——
  const widgetMap: Record<string, React.ReactNode> = {
    'blk.canvas-width': (
      <div className="tb-block tb-width" title="画布宽度：自适应 = 当前编辑区宽度（所见即所得）；预设断点用于预览响应式效果">
        <span className="tb-block-label">画布</span>
        <select className="tb-width-select" value={canvasWidth} onChange={(e) => onCanvasWidthChange(e.target.value)}>
          {customWidth && <option value={customWidth}>📏 {parseInt(customWidth)}px</option>}
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
        <button className="tb-zoom-reset" disabled={zoom === 1} onClick={() => onZoomChange(1)} title="恢复 100% 显示">{zoom === 1 ? '100%' : '归位'}</button>
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
                  <button key={u.id} className="issue-item" onClick={() => { useScene.getState().selectElement(u.id); setIssuesOpen(false); }}>&lt;{u.type}&gt; 点此选中</button>
                ))}
                {issues.unnamed.length > 8 && <div className="issue-more">…还有 {issues.unnamed.length - 8} 个</div>}
              </div>
            )}
            {issues.conflicts.length > 0 && (
              <div className="issue-block">
                <div className="issue-block-head">{issues.conflicts.length} 个名称样式不统一（已在「类名管理」标记）</div>
                {issues.conflicts.map((c) => (
                  <button key={c.name} className="issue-item" onClick={() => { window.dispatchEvent(new CustomEvent('bc:open-class')); setIssuesOpen(false); }}>.{c.name}（{c.count} 个元素）→ 去统一</button>
                ))}
              </div>
            )}
            {issues.dupIds.length > 0 && (
              <div className="issue-block">
                <div className="issue-block-head">{issues.dupIds.length} 个 ID 重复使用</div>
                {issues.dupIds.map((d) => (
                  <button key={d.name} className="issue-item" onClick={() => { useScene.getState().selectElement(d.ids[1]); setIssuesOpen(false); }}>#{d.name} 重复 → 点此选中第二个</button>
                ))}
              </div>
            )}
            {issues.total === 0 && <div className="hint" style={{ margin: 8 }}>一切健康：所有元素都有类名 / ID，且同名样式统一。</div>}
            <button className="issue-go-cls" onClick={() => { window.dispatchEvent(new CustomEvent('bc:open-class')); setIssuesOpen(false); }}>打开「类名 / ID 管理」→</button>
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

  return (
    <div className="toolbar">
      {/* —— 左：固定操作组（不可改） —— */}
      <div className="tb-fixed">
        {fixedOps.slice(0, 5).map((b) => (
          <button key={b.id} className={b.cls ?? ''} title={b.title} onClick={b.onClick} disabled={b.disabled ? b.disabled() : false}>
            {labelOf(b)}
          </button>
        ))}
        <span className="tb-fixed-sep" />
        {fixedOps.slice(5).map((b) => (
          <button key={b.id} className={b.cls ?? ''} title={b.title} onClick={b.onClick} disabled={b.disabled ? b.disabled() : false}>
            {labelOf(b)}
          </button>
        ))}
      </div>

      <span className="sep" />

      {/* —— 右：右对齐；内置按钮按默认序渲染，插件命令收进最右「⋯ 更多」 —— */}
      <div className="tb-pool">
        {barItems.map((it) =>
          it.block ? (
            <div key={it.id} className="tb-pool-item">{widgetMap[it.id]}</div>
          ) : (
            <button
              key={it.id}
              className={"tb-pool-btn " + (it.cls ?? '')}
              title={it.title}
              onClick={it.onClick}
              disabled={disabledOf(it)}
            >{it.icon && <span className="tb-icon">{it.icon}</span>}{labelOf(it)}</button>
          )
        )}

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
                  >{it.icon && <span className="tb-icon">{it.icon}</span>}{labelOf(it)}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

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