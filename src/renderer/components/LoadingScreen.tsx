import { useEffect, useMemo, useRef, useState } from 'react';
import { useLoadScreen } from '@store/loadStore';
import logoUrl from '@renderer/assets/logo.svg';

/**
 * v0.4.5：加载页的底色跟随**记住的主界面颜色模式**。
 * 用户在首页用了深色背景的话，启动时不该先铺一张白纸再变黑 —— 那也是"过渡期"。
 * （同一个 localStorage key 由 EmptyHome 写入，见 components/EmptyHome.tsx 的 initialOnDark）
 */
function rememberedHomeDark(): boolean {
  try { return JSON.parse(localStorage.getItem('bc-home-dark') || 'false') === true; } catch { return false; }
}

// ============================================================================
// BlockCanvas · 启动 / 打开工程 的加载页（v0.4.5）
// ----------------------------------------------------------------------------
// 画面：三色 Logo + 产品名 + 一行"现在在干什么" + 进度条 + 百分比。
//
// 「与主界面要过渡丝滑」是怎么做到的：
//   1. 加载页在**主界面渲染完成之前**一直盖在最上层（z-index: --z-critical）；
//   2. 淡出时机 = 主界面已经画出第一帧（double requestAnimationFrame）+ 最小显示时长；
//   3. 淡出用 opacity/scale 过渡，不做"先卸载再渲染"的硬切。
//
// 「真实进度」怎么保证：
//   进度只来自 useLoadScreen.report()，调用方是真实步骤
//   （读工程文件 → 解析场景 → 解包素材 N/M → 登记 → 进入编辑器 / 恢复会话）。
// ============================================================================

export function LoadingScreen() {
  const visible = useLoadScreen((s) => s.visible);
  const leaving = useLoadScreen((s) => s.leaving);
  const label = useLoadScreen((s) => s.label);
  const percent = useLoadScreen((s) => s.percent);
  // 进度条要"追"目标值而不是瞬移：目标变了就先停在旧值再过渡（CSS transition 负责补间）
  const [, force] = useState(0);
  const rafRef = useRef(0);
  const homeDark = useMemo(() => rememberedHomeDark(), []);

  // 淡出前多等两帧 —— 让底下的主界面先画出第一帧，否则会看到一瞬间的空白
  useEffect(() => {
    if (!leaving) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => requestAnimationFrame(() => force((n) => n + 1)));
    return () => cancelAnimationFrame(rafRef.current);
  }, [leaving]);

  if (!visible) return null;

  return (
    <div
      className={'bc-loading' + (leaving ? ' is-leaving' : '') + (homeDark ? ' is-dark' : '')}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label="正在加载 BlockCanvas"
    >
      <div className="bc-loading-card">
        <img className="bc-loading-logo" src={logoUrl} alt="BlockCanvas" width={72} height={72} draggable={false} />
        <div className="bc-loading-name">BlockCanvas</div>
        <div className="bc-loading-stage">积木画布 · 可视化网页编辑器</div>

        <div className="bc-loading-bar">
          <div className="bc-loading-bar-fill" style={{ width: `${Math.max(4, percent)}%` }} />
        </div>
        <div className="bc-loading-meta">
          <span className="bc-loading-label">{label}</span>
          <span className="bc-loading-pct">{percent}%</span>
        </div>
      </div>
    </div>
  );
}