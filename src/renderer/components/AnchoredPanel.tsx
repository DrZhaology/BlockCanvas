import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useClosing } from '@lib/useClosing';

// ============ 通用「锚点弹出面板」 ============
// 从 Toolbar.tsx 抽出来独立成模块（v0.4.4）：工具栏与「任务」按钮都要用它，
// 放在 Toolbar 里会形成 Toolbar ↔ TaskButton 的循环 import。
//
// 弹出内容 Portal 到 body 用 fixed 定位，因此不受工具栏横向滚动区 overflow 裁切；
// 统一处理：外部点击 / Esc / 滚动 / 缩放 关闭，并在靠近屏幕底部时自动向上翻转。
// 进场 / 退场动画统一走 animations.css 的 bcPopIn / bcPopOut（与 ? 气泡、元素面板一致）。
export function AnchoredPanel(props: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  align?: 'left' | 'right';
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: React.ReactNode;
}) {
  const { open, anchorRef, onClose, className, align = 'left', onMouseEnter, onMouseLeave, children } = props;
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 退场动画：关闭时先挂 is-closing 播 bcPopOut，动画结束再真正卸载
  const { mounted, closing } = useClosing(open, 140);

  // 定位：**按面板真实宽高算**（以前硬编码 360 宽，"⋯更多"这种窄面板会被推到很左边，
  // 看起来就是"菜单飘到左边去了"）。首帧先以 visibility:hidden 渲染出来量尺寸，
  // useLayoutEffect 里量完立刻定位 —— 在绘制前完成，所以不会闪一下。
  useLayoutEffect(() => {
    if (!mounted) { setPos(null); return; }
    const place = () => {
      const el = anchorRef.current;
      const panel = panelRef.current;
      if (!el || !panel) return;
      const r = el.getBoundingClientRect();
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      if (!w || !h) return;
      const margin = 8;
      const gap = 6;
      const rawLeft = align === 'right' ? r.right - w : r.left;
      const left = Math.min(Math.max(margin, rawLeft), Math.max(margin, window.innerWidth - w - margin));
      const below = r.bottom + gap + h <= window.innerHeight - margin;
      const top = below ? r.bottom + gap : Math.max(margin, r.top - gap - h);
      setPos((cur) => (cur && cur.left === left && cur.top === top && cur.below === below ? cur : { left, top, below }));
    };
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target;
      if (t instanceof Element && (anchorRef.current?.contains(t) || t.closest('.tb-anchored-panel'))) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    const onScroll = () => closeRef.current();
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [mounted, anchorRef, align]);

  if (!mounted) return null;
  return createPortal(
    <div
      ref={panelRef}
      className={'tb-anchor-pos' + (pos && !pos.below ? ' above' : '')}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: 'hidden' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* 带上 toolbar 类名 → 复用工具栏里那套按钮语言（ghost/soft/primary/icon 与设备分段等） */}
      <div className={'toolbar tb-anchored-panel ' + (className ?? '') + (closing ? ' is-closing' : '')}>{children}</div>
    </div>,
    document.body
  );
}
