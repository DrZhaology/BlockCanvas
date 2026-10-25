import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScene } from '@store/sceneStore';
import {
  cssVarName,
  filterTokensByKind,
  kindsHint,
  TOKEN_KIND_LABELS,
  type TokenKind
} from '@lib/designTokens';
import { collectAvoidRects, placeOverlay, type Placement } from '@lib/overlayPlacement';

// ============================================================================
// BlockCanvas · 设计变量选择浮层（v0.4.5 统一版）
// ----------------------------------------------------------------------------
// 三个入口（调色盘 / 数值输入 / 四值输入）以前各写一套 var 菜单，问题也一样：
//   · 菜单挂在 `position:absolute` 的父元素里 → 面板窄、按钮靠底时**整块跑到窗口外面**；
//   · 数值输入那个菜单**不按类型过滤** → 宽度里能选到颜色变量（用户："变量乱用了"）；
//   · 一个 z-index 是 60/61，另一个是 960/961，互相盖来盖去。
//
// 现在统一到这一个组件：
//   · Portal 到 body + `position:fixed`，不受任何面板 overflow 裁切；
//   · 定位走 lib/overlayPlacement —— 不出窗口、不压住工具栏和底部面板；
//   · 只列出**类型匹配**的变量（`kinds` 由调用方按属性类型给，见 designTokens.kindsForInput）；
//   · 键盘可用：↑↓ 选择、Enter 采用、Esc 关闭；鼠标悬停同步高亮。
// ============================================================================

const EXIT_MS = 130;

export function VarMenu(props: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** 允许引用的变量类型（决定菜单里出现哪些变量） */
  kinds: TokenKind[];
  onPick: (name: string) => void;
  onClose: () => void;
  /** 顶部小标题，默认按 kinds 生成 */
  title?: string;
  /** 额外排除的变量名（例如变量面板自己不允许自引用） */
  excludeNames?: string[];
}) {
  const { open, anchorRef, kinds, onPick, onClose, title, excludeNames } = props;
  const allTokens = useScene((s) => s.scene.tokens);
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Placement | null>(null);
  const [active, setActive] = useState(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const items = filterTokensByKind(allTokens, kinds).filter(
    (t) => !(excludeNames ?? []).includes(t.name)
  );

  // 进场 / 退场：关掉时不"啪一下消失"
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      setActive(0);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = window.setTimeout(() => { setMounted(false); setClosing(false); }, EXIT_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 定位：先以 visibility:hidden 渲染量尺寸，再算位置（绘制前完成，不闪）
  useLayoutEffect(() => {
    if (!mounted) return;
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      setPos(placeOverlay({
        anchor: { left: a.left, top: a.top, right: a.right, bottom: a.bottom },
        width: panel.offsetWidth,
        height: panel.offsetHeight,
        align: 'right',
        gap: 6,
        avoid: collectAvoidRects(anchor)
      }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [mounted, anchorRef, items.length]);

  // 外部点击 / Esc 关闭。延迟到下一帧挂监听：否则"打开它的那次点击"会立刻把它关掉。
  useEffect(() => {
    if (!mounted) return;
    let off: (() => void) | null = null;
    const t = window.setTimeout(() => {
      const onDown = (e: PointerEvent) => {
        const t2 = e.target as Element | null;
        if (panelRef.current?.contains(t2 as Node)) return;
        if (anchorRef.current?.contains(t2 as Node)) return;
        closeRef.current();
      };
      document.addEventListener('pointerdown', onDown, true);
      off = () => document.removeEventListener('pointerdown', onDown, true);
    }, 60);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      off?.();
      document.removeEventListener('keydown', onKey, true);
    };
  }, [mounted, anchorRef]);

  if (!mounted) return null;

  const pick = (name: string) => {
    onPick(name);
    closeRef.current();
  };

  return createPortal(
    <div
      ref={panelRef}
      className={'bc-varmenu' + (closing ? ' is-closing' : '') + (pos?.above ? ' above' : '')}
      style={{
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : 0,
        visibility: pos ? 'visible' : 'hidden',
        ...(pos?.maxHeight ? { maxHeight: pos.maxHeight } : undefined)
      }}
      onKeyDown={(e) => {
        if (items.length === 0) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActive((i) => (i + 1) % items.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActive((i) => (i - 1 + items.length) % items.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const t = items[Math.min(Math.max(active, 0), items.length - 1)];
          if (t) pick(t.name);
        }
      }}
    >
      <div className="bc-varmenu-head">
        <span className="bc-varmenu-title">{title ?? kindsHint(kinds)}</span>
        <span className="bc-varmenu-kinds">
          {kinds.map((k) => (
            <span key={k} className={'bc-varmenu-kind k-' + k}>{TOKEN_KIND_LABELS[k]}</span>
          ))}
        </span>
      </div>
      <div className="bc-varmenu-list bc-scroll">
        {items.length === 0 && (
          <div className="bc-varmenu-empty">
            {kinds.length === 0
              ? '这一项不支持引用设计变量。'
              : <>
                  还没有「{kinds.map((k) => TOKEN_KIND_LABELS[k]).join(' / ')}」类变量。<br />
                  到右侧「变量」页签点「＋ 新建变量」，把类型建对之后这里就会出现。
                </>}
          </div>
        )}
        {items.map((t, i) => (
          <button
            key={t.name}
            className={'bc-varmenu-item' + (i === Math.min(active, items.length - 1) ? ' is-active' : '')}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(t.name)}
            title={`引用 ${cssVarName(t.name)} = ${t.value}`}
          >
            {t.kind === 'color'
              ? <span className="bc-varmenu-swatch" style={{ background: t.value }} />
              : <span className={'bc-varmenu-glyph k-' + t.kind}>{t.kind === 'shadow' ? '◍' : '□'}</span>}
            <span className="bc-varmenu-name">{cssVarName(t.name)}</span>
            <span className="bc-varmenu-val">{t.value}</span>
          </button>
        ))}
      </div>
      <div className="bc-varmenu-foot">↑↓ 选择 · Enter 引用 · Esc 关闭</div>
    </div>,
    document.body
  );
}