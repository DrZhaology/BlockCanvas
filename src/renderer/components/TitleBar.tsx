import { useEffect, useRef, useState } from 'react';
import logoUrl from '@renderer/assets/logo.svg';

// ============================================================================
// BlockCanvas · 自绘窗口标题栏（v0.4.6）
// ----------------------------------------------------------------------------
// 用户原话：
//   「窗口是整个上边都是我设置的主题色，我想要窗口描边的主题色，而且现在窗口上方
//     三个按钮很小，不好看。你可以把文件、编辑、视图哪些按钮都放到最上面自己写的窗口栏。」
//
// 所以这版：
//   · 主进程 `frame:false` → 系统那条"整条强调色"的标题栏消失；
//   · 这条栏自己做：左边是产品名与菜单（文件/编辑/视图/帮助/设置），右边是三个窗口按钮；
//   · **主题色只做描边**（1px 环形），不铺满整条 —— 这正是他要的"描边"而不是"整条涂色"；
//   · 主题色取系统强调色（Windows 设置 → 个性化 → 颜色），取不到就退回程序自己的 --accent。
//
// 三个容易踩的点（都写在这里免得下次重犯）：
//   1. `-webkit-app-region: drag` 的区域**会吞掉点击** —— 所以每个按钮必须显式 `no-drag`，
//      否则"点了没反应"。
//   2. 原生菜单弹出时窗口会失焦，收回时触发 focus → 用这个来清掉按钮的"打开中"状态，
//      比猜一个 setTimeout 靠谱。
//   3. 网页版（`dist-web/index.html`）没有窗口概念：`bc.winControl` 不存在，
//      这时整条栏不渲染（浏览器自己的标签栏就是标题栏），只在 `data-bc-host=browser` 时隐藏。
// ============================================================================

const MENUS: Array<{ id: string; label: string }> = [
  { id: 'file', label: '文件' },
  { id: 'edit', label: '编辑' },
  { id: 'view', label: '视图' },
  { id: 'help', label: '帮助' },
  { id: 'settings', label: '设置' }
];

/** 窗口按钮的图形：用 1px 直线画，跟着 DPI 走，比字符稳 */
function GlyphMin() {
  return <svg width="18" height="18" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5h6" stroke="currentColor" strokeWidth="1" /></svg>;
}
function GlyphMax() {
  return <svg width="18" height="18" viewBox="0 0 10 10" aria-hidden="true"><rect x="2.5" y="2.5" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1" /></svg>;
}
function GlyphRestore() {
  return (
    <svg width="18" height="18" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3.2 3.2h4.3v4.3" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="2.5" y="4.8" width="3.7" height="3.7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
function GlyphClose() {
  return <svg width="18" height="18" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1" /></svg>;
}

export function TitleBar() {
  const host = typeof window !== 'undefined' ? window.bc : undefined;
  // 网页版没有窗口控件 → 不渲染（保留一个 0 高度的占位，布局代码不用分叉）
  const hasWin = Boolean(host?.winControl);
  const [maximized, setMaximized] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // 系统强调色 → 只给"描边"用
  useEffect(() => {
    if (!host?.accentColor) return;
    let alive = true;
    void host.accentColor().then((r) => {
      if (!alive) return;
      if (r?.ok && r.color) document.documentElement.style.setProperty('--bc-win-accent', r.color);
    }).catch(() => { /* 取不到就用 --accent */ });
    return () => { alive = false; };
  }, [host]);

  // 最大化状态：初次拉一次，之后靠主进程推
  useEffect(() => {
    if (!hasWin) return;
    let alive = true;
    void host!.winState?.().then((r) => { if (alive && r?.ok) setMaximized(r.maximized); }).catch(() => {});
    const off = host!.onWinState?.((s) => setMaximized(s.maximized));
    return () => { alive = false; off?.(); };
  }, [hasWin, host]);

  // 原生菜单关掉后窗口重新获得焦点 → 清掉"打开中"
  useEffect(() => {
    const onFocus = () => setOpenMenu(null);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  /**
   * v0.4.6 竖屏重做（用户原话）：
   *   「网页版需要让 Windows 桌面端最上方自己写的窗口的左侧 Logo 和按钮一直上去，
   *     右侧的 3 个窗口按钮网页版不需要。手机端完全不需要最上方的窗口栏。」
   *
   * 所以这里不再整条返回 null：
   *   · 桌面端（有 winControl）：Logo + 菜单 + 拖动区 + 三个窗口按钮（原样）；
   *   · 网页版（无 winControl）：**只留左端 Logo 与产品名**，去掉菜单（网页版没有原生菜单可弹）
   *     和三个窗口按钮（浏览器自己有），并去掉拖动区（没有窗口可拖）。
   * 竖屏整条栏的隐藏交给 App（不渲染）+ CSS（.app[data-shell='stack'] .bc-titlebar）。
   */
  const webOnly = !hasWin;

  const popup = (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    const r = e.currentTarget.getBoundingClientRect();
    setOpenMenu(id);
    // x/y 用窗口内容区坐标（无边框窗口下 = 视口坐标），让菜单正好贴在按钮下方
    void host!.menuPopup?.(id, r.left, r.bottom + 2);
  };

  /**
   * v0.4.7 · 菜单的键盘走查（用户："上方的菜单做好，交互设计好"）
   *
   * 一条真正的菜单栏必须能用键盘走完：←/→ 在菜单之间横移、↓ / Enter / 空格 打开、
   * Esc 收起、Tab 能落到菜单上。以前只有鼠标点击，键盘用户在这条自绘标题栏上寸步难行。
   */
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number, id: string) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = (idx + (e.key === 'ArrowRight' ? 1 : MENUS.length - 1)) % MENUS.length;
      btnRefs.current[next]?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      popup(e as unknown as React.MouseEvent<HTMLButtonElement>, id);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpenMenu(null);
    }
  };

  return (
    <div className="bc-titlebar" data-maximized={maximized ? '1' : '0'} data-web-only={webOnly ? '1' : undefined}>
      <div className="bc-titlebar-lead">
        <img className="bc-titlebar-logo" src={logoUrl} alt="" draggable={false} />
        <span className="bc-titlebar-name">BlockCanvas</span>
      </div>

      {!webOnly && (
        <nav className="bc-titlebar-menu" role="menubar" aria-label="主菜单">
          {MENUS.map((m, i) => (
            <button
              key={m.id}
              ref={(el) => { btnRefs.current[i] = el; }}
              className={'bc-titlebar-menu-btn' + (openMenu === m.id ? ' is-open' : '')}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openMenu === m.id}
              onClick={(e) => popup(e, m.id)}
              onKeyDown={(e) => onMenuKeyDown(e, i, m.id)}
              onMouseEnter={() => setOpenMenu(null)}
            >{m.label}</button>
          ))}
        </nav>
      )}

      {/* 拖动区：把剩余空白全吃掉，双击由系统负责最大化/还原（网页版没有窗口，不放） */}
      {!webOnly && (
        <div className="bc-titlebar-drag" onDoubleClick={() => void host!.winControl?.('maximize-toggle')} />
      )}
      {/* 网页版：顶部到最上、左端贴边（用户：「左侧 Logo 和按钮一直上去」） */}
      {webOnly && <div className="bc-titlebar-spacer" />}

      {!webOnly && (
        <div className="bc-titlebar-win">
        <button className="bc-win-btn" title="最小化" aria-label="最小化" onClick={() => void host!.winControl?.('minimize')}>
          <GlyphMin />
        </button>
        <button
          className="bc-win-btn"
          title={maximized ? '还原' : '最大化'}
          aria-label={maximized ? '还原' : '最大化'}
          onClick={() => void host!.winControl?.('maximize-toggle')}
        >
          {maximized ? <GlyphRestore /> : <GlyphMax />}
        </button>
        <button className="bc-win-btn is-close" title="关闭" aria-label="关闭" onClick={() => void host!.winControl?.('close')}>
          <GlyphClose />
        </button>
        </div>
      )}
    </div>
  );
}

export default TitleBar;
