import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useClosing } from '@lib/useClosing';
import { useHoverPop } from '@lib/hoverPop';

// BlockCanvas · "?" 帮助按钮 + 悬停 0.5s 缓入与点击通用组件
// - 鼠标悬停 0.5 秒后自动平滑淡入气泡，无需强制点击；也可直接点击瞬间开关
// - Portal 挂载到 document.body + fixed 定位，自动检测视口边界向上/向下翻转
// - 滚动 / Esc / 移开鼠标 自动平滑关闭（带退场动画，不再是"啪一下没了"）
// - ⚠ 故意不写原生 title：否则悬停会同时冒出"长方形系统提示 + 我们的气泡"两层，重复又难看。
//   （工具栏那些按钮没有自定义气泡，继续用原生 title，悬停即时显示。）
// - 悬停节奏统一走 lib/hoverPop（全程序一致：500ms 弹出 / 300ms 收起）。

interface Props {
  title: string;
  content: string;
}

interface Pos {
  top: number;
  left: number;
  dir: 'down' | 'up';
}

export function HelpButton(props: Props) {
  // 统一悬停节奏（与工具栏工具组、元素面板、任务按钮共用同一套时长）
  const { open, setOpen, scheduleOpen, scheduleClose, cancel, toggle } = useHoverPop();
  const [pos, setPos] = useState<Pos | null>(null);
  // 退场动画：关闭时先挂 is-closing 播动画，再真正卸载
  const { mounted, closing } = useClosing(open, 160);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // 点击事件即刻切换（点击不等防抖）
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPos(null);
    toggle();
  };

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // v0.4.4：Esc 只关气泡，不能顺手把画布选中也取消掉（全局 Esc 会清选中）
        e.stopPropagation();
        e.preventDefault();
        setOpen(false);
      }
    };
    const onWheel = (e: WheelEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    document.addEventListener('wheel', onWheel, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
      document.removeEventListener('wheel', onWheel, true);
    };
  }, [open]);

  // 打开后计算绝对定位与方向
  // ⚠ 依赖里必须带 mounted：open=true 那一帧 mounted 还是 false（useClosing 要等它自己的
  //    effect 跑完才把 mounted 置真），此时 Portal 尚未渲染 → popRef.current 为 null →
  //    这个 effect 直接 return；若只依赖 [open]，之后再也不会重跑，
  //    pos 永远是 null → 气泡停在 left:-9999 + visibility:hidden（= "所有问号提示全部失效"）。
  useEffect(() => {
    if (!open || !mounted || !popRef.current || !btnRef.current) return;
    const btn = btnRef.current.getBoundingClientRect();
    const pop = popRef.current;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const gap = 8;
    const margin = 6;
    const placeBelow = btn.bottom + gap + h <= window.innerHeight - margin;
    const dir: 'down' | 'up' = placeBelow ? 'down' : 'up';
    const top = dir === 'down'
      ? btn.bottom + gap
      : Math.max(margin, btn.top - h - gap);
    const left = Math.min(Math.max(margin, btn.left), window.innerWidth - w - margin);
    setPos({ top, left, dir });
  }, [open, mounted]);

  return (
    <>
      <span
        className="help-wrap"
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
      >
        <button
          ref={btnRef}
          className="help-btn"
          onClick={handleClick}
          aria-label={props.title}
        >?</button>
      </span>
      {mounted && createPortal(
        <div
          ref={popRef}
          className={
            'help-pop help-pop-fixed'
            + (pos ? ' ' + pos.dir : '')
            + (closing ? ' is-closing' : ' fade-in')
          }
          style={pos
            ? { top: pos.top, left: pos.left }
            : { top: 0, left: -9999, visibility: 'hidden' }}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={cancel}
          onMouseLeave={scheduleClose}
        >
          <div className="help-pop-header">
            <span className="help-pop-title">{props.title}</span>
            <button className="help-pop-close" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>×</button>
          </div>
          <div className="help-pop-body">
            {props.content
              .split('\n')
              .map((line) => line.replace(/\s+$/, ''))
              // 空行只用来分段，不再渲染成一个个空 <p>（否则气泡里到处是空隙）
              .filter((line) => line.trim() !== '')
              .map((line, i) => (
                <p key={i} className={/^[·•\-*]\s?/.test(line.trim()) ? 'help-pop-li' : undefined}>{line}</p>
              ))}
          </div>
          <div className="help-pop-footer">
            <button className="help-pop-ok" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>知道了</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
