// BlockCanvas · 输入方式（v0.4.6 · 与"外壳布局"正交的第二个轴）
//
// 为什么要有这个文件：以前 `.app` 上只有一个 `data-shell`，它同时决定了
//   ① 布局（面板并排还是抽屉）—— 该由**宽度**决定
//   ② 交互（点按目标多大、是否装滑动手势、悬停才现的控件）—— 该由**设备能力**决定
// 宽度不是输入方式的代理，两个立刻能复现的错配：
//   · 1280px 的 iPad 横放：够宽（布局该是 split），但没有鼠标、没有 hover
//     → Alt 悬停才出的吸附墙和定界框在触摸屏上**永远调不出来**
//   · 700px 的桌面窄窗：布局该是 stack，但有鼠标和 Alt
//     → 硬塞 44px 触摸目标和 420ms 长按，鼠标用户只觉得"要点两下"
//
// 所以把输入拆成独立轴，用**能力查询**判断，不用宽度猜。
// 详细论证见 docs/架构-横竖屏与输入模式.md。
//
// ⚠ 判定规则要保守：带触摸屏的 Windows 笔记本（maxTouchPoints = 10）
//   主输入仍然是鼠标/触控板，`hover: hover` + `pointer: fine` 成立 → 判 pointer。
//   只有"明确没有悬停能力"（hover: none）才认触摸，否则整个桌面端都会变粗。

export type InputMode = 'pointer' | 'touch';

/** 首选判据：粗指针 + 无悬停 = 手机/平板 */
const COARSE_QUERY = '(hover: none) and (pointer: coarse)';
/** 兜底判据：只证明"没有悬停"，还要叠加 maxTouchPoints 才认触摸 */
const NO_HOVER_QUERY = '(hover: none)';

function matches(q: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(q).matches;
}

/**
 * 当前输入方式。`pointer` = 有精确指针且能悬停（鼠标/触控板），`touch` = 手指优先。
 * 这是**读一次**的版本，给事件回调与非渲染逻辑用；组件里请用 `useInputMode()`。
 */
export function inputModeNow(): InputMode {
  if (typeof window === 'undefined') return 'pointer';
  if (matches(COARSE_QUERY)) return 'touch';
  // 有些 WebView 报 pointer 不准，但 (hover: none) 与 maxTouchPoints 是准的。
  // 必须两个条件同时成立才判触摸 —— 只靠 maxTouchPoints 会把触摸屏笔记本一起判掉。
  const touchPoints = typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0);
  if (touchPoints > 0 && matches(NO_HOVER_QUERY)) return 'touch';
  return 'pointer';
}

/**
 * 订阅输入方式。用 matchMedia 的 change 事件，只在**换设备/插拔外设/翻转模式**时触发，
 * 不会像 resize 那样逐帧 setState。
 *
 * 为什么同时监听两条查询：兜底分支依赖 (hover: none) 与 maxTouchPoints 的组合，
 * 只监听 COARSE_QUERY 会在"粗指针但不是 coarse"的设备上漏掉切换。
 */
import { useEffect, useState } from 'react';

export function useInputMode(): InputMode {
  const [mode, setMode] = useState<InputMode>(() => inputModeNow());

  useEffect(() => {
    const sync = () => setMode(inputModeNow());
    sync();
    const queries = [COARSE_QUERY, NO_HOVER_QUERY].map((q) => window.matchMedia(q));
    const cleanups: Array<() => void> = [];
    for (const mq of queries) {
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', sync);
        cleanups.push(() => mq.removeEventListener('change', sync));
      } else {
        // 老 Chromium 的 fallback（addListener 已废弃但还可用）
        mq.addListener(sync);
        cleanups.push(() => mq.removeListener(sync));
      }
    }
    return () => cleanups.forEach((fn) => fn());
  }, []);

  return mode;
}
