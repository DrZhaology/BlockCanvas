// BlockCanvas · Alt 交互的「小装饰件」（v0.4.7 从 useAltDrag.ts 拆出）
//
// 这几个东西都是纯 DOM 副作用，跟画布几何计算完全无关，但以前都挤在 useAltDrag 里，
// 让那个 hook 涨到 630+ 行（probe-arch 的红线是 600）。拆出来之后：
//   · useAltDrag     —— 状态 + 事件接线 + 几何调用
//   · 本文件          —— 幽灵预览 / 撞墙闪烁 / Alt 光标标记
//
// 为什么做成"工厂 + 传 ref"而不是几个独立 hook：
//   它们共享同一批 ref（幽灵节点、预览定时器、被标记光标的元素）。
//   拆成工厂后仍然共用同一份引用，但不再占 useAltDrag 的行数。
import type { Bar } from './types';

export type AltChromeRefs = {
  /** "拿着元素"时的鼠标幽灵 */
  altGhostRef: React.MutableRefObject<HTMLElement | null>;
  /** 停留 1 秒预览改父级的定时器 */
  altPreviewTimer: React.MutableRefObject<number>;
  abortedPreview?: never;
  /** 当前预览中的目标 id */
  altPreviewRef: React.MutableRefObject<string | null>;
  /** 被标了 data-bc-alt 的元素（CSS 据此换 resize/move 光标） */
  altTaggedRef: React.MutableRefObject<HTMLElement | null>;
  /** 撞墙闪光定时器 */
  wallFlashTimer: React.MutableRefObject<number>;
  setWallFlash: (b: Bar | null) => void;
};

export function createAltChrome(r: AltChromeRefs) {
  /**
   * 起一个"幽灵"：克隆元素本体、缩小、跟鼠标走，告诉用户"正在搬的是这东西"。
   * 按元素真实大小定缩放：小元素 0.5 倍；很高的元素压到 ~200px 高，避免幽灵过大。
   */
  const spawnAltGhost = (srcEl: HTMLElement, rect: DOMRect) => {
    if (r.altGhostRef.current) return;
    const g = srcEl.cloneNode(true) as HTMLElement;
    g.removeAttribute('data-bc-id');
    g.querySelectorAll('[data-bc-id]').forEach((n) => n.removeAttribute('data-bc-id'));
    g.classList.add('bc-alt-ghost');
    const sc = Math.min(0.5, Math.max(0.16, 200 / Math.max(rect.height, 80)));
    g.style.transform = `translate(0, 0) scale(${sc})`;
    document.body.appendChild(g);
    r.altGhostRef.current = g;
  };

  /** 幽灵跟着鼠标走（+18px 偏移，避免压在指针下面挡住命中） */
  const moveAltGhost = (x: number, y: number) => {
    const g = r.altGhostRef.current;
    if (!g) return;
    g.style.transform = g.style.transform.replace(/translate\([^)]*\)/, `translate(${x + 18}px, ${y + 18}px)`);
  };

  /** 收掉幽灵 + 取消预览高亮 + 清定时器 */
  const removeAltGhost = () => {
    window.clearTimeout(r.altPreviewTimer.current);
    r.altPreviewRef.current = null;
    document.querySelectorAll('.bc-drop-preview').forEach((n) => n.classList.remove('bc-drop-preview'));
    r.altGhostRef.current?.remove();
    r.altGhostRef.current = null;
  };

  /**
   * 撞到"墙"时闪一下那条边（橙色）。
   * 为什么要闪：不闪的话用户只会觉得"拖不动/卡了"，闪一下等于说"这是限制，不是 BUG"。
   */
  const flashWall = (b: Bar | null) => {
    if (!b) return;
    r.setWallFlash(b);
    window.clearTimeout(r.wallFlashTimer.current);
    r.wallFlashTimer.current = window.setTimeout(() => r.setWallFlash(null), 620);
  };

  /** 给元素挂 data-bc-alt，让 CSS 把光标换成 resize / move / text */
  const tagAltCursor = (el: HTMLElement | null, kind: string) => {
    if (r.altTaggedRef.current && r.altTaggedRef.current !== el) {
      r.altTaggedRef.current.removeAttribute('data-bc-alt');
      r.altTaggedRef.current = null;
    }
    if (el) {
      el.setAttribute('data-bc-alt', kind);
      r.altTaggedRef.current = el;
    }
  };

  return { spawnAltGhost, moveAltGhost, removeAltGhost, flashWall, tagAltCursor };
}
