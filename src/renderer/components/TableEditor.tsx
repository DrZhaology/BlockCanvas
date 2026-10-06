import { useEffect, useMemo, useRef, useState } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import type { ElementStyle, SceneElement } from '@lib/types';
import {
  readTable, normalizeTable, colCount, applyTableOp, findTableAncestor, type TableOp
} from '@lib/tableOps';
import { TABLE_STYLE_PRESETS, TABLE_STRUCTURE_TEMPLATES, applyTableStylePreset } from '@lib/tablePresets';

// ============================================================================
// BlockCanvas · 表格编辑页（v0.4.3）
// ----------------------------------------------------------------------------
// 独立的"表格专用"编辑页面：现实里表格用得少，但一旦要用就得能改结构
// （加行/列、合并/拆分单元格、表头、表尾、标题），普通属性面板完全做不了。
//
// 分区：
//   左：结构网格（点单元格选中；点列号/行号选中整列/整行）
//   右上：选中对象（单元格 / 行 / 列）的结构操作与单元格样式
//   右下：整套表格样式 + 一键预设 + 结构模板
//
// 所有结构改动都通过 applyTableOp 产出新树 → store.replaceSubtree（一条 undo）。
// ============================================================================

type Sel =
  | { kind: 'cell'; id: string }
  | { kind: 'row'; id: string }
  | { kind: 'col'; index: number };

const colLetter = (i: number) => String.fromCharCode(65 + (i % 26));

const TABLE_FONTS = ['12px', '12.5px', '13px', '14px', '15px', '16px', '18px'];
const ALIGN = [['', '默认'], ['left', '左'], ['center', '中'], ['right', '右']] as const;
const VALIGN = [['', '默认'], ['top', '上'], ['middle', '中'], ['bottom', '下']] as const;
const BORDER_STYLES = [['solid', '实线'], ['dashed', '虚线'], ['dotted', '点线'], ['double', '双线']] as const;

export function TableEditor({ tableId, onBack }: { tableId: string; onBack: () => void }) {
  const scene = useScene((s) => s.scene);
  const [sel, setSel] = useState<Sel | null>(null);
  const [cellDraft, setCellDraft] = useState('');
  const editingRef = useRef(false);

  const table = useMemo(() => findNode(scene.root, tableId), [scene, tableId]);
  // 编辑器只读展示：先规整再读，保证与结构操作看到的是同一套区块
  const parts = useMemo(() => (table && table.type === 'table' ? readTable(normalizeTable(table)) : null), [table]);
  const cols = parts ? colCount(parts) : 0;

  // 选中项的实时节点（单元格 / 行）
  const selNode: SceneElement | null = useMemo(() => {
    if (!sel || sel.kind === 'col') return null;
    return findNode(scene.root, sel.id);
  }, [scene, sel]);

  useEffect(() => {
    if (selNode && !editingRef.current) setCellDraft(selNode.text ?? '');
  }, [selNode?.id, selNode?.text]);

  // 表格被删除 / 切走 → 回编辑器
  useEffect(() => {
    if (!table || table.type !== 'table') onBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  if (!table || table.type !== 'table' || !parts) return null;

  // 所有结构操作都产出新树 → replaceSubtree（一条 undo）。
  // applyTableOp 对"引用不存在"的情况一律原样返回，所以这里不需要再包一层安全版。
  const runSafe = (op: TableOp) => useScene.getState().replaceSubtree(tableId, applyTableOp(table, op));
  const setStyle = (patch: Partial<ElementStyle>) => {
    if (selNode) useScene.getState().updateStyle(selNode.id, patch);
  };

  // 当前选中单元格的列序号（用于列操作）
  const curCellIndex = (() => {
    if (!sel) return 0;
    if (sel.kind === 'col') return sel.index;
    if (selNode && (selNode.type === 'th' || selNode.type === 'td')) {
      const row = parts.rows.find((r) => r.children.some((c) => c.id === selNode.id));
      const i = row ? row.children.findIndex((c) => c.id === selNode.id) : 0;
      return Math.max(0, i);
    }
    return 0;
  })();

  const selRowId = (() => {
    if (sel?.kind === 'row') return sel.id;
    if (selNode) {
      const row = parts.rows.find((r) => r.children.some((c) => c.id === selNode.id));
      if (row) return row.id;
    }
    return parts.rows[0]?.id ?? '';
  })();

  const selCellId = (() => {
    if (selNode && (selNode.type === 'th' || selNode.type === 'td')) return selNode.id;
    // 没有单元格选中时：用当前行里对应列序号的单元格兜底
    const row = parts.rows.find((r) => r.id === selRowId);
    const c = row?.children[Math.min(curCellIndex, (row?.children.length ?? 1) - 1)];
    return c?.id ?? '';
  })();

  const cellStyle: ElementStyle = selNode?.style ?? {};

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
    const tree = tpl.build();
    // 插到当前表格所在的父容器里（同一处上下文），随后回到编辑器让用户看到新表格
    const owner = findTableAncestor(scene.root, tableId);
    const parentId = owner ? findParentOf(scene.root, owner.id) : null;
    st.insertTemplate(tree, parentId);
    onBack();
  };

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
          {' · '}{parts.rows.length} 行 × {cols} 列
        </span>
      </div>

      <div className="table-body">
        {/* ————— 左：结构网格 ————— */}
        <div className="table-stage">
          <div className="tbl-panel-title">结构（点单元格选中，再在右侧做结构操作）</div>
          <div className="tbl-grid-wrap bc-hscroll">
            <table className="tbl-grid">
              <thead>
                <tr>
                  <th className="tbl-grid-corner" />
                  {Array.from({ length: cols }, (_, i) => (
                    <th
                      key={i}
                      className={'tbl-grid-colhead' + (sel?.kind === 'col' && sel.index === i ? ' active' : '')}
                      title={`选中第 ${colLetter(i)} 列`}
                      onClick={() => setSel({ kind: 'col', index: i })}
                    >{colLetter(i)}</th>
                  ))}
                  <th className="tbl-grid-corner" />
                </tr>
              </thead>
              <tbody>
                {parts.rows.map((row, ri) => {
                  const isHead = row.children.some((c) => c.type === 'th');
                  return (
                    <tr key={row.id} className={isHead ? 'is-head' : ''}>
                      <th
                        className={'tbl-grid-rowhead' + (sel?.kind === 'row' && sel.id === row.id ? ' active' : '')}
                        title={`选中第 ${ri + 1} 行`}
                        onClick={() => setSel({ kind: 'row', id: row.id })}
                      >{ri + 1}</th>
                      {row.children.map((cell) => {
                        if (cell.type !== 'th' && cell.type !== 'td') return null;
                        const active = sel?.kind === 'cell' && sel.id === cell.id;
                        return (
                          <td
                            key={cell.id}
                            className={'tbl-cell' + (cell.type === 'th' ? ' is-th' : '') + (active ? ' active' : '')}
                            colSpan={Math.max(1, Number(cell.attrs?.colspan) || 1)}
                            rowSpan={Math.max(1, Number(cell.attrs?.rowspan) || 1)}
                            onClick={() => { setSel({ kind: 'cell', id: cell.id }); }}
                            onDoubleClick={() => { setSel({ kind: 'cell', id: cell.id }); }}
                          >
                            <span className="tbl-cell-text">{(cell.text ?? '').trim() || ' '}</span>
                            {Number(cell.attrs?.colspan) > 1 && <span className="tbl-cell-badge">⇥{cell.attrs?.colspan}</span>}
                            {Number(cell.attrs?.rowspan) > 1 && <span className="tbl-cell-badge">⇩{cell.attrs?.rowspan}</span>}
                          </td>
                        );
                      })}
                      <td className="tbl-grid-rowops">
                        <button className="tbl-mini" title="在这一行上面插入一行" onClick={() => runSafe({ kind: 'insertRow', refRowId: row.id, side: 'before' })}>＋</button>
                        <button className="tbl-mini danger" title="删除这一行" onClick={() => runSafe({ kind: 'deleteRow', rowId: row.id })}>－</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="tbl-hint">
            合并单元格后可在这里看到 ⇥（横向跨度）与 ⇩（纵向跨度）标记；
            拆分请用右侧「拆分单元格」。
          </div>
        </div>

        {/* ————— 右：属性与操作 ————— */}
        <div className="table-side">
          {/* 选中信息 */}
          <div className="tbl-card">
            <div className="tbl-card-title">
              {sel?.kind === 'col'
                ? `第 ${colLetter(curCellIndex)} 列`
                : sel?.kind === 'row'
                  ? '整行'
                  : selNode
                    ? `单元格 <${selNode.type}>`
                    : '未选中'}
            </div>
            <div className="tbl-btn-row">
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'insertRow', refRowId: selRowId, side: 'before' })}>↑ 上方插入行</button>
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'insertRow', refRowId: selRowId, side: 'after' })}>↓ 下方插入行</button>
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'deleteRow', rowId: selRowId })}>删除此行</button>
            </div>
            <div className="tbl-btn-row">
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'insertCol', refCellId: selCellId, side: 'before', index: curCellIndex })}>← 左侧插入列</button>
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'insertCol', refCellId: selCellId, side: 'after', index: curCellIndex })}>→ 右侧插入列</button>
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'deleteCol', refCellId: selCellId, index: curCellIndex })}>删除此列</button>
            </div>
            <div className="tbl-btn-row">
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'mergeRight', cellId: selCellId })}>⇥ 向右合并</button>
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'mergeDown', cellId: selCellId })}>⇩ 向下合并</button>
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'unmerge', cellId: selCellId })}>⇱ 拆分单元格</button>
            </div>
            <div className="tbl-btn-row">
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'toggleHeaderRow', rowId: selRowId })}>切换表头行</button>
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'addHeaderRow' })}>＋ 表头行</button>
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'removeHeaderRow' })}>－ 表头行</button>
            </div>
            <div className="tbl-btn-row">
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'addFooterRow' })}>＋ 表尾行</button>
              <button className="tbl-btn" onClick={() => runSafe({ kind: 'removeFooterRow' })}>－ 表尾行</button>
              <button className="tbl-btn" onClick={() => (parts.caption ? runSafe({ kind: 'removeCaption' }) : runSafe({ kind: 'addCaption' }))}>
                {parts.caption ? '－ 表格标题' : '＋ 表格标题'}
              </button>
            </div>
          </div>

          {/* 单元格 */}
          <div className="tbl-card">
            <div className="tbl-card-title">单元格</div>
            {!selNode || (selNode.type !== 'th' && selNode.type !== 'td') ? (
              <div className="tbl-empty">先在左侧点一个单元格。</div>
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
                    <span>类型</span>
                    <select value={selNode.type} onChange={(e) => runSafe({ kind: 'setCellType', cellId: selNode.id, type: e.target.value as 'th' | 'td' })}>
                      <option value="td">td 数据格</option>
                      <option value="th">th 表头格</option>
                    </select>
                  </label>
                  <label className="tbl-field small">
                    <span>scope</span>
                    <select
                      value={selNode.attrs?.scope ?? ''}
                      onChange={(e) => useScene.getState().setNodeAttr(selNode.id, 'scope', e.target.value || undefined)}
                      disabled={selNode.type !== 'th'}
                    >
                      <option value="">无</option>
                      <option value="col">col 列头</option>
                      <option value="row">row 行头</option>
                      <option value="colgroup">colgroup</option>
                      <option value="rowgroup">rowgroup</option>
                    </select>
                  </label>
                </div>
                <div className="tbl-field-row">
                  <label className="tbl-field small">
                    <span>colspan</span>
                    <input
                      type="number" min={1}
                      value={selNode.attrs?.colspan ?? '1'}
                      onChange={(e) => useScene.getState().setNodeAttr(selNode.id, 'colspan', e.target.value)}
                    />
                  </label>
                  <label className="tbl-field small">
                    <span>rowspan</span>
                    <input
                      type="number" min={1}
                      value={selNode.attrs?.rowspan ?? '1'}
                      onChange={(e) => useScene.getState().setNodeAttr(selNode.id, 'rowspan', e.target.value)}
                    />
                  </label>
                </div>
                <div className="tbl-field-row">
                  <label className="tbl-field small">
                    <span>水平对齐</span>
                    <select value={cellStyle.textAlign ?? ''} onChange={(e) => setStyle({ textAlign: e.target.value })}>
                      {ALIGN.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>
                  </label>
                  <label className="tbl-field small">
                    <span>垂直对齐</span>
                    <select value={cellStyle.verticalAlign ?? ''} onChange={(e) => setStyle({ verticalAlign: e.target.value })}>
                      {VALIGN.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>
                  </label>
                </div>
                <div className="tbl-field-row">
                  <label className="tbl-field small">
                    <span>底色</span>
                    <input type="color" value={toHex(cellStyle.backgroundColor)} onChange={(e) => setStyle({ backgroundColor: e.target.value })} />
                  </label>
                  <label className="tbl-field small">
                    <span>字色</span>
                    <input type="color" value={toHex(cellStyle.color)} onChange={(e) => setStyle({ color: e.target.value })} />
                  </label>
                  <label className="tbl-field small">
                    <span>不换行</span>
                    <input
                      type="checkbox"
                      checked={cellStyle.whiteSpace === 'nowrap'}
                      onChange={(e) => setStyle({ whiteSpace: e.target.checked ? 'nowrap' : '' })}
                    />
                  </label>
                </div>
                <div className="tbl-field-row">
                  <label className="tbl-field small">
                    <span>内边距</span>
                    <input
                      value={cellStyle.paddingTop ?? ''}
                      placeholder="如 8px 12px"
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        useScene.getState().updateStyle(selNode.id, {
                          paddingTop: '', paddingRight: '', paddingBottom: '', paddingLeft: '', padding: v
                        } as Partial<ElementStyle>);
                      }}
                    />
                  </label>
                  <label className="tbl-field small">
                    <span>字号</span>
                    <select value={cellStyle.fontSize ?? ''} onChange={(e) => setStyle({ fontSize: e.target.value })}>
                      <option value="">继承</option>
                      {TABLE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </label>
                </div>
              </>
            )}
          </div>

          {/* 表格样式 */}
          <div className="tbl-card">
            <div className="tbl-card-title">表格样式</div>
            <div className="tbl-field-row">
              <label className="tbl-field small">
                <span>宽度</span>
                <input value={table.style.width ?? ''} placeholder="100%" onChange={(e) => useScene.getState().updateStyle(tableId, { width: e.target.value })} />
              </label>
              <label className="tbl-field small">
                <span>布局算法</span>
                <select value={table.style.tableLayout ?? ''} onChange={(e) => useScene.getState().updateStyle(tableId, { tableLayout: e.target.value })}>
                  <option value="">auto 自动</option>
                  <option value="fixed">fixed 固定列宽</option>
                </select>
              </label>
            </div>
            <div className="tbl-field-row">
              <label className="tbl-field small">
                <span>边框合并</span>
                <select value={table.style.borderCollapse ?? ''} onChange={(e) => useScene.getState().updateStyle(tableId, { borderCollapse: e.target.value })}>
                  <option value="">默认</option>
                  <option value="collapse">collapse 合并</option>
                  <option value="separate">separate 分离</option>
                </select>
              </label>
              <label className="tbl-field small">
                <span>边框间距</span>
                <input value={table.style.borderSpacing ?? ''} placeholder="如 2px" onChange={(e) => useScene.getState().updateStyle(tableId, { borderSpacing: e.target.value })} />
              </label>
            </div>
            <div className="tbl-field-row">
              <label className="tbl-field small">
                <span>外框样式</span>
                <select value={table.style.borderTopStyle ?? ''} onChange={(e) => {
                  const v = e.target.value;
                  useScene.getState().updateStyle(tableId, {
                    borderTopStyle: v, borderRightStyle: v, borderBottomStyle: v, borderLeftStyle: v
                  });
                }}>
                  <option value="">无</option>
                  {BORDER_STYLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
              <label className="tbl-field small">
                <span>边框粗细</span>
                <select value={table.style.borderTopWidth ?? ''} onChange={(e) => {
                  const v = e.target.value;
                  useScene.getState().updateStyle(tableId, {
                    borderTopWidth: v, borderRightWidth: v, borderBottomWidth: v, borderLeftWidth: v
                  });
                }}>
                  <option value="">无</option>
                  <option value="1px">1px</option>
                  <option value="2px">2px</option>
                  <option value="3px">3px</option>
                </select>
              </label>
            </div>
            <div className="tbl-field-row">
              <label className="tbl-field small">
                <span>边框颜色</span>
                <input type="color" value={toHex(table.style.borderTopColor)} onChange={(e) => {
                  const v = e.target.value;
                  useScene.getState().updateStyle(tableId, {
                    borderTopColor: v, borderRightColor: v, borderBottomColor: v, borderLeftColor: v
                  });
                }} />
              </label>
              <label className="tbl-field small">
                <span>圆角</span>
                <input
                  value={table.style.borderTopLeftRadius ?? ''}
                  placeholder="如 10px"
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    useScene.getState().updateStyle(tableId, {
                      borderTopLeftRadius: v, borderTopRightRadius: v, borderBottomRightRadius: v, borderBottomLeftRadius: v
                    });
                  }}
                />
              </label>
              <label className="tbl-field small">
                <span>字号</span>
                <select value={table.style.fontSize ?? ''} onChange={(e) => useScene.getState().updateStyle(tableId, { fontSize: e.target.value })}>
                  <option value="">默认</option>
                  {TABLE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            </div>
            <div className="tbl-field-row">
              <label className="tbl-field small">
                <span>字色</span>
                <input type="color" value={toHex(table.style.color)} onChange={(e) => useScene.getState().updateStyle(tableId, { color: e.target.value })} />
              </label>
              <label className="tbl-field small">
                <span>底色</span>
                <input type="color" value={toHex(table.style.backgroundColor)} onChange={(e) => useScene.getState().updateStyle(tableId, { backgroundColor: e.target.value })} />
              </label>
              <label className="tbl-field small">
                <span>阴影</span>
                <input
                  value={table.style.boxShadow ?? ''}
                  placeholder="可留空"
                  onChange={(e) => useScene.getState().updateStyle(tableId, { boxShadow: e.target.value })}
                />
              </label>
            </div>
            <div className="tbl-hint">单元格通用的内边距 / 表头底色 / 斑马纹，直接用下面的预设一键套用最省事。</div>
          </div>

          {/* 预设 */}
          <div className="tbl-card">
            <div className="tbl-card-title">一键预设样式</div>
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
            <div className="tbl-card-title">表格模板（插入到画布）</div>
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
    </div>
  );
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
