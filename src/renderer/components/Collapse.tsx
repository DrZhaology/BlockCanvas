import { useEffect, useRef, useState, type ReactNode } from 'react';

// BlockCanvas · 通用展开/收起容器
// 解决问题：过去所有折叠区都是「条件渲染」——展开有瞬间弹出感，收起完全没有动画，
// 一大块内容凭空出现/消失，容易让人疑惑。
//
// 实现：grid-template-rows 0fr ↔ 1fr 过渡（height:auto 也可动画，无需测量高度），
// 叠加 opacity + translateY，统一 0.3s 缓动。
//  - 展开：挂载 → 下一帧切到 is-open（0.3s 撑开 + 淡入上浮）
//  - 收起：切回关闭态（0.3s 收拢 + 淡出）→ 动画结束后才真正卸载
//  - 动画结束后 inner 的 overflow 从 hidden 放开为 visible，
//    否则属性面板里的下拉菜单/气泡会被裁切。

const SAFETY = 340; // 比 300ms 过渡略长，兜底 transitionend 丢失

interface Props {
  open: boolean;
  children: ReactNode;
  /** 附加在 .collapse 上的类名（如 inspector-sec-body 的间距由外层控制） */
  className?: string;
  /** 收起后是否保留在 DOM（默认不保留，节省渲染） */
  keepMounted?: boolean;
}

export function Collapse({ open, children, className, keepMounted = false }: Props) {
  const [mounted, setMounted] = useState(open || keepMounted);
  const [expanded, setExpanded] = useState(open);
  const [settled, setSettled] = useState(open);
  const rafRef = useRef(0);
  const timerRef = useRef(0);

  useEffect(() => {
    window.cancelAnimationFrame(rafRef.current);
    window.clearTimeout(timerRef.current);

    if (open) {
      setMounted(true);
      setSettled(false);
      // 先以「收拢态」渲染一帧，再切到展开态，否则浏览器会合并成一次样式计算、动画不触发
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = window.requestAnimationFrame(() => setExpanded(true));
      });
      timerRef.current = window.setTimeout(() => setSettled(true), SAFETY);
    } else {
      setExpanded(false);
      setSettled(false);
      timerRef.current = window.setTimeout(() => {
        if (!keepMounted) setMounted(false);
      }, SAFETY);
    }

    return () => {
      window.cancelAnimationFrame(rafRef.current);
      window.clearTimeout(timerRef.current);
    };
  }, [open, keepMounted]);

  if (!mounted) return null;

  return (
    <div
      className={
        'collapse' +
        (expanded ? ' is-open' : '') +
        (settled ? ' is-settled' : '') +
        (className ? ' ' + className : '')
      }
      aria-hidden={!open}
    >
      <div className="collapse-inner">{children}</div>
    </div>
  );
}

export default Collapse;
