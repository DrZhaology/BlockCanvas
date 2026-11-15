// ============================================================================
// BlockCanvas · v0.4.6 竖屏「操作栏」（底部两条，模仿手机浏览器）
// ----------------------------------------------------------------------------
// 用户原话（这轮的分工）：
//   「把整个上方的所有东西全部删除，包括多标签页，两层工具栏。现在上方是空白的了。」
//   「把屏幕下方的一部分区域，类似手机版 Edge 下方控制栏，作为核心的跳转入口和工具栏操作。」
//   「分成 2 条栏，从下到上：第一条最底，第二条在第一条上面。」
//   第一条只含 5 个核心按钮：撤销 / 重做 / 新建页面 / 管理会话 / 入口「三」。
//   第二条是桌面工具栏的按钮，折叠态单行可横滑，长按上滑展开、下滑折叠。
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
};

/**
 * 第一条操作栏（最底下那条）：5 个核心按钮。
 *
 * 撤销/重做直接读 sceneStore 的 history 长度做可用性 —— 不走 useMemo 缓存，
 * 否则会读到首次渲染的旧值（这个坑在工具栏 `opMap` 上踩过）。
 */
export function PortraitBar1(props: PortraitBar1Props) {
  const { view, editorish, onBack, onOpenSessions, onOpenSettings, onOpenHelp, onOpenPlugins } = props;
  const [entryOpen, setEntryOpen] = useState(false);
  const entryRef = useRef<HTMLDivElement | null>(null);
  const entryBtnRef = useRef<HTMLButtonElement | null>(null);
  /** 二级菜单的位置：贴着按钮往上弹（用户："二级菜单不要固定位置，要求在按钮附近打开"） */
  const [entryPos, setEntryPos] = useState<{ right: number; bottom: number } | null>(null);
  const tabCount = useTabStore((s) => s.tabs.length);

  const openEntryMenu = () => {
    const r = entryBtnRef.current?.getBoundingClientRect();
    if (r) {
      setEntryPos({
        right: Math.max(8, Math.round(window.innerWidth - r.right)),
        bottom: Math.round(window.innerHeight - r.top + 8)
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

  return (
    <div className="pt-bar pt-bar1" data-view={view} role="toolbar" aria-label="核心操作">
      {editorish ? (
        <>
          <button
            className="pt-btn" type="button" aria-label="撤销" title="撤销"
            disabled={past === 0}
            onClick={() => useScene.getState().undo()}
          >
            <svg width="24" height="24" viewBox="0 0 22 22" aria-hidden="true">
              <path d="M8 6.5 4 10.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 10.5h9.5a4.5 4.5 0 0 1 0 9H10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="pt-btn" type="button" aria-label="重做" title="重做"
            disabled={future === 0}
            onClick={() => useScene.getState().redo()}
          >
            <svg width="24" height="24" viewBox="0 0 22 22" aria-hidden="true">
              <path d="M14 6.5l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M18 10.5H8.5a4.5 4.5 0 0 0 0 9H12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </>
      ) : (
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

      {/* 新建在右边第二个（用户指定） */}
      {editorish && (
        <button
          className="pt-btn" type="button" aria-label="新建页面" title="新建页面"
          onClick={() => useTabStore.getState().newTab()}
        >
          <GlyphNewPage />
        </button>
      )}

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

/**
 * 第二条操作栏：桌面工具栏的按钮。
 *
 * 折叠态 = 一行、可左右滑动；展开态 = 全部按钮换行铺开（超过 4 行内部再滚）。
 * 长按（≥380ms）后上滑展开 / 下滑折叠（用户：「长按这个栏，然后往上滑动完全展开」）。
 *
 * 为什么复用 <Toolbar/> 而不是重写一套按钮：那一套里有二级菜单、设备断点、
 * 可用性判定、撤销栈联动等一大堆逻辑，重写一遍必然漂移。这里只改**外形**，
 * 逻辑一份不动 —— 等按钮清单定了再谈裁剪。
 */
export function PortraitBar2({ zoom, setZoom, canvasWidth, setCanvasWidth }: {
  zoom: number;
  setZoom: (z: number) => void;
  canvasWidth: string;
  setCanvasWidth: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const holdRef = useRef<{ t: number | null; y: number; active: boolean }>({ t: null, y: 0, active: false });

  const onPointerDown = (e: React.PointerEvent) => {
    const st = holdRef.current;
    st.y = e.clientY;
    st.active = false;
    if (st.t !== null) window.clearTimeout(st.t);
    st.t = window.setTimeout(() => { st.active = true; }, 380);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const st = holdRef.current;
    if (!st.active) return;
    const dy = e.clientY - st.y;
    if (dy < -24 && !expanded) setExpanded(true);
    if (dy > 24 && expanded) setExpanded(false);
  };
  const endHold = () => {
    const st = holdRef.current;
    if (st.t !== null) { window.clearTimeout(st.t); st.t = null; }
    st.active = false;
  };

  return (
    <div
      className={'pt-bar pt-bar2' + (expanded ? ' is-expanded' : '')}
      role="toolbar"
      aria-label="工具栏（长按上下滑动可展开或折叠）"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endHold}
      onPointerCancel={endHold}
    >
      <div className="pt-bar2-grip" aria-hidden="true" />
      <div className="pt-bar2-inner">
        <Toolbar
          canvasWidth={canvasWidth}
          onCanvasWidthChange={setCanvasWidth}
          zoom={zoom}
          onZoomChange={setZoom}
        />
      </div>
    </div>
  );
}
