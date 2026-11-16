// ============================================================================
// BlockCanvas · v0.4.6 竖屏画布触屏手势层
// ----------------------------------------------------------------------------
// 用户原话（累计五轮）：
//   「触屏的整个操作逻辑需要修改，现在我在空白画布上滑动都会触发选中。」
//   「选中元素不要点击，要求长按。」
//   「长按选中了一个元素，再次长按别的元素可以多选。」
//   「单指一律平移（空白处和元素上都一样），双指缩放。」
//   「完全不顺滑，我想放的更大，中间断开了，每次放到缩小不跟手，
//     只能放到缩小一点点，还很僵硬。」
//   「画布上滚动的时候，有一些惯性最好，而缩放就精准缩放就行。」
//   「缩放的时候会抽搐，有时候缩小或者放大了，下一次点击突然闪现到另一个地方。」
//
// 做法：在 `.canvas-wrap` 的**捕获阶段**接管指针，完全不让画布原有的
// 「pointerdown 选元素 / 拖框 / 点击选中」拿到事件 —— 那些是鼠标语义，
// 在竖屏上会造成"一滑就选"。接管之后由这里重新定义：
//
//   单指按住 ≥420ms 不动      → 长按选中（已在选区里 = 取消它，否则加选）
//   长按落在空白             → 清空选区
//   单指按下后移动 >8px      → 平移画布（取消长按计时），松手后有惯性滑行
//   双指                     → 缩放（锚点钉在手指底下）+ 跟手平移
//
// ⚠ 为什么按 data-shell='stack' 而不是 data-input='touch' 生效：
//   竖屏是**交互模型**不同，不只是设备不同。窄窗口用鼠标时，"一滑就选中"同样烦人；
//   而且我们的验收就是在桌面把窗口拉到 412×915 做的，按输入轴门控会让验收者看不到效果。
//   宽屏（split）完全不受影响，桌面端一条老逻辑都不动。
// ============================================================================
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
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
/**
 * 手势进行中（双指缩放）。
 * Canvas.tsx 靠它判断"这次 zoom 变化是我手势造成的，还是别的入口"——
 * 后者要把上一轮遗留的位移补偿清掉（否则画布会停在偏掉的位置）。
 */
let pinchActive = false;
/** 给 Canvas.tsx 用：现在是不是正在双指缩放 */
export function isPinching(): boolean { return pinchActive; }

type Pt = { x: number; y: number };

/**
 * 双指缩放的状态。
 *
 * 这里面每一条都是踩过坑换来的：
 *
 *   · **手势期间一次 setState 都不发**。旧写法每帧 setState → React 重渲染整棵
 *     画布树（CanvasNode 递归）→ 指针事件 120Hz 就能刷 120 次渲染 → "僵硬"。
 *     现在直接往画布元素上写 CSS 变量（--bc-canvas-k / -dx / -dy），
 *     浏览器自己每帧重绘，跟手且不卡。
 *
 *   · **锚点用"手指中心底下的那个内容点"**，缩放和平移都围绕它算，
 *     所以缩放时内容不会被"拽走"（旧写法漏算了画布在容器里居中产生的偏移，
 *     比例一变内容就跳 —— 用户说的"中间断开了"）。
 *
 *   · **每帧用"当前实际位置"反推需要的位移**，而不是用手势开始时的旧坐标。
 *     原因：缩放时画布的滚动溢出区会变，浏览器会**自动钳制滚动位置**
 *     （内容变小 → scrollLeft 被钳到 0）—— 那一下会让"锚点"跑掉。
 *     每帧读一次实际矩形来纠正，钳制多少次都不会错位。
 *
 *   · **缩放范围 10% ~ 400%**（旧的 20%~300% 不够用，用户说"想放的更大"）。
 */
type PinchState = {
  /** 手势开始时的缩放 */
  zoom0: number;
  /** 手指中心底下的那个内容点（画布局标，未缩放） */
  anchorX: number;
  anchorY: number;
  /** 手势开始时两指间距 */
  dist0: number;
  /** 当前缩放绝对值 */
  k: number;
  /** 当前位移补偿（画在 CSS 变量里，收尾时换算回滚动位置） */
  dx: number;
  dy: number;
};

export function useTouchCanvas(opts: {
  enabled: boolean;
  zoom: number;
  onZoomChange: (z: number) => void;
  minZoom?: number;
  maxZoom?: number;
  /** Alt 模式：长按只做单选（按住下一个元素，上一个自动取消），不能多选 */
  altMode?: boolean;
}) {
  const { enabled, zoom, onZoomChange, minZoom = 0.1, maxZoom = 4, altMode = false } = opts;
  // 用 ref 读最新值：监听只挂一次，不能因为 zoom 变化重挂（重挂会把进行中的手势打断）
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomCb = useRef(onZoomChange);
  zoomCb.current = onZoomChange;
  // Alt 模式同样用 ref：开关变一次就重挂监听会把进行中的手势打断
  const altRef = useRef(altMode);
  altRef.current = altMode;

  useEffect(() => {
    if (!enabled) return;
    const wrap = () => document.querySelector('.canvas-wrap') as HTMLElement | null;
    const canvasEl = () => document.querySelector('.canvas') as HTMLElement | null;

    let holdTimer = 0;
    let longPressed = false;
    let start: Pt | null = null;
    let scroll0: Pt = { x: 0, y: 0 };
    let pinch: PinchState | null = null;
    const pts = new Map<number, Pt>();

    /* ── 惯性滑行 ──────────────────────────────────────────────────────────
       单指平移松手后继续滑一小段（用户："画布上滚动的时候，有一些惯性最好"）。
       做法：记最后两次指针位置算出速度，松手后每帧按 0.94 的衰减往前推，
       速度掉到阈值以下就停。缩放不参与惯性（用户："缩放就精准缩放就行"）。 */
    let flingRaf = 0;
    let flingVx = 0;
    let flingVy = 0;
    let lastMove: { t: number; x: number; y: number } | null = null;
    let prevMove: { t: number; x: number; y: number } | null = null;

    const stopFling = () => {
      if (flingRaf) { cancelAnimationFrame(flingRaf); flingRaf = 0; }
      flingVx = 0;
      flingVy = 0;
      lastMove = null;
      prevMove = null;
    };

    const runFling = () => {
      const w = wrap();
      if (!w) { stopFling(); return; }
      w.scrollLeft += flingVx;
      w.scrollTop += flingVy;
      // 衰减：0.94/帧 ≈ 半秒停下来，手感接近原生列表
      flingVx *= 0.94;
      flingVy *= 0.94;
      if (Math.abs(flingVx) < 0.4 && Math.abs(flingVy) < 0.4) { stopFling(); return; }
      flingRaf = requestAnimationFrame(runFling);
    };

    const dist = () => {
      const [a, b] = [...pts.values()];
      if (!a || !b) return 0;
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    /** 两指中点（client 坐标） */
    const center = (): Pt => {
      let cx = 0;
      let cy = 0;
      for (const p of pts.values()) { cx += p.x; cy += p.y; }
      const n = Math.max(1, pts.size);
      return { x: cx / n, y: cy / n };
    };

    /**
     * 长按落点命中哪个画布元素（没有就是空白）
     *  ⚠ 用 elementsFromPoint 从栈顶往下找，而不是只看最上层那一个：
     *    选中之后画布上会盖一层选中框/内联编辑框（它们不是 [data-bc-id]），
     *    只取最上层会得到 null → 明明按在元素上却"取消选中"（实测的真 bug）。
     */
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
      /**
       * Alt 模式（v0.4.6 第 46 批）：用户要求「元素必须被选中才能可视化调整」，
       * 而且「不能选中多个元素，按住下一个元素，上一个元素自动取消选中」。
       * 所以这一档永远走单选（selectElement），不 toggle、不加选。
       */
      if (altRef.current) {
        st.selectElement(id);   // id 为 null = 长按空白 → 清空
        return;
      }
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
        //     清空选区有别的入口：长按空白 / 情境栏的「取消选中」/ Esc。
        if (cur.length > 1 && armed && typeof st.toggleSelect === 'function') st.toggleSelect(id);
        return;
      }
      // 选区非空时再长按别的元素 → **加选**（用户："再次长按别的元素可以多选"）
      if (typeof st.toggleSelect === 'function') st.toggleSelect(id);
      else st.selectElement(id);
    };

    /** 把手势中的缩放/位移写进 CSS 变量（不触发任何 React 渲染） */
    const paintGesture = (k: number, dx: number, dy: number) => {
      const el = canvasEl();
      if (!el) return;
      el.style.setProperty('--bc-canvas-k', String(k));
      el.style.setProperty('--bc-canvas-dx', `${dx}px`);
      el.style.setProperty('--bc-canvas-dy', `${dy}px`);
    };

    /**
     * 把上一轮遗留的位移补偿"结算"掉：折进滚动位置，然后清零。
     *
     * ⚠ 符号必须是**减**：画面位置 = 内容坐标 - 滚动量，
     *   想让画面不动，滚动量就要加上那份位移（scroll -= dx）。
     *   写反了的话，下一次手势一开始画布就会"闪"到别处
     *   （用户原话：「下一次点击突然闪现到另一个地方」）。
     */
    const settleResidual = () => {
      const el = canvasEl();
      const w = wrap();
      if (!el || !w) return;
      let dx = parseFloat(el.style.getPropertyValue('--bc-canvas-dx') || '0');
      let dy = parseFloat(el.style.getPropertyValue('--bc-canvas-dy') || '0');
      if (dx || dy) {
        const beforeX = w.scrollLeft;
        const beforeY = w.scrollTop;
        w.scrollLeft = beforeX - dx;
        w.scrollTop = beforeY - dy;
        /**
         * v0.4.6 第 47 批：**只折进滚动能吃掉的那部分**。
         *
         * 用户报的"下一次点击突然闪现到另一个地方"就是这里：以前无条件清零，
         * 而画布比视口小（缩放 < 100% 或本来就窄）时 scrollLeft 会被钳到 0，
         * 折不进去的那段位移直接丢掉 → 画面在手指按下的瞬间跳一下。
         * 现在把没吃掉的留在变量里，画面一帧都不动。
         */
        dx -= beforeX - w.scrollLeft;
        dy -= beforeY - w.scrollTop;
      }
      if (dx) el.style.setProperty('--bc-canvas-dx', dx + 'px');
      else el.style.removeProperty('--bc-canvas-dx');
      if (dy) el.style.setProperty('--bc-canvas-dy', dy + 'px');
      else el.style.removeProperty('--bc-canvas-dy');
      el.style.removeProperty('--bc-canvas-k');
    };

    /** 双指按下第二根手指：记下锚点 */
    const beginPinch = () => {
      settleResidual();
      const el = canvasEl();
      const c = center();
      const zoom0 = zoomRef.current || 1;
      // 锚点 = 手指中心底下的内容点（画布局标）
      // 画布视觉左缘用**当前实际矩形**算（含我们自己的位移补偿），
      // 这样即使之前钳制过滚动，锚点也不会算偏。
      const rect = el?.getBoundingClientRect();
      const left = rect ? rect.left : 0;
      const top = rect ? rect.top : 0;
      // 起始位移 = 画布上此刻的残留值（settleResidual 折不掉的那部分要继承）
      const curDx = parseFloat(el?.style.getPropertyValue('--bc-canvas-dx') || '0');
      const curDy = parseFloat(el?.style.getPropertyValue('--bc-canvas-dy') || '0');
      pinch = {
        zoom0,
        anchorX: (c.x - left) / zoom0,
        anchorY: (c.y - top) / zoom0,
        dist0: Math.max(1, dist()),
        k: zoom0,
        dx: curDx,
        dy: curDy
      };
      pinchActive = true;
    };

    /** 双指移动：每帧只写 CSS 变量 */
    const updatePinch = () => {
      const g = pinch;
      const el = canvasEl();
      if (!g || !el) return;
      const d = dist();
      if (g.dist0 <= 8 || d <= 8) return;
      const raw = g.zoom0 * (d / g.dist0);
      const k = Math.min(maxZoom, Math.max(minZoom, raw));
      if (Math.abs(k - g.k) < 0.0015) return;
      g.k = k;
      const c = center();
      /**
       * 每帧用**当前实际矩形**反推需要的位移：
       *   画面上，内容点 P 的屏幕位置 = 画布视觉左缘 + P*k
       *   要让锚点 anchor 停在手指中心 c：画布视觉左缘 = c - anchor*k
       *   位移与视觉左缘是 1:1 的关系 → 差多少就补多少
       * 这样即使浏览器中途钳制了滚动位置（内容变小 → scrollLeft 被钳到 0），
       * 下一帧也会自动纠正回来，不会"缩着缩着画布跳走"。
       */
      const rect = el.getBoundingClientRect();
      const targetLeft = c.x - g.anchorX * k;
      const targetTop = c.y - g.anchorY * k;
      g.dx += targetLeft - rect.left;
      g.dy += targetTop - rect.top;
      paintGesture(g.k, g.dx, g.dy);
    };

    /**
     * 松手：把最终缩放交给 React，把位移换算回滚动位置。
     * 三步在同一个同步块里做完 → 浏览器只画一帧，看不到"跳一下"。
     */
    const finishPinch = (w: HTMLElement) => {
      const g = pinch;
      pinch = null;
      pinchActive = false;
      if (!g) return;
      const el = canvasEl();
      // ① 同步提交最终缩放（React 此刻把 transform 的兜底值改成新的 zoom，
      //    但 CSS 变量还在 → 画面不变，不会闪）
      try {
        flushSync(() => zoomCb.current(g.k));
      } catch {
        zoomCb.current(g.k);
      }
      // ② 位移换算回滚动位置：
      //    手势态画面 = 画布视觉左缘 + P*k
      //    收尾态画面 = 内容坐标 - 滚动量
      //    → 理想滚动量 = 当前滚动量 - 位移
      const scrollEnd = w.scrollLeft;
      w.scrollLeft = scrollEnd - g.dx;
      // ③ 滚动被浏览器钳制时（内容比视口还小），把差额留成残留位移，
      //    这样画面落点仍然精确（读回真实滚动值再算）。
      const actual = w.scrollLeft;
      const resX = (actual - scrollEnd) + g.dx;
      const scrollEndY = w.scrollTop;
      w.scrollTop = scrollEndY - g.dy;
      const actualY = w.scrollTop;
      const resY = (actualY - scrollEndY) + g.dy;
      if (el) {
        el.style.setProperty('--bc-canvas-dx', `${resX}px`);
        el.style.setProperty('--bc-canvas-dy', `${resY}px`);
        // 缩放交给 React 的兜底值接管
        el.style.removeProperty('--bc-canvas-k');
        el.style.removeProperty('will-change');
      }
    };

    const onDown = (e: PointerEvent) => {
      pressDown = true;
      const w = wrap();      if (!w || !w.contains(e.target as Node)) return;
      /**
       * Alt 模式的手柄层（`.bc-alttouch`）虽然画在 `.canvas-wrap` 里面，但它不是"画布"：
       * 按在手柄上是要拖元素、不是平移画布。这一层是 window 捕获阶段跑的，
       * 一旦执行到下面的 stopPropagation，手柄自己的 pointerdown 就永远收不到，
       * 所以这里必须先让步（否则"按手柄没反应"）。
       */
      if ((e.target as HTMLElement)?.closest?.('.bc-alttouch')) return;
      /**
       * 就地编辑框（双击文字后的 textarea）自己管事件：选区、轻点弹菜单、右键菜单全在里面。
       * 手势层一旦 stopPropagation，textarea 上的 pointerdown/up 全收不到 ——
       * 表现为"选中文字后点一下没反应"（菜单弹不出来）。
       */
      if ((e.target as HTMLElement)?.closest?.('.bc-inline-edit-wrap, .canvas-inline-text-input, .bc-inline-br-overlay')) return;
      // 竖屏下画布这块完全由本层接管：不让画布自己的 pointerdown 选元素
      e.stopPropagation();
      // 新手势开始 → 上一段惯性立刻停（手指按下去就该由手指说了算）
      stopFling();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size === 2) {
        window.clearTimeout(holdTimer);
        longPressed = false;
        beginPinch();
        canvasEl()?.style.setProperty('will-change', 'transform');
        return;
      }
      if (pts.size > 2) return;

      // 单指平移：先把上一轮遗留的位移补偿结算掉，再记起点
      settleResidual();
      start = { x: e.clientX, y: e.clientY };
      scroll0 = { x: w.scrollLeft, y: w.scrollTop };
      longPressed = false;
      lastMove = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      prevMove = null;
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
        updatePinch();
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
      // 记速度（用最近两次采样，间隔太近就丢掉上一次）
      const now = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (lastMove) {
        const dt = now.t - lastMove.t;
        if (dt > 0 && dt < 120) {
          prevMove = lastMove;
          lastMove = now;
        } else if (dt >= 120) {
          lastMove = now;
          prevMove = null;
        }
      } else {
        lastMove = now;
      }
    };

    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      const w = wrap();
      if (pts.size < 2 && pinch && w) finishPinch(w);
      if (pts.size < 2) pinch = null;
      window.clearTimeout(holdTimer);
      if (pts.size === 0) {
        start = null;
        longPressed = false;
        holdArmed = true;
        pressDown = false;
        // —— 惯性：手指抬起时如果还在快速移动，就继续滑一段 ——
        if (w && lastMove && prevMove) {
          const dt = lastMove.t - prevMove.t;
          if (dt > 0) {
            // 手指速度 → 滚动速度（方向相反：手指往右拖，画面往左走）
            flingVx = -((lastMove.x - prevMove.x) / dt) * 16;
            flingVy = -((lastMove.y - prevMove.y) / dt) * 16;
            // 太慢就不滑（否则轻轻一碰也飘一下）
            if (Math.abs(flingVx) < 1.2 && Math.abs(flingVy) < 1.2) { stopFling(); }
            else if (!flingRaf) flingRaf = requestAnimationFrame(runFling);
          }
        }
      }
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
      stopFling();
      pinchActive = false;
      // 组件卸载时把临时变量收干净，别把画布留在"被手势搬过"的状态
      const el = canvasEl();
      el?.style.removeProperty('--bc-canvas-k');
      el?.style.removeProperty('--bc-canvas-dx');
      el?.style.removeProperty('--bc-canvas-dy');
      el?.style.removeProperty('will-change');
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('click', onClickCapture, true);
    };
  }, [enabled, minZoom, maxZoom]);
}
