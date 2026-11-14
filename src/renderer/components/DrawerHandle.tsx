import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { useHandlePos, useLongPressDrag, type HandleSide } from '@lib/drawerHandle';

// 窄屏抽屉把手（v0.4.6）：短按开关抽屉，长按 420ms 后上下拖动调位置。
// 单独成组件的原因：它自己带三个状态（长按计时 / 拖动中 / 参考线），
// 塞进 App 会让那个 1100 行的组件再多一堆 ref。
export function DrawerHandle(props: {
  side: HandleSide;
  icon: IconName;
  title: string;
  opened: boolean;
  onToggle: () => void;
}) {
  const { side, icon, title, opened, onToggle } = props;
  const [pos, setY] = useHandlePos();
  const drag = useLongPressDrag(side, (y) => setY(side, y));
  const suppressClick = useRef(false);

  return (
    <>
      <button
        className={'shell-drawer-btn is-' + side + (opened ? ' is-on' : '')}
        style={{ top: `${pos[side]}%` }}
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

      {/* 调位置时屏幕上那条参考线（只在拖动中出现） */}
      {drag.guide !== null && createPortal(
        <div className="bc-handle-guide" style={{ top: drag.guide }} aria-hidden="true" />,
        document.body
      )}
    </>
  );
}

export default DrawerHandle;
