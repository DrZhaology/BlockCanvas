// ============================================================================
// BlockCanvas · v0.4.6 竖屏「图层」底部面板
// ----------------------------------------------------------------------------
// 用户原话（第 44 批追问后确认的最终形态）：
//   「图层的进入放到右侧划入的属性面板，改回类似电脑端右侧菜单上方的布局。
//     但是点击图层的时候：右侧的属性面板退出，下方出现图层面板。
//     图层面板左侧就是图层和属性，以及开启拖动按钮也放到左侧，
//     同时加入关闭面板按钮，就是关闭这个图层面板。
//     如果点击属性，下方图层面板退出，右侧属性面板划入。」
//
// 于是这块面板的左侧栏是**四件事**（从上到下）：
//   图层（当前态）/ 属性（切走）/ 开启拖动 / 关闭面板
//
// 布局事实（改之前先看这里）：
//   · 面板是 fixed 覆盖层，底边钉在**第一条栏上沿**（--pt-bar1-h），所以它天然
//     盖住第二条操作栏、永远不盖第一条 —— 用户要的正是这个层级关系；
//   · 它比第二条栏"晚"画（DOM 在后 + z-index 55），而栏里的工具栏已经被
//     36 号分片把 z-index 归零，所以栏里的按钮不会再浮到面板上面。
// ============================================================================
import { useState } from 'react';
import { LayerTree } from '../LayerTree';
import { Icon } from '../Icon';
import { usePortraitPrefs } from '@lib/portraitPrefs';

/** 拖动开关的持久化键：和桌面图层树共用一份，换端不用重开 */
const DRAG_KEY = 'bc-layer-drag';

export function PortraitLayers(props: {
  open: boolean;
  /** 切到「属性」：收起本面板 + 打开右侧属性抽屉 */
  onOpenProps: () => void;
  /** 关闭本面板（用户要求：左侧栏里给一颗明确的关闭按钮） */
  onClose: () => void;
}) {
  const { open, onOpenProps, onClose } = props;
  // 高度来自「设置 → 竖屏设置 → 图层面板高度」，改完立刻生效（不刷新）
  const prefs = usePortraitPrefs();
  // 拖动开关放在左侧栏（用户："开启拖动按钮也放到左侧"），所以由这里持有状态，
  // 树那边走 dragToggle='external' 的受控模式，不会自己再画一颗。
  const [drag, setDrag] = useState<boolean>(() => {
    try { return localStorage.getItem(DRAG_KEY) === '1'; } catch { return false; }
  });
  const toggleDrag = () => {
    const next = !drag;
    setDrag(next);
    try { localStorage.setItem(DRAG_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  };

  return (
    <div
      className={'pt-sheet' + (open ? ' is-open' : '')}
      style={{ height: `${prefs.sheetVh}vh` }}
      aria-hidden={!open}
      role="region"
      aria-label="图层"
    >
      {/* 左侧竖条：图层 / 属性 / 拖动 / 关闭 */}
      <div className="pt-sheet-rail">
        <div className="pt-sheet-tab is-active" aria-current="true">图层</div>
        <button
          type="button"
          className="pt-sheet-tab"
          title="切到属性面板（会收起图层面板并打开右侧属性）"
          onClick={onOpenProps}
        >属性</button>
        {/* 把空白撑开，让下面两颗工具按钮贴底（拇指够得着） */}
        <div className="pt-sheet-rail-gap" />
        <button
          type="button"
          className={'pt-sheet-tool' + (drag ? ' is-on' : '')}
          aria-pressed={drag}
          title={drag ? '拖动排序已开启：按住图层行上下调序' : '开启拖动排序'}
          onClick={toggleDrag}
        >
          <Icon name="hand" size={17} />
          <span>拖动</span>
        </button>
        <button
          type="button"
          className="pt-sheet-tool"
          title="关闭图层面板（回到画布）"
          onClick={onClose}
        >
          <Icon name="close" size={17} />
          <span>关闭</span>
        </button>
      </div>
      <div className="pt-sheet-body">
        {/* 竖屏档位：行内操作按钮不渲染，改成"长按出行菜单"；拖动模式下不弹菜单 */}
        <LayerTree portrait dragToggle="external" dragEnabled={drag} />
      </div>
    </div>
  );
}

export default PortraitLayers;
