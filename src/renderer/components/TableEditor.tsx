import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScene, findNode } from '@store/sceneStore';
import type { ElementStyle, SceneElement } from '@lib/types';
import {
  readTable, normalizeTable, buildGrid, canMergeRange, applyTableOp, findTableAncestor,
  type GridCell, type TableOp
} from '@lib/tableOps';
import { TABLE_STYLE_PRESETS, TABLE_STRUCTURE_TEMPLATES, applyTableStylePreset } from '@lib/tablePresets';
import { HelpButton } from './HelpButton';
import { ColorPicker, ColorField } from './ColorPicker';

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

/** 内边距四值（px 数字，方便拖动/输入直接算） */
type Pad = { top: number; right: number; bottom: number; left: number };
type PadSide = 'top' | 'right' | 'bottom' | 'left';
const PAD_NAME: Record<PadSide, string> = { top: '上', right: '右', bottom: '下', left: '左' };
const PAD_ZERO: Pad = { top: 0, right: 0, bottom: 0, left: 0 };
/** 没显式写内边距时，编辑器按这个显示（与 .tbl-cell 的默认内边距一致，拖动就从这里起算，不会突然跳到 0） */
const PAD_FALLBACK: Pad = { top: 5, right: 9, bottom: 5, left: 9 };
const PAD_MAX = 200;
const FONT_MIN = 6;
const FONT_MAX = 72;

const clampPad = (n: number) => Math.max(0, Math.min(PAD_MAX, Math.round(Number.isFinite(n) ? n : 0)));

/** 这一格有没有显式写过内边距 */
function hasPad(style: ElementStyle | undefined): boolean {
  return !!style && !!(style.padding || style.paddingTop || style.paddingRight || style.paddingBottom || style.paddingLeft);
}

/** 从样式里读出四边内边距（兼容 padding 简写：1/2/3/4 段都认） */
function readPad(style: ElementStyle | undefined): Pad {
  if (!style) return { ...PAD_ZERO };
  const num = (v: string | undefined) => {
    const n = parseFloat(String(v ?? '').replace('px', ''));
    return Number.isFinite(n) ? n : 0;
  };
  const shorthand = String(style.padding ?? '').trim();
  if (shorthand && shorthand !== '0') {
    const parts = shorthand.split(/\s+/).map((p) => num(p));
    if (parts.length === 1) return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
    if (parts.length === 2) return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
    if (parts.length === 3) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
    if (parts.length >= 4) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  }
  return {
    top: num(style.paddingTop), right: num(style.paddingRight),
    bottom: num(style.paddingBottom), left: num(style.paddingLeft)
  };
}

/** 表格级样式 → 编辑器里的"看起来像"（只取外观：底色/字色/字号/外框/圆角/阴影，不碰编辑器自己的布局） */
function tableLiveStyle(s: ElementStyle | undefined): React.CSSProperties {
  const out: Record<string, string | number | undefined> = {};
  if (!s) return out as React.CSSProperties;
  if (s.backgroundColor) out.background = s.backgroundColor;
  if (s.color) out.color = s.color;
  if (s.fontSize) out.fontSize = s.fontSize;
  if (s.fontFamily) out.fontFamily = s.fontFamily;
  if (s.fontWeight) out.fontWeight = s.fontWeight;
  if (s.letterSpacing) out.letterSpacing = s.letterSpacing;
  if (s.lineHeight) out.lineHeight = s.lineHeight;
  const bw = s.borderTopWidth, bs = s.borderTopStyle, bc = s.borderTopColor;
  if (bw || bs || bc) out.border = `${bw || '1px'} ${bs || 'solid'} ${bc || 'var(--border)'}`;
  if (s.borderTopLeftRadius) out.borderRadius = s.borderTopLeftRadius;
  if (s.boxShadow) out.boxShadow = s.boxShadow;
  // 内部网格线跟着边框颜色走，改一次颜色整张表的线一起变
  if (bc) out['--tbl-line'] = bc;
  return out as React.CSSProperties;
}

/**
 * 单元格最终外观 = 表格级（继承） + 这一格自己的覆盖。
 * ⚠ 底色走 CSS 变量 `--cell-bg`，不用内联 background ——
 *   否则内联样式会盖掉"选中/悬浮高亮"，选中的格子就看不出被选中了。
 */
function cellLiveStyle(cell: ElementStyle | undefined, table: ElementStyle | undefined): React.CSSProperties {
  const out: Record<string, string | number | undefined> = {};
  if (!cell) return out as React.CSSProperties;
  const bg = cell.backgroundColor ?? table?.backgroundColor;
  if (cell.backgroundColor) out['--cell-bg'] = bg;
  if (cell.color) out.color = cell.color;
  if (cell.fontSize) out.fontSize = cell.fontSize;
  if (cell.fontWeight) out.fontWeight = cell.fontWeight;
  if (cell.fontFamily) out.fontFamily = cell.fontFamily;
  if (cell.lineHeight) out.lineHeight = cell.lineHeight;
  if (cell.letterSpacing) out.letterSpacing = cell.letterSpacing;
  const pad = readPad(cell);
  if (pad.top || pad.right || pad.bottom || pad.left || cell.padding || cell.paddingTop) {
    out.padding = `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`;
  }
  if (cell.textAlign) {
    out.textAlign = cell.textAlign;
    out.justifyContent = cell.textAlign === 'center' ? 'center' : cell.textAlign === 'right' ? 'flex-end' : 'flex-start';
  }
  if (cell.verticalAlign) {
    out.alignItems = cell.verticalAlign === 'top' ? 'flex-start' : cell.verticalAlign === 'bottom' ? 'flex-end' : 'center';
  }
  return out as React.CSSProperties;
}

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

  /**
   * 整张表的二维网格：colspan 与 rowspan 都摊平，每格的 row/col/cs/rs 就是它真实的位置与跨度。
   * ⚠ 渲染、选区、插入轨全部走这张网格，不能走"单元格序号" ——
   *   一旦出现合并格，序号就和真实行列对不上（合并完渲染错位、插列插错位置都是这个原因）。
   */
  const grid = useMemo(() => buildGrid(parts ? parts.rows : []), [parts]);
  const cols = grid.cols;
  const rowCount = grid.rowCount;

  // ——— 选区派生 ———
  const rect = useMemo(() => {
    if (!sel || sel.kind !== 'cell') return null;
    return {
      r0: Math.min(sel.r, sel.r2), r1: Math.max(sel.r, sel.r2),
      c0: Math.min(sel.c, sel.c2), c1: Math.max(sel.c, sel.c2)
    };
  }, [sel]);

  /** 与选区有交叠的全部单元格（按可视矩形判定） */
  const rectCells = useMemo(() => {
    if (!rect) return [];
    return grid.cells
      .filter((g) => g.row <= rect.r1 && g.row + g.rs - 1 >= rect.r0 && g.col <= rect.c1 && g.col + g.cs - 1 >= rect.c0)
      .map((g) => g.cell);
  }, [rect, grid]);

  /** 选区左上角那一格（合并时保留内容的就是它）；整行 → 行节点 */
  const anchorBox: GridCell | null = rect
    ? grid.cells.find((g) => g.row === rect.r0 && g.col === rect.c0) ?? null
    : null;
  const anchor: SceneElement | null = anchorBox?.cell ?? null;
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

  // 首次进入：默认选中左上角那一格（按它真实跨度整格选中），右侧面板不至于是空的
  useEffect(() => {
    if (sel || rowCount === 0 || cols === 0) return;
    const first = grid.cells[0];
    setSel(first
      ? { kind: 'cell', r: first.row, c: first.col, r2: first.row + first.rs - 1, c2: first.col + first.cs - 1 }
      : { kind: 'cell', r: 0, c: 0, r2: 0, c2: 0 });
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

  // ——— 连续编辑会话（撤销只回退一步） ———
  // 拖内边距 / 拖字号 / 拖调色盘，一次交互 = 一条 undo：
  // beginStyleEdit 在开始压一个还原点，中间的 updateStyle 因 styleEditPending 不再压栈。
  // ⚠ 以前这里用 <input type="color"> 直接 updateStyle：系统调色盘一拖就是几十次 input 事件，
  //   历史里塞满中间色，Ctrl+Z 就得按几十下才"慢慢变回原来的颜色"。
  const beginEdit = () => useScene.getState().beginStyleEdit();
  const endEdit = () => useScene.getState().endStyleEdit();

  const applyPad = (p: Pad) => {
    if (!anchor) return;
    useScene.getState().updateStyle(anchor.id, {
      padding: undefined,
      paddingTop: p.top + 'px',
      paddingRight: p.right + 'px',
      paddingBottom: p.bottom + 'px',
      paddingLeft: p.left + 'px'
    });
  };

  const applyFont = (px: number) => {
    if (!anchor) return;
    useScene.getState().updateStyle(anchor.id, { fontSize: px > 0 ? px + 'px' : undefined });
  };

  type PadSession = { id: number; side: PadSide | 'all'; startX: number; startY: number; base: Pad };
  type SizeSession = { id: number; startX: number; base: number; left: number; width: number };
  const padSession = useRef<PadSession | null>(null);
  const sizeSession = useRef<SizeSession | null>(null);
  const styleSeq = useRef(0);
  const [padDrag, setPadDrag] = useState<{ id: number; side: PadSide | 'all' } | null>(null);
  const [sizeDrag, setSizeDrag] = useState<number | null>(null);

  const startPad = (side: PadSide | 'all', e: React.PointerEvent) => {
    if (e.button !== 0 || !anchor) return;
    e.preventDefault();
    e.stopPropagation();
    beginEdit();
    // 起点 = 预览上现在显示的内边距（没写过就是编辑器默认值），这样拖动跟手、不会突然归零
    const s: PadSession = { id: ++styleSeq.current, side, startX: e.clientX, startY: e.clientY, base: { ...pad } };
    padSession.current = s;
    setPadDrag({ id: s.id, side });
  };

  const startSize = (e: React.PointerEvent) => {
    if (e.button !== 0 || !anchor) return;
    e.preventDefault();
    e.stopPropagation();
    beginEdit();
    const track = e.currentTarget as HTMLElement;
    const r = track.getBoundingClientRect();
    const cur = parseFloat(String(anchor.style?.fontSize ?? table?.style?.fontSize ?? '').replace('px', ''));
    const s: SizeSession = {
      id: ++styleSeq.current, startX: e.clientX,
      base: Number.isFinite(cur) ? cur : 14, left: r.left, width: r.width
    };
    sizeSession.current = s;
    setSizeDrag(s.id);
    // 按下即定位（点哪就是哪个字号），拖动再继续跟手
    applyFont(Math.round((FONT_MIN + ((e.clientX - r.left) / Math.max(1, r.width)) * (FONT_MAX - FONT_MIN)) * 2) / 2);
  };

  // 内边距拖动：会话放 ref，effect 只依赖会话 id（别把每次移动的坐标写进依赖，会重挂监听把起点刷掉）
  useEffect(() => {
    if (!padDrag) return;
    const onMove = (e: PointerEvent) => {
      const s = padSession.current;
      if (!s) return;
      const fast = e.shiftKey ? 3 : 1;
      const dx = (e.clientX - s.startX) * fast;
      const dy = (e.clientY - s.startY) * fast;
      const next: Pad = { ...s.base };
      if (s.side === 'top' || s.side === 'all') next.top = clampPad(s.base.top + dy);
      if (s.side === 'bottom' || s.side === 'all') next.bottom = clampPad(s.base.bottom - dy);
      if (s.side === 'left' || s.side === 'all') next.left = clampPad(s.base.left + dx);
      if (s.side === 'right' || s.side === 'all') next.right = clampPad(s.base.right - dx);
      applyPad(next);
    };
    const finish = () => {
      padSession.current = null;
      setPadDrag(null);
      endEdit();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('keydown', onKey);
    document.body.classList.add('bc-style-dragging');
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('bc-style-dragging');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padDrag?.id]);

  // 字号拖动：普通模式 = 按滑杆位置定位；按住 Shift = 相对起点微调（0.5px 一档）
  useEffect(() => {
    if (sizeDrag === null) return;
    const onMove = (e: PointerEvent) => {
      const s = sizeSession.current;
      if (!s) return;
      const v = e.shiftKey
        ? s.base + (e.clientX - s.startX) * 0.25
        : FONT_MIN + Math.max(0, Math.min(1, (e.clientX - s.left) / Math.max(1, s.width))) * (FONT_MAX - FONT_MIN);
      applyFont(Math.max(1, Math.round(v * 2) / 2));
    };
    const finish = () => {
      sizeSession.current = null;
      setSizeDrag(null);
      endEdit();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('keydown', onKey);
    document.body.classList.add('bc-style-dragging');
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('bc-style-dragging');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeDrag]);

  // ——— 双击格子直接改字（编辑器里就地编辑，比来回看右侧面板顺手） ———
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const lastClickRef = useRef<{ id: string; t: number } | null>(null);

  /** 收尾当前就地编辑：写回文案（一条 undo），空值等于清空 */
  const commitCellEdit = () => {
    if (!editingCellId) return;
    useScene.getState().setText(editingCellId, editDraft);
    setEditingCellId(null);
  };
  const cancelCellEdit = () => setEditingCellId(null);

  /**
   * 双击判定自己做（不靠 onDoubleClick）：格子的 pointerdown 里 preventDefault 过，
   * 浏览器那套 dblclick 不一定还发得出来。400ms 内同一格连点两次 = 进入编辑。
   */
  const detectDoubleClick = (cell: SceneElement): boolean => {
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && last.id === cell.id && now - last.t < 400) {
      lastClickRef.current = null;
      setEditDraft(cell.text ?? '');
      setEditingCellId(cell.id);
      return true;
    }
    lastClickRef.current = { id: cell.id, t: now };
    return false;
  };

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
    // 按"可视列号"插入：合并过的一行里，序号和列号不是一回事
    runOp({ kind: 'insertColAt', vcol: Math.min(at, cols), count });
  };

  // ——— 单元格框选（按住拖出矩形） ———
  // 拖动会话记的是"锚点那一格的完整格子盒"（含它的 colspan/rowspan），
  // 选区永远吸附到格子边界上：不然压着合并格的边拖，合并判定会因为"只切到半格"而整体放弃。
  const draggingRef = useRef<{ r0: number; c0: number; r1: number; c1: number } | null>(null);
  const extendTo = (g: GridCell) => {
    const a = draggingRef.current;
    if (!a) return;
    setSel({
      kind: 'cell',
      r: Math.min(a.r0, g.row), c: Math.min(a.c0, g.col),
      r2: Math.max(a.r1, g.row + g.rs - 1), c2: Math.max(a.c1, g.col + g.cs - 1)
    });
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
      const g = buildGrid(readTable(normalizeTable(cur)).rows);
      let ids: string[] = [];
      if (sel?.kind === 'row') ids = g.cells.filter((c) => c.row === sel.r).map((c) => c.cell.id);
      else if (sel?.kind === 'col') ids = g.cells.filter((c) => c.col <= sel.c && c.col + c.cs - 1 >= sel.c).map((c) => c.cell.id);
      else if (rect) {
        ids = g.cells
          .filter((c) => c.row <= rect.r1 && c.row + c.rs - 1 >= rect.r0 && c.col <= rect.c1 && c.col + c.cs - 1 >= rect.c0)
          .map((c) => c.cell.id);
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
  /** 这一格的内边距四值（右侧预览的间距 = 它，拖动改的也是它）；没写过就按编辑器默认显示 */
  const pad = hasPad(cellStyle) ? readPad(cellStyle) : { ...PAD_FALLBACK };
  /** 字号滑杆位置：这一格没写就跟着表格默认走 */
  const sizeVal = parseFloat(String(cellStyle.fontSize ?? table.style?.fontSize ?? '').replace('px', ''));
  const sizeBase = Number.isFinite(sizeVal) && sizeVal > 0 ? sizeVal : 14;
  const sizePct = Math.round(Math.max(0, Math.min(100, ((sizeBase - FONT_MIN) / (FONT_MAX - FONT_MIN)) * 100)));
  /** 表格标题在预览里放上还是放下（跟 captionSide 一致） */
  const captionTop = (table.style?.captionSide ?? 'top') !== 'bottom';
  const rectArea = rect ? (rect.r1 - rect.r0 + 1) * (rect.c1 - rect.c0 + 1) : 0;
  /** 锚点这一格已经合并过（跨度 > 1） */
  const merged = !!anchorBox && (anchorBox.cs > 1 || anchorBox.rs > 1);
  /** 选区正好就是锚点自己那一格（没有任何可合并的东西） */
  const sameAsAnchor = !!anchorBox && !!rect
    && rect.r0 === anchorBox.row && rect.c0 === anchorBox.col
    && rect.r1 === anchorBox.row + anchorBox.rs - 1 && rect.c1 === anchorBox.col + anchorBox.cs - 1;
  /**
   * 能不能合并：选区不止一格 + **矩形正好由完整格子拼满**（判定用 tableOps 里同一套 planMerge，
   * 所以按钮亮着就一定合得上）。
   * ⚠ 不能用"锚点自己已经合并过"来禁用：把两行各自横向合并、再纵向合并成一块是常见做法，
   *   那时锚点必然是已合并的（旧守卫会把这种合并挡掉，表现为"点了没反应"）。
   */
  const canMerge = !!anchor && rectArea > 1 && !sameAsAnchor
    && canMergeRange(grid, anchor.id, rect!.c1 - rect!.c0 + 1, rect!.r1 - rect!.r0 + 1);

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
              content={'【插入行 / 列】\n把鼠标移到行与行、列与列之间那条缝上，会浮出一条轨道和 ＋。\n· 点一下：插入 1 行 / 1 列\n· 按住 ＋ 沿"列往右拖 / 行往下拖"：一次插入多个，气泡上会实时显示要插几个\n· 拖过头了按 Esc 取消\n· 插入点落在某个合并格内部时，会自动吸附到那个格子的左边（保证每一行都在同一列边界上插，不会错位）\n\n【选中与合并】\n· 在格子上按住鼠标拖 → 拖选出一片（矩形选区，自动吸附到格子边界）\n· Ctrl / ⌘ + 点某一格 → 把这一格并进当前选区（选区始终是矩形，取并集）\n· Shift + 点 → 从选区左上角拉到你点的那一格\n· 点行号 / 列号 → 选中整行 / 整列\n· 选中后，上面那条操作条会亮起来：合并 / 拆分 / 设为表头 / 删除行 / 删除列\n\n【合并的规则】\n· 只有"选区正好由完整格子拼满"才允许合并；压到已有合并格的边上时，\n  「合并」按钮会灰着并把鼠标停上去写明原因 —— 不会出现"点了没反应"\n· 合并后只有左上角那格的内容保留，其余格子整格消失；用「拆分」还原\n· 可以先把两行各自横向合并、再把它们纵向合并成一块（2×2 一次合上也行）\n\n【删除】\n按 Del / Backspace = 清空选中格子的文字（只动内容，不动结构）。\n要删掉整行 / 整列，请用操作条上的「删行 / 删列」。\n删列时如果那一列正处在某个合并格内部，那一格不会被硬拆（该列在那一行保留）。\n\n【跨度标记】\n合并后的格子右下角会显示 ⇥（跨几列）与 ⇩（跨几行）。'}
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
                title={
                  rectArea <= 1 ? '先拖选一片格子（≥2 格）再合并'
                    : sameAsAnchor ? '这一片已经是一格了 —— 想还原用「拆分」'
                      : !canMerge ? '选区压到了已有合并格的边上 —— 把选区对齐到格子边界（或先拆分那一格）'
                        : '把框选的这一片合并成一格（只有左上角那格的内容会保留）'
                }
                onClick={() => anchor && runOp({ kind: 'mergeRange', cellId: anchor.id, width: rect!.c1 - rect!.c0 + 1, height: rect!.r1 - rect!.r0 + 1 })}
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
                style={{
                  gridTemplateColumns: gridCols,
                  gridTemplateRows: gridRows,
                  // 表格级样式实时生效：改底色 / 字色 / 字号 / 外框 / 圆角 / 阴影，左边这张网格立刻跟着变
                  ...tableLiveStyle(table.style)
                }}
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

                {/* 单元格：位置/跨度直接用网格算出的真实 row/col/cs/rs 摆位
                    （跨列跨行的格子在 CSS Grid 里就是 span，行与行之间自动对齐） */}
                {grid.cells.map((g) => {
                  const cell = g.cell;
                  const { row: r, col: c, cs, rs } = g;
                  const cEnd = c + cs - 1;
                  const rEnd = r + rs - 1;
                  const inRect = !!rect && r <= rect.r1 && rEnd >= rect.r0 && c <= rect.c1 && cEnd >= rect.c0;
                  const isAnchor = !!rect && r === rect.r0 && c === rect.c0;
                  const inRow = sel?.kind === 'row' && sel.r >= r && sel.r <= rEnd;
                  const inCol = sel?.kind === 'col' && sel.c >= c && sel.c <= cEnd;
                  return (
                    <div
                      key={cell.id}
                      data-cell={`${r}-${c}`}
                      data-cell-id={cell.id}
                      data-span={`${cs}x${rs}`}
                      className={
                        'tbl-gcell tbl-cell'
                        + (cell.type === 'th' ? ' is-th' : '')
                        + (inRect && sel?.kind === 'cell' ? ' picked' : '')
                        + (inRow || inCol ? ' picked' : '')
                        + (isAnchor && sel?.kind === 'cell' ? ' active' : '')
                      }
                      style={{
                        gridColumn: `${3 + 2 * c} / span ${2 * cs - 1}`,
                        gridRow: `${3 + 2 * r} / span ${2 * rs - 1}`,
                        ...cellLiveStyle(cell.style, table.style)
                      }}
                      title={`第 ${r + 1} 行 · 第 ${colLetter(c)} 列${cs > 1 ? `（跨 ${cs} 列）` : ''}${rs > 1 ? `（跨 ${rs} 行）` : ''}（按住可拖选一片；Ctrl/⌘ 点 = 并进选区；双击 = 改文字）`}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        // 双击 = 就地改字：先把上一格的编辑收尾，别把改动丢了
                        if (editingCellId && editingCellId !== cell.id) commitCellEdit();
                        if (detectDoubleClick(cell)) {
                          e.preventDefault();
                          draggingRef.current = null;
                          return;
                        }
                        e.preventDefault();
                        const box = { r0: r, c0: c, r1: rEnd, c1: cEnd };
                        // Ctrl/⌘ + 点：把这一格并进现有选区。
                        // 选区本身始终是矩形（合并需要矩形），所以取"并集的外接矩形"，
                        // 锚点自动落到左上角（合并后保留内容的也是那一格）。
                        if ((e.ctrlKey || e.metaKey) && rect) {
                          draggingRef.current = null;
                          setSel({
                            kind: 'cell',
                            r: Math.min(rect.r0, box.r0), c: Math.min(rect.c0, box.c0),
                            r2: Math.max(rect.r1, box.r1), c2: Math.max(rect.c1, box.c1)
                          });
                          return;
                        }
                        // Shift + 点：从选区左上角拉到你点的那一格（含它的整格跨度）
                        if (e.shiftKey && rect) {
                          draggingRef.current = null;
                          setSel({ kind: 'cell', r: rect.r0, c: rect.c0, r2: box.r1, c2: box.c1 });
                          return;
                        }
                        draggingRef.current = box;
                        setSel({ kind: 'cell', r: box.r0, c: box.c0, r2: box.r1, c2: box.c1 });
                      }}
                      onPointerEnter={() => extendTo(g)}
                      onPointerMove={() => extendTo(g)}
                    >
                      {editingCellId === cell.id ? (
                        <input
                          className="tbl-cell-input"
                          autoFocus
                          value={editDraft}
                          spellCheck={false}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onPointerDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') commitCellEdit();
                            else if (e.key === 'Escape') cancelCellEdit();
                          }}
                          onBlur={commitCellEdit}
                        />
                      ) : (
                        <span
                          className="tbl-cell-text"
                          style={{ whiteSpace: cell.style?.whiteSpace === 'nowrap' ? 'nowrap' : 'normal' }}
                        >{(cell.text ?? '').trim() || ' '}</span>
                      )}
                      {cs > 1 && <span className="tbl-cell-badge">⇥{cs}</span>}
                      {rs > 1 && <span className="tbl-cell-badge">⇩{rs}</span>}
                    </div>
                  );
                })}

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
                title="单元格属性怎么改"
                content={'【大预览 + 直接拖】\n右边这块就是这一格的实时预览（和左边表格同步）：\n· 鼠标放到虚线边上 → 拖动 = 改那一边的内边距（往外拖变大、往里拖变小；按住 Shift 拖得快）\n· 拖右下角小方块 = 四边一起改\n· 字号那条滑杆：按住左右拖 = 改字号；按住 Shift 拖 = 微调（0.5px 一档）\n· 颜色块点一下 = 打开调色盘选色（也可以直接改数值，同样实时生效）\n\n【文案】这一格里显示的字。\n也可以直接在左边表格里**双击格子**改字：回车确认、Esc 取消、点别处自动保存。\n\n【类型 th / td】\n· td = 普通数据格\n· th = 表头格（浏览器默认加粗居中、屏幕阅读器会当成"这行/这列的名字"）\n\n【scope】只对 th 有意义：告诉屏幕阅读器这个表头管的是哪一片。\n· col = 管它下面这一列 · row = 管它右边这一行\n· colgroup / rowgroup = 管这一整列组 / 行组（一般配合 <colgroup> 用）\n\n【colspan / rowspan】跨几列 / 跨几行。\n选一片格子点"合并"就是自动填这两个值；此处手填适合做精细控制。\n\n【内边距】文字到格子边框的距离（上 / 右 / 下 / 左 四个数值，和拖动等价）。\n【不换行】打开后这一格的长文字不再折行（表格会因此变宽）。\n\n⚠ 这里改的都会立刻反映到左边表格上；一次拖动 = 一条撤销记录，Ctrl+Z 一下回到拖动前。'}
              />
            </div>
            {!selNode || (selNode.type !== 'th' && selNode.type !== 'td') ? (
              <div className="tbl-empty">
                {sel?.kind === 'row' ? '当前选的是整行 —— 点一个具体格子可以改它的样式。' : '先在左侧点一个格子。'}
              </div>
            ) : (
              <>
                {/* 大预览：底色/字色/字号/对齐/内边距全在这里看，虚线边可以直接拖 */}
                <div className="cpv-block">
                  <div
                    className={'cpv-box' + (padDrag ? ' is-dragging' : '')}
                    style={{
                      padding: `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`,
                      background: cellStyle.backgroundColor || undefined,
                      alignItems: cellStyle.verticalAlign === 'top' ? 'flex-start'
                        : cellStyle.verticalAlign === 'bottom' ? 'flex-end' : 'center'
                    }}
                  >
                    <div
                      className="cpv-content"
                      style={{
                        color: cellStyle.color || undefined,
                        fontSize: cellStyle.fontSize || table.style?.fontSize || undefined,
                        fontWeight: (cellStyle.fontWeight ?? (selNode.type === 'th' ? '600' : undefined)) as React.CSSProperties['fontWeight'],
                        textAlign: (cellStyle.textAlign ?? undefined) as React.CSSProperties['textAlign'],
                        whiteSpace: cellStyle.whiteSpace === 'nowrap' ? 'nowrap' : 'pre-wrap'
                      }}
                    >
                      {(selNode.text ?? '').trim() || '（空）'}
                    </div>
                    {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                      <div
                        key={side}
                        className={'cpv-edge is-' + side + (padDrag?.side === side ? ' active' : '')}
                        title={`拖动改「${PAD_NAME[side]}」内边距（往外拖变大 · 按住 Shift 拖得快）`}
                        onPointerDown={(e) => startPad(side, e)}
                      />
                    ))}
                    <div
                      className={'cpv-corner' + (padDrag?.side === 'all' ? ' active' : '')}
                      title="拖动 = 四边内边距一起改"
                      onPointerDown={(e) => startPad('all', e)}
                    />
                  </div>
                  <div className="cpv-readout">
                    <span>内边距 <b>{pad.top}</b> · <b>{pad.right}</b> · <b>{pad.bottom}</b> · <b>{pad.left}</b> px</span>
                    <span className="cpv-hint">拖虚线边 / 右下角改</span>
                  </div>
                </div>

                {/* 字号：滑杆拖动 + 数值输入，改哪边都实时生效 */}
                <div className="cpv-size">
                  <div className="cpv-size-head">
                    <span>字号</span>
                    <b>{cellStyle.fontSize || '继承表格'}</b>
                  </div>
                  <div
                    className={'cpv-size-track' + (sizeDrag !== null ? ' is-dragging' : '')}
                    title="按住左右拖动改字号（按住 Shift = 微调 0.5px 一档）"
                    onPointerDown={startSize}
                  >
                    <div className="cpv-size-fill" style={{ width: sizePct + '%' }} />
                    <div className="cpv-size-knob" style={{ left: sizePct + '%' }} />
                  </div>
                  <input
                    className="cpv-size-num"
                    type="number" min={FONT_MIN} max={FONT_MAX} step={0.5}
                    value={parseFloat(String(cellStyle.fontSize ?? '').replace('px', '')) || ''}
                    placeholder="继承"
                    title="也可以直接填数值（px，留空 = 继承表格）"
                    onFocus={beginEdit}
                    onChange={(e) => applyFont(parseFloat(e.target.value) || 0)}
                    onBlur={endEdit}
                  />
                </div>

                <label className="tbl-field">
                  <span>文案 <em>也可直接双击左边格子</em></span>
                  <input
                    value={cellDraft}
                    onFocus={() => { editingRef.current = true; }}
                    onChange={(e) => setCellDraft(e.target.value)}
                    onBlur={() => { editingRef.current = false; useScene.getState().setText(selNode.id, cellDraft); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  />
                </label>

                {/* 内边距四值：与拖动等价，改哪边动哪边 */}
                <div className="tbl-field-row">
                  {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <label className="tbl-field tiny" key={side}>
                      <span>边距 {PAD_NAME[side]}</span>
                      <input
                        type="number" min={0} max={PAD_MAX}
                        value={pad[side]}
                        title={`「${PAD_NAME[side]}」内边距（px）`}
                        onFocus={beginEdit}
                        onChange={(e) => applyPad({ ...pad, [side]: clampPad(parseFloat(e.target.value) || 0) })}
                        onBlur={endEdit}
                      />
                    </label>
                  ))}
                </div>

                {/* 颜色：点色块开调色盘（拖动过程只留一条 undo），旁边数值同样实时 */}
                <div className="tbl-field-row">
                  <label className="tbl-field small">
                    <span>底色 <em>这一格的背景</em></span>
                    <ColorPicker elementId={selNode.id} styleKey="backgroundColor" fallback="#ffffff" />
                  </label>
                  <label className="tbl-field small">
                    <span>字色 <em>这一格的文字</em></span>
                    <ColorPicker elementId={selNode.id} styleKey="color" fallback="#1f2328" />
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
                    <span>不换行 <em>长文不折行</em></span>
                    <input
                      type="checkbox"
                      checked={cellStyle.whiteSpace === 'nowrap'}
                      onChange={(e) => setStyleOf(selNode.id, { whiteSpace: e.target.checked ? 'nowrap' : '' })}
                    />
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
                content={'【预览】上面那块是"大致效果"预览（不是左边那张结构网格）：\n底色 / 字色 / 字号 / 外框线型粗细颜色 / 圆角 / 阴影 / 边框间距 / 标题位置 都会立刻画出来。\n⚠ 预览只画外观：宽度与布局算法（auto / fixed）影响的是真实排版与导出结果，预览里不体现。\n\n【宽度】整张表占容器多宽。100% = 撑满；写 480px 就是固定宽。\n\n【布局算法】\n· auto 自动：浏览器按内容自己分配列宽（内容长的列更宽）\n· fixed 固定：严格按第一行各列的宽度分，之后的列不会再被内容撑变 —— 数据对齐更整齐\n\n【边框合并】\n· collapse 合并：相邻格共用一条线，传统表格的样子\n· separate 分离：每格各自有边框，中间留缝（配合"边框间距"做卡片感）\n\n【边框间距】只在"分离"模式下生效：格子之间留多少空隙，例如 2px。\n\n【外框样式 / 粗细 / 颜色】整张表最外面那一圈边框。\n【圆角】表格四角切圆，配合"边框合并 = 分离"才看得出效果。\n【阴影】整张表底下的投影，例如 0 6px 20px rgba(15,23,42,.08)。\n\n⚠ 这里每改一项，左边表格与上面预览都会立刻跟着变；连续输入算一条撤销记录。'}
              />
            </div>

            {/* 大致效果预览：按当前样式把"这张表长什么样"画出来，改下方任意一项立刻变 */}
            <div className="tpv-wrap">
              <div className="tpv-label">预览 · 大致效果</div>
              {parts.caption && captionTop && (
                <div className="tpv-caption">{parts.caption.text?.trim() || '表格标题'}</div>
              )}
              <div
                className="tpv-table"
                style={{
                  ...tableLiveStyle(table.style),
                  display: 'flex',
                  flexDirection: 'column',
                  gap: table.style.borderCollapse === 'separate' ? (table.style.borderSpacing || '2px') : '0px',
                  padding: '2px'
                }}
              >
                {[0, 1, 2].map((r) => (
                  <div
                    className="tpv-row"
                    key={r}
                    style={{ display: 'flex', gap: table.style.borderCollapse === 'separate' ? (table.style.borderSpacing || '2px') : '0px' }}
                  >
                    {[0, 1, 2].map((c) => (
                      <div
                        key={c}
                        className={'tpv-cell' + (r === 0 ? ' is-head' : '')}
                        style={{
                          flex: '1 1 0',
                          minWidth: 0,
                          padding: '4px 6px',
                          fontSize: table.style.fontSize || '11px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          border: (table.style.borderTopStyle && table.style.borderTopStyle !== 'none')
                            ? `${table.style.borderTopWidth || '1px'} ${table.style.borderTopStyle} ${table.style.borderTopColor || 'var(--border)'}`
                            : '1px solid var(--border)'
                        }}
                      >
                        {r === 0 ? `列 ${c + 1}` : `${r} · ${c + 1}`}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {parts.caption && !captionTop && (
                <div className="tpv-caption">{parts.caption.text?.trim() || '表格标题'}</div>
              )}
            </div>
            <div className="tbl-field-row">
              <label className="tbl-field small">
                <span>宽度 <em>整表占多宽</em></span>
                <input
                  value={table.style.width ?? ''}
                  placeholder="100%"
                  onFocus={beginEdit}
                  onBlur={endEdit}
                  onChange={(e) => setStyleOf(tableId, { width: e.target.value })}
                />
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
                <input
                  value={table.style.borderSpacing ?? ''}
                  placeholder="如 2px"
                  onFocus={beginEdit}
                  onBlur={endEdit}
                  onChange={(e) => setStyleOf(tableId, { borderSpacing: e.target.value })}
                />
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
                {/* 用 ColorField 自己管会话：色盘里拖一下 = 一条 undo，且四边颜色一起写 */}
                <ColorField
                  value={table.style.borderTopColor ?? ''}
                  fallback="#d0d7de"
                  inputClassName="tbl-color-input"
                  onInputFocus={beginEdit}
                  onChange={(v) => setStyleOf(tableId, { borderTopColor: v, borderRightColor: v, borderBottomColor: v, borderLeftColor: v })}
                  onInputBlur={endEdit}
                  onModalOpen={beginEdit}
                  onModalClose={endEdit}
                />
              </label>
            </div>
            <div className="tbl-field-row">
              <label className="tbl-field small">
                <span>圆角 <em>表格四角</em></span>
                <input
                  value={table.style.borderTopLeftRadius ?? ''}
                  placeholder="如 10px"
                  onFocus={beginEdit}
                  onBlur={endEdit}
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
                <ColorPicker elementId={tableId} styleKey="color" fallback="#1f2328" />
              </label>
              <label className="tbl-field small">
                <span>底色 <em>整表默认</em></span>
                <ColorPicker elementId={tableId} styleKey="backgroundColor" fallback="#ffffff" />
              </label>
              <label className="tbl-field small">
                <span>阴影 <em>eg 0 6px 20px</em></span>
                <input
                  value={table.style.boxShadow ?? ''}
                  placeholder="可留空"
                  onFocus={beginEdit}
                  onBlur={endEdit}
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

          {/* 导出前体检：表格默认不参与（td/th 一般不起类名、也不写 CSS，参与体检会报一堆"未命名元素"） */}
          <div className="tbl-card">
            <div className="tbl-card-head">
              <div className="tbl-card-title">导出前体检</div>
              <HelpButton
                title="表格与「导出前体检」"
                content={'「导出前体检」会统计未命名元素、重复 ID、同名样式不统一之类的问题。\n\n表格是一类特例：一格一个 <td>/<th>，正常做表格时既不给每个格子起类名，也不用 CSS 单独描述它们 ——\n参与体检只会刷出一大串"未命名元素"，把真正要处理的问题淹掉。\n\n所以**表格默认不参与体检**（这个开关默认关闭）。\n如果这张表你确实用类名 / 关系选择器管了样式，想把它的格子也纳入体检，把开关打开即可。\n\n开关只影响"体检清单"，不影响导出：表格该导出的标签、colspan/rowspan、scope 一个都不会少。'}
              />
            </div>
            <label className="tbl-switch-row">
              <input
                type="checkbox"
                checked={table.healthCheck === true}
                onChange={(e) => useScene.getState().setHealthCheck(tableId, e.target.checked)}
              />
              <span className="tbl-switch-text">
                <b>让这张表参与导出前体检</b>
                <em>
                  默认关闭 = 表格与它的所有单元格不出现在体检清单里
                  （不再报「未命名元素 / 类名 ID 问题」）。打开后这张表重新纳入体检。
                </em>
              </span>
            </label>
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

/** 找某节点的父容器 id（找不到就返回 null = 插到画布根） */
function findParentOf(root: SceneElement, id: string): string | null {
  for (const c of root.children) {
    if (c.id === id) return root.id;
    const r = findParentOf(c, id);
    if (r) return r;
  }
  return null;
}
