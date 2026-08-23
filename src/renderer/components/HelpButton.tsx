import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

// BlockCanvas · "?" 帮助按钮 + 紧凑 popover
// 用 Portal 渲染到 document.body + fixed 定位，彻底避免被属性面板的
// overflow 容器裁剪；打开后测量气泡尺寸，空间不够自动翻到按钮上方，
// 并夹紧在窗口范围内（不再出现部分内容跑到窗口外、文字看不到）。
// 点外部 / Esc / wheel 滚动 / "知道了" / × 关闭。

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
    // 滚动面板/窗口时气泡跟着按钮跑会错位，直接关闭
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

  // 打开后测量气泡尺寸，再定最终位置（下方空间不够→翻到上方；左右夹紧不越窗）
  useEffect(() => {
    if (!open || !popRef.current || !btnRef.current) return;
    const btn = btnRef.current.getBoundingClientRect();
    const pop = popRef.current;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const gap = 8;
    const margin = 4;
    const placeBelow = btn.bottom + gap + h <= window.innerHeight - margin;
    const dir: 'down' | 'up' = placeBelow ? 'down' : 'up';
    const top = dir === 'down'
      ? btn.bottom + gap
      : Math.max(margin, btn.top - h - gap);
    const left = Math.min(Math.max(margin, btn.left), window.innerWidth - w - margin);
    setPos({ top, left, dir });
  }, [open]);

  const toggle = () => {
    setPos(null);
    setOpen(!open);
  };

  return (
    <>
      <span className="help-wrap">
        <button
          ref={btnRef}
          className="help-btn"
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          title={props.title}
        >?</button>
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          className={'help-pop help-pop-fixed' + (pos ? ' ' + pos.dir : '')}
          style={pos
            ? { top: pos.top, left: pos.left }
            : { top: 0, left: -9999, visibility: 'hidden' }}
          onClick={(e) => e.stopPropagation()}
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