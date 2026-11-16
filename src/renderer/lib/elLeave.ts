// ============================================================================
// BlockCanvas · 元素「退场动画」（v0.4.6）
// ----------------------------------------------------------------------------
// 用户反馈：「添加元素的加入动画和退出动画都没了，什么时候你删除了？」
//
// 进场和退场必须分开处理：
//   · 进场 → 节点是**新出现在 DOM 里**的，用一条短暂的数据标记 + CSS 动画即可
//     （见 canvas/useEnterAnim.ts）。
//   · 退场 → 节点当场就被从场景树里删掉了，DOM 也跟着消失，**没有机会播动画**。
//     所以这里做一个"影子"：删之前把当前节点克隆一份、按它原来的位置/大小钉在画布上，
//     播 200ms 淡出+微缩，然后自己清掉。
//
// 为什么不"延迟真删除"：删除是撤销栈里的一步，延迟 200ms 会让
// 「删完之后立刻 Ctrl+Z / 换选中 / 存储」全踩在中间态上，得不偿失。
// 影子只影响视觉，不碰任何状态。
// ============================================================================

const LEAVE_MS = 200;

export function flyOutElement(id: string): void {
  if (typeof document === 'undefined') return;
  const el = document.querySelector(`.canvas [data-bc-id="${CSS.escape(id)}"]`) as HTMLElement | null;
  if (!el) return;
  const canvas = el.closest('.canvas') as HTMLElement | null;
  if (!canvas) return;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;

  const cr = canvas.getBoundingClientRect();
  const zoom = canvas.offsetWidth > 0 ? cr.width / canvas.offsetWidth : 1;
  const padLeft = cr.left + canvas.clientLeft * zoom;
  const padTop = cr.top + canvas.clientTop * zoom;

  const ghost = el.cloneNode(true) as HTMLElement;
  // 影子不是可选元素：清掉所有身份标记，避免被选中/悬停/探针误认
  ghost.removeAttribute('data-bc-id');
  ghost.removeAttribute('data-bc-sel');
  ghost.removeAttribute('data-bc-cg');
  ghost.removeAttribute('data-bc-new');
  ghost.querySelectorAll('[data-bc-id]').forEach((n) => {
    n.removeAttribute('data-bc-id');
    n.removeAttribute('data-bc-sel');
  });
  ghost.classList.add('bc-node-leaving');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${(r.left - padLeft) / (zoom || 1)}px`,
    top: `${(r.top - padTop) / (zoom || 1)}px`,
    width: `${r.width / (zoom || 1)}px`,
    height: `${r.height / (zoom || 1)}px`,
    margin: '0',
    transform: 'none',
    translate: '0 0',
    pointerEvents: 'none',
    boxSizing: 'border-box'
  } as Partial<CSSStyleDeclaration>);
  canvas.appendChild(ghost);
  window.setTimeout(() => ghost.remove(), LEAVE_MS + 60);
}
