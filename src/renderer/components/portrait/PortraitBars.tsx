// ============================================================================
// BlockCanvas · v0.4.6 竖屏「操作栏」（底部两条，模仿手机浏览器）
// ----------------------------------------------------------------------------
// 用户原话（这轮的分工）：
//   「把整个上方的所有东西全部删除，包括多标签页，两层工具栏。现在上方是空白的了。」
//   「把屏幕下方的一部分区域，类似手机版 Edge 下方控制栏，作为核心的跳转入口和工具栏操作。」
//   「分成 2 条栏，从下到上：第一条最底，第二条在第一条上面。」
//   第一条只含 5 个核心按钮：撤销 / 重做 / 新建页面 / 管理会话 / 入口「三」。
//   第二条是桌面工具栏的按钮，**固定单行**、可左右横滑（抽屉手势已删，见 PortraitBar2 注释）。
//   第二条上方还有第三层「情境栏」（PortraitContextBar）：按钮按需出现，不常驻。
//
// 三条设计约束（写在这里免得后面改坏）：
//   1. **只在 `data-shell='stack'` 渲染**。宽屏一条不出现（DOM 里也没有），
//      所以桌面端一条老工具栏的行为一点不受影响。
//   2. 操作栏是 `.app` 的**最后一个 flex 子项**，不覆盖内容 ——
//      内容区（画布）自己缩，不做悬浮层。这样永远不会"盖住画布底部"。
//   3. 第一条栏在每个视图都在（首页 / 项目中心 / 设置 / 帮助 / 会话管理），
//      只是左端从"撤销+重做"换成"返回"（用户确认：「左端换成返回，只保留第一条栏」）。
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Toolbar } from '../Toolbar';
import { PortraitContextBar } from './PortraitContextBar';
import type { PortraitContextAction } from './PortraitContextBar';
import { useScene } from '@store/sceneStore';
import { useTabStore } from '@store/tabStore';

/** 会话数角标：圆角正方形 + 中间数字（用户指定：「svg 做成一个圆角正方形，中间数字」） */
function GlyphSessions({ n }: { n: number }) {
  return (
    <span className="pt-sess-glyph" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 22 22">
        <rect x="1.5" y="1.5" width="19" height="19" rx="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="pt-sess-count">{n > 99 ? '99' : n}</span>
    </span>
  );
}

/** 汉堡「三」 */
function GlyphMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M3.5 6h15M3.5 11h15M3.5 16h15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** 返回箭头 */
function GlyphBack() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M13.5 4.5 6.5 11l7 6.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 新建页面：一页纸 + 加号 */
function GlyphNewPage() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M4.5 3.5h9l4 4v11h-13z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13.5 3.5v4h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11 11v5M8.5 13.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export type PortraitBar1Props = {
  /** 当前视图（editor / projects / settings / help / update / table / sessions） */
  view: string;
  /** 编辑器且至少有一个会话时才显示撤销/重做 */
  editorish: boolean;
  onBack: () => void;
  onOpenSessions: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onOpenPlugins: () => void;
  /** 手册页专属：最左边那颗「侧边栏」（切换文档 / 搜索 / 目录）。其它页面不传 */
  onOpenHelpSidebar?: () => void;
};

/**
 * 第一条操作栏（最底下那条）：5 个核心按钮。
 *
 * 撤销/重做直接读 sceneStore 的 history 长度做可用性 —— 不走 useMemo 缓存，
 * 否则会读到首次渲染的旧值（这个坑在工具栏 `opMap` 上踩过）。
 */
export function PortraitBar1(props: PortraitBar1Props) {
  const { view, editorish, onBack, onOpenSessions, onOpenSettings, onOpenHelp, onOpenPlugins, onOpenHelpSidebar } = props;
  const [entryOpen, setEntryOpen] = useState(false);
  const entryRef = useRef<HTMLDivElement | null>(null);
  const entryBtnRef = useRef<HTMLButtonElement | null>(null);
  /** 二级菜单的位置：贴着按钮往上弹（用户："二级菜单不要固定位置，要求在按钮附近打开"） */
  const [entryPos, setEntryPos] = useState<{ right: number; bottom: number } | null>(null);
  const tabCount = useTabStore((s) => s.tabs.length);

  const openEntryMenu = () => {
    /**
     * 菜单位置：**第二条栏上沿之上**。
     *
     * 用户原话：「第一层菜单，也就是最下面的菜单，最右侧的类似"三"的按钮，
     *   打开的二级菜单在按钮上面，不要跑道二层菜单上面。」
     * → 菜单底边锚在**第二条栏的顶边**：既在按钮上方，又不会压在工具按钮上面。
     *   （上一版锚的是第一条栏顶边，菜单整块盖住第二条栏，工具按钮全被挡掉。）
     *
     * 右端对齐按钮右缘，这样虽然中间隔了一条栏，看起来仍然是这颗按钮的菜单。
     */
    const bar2 = document.querySelector('.pt-bar2')?.getBoundingClientRect();
    const r = entryBtnRef.current?.getBoundingClientRect();
    if (r) {
      // 兜底：第一条 56 + 第二条 48 —— 取不到矩形时按窗口底 104px 算，不会飘
      const bar2Top = bar2 ? bar2.top : window.innerHeight - 104;
      setEntryPos({
        right: Math.max(8, Math.round(window.innerWidth - r.right)),
        bottom: Math.round(window.innerHeight - bar2Top)
      });
    }
    setEntryOpen(true);
  };

  // 点旁边关闭「三」的二级菜单。菜单已经 Portal 到 body，所以要同时排除菜单本体
  useEffect(() => {
    if (!entryOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (entryRef.current?.contains(t)) return;
      if ((t as HTMLElement)?.closest?.('.pt-entry-menu')) return;
      setEntryOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [entryOpen]);

  const past = useScene((s) => s.history.past.length);
  const future = useScene((s) => s.history.future.length);
  /** 首页 = 编辑器视图但一个会话都没有（"新建项目"那张空首页）。
   *  用户："不同页面的下方第一条菜单要适配一下，不要总是那三个按钮" ——
   *  首页上"返回编辑器"是空操作，换成真正有用的「新建」。 */
  const isHome = view === 'editor' && !editorish;

  const newPageBtn = (
    <button
      className="pt-btn" type="button" aria-label="新建页面" title="新建页面"
      /* 交给 App 做两段式动画（旧画布左移出 → 新画布从右进），不再直接 newTab() */
      onClick={() => window.dispatchEvent(new CustomEvent('bc:new-page'))}
    >
      <GlyphNewPage />
    </button>
  );

  return (
    <div className="pt-bar pt-bar1" data-view={view} role="toolbar" aria-label="核心操作">
      {/* 竖屏手册页：最左边一颗「侧边栏」（用户："下方第一层工具栏加一个侧边栏按钮，
          放到最左边，可以打开侧边栏，切换文档，搜索"）。它排在「返回」之前。 */}
      {onOpenHelpSidebar && (
        <button
          className="pt-btn" type="button" aria-label="侧边栏" title="侧边栏：切换文档 / 搜索 / 目录"
          onClick={onOpenHelpSidebar}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="3.2" y="4.2" width="15.6" height="13.6" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M9 4.6v12.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M5.4 8.2h1.8M5.4 11h1.8M5.4 13.8h1.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {editorish ? (
        <>
          <button
            className="pt-btn" type="button" aria-label="撤销" title="撤销"
            disabled={past === 0}
            onClick={() => useScene.getState().undo()}
          >
            <svg width="24" height="24" viewBox="0 0 22 22" aria-hidden="true">
              <g transform="translate(0,-1.6)">
                <path d="M8 6.5 4 10.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 10.5h9.5a4.5 4.5 0 0 1 0 9H10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </g>
            </svg>
          </button>
          <button
            className="pt-btn" type="button" aria-label="重做" title="重做"
            disabled={future === 0}
            onClick={() => useScene.getState().redo()}
          >
            <svg width="24" height="24" viewBox="0 0 22 22" aria-hidden="true">
              <g transform="translate(0,-1.6)">
                <path d="M14 6.5l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M18 10.5H8.5a4.5 4.5 0 0 0 0 9H12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </g>
            </svg>
          </button>
        </>
      ) : isHome ? newPageBtn : (
        <button className="pt-btn" type="button" aria-label="返回" title="返回" onClick={onBack}>
          <GlyphBack />
        </button>
      )}

      {/* 会话放正中间（用户："把会话管理放到中间的按钮"） */}
      <button
        className="pt-btn" type="button" aria-label={`管理会话（${tabCount} 个）`}
        title={`管理会话（${tabCount} 个）`}
        onClick={onOpenSessions}
      >
        <GlyphSessions n={tabCount} />
      </button>

      {/* 新建在右边第二个（用户指定）；首页已经在左端给了它，这里不重复 */}
      {editorish && newPageBtn}

      <div className="pt-entry" ref={entryRef}>
        <button
          ref={entryBtnRef}
          className={'pt-btn' + (entryOpen ? ' is-open' : '')}
          type="button" aria-label="更多入口" aria-haspopup="menu" aria-expanded={entryOpen}
          title="更多入口"
          onClick={() => (entryOpen ? setEntryOpen(false) : openEntryMenu())}
        >
          <GlyphMenu />
        </button>
      </div>

      {/* 菜单 Portal 到 body：留在栏体里会被工具栏条（同级后渲染 + overflow）盖住，
          层级怎么调都在同一层里打转。Portal 之后它是 body 的直接子节点，谁也盖不住。 */}
      {entryOpen && entryPos && createPortal(
        <div
          className="pt-entry-menu"
          role="menu"
          style={{ right: entryPos.right, bottom: entryPos.bottom }}
        >
          <button role="menuitem" type="button" onClick={() => { setEntryOpen(false); onOpenSettings(); }}>偏好设置</button>
          <button role="menuitem" type="button" onClick={() => { setEntryOpen(false); onOpenHelp(); }}>使用手册</button>
          <button role="menuitem" type="button" onClick={() => { setEntryOpen(false); onOpenPlugins(); }}>扩展与插件</button>
        </div>,
        document.body
      )}
    </div>
  );
}

export type PortraitBar2Props = {
  zoom: number;
  setZoom: (z: number) => void;
  canvasWidth: string;
  setCanvasWidth: (v: string) => void;
  /** 第三层「情境栏」要显示的按钮，由 App 按当前状态算好传进来；不传 = 一个都不显示 */
  ctxActions?: PortraitContextAction[];
  /** 正在退场（离开编辑器）：从下方滑出，播完由 App 卸载 */
  leaving?: boolean;
};

/** 默认值必须是模块级常量：写成解构默认的 `= []` 每次渲染都是新数组，
 *  情境栏那边的同步 effect 就会白跑一轮（见 PortraitContextBar 的注释）。 */
const NO_CTX_ACTIONS: PortraitContextAction[] = [];

/**
 * 第二条操作栏：桌面工具栏的按钮，**固定单行**、可左右滑动。
 *
 * 上一版它能像抽屉一样"长按上滑展开 / 下滑折叠"，抽屉能力后来被删掉了，
 * 但顶部那条像抽屉把手的横条（连同装在里面的 Alt 开关）留了下来 ——
 * 用户："上方像抽屉把手的横条没有删除，删除一下。"
 * 所以 .pt-bar2-head 整块连手势一起删了（expanded / holdRef / 那几个 pointer 事件），
 * 现在是固定高度、只有一行的带状栏。
 *
 * 为什么复用 <Toolbar/> 而不是重写一套按钮：那一套里有二级菜单、设备断点、
 * 可用性判定、撤销栈联动等一大堆逻辑，重写一遍必然漂移。这里只改**外形**，
 * 逻辑一份不动 —— 按钮清单由 Toolbar 自己维护。
 */
export function PortraitBar2(props: PortraitBar2Props) {
  const { zoom, setZoom, canvasWidth, setCanvasWidth, ctxActions = NO_CTX_ACTIONS, leaving = false } = props;

  return (
    <div className={'pt-bar pt-bar2' + (leaving ? ' is-leaving' : '')} role="toolbar" aria-label="工具栏（可左右滑动）">
      {/* 第三层「情境栏」：在工具栏**上面**，没按钮时高度 0（不占位、不可见） */}
      <PortraitContextBar actions={ctxActions} />
      <div className="pt-bar2-inner">
        <Toolbar
          canvasWidth={canvasWidth}
          onCanvasWidthChange={setCanvasWidth}
          zoom={zoom}
          onZoomChange={setZoom}
          portrait
        />
      </div>
    </div>
  );
}
