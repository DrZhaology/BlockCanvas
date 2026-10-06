import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScene, findNode } from '@store/sceneStore';
import type { ElementStyle, SceneElement } from '@lib/types';
import {
  readTable, normalizeTable, colCount, applyTableOp, findTableAncestor, type TableOp
} from '@lib/tableOps';
import { TABLE_STYLE_PRESETS, TABLE_STRUCTURE_TEMPLATES, applyTableStylePreset } from '@lib/tablePresets';
import { HelpButton } from './HelpButton';

// ============================================================================
// BlockCanvas · 表格编辑页（v0.4.3）
// ----------------------------------------------------------------------------
// 独立的"表格专用"编辑页面：现实里表格用得少，但一旦要用就得能改结构
// （加行/列、合并/拆分单元格、表头、表尾、标题），普通属性面板完全做不了。
//
// 操作哲学：**能用鼠标拖的，绝不做成按钮墙**。
//   · 插入行/列 → 网格里行与行、列与列之间有"插入轨"：
//       鼠标移上去浮出 ＋（整条轨道都是热区，不用瞄准）
//       点一下 = 插 1 个；按住沿"列→右 / 行→下"拖 = 一次插 N 个（实时预览 + 计数气泡）
//   · 选中     → 在单元格上按住拖，可以框出一个矩形选区
//   · 合并/拆分/设为表头/删行删列 → 选区上方浮出操作条，就近点
// 右侧只留"真正需要打字/选值"的属性，每一格都写清用途，并配「?」帮助。
//
// 所有结构改动都通过 applyTableOp 产出新树 → store.replaceSubtree（一条 undo）。
// ============================================================================

/** 选区：单元格（可带矩形扩展）/ 整行 / 整列 */
type Sel =
  | { kind: 'cell'; r: number; c: number; r2: number; c2: number }
  | { kind: 'row'; r: number }
  | { kind: 'col'; c: number };

type RailDrag = { id: number; axis: 'col' | 'row'; at: number; count: number; x: number; y: number };

/** 拖动会话：起点与步长放在 ref 里，避免"渲染后重挂监听把起点刷成当前点"导致位移恒为 0 */
type RailSession = { id: number; axis: 'col' | 'row'; at: number; startX: number; startY: number; step: number; count: number };

const colLetter = (i: number) => String.fromCharCode(65 + (i % 26));

const TABLE_FONTS = ['12px', '12.5px', '13px', '14px', '15px', '16px', '18px'];
const ALIGN = [['', '默认'], ['left', '左'], ['center', '中'], ['right', '右']] as const;
const VALIGN = [['', '默认'], ['top', '上'], ['middle', '中'], ['bottom', '下']] as const;
const BORDER_STYLES = [['solid', '实线'], ['dashed', '虚线'], ['dotted', '点线'], ['double', '双线']] as const;

const MAX_DRAG_COUNT = 30;

export function TableEditor({ tableId, onBack }: { tableId: string; onBack: () => void }) {
  const scene = useScene((s) => s.scene);
  const [sel, setSel] = useState<Sel | null>(null);
  const [cellDraft, setCellDraft] = useState('');
  const [railDrag, setRailDrag] = useState<RailDrag | null>(null);
  const editingRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const table = useMemo(() => findNode(scene.root, tableId), [scene, tableId]);
  // 编辑器只读展示：先规整再读，保证与结构操作看到的是同一套区块
  const parts = useMemo(() => (table && table.type === 'table' ? readTable(normalizeTable(table)) : null), [table]);

  /** 每行的单元格（过滤掉万一混进来的非单元格节点，渲染与索引都以此为准） */
  const rowCells = useMemo(
    () => (parts ? parts.rows.map((r) => r.children.filter((c) => c.type === 'th' || c.type === 'td')) : []),
    [parts]
  );
  const cols = parts ? colCount(parts) : 0;
  const rowCount = rowCells.length;

  // ——— 选区派生 ———
  const rect = useMemo(() => {
    if (!sel || sel.kind !== 'cell') return null;
    return {
      r0: Math.min(sel.r, sel.r2), r1: Math.max(sel.r, sel.r2),
      c0: Math.min(sel.c, sel.c2), c1: Math.max(sel.c, sel.c2)
    };
  }, [sel]);

  const rectCells = useMemo(() => {
    if (!rect) return [];
    const out: SceneElement[] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      for (let c = rect.c0; c <= rect.c1; c++) {
        const cell = rowCells[r]?.[c];
        if (cell) out.push(cell);
      }
    }
    return out;
  }, [rect, rowCells]);

  /** 右侧「单元格」卡的数据源：单元格选中 → 左上角那一格；整行 → 行节点 */
  const anchor: SceneElement | null = rect ? rowCells[rect.r0]?.[rect.c0] ?? null : null;
  const selNode: SceneElement | null = useMemo(() => {
    if (!sel) return null;
    if (sel.kind === 'row') return parts?.rows[sel.r] ?? null;
    if (sel.kind === 'col') return null;
    return anchor;
  }, [sel, parts, anchor]);

  // 选区失效（表格结构变了 / 行数列数变少）→ 收敛到合法范围
  useEffect(() => {
    if (!sel) return;
    if (sel.kind === 'col' && sel.c >= cols) setSel({ kind: 'col', c: Math.max(0, cols - 1) });
    if (sel.kind === 'row' && sel.r >= rowCount) setSel(null);
    if (sel.kind === 'cell') {
      if (sel.r >= rowCount || sel.r2 >= rowCount || sel.c >= cols || sel.c2 >= cols) setSel(null);
    }
  }, [sel, cols, rowCount]);

  // 首次进入：默认选中左上角第一格，右侧面板不至于是空的
  useEffect(() => {
    if (!sel && rowCount > 0 && cols > 0) setSel({ kind: 'cell', r: 0, c: 0, r2: 0, c2: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowCount, cols]);

  useEffect(() => {
    if (anchor && !editingRef.current) setCellDraft(anchor.text ?? '');
  }, [anchor?.id, anchor?.text]);

  // 表格被删除 / 切走 → 回编辑器
  useEffect(() => {
    if (!table || table.type !== 'table') onBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  // ——— 结构操作的统一入口（一条 undo） ———
  const runOp = (op: TableOp) => {
    const cur = findNode(useScene.getState().scene.root, tableId);
    if (!cur) return;
    useScene.getState().replaceSubtree(tableId, applyTableOp(cur, op));
  };

  // ——— 轨道拖动：按下 → 移动算个数 → 松手插入 ———
  const railSession = useRef<RailSession | null>(null);
  const railSeq = useRef(0);

  const axisStep = (axis: 'col' | 'row') => {
    const g = wrapRef.current?.querySelector('.tbl-grid') as HTMLElement | null;
    if (!g) return axis === 'col' ? 96 : 34;
    const r = g.getBoundingClientRect();
    if (axis === 'col') return Math.max(48, (r.width - 30 - 46) / Math.max(1, cols));
    return Math.max(22, (r.height - 26) / Math.max(1, rowCount || 1));
  };

  const startRail = (axis: 'col' | 'row', at: number, e: { clientX: number; clientY: number }) => {
    const s: RailSession = {
      id: ++railSeq.current, axis, at,
      startX: e.clientX, startY: e.clientY,
      step: axisStep(axis), count: 1
    };
    railSession.current = s;
    setRailDrag({ id: s.id, axis, at, count: 1, x: e.clientX, y: e.clientY });
  };

  // 只在"开始一次拖动"时挂监听（依赖 id，不依赖每次移动的坐标）
  useEffect(() => {
    if (!railDrag) return;
    const onMove = (e: PointerEvent) => {
      const s = railSession.current;
      if (!s) return;
      const delta = s.axis === 'col' ? e.clientX - s.startX : e.clientY - s.startY;
      s.count = Math.min(MAX_DRAG_COUNT, Math.max(1, 1 + Math.round(delta / s.step)));
      setRailDrag({ id: s.id, axis: s.axis, at: s.at, count: s.count, x: e.clientX, y: e.clientY });
    };
    const onUp = () => {
      const s = railSession.current;
      railSession.current = null;
      setRailDrag(null);
      if (s) commitRail(s.axis, s.at, s.count);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      railSession.current = null;
      setRailDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    document.body.classList.add('bc-rail-dragging');
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('bc-rail-dragging');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railDrag?.id]);

  /** 轨道落子：at 是"插在第 at 条缝"（0 = 最前，len = 最后） */
  const commitRail = (axis: 'col' | 'row', at: number, count: number) => {
    if (axis === 'row') {
      if (rowCount === 0) {
        // 空表：随便造一行，行列都靠它撑起来
        runOp({ kind: 'insertRow', refRowId: '', side: 'before', count });
        return;
      }
      if (at >= rowCount) {
        runOp({ kind: 'insertRow', refRowId: parts!.rows[rowCount - 1].id, side: 'after', count });
      } else {
        runOp({ kind: 'insertRow', refRowId: parts!.rows[at].id, side: 'before', count });
      }
      return;
    }
    if (rowCount === 0) return; // 一列都没有 = 一行都没有，先加行
    const base = Math.min(at, cols - 1);
    const refRow = rowCells[0];
    const refCell = refRow?.[base];
    if (at >= cols && rowCells[0]?.length) {
      runOp({ kind: 'insertCol', refCellId: rowCells[0][rowCells[0].length - 1].id, side: 'after', index: cols - 1, count });
    } else {
      runOp({ kind: 'insertCol', refCellId: refCell?.id ?? '', side: 'before', index: base, count });
    }
  };

  // ——— 单元格框选（按住拖出矩形） ———
  const draggingRef = useRef<{ r: number; c: number } | null>(null);
  const extendTo = (r: number, c: number) => {
    const a = draggingRef.current;
    if (!a) return;
    if (a.r === r && a.c === c) return;
    setSel({ kind: 'cell', r: a.r, c: a.c, r2: r, c2: c });
  };
  useEffect(() => {
    const onUp = () => { draggingRef.current = null; };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, []);

  // ——— Del / Backspace：只清文案，绝不动结构 ———
  // （以前在这里按 Del 会走全局快捷键，把"之前选中的那个元素"从画布上删掉，
  //   看起来就像随机删表。现在全局快捷键只在编辑器视图生效，这里自己接管，
  //   语义固定为"清空所选格子的字"，要删行列请用轨道 / 操作条。）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const st = useScene.getState();
      const cur = findNode(st.scene.root, tableId);
      if (!cur) return;
      const p = readTable(normalizeTable(cur));
      const cells = p.rows.map((r) => r.children.filter((c) => c.type === 'th' || c.type === 'td'));
      let ids: string[] = [];
      if (sel?.kind === 'row') ids = cells[sel.r]?.map((c) => c.id) ?? [];
      else if (sel?.kind === 'col') ids = cells.map((row) => row[sel.c]?.id).filter(Boolean) as string[];
      else if (rect) {
        for (let r = rect.r0; r <= rect.r1; r++) {
          for (let c = rect.c0; c <= rect.c1; c++) {
            const cell = cells[r]?.[c];
            if (cell) ids.push(cell.id);
          }
        }
      }
      if (ids.length === 0) return;
      e.preventDefault();
      st.replaceSubtree(tableId, applyTableOp(cur, { kind: 'clearCells', cellIds: ids }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, rect, tableId]);

  if (!table || table.type !== 'table' || !parts) return null;

  const cellStyle: ElementStyle = anchor?.style ?? {};
  const merged = anchor ? (Number(anchor.attrs?.colspan) > 1 || Number(anchor.attrs?.rowspan) > 1) : false;
  const rectArea = rect ? (rect.r1 - rect.r0 + 1) * (rect.c1 - rect.c0 + 1) : 0;
  const canMerge = rectArea > 1 && !merged;

  const applyPreset = (id: string) => {
    const preset = TABLE_STYLE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const cls = (table.attrs?.className ?? '').trim() || 'data-table';
    useScene.getState().replaceSubtree(tableId, applyTableStylePreset(table, preset, cls));
  };

  const insertTemplate = (id: string) => {
    const tpl = TABLE_STRUCTURE_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    const st = useScene.getState();
    const owner = findTableAncestor(scene.root, tableId);
    const parentId = owner ? findParentOf(scene.root, owner.id) : null;
    st.insertTemplate(tpl.build(), parentId);
    onBack();
  };

  // ——— 网格模板串 ———
  const gridCols = `30px ${Array.from({ length: cols }, () => '8px minmax(76px, 1fr)').join(' ')} 8px`;
  const gridRows = `26px ${Array.from({ length: rowCount }, () => '8px minmax(30px, auto)').join(' ')} 8px`;

  return (
    <div className="table-page">
      <div className="table-topbar">
        <button className="fluent-back-btn" onClick={onBack}>← 返回编辑器</button>
        <div className="update-brand">
          <span className="update-brand-logo">▦</span>
          <span className="update-brand-text">表格编辑器</span>
        </div>
        <span className="table-meta">
          {table.attrs?.className ? `.${table.attrs.className.split(/\s+/)[0]}` : table.attrs?.id ? `#${table.attrs.id}` : '（未命名表格）'}
          {' · '}{rowCount} 行 × {cols} 列
        </span>
      </div>

      <div className="table-body">
        {/* ————— 左：结构网格 ————— */}
        <div className="table-stage">
          <div className="tbl-stage-head">
            <div className="tbl-panel-title">表格结构</div>
            <HelpButton
              title="怎么改表格结构"
              content={'【插入行 / 列】\n把鼠标移到行与行、列与列之间那条缝上，会浮出一条轨道和 ＋。\n· 点一下：插入 1 行 / 1 列\n· 按住 ＋ 沿"列往右拖 / 行往下拖"：一次插入多个，气泡上会实时显示要插几个\n· 拖过头了按 Esc 取消\n\n【选中与合并】\n· 在格子上按住鼠标拖 → 拖选出一片（矩形选区）\n· Ctrl / ⌘ + 点某一格 → 把这一格并进当前选区（选区始终是矩形，取并集）\n· Shift + 点 → 从起点拉到你点的那一格\n· 点行号 / 列号 → 选中整行 / 整列\n· 选中后，上面那条操作条会亮起来：合并 / 拆分 / 设为表头 / 删除行 / 删除列\n\n【删除】\n按 Del / Backspace = 清空选中格子的文字（只动内容，不动结构）。\n要删掉整行 / 整列，请用操作条上的「删行 / 删列」。\n\n【跨度标记】\n合并后的格子右下角会显示 ⇥（跨几列）与 ⇩（跨几行）。'}
            />
          </div>
          <div className="tbl-stage-tip">
            缝上悬浮出 <b>＋</b>：点一下插 1 个，按住拖动可一次插多个 · 格子上拖动可拖选一片，<b>Ctrl+点</b> 加选、<b>Del</b> 清空文字
          </div>

          {/* 选区操作条：固定位置（不浮在格子上挡住视线），没选中时按钮禁用 */}
          <div className={'tbl-actionbar' + (sel ? ' has-sel' : '')} onPointerDown={(e) => e.stopPropagation()}>
            <span className="tbl-bar-label">
              {!sel ? '未选中'
                : sel.kind === 'col' ? `${colLetter(sel.c)} 列`
                  : sel.kind === 'row' ? `第 ${sel.r + 1} 行`
                    : rectArea > 1 ? `${rectArea} 格` : `${colLetter(rect!.c0)}${rect!.r0 + 1}`}
            </span>
            {sel?.kind === 'cell' && (
              <button
                className="tbl-bar-btn"
                disabled={!canMerge}
                title={merged ? '这个格子已经是合并后的了 —— 先拆分再重新合并' : '把框选的这一片合并成一格（只有左上角那格的内容会保留）'}
                onClick={() => runOp({ kind: 'mergeRange', cellId: anchor!.id, width: rect!.c1 - rect!.c0 + 1, height: rect!.r1 - rect!.r0 + 1 })}
              >⇥⇩ 合并</button>
            )}
            <button
              className="tbl-bar-btn"
              disabled={!merged}
              title={merged ? '把合并过的格子拆回一格一格' : '当前选区里没有合并过的格子'}
              onClick={() => anchor && runOp({ kind: 'unmerge', cellId: anchor.id })}
            >⇱ 拆分</button>
            <button
              className="tbl-bar-btn"
              disabled={!sel}
              title="选中范围内统一改成 <th> 表头格（再点一次改回 <td> 数据格）"
              onClick={() => {
                const ids = rectCells.map((c) => c.id);
                if (ids.length === 0) return;
                const toTh = !rectCells.every((c) => c.type === 'th');
                runOp({ kind: 'setRangeType', cellIds: ids, type: toTh ? 'th' : 'td' });
              }}
            >◐ 表头</button>
            <button
              className="tbl-bar-btn danger"
              disabled={!sel}
              title="删除选区覆盖到的所有行"
              onClick={() => {
                const ids = sel!.kind === 'row'
                  ? [parts.rows[sel!.r].id]
                  : parts.rows.slice(rect!.r0, rect!.r1 + 1).map((r) => r.id);
                runOp({ kind: 'deleteRows', rowIds: ids });
              }}
            >－ 删行</button>
            <button
              className="tbl-bar-btn danger"
              disabled={!sel}
              title="删除选区覆盖到的所有列"
              onClick={() => {
                const idxs: number[] = [];
                if (sel!.kind === 'col') idxs.push(sel!.c);
                else for (let c = rect!.c0; c <= rect!.c1; c++) idxs.push(c);
                runOp({ kind: 'deleteCols', indexes: idxs });
              }}
            >－ 删列</button>
          </div>

          <div className="tbl-grid-wrap bc-hscroll" ref={wrapRef}>
            {rowCount === 0 ? (
              <div className="tbl-empty-state">
                <div className="tbl-empty-title">这张表还一行都没有</div>
                <div className="tbl-empty-sub">先加一行，之后就能用轨道插行列、用格子框选合并了。</div>
                <div className="tbl-btn-row" style={{ justifyContent: 'center' }}>
                  <button className="tbl-btn" style={{ flex: '0 0 auto' }} onClick={() => commitRail('row', 0, 1)}>＋ 加第一行</button>
                  <button className="tbl-btn" style={{ flex: '0 0 auto' }} onClick={() => commitRail('row', 0, 3)}>＋ 加 3 行</button>
                </div>
              </div>
            ) : (
              <div
                className={'tbl-grid' + (railDrag ? ' is-dragging' : '')}
                style={{ gridTemplateColumns: gridCols, gridTemplateRows: gridRows }}
              >
                {/* 列头行 */}
                <div className="tbl-gcell tbl-gcorner" style={{ gridColumn: 1, gridRow: 1 }} />
                {Array.from({ length: cols }, (_, j) => (
                  <div
                    key={'ch' + j}
                    data-colhead={j}
                    className={'tbl-gcell tbl-colhead' + (sel?.kind === 'col' && sel.c === j ? ' active' : '')}
                    style={{ gridColumn: 3 + 2 * j, gridRow: 1 }}
                    title={`选中第 ${colLetter(j)} 列（整列）`}
                    onClick={() => setSel({ kind: 'col', c: j })}
                  >{colLetter(j)}</div>
                ))}

                {/* 行头 */}
                {parts.rows.map((row, r) => (
                  <div
                    key={'rh' + row.id}
                    data-rowhead={r}
                    className={'tbl-gcell tbl-rowhead' + (sel?.kind === 'row' && sel.r === r ? ' active' : '')}
                    style={{ gridColumn: 1, gridRow: 3 + 2 * r }}
                    title={`选中第 ${r + 1} 行（整行）`}
                    onClick={() => setSel({ kind: 'row', r })}
                  >{r + 1}</div>
                ))}

                {/* 单元格 */}
                {rowCells.map((cells, r) => cells.map((cell, c) => {
                  const cs = Math.max(1, Number(cell.attrs?.colspan) || 1);
                  const rs = Math.max(1, Number(cell.attrs?.rowspan) || 1);
                  const inRect = !!rect && r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1;
                  const isAnchor = !!rect && r === rect.r0 && c === rect.c0;
                  const inRow = sel?.kind === 'row' && sel.r === r;
                  return (
                    <div
                      key={cell.id}
                      data-cell={`${r}-${c}`}
                      className={
                        'tbl-gcell tbl-cell'
                        + (cell.type === 'th' ? ' is-th' : '')
                        + (inRect && sel?.kind === 'cell' ? ' picked' : '')
                        + (inRow ? ' picked' : '')
                        + (isAnchor && sel?.kind === 'cell' ? ' active' : '')
                      }
                      style={{ gridColumn: `${3 + 2 * c} / span ${2 * cs - 1}`, gridRow: `${3 + 2 * r} / span ${2 * rs - 1}` }}
                      title={`第 ${r + 1} 行 · 第 ${colLetter(c)} 列（按住可拖选一片；Ctrl/⌘ 点 = 并进选区）`}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        // Ctrl/⌘ + 点：把这一格并进现有选区。
                        // 选区本身始终是矩形（合并需要矩形），所以取"并集的外接矩形"，
                        // 锚点自动落到左上角（合并后保留内容的也是那一格）。
                        if ((e.ctrlKey || e.metaKey) && rect) {
                          draggingRef.current = null;
                          setSel({
                            kind: 'cell',
                            r: Math.min(rect.r0, r), c: Math.min(rect.c0, c),
                            r2: Math.max(rect.r1, r), c2: Math.max(rect.c1, c)
                          });
                          return;
                        }
                        // Shift + 点：从锚点拉到你点的那一格（等价于拖到这个位置）
                        if (e.shiftKey && rect) {
                          draggingRef.current = null;
                          setSel({ kind: 'cell', r: rect.r0, c: rect.c0, r2: r, c2: c });
                          return;
                        }
                        draggingRef.current = { r, c };
                        setSel({ kind: 'cell', r, c, r2: r, c2: c });
                      }}
                      onPointerEnter={() => extendTo(r, c)}
                      onPointerMove={() => extendTo(r, c)}
                    >
                      <span className="tbl-cell-text">{(cell.text ?? '').trim() || ' '}</span>
                      {cs > 1 && <span className="tbl-cell-badge">⇥{cs}</span>}
                      {rs > 1 && <span className="tbl-cell-badge">⇩{rs}</span>}
                    </div>
                  );
                }))}

                {/* 行轨（放在最前 / 每行之间 / 最后） */}
                {Array.from({ length: rowCount + 1 }, (_, j) => (
                  <div
                    key={'rr' + j}
                    className="tbl-rail tbl-rail-row"
                    style={{ gridColumn: '1 / -1', gridRow: 2 + 2 * j }}
                    title={
                      j >= rowCount
                        ? '在表格最后插入行：点一下插 1 行，按住往下拖可一次插多行'
                        : `在第 ${j + 1} 行上方插入：点一下插 1 行，按住往下拖可一次插多行`
                    }
                    onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); startRail('row', j, e); } }}
                  >
                    <button className="tbl-rail-btn" tabIndex={-1}>＋</button>
                  </div>
                ))}

                {/* 列轨 */}
                {Array.from({ length: cols + 1 }, (_, i) => (
                  <div
                    key={'cr' + i}
                    className="tbl-rail tbl-rail-col"
                    style={{ gridColumn: 2 + 2 * i, gridRow: '1 / -1' }}
                    title={
                      i >= cols
                        ? '在表格最后插入列：点一下插 1 列，按住往右拖可一次插多列'
                        : `在第 ${colLetter(i)} 列前插入：点一下插 1 列，按住往右拖可一次插多列`
                    }
                    onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); startRail('col', i, e); } }}
                  >
                    <button className="tbl-rail-btn" tabIndex={-1}>＋</button>
                  </div>
                ))}

                {/* 拖拽预览：将要插入的位置高亮成一条竖/横带 */}
                {railDrag && Array.from({ length: railDrag.count }, (_, k) => {
                  const idx = Math.min(railDrag.at + k, railDrag.axis === 'col' ? cols : rowCount);
                  return (
                    <div
                      key={'ghost' + k}
                      className={'tbl-ghost' + (railDrag.axis === 'col' ? ' is-col' : ' is-row')}
                      style={railDrag.axis === 'col'
                        ? { gridColumn: 2 + 2 * idx, gridRow: '1 / -1' }
                        : { gridRow: 2 + 2 * idx, gridColumn: '1 / -1' }}
                    />
                  );
                })}
              </div>
            )}

          </div>
        </div>

        {/* ————— 右：属性与操作 ————— */}
        <div className="table-side">
          {/* 单元格 */}
          <div className="tbl-card">
            <div className="tbl-card-head">
              <div className="tbl-card-title">单元格</div>
              <HelpButton
                title="单元格属性怎么填"
                content={'【文案】这一格里显示的字。回车或点别处生效。\n\n【类型 th / td】\n· td = 普通数据格\n· th = 表头格（浏览器默认加粗居中、屏幕阅读器会当成"这行/这列的名字"）\n\n【scope】只对 th 有意义：告诉屏幕阅读器这个表头管的是哪一片。\n· col = 管它下面这一列 · row = 管它右边这一行\n· colgroup / rowgroup = 管这一整列组 / 行组（一般配合 <colgroup> 用）\n\n【colspan / rowspan】跨几列 / 跨几行。\n选一片格子点"合并"就是自动填这两个值；此处手填适合做精细控制。\n\n【内边距】文字到格子边框的距离，例如 8px 12px（上下 8 · 左右 12）。\n【不换行】打开后这一格的长文字不再折行（表格会因此变宽）。'}
              />
            </div>
            {!selNode || (selNode.type !== 'th' && selNode.type !== 'td') ? (
              <div className="tbl-empty">
                {sel?.kind === 'row' ? '当前选的是整行 —— 点一个具体格子可以改它的样式。' : '先在左侧点一个格子。'}
              </div>
            ) : (
              <>
                <label className="tbl-field">
                  <span>文案</span>
                  <input
                    value={cellDraft}
                    onFocus={() => { editingRef.current = true; }}
                    onChange={(e) => setCellDraft(e.target.value)}
                    onBlur={() => { editingRef.current = false; useScene.getState().setText(selNode.id, cellDraft); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  />
                </label>
                <div className="tbl-field-row">
                  <label className="tbl-field small">
                    <span>类型 <em>th 表头 / td 数据</em></span>
                    <select value={selNode.type} onChange={(e) => runOp({ kind: 'setCellType', cellId: selNode.id, type: e.target.value as 'th' | 'td' })}>
                      <option value="td">td 数据格</option>
                      <option value="th">th 表头格</option>
                    </select>
                  </label>
                  <label className="tbl-field small">
                    <span>scope <em>表头管哪片</em></span>
                    <select
                      value={selNode.attrs?.scope ?? ''}
                      onChange={(e) => useScene.getState().setNodeAttr(selNode.id, 'scope', e.target.value || undefined)}
                      disabled={selNode.type !== 'th'}
                      title={selNode.type !== 'th' ? '只有 th 表头格才需要 scope' : '这个表头负责说明哪一片格子'}
                    >
                      <option value="">无</option>
                      <option value="col">col 管整列</option>
                      <option value="row">row 管整行</option>
                      <option value="colgroup">colgroup 管列组</option>
                      <option value="rowgroup">rowgroup 管行组</option>
                    </select>
                  </label>
                </div>
                <div className="tbl-field-row">
                  <label className="tbl-field small">
                    <span>colspan <em>跨几列</em></span>
                    <input
                      type="number" min={1}
                      value={selNode.attrs?.colspan ?? '1'}
                      title="1 = 只占一列；2 = 横跨两列（等于把右边那格并在自己身上）"
                      onChange={(e) => useScene.getState().setNodeAttr(selNode.id, 'colspan', e.target.value)}
                    />
                  </label>
                  <label className="tbl-field small">
                    <span>rowspan <em>跨几行</em></span>
                    <input
                      type="number" min={1}
                      value={selNode.attrs?.rowspan ?? '1'}
                      title="1 = 只占一行；3 = 竖着跨三行（等于把下面两格并在自己身上）"
                      onChange={(e) => useScene.getState().setNodeAttr(selNode.id, 'rowspan', e.target.value)}
                    />
                  </label>
                </div>
                <div className="tbl-field-row">
                  <label className="tbl-field small">
                    <span>水平对齐 <em>左右</em></span>
                    <select value={cellStyle.textAlign ?? ''} onChange={(e) => setStyleOf(selNode.id, { textAlign: e.target.value })}>
                      {ALIGN.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>
                  </label>
                  <label className="tbl-field small">
                    <span>垂直对齐 <em>上下</em></span>
                    <select value={cellStyle.verticalAlign ?? ''} onChange={(e) => setStyleOf(selNode.id, { verticalAlign: e.target.value })}>
                      {VALIGN.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>
                  </label>
                </div>
                <div className="tbl-field-row">
                  <label className="tbl-field small">
                    <span>底色 <em>这一格的背景</em></span>
                    <input type="color" value={toHex(cellStyle.backgroundColor)} onChange={(e) => setStyleOf(selNode.id, { backgroundColor: e.target.value })} />
                  </label>
                  <label className="tbl-field small">
                    <span>字色 <em>这一格的文字</em></span>
                    <input type="color" value={toHex(cellStyle.color)} onChange={(e) => setStyleOf(selNode.id, { color: e.target.value })} />
                  </label>
                  <label className="tbl-field small">
                    <span>不换行 <em>长文不折行</em></span>
                    <input
                      type="checkbox"
                      checked={cellStyle.whiteSpace === 'nowrap'}
                      onChange={(e) => setStyleOf(selNode.id, { whiteSpace: e.target.checked ? 'nowrap' : '' })}
                    />
                  </label>
                </div>
                <div className="tbl-field-row">
                  <label className="tbl-field small">
                    <span>内边距 <em>文字↔边框</em></span>
                    <input
                      value={cellStyle.padding ?? cellStyle.paddingTop ?? ''}
                      placeholder="如 8px 12px"
                      title="上下 左右；两段写法 8px 12px = 上下 8、左右 12"
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        setStyleOf(selNode.id, {
                          paddingTop: '', paddingRight: '', paddingBottom: '', paddingLeft: '', padding: v
                        } as Partial<ElementStyle>);
                      }}
                    />
                  </label>
                  <label className="tbl-field small">
                    <span>字号 <em>这一格的文字大小</em></span>
                    <select value={cellStyle.fontSize ?? ''} onChange={(e) => setStyleOf(selNode.id, { fontSize: e.target.value })}>
                      <option value="">继承表格</option>
                      {TABLE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </label>
                </div>
              </>
            )}
          </div>

          {/* 表格结构（搬不动的整体开关） */}
          <div className="tbl-card">
            <div className="tbl-card-head">
              <div className="tbl-card-title">表格结构</div>
              <HelpButton
                title="表头行 / 表尾行 / 表格标题"
                content={'【表头行 thead】整个表格最上面那一"块"，通常横向放列名。\n浏览器会把它固定在表格顶部参与打印重复。\n\n【表尾行 tfoot】表格最下面那块，常用来放"合计 / 备注 / 价格说明"。\n\n【表格标题 caption】表格自己的标题，语义上隶属这张表（比在表格外面另写一个标题更规范，\n屏幕阅读器会把它跟表格读在一起）。位置可以用「表格样式 → 标题位置」调。\n\n增删都只影响这些区块，不会动到你已经填好的数据行。'}
              />
            </div>
            <div className="tbl-toggle-row">
              <span className="tbl-toggle-name">表头行</span>
              <span className="tbl-toggle-count">{parts.thead ? parts.thead.children.length : 0} 行</span>
              <button className="tbl-mini" title="在表头区块末尾加一行 th" onClick={() => runOp({ kind: 'addHeaderRow' })}>＋</button>
              <button className="tbl-mini danger" title="删掉表头区块最后一行（删空后整个区块移除）" onClick={() => runOp({ kind: 'removeHeaderRow' })}>－</button>
            </div>
            <div className="tbl-toggle-row">
              <span className="tbl-toggle-name">表尾行</span>
              <span className="tbl-toggle-count">{parts.tfoot ? parts.tfoot.children.length : 0} 行</span>
              <button className="tbl-mini" title="在表尾区块末尾加一行 td" onClick={() => runOp({ kind: 'addFooterRow' })}>＋</button>
              <button className="tbl-mini danger" title="删掉表尾区块最后一行" onClick={() => runOp({ kind: 'removeFooterRow' })}>－</button>
            </div>
            <div className="tbl-toggle-row">
              <span className="tbl-toggle-name">表格标题</span>
              <span className="tbl-toggle-count">{parts.caption ? '有' : '无'}</span>
              <button
                className="tbl-mini"
                title={parts.caption ? '删掉表格标题' : '给表格加一条 caption 标题'}
                onClick={() => runOp(parts.caption ? { kind: 'removeCaption' } : { kind: 'addCaption' })}
              >{parts.caption ? '－' : '＋'}</button>
            </div>
            {parts.caption && (
              <label className="tbl-field">
                <span>标题文字</span>
                <input
                  value={parts.caption.text ?? ''}
                  onChange={(e) => useScene.getState().setText(parts.caption!.id, e.target.value)}
                />
              </label>
            )}
          </div>

          {/* 表格样式 */}
          <div className="tbl-card">
            <div className="tbl-card-head">
              <div className="tbl-card-title">表格样式</div>
              <HelpButton
                title="表格整体样式怎么调"
                content={'【宽度】整张表占容器多宽。100% = 撑满；写 480px 就是固定宽。\n\n【布局算法】\n· auto 自动：浏览器按内容自己分配列宽（内容长的列更宽）\n· fixed 固定：严格按第一行各列的宽度分，之后的列不会再被内容撑变 —— 数据对齐更整齐\n\n【边框合并】\n· collapse 合并：相邻格共用一条线，传统表格的样子\n· separate 分离：每格各自有边框，中间留缝（配合"边框间距"做卡片感）\n\n【边框间距】只在"分离"模式下生效：格子之间留多少空隙，例如 2px。\n\n【外框样式 / 粗细 / 颜色】整张表最外面那一圈边框。\n【圆角】表格四角切圆，配合"边框合并 = 分离"才看得出效果。\n【阴影】整张表底下的投影，例如 0 6px 20px rgba(15,23,42,.08)。'}
              />
            </div>
            <div className="tbl-field-row">
              <label className="tbl-field small">
                <span>宽度 <em>整表占多宽</em></span>
                <input value={table.style.width ?? ''} placeholder="100%" onChange={(e) => setStyleOf(tableId, { width: e.target.value })} />
              </label>
              <label className="tbl-field small">
                <span>布局算法 <em>列宽怎么分</em></span>
                <select value={table.style.tableLayout ?? ''} onChange={(e) => setStyleOf(tableId, { tableLayout: e.target.value })}>
                  <option value="">auto 按内容自动</option>
                  <option value="fixed">fixed 按首行固定</option>
                </select>
              </label>
            </div>
            <div className="tbl-field-row">
              <label className="tbl-field small">
                <span>边框合并 <em>格与格之间</em></span>
                <select value={table.style.borderCollapse ?? ''} onChange={(e) => setStyleOf(tableId, { borderCollapse: e.target.value })}>
                  <option value="">默认</option>
                  <option value="collapse">collapse 共线</option>
                  <option value="separate">separate 分离</option>
                </select>
              </label>
              <label className="tbl-field small">
                <span>边框间距 <em>分离时的缝</em></span>
                <input value={table.style.borderSpacing ?? ''} placeholder="如 2px" onChange={(e) => setStyleOf(tableId, { borderSpacing: e.target.value })} />
              </label>
            </div>
            <div className="tbl-field-row">
              <label className="tbl-field small">
                <span>外框样式 <em>最外圈线型</em></span>
                <select value={table.style.borderTopStyle ?? ''} onChange={(e) => {
                  const v = e.target.value;
                  setStyleOf(tableId, { borderTopStyle: v, borderRightStyle: v, borderBottomStyle: v, borderLeftStyle: v });
                }}>
                  <option value="">无</option>
                  {BORDER_STYLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
              <label className="tbl-field small">
                <span>边框粗细 <em>多少像素</em></span>
                <select value={table.style.borderTopWidth ?? ''} onChange={(e) => {
                  const v = e.target.value;
                  setStyleOf(tableId, { borderTopWidth: v, borderRightWidth: v, borderBottomWidth: v, borderLeftWidth: v });
                }}>
                  <option value="">无</option>
                  <option value="1px">1px</option>
                  <option value="2px">2px</option>
                  <option value="3px">3px</option>
                </select>
              </label>
              <label className="tbl-field small">
                <span>边框颜色</span>
                <input type="color" value={toHex(table.style.borderTopColor)} onChange={(e) => {
                  const v = e.target.value;
                  setStyleOf(tableId, { borderTopColor: v, borderRightColor: v, borderBottomColor: v, borderLeftColor: v });
                }} />
              </label>
            </div>
            <div className="tbl-field-row">
              <label className="tbl-field small">
                <span>圆角 <em>表格四角</em></span>
                <input
                  value={table.style.borderTopLeftRadius ?? ''}
                  placeholder="如 10px"
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setStyleOf(tableId, {
                      borderTopLeftRadius: v, borderTopRightRadius: v, borderBottomRightRadius: v, borderBottomLeftRadius: v
                    });
                  }}
                />
              </label>
              <label className="tbl-field small">
                <span>字号 <em>整表默认</em></span>
                <select value={table.style.fontSize ?? ''} onChange={(e) => setStyleOf(tableId, { fontSize: e.target.value })}>
                  <option value="">默认</option>
                  {TABLE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label className="tbl-field small">
                <span>标题位置 <em>caption 放哪</em></span>
                <select value={table.style.captionSide ?? ''} onChange={(e) => setStyleOf(tableId, { captionSide: e.target.value })}>
                  <option value="">默认（上）</option>
                  <option value="top">top 表上方</option>
                  <option value="bottom">bottom 表下方</option>
                </select>
              </label>
            </div>
            <div className="tbl-field-row">
              <label className="tbl-field small">
                <span>字色 <em>整表默认</em></span>
                <input type="color" value={toHex(table.style.color)} onChange={(e) => setStyleOf(tableId, { color: e.target.value })} />
              </label>
              <label className="tbl-field small">
                <span>底色 <em>整表默认</em></span>
                <input type="color" value={toHex(table.style.backgroundColor)} onChange={(e) => setStyleOf(tableId, { backgroundColor: e.target.value })} />
              </label>
              <label className="tbl-field small">
                <span>阴影 <em>eg 0 6px 20px</em></span>
                <input
                  value={table.style.boxShadow ?? ''}
                  placeholder="可留空"
                  onChange={(e) => setStyleOf(tableId, { boxShadow: e.target.value })}
                />
              </label>
            </div>
          </div>

          {/* 预设 */}
          <div className="tbl-card">
            <div className="tbl-card-head">
              <div className="tbl-card-title">一键预设样式</div>
              <HelpButton
                title="预设会改什么"
                content={'点一下 = 一次性套好一整张表的外观：表格本身的样式写进 table，\n单元格的公共部分写进子选择器规则（导出后是一段干净的 CSS，而不是给每个 td 塞行内样式）。\n\n· 表头底色、斑马纹这类"逐格不一样"的，会直接写到对应格子身上；\n· 套预设会覆盖上一次预设留下的同类设置，但不会动你在别处手改的其他属性。'}
              />
            </div>
            <div className="tbl-preset-grid">
              {TABLE_STYLE_PRESETS.map((p) => (
                <button key={p.id} className="tbl-preset" title={p.desc} onClick={() => applyPreset(p.id)}>
                  <b>{p.name}</b>
                  <span>{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 结构模板 */}
          <div className="tbl-card">
            <div className="tbl-card-head">
              <div className="tbl-card-title">结构模板（插到画布）</div>
              <HelpButton
                title="结构模板怎么用"
                content={'插入的是**一张全新的表**（带样例内容），会放在当前表格所在的同一个容器里，\n插完自动回到编辑器、并选中新表所在的上下文，方便你接着改。\n\n想改的是"当前这张表"？直接在左边网格上拖轨道 / 框选就够了，不用模板。'}
              />
            </div>
            <div className="tbl-preset-grid">
              {TABLE_STRUCTURE_TEMPLATES.map((t) => (
                <button key={t.id} className="tbl-preset" title={t.desc} onClick={() => insertTemplate(t.id)}>
                  <b>{t.name}</b>
                  <span>{t.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 拖动时的计数气泡（fixed，跟随指针） */}
      {railDrag && createPortal(
        <div className="tbl-count-badge" style={{ left: railDrag.x + 16, top: railDrag.y + 16 }}>
          <b>{railDrag.count}</b> {railDrag.axis === 'col' ? '列' : '行'}
          <span>松手插入 · Esc 取消</span>
        </div>,
        document.body
      )}
    </div>
  );
}

/** 统一的样式写入入口（都走 store.updateStyle → 有 undo） */
function setStyleOf(id: string, patch: Partial<ElementStyle>) {
  useScene.getState().updateStyle(id, patch);
}

function toHex(v: string | undefined): string {
  const s = (v ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return '#ffffff';
}

/** 找某节点的父容器 id（找不到就返回 null = 插到画布根） */
function findParentOf(root: SceneElement, id: string): string | null {
  for (const c of root.children) {
    if (c.id === id) return root.id;
    const r = findParentOf(c, id);
    if (r) return r;
  }
  return null;
}
