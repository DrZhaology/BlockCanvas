// ============================================================================
// BlockCanvas · v0.4.6 竖屏「会话管理」页
// ----------------------------------------------------------------------------
// 用户原话：
//   「点击这个按钮后，进入一个新的页面，这个页面显示所有标签页的一个卡片，
//     卡片上方是缩略图，上方显示项目名称和×，这个×的按钮稍微大一点不要太小。
//     然后每行显示两个缩略图，可以上下滑动，就非常类似 Edge 手机版。
//     长按每个会话项目的卡片打开右键菜单，可以重命名，关闭等。」
//   补充反馈：「蓝色的边框只有下半边有，缩略图上面没有」「做一下关闭动画」
//            「缩略图貌似只有文字，没有样式」
//
// 缩略图用**实时渲染**（用户选的方案）：把会话的场景树按自然尺寸画一遍再整体缩小。
// 为什么不引 CanvasNode：它依赖编辑器上下文（缩放 / 选中 / 拖拽 / Alt 层），
// 在会话页里挂全套只会把耦合和开销一起带进来。
//
// ⚠ 保真度说明：这里还原的是"盒子的样子"——底色 / 渐变 / 边框 / 圆角 / 内外边距 /
//   文字颜色字号对齐 / 显式尺寸。**不还原**继承链（父级 childStyles、预设、类名规则），
//   因为那些是编辑器在渲染时才算的。所以如果某页的底色全来自预设，
//   缩略图会比真实页面更"素"——这是刻意的取舍，不是 bug。
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { useTabStore } from '@store/tabStore';
import type { SceneElement } from '@lib/types';

/** 缩略图舞台的自然宽度：按桌面画布量级取，整体再缩放塞进卡片 */
const STAGE_W = 1100;
/** 关闭动画时长（与 CSS 的 sessOut 保持一致） */
const CLOSE_MS = 190;

const px = (v?: string) => (v && /^-?\d+(\.\d+)?px$/.test(v) ? v : undefined);

function MiniNode({ el, depth }: { el: SceneElement; depth: number }) {
  if (depth > 5) return null;
  const s = (el.style || {}) as Record<string, string | undefined>;
  const text = (el as unknown as { text?: string }).text;
  const kids = (el.children || []) as SceneElement[];
  const isText = String(el.type) === 'text' || Boolean(text);

  // 底色与渐变：两者都可能有，渐变优先（真实页面也是 background-image 盖在 color 上）
  const bgColor = s.backgroundColor && s.backgroundColor !== 'transparent' ? s.backgroundColor : undefined;
  const bgImage = s.backgroundImage && s.backgroundImage !== 'none' ? s.backgroundImage : undefined;
  const borderW = s.borderWidth && parseFloat(s.borderWidth) > 0 ? s.borderWidth : undefined;
  const flex = s.display === 'flex';

  return (
    <div
      style={{
        background: bgColor,
        backgroundImage: bgImage,
        backgroundSize: bgImage ? 'cover' : undefined,
        height: px(s.height),
        minHeight: px(s.minHeight) ?? (kids.length === 0 && !isText ? '16px' : undefined),
        maxWidth: s.maxWidth,
        width: px(s.width) ?? undefined,
        borderRadius: px(s.borderRadius),
        border: borderW ? `${borderW} ${s.borderStyle || 'solid'} ${s.borderColor || '#dbe3ee'}` : undefined,
        paddingTop: px(s.paddingTop),
        paddingRight: px(s.paddingRight),
        paddingBottom: px(s.paddingBottom),
        paddingLeft: px(s.paddingLeft),
        padding: px(s.padding),
        marginTop: px(s.marginTop),
        marginBottom: px(s.marginBottom),
        marginLeft: s.marginLeft === 'auto' ? 'auto' : px(s.marginLeft),
        marginRight: s.marginRight === 'auto' ? 'auto' : px(s.marginRight),
        boxSizing: 'border-box',
        display: flex ? 'flex' : 'block',
        flexDirection: flex ? ((s.flexDirection as never) || 'row') : undefined,
        justifyContent: flex ? (s.justifyContent as never) : undefined,
        alignItems: flex ? (s.alignItems as never) : undefined,
        gap: px(s.gap),
        color: s.color,
        fontSize: px(s.fontSize),
        fontWeight: (s.fontWeight as never) || undefined,
        fontStyle: s.fontStyle === 'italic' ? 'italic' : undefined,
        textAlign: (s.textAlign as never) || undefined,
        letterSpacing: px(s.letterSpacing),
        lineHeight: s.lineHeight && s.lineHeight !== 'normal' ? s.lineHeight : 1.35,
        overflow: 'hidden',
        flex: '0 0 auto'
      }}
    >
      {isText ? (text || '') : kids.map((c) => <MiniNode key={c.id} el={c} depth={depth + 1} />)}
    </div>
  );
}

export function SessionsView({ onBack }: { onBack: () => void }) {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const switchTab = useTabStore((s) => s.switchTab);
  const closeTab = useTabStore((s) => s.closeTab);

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

  /** 关会话：先播 190ms 退场动画再删（用户："做一下关闭动画"） */
  const requestClose = (id: string) => {
    if (leaving === id) return;
    setLeaving(id);
    window.setTimeout(() => {
      closeTab(id);
      setLeaving((cur) => (cur === id ? null : cur));
    }, CLOSE_MS);
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
            <div
              className="sess-thumb"
              style={{ background: ((t.scene?.root?.style as unknown as Record<string, string>)?.backgroundColor) || '#fff' }}
            >
              <div className="sess-thumb-stage" style={{ width: STAGE_W }}>
                {((t.scene?.root?.children || []) as SceneElement[]).map((c) => (
                  <MiniNode key={c.id} el={c} depth={0} />
                ))}
              </div>
            </div>
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
                onClick={(e) => { e.stopPropagation(); requestClose(t.id); }}
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
                  onClick={() => { setMenuFor(null); requestClose(t.id); }}
                >关闭</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
