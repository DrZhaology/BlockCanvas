// ============================================================================
// BlockCanvas · v0.4.6 竖屏「会话管理」页
// ----------------------------------------------------------------------------
// 用户原话：
//   「点击这个按钮后，进入一个新的页面，这个页面显示所有标签页的一个卡片，
//     卡片上方是缩略图，上方显示项目名称和×，这个×的按钮稍微大一点不要太小。
//     然后每行显示两个缩略图，可以上下滑动，就非常类似 Edge 手机版。
//     长按每个会话项目的卡片打开右键菜单，可以重命名，关闭等。」
//   补充反馈：「蓝色的边框只有下半边有，缩略图上面没有」「做一下关闭动画」
//   「缩略图貌似只有文字，没有样式」「点了叉叉先退出去、又弹全屏弹窗问保存」
//
// 缩略图（v0.4.6 第二次返工）：**不再自己拼 inline style 画迷你盒**。
//   第一版用 MiniNode 只还原内联样式，结果用户看到的是"只有文字没有样式"——
//   因为这套编辑器的观感八成来自预设 / childStyles / 全局规则，不在元素的 style 上。
//   现在直接走 exporter：`exportHTML(scene)` 生成**和导出/预览同一份** HTML，
//   塞进 iframe.srcdoc 再整体 scale 到卡片宽度 —— 保真度和导出完全一致。
//   代价是每个会话要跑一次导出，所以只在会话页挂载时算（useMemo 按 scene 引用记忆）。
//
// × 的关闭交互（v0.4.6 第三次返工）：
//   · 干净标签 → 播 190ms 退场动画再真的关（有反馈）；
//   · 脏标签 → **不先退场**，就在 × 旁边弹出「保存并关闭 / 不保存 / 取消」二级菜单
//     （由 TabCloseGuard 统一渲染，这里只把 × 的矩形传过去）。
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTabStore } from '@store/tabStore';
import { requestTabClose, isTabDirty } from '../TabCloseGuard';
import { exportHTML } from '@lib/exporter';
import type { SceneGraph } from '@lib/types';

/** 关闭动画时长（与 CSS 的 sessOut 保持一致） */
const CLOSE_MS = 190;
/** 缩略图高度（与 .sess-thumb 的 CSS 高度一致） */
const THUMB_H = 112;
/** 没有显式宽度时按这个宽度当基准（与导出的桌面画布量级一致） */
const FALLBACK_W = 1100;

const parseIntPx = (v?: string) => {
  const n = v ? parseInt(String(v), 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// ── 缩略图：exporter 出的真 HTML + 缩放到卡片宽 ──────────────────────────────
function SessThumb({ scene }: { scene?: SceneGraph }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);
  const [contentW, setContentW] = useState(0);

  // 真实 HTML（和「导出 HTML」「预览」同一份），按 scene 引用记忆，切回来才重算
  const srcdoc = useMemo(() => {
    if (!scene?.root) return '';
    try {
      const rootW = parseIntPx((scene.root.style as Record<string, string> | undefined)?.width);
      const shell = {
        id: 'sess-shell',
        type: 'div',
        text: undefined,
        children: [scene.root],
        style: {
          width: (rootW || FALLBACK_W) + 'px',
          boxSizing: 'border-box',
          overflow: 'hidden',
          padding: '0px',
          backgroundColor:
            ((scene.root.style as Record<string, string> | undefined)?.backgroundColor) || '#ffffff'
        }
      };
      return exportHTML({ root: shell as never, selectedId: null, selectedIds: [] }).html;
    } catch {
      return '';
    }
  }, [scene]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const onLoad = () => {
    const doc = boxRef.current?.querySelector('iframe')?.contentDocument;
    if (!doc) return;
    const st = doc.createElement('style');
    // 缩略图里不要滚动条、不要留白（量宽度时也靠这条把 body margin 清掉）
    st.textContent = 'html,body{margin:0;padding:0;overflow:hidden;}';
    doc.head.appendChild(st);
    const w = Math.max(doc.documentElement.scrollWidth, parseIntPx(String(FALLBACK_W)));
    setContentW(w);
  };

  const scale = boxW > 0 && contentW > 0 ? boxW / contentW : 0;
  const frameH = scale > 0 ? Math.ceil(THUMB_H / scale) : 0;

  return (
    <div className="sess-thumb" ref={boxRef}>
      {srcdoc && scale > 0 ? (
        <iframe
          className="sess-thumb-frame"
          title="会话缩略图"
          srcDoc={srcdoc}
          scrolling="no"
          tabIndex={-1}
          onLoad={onLoad}
          style={{ width: contentW, height: frameH, transform: `scale(${scale})`, transformOrigin: 'left top' }}
        />
      ) : srcdoc ? (
        /* 首帧还没量出来：先放一个同样 srcDoc 的隐藏 iframe 去量，避免"闪一下空白" */
        <iframe className="sess-thumb-frame is-measuring" title="会话缩略图" srcDoc={srcdoc} scrolling="no" tabIndex={-1} onLoad={onLoad} />
      ) : null}
    </div>
  );
}

export function SessionsView({ onBack }: { onBack: () => void }) {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const switchTab = useTabStore((s) => s.switchTab);

  /** 长按卡片 = 右键菜单（Windows 上长按等价于右键，用户就是这么叫的） */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** 正在播关闭动画的卡片：动画放完才真的删 */
  const [leaving, setLeaving] = useState<string | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [menuFor]);

  /** 干净标签：先播 190ms 退场动画再删（用户："做一下关闭动画"） */
  const animateOut = (id: string) => {
    if (leaving === id) return;
    setLeaving(id);
    window.setTimeout(() => {
      useTabStore.getState().closeTab(id);
      setLeaving((cur) => (cur === id ? null : cur));
    }, CLOSE_MS);
  };

  /**
   * × 的关闭：脏标签不先退场，就地弹二级菜单问「保存 / 不保存 / 取消」。
   * 干净标签没什么可丢的，直接播退场。
   */
  const closeFromX = (id: string, el: HTMLElement) => {
    if (!isTabDirty(id)) { animateOut(id); return; }
    const r = el.getBoundingClientRect();
    requestTabClose(id, { x: r.x, y: r.y, w: r.width, h: r.height });
  };

  /** 长按菜单里的「关闭」也走同一条：脏的会弹确认 */
  const closeFromMenu = (id: string) => {
    if (!isTabDirty(id)) { animateOut(id); return; }
    requestTabClose(id);
  };

  /** 每张卡片：长按 450ms 出菜单；短按=切到该会话 */
  const holdRef = useRef<{ t: number | null; fired: boolean }>({ t: null, fired: false });
  const startHold = (id: string) => {
    holdRef.current.fired = false;
    if (holdRef.current.t !== null) window.clearTimeout(holdRef.current.t);
    holdRef.current.t = window.setTimeout(() => {
      holdRef.current.fired = true;
      setMenuFor(id);
    }, 450);
  };
  const endHold = () => {
    if (holdRef.current.t !== null) { window.clearTimeout(holdRef.current.t); holdRef.current.t = null; }
  };
  const onCardClick = (id: string) => {
    if (holdRef.current.fired) { holdRef.current.fired = false; return; }
    switchTab(id);
    onBack();
  };

  return (
    <div className="sess-page" role="region" aria-label="会话管理">
      <div className="sess-head">
        <span className="sess-title">会话</span>
        <span className="sess-sub">{tabs.length} 个</span>
      </div>

      <div className="sess-grid">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={
              'sess-card'
              + (t.id === activeTabId ? ' is-active' : '')
              + (leaving === t.id ? ' is-leaving' : '')
            }
            onPointerDown={() => startHold(t.id)}
            onPointerUp={endHold}
            onPointerCancel={endHold}
            onClick={() => onCardClick(t.id)}
          >
            <SessThumb scene={t.scene} />
            <div className="sess-meta">
              {renaming === t.id ? (
                <input
                  className="sess-rename"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => { setRenaming(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const next = draft.trim();
                      if (next) {
                        useTabStore.setState((st) => ({
                          tabs: st.tabs.map((x) => (x.id === t.id ? { ...x, name: next } : x))
                        }));
                      }
                      setRenaming(null);
                    }
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span className="sess-name" title={t.name}>{t.name}</span>
              )}
              <button
                className="sess-close"
                type="button"
                aria-label={`关闭 ${t.name}`}
                title="关闭"
                onClick={(e) => { e.stopPropagation(); closeFromX(t.id, e.currentTarget); }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {menuFor === t.id && (
              <div className="sess-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
                <button
                  role="menuitem" type="button"
                  onClick={() => { setRenaming(t.id); setDraft(t.name); setMenuFor(null); }}
                >重命名</button>
                <button
                  role="menuitem" type="button"
                  onClick={() => { setMenuFor(null); closeFromMenu(t.id); }}
                >关闭</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default SessionsView;
