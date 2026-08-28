import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

// BlockCanvas · "?" 帮助按钮 + 悬停 1s 缓入与点击通用组件
// - 鼠标悬停 1 秒后自动平滑淡入气泡，无需强制点击；也可直接点击瞬间开关
// - Portal 挂载到 document.body + fixed 定位，自动检测视口边界向上/向下翻转
// - 滚动 / Esc / 移开鼠标 自动平滑关闭

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
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number>(0);
  const closeTimer = useRef<number>(0);

  const clearTimers = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = 0; }
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = 0; }
  };

  const handleMouseEnter = () => {
    clearTimers();
    if (!open) {
      hoverTimer.current = window.setTimeout(() => {
        setPos(null);
        setOpen(true);
      }, 1000); // 悬停 1 秒后缓入
    }
  };

  const handleMouseLeave = () => {
    clearTimers();
    if (open) {
      closeTimer.current = window.setTimeout(() => {
        setOpen(false);
      }, 300); // 给用户 300ms 鼠标移进弹层的时间
    }
  };

  // 点击事件即刻切换
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearTimers();
    setPos(null);
    setOpen((prev) => !prev);
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
      if (e.key === 'Escape') setOpen(false);
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
  useEffect(() => {
    if (!open || !popRef.current || !btnRef.current) return;
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
  }, [open]);

  useEffect(() => () => clearTimers(), []);

  return (
    <>
      <span
        className="help-wrap"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <button
          ref={btnRef}
          className="help-btn"
          onClick={handleClick}
          title={props.title + '（悬停1秒查看或点击开启）'}
        >?</button>
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          className={'help-pop help-pop-fixed' + (pos ? ' ' + pos.dir + ' fade-in' : '')}
          style={pos
            ? { top: pos.top, left: pos.left }
            : { top: 0, left: -9999, visibility: 'hidden' }}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => { clearTimers(); }}
          onMouseLeave={handleMouseLeave}
        >
          <div className="help-pop-header">
            <span className="help-pop-title">{props.title}</span>
            <button className="help-pop-close" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>×</button>
          </div>
          <div className="help-pop-body">
            {props.content.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
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
