// BlockCanvas · 外壳断点（R6-7）
//
// 为什么要先有"外壳断点"这个词：项目里的 `BREAKPOINTS`（768/480）是**被设计的那张网页**
// 的断点，和编辑器自己的界面没关系。以前窗口被锁在 ≥960px，所以"外壳窄屏"根本不存在。
//
// 现在放开到 360px，需要区分两种外壳形态：
//   wide   ≥900px —— 左右面板并排（今天的样子）
//   narrow <900px —— 左右面板改抽屉 / 全屏覆盖，工具栏可横向滚动
//
// 阈值取 900 而不是 768：右侧属性面板默认 456px、左侧元素面板 230px，
// 900 - 456 - 230 = 214px，再窄画布就没法看了 —— 所以 900 是"并排还能用"的下限。
import { useEffect, useState } from 'react';

/** 外壳断点：≥这个宽度是 wide，以下进 narrow */
export const SHELL_WIDE_MIN = 900;

export type ShellMode = 'wide' | 'narrow';

export function shellModeOf(width: number): ShellMode {
  return width >= SHELL_WIDE_MIN ? 'wide' : 'narrow';
}

/**
 * 订阅窗口宽度，返回外壳形态。
 *
 * 用 matchMedia 而不是 resize 事件：matchMedia 只在**跨过阈值**时触发，
 * 拖动窗口过程中不会每帧 setState（宽度变化本来就不需要逐像素重渲染外壳）。
 */
export function useShellMode(): { mode: ShellMode; width: number } {
  const [mode, setMode] = useState<ShellMode>(() =>
    shellModeOf(typeof window === 'undefined' ? 1280 : window.innerWidth));
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${SHELL_WIDE_MIN}px)`);
    const sync = () => {
      setMode(mq.matches ? 'wide' : 'narrow');
      setWidth(window.innerWidth);
    };
    sync();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync);
      window.addEventListener('resize', sync);
      return () => {
        mq.removeEventListener('change', sync);
        window.removeEventListener('resize', sync);
      };
    }
    // 老 Chromium 的 fallback（addListener 已废弃但还可用）
    mq.addListener(sync);
    window.addEventListener('resize', sync);
    return () => {
      mq.removeListener(sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return { mode, width };
}
