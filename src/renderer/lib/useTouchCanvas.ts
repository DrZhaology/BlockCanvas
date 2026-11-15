// ============================================================================
// BlockCanvas · v0.4.6 竖屏画布触屏手势层
// ----------------------------------------------------------------------------
// 用户原话：
//   「触屏的整个操作逻辑需要修改，现在我在空白画布上滑动都会触发选中。」
//   「选中元素不要点击，要求长按。」
//   「长按选中了一个元素，再次长按别的元素可以多选。」
//   「单指一律平移（空白处和元素上都一样），双指缩放。」
//
// 做法：在 `.canvas-wrap` 的**捕获阶段**接管指针，完全不让画布原有的
// 「pointerdown 选元素 / 拖框 / 点击选中」拿到事件 —— 那些是鼠标语义，
// 在竖屏上会造成"一滑就选"。接管之后由这里重新定义：
//
//   单指按住 ≥420ms 不动      → 长按选中（已在选区里 = 取消它，否则加选）
//   长按落在空白             → 清空选区
//   单指按下后移动 >8px      → 平移画布（取消长按计时）
//   双指                     → 缩放（按两指间距比例改 zoom）+ 跟手平移
//
// ⚠ 为什么按 data-shell='stack' 而不是 data-input='touch' 生效：
//   竖屏是**交互模型**不同，不只是设备不同。窄窗口用鼠标时，"一滑就选中"同样烦人；
//   而且我们的验收就是在桌面把窗口拉到 412×915 做的，按输入轴门控会让验收者看不到效果。
//   宽屏（split）完全不受影响，桌面端一条老逻辑都不动。
// ============================================================================
import { useEffect, useRef } from 'react';
import { portraitPrefsNow } from './portraitPrefs';

const HOLD_MS = 420; // 兜底值；实际用设置页「竖屏设置 → 长按判定」里的值
const holdMs = () => portraitPrefsNow().holdMs || HOLD_MS;
const MOVE_TOL = 8;
/**
 * 「再来一次长按才算取消选中」的闸门：
 *   按住 → 抬起 之间只允许 doSelect 生效一次。实测同一次按住里长按定时器会被
 *   二次执行（约 0.7s 后又一次），第一次把元素选中、第二次就走到"再长按一次取消它"
 *   的分支，把刚选中的又取消掉 —— 现象就是"长按元素选不上"
 *   （probe-portrait-input / probe-touch-canvas 都在这条上翻过车）。
 *   抬起后才把闸门打开：真正想取消选中 = 松手再按一次，行为没变。
 */
let holdArmed = false;
/** 手指是否还按着（模块级：跨监听实例也能看到）。用来丢掉"手指已抬起后才开火"的残留定时器 */
let pressDown = false;

type Pt = { x: number; y: number };

export function useTouchCanvas(opts: {
  enabled: boolean;
  zoom: number;
  onZoomChange: (z: number) => void;
  minZoom?: number;
  maxZoom?: number;
}) {
  const { enabled, zoom, onZoomChange, minZoom = 0.2, maxZoom = 3 } = opts;
  // 用 ref 读最新值：监听只挂一次，不能因为 zoom 变化重挂（重挂会把进行中的手势打断）
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomCb = useRef(onZoomChange);
  zoomCb.current = onZoomChange;

  useEffect(() => {
    if (!enabled) return;
    const wrap = () => document.querySelector('.canvas-wrap') as HTMLElement | null;

    let holdTimer = 0;
    let longPressed = false;
    let start: Pt | null = null;
    let scroll0: Pt = { x: 0, y: 0 };
    let pinch: { dist: number; zoom: number } | null = null;
    const pts = new Map<number, Pt>();
    /**
     * 双指缩放的两个体验点（v0.4.6 收尾）：
     *   ① **以两指中心为锚**：缩放后把滚动量按比例补回去，手指按住的那个内容点不动；
     *   ② **一帧最多一次 setState**：pointermove 可以来 120 次/秒，不合并的话
     *      React 每来一个事件就重渲染一次（这就是"捏合发涩"的来源）。
     * `applied` 记的是"上一次真正下发给 React 的 zoom"，用它算比例才不会被
     * 还没提交的旧 zoom 拖累（否则连续两帧会重复放大同一段）。
     */
    let applied = 0;
    let pinchRaf = 0;
    let pinchPending: { zoom: number; cx: number; cy: number } | null = null;

    const dist = () => {
      const [a, b] = [...pts.values()];
      if (!a || !b) return 0;
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    /** 长按落点命中哪个画布元素（没有就是空白）
     *  ⚠ 用 elementsFromPoint 从栈顶往下找，而不是只看最上层那一个：
     *    选中之后画布上会盖一层选中框/内联编辑框（它们不是 [data-bc-id]），
     *    只取最上层会得到 null → 明明按在元素上却"取消选中"（实测的真 bug）。 */
    const hitId = (x: number, y: number): string | null => {
      const list = document.elementsFromPoint(x, y) as HTMLElement[];
      for (const el of list) {
        const node = el?.closest?.('.canvas [data-bc-id]') as HTMLElement | null;
        if (node) return node.getAttribute('data-bc-id');
      }
      return null;
    };

    const doSelect = (x: number, y: number) => {
      const store = (window as unknown as { __sceneStore?: { getState: () => any } }).__sceneStore;
      if (!store) return;
      const st = store.getState();
      const id = hitId(x, y);
      if (!id) { st.selectElement(null); return; }
      const cur: string[] = st.scene.selectedIds ?? (st.scene.selectedId ? [st.scene.selectedId] : []);
      const armed = holdArmed;
      holdArmed = false; // 本次按住用掉了这一下
      if (cur.length === 0) { st.selectElement(id); return; }
      if (cur.includes(id)) {
        // 已经在选区里：
        //   · 多选时 → 这一下把它从选区里摘掉（多选的退出口）；
        //   · 单选时 → **什么都不做**。以前这里会"取消选中"，结果就是
        //     "长按一个已选中的元素 = 反而选不上"（probe-portrait-input 一直卡这条）。
        //     清空选区有别的入口：长按空白 / 更多菜单里的「取消选中」/ Esc。
        if (cur.length > 1 && armed && typeof st.toggleSelect === 'function') st.toggleSelect(id);
        return;
      }
      // 选区非空时再长按别的元素 → **加选**（用户："再次长按别的元素可以多选"）
      if (typeof st.toggleSelect === 'function') st.toggleSelect(id);
      else st.selectElement(id);
    };

    /** 一帧一次地真正下发缩放 + 把两指中心按住的内容点"钉"回原位 */
    const flushPinch = () => {
      pinchRaf = 0;
      const p = pinchPending;
      const w = wrap();
      if (!p || !w) return;
      const before = applied || zoomRef.current;
      if (Math.abs(p.zoom - before) < 0.004) return;
      const r = w.getBoundingClientRect();
      const rx = p.cx - r.left;
      const ry = p.cy - r.top;
      const k = p.zoom / before;
      applied = p.zoom;
      zoomCb.current(p.zoom);
      // 下一帧再校滚动：React 提交后画布尺寸才变，这一帧还是旧尺寸（会被钳住）
      requestAnimationFrame(() => {
        const w2 = wrap();
        if (!w2) return;
        w2.scrollLeft = (w2.scrollLeft + rx) * k - rx;
        w2.scrollTop = (w2.scrollTop + ry) * k - ry;
      });
    };

    const onDown = (e: PointerEvent) => {
      pressDown = true;
      const w = wrap();      if (!w || !w.contains(e.target as Node)) return;
      // 竖屏下画布这块完全由本层接管：不让画布自己的 pointerdown 选元素
      e.stopPropagation();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size === 2) {
        window.clearTimeout(holdTimer);
        longPressed = false;
        pinch = { dist: dist(), zoom: zoomRef.current };
        applied = zoomRef.current;
        return;
      }
      if (pts.size > 2) return;

      start = { x: e.clientX, y: e.clientY };
      scroll0 = { x: w.scrollLeft, y: w.scrollTop };
      longPressed = false;
      window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => {
        if (longPressed) return; // 同一次按住里定时器只许生效一次
        if (!pressDown) return; // 手指已经抬起了：这是残留定时器，丢掉
        longPressed = true;
        if (start) doSelect(start.x, start.y);
      }, holdMs());
    };

    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const w = wrap();
      if (!w) return;

      // —— 双指：缩放 + 跟手平移 ——
      if (pts.size >= 2 && pinch) {
        e.preventDefault();
        const d = dist();
        if (pinch.dist > 8 && d > 8) {
          const next = Math.min(maxZoom, Math.max(minZoom, pinch.zoom * (d / pinch.dist)));
          // 两指中点（client 坐标）：缩放要绕着它，内容才不会被"拽走"
          let cx = 0;
          let cy = 0;
          for (const p of pts.values()) { cx += p.x; cy += p.y; }
          cx /= pts.size;
          cy /= pts.size;
          pinchPending = { zoom: Math.round(next * 100) / 100, cx, cy };
          if (!pinchRaf) pinchRaf = requestAnimationFrame(flushPinch);
        }
        return;
      }

      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) > MOVE_TOL || Math.abs(dy) > MOVE_TOL) {
        window.clearTimeout(holdTimer); // 一滑就不是长按
      }
      // 长按已经在选元素了就不再平移（避免"选完手一抖画布跑了"）
      if (longPressed) return;
      e.preventDefault();
      w.scrollLeft = scroll0.x - dx;
      w.scrollTop = scroll0.y - dy;
    };

    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      window.clearTimeout(holdTimer);
      if (pts.size === 0) { start = null; longPressed = false; holdArmed = true; pressDown = false; }
    };

    /**
     * 点击屏蔽：画布原有的"点元素=选中 / 点空白=清空"走的是 click，
     * 捕获阶段把 click 拦下来，竖屏下就只有长按能改选区。
     */
    const onClickCapture = (e: MouseEvent) => {
      const w = wrap();
      if (!w || !w.contains(e.target as Node)) return;
      e.stopPropagation();
      e.preventDefault();
    };

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, { capture: true, passive: false });
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('click', onClickCapture, true);
    return () => {
      window.clearTimeout(holdTimer);
      if (pinchRaf) cancelAnimationFrame(pinchRaf);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('click', onClickCapture, true);
    };
  }, [enabled, minZoom, maxZoom]);
}
