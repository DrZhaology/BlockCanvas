import { useRef } from 'react';
import { Icon, type IconName } from './Icon';
import { useHandlePos, useLongPressDrag, effectiveY, type HandleSide } from '@lib/drawerHandle';
import { useDrawerSide } from '@lib/drawerSide';

// 窄屏抽屉把手（v0.4.7）：一颗贴在屏幕边上的小"抽屉"，短按开关抽屉，
// 长按 420ms 后上下拖动调位置（双击复位）。
//
// v0.4.7 返工两点（用户实测反馈）：
//   ① 把手回到"第二版"的大小 —— 30×60 的盒、20×46 的可见小舌、14px 图标，
//      上一版做到 22×48 / 10×34 太小，手指找不到；
//   ② 长按调位置**不再画蓝色参考线**（用户："我是说可以和另一边的抽屉吸附对齐，
//      不是一根蓝色的线"）。吸附的反馈就是"两个把手真的对齐了"本身。
export function DrawerHandle(props: {
  side: HandleSide;
  icon: IconName;
  title: string;
  opened: boolean;
  onToggle: () => void;
}) {
  const { side, icon, title, opened, onToggle } = props;
  // 「都收在左边 / 都收在右边」时两个把手挤在同一条物理边上，必须上下错开
  const [sideMode] = useDrawerSide();
  const sameEdge = sideMode === 'both-left' || sideMode === 'both-right';
  const [pos, setY] = useHandlePos(sameEdge);
  const drag = useLongPressDrag(side, (y) => setY(side, y));
  const suppressClick = useRef(false);
  const y = effectiveY(pos, side, sameEdge);

  return (
    <button
      className={'shell-drawer-btn is-' + side + (opened ? ' is-on' : '')}
      style={{ top: `${y}%` }}
      title={title}
      aria-expanded={opened}
      data-dragging={drag.dragging ? '1' : '0'}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={() => {
        suppressClick.current = drag.onPointerUp();
      }}
      onPointerCancel={() => { drag.onPointerUp(); }}
      onDoubleClick={() => setY(side, 50)}
      onClick={() => {
        // 长按调位置那一次不要顺手把抽屉开/关掉
        if (suppressClick.current) { suppressClick.current = false; return; }
        onToggle();
      }}
    ><Icon name={icon} size={14} /></button>
  );
}

export default DrawerHandle;
