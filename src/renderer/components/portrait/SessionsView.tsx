// ============================================================================
// BlockCanvas · v0.4.6 竖屏「会话管理」页
// ----------------------------------------------------------------------------
// 用户原话：
//   「点击这个按钮后，进入一个新的页面，这个页面显示所有标签页的一个卡片，
//     卡片上方是缩略图，上方显示项目名称和×，这个×的按钮稍微大一点不要太小。
//     然后每行显示两个缩略图，可以上下滑动，就非常类似 Edge 手机版。
//     长按每个会话项目的卡片打开右键菜单，可以重命名，关闭等。」
//
// 第五轮反馈（本文件这一版就是照它改的）：
//   ① 进入要有高级动画：当前的画布缩小到多标签页的缩略图；
//   ② 卡片下边框明显偏粗 → 缩略图那条 border-bottom 叠在卡片边框上，去了；
//   ③ 缩略图只有文字没样式 → 走 exporter 出**和导出一模一样**的 HTML 再缩放；
//   ④ 页面底部要有「新建页面」按钮；
//   ⑤ 关闭动画以前只有第一张有 → 因为其余页是"脏"的，走的是确认浮层、根本没进动画。
//      现在确认面板就画在**卡片内部**，确认完照样播退场动画；
//   ⑥ 关闭保存提示放到卡片下面，进入 / 关闭都给动画。
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTabStore } from '@store/tabStore';
import { isTabDirty, saveTabThenClose } from '../TabCloseGuard';
import { exportHTML } from '@lib/exporter';
import type { SceneGraph } from '@lib/types';

/** 关闭动画时长（与 CSS 的 sessOut 保持一致） */
const CLOSE_MS = 190;
/** 缩略图高度（与 .sess-thumb 的 CSS 高度一致） */
const THUMB_H = 132;
/** 没有显式宽度时按这个宽度当基准（与导出的桌面画布量级一致） */
const FALLBACK_W = 1100;

const parseIntPx = (v?: string) => {
  const n = v ? parseInt(String(v), 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
};
void parseIntPx; // 保留工具函数（导出宽度兜底时曾用过，避免 tree-shake 争议）

// ── 缩略图：exporter 出的真 HTML + 缩放到卡片宽 ──────────────────────────────
function SessThumb({ scene }: { scene?: SceneGraph }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);
  const [contentW, setContentW] = useState(0);

  // 真实 HTML（和「导出 HTML」「预览」**完全相同的一份**），按 scene 引用记忆
  //
  // ⚠ 不要把 scene 拆成 `{root: 包一层的壳}` 再导出（v0.4.6 踩过）：
  //   exportHTML 不只看 root —— 它还要 `scene.tokens`（设计变量）、`scene.globalCss`、
  //   `scene.quickCss`、`scene.bodyExtra`。只传 root 的结果是：**元素的颜色/尺寸只要用了
  //   变量就全丢**，div 没有底色也没有宽高（塌成 0），最后缩略图里只剩文字。
  //   用户反馈"缩略图只有文字、没有 div"就是这个原因。
  const srcdoc = useMemo(() => {
    if (!scene?.root) return '';
    try {
      const html = exportHTML({ ...scene, selectedId: null, selectedIds: [] }).html || '';
      return html.includes('<body') ? html : '';
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
    const w = Math.max(doc.documentElement.scrollWidth, FALLBACK_W);
    if (w > 100) setContentW(w);
  };

  // 缩放：铺满卡片宽再放大 1.6 倍，取**页面中间**那一块（用户："缩略图只有文字没样式"）
  //
  // 为什么不是 1:1 整页缩放：桌面画布 1100~1920 宽缩到 188px 的卡片里只有 0.17 倍，
  // 纯文字页面看上去就是"一片小字"，色块、标题全糊掉。放大到 0.27 倍左右、只取中间
  // 那一段，卡片里能看清版式与配色（和浏览器标签页缩略图相比更"像预览"）。
  const ZOOM = 1.6;
  // ⚠ 量不到宽度也要有个默认值：以前量不到就渲染一个 visibility:hidden 的测量用 iframe，
  //   结果卡片里是**一片空白**（用户看到的就是"缩略图没有"）。现在永远渲染看得见的那一个。
  const cw = contentW > 0 ? contentW : FALLBACK_W;
  const scale = boxW > 0 ? (boxW / cw) * ZOOM : 0;
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
          style={{ width: cw, height: frameH, transform: `translateX(-50%) scale(${scale})` }}
        />
      ) : (
        <div className="sess-thumb-fallback">{srcdoc ? '正在生成预览…' : '这个页面的预览生成失败'}</div>
      )}
    </div>
  );
}

export function SessionsView({ onBack, onNewPage }: { onBack: () => void; onNewPage: () => void }) {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const switchTab = useTabStore((s) => s.switchTab);

  /** 长按卡片 = 右键菜单（Windows 上长按等价于右键，用户就是这么叫的） */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** 正在播关闭动画的卡片：动画放完才真的删 */
  const [leaving, setLeaving] = useState<string | null>(null);
  /** 「有未保存的修改」确认面板：画在**这张卡片内部**（用户要求下沉） */
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [confirmClosing, setConfirmClosing] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  /** 进场动画：播完就摘标记（只播一次） */
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setEntering(false), 700);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [menuFor]);

  /** 干净标签（或已确认）：播 190ms 退场动画再删 */
  const animateOut = (id: string) => {
    if (leaving === id) return;
    setLeaving(id);
    window.setTimeout(() => {
      useTabStore.getState().closeTab(id);
      setLeaving((cur) => (cur === id ? null : cur));
    }, CLOSE_MS);
  };

  /** 关掉卡片里的确认面板（带退场动画） */
  const closeConfirm = (id: string) => {
    setConfirmClosing(id);
    window.setTimeout(() => {
      setConfirmFor((cur) => (cur === id ? null : cur));
      setConfirmClosing((cur) => (cur === id ? null : cur));
    }, 150);
  };

  const askOrClose = (id: string) => {
    if (!isTabDirty(id)) { animateOut(id); return; }
    setConfirmClosing(null);
    setConfirmFor(id);
  };

  const doSaveAndClose = async (id: string) => {
    if (saving) return;
    setSaving(id);
    const ok = await saveTabThenClose(id);
    setSaving(null);
    if (ok) { setConfirmFor(null); setConfirmClosing(null); }
  };

  const doDiscardAndClose = (id: string) => {
    setConfirmFor(null);
    setConfirmClosing(null);
    animateOut(id);
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
    if (confirmFor === id) return; // 确认面板开着时点卡片不要切走
    switchTab(id);
    onBack();
  };

  let order = -1;

  return (
    <div className={'sess-page' + (entering ? ' is-entering' : '')} role="region" aria-label="会话管理">
      <div className="sess-head">
        <span className="sess-title">会话</span>
        <span className="sess-sub">{tabs.length} 个</span>
      </div>

      <div className="sess-grid">
        {tabs.map((t) => {
          order += 1;
          const idx = order;
          const isActive = t.id === activeTabId;
          return (
            <div
              key={t.id}
              className={
                'sess-card'
                + (isActive ? ' is-active' : '')
                + (leaving === t.id ? ' is-leaving' : '')
                + (entering ? (isActive ? ' enter-active' : ' enter') : '')
              }
              style={{ animationDelay: `${isActive ? 0 : 60 + idx * 55}ms` }}
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
                  onClick={(e) => { e.stopPropagation(); askOrClose(t.id); }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {/* 「有未保存的修改」确认面板：就画在这张卡片里（用户："放到会话卡片的下面"），
                  进 / 退都有动画（sessConfirmIn / sessConfirmOut）。 */}
              {confirmFor === t.id && (
                <div
                  className={'sess-confirm' + (confirmClosing === t.id ? ' is-closing' : '')}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="sess-confirm-title">「{t.name}」有未保存的修改</div>
                  <div className="sess-confirm-actions">
                    <button
                      className="sess-cbtn is-primary"
                      disabled={Boolean(saving)}
                      onClick={() => void doSaveAndClose(t.id)}
                    >{saving === t.id ? '保存中…' : '保存并关闭'}</button>
                    <button className="sess-cbtn is-danger" disabled={Boolean(saving)} onClick={() => doDiscardAndClose(t.id)}>不保存</button>
                    <button className="sess-cbtn" disabled={Boolean(saving)} onClick={() => closeConfirm(t.id)}>取消</button>
                  </div>
                </div>
              )}

              {menuFor === t.id && (
                <div className="sess-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
                  <button
                    role="menuitem" type="button"
                    onClick={() => { setRenaming(t.id); setDraft(t.name); setMenuFor(null); }}
                  >重命名</button>
                  <button
                    role="menuitem" type="button"
                    onClick={() => { setMenuFor(null); askOrClose(t.id); }}
                  >关闭</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 用户："多标签页下面加入新增页面的按钮" */}
      <button className="sess-addnew" type="button" onClick={onNewPage}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        新建页面
      </button>
    </div>
  );
}

export default SessionsView;
