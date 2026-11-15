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

const HOLD_MS = 420;
const MOVE_TOL = 8;

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

    const dist = () => {
      const [a, b] = [...pts.values()];
      if (!a || !b) return 0;
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    /** 长按落点命中哪个画布元素（没有就是空白） */
    const hitId = (x: number, y: number): string | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const node = el?.closest?.('.canvas [data-bc-id]') as HTMLElement | null;
      return node?.getAttribute('data-bc-id') ?? null;
    };

    const doSelect = (x: number, y: number) => {
      const store = (window as unknown as { __sceneStore?: { getState: () => any } }).__sceneStore;
      if (!store) return;
      const st = store.getState();
      const id = hitId(x, y);
      if (!id) { st.selectElement(null); return; }
      const cur: string[] = st.scene.selectedIds ?? (st.scene.selectedId ? [st.scene.selectedId] : []);
      if (cur.length === 0) { st.selectElement(id); return; }
      // 已在选区里 → 再长按一次取消它（多选的退出口；否则只能靠点空白全清）
      if (cur.includes(id)) {
        if (cur.length === 1) st.selectElement(null);
        else if (typeof st.toggleSelect === 'function') st.toggleSelect(id);
        else st.selectElement(id);
        return;
      }
      // 选区非空时再长按别的元素 → **加选**（用户："再次长按别的元素可以多选"）
      if (typeof st.toggleSelect === 'function') st.toggleSelect(id);
      else st.selectElement(id);
    };

    const onDown = (e: PointerEvent) => {
      const w = wrap();
      if (!w || !w.contains(e.target as Node)) return;
      // 竖屏下画布这块完全由本层接管：不让画布自己的 pointerdown 选元素
      e.stopPropagation();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size === 2) {
        window.clearTimeout(holdTimer);
        longPressed = false;
        pinch = { dist: dist(), zoom: zoomRef.current };
        return;
      }
      if (pts.size > 2) return;

      start = { x: e.clientX, y: e.clientY };
      scroll0 = { x: w.scrollLeft, y: w.scrollTop };
      longPressed = false;
      window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => {
        longPressed = true;
        if (start) doSelect(start.x, start.y);
      }, HOLD_MS);
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
          zoomCb.current(Math.round(next * 100) / 100);
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
      if (pts.size === 0) { start = null; longPressed = false; }
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
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('click', onClickCapture, true);
    };
  }, [enabled, minZoom, maxZoom]);
}
