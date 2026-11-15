// BlockCanvas · 画布的「墙」与吸附（纯计算，不碰 React）
//
// 这是 v0.4.5 打磨最久的一块：Alt 拖动时元素能动到哪儿、会撞到谁、什么时候画橙色线。
// 拆成纯函数后规则可以单独推敲，也方便以后给"手机窄屏"复用同一套边界。
import { SELF_CLOSING_TAGS } from '@lib/types';
import { findNode } from '@store/sceneStore';
import { measureFixedViewport } from '@lib/fixedViewport';
import type { SceneElement } from '@lib/types';
import type { Bar, Bounds } from './types';

/**
 * 「拖到墙外 → 改父子关系」总开关。
 *
 * v0.4.5：按用户要求**暂时关闭**。理由：这个交互太容易误触（稍微多拖一点就换了父子），
 * 而"复制 / 剪切 + 粘贴到目标元素"对层级的控制更精确、更可预期。
 * 实现（pickDropTarget / 幽灵 / 1 秒停留预览）完整保留，把这里改回 true 即可恢复，
 * 不需要再改任何调用点。
 */
export const ALT_REPARENT_ENABLED = false;

/**
 * 「拖到墙外 → 改父子关系」：从鼠标下的 DOM 往上找第一个可作为新父级的**块级容器**。
 * 排除：被拖元素自身及其后代、当前父级（避免误重排）、自闭合元素、锁定元素、纯 inline 元素。
 */
export function pickDropTarget(
  under: HTMLElement | null,
  draggedEl: HTMLElement,
  currentParentId: string | null,
  root: SceneElement
): { id: string; rect: { x: number; y: number; w: number; h: number } } | null {
  let cur: HTMLElement | null = under;
  while (cur && cur !== document.body) {
    if (cur.hasAttribute?.('data-bc-id')) {
      const id = cur.getAttribute('data-bc-id')!;
      if (cur !== draggedEl && !draggedEl.contains(cur)) {
        const node = findNode(root, id);
        const cs = getComputedStyle(cur);
        const isBlock = cs.display !== 'inline' && cs.display !== 'contents';
        if (node && isBlock && !SELF_CLOSING_TAGS.has(node.type)
          && id !== currentParentId && cur.getAttribute('data-bc-locked') !== '1') {
          const r = cur.getBoundingClientRect();
          return { id, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
        }
      }
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * 计算元素"能动到哪儿"的边界（client 坐标）+ 每面墙要画的位置。
 *
 * 规则（v0.4.5 定稿）：
 *   · 墙基准取父容器的**内容盒**（去掉 padding/border），并**把元素自己的 margin 算进去** ——
 *     所以"碰到内边距/外边距"就停，不会无视 margin 直接突破。
 *   · **元素与元素的碰撞**：定位元素（absolute/relative/fixed）会把邻近兄弟的边缘当成墙，
 *     墙就画在那个兄弟的边上；只有没有兄弟可撞时才退回父容器/画布。
 *   · **常规流元素**（v0.4.5）：上方兄弟（边框底 + 兄弟 margin-bottom）是上墙 ——
 *     块级元素拖动不再互相压盖，也不会拖出大段负 margin；下方兄弟会被流推走，无需墙。
 *   · `fixed` 额外受**画布四边**限制（画布 = 浏览器视口）。
 *   · 常规流子元素：父容器**设了固定高度**时下墙 = 父内容盒底（不再穿出父容器）；
 *     自适应高度的父允许撑长（不设下墙）。
 */
export function boundsFor(el: HTMLElement, rect: DOMRect): Bounds {
  const canvasEl = el.closest('.canvas') as HTMLElement | null;
  const cs = getComputedStyle(el);
  const pos = cs.position;
  const isFixed = pos === 'fixed';
  const positioned = pos === 'absolute' || pos === 'relative' || pos === 'fixed';
  const m = {
    top: parseFloat(cs.marginTop) || 0,
    right: parseFloat(cs.marginRight) || 0,
    bottom: parseFloat(cs.marginBottom) || 0,
    left: parseFloat(cs.marginLeft) || 0
  };
  const boxOf = (n: HTMLElement) => {
    const r = n.getBoundingClientRect();
    const cw = n.clientWidth || r.width;
    const ch = n.clientHeight || r.height;
    const left = r.left + n.clientLeft;
    const top = r.top + n.clientTop;
    return { left, top, right: left + cw, bottom: top + ch };
  };
  const parentEl = el.parentElement;
  const pb = boxOf(parentEl && parentEl !== canvasEl ? parentEl : (canvasEl ?? el));

  // 墙的"整面"高亮条
  const vBar = (x: number, top: number, bottom: number) => ({ x: x - 2, y: top, w: 4, h: Math.max(2, bottom - top) });
  const hBar = (y: number, left: number, right: number) => ({ x: left, y: y - 2, w: Math.max(2, right - left), h: 4 });

  // 定位元素的 margin 是固定的 → 墙要把它算进去；常规流元素的 margin 本身就是被调的量 → 不算
  const addM = positioned;
  // 四面墙的"真实位置"（client 坐标）：元素的边缘最终会被挡在这条线上。
  // 注意：画在**墙的位置**（父容器内容盒内侧 ± 元素外边距），不是父容器的边框 —— 用户明确要求。
  let wallLeft = pb.left + (addM ? m.left : 0);
  let wallRight = pb.right - (addM ? m.right : 0);
  let wallTop = pb.top + (addM ? m.top : 0);
  let wallBottom = isFixed ? pb.bottom - (addM ? m.bottom : 0) : Infinity;

  // v0.4.4：`fixed` 是**独立的视口层** —— 它相对画布（= 模拟浏览器视口）定位，
  // 不与文档流里的兄弟元素碰撞，四面墙都取画布视口。
  //
  // v0.4.6 重做：画布里有一层 `.canvas-fixed-layer`，**它就是红框（浏览器视口）**，
  // 也是 fixed 元素的包含块。所以四面墙直接取这一层的位置 —— 与浏览器语义一字不差，
  // 不再需要"首屏线 / 基准视口高度"那套近似（用户连着三轮说不对的就是那个近似）。
  if (isFixed && canvasEl) {
    const vb = boxOf(canvasEl);
    // measureFixedViewport 返回 client 坐标；拿不到（还没布局）时退回画布盒
    const fv = measureFixedViewport(canvasEl);
    const vLeft = fv ? fv.left : vb.left;
    const vRight = fv ? fv.right : vb.right;
    const vTop = fv ? fv.top : vb.top;
    const vBottom = fv ? fv.bottom : vb.bottom;
    wallLeft = vLeft + m.left;
    wallRight = vRight - m.right;
    wallTop = vTop + m.top;
    wallBottom = vBottom - m.bottom;
  }
  // 每面墙要画的"整面"（默认铺满父容器内容盒；被兄弟元素挡住时改成画在那个兄弟的边上）
  let barL: Bar | null = vBar(wallLeft, pb.top, pb.bottom);
  let barR: Bar | null = vBar(wallRight, pb.top, pb.bottom);
  let barT: Bar | null = hBar(wallTop, pb.left, pb.right);
  let barB: Bar | null = Number.isFinite(wallBottom) ? hBar(wallBottom, pb.left, pb.right) : null;
  if (isFixed && canvasEl) {
    const vb = boxOf(canvasEl);
    const fv = measureFixedViewport(canvasEl);
    const vTop = fv ? fv.top : vb.top;
    const vBottom = fv ? fv.bottom : vb.bottom;
    const vLeft = fv ? fv.left : vb.left;
    const vRight = fv ? fv.right : vb.right;
    barL = vBar(wallLeft, vTop, vBottom);
    barR = vBar(wallRight, vTop, vBottom);
    barT = hBar(wallTop, vLeft, vRight);
    barB = hBar(wallBottom, vLeft, vRight);
  }

  // 元素与元素的碰撞：
  //  · 定位元素（absolute/relative）：邻近兄弟的边缘（含自身固定 margin）当墙
  //  · 常规流元素（v0.4.5）：上方兄弟当上墙（兄弟边框底 + 兄弟 margin-bottom）——
  //    块级元素拖动不再互相压盖、也不再拖出大段负 margin；下方兄弟会被流推走，不需要墙
  //  · fixed 不参与兄弟碰撞（它在独立的视口层）
  if (parentEl && !isFixed) {
    // relative 元素**仍在文档流里**：按常规流规则把它挡在上方兄弟下面，
    // 否则会出现"代码里是第二个、拖一拖视觉上跑到第一个上面"的假象（用户反馈）。
    const inFlow = !positioned || pos === 'relative';
    for (const sib of Array.from(parentEl.children) as HTMLElement[]) {
      if (sib === el || !sib.hasAttribute?.('data-bc-id')) continue;
      const sr = sib.getBoundingClientRect();
      const vOverlap = Math.min(rect.bottom, sr.bottom) - Math.max(rect.top, sr.top) > 1;
      const hOverlap = Math.min(rect.right, sr.right) - Math.max(rect.left, sr.left) > 1;
      if (!inFlow) {
        if (vOverlap) {
          if (sr.right <= rect.left + 1 && sr.right + m.left > wallLeft) { wallLeft = sr.right + m.left; barL = vBar(wallLeft, sr.top, sr.bottom); }
          if (sr.left >= rect.right - 1 && sr.left - m.right < wallRight) { wallRight = sr.left - m.right; barR = vBar(wallRight, sr.top, sr.bottom); }
        }
        if (hOverlap) {
          if (sr.bottom <= rect.top + 1 && sr.bottom + m.top > wallTop) { wallTop = sr.bottom + m.top; barT = hBar(wallTop, sr.left, sr.right); }
          if (sr.top >= rect.bottom - 1 && sr.top - m.bottom < wallBottom) { wallBottom = sr.top - m.bottom; barB = hBar(wallBottom, sr.left, sr.right); }
        }
      } else if (hOverlap && sr.bottom <= rect.top + 1) {
        const sibMB = parseFloat(getComputedStyle(sib).marginBottom) || 0;
        // relative 的 margin 是固定的，墙还要把元素自己的 margin-top 算进去（margin 盒不能叠）
        const wall = sr.bottom + sibMB + (pos === 'relative' ? m.top : 0);
        if (wall > wallTop) { wallTop = wall; barT = hBar(wall, sr.left, sr.right); }
      }
    }
  }

  // 常规流子元素（v0.4.5）：父容器**设了固定高度**时，下边界 = 父内容盒底（内边距内侧），
  // 下拖不再穿出父容器（且四面墙线齐全）；自适应高度的父仍允许被撑长（不设下墙）
  if (!positioned && parentEl && parentEl !== canvasEl && (parentEl as HTMLElement).style.height !== '') {
    const wb = pb.bottom;
    if (wb < wallBottom) { wallBottom = wb; barB = hBar(wb, pb.left, pb.right); }
  }

  let minX = wallLeft;
  let maxX = wallRight - rect.width;
  let minY = wallTop;
  let maxY = Number.isFinite(wallBottom) ? wallBottom - rect.height : Infinity;
  // —— 常规流：margin 不允许被拖成负数（用户明确"负数不合规、不好打理"）——
  if (!positioned) {
    const mt = parseFloat(cs.marginTop) || 0;
    const ml = parseFloat(cs.marginLeft) || 0;
    minY = Math.max(minY, rect.top - mt);
    minX = Math.max(minX, rect.left - ml);
  }
  // —— relative：最多回到自己的"文档流原位"，不能再往上/往左压到兄弟元素身上 ——
  if (pos === 'relative') {
    const curTop = parseFloat(cs.top) || 0;
    const curLeft = parseFloat(cs.left) || 0;
    minY = Math.max(minY, Math.min(rect.top - curTop, rect.top));
    minX = Math.max(minX, Math.min(rect.left - curLeft, rect.left));
  }
  // 兜底：范围别反转
  if (maxX < minX) maxX = minX;
  if (Number.isFinite(maxY) && maxY < minY) maxY = minY;
  // 允许至少停在原地
  minY = Math.min(minY, rect.top);
  if (Number.isFinite(maxY)) maxY = Math.max(maxY, rect.bottom - rect.height);

  // —— 吸附对齐参考线（PowerPoint 风格）：父容器 + 所有兄弟的 左/中/右、上/中/下 ——
  const snapX: number[] = [pb.left, (pb.left + pb.right) / 2, pb.right];
  const snapY: number[] = [pb.top, (pb.top + pb.bottom) / 2, pb.bottom];
  if (parentEl) {
    for (const sib of Array.from(parentEl.children) as HTMLElement[]) {
      if (sib === el || !sib.hasAttribute?.('data-bc-id')) continue;
      const sr = sib.getBoundingClientRect();
      snapX.push(sr.left, (sr.left + sr.right) / 2, sr.right);
      snapY.push(sr.top, (sr.top + sr.bottom) / 2, sr.bottom);
    }
  }

  return { minX, maxX, minY, maxY, barL, barR, barT, barB, snapX, snapY };
}

/**
 * 「拿着元素」（改父子关系）时的鼠标幽灵：元素缩小版，跟随鼠标。
 * 返回清理函数；不传元素时只做清理。
 */
export function spawnGhost(srcEl: HTMLElement, rect: DOMRect): HTMLElement {
  const g = srcEl.cloneNode(true) as HTMLElement;
  g.removeAttribute('data-bc-id');
  g.querySelectorAll('[data-bc-id]').forEach((n) => n.removeAttribute('data-bc-id'));
  g.classList.add('bc-alt-ghost');
  // 按元素真实大小定缩放：小元素 0.5 倍；很高的元素压到 ~200px 高，避免幽灵过大
  const sc = Math.min(0.5, Math.max(0.16, 200 / Math.max(rect.height, 80)));
  g.style.transform = `translate(0, 0) scale(${sc})`;
  document.body.appendChild(g);
  return g;
}

/** 幽灵跟随鼠标（只改 transform 里的 translate 部分，保留缩放） */
export function moveGhost(g: HTMLElement | null, x: number, y: number): void {
  if (!g) return;
  g.style.transform = g.style.transform.replace(/translate\([^)]*\)/, `translate(${x + 18}px, ${y + 18}px)`);
}

/** 清掉"停留 1 秒预览"的强化标记 */
export function clearDropPreview(): void {
  document.querySelectorAll('.bc-drop-preview').forEach((n) => n.classList.remove('bc-drop-preview'));
}

/** 元素生效的定位方式（场景样式 → 规范化成四种） */
export function posKindOf(el: HTMLElement): 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky' {
  const pos = getComputedStyle(el).position;
  return (['relative', 'absolute', 'fixed', 'sticky'] as const).includes(pos as never)
    ? (pos as 'relative' | 'absolute' | 'fixed' | 'sticky')
    : 'static';
}

