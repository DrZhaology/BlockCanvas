// BlockCanvas · Alt 拖拽的"每一帧"和"松手时"（从 useAltDrag 里抽出来）
//
// 这里只做计算 + 写样式，状态全部由调用方（useAltDrag）通过 ctx 传进来。
// 抽出来的理由：这一坨是画布里最长的一段（~500 行），单独放能让"每帧算什么"一眼看全。
//
// 三条铁律（踩过坑，别改回去）：
//   1. **client px → CSS px 必须 ÷ zoom**。`.canvas` 上有 scale(zoom)，鼠标走 100 屏幕像素，
//      元素只该移动 100/zoom 个 CSS 像素。
//   2. **一趟拖动只锚一边**（d.axisSide）。每帧按"离哪边近"重算会让 left/right 互相争抢 → 抖动。
//   3. **双边约束的轴两边一起平移**。left+right 且没写 width 的元素，尺寸是两边撑出来的，
//      只改一边盒子会当场塌掉（实测 849px 宽的元素一拖变 60px）。
import { findNode, useScene } from '@store/sceneStore';
import { contentBoxOf } from './geometry';
import { pickDropTarget, ALT_REPARENT_ENABLED, clearDropPreview } from './walls';
import type { AltDragState, Bar } from './types';

export type AltDragCtx = {
  zoomRef: React.MutableRefObject<number>;
  /** 基准视口高度（fixed 的空气墙 / 首屏线），由场景提供 */
  viewportHeightRef: React.MutableRefObject<number>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  altPadRef: React.MutableRefObject<number>;
  setAltPad: React.Dispatch<React.SetStateAction<number>>;
  setWallHints: React.Dispatch<React.SetStateAction<Bar[]>>;
  setAltBadge: React.Dispatch<React.SetStateAction<{ x: number; y: number; text: string } | null>>;
  setGuides: React.Dispatch<React.SetStateAction<{ x: number | null; y: number | null; box: { left: number; top: number; right: number; bottom: number } | null } | null>>;
  setDropTarget: React.Dispatch<React.SetStateAction<{ id: string; rect: { x: number; y: number; w: number; h: number } } | null>>;
  setBoxModel: React.Dispatch<React.SetStateAction<import('./types').AltBoxModelData | null>>;
  flashWall: (b: Bar | null) => void;
  scheduleAltLiveBox: () => void;
  normalizePositionedMargin: (d: AltDragState) => void;
  growCanvasForDrag: (clientY: number) => void;
  spawnAltGhost: (srcEl: HTMLElement, rect: DOMRect) => void;
  moveAltGhost: (x: number, y: number) => void;
  removeAltGhost: () => void;
  altPreviewTimer: React.MutableRefObject<number>;
  altPreviewRef: React.MutableRefObject<string | null>;
};

const q = (id: string) => document.querySelector(`.canvas [data-bc-id="${CSS.escape(id)}"]`) as HTMLElement | null;

/** 拖到墙外 → 进入/退出"改父子关系"模式 */
function updateReparentMode(d: AltDragState, ev: PointerEvent, st: ReturnType<typeof useScene.getState>, ctx: AltDragCtx, pushOut: number): boolean {
  const REPARENT_ENTER = 56;
  const REPARENT_EXIT = 12;
  // v0.4.5：ALT_REPARENT_ENABLED=false → 这段整体停用（实现保留）
  if (ALT_REPARENT_ENABLED && !d.reparent && pushOut > REPARENT_ENTER) {
    d.reparent = true;
    document.body.classList.add('bc-reparenting');
    const srcEl = q(d.id);
    srcEl?.setAttribute('data-bc-drag-src', '1');
    if (srcEl) ctx.spawnAltGhost(srcEl, d.rect);
    ctx.setWallHints([]); // 改父子关系时不再需要边界线
  }
  if (d.reparent && pushOut < REPARENT_EXIT) {
    d.reparent = false;
    d.dropId = null;
    document.body.classList.remove('bc-reparenting');
    q(d.id)?.removeAttribute('data-bc-drag-src');
    ctx.setDropTarget(null);
    ctx.removeAltGhost();
    ctx.setWallHints(d.walls);
  }
  if (!d.reparent) return false;

  ctx.moveAltGhost(ev.clientX, ev.clientY);
  const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
  const draggedEl = q(d.id);
  const tgt = under && draggedEl ? pickDropTarget(under, draggedEl, d.parentId, st.scene.root) : null;
  const tgtId = tgt?.id ?? null;
  if (tgtId !== d.dropId) {
    // 目标换人：清掉旧目标的"停留预览"
    window.clearTimeout(ctx.altPreviewTimer.current);
    ctx.altPreviewRef.current = null;
    clearDropPreview();
  }
  d.dropId = tgtId;
  ctx.setDropTarget(tgt);
  // 悬停同一目标 1 秒 → 目标强化脉冲（"松开就放这里"的预览暗示）
  if (tgtId && ctx.altPreviewRef.current !== tgtId) {
    ctx.altPreviewRef.current = tgtId;
    const idForTimer = tgtId;
    window.clearTimeout(ctx.altPreviewTimer.current);
    ctx.altPreviewTimer.current = window.setTimeout(() => {
      if (d.reparent && d.dropId === idForTimer) {
        q(idForTimer)?.classList.add('bc-drop-preview');
      }
    }, 1000);
  }
  ctx.setAltBadge({
    x: ev.clientX + 14, y: ev.clientY + 14,
    text: tgt ? '松开 → 放入这个元素' : '移到某个块级元素上 → 放入其中'
  });
  return true;
}

/** Alt 拖拽进行中：每帧算一次并写样式 */
export function applyAltDragMove(d: AltDragState, ev: PointerEvent, ctx: AltDragCtx): void {
  d.lastX = ev.clientX;
  d.lastY = ev.clientY;
  const dx = ev.clientX - d.startX;
  const dy = ev.clientY - d.startY;
  if (!d.engaged && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
  const st = useScene.getState();
  if (!d.engaged) {
    d.engaged = true;
    // v0.4.5 第 8 批修正：**不要**把锚点重置到"开始拖动的这一帧"。
    //
    // 老代码在进入拖动的第一帧把 startX/startY 对齐到当前指针，理由是
    // "用户可能先按住左键、过一会儿才按 Alt，dx/dy 会一下子变成几十像素"。
    // 但实际路径上根本不存在那种情况：拖动只能由**按下时就带着 Alt** 的 pointerdown 创建，
    // 所以进入拖动的第一帧 dx/dy 最多就是那个 4px 的启动阈值 ——
    // 重置锚点只会把这 4px（以及 Playwright 那种大步进下的几十像素）白白丢掉，
    // 表现出来就是"元素跟不上鼠标、总要慢一截"。这正是用户说的"移动起来会闪烁、瞬移"。
    const liveEl = q(d.id);
    if (liveEl) {
      const r = liveEl.getBoundingClientRect();
      d.rect = { ...d.rect, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } as typeof d.rect;
      d.startW = r.width;
      d.startH = r.height;
    }
    document.body.classList.add('bc-alt-dragging');
    if (d.mode === 'font') document.body.classList.add('bc-alt-fonting');
    // 拖动时常显"可达边界"提示线（橙色）——让内边距/外边距的界限一眼可见
    if (d.mode !== 'font') ctx.setWallHints(d.walls);
    st.selectElement(d.id);
    st.beginStyleEdit(); // 单条撤销：整个拖动 = 一步 Ctrl+Z
    // v0.4.5：定位元素的 margin 归一化（用户反馈"margin 被锁死了，拖不动"）。
    // 必须放在 beginStyleEdit 之后 —— 归一化要和拖动同属一条撤销记录。
    if (d.mode === 'move') ctx.normalizePositionedMargin(d);
    // v0.4.5：一开始拖就把画布向下"长出"一段 → 不用等元素撞到下沿才一格一格变长
    ctx.growCanvasForDrag(ev.clientY);
  }
  const node = findNode(st.scene.root, d.id);
  if (!node) return;
  // 撞墙时高亮"整面墙"（元素边/外边距 ↔ 另一个元素的边，或父容器内边距）
  const bar = (side: 'l' | 'r' | 't' | 'b'): Bar | null =>
    side === 'l' ? d.bounds.barL : side === 'r' ? d.bounds.barR : side === 't' ? d.bounds.barT : d.bounds.barB;

  if (d.mode === 'resize') {
    // 贴哪条边改哪条；贴左/上边时同时把元素"推"回去 → 对侧边保持不动
    //（以前左/上是反的：改了宽度但左边不动，看着像往反方向长）
    const hasL = !!d.edge && d.edge.includes('l');
    const hasR = !!d.edge && d.edge.includes('r');
    const hasT = !!d.edge && d.edge.includes('t');
    const hasB = !!d.edge && d.edge.includes('b');
    let nw = d.startW;
    let nh = d.startH;
    if (hasL || hasR) nw = Math.max(8, d.startW + (hasL ? -dx : dx));
    if (hasT || hasB) nh = Math.max(8, d.startH + (hasT ? -dy : dy));
    // 墙：右 / 下边不能超出父容器（或画布视口）
    const parentRight = d.bounds.maxX + d.startW;
    const parentBottom = Number.isFinite(d.bounds.maxY) ? d.bounds.maxY + d.startH : Infinity;
    if (hasR && nw > parentRight - d.rect.left) {
      nw = Math.max(8, parentRight - d.rect.left);
      ctx.flashWall(bar('r'));
    }
    if (hasB && nh > parentBottom - d.rect.top) {
      nh = Math.max(8, parentBottom - d.rect.top);
      ctx.flashWall(bar('b'));
    }
    // 墙：左 / 上边不能超出父容器（对侧边固定）
    let shiftX = hasL ? dx : 0;
    let shiftY = hasT ? dy : 0;
    if (hasL && d.rect.right - nw < d.bounds.minX) {
      nw = Math.max(8, d.rect.right - d.bounds.minX);
      shiftX = d.bounds.minX - d.rect.left;
      ctx.flashWall(bar('l'));
    }
    if (hasT && d.rect.bottom - nh < d.bounds.minY) {
      nh = Math.max(8, d.rect.bottom - d.bounds.minY);
      shiftY = d.bounds.minY - d.rect.top;
      ctx.flashWall(bar('t'));
    }
    // v0.4.5：nw/nh 是 client 像素（getBoundingClientRect），写进 CSS 前必须 ÷ zoom。
    // 以前直接写 width: nw + 'px'，zoom≠1 时"拖 100 像素长了 148 像素"（用户反馈的缩放错位）。
    const z = ctx.zoomRef.current || 1;
    const patch: Record<string, string> = { width: Math.round(nw / z) + 'px' };
    if (hasT || hasB) patch.height = Math.round(nh / z) + 'px';

    // v0.4.5（用户第 2 次反馈，规则改了）：
    //   · **有 src 的图片 / 视频** → 只能按比例缩放，不允许拉伸变形
    //   · **没有 src 的 img 占位元素** → 自由缩放（以前连占位框都锁比例，用户明确不要）
    //   · 音频没有"画面"，也不锁比例
    const hasSrc = String(node.attrs?.src ?? '').trim() !== '';
    let ratioLocked = (node.type === 'img' && hasSrc) || (node.type === 'video' && hasSrc);
    /**
     * v0.4.6（用户反馈："视频的 Alt 调整宽度、高度和四个角的调整都基本坏了"）：
     *
     * 视频在**元数据还没加载**时没有真实尺寸 —— `<video>` 的默认高度是 150px 的占位，
     * 拿它当 startH 去算比例，一拖就是"宽度对了、高度离谱"或者"直接缩成一条"。
     * 所以比例锁只在这两种情况成立：
     *   · 量到的起始尺寸是可信的（≥ 24px，排除 0 尺寸的占位/未挂载）；
     *   · 视频已经吐出真实画面尺寸（videoWidth > 0）。
     * 不满足就**退化成自由缩放**（只改拖的那条边），宁可"没锁比例"也不要"乱跳"。
     */
    if (ratioLocked && node.type === 'video') {
      const vel = document.querySelector(`.canvas [data-bc-id="${CSS.escape(d.id)}"]`) as HTMLVideoElement | null;
      const real = vel instanceof HTMLVideoElement ? vel.videoWidth > 0 : false;
      if (!real) ratioLocked = false;
    }
    if (ratioLocked && (d.startW < 24 || d.startH < 24)) ratioLocked = false;
    if (ratioLocked && d.startW > 0 && d.startH > 0 && (hasL || hasR)) {
      const scale = nw / d.startW;
      nh = Math.max(8, d.startH * scale);
      patch.height = Math.round(nh / z) + 'px';
    }
    if (ratioLocked && d.startW > 0 && d.startH > 0 && !(hasL || hasR) && (hasT || hasB)) {
      const scale = nh / d.startH;
      nw = Math.max(8, d.startW * scale);
      patch.width = Math.round(nw / z) + 'px';
    }

    if (hasL) patch[d.positioned ? 'left' : 'marginLeft'] = Math.round((d.positioned ? d.startLeft : d.startMarginL) + shiftX / z) + 'px';
    if (hasT) patch[d.positioned ? 'top' : 'marginTop'] = Math.round((d.positioned ? d.startTop : d.startMarginT) + shiftY / z) + 'px';
    st.updateStyle(d.id, patch);
    ctx.scheduleAltLiveBox();
    ctx.setAltBadge({ x: d.rect.right, y: d.rect.top, text: `${Math.round(nw)} × ${Math.round(nh)}` });
    return;
  }

  if (d.mode === 'font') {
    const size = Math.max(6, Math.min(400, Math.round(d.startFont + (dx / (ctx.zoomRef.current || 1)) / 6)));
    st.updateStyle(d.id, { fontSize: size + 'px' });
    ctx.scheduleAltLiveBox();
    ctx.setAltBadge({ x: ev.clientX + 14, y: ev.clientY + 14, text: `字号 ${size}px` });
    return;
  }

  // ── move：定位元素改 left/top（缺省会自动补上），常规流元素改 margin；
  //    都受"墙"限制 —— 横向不出父容器、纵向不越过上一个兄弟；撞墙闪"整面墙"
  let targetLeft = d.rect.left + dx;
  let targetTop = d.rect.top + dy;

  const pushOut = Math.max(
    d.bounds.minX - targetLeft,
    targetLeft - d.bounds.maxX,
    d.bounds.minY - targetTop,
    Number.isFinite(d.bounds.maxY) ? targetTop - d.bounds.maxY : -Infinity
  );
  if (updateReparentMode(d, ev, st, ctx, pushOut)) return; // 冻结：不再继续改样式

  // —— 吸附对齐（PowerPoint 风格）：左/中/右、上/中/下 靠近参考线时吸过去并画参考线 ——
  const SNAP = 6;
  const trySnap = (edges: number[], targets: number[]) => {
    let best: { delta: number; line: number } | null = null;
    for (const e of edges) {
      for (const t of targets) {
        const delta = t - e;
        if (Math.abs(delta) <= SNAP && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line: t };
      }
    }
    return best;
  };
  const sx = trySnap([targetLeft, targetLeft + d.rect.width / 2, targetLeft + d.rect.width], d.bounds.snapX);
  if (sx) targetLeft += sx.delta;
  const sy = trySnap([targetTop, targetTop + d.rect.height / 2, targetTop + d.rect.height], d.bounds.snapY);
  if (sy) targetTop += sy.delta;
  if (sx || sy) {
    const cr = ctx.canvasRef.current?.getBoundingClientRect();
    ctx.setGuides({
      x: sx ? sx.line : null,
      y: sy ? sy.line : null,
      box: cr ? { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom } : null
    });
  } else {
    ctx.setGuides(null);
  }

  let hit: Bar | null = null;
  if (targetLeft < d.bounds.minX) { targetLeft = d.bounds.minX; hit = bar('l'); }
  if (targetLeft > d.bounds.maxX) { targetLeft = d.bounds.maxX; hit = bar('r'); }
  if (targetTop < d.bounds.minY) { targetTop = d.bounds.minY; hit = bar('t'); }
  if (Number.isFinite(d.bounds.maxY) && targetTop > d.bounds.maxY) { targetTop = d.bounds.maxY; hit = bar('b'); }
  const ax = targetLeft - d.rect.left;
  const ay = targetTop - d.rect.top;
  /**
   * v0.4.5 第 15 批：**双边约束的轴改用"指针原始位移"**。
   *
   * 原因：墙（bounds.minY 等）是按"单边锚定 + 固定尺寸"推出来的，
   * 对一个 top+bottom 撑出来的元素根本不成立（实测会把元素弹到 -320px 之外）。
   * 这类元素本来就正好卡在容器里，平移不会破坏布局，所以直接跟手最稳。
   */
  const axMove = d.stretchX ? (ev.clientX - d.startX) : ax;
  const ayMove = d.stretchY ? (ev.clientY - d.startY) : ay;
  const patch: Record<string, string | undefined> = {};
  const elNow = q(d.id);
  const parentNow = elNow?.parentElement;

  // —— 常规流元素：靠 margin 移动（并保留"拖到中线自动 margin:auto 居中"）——
  // v0.4.5：同样要 ÷ zoom（margin 是 CSS 像素，指针位移是 client 像素）
  const zNow = ctx.zoomRef.current || 1;
  if (!d.positioned) {
    patch.marginLeft = Math.round(d.startMarginL + ax / zNow) + 'px';
    patch.marginTop = Math.round(d.startMarginT + ay / zNow) + 'px';
  }

  // —— v0.4.5：定位元素的偏移写入（第 8 批重做）——
  // 三件事必须同时成立，否则就是用户看到的"闪烁 / 瞬移"：
  //  1. **client px → CSS px**：`.canvas` 上有 scale(zoom)，鼠标走了 dx 个屏幕像素，
  //     元素只该移动 dx/zoom 个 CSS 像素。
  //  2. **包含块的取法要对**：absolute 用 offsetParent；**fixed 用 `.canvas`**（它扮演浏览器视口）。
  //  3. **一趟拖动只锚一边**：锚哪边在拖动开始时定死（d.axisSide），
  //     relative / sticky 一律用 left/top（它们的偏移相对自身文档流原位，
  //     按"离父容器哪边近"反推会当场跳位 —— 这正是 relative 拖动瞬移的根因）。
  if (d.positioned && elNow) {
    if (d.posKind === 'relative' || d.posKind === 'sticky') {
      // 相对定位：偏移 = 起始偏移 + 指针位移（CSS 像素），与包含块无关
      const nx = d.startLeft + ax / zNow;
      const ny = d.startTop + ay / zNow;
      // 归零就不留 left: 0px 这种噪声
      patch.left = Math.abs(nx) < 0.5 ? undefined : Math.round(nx) + 'px';
      patch.top = Math.abs(ny) < 0.5 ? undefined : Math.round(ny) + 'px';
      patch.right = undefined;
      patch.bottom = undefined;
    } else {
      const cbEl = d.isFixed
        ? (ctx.canvasRef.current as HTMLElement | null)
        : (elNow.offsetParent as HTMLElement | null);
      const cb = cbEl ? contentBoxOf(cbEl) : null;
      if (cb) {
        const dL = (targetLeft - cb.left) / zNow;
        const dR = (cb.right - (targetLeft + d.rect.width)) / zNow;
        const dT = (targetTop - cb.top) / zNow;
        const dB = (cb.bottom - (targetTop + d.rect.height)) / zNow;
        /**
         * v0.4.5 第 15 批（用户反复反馈："position: fixed 要自动用两边作为定位基准，现在拖不动"）：
         *
         * 真因：一个元素如果**两边都锚着**（`left+right` 或 `top+bottom`，且没写 width/height），
         * 它的尺寸是**由这两边撑出来的**。以前拖动只写一边、把对边清掉 →
         * 尺寸约束瞬间消失，盒子塌成内容宽度/0 高度（实测 849px 宽的元素一拖变 60px、
         * 四边全设的元素高度直接变 0）—— 看起来就是"拖不动 / 拖一下就废了"。
         *
         * 现在：**双边约束的轴改成"两边一起平移"**（left 加多少、right 就减多少），
         * 盒子尺寸完全不变，只是整体挪位置。这才是设计工具里"拉伸约束"的正确行为。
         */
        if (d.stretchX) {
          const nx = d.startLeft + axMove / zNow;
          const nr = d.startRight - axMove / zNow;
          patch.left = Math.round(nx) + 'px';
          patch.right = Math.round(nr) + 'px';
        } else if (d.axisSide.x === 'right') {
          patch.right = Math.round(dR) + 'px';
          patch.left = undefined;
        } else {
          patch.left = Math.round(dL) + 'px';
          patch.right = undefined;
        }
        if (d.stretchY) {
          const ny = d.startTop + ayMove / zNow;
          const nb = d.startBottom - ayMove / zNow;
          patch.top = Math.round(ny) + 'px';
          patch.bottom = Math.round(nb) + 'px';
        } else if (d.axisSide.y === 'bottom') {
          patch.bottom = Math.round(dB) + 'px';
          patch.top = undefined;
        } else {
          patch.top = Math.round(dT) + 'px';
          patch.bottom = undefined;
        }
      }
    }
  }

  // —— 常规流元素拖到父容器中线：实时切 margin:auto 居中 ——
  // 注意：**只对常规流做**。定位元素以前也走这里，结果"一居中就把 left 清成 undefined"，
  // 元素会瞬间弹到容器左边再被 margin 拉回来 —— 正是用户看到的"left 突然清零 + 闪烁"。
  if (parentNow && elNow && !d.positioned) {
    const pr = parentNow.getBoundingClientRect();
    const pcs = getComputedStyle(parentNow);
    const cL = pr.left + parentNow.clientLeft + (parseFloat(pcs.paddingLeft) || 0);
    const cR = pr.right - parentNow.clientLeft - (parseFloat(pcs.paddingRight) || 0);
    const innerW = cR - cL;
    const centered = innerW > 0 && d.rect.width < innerW - 2
      && Math.abs((targetLeft + d.rect.width / 2) - (cL + innerW / 2)) <= 3;
    if (centered) {
      patch.marginLeft = 'auto';
      patch.marginRight = 'auto';
    } else {
      // 常规流：右边留 auto 会把元素挤到奇怪的位置
      patch.marginRight = undefined;
    }
  }

  // —— Alt 拖动时画布持续向下生长（v0.4.5：按鼠标位置主动预留，不再等元素撞墙）——
  // v0.4.6（R6-16）：fixed 的墙**不再跟着画布长**。画布长出来的部分是"内容区"，
  // 而 fixed 的参照物是**基准视口**（首屏线）—— 让它跟着长就等于回到老问题：
  // 想把 fixed 拖到底，画布一长就永远拖不到。
  const canvasEl = ctx.canvasRef.current;
  if (canvasEl) ctx.growCanvasForDrag(ev.clientY);

  st.updateStyle(d.id, patch);
  if (hit) ctx.flashWall(hit);
  ctx.scheduleAltLiveBox();
  ctx.setAltBadge({ x: ev.clientX + 14, y: ev.clientY + 14, text: `${Math.round(ax)}, ${Math.round(ay)}` });
}

/**
 * 松手：把"贴边"归一化成更合理的 CSS，并收束成一条撤销。
 *   · fixed：贴到画布（= 浏览器视口）底边/右边 → 写成 bottom: 0 / right: 0
 *   · relative / 常规流：拖到父容器中线 → margin-left/right: auto
 */
export function finishAltDrag(d: AltDragState, ctx: AltDragCtx): void {
  // 「拖到墙外 → 改父子关系」收尾：清理淡化标记 + 执行 reparent
  if (d.reparent) {
    document.body.classList.remove('bc-reparenting');
    q(d.id)?.removeAttribute('data-bc-drag-src');
    ctx.setDropTarget(null);
    if (d.engaged) useScene.getState().endStyleEdit(); // 先把拖动产生的样式改动收成一条撤销
    if (d.dropId) {
      useScene.getState().reparent(d.id, d.dropId);
      useScene.getState().selectElement(d.id);
    }
    swallowNextClick();
    return;
  }

  if (!d.engaged) return; // 没拖（纯 Alt+单击）→ 什么都不做，交给元素自身 onClick 走"选中父级"

  if (d.mode === 'move') {
    const el = q(d.id);
    const cvRaw = ctx.canvasRef.current?.getBoundingClientRect();
    // v0.4.5：Alt 拖动期间画布被临时加长了（无限画布），松手那一刻 padding 还没归零。
    // "贴到画布底边"要对着**去掉临时加长后的真实底边**判断 —— 否则永远贴不上。
    // ⚠ 不能读 altPadRef：它在开始时就被清零了，这里要读**当前 DOM 上真实的**
    //    padding-bottom（React 还没提交这次清零）。
    const padNow = ctx.canvasRef.current
      ? (parseFloat(getComputedStyle(ctx.canvasRef.current).paddingBottom) || 0)
      : 0;
    const cv = cvRaw ? {
      top: cvRaw.top,
      bottom: cvRaw.bottom - padNow,
      left: cvRaw.left,
      right: cvRaw.right
    } : undefined;
    /**
     * v0.4.6（R6-16）：fixed 的"底面"是**首屏线**，不是画布底。
     *
     * 以前拿画布底（cv.bottom）当视口底 —— 可画布会随内容长到 3000px，
     * 于是"往下拖到贴底"永远贴不到用户心里的"首屏底部"，`bottom: 0` 写不出来；
     * 反过来，之前写死的 bottom 值在长页面上又跑到看不见的地方。
     * 现在按基准视口高度算首屏线，画布比它矮时仍取画布底（免得线跑到画布外）。
     */
    const vp = cvRaw
      ? Math.min(cvRaw.bottom - padNow, cvRaw.top + (ctx.viewportHeightRef.current || 900))
      : undefined;
    const cvFixed = cv && vp !== undefined ? { ...cv, bottom: vp } : cv;
    if (el) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const patch: Record<string, string | undefined> = {};
      // v0.4.5：Alt 拖动期间画布会临时加长（"无限画布"），元素很难真的"撞到"原来的下沿。
      // 所以贴边判定除了看元素自己的边，还看**手拖到哪儿了** ——
      // 鼠标落在（真实）画布边缘 12px 内，就认为用户是想贴那一边。
      const nearBottom = (d.isFixed && cvFixed ? cvFixed.bottom : (cv ? cv.bottom : Infinity))
        - Math.min(r.bottom, d.lastY) <= 12;
      const nearTop = Math.min(r.top, d.lastY) - (cv ? cv.top : -Infinity) <= 12;
      const nearRight = (cv ? cv.right : Infinity) - Math.min(r.right, d.lastX) <= 12;
      const nearLeft = Math.min(r.left, d.lastX) - (cv ? cv.left : -Infinity) <= 12;
      if (d.isFixed && cv) {
        /**
         * v0.4.5 第 15 批（用户反复反馈："fixed 要自动用两边做定位基准，现在拖不动"）：
         *
         * 松手时的"贴边吸附"会写 `bottom: 0` 并**清掉 top**。
         * 对一个双边约束（top+bottom、没写 height）的元素来说，这一下就把高度约束打没了 ——
         * 实测四边全设的元素一拖，高度从 520 直接变 0。
         *
         * 所以：**双边约束的轴不做贴边归一化**（那两边本来就是用户要的定位基准）。
         */
        /**
         * v0.4.6（R6-16）：**只有"页面不超过一屏"时才把贴边归一化成 bottom/right: 0**。
         *
         * 原因：画布自己就是 fixed 的包含块。`bottom: 0` 在这个包含块里解析成"画布底"，
         * 而画布会随内容长到 3000px —— 于是长页面上松手的一瞬间，元素会从首屏线
         * **跳到页面最底部**（用户看到的就是"一松手就飞走了"）。
         * 短页面（画布高度 ≈ 基准视口）时 `bottom: 0` 恰好等于首屏底，这时才写它。
         * 长页面上保留数值偏移：位置不跳，导出的 `top: Npx` 在 900px 窗口里也是同一处。
         */
        const canvasTall = (ctx.canvasRef.current?.offsetHeight ?? 0) > (ctx.viewportHeightRef.current || 900) + 4;
        if (!d.stretchY && !canvasTall) {
          if (nearBottom) { patch.bottom = '0px'; patch.top = undefined; }
          else if (nearTop) { patch.top = '0px'; patch.bottom = undefined; }
        }
        if (!d.stretchX && !canvasTall) {
          if (nearRight) { patch.right = '0px'; patch.left = undefined; }
          else if (nearLeft) { patch.left = '0px'; patch.right = undefined; }
        }
      }

      // —— relative / 常规流：贴边与居中都用"更稳定的 CSS"表达 ——
      // · 水平中线 → margin-left/right: auto（比写死一个 left/margin 偏移更耐改）
      // · 偏移归零 → 清掉 left/top，别在样式里留一堆 left:0
      //
      // ⚠ v0.4.5 修正：relative **不再**在松手时改写成 right / bottom。
      // relative 的 right/bottom 是"相对自身文档流原位的反向位移"，跟"距父容器右边多远"
      // 根本不是一回事 —— 元素明明拖到容器右侧（left 是个大正值），松手却写成
      // `right: 0`（= 回到原位），视觉上就是"一松手弹回去"。这正是用户反馈的
      // "relative 的定位非常糟糕、会瞬移"。relative / sticky 全程只用 left/top。
      const parentEl = el.parentElement;
      const relOrSticky = cs.position === 'relative' || cs.position === 'sticky';
      if (!d.isFixed && parentEl && r.width > 0) {
        const pr = parentEl.getBoundingClientRect();
        const pcs = getComputedStyle(parentEl);
        const padL = parseFloat(pcs.paddingLeft) || 0;
        const padR = parseFloat(pcs.paddingRight) || 0;
        const contentL = pr.left + parentEl.clientLeft + padL;
        const contentR = pr.right - parentEl.clientLeft - padR;
        const innerW = contentR - contentL;

        if (relOrSticky) {
          // relative / sticky：只保留"归零清理"与"拖到中线 → margin auto 居中"。
          // **不写 right/bottom**（见上）。
          const centered = innerW > 0 && r.width < innerW - 2
            && Math.abs((r.left + r.width / 2) - (contentL + innerW / 2)) <= 3;
          if (centered) {
            patch.marginLeft = 'auto';
            patch.marginRight = 'auto';
            patch.left = undefined;
          } else {
            if (Math.abs(parseFloat(cs.left) || 0) < 0.5) patch.left = undefined;
            if (Math.abs(parseFloat(cs.top) || 0) < 0.5) patch.top = undefined;
          }
          patch.right = undefined;
          patch.bottom = undefined;
        } else {
          // 水平居中（元素比父容器窄时才用 auto，否则 auto 两边都是 0、等于没居中）
          if (innerW > 0 && r.width < innerW - 2
            && Math.abs((r.left + r.width / 2) - (contentL + innerW / 2)) <= 3) {
            patch.marginLeft = 'auto';
            patch.marginRight = 'auto';
          }
          if (cs.position === 'static') {
            // 常规流：margin 归零就删掉，避免样式里堆 margin-left: 0px
            if (Math.abs(parseFloat(cs.marginLeft) || 0) < 0.5) patch.marginLeft = undefined;
            if (Math.abs(parseFloat(cs.marginTop) || 0) < 0.5) patch.marginTop = undefined;
          }
        }
      }
      if (Object.keys(patch).length > 0) {
        useScene.getState().updateStyle(d.id, patch as never);
      }
    }
  }
  useScene.getState().endStyleEdit();
  swallowNextClick();
}

/** 吞掉这次拖拽之后冒泡上来的 click（否则会顺手选中/选中父级） */
function swallowNextClick(): void {
  const swallow = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    window.removeEventListener('click', swallow, true);
  };
  window.addEventListener('click', swallow, true);
}
