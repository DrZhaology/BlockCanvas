// BlockCanvas · 外壳布局断点（v0.4.6 · R6-7，v0.4.6 竖屏改造拆轴）
//
// 为什么要先有"外壳断点"这个词：项目里的 `BREAKPOINTS`（768/480）是**被设计的那张网页**
// 的断点，和编辑器自己的界面没关系。以前窗口被锁在 ≥960px，所以"外壳窄屏"根本不存在。
//
// 现在放开到 360px，需要区分两种外壳**布局**：
//   split  ≥900px —— 左右面板并排（今天的样子）
//   stack  <900px —— 左右面板改抽屉 / 全屏覆盖，工具栏可横向滚动
//
// 阈值取 900 而不是 768：右侧属性面板默认 456px、左侧元素面板 230px，
// 900 - 456 - 230 = 214px，再窄画布就没法看了 —— 所以 900 是"并排还能用"的下限。
//
// ⚠ v0.4.6 拆轴（重要）：这个文件只管**布局**，只看宽度。
//   "是不是触摸设备"是另一个正交的轴，在 `lib/inputMode.ts`（data-input）。
//   以前一个 `data-shell='narrow'` 同时当布局开关和输入开关用，
//   导致"1280px 平板横放没有 Alt 悬停"、"700px 桌面窄窗被塞 420ms 长按"这两类错配。
//   论证见 docs/架构-横竖屏与输入模式.md。
import { useEffect, useState } from 'react';

/** 外壳断点：≥这个宽度可以并排，以下进堆叠形态 */
export const SHELL_SPLIT_MIN = 900;

export type ShellLayout = 'split' | 'stack';

export function shellLayoutOf(width: number): ShellLayout {
  return width >= SHELL_SPLIT_MIN ? 'split' : 'stack';
}

/**
 * 订阅窗口宽度，返回外壳布局形态。
 *
 * 用 matchMedia 而不是 resize 事件：matchMedia 只在**跨过阈值**时触发，
 * 拖动窗口过程中不会每帧 setState（宽度变化本来就不需要逐像素重渲染外壳）。
 */
export function useShellLayout(): { layout: ShellLayout; width: number } {
  const [layout, setLayout] = useState<ShellLayout>(() =>
    shellLayoutOf(typeof window === 'undefined' ? 1280 : window.innerWidth));
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${SHELL_SPLIT_MIN}px)`);
    const sync = () => {
      setLayout(mq.matches ? 'split' : 'stack');
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

  return { layout, width };
}
