// BlockCanvas · 画布交互的公共类型
//
// 这些类型原先都挤在 Canvas.tsx 里（与 2400 行业务代码混在一起），
// 拆出来后 SVG/几何/拖拽/覆盖层各模块共用同一份定义，不会出现"两边各写一遍"。

/** Alt 交互的热区边（四边 + 四角） */
export type AltEdge = 'l' | 'r' | 't' | 'b' | 'tl' | 'tr' | 'bl' | 'br';

/** Alt 交互的三种模式：贴边=改大小 / 文字中间=改字号 / 其它中间=移动 */
export type AltMode = 'resize' | 'font' | 'move';

/** 一根条（墙提示线 / 撞墙闪烁块）：client 坐标 */
export type Bar = { x: number; y: number; w: number; h: number };

/** Alt 拖动时 F12 式盒模型的数据（全部是 client 坐标 / px 数值） */
export type AltBoxModelData = {
  x: number; y: number; w: number; h: number;
  mt: number; mr: number; mb: number; ml: number;
  bt: number; br: number; bb: number; bl: number;
  pt: number; pr: number; pb: number; pl: number;
  posLabel: string;
  /** relative 才有意义：当前 left / top 偏移量 */
  offsetX: number; offsetY: number;
  /** v0.4.5：场景样式里写成 auto 的边（computed 会把 auto 算成具体像素，只能回场景读） */
  autoSides: string[];
  /** v0.4.5：定位偏移的原始写法（可能是 'auto'），fixed/absolute 时画布上要能看到 */
  insets: { top: string; right: string; bottom: string; left: string };
  /** v0.4.5：定位方式（决定画布上显示哪些辅助） */
  posKind: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
};

/** 元素"能动到哪儿"：四边界限（client 坐标）+ 每面墙的整面高亮条 + 吸附参考线 */
export type Bounds = {
  minX: number; maxX: number; minY: number; maxY: number;
  barL: Bar | null; barR: Bar | null; barT: Bar | null; barB: Bar | null;
  snapX: number[]; snapY: number[];
};

/** 一次 Alt 拖拽的全部状态（存在 ref 里，不进 React state） */
export type AltDragState = {
  id: string; mode: AltMode; edge: AltEdge | null;
  startX: number; startY: number;
  rect: DOMRect;
  startW: number; startH: number;
  /** 移动基准：定位元素用计算后的 left/top；常规流用 margin */
  positioned: boolean; isFixed: boolean;
  posKind: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  /**
   * v0.4.5 第 15 批：**双边约束**（left+right / top+bottom 且没写 width/height）。
   * 这类元素的尺寸是两边撑出来的，拖动必须"两边一起平移"，否则盒子会塌掉。
   * 这里记下起始的右/下偏移，平移时用它算（而不是每帧按距离反推，避免夹取误差累积）。
   */
  startRight: number; startBottom: number;
  stretchX: boolean; stretchY: boolean;
  startLeft: number; startTop: number;
  startMarginL: number; startMarginT: number;
  /** 允许移动/缩放的 client 坐标范围（"墙"）+ 每面墙要画的整条边 + 吸附参考线 */
  bounds: Bounds;
  /** 拖动时常显的"可达边界"提示线（橙色） */
  walls: Bar[];
  /** 撞墙后继续往外拖 → 进入"改父子关系"模式（被拖元素淡化、鼠标下元素高亮） */
  reparent: boolean;
  dropId: string | null;
  parentId: string | null;
  startFont: number;
  engaged: boolean;
  /** v0.4.5：最后一次 pointermove 的 client 坐标（松手贴边判定要用"手拖到哪儿了"） */
  lastX: number;
  lastY: number;
  /**
   * v0.4.5：定位元素这一趟拖动**锚定在哪一边**（每次拖动开始时决定一次，中途不再改）。
   * 以前每帧都按"离哪边近"重算，元素横跨中线时 left/right 会来回争抢 → 视觉抖动。
   * relative / sticky 固定用 left / top（它们的偏移是相对自身文档流位置，用 right/bottom 反而绕）。
   */
  axisSide: { x: 'left' | 'right'; y: 'top' | 'bottom' };
};

/** Alt 悬停态：鼠标下是谁、贴着哪条边、该进哪种模式 */
export type AltHover = {
  id: string; edge: AltEdge | null; mode: AltMode;
  rect: { x: number; y: number; w: number; h: number };
};

/** 框选拖拽状态（内容坐标系：起点钉在画布内容上，滚动时选框跟着内容走） */
export type MarqueeDrag = {
  startX: number; startY: number;   // 起点（client）
  startCx: number; startCy: number; // 起点（内容坐标，= client - wrapRect + scroll）
  scrollLeft0: number; scrollTop0: number; // 起框时的滚动量（诊断用）
  active: boolean;
  ctrl: boolean;
  wrapRect: DOMRect;
};
