// ============================================================================
// BlockCanvas · v0.4.6 竖屏「图层」底部面板
// ----------------------------------------------------------------------------
// 用户原话：
//   「图层面板要重做，把图层面板放到下面去，左侧可以切换图层和属性……图层态不能关闭，
//     可以覆盖第二层操作栏，但不能覆盖第一层……切换动画要丝滑一点，
//     只保留最干净的层级结构，右侧那些操作按钮全删了改成右键菜单……」
//   本轮追问后确认：
//     · 竖屏**只把图层搬到下面**（方便一边看画布一边调层级），属性仍然在右侧抽屉里；
//     · 图层面板**完全不能直接关**（没有关闭按钮、点旁边也不关、下滑也不关），
//       要离开它只能切到「属性」—— 那一下会把这块面板收掉、并把右侧属性抽屉打开。
//       这是用户明确要的"防误触"，不要"顺手优化"成点外面就关。
//
// 布局事实（改之前先看这里）：
//   · 面板是 fixed 覆盖层，底边钉在**第一条栏上沿**（--pt-bar1-h），所以它天然
//     盖住第二条操作栏、永远不盖第一条 —— 用户要的正是这个层级关系；
//   · 它比第二条栏"晚"画（DOM 在后 + z-index 55），而栏里的工具栏已经被
//     36 号分片把 z-index 归零，所以栏里的按钮不会再浮到面板上面。
// ============================================================================
import { LayerTree } from '../LayerTree';
import { usePortraitPrefs } from '@lib/portraitPrefs';

export function PortraitLayers(props: {
  open: boolean;
  /** 切到「属性」：收起本面板 + 打开右侧属性抽屉 */
  onOpenProps: () => void;
}) {
  const { open, onOpenProps } = props;
  // 高度来自「设置 → 竖屏设置 → 图层面板高度」，改完立刻生效（不刷新）
  const prefs = usePortraitPrefs();

  return (
    <div
      className={'pt-sheet' + (open ? ' is-open' : '')}
      style={{ height: `${prefs.sheetVh}vh` }}
      aria-hidden={!open}
      role="region"
      aria-label="图层"
    >
      {/* 左侧切换条：图层 / 属性（用户："左侧可以切换图层和属性"） */}
      <div className="pt-sheet-rail">
        <div className="pt-sheet-tab is-active" aria-current="true">图层</div>
        <button
          type="button"
          className="pt-sheet-tab"
          title="切到属性面板（会收起图层面板并打开右侧属性）"
          onClick={onOpenProps}
        >属性</button>
      </div>
      <div className="pt-sheet-body">
        {/* 竖屏档位：行内操作按钮不渲染，改成"长按出行菜单"；拖动模式下不弹菜单 */}
        <LayerTree portrait />
      </div>
    </div>
  );
}

export default PortraitLayers;
