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
  tr.children = Array.from({ length: Math.max(1, cols) }, () => makeCell(header));
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

/** 一个单元格在网格里的真实位置与跨度 */
export interface GridCell {
  cell: SceneElement;
  /** 所属行节点 */
  rowNode: SceneElement;
  /** 起始物理行（0 起） */
  row: number;
  /** 起始可视列（0 起，colspan 已摊平） */
  col: number;
  /** 跨几列（colspan） */
  cs: number;
  /** 跨几行（rowspan） */
  rs: number;
}

export interface TableGrid {
  /** 全部数据行（thead → tbody → tfoot） */
  rows: SceneElement[];
  cells: GridCell[];
  byId: Map<string, GridCell>;
  /** 占用表：occ[r][c] = 占着这一格的 cellId（被上方 rowspan 盖住的格子也在内） */
  occ: (string | null)[][];
  /** 可视列数（含被 colspan / rowspan 占用的列） */
  cols: number;
  rowCount: number;
}

/**
 * 把表格摊成一张二维网格：**colspan 与 rowspan 都摊平**。
 *
 * ⚠ 一切结构操作都必须走这张网格，不能按"第几个单元格"算：
 *   只要出现一个合并格，"单元格序号"就和它真实所在的行列对不上。
 *   历史 BUG 全是这个原因 —— 合并完渲染错位、插入列插错位置、
 *   先把两行各自横向合并再想纵向合并时直接放弃（"合并完全不对"）。
 *   被上方 rowspan 盖住的列是空洞，本行不占位；摊平后每格的 row/col
 *   就是它真实落在的行列，CSS Grid 与合并矩形都直接用它。
 */
export function buildGrid(rows: SceneElement[]): TableGrid {
  const occ: (string | null)[][] = [];
  const cells: GridCell[] = [];
  const byId = new Map<string, GridCell>();
  let cols = 0;

  const put = (r: number, c: number, id: string) => {
    while (occ.length <= r) occ.push([]);
    const line = occ[r];
    while (line.length <= c) line.push(null);
    line[c] = id;
    if (c + 1 > cols) cols = c + 1;
  };

  rows.forEach((rowNode, r) => {
    let c = 0;
    for (const cell of rowNode.children) {
      if (!isCell(cell)) continue;
      while (occ[r]?.[c]) c += 1; // 跳过被上方 rowspan 占掉的列
      const cs = intAttr(cell.attrs?.colspan);
      const rs = intAttr(cell.attrs?.rowspan);
      for (let dr = 0; dr < rs; dr += 1) for (let dc = 0; dc < cs; dc += 1) put(r + dr, c + dc, cell.id);
      const g: GridCell = { cell, rowNode, row: r, col: c, cs, rs };
      cells.push(g);
      byId.set(cell.id, g);
      c += cs;
    }
  });

  return { rows, cells, byId, occ, cols: Math.max(1, cols), rowCount: rows.length };
}

/** 可视列数（把 colspan / rowspan 都摊开后的最大列数） */
export function colCount(parts: TableParts): number {
  return buildGrid(parts.rows).cols;
}

/** 在某一行的 children 里，找到"第 vcol 列之前"该插入的下标 */
function insertIndexOf(rowNode: SceneElement, vcol: number): number {
  let c = 0;
  for (let i = 0; i < rowNode.children.length; i += 1) {
    const cell = rowNode.children[i];
    if (!isCell(cell)) continue;
    if (c >= vcol) return i;
    c += intAttr(cell.attrs?.colspan);
  }
  return rowNode.children.length;
}

/**
 * 把"落在合并格内部"的列号吸附到所有行都成立的列边界上（取包含它的那一格的起始列）。
 * 不吸附的话，同一列在不同行会插到不同位置，整张表当场错位。
 */
export function snapCol(grid: TableGrid, vcol: number): number {
  let v = Math.max(0, Math.min(vcol, grid.cols));
  for (let guard = 0; guard < 64; guard += 1) {
    const hit = grid.cells.find((g) => g.col < v && v < g.col + g.cs);
    if (!hit) return v;
    v = hit.col;
  }
  return v;
}

/**
 * 新插入的行该建"几列"：只数**上方 rowspan 盖过来**的列，本行自己的格子不算（新行还没插进去）。
 * ⚠ 不能拿"插入位置上那一行的占用表"来数：在最上方插行时那一行被自己的格子占满，
 *   会算出 0 个空位 → 新行只建 1 格、整行少列（探针抓到的真 BUG）。
 */
function freeWidthAt(grid: TableGrid, rowIndex: number): number {
  let free = 0;
  for (let c = 0; c < grid.cols; c += 1) {
    const covered = grid.cells.some(
      (g) => g.col <= c && g.col + g.cs - 1 >= c && g.row < rowIndex && g.row + g.rs - 1 >= rowIndex
    );
    if (!covered) free += 1;
  }
  return Math.max(1, free);
}

/** 新单元格：表头行插 th，数据行插 td */
function makeCell(isHead: boolean, text?: string): SceneElement {
  const cell = createElement(isHead ? 'th' : 'td');
  cell.style = {};
  cell.text = text ?? (isHead ? '表头' : '单元格');
  return cell;
}

/**
 * 合并计划：矩形 [row..row+h-1] × [col..col+w-1] 必须**正好**由若干个完整格子拼满。
 * 只要有格子被切到一半（选区压到已有合并格的边上）、越界、或只剩一格 → 返回 null，
 * 调用方整体放弃：宁可什么都不做，也不能产出一张列错位的表。
 */
function planMerge(grid: TableGrid, anchor: GridCell, w: number, h: number): { anchor: GridCell; victims: GridCell[] } | null {
  if (w === 1 && h === 1) return null;
  const r1 = anchor.row + h - 1;
  const c1 = anchor.col + w - 1;
  if (r1 >= grid.rowCount || c1 >= grid.cols) return null;
  const victims: GridCell[] = [];
  for (const g of grid.cells) {
    const overlap = g.row <= r1 && g.row + g.rs - 1 >= anchor.row && g.col <= c1 && g.col + g.cs - 1 >= anchor.col;
    if (!overlap) continue;
    const contained = g.row >= anchor.row && g.row + g.rs - 1 <= r1 && g.col >= anchor.col && g.col + g.cs - 1 <= c1;
    if (!contained) return null;
    if (g !== anchor) victims.push(g);
  }
  return victims.length === 0 ? null : { anchor, victims };
}

/** 这块矩形现在能不能合并（UI 用它决定「合并」按钮亮不亮，判定与 mergeRange 完全同一套） */
export function canMergeRange(grid: TableGrid, cellId: string, width: number, height: number): boolean {
  const a = grid.byId.get(cellId);
  if (!a) return false;
  return planMerge(grid, a, Math.max(1, width), Math.max(1, height)) !== null;
}

/** 合并矩形：给锚点写 colspan/rowspan，其余格子整格删掉 */
function mergeCells(next: SceneElement, parts: TableParts, anchor: GridCell, w: number, h: number): SceneElement {
  const grid = buildGrid(parts.rows);
  const a = grid.byId.get(anchor.cell.id);
  if (!a) return next;
  const plan = planMerge(grid, a, Math.max(1, w), Math.max(1, h));
  if (!plan) return next;
  for (const g of plan.victims) {
    const row = grid.rows[g.row];
    const i = row.children.findIndex((c) => c.id === g.cell.id);
    if (i >= 0) row.children.splice(i, 1);
  }
  plan.anchor.cell.attrs = {
    ...(plan.anchor.cell.attrs ?? {}),
    colspan: String(Math.max(1, w)),
    rowspan: String(Math.max(1, h))
  };
  return next;
}

/** 在"第 vcol 列之前"给每一行插 count 个新格（vcol 会被吸附到合法列边界） */
function insertColsAt(next: SceneElement, parts: TableParts, vcol: number, count: number): SceneElement {
  if (parts.rows.length === 0) return next;
  const grid = buildGrid(parts.rows);
  const v = snapCol(grid, vcol);
  const n = clampCount(count);
  for (let r = 0; r < grid.rowCount; r += 1) {
    const row = grid.rows[r];
    const at = insertIndexOf(row, v);
    const isHead = row.children.some((c) => c.type === 'th');
    for (let k = 0; k < n; k += 1) row.children.splice(Math.min(at + k, row.children.length), 0, makeCell(isHead));
  }
  return next;
}

/**
 * 删除若干"可视列号"对应的列。
 * 只有"正好从这一列开始、且只占一列"的格子删得掉；合并格的一部分不硬拆（跳过）。
 * 跳过不会让行错位：别的行少了这一列后，后面的格子会自然补到这一列上。
 */
function deleteColsAt(next: SceneElement, parts: TableParts, indexes: number[]): SceneElement {
  const grid = buildGrid(parts.rows);
  const targets = [...new Set(indexes)].sort((a, b) => b - a); // 从右往左删，索引不位移
  for (const row of grid.rows) {
    for (const v of targets) {
      if (row.children.filter(isCell).length <= 1) break; // 至少留一列
      const g = grid.cells.find((x) => x.rowNode === row && x.col === v && x.cs === 1);
      if (!g) continue;
      const i = row.children.findIndex((c) => c.id === g.cell.id);
      if (i >= 0) row.children.splice(i, 1);
    }
  }
  return next;
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
  /** count 默认 1：轨道拖动能一次插多个 */
  | { kind: 'insertRow'; refRowId: string; side: 'before' | 'after'; count?: number }
  | { kind: 'deleteRow'; rowId: string }
  /** refCellId 为空时用 index 兜底（空表格没有任何单元格也能插列） */
  | { kind: 'insertCol'; refCellId: string; side: 'before' | 'after'; index?: number; count?: number }
  /** 按"可视列号"插入（插入轨用它）：vcol = 插在第几个可视列之前 */
  | { kind: 'insertColAt'; vcol: number; count?: number }
  | { kind: 'deleteCol'; refCellId: string; index?: number }
  | { kind: 'mergeRight'; cellId: string }
  | { kind: 'mergeDown'; cellId: string }
  /** 鼠标框选一个矩形 → 一次合并成左上角那格 */
  | { kind: 'mergeRange'; cellId: string; width: number; height: number }
  | { kind: 'unmerge'; cellId: string }
  /** 批量：选区里所有单元格统一成 th / td */
  | { kind: 'setRangeType'; cellIds: string[]; type: 'th' | 'td' }
  /** 清空若干单元格的文案（Del / Backspace 用）：只动文字，不动结构 */
  | { kind: 'clearCells'; cellIds: string[] }
  /** 批量删除（选区覆盖到的行 / 列）—— indexes 是"可视列号" */
  | { kind: 'deleteRows'; rowIds: string[] }
  | { kind: 'deleteCols'; indexes: number[] }
  | { kind: 'toggleHeaderRow'; rowId: string }
  | { kind: 'addHeaderRow' }
  | { kind: 'removeHeaderRow' }
  | { kind: 'addFooterRow' }
  | { kind: 'removeFooterRow' }
  | { kind: 'addCaption' }
  | { kind: 'removeCaption' }
  | { kind: 'setCellType'; cellId: string; type: 'th' | 'td' };

const intAttr = (v: string | undefined) => Math.max(1, Number(v) || 1);
/** 轨道拖动一次最多插多少个（防止手一抖插出 200 行） */
const clampCount = (v: number | undefined) => Math.min(30, Math.max(1, Math.round(v ?? 1)));

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
      const n = clampCount(op.count);
      const at = op.side === 'before' ? Math.max(0, idx) : idx + 1;
      // 新行宽度 = 该位置"空着的列数"（上方有 rowspan 盖过来的话要少建几格，否则整行多出一列）
      const grid = buildGrid(parts.rows);
      let before = 0;
      for (const c of next.children) {
        if (c.id === sec.id) break;
        if (c.type === 'thead' || c.type === 'tbody' || c.type === 'tfoot') before += c.children.filter(isRow).length;
      }
      const width = freeWidthAt(grid, Math.min(before + at, grid.rowCount));
      for (let k = 0; k < n; k += 1) sec.children.splice(at + k, 0, makeRow(isHead, width));
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

    case 'deleteRows': {
      const ids = new Set(op.rowIds);
      // 至少要留一行数据行，避免把表格删空
      const survivors = parts.rows.filter((r) => !ids.has(r.id));
      if (survivors.length === 0) return next;
      for (const sec of next.children) {
        if (sec.type !== 'thead' && sec.type !== 'tbody' && sec.type !== 'tfoot') continue;
        sec.children = sec.children.filter((r) => !ids.has(r.id));
        if (sec.children.length === 0) {
          if (sec.type === 'tbody') sec.children = [makeRow(false, cols)];
          else next.children = next.children.filter((c) => c.id !== sec.id);
        }
      }
      // 过滤时可能已经改了 next.children（thead/tfoot 被摘掉）→ 用最新引用再兜一次
      for (const sec of [...next.children]) {
        if ((sec.type === 'thead' || sec.type === 'tbody' || sec.type === 'tfoot') && sec.children.length === 0) {
          if (sec.type === 'tbody') sec.children = [makeRow(false, cols)];
          else next.children = next.children.filter((c) => c.id !== sec.id);
        }
      }
      return next;
    }

    case 'insertCol': {
      // 一律换算成"可视列号"再插：refCellId 指向的格子可能本身是合并格
      const grid = buildGrid(parts.rows);
      const loc = op.refCellId ? grid.byId.get(op.refCellId) : null;
      const v = loc
        ? (op.side === 'before' ? loc.col : loc.col + loc.cs)
        : (op.side === 'before' ? Math.max(0, op.index ?? 0) : Math.max(0, op.index ?? 0) + 1);
      return insertColsAt(next, parts, v, op.count ?? 1);
    }

    case 'deleteCol': {
      const grid = buildGrid(parts.rows);
      const loc = op.refCellId ? grid.byId.get(op.refCellId) : null;
      const v = loc ? loc.col : Math.max(0, op.index ?? 0);
      return deleteColsAt(next, parts, [v]);
    }

    case 'deleteCols': {
      return deleteColsAt(next, parts, op.indexes);
    }

    case 'insertColAt': {
      // vcol = 插在第几个可视列之前（0 = 最前，>= 可视列数 = 最后）
      return insertColsAt(next, parts, op.vcol, op.count ?? 1);
    }

    case 'mergeRight': {
      const grid = buildGrid(parts.rows);
      const a = grid.byId.get(op.cellId);
      if (!a) return next;
      const right = grid.cells.find((g) => g.row === a.row && g.col === a.col + a.cs);
      if (!right) return next;
      return mergeCells(next, parts, a, a.cs + right.cs, Math.max(a.rs, right.rs));
    }

    case 'mergeDown': {
      const grid = buildGrid(parts.rows);
      const a = grid.byId.get(op.cellId);
      if (!a) return next;
      const below = grid.cells.find((g) => g.col === a.col && g.row === a.row + a.rs);
      if (!below) return next;
      return mergeCells(next, parts, a, Math.max(a.cs, below.cs), a.rs + below.rs);
    }

    case 'mergeRange': {
      const grid = buildGrid(parts.rows);
      const a = grid.byId.get(op.cellId);
      if (!a) return next;
      return mergeCells(next, parts, a, op.width, op.height);
    }

    case 'setRangeType': {
      const ids = new Set(op.cellIds);
      for (const row of parts.rows) {
        for (const cell of row.children) {
          if (!isCell(cell) || !ids.has(cell.id)) continue;
          cell.type = op.type;
          if (op.type === 'th') {
            cell.attrs = { ...(cell.attrs ?? {}), scope: cell.attrs?.scope ?? 'col' };
          } else if (cell.attrs) {
            const a = { ...cell.attrs };
            delete a.scope;
            cell.attrs = Object.keys(a).length > 0 ? a : undefined;
          }
        }
      }
      return next;
    }

    case 'clearCells': {
      const ids = new Set(op.cellIds);
      for (const row of parts.rows) {
        for (const cell of row.children) {
          if (isCell(cell) && ids.has(cell.id)) cell.text = '';
        }
      }
      return next;
    }

    case 'unmerge': {
      const grid = buildGrid(parts.rows);
      const a = grid.byId.get(op.cellId);
      if (!a) return next;
      const { cs, rs, row: r0, col: c0 } = a;
      if (cs === 1 && rs === 1) return next;
      const isHead = a.cell.type === 'th';
      // ① 自己先回到 1×1
      const attrs = { ...(a.cell.attrs ?? {}) };
      delete attrs.colspan;
      delete attrs.rowspan;
      a.cell.attrs = Object.keys(attrs).length > 0 ? attrs : undefined;
      // ② 本行右侧补 cs-1 个空位
      const i = a.rowNode.children.findIndex((c) => c.id === a.cell.id);
      for (let k = 1; k < cs; k += 1) a.rowNode.children.splice(i + k, 0, makeCell(isHead, ''));
      // ③ 下面每一行补 cs 个空位，插在"第 c0 列"的位置（各行的空格位置可能不同，不能沿用锚点行的下标）。
      //    ⚠ 是 cs 而不是 cs-1：锚点行只少了 cs-1 个（自己留着），下面各行被覆盖的 cs 个格子
      //      是整片消失的（含锚点正下方那格），少补一个那一行就永久少一列
      //      （历史 BUG：合并 2×2 再拆分，第二行掉一列）。
      for (let r = r0 + 1; r <= r0 + rs - 1 && r < grid.rowCount; r += 1) {
        const row = grid.rows[r];
        const at = insertIndexOf(row, c0);
        for (let k = 0; k < cs; k += 1) row.children.splice(Math.min(at + k, row.children.length), 0, makeCell(isHead, ''));
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
