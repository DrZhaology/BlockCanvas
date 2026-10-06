import { createElement } from '@store/sceneStore';
import type { SceneElement } from '@lib/types';

// ============================================================================
// BlockCanvas · 表格结构操作（v0.4.3 表格编辑页专用）
// ----------------------------------------------------------------------------
// 全部是**纯函数**：吃一棵 <table> 子树，吐一棵新的 —— 不碰 store，方便单测与撤销。
// 结构约定：table > (caption?) > thead? > tbody > tfoot?
//   · 面板里手插的 "table > tr" 属于宽松结构，任何结构操作前先 normalizeTable()
//     把它规整进 <tbody>（HTML 里浏览器也会这么自动补，导出后语义一致）。
//   · 所有操作都保留原有节点 id：选中态、类名、样式都不会因为"改结构"而丢失。
// ============================================================================

export interface TableParts {
  caption: SceneElement | null;
  thead: SceneElement | null;
  tbody: SceneElement;
  tfoot: SceneElement | null;
  /** 全部数据行（按 thead → tbody → tfoot 顺序） */
  rows: SceneElement[];
}

const isRow = (n: SceneElement) => n.type === 'tr';
const isCell = (n: SceneElement) => n.type === 'th' || n.type === 'td';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function makeSection(type: 'thead' | 'tbody' | 'tfoot'): SceneElement {
  const el = createElement(type);
  el.style = {};
  el.text = undefined;
  return el;
}

function makeRow(header: boolean, cols: number): SceneElement {
  const tr = createElement('tr');
  tr.style = {};
  tr.text = undefined;
  tr.children = Array.from({ length: Math.max(1, cols) }, () => {
    const cell = createElement(header ? 'th' : 'td');
    cell.style = {};
    cell.text = header ? '表头' : '单元格';
    return cell;
  });
  return tr;
}

/** 规整成规范结构：单个 caption / thead / tbody / tfoot；宽松的 tr 收进 tbody */
export function normalizeTable(table: SceneElement): SceneElement {
  const next = clone(table);
  const caption = next.children.find((c) => c.type === 'caption') ?? null;
  const thead = next.children.find((c) => c.type === 'thead') ?? null;
  const tfoot = next.children.find((c) => c.type === 'tfoot') ?? null;
  let tbody = next.children.find((c) => c.type === 'tbody') ?? null;

  const looseRows = next.children.filter(isRow);
  const bodyRows = [
    ...(tbody ? tbody.children.filter(isRow) : []),
    ...looseRows
  ];
  if (!tbody) {
    tbody = makeSection('tbody');
  } else {
    tbody = clone(tbody);
  }
  tbody.children = bodyRows;

  const ordered: SceneElement[] = [];
  if (caption) ordered.push(caption);
  if (thead) { const t = clone(thead); t.children = t.children.filter(isRow); if (t.children.length > 0) ordered.push(t); }
  ordered.push(tbody);
  if (tfoot) { const f = clone(tfoot); f.children = f.children.filter(isRow); if (f.children.length > 0) ordered.push(f); }

  next.children = ordered;
  return next;
}

/**
 * 读取表格区块结构（**纯视图，不克隆**）。
 * ⚠ 必须传入已经 normalizeTable 过的树：结构操作要就地改这些节点，
 *   如果这里再 clone 一层，改动会落到副本上（历史 bug：表格操作"点了没反应"）。
 */
export function readTable(table: SceneElement): TableParts {
  const norm = table;
  const caption = norm.children.find((c) => c.type === 'caption') ?? null;
  const thead = norm.children.find((c) => c.type === 'thead') ?? null;
  const tbody = norm.children.find((c) => c.type === 'tbody') as SceneElement;
  const tfoot = norm.children.find((c) => c.type === 'tfoot') ?? null;
  const rows = [
    ...(thead ? thead.children.filter(isRow) : []),
    ...tbody.children.filter(isRow),
    ...(tfoot ? tfoot.children.filter(isRow) : [])
  ];
  return { caption, thead, tbody, tfoot, rows };
}

/** 最大列数（按各行的单元格数取最大；colspan 不展开，够用且直观） */
export function colCount(parts: TableParts): number {
  let n = 1;
  for (const r of parts.rows) n = Math.max(n, r.children.filter(isCell).length);
  return n;
}

/** 找某一行所在的区块 */
function sectionOf(table: SceneElement, rowId: string): SceneElement | null {
  for (const c of table.children) {
    if (c.type === 'thead' || c.type === 'tbody' || c.type === 'tfoot') {
      if (c.children.some((r) => r.id === rowId)) return c;
    }
  }
  return null;
}

/** 找某个单元格及其行 */
export function locateCell(table: SceneElement, cellId: string, alreadyNormalized = false): { row: SceneElement; cell: SceneElement; rowIndex: number; cellIndex: number } | null {
  const parts = alreadyNormalized ? readTable(table) : readTable(normalizeTable(table));
  for (let i = 0; i < parts.rows.length; i++) {
    const row = parts.rows[i];
    const idx = row.children.findIndex((c) => c.id === cellId);
    if (idx >= 0) return { row, cell: row.children[idx], rowIndex: i, cellIndex: idx };
  }
  return null;
}

export type TableOp =
  | { kind: 'insertRow'; refRowId: string; side: 'before' | 'after' }
  | { kind: 'deleteRow'; rowId: string }
  /** refCellId 为空时用 index 兜底（空表格没有任何单元格也能插列） */
  | { kind: 'insertCol'; refCellId: string; side: 'before' | 'after'; index?: number }
  | { kind: 'deleteCol'; refCellId: string; index?: number }
  | { kind: 'mergeRight'; cellId: string }
  | { kind: 'mergeDown'; cellId: string }
  | { kind: 'unmerge'; cellId: string }
  | { kind: 'toggleHeaderRow'; rowId: string }
  | { kind: 'addHeaderRow' }
  | { kind: 'removeHeaderRow' }
  | { kind: 'addFooterRow' }
  | { kind: 'removeFooterRow' }
  | { kind: 'addCaption' }
  | { kind: 'removeCaption' }
  | { kind: 'setCellType'; cellId: string; type: 'th' | 'td' };

const intAttr = (v: string | undefined) => Math.max(1, Number(v) || 1);

/** 执行一个结构操作，返回新的 table 子树（id 全部保留） */
export function applyTableOp(table: SceneElement, op: TableOp): SceneElement {
  const next = normalizeTable(table);
  const parts = readTable(next); // next 已是规整树 → 这里拿到的是同一批节点引用
  const cols = colCount(parts);

  switch (op.kind) {
    case 'insertRow': {
      const sec = sectionOf(next, op.refRowId) ?? parts.tbody;
      const idx = sec.children.findIndex((r) => r.id === op.refRowId);
      const isHead = sec.type === 'thead';
      const newRow = makeRow(isHead, Math.max(1, (sec.children[idx]?.children.length) || cols));
      sec.children.splice(op.side === 'before' ? Math.max(0, idx) : idx + 1, 0, newRow);
      return next;
    }

    case 'deleteRow': {
      const sec = sectionOf(next, op.rowId);
      if (!sec) return next;
      sec.children = sec.children.filter((r) => r.id !== op.rowId);
      // 区块空了：表头/表尾区块直接摘掉，tbody 空了补一行空行（表格不能没有行）
      if (sec.children.length === 0) {
        if (sec.type !== 'tbody') next.children = next.children.filter((c) => c.id !== sec.id);
        else sec.children = [makeRow(false, cols)];
      }
      return next;
    }

    case 'insertCol': {
      const loc = op.refCellId ? locateCell(next, op.refCellId, true) : null;
      const base = loc ? loc.cellIndex : Math.max(0, op.index ?? 0);
      const at = op.side === 'before' ? base : base + 1;
      for (const row of parts.rows) {
        const inSection = sectionOf(next, row.id);
        const target = inSection?.children.find((r) => r.id === row.id);
        if (!target) continue;
        const isHead = target.children.some((c) => c.type === 'th');
        const cell = createElement(isHead ? 'th' : 'td');
        cell.style = {};
        cell.text = isHead ? '表头' : '单元格';
        target.children.splice(Math.min(at, target.children.length), 0, cell);
      }
      return next;
    }

    case 'deleteCol': {
      const loc = op.refCellId ? locateCell(next, op.refCellId, true) : null;
      const target0 = loc ? loc.cellIndex : Math.max(0, op.index ?? 0);
      for (const row of parts.rows) {
        const sec = sectionOf(next, row.id);
        const target = sec?.children.find((r) => r.id === row.id);
        if (!target) continue;
        if (target.children.length <= 1) continue; // 至少留一列
        target.children.splice(Math.min(target0, target.children.length - 1), 1);
      }
      return next;
    }

    case 'mergeRight': {
      const loc = locateCell(next, op.cellId, true);
      if (!loc) return next;
      const row = sectionOf(next, loc.row.id)?.children.find((r) => r.id === loc.row.id);
      if (!row) return next;
      const i = row.children.findIndex((c) => c.id === op.cellId);
      const cur = row.children[i];
      const right = row.children[i + 1];
      if (!right) return next;
      cur.attrs = { ...(cur.attrs ?? {}), colspan: String(intAttr(cur.attrs?.colspan) + intAttr(right.attrs?.colspan)) };
      row.children.splice(i + 1, 1);
      return next;
    }

    case 'mergeDown': {
      const loc = locateCell(next, op.cellId, true);
      if (!loc) return next;
      const rows = parts.rows;
      const below = rows[loc.rowIndex + 1];
      if (!below) return next;
      const secRow = sectionOf(next, loc.row.id)?.children.find((r) => r.id === loc.row.id);
      const secBelow = sectionOf(next, below.id)?.children.find((r) => r.id === below.id);
      if (!secRow || !secBelow) return next;
      const i = secRow.children.findIndex((c) => c.id === op.cellId);
      const cur = secRow.children[i];
      const victim = secBelow.children[Math.min(i, secBelow.children.length - 1)];
      if (!victim) return next;
      cur.attrs = { ...(cur.attrs ?? {}), rowspan: String(intAttr(cur.attrs?.rowspan) + intAttr(victim.attrs?.rowspan)) };
      secBelow.children = secBelow.children.filter((c) => c.id !== victim.id);
      return next;
    }

    case 'unmerge': {
      const loc = locateCell(next, op.cellId, true);
      if (!loc) return next;
      const rows = parts.rows;
      const secRow = sectionOf(next, loc.row.id)?.children.find((r) => r.id === loc.row.id);
      if (!secRow) return next;
      const i = secRow.children.findIndex((c) => c.id === op.cellId);
      const cur = secRow.children[i];
      const cs = intAttr(cur.attrs?.colspan);
      const rs = intAttr(cur.attrs?.rowspan);
      const isHead = cur.type === 'th';
      // 恢复自身
      const attrs = { ...(cur.attrs ?? {}) };
      delete attrs.colspan;
      delete attrs.rowspan;
      cur.attrs = Object.keys(attrs).length > 0 ? attrs : undefined;
      // 右侧补 cs-1 个空格
      for (let k = 1; k < cs; k++) {
        const cell = createElement(isHead ? 'th' : 'td');
        cell.style = {};
        cell.text = '';
        secRow.children.splice(i + k, 0, cell);
      }
      // 下方各行补 rs-1 个空格（插在同一列位置）
      for (let r = 1; r < rs; r++) {
        const target = rows[loc.rowIndex + r];
        if (!target) break;
        const secT = sectionOf(next, target.id)?.children.find((x) => x.id === target.id);
        if (!secT) continue;
        const cell = createElement(isHead ? 'th' : 'td');
        cell.style = {};
        cell.text = '';
        secT.children.splice(Math.min(i, secT.children.length), 0, cell);
      }
      return next;
    }

    case 'toggleHeaderRow': {
      const sec = sectionOf(next, op.rowId);
      const row = sec?.children.find((r) => r.id === op.rowId);
      if (!row) return next;
      const toHeader = row.children.some((c) => c.type === 'td');
      for (const cell of row.children) {
        if (!isCell(cell)) continue;
        cell.type = toHeader ? 'th' : 'td';
        if (toHeader) {
          cell.attrs = { ...(cell.attrs ?? {}), scope: cell.attrs?.scope ?? 'col' };
          if (cell.style.backgroundColor === '#ffffff' || cell.style.backgroundColor === undefined) {
            cell.style = { ...cell.style, backgroundColor: '#f1f5f9' };
          }
        } else if (cell.attrs) {
          const a = { ...cell.attrs };
          delete a.scope;
          cell.attrs = Object.keys(a).length > 0 ? a : undefined;
        }
      }
      return next;
    }

    case 'setCellType': {
      const loc = locateCell(next, op.cellId, true);
      if (!loc) return next;
      const row = sectionOf(next, loc.row.id)?.children.find((r) => r.id === loc.row.id);
      const cell = row?.children.find((c) => c.id === op.cellId);
      if (!cell) return next;
      cell.type = op.type;
      if (op.type === 'th') cell.attrs = { ...(cell.attrs ?? {}), scope: cell.attrs?.scope ?? 'col' };
      else if (cell.attrs) {
        const a = { ...cell.attrs };
        delete a.scope;
        cell.attrs = Object.keys(a).length > 0 ? a : undefined;
      }
      return next;
    }

    case 'addHeaderRow': {
      let thead = next.children.find((c) => c.type === 'thead') ?? null;
      const newRow = makeRow(true, cols);
      if (!thead) {
        thead = makeSection('thead');
        thead.children = [newRow];
        // thead 插在 caption 之后、tbody 之前
        const at = next.children.findIndex((c) => c.type === 'tbody');
        next.children.splice(at < 0 ? 0 : at, 0, thead);
      } else {
        thead.children.push(newRow);
      }
      return next;
    }

    case 'removeHeaderRow': {
      const thead = next.children.find((c) => c.type === 'thead');
      if (thead) thead.children.pop();
      if (thead && thead.children.length === 0) next.children = next.children.filter((c) => c.id !== thead.id);
      return next;
    }

    case 'addFooterRow': {
      let tfoot = next.children.find((c) => c.type === 'tfoot') ?? null;
      const newRow = makeRow(false, cols);
      if (!tfoot) {
        tfoot = makeSection('tfoot');
        tfoot.children = [newRow];
        next.children.push(tfoot);
      } else {
        tfoot.children.push(newRow);
      }
      return next;
    }

    case 'removeFooterRow': {
      const tfoot = next.children.find((c) => c.type === 'tfoot');
      if (tfoot) tfoot.children.pop();
      if (tfoot && tfoot.children.length === 0) next.children = next.children.filter((c) => c.id !== tfoot.id);
      return next;
    }

    case 'addCaption': {
      if (next.children.some((c) => c.type === 'caption')) return next;
      const cap = createElement('caption');
      cap.text = '表格标题';
      next.children.unshift(cap);
      return next;
    }

    case 'removeCaption': {
      next.children = next.children.filter((c) => c.type !== 'caption');
      return next;
    }
  }
  return next;
}

/** 新表格（结构模板）：rows × cols，可选表头行 / 标题 / 表尾 */
export function createTableTree(rows: number, cols: number, opts: { header?: boolean; caption?: boolean; footer?: boolean } = {}): SceneElement {
  const table = createElement('table');
  table.style = { width: '100%', backgroundColor: '#ffffff' };
  const children: SceneElement[] = [];
  if (opts.caption) children.push(createElement('caption'));
  if (opts.header) {
    const thead = makeSection('thead');
    thead.children = [makeRow(true, cols)];
    children.push(thead);
  }
  const tbody = makeSection('tbody');
  const bodyRows = Math.max(1, rows - (opts.header ? 1 : 0) - (opts.footer ? 1 : 0));
  tbody.children = Array.from({ length: bodyRows }, () => makeRow(false, cols));
  children.push(tbody);
  if (opts.footer) {
    const tfoot = makeSection('tfoot');
    tfoot.children = [makeRow(false, cols)];
    children.push(tfoot);
  }
  table.children = children;
  return table;
}


/** 向上找最近的 <table> 祖先（包含自身）—— 属性面板的"打开表格编辑器"入口用它 */
export function findTableAncestor(root: SceneElement, id: string): SceneElement | null {
  const path: SceneElement[] = [];
  const walk = (n: SceneElement): boolean => {
    path.push(n);
    if (n.id === id) return true;
    for (const c of n.children) if (walk(c)) return true;
    path.pop();
    return false;
  };
  if (!walk(root)) return null;
  for (let i = path.length - 1; i >= 0; i--) if (path[i].type === 'table') return path[i];
  return null;
}
