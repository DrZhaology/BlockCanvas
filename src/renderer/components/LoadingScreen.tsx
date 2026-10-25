import { useEffect, useState } from 'react';
import { useLoadScreen } from '@store/loadStore';
import { nextFrames } from '@lib/nextFrame';
import logoUrl from '@renderer/assets/logo.svg';

// ============================================================================
// BlockCanvas · 启动 / 打开工程 的加载页（v0.4.5）
// ----------------------------------------------------------------------------
// 画面：三色 Logo + 产品名 + 一行"现在在干什么" + 进度条 + 百分比。
//
// v0.4.5 第 14 批（用户反馈）：
//   · 「过渡的加载页面不知道为什么变成始终黑色了，不过我觉得可以让深色模式的插件适配一下，
//      程序内写成白色的就行。」
//     → 之前它会读 localStorage 里"记住的首页深色模式"，用户首页是深色背景时加载页就整片黑。
//       现在**固定白底**（深色插件将来要改，由插件去覆盖 `html[data-bc-dark] .bc-loading`）。
//   · 「淡入淡出太快了，并且还会有卡顿看起来不舒服，我觉得时长可以长一点。」
//     → 进场 0.42s、淡出 0.55s（原来 0.22 / 0.30），并且**只动 opacity**（不动 scale），
//       避免整块重绘造成的抖动；进度条补间也放慢一点，看起来是"走"过去而不是"跳"。
// ============================================================================

export function LoadingScreen() {
  const visible = useLoadScreen((s) => s.visible);
  const leaving = useLoadScreen((s) => s.leaving);
  const label = useLoadScreen((s) => s.label);
  const percent = useLoadScreen((s) => s.percent);
  // 进度条要"追"目标值而不是瞬移：目标变了就先停在旧值再过渡（CSS transition 负责补间）
  const [, force] = useState(0);

  // 淡出前多等两帧 —— 让底下的主界面先画出第一帧，否则会看到一瞬间的空白。
  // 用 nextFrames（带定时器兜底）：窗口最小化时 rAF 会被暂停，裸 rAF 会让淡出永远等不到。
  useEffect(() => {
    if (!leaving) return;
    const cancel = nextFrames(() => force((n) => n + 1));
    return cancel;
  }, [leaving]);

  if (!visible) return null;

  return (
    <div
      className={'bc-loading' + (leaving ? ' is-leaving' : '')}
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