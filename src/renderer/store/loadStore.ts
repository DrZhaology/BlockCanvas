import { create } from 'zustand';

// ============================================================================
// BlockCanvas · 启动 / 打开工程的加载页状态（v0.4.5）
// ----------------------------------------------------------------------------
// 用户要求：「加载项目的时候做一个加载的页面，可以包含 BlockCanvas 的 Logo，
//            显示真实的加载进度，与主界面要过渡丝滑。」
//
// 三个关键点，缺一个就会变成"假的加载页"：
//  1. **真实进度**：进度条只由主进程的 `bc:load-progress` 事件（解包素材等真实步骤）
//     与渲染进程自己的真实步骤驱动 —— 不用定时器硬凑，也不会走到 90% 卡住。
//  2. **不闪**：一次加载至少显示 MIN_VISIBLE_MS，否则小工程会"闪一下白屏"。
//  3. **丝滑过渡**：进度条本身用 CSS transition 追目标值；退出时先淡出再卸载，
//     且在"主界面已经画出第一帧"之后才淡出（见 LoadingScreen 的 double-rAF）。
// ============================================================================

/**
 * 一次加载至少显示这么久，避免"闪一下"。
 * v0.4.5 第 14 批：用户反馈"淡入淡出太快了，还有卡顿，时长可以长一点" —— 520 → 900。
 * 这 0.9 秒同时也让"淡入 0.42s + 停顿 + 淡出 0.55s"有空间，观感才不仓促。
 */
export const MIN_VISIBLE_MS = 900;
/** 淡出时长（必须和 28-v045-zindex.css 里 `.bc-loading.is-leaving` 的动画时长一致） */
export const LEAVE_MS = 550;

interface LoadState {
  /** 是否正在显示加载页 */
  visible: boolean;
  /** 正在淡出（还挂在 DOM 上） */
  leaving: boolean;
  label: string;
  /** 目标百分比（0~100） */
  percent: number;
  /** 本次加载开始的时刻（用于最小显示时长） */
  startedAt: number;
  /** 正在收尾（防止 finish 被调用两次 → 两套定时器打架） */
  finishing: boolean;
  begin: (label?: string) => void;
  report: (label: string, percent: number) => void;
  finish: () => void;
}

export const useLoadScreen = create<LoadState>((set, get) => ({
  visible: false,
  leaving: false,
  label: '',
  percent: 0,
  startedAt: 0,
  finishing: false,

  begin: (label = '正在准备…') => set((st) => ({
    visible: true,
    leaving: false,
    finishing: false,
    label,
    // 连续打开两个工程时从"已有进度"接着走，不要回跳到 6%
    percent: Math.max(6, st.visible ? st.percent : 0),
    startedAt: Date.now()
  })),

  report: (label, percent) => {
    const st = get();
    if (!st.visible) return;
    set({ label, percent: Math.max(st.percent, Math.min(100, Math.round(percent))) });
  },

  finish: () => {
    const st = get();
    if (!st.visible || st.finishing) return;
    set({ percent: 100, label: '准备就绪', finishing: true });
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - st.startedAt));
    window.setTimeout(() => {
      set({ leaving: true });
      window.setTimeout(() => set({ visible: false, leaving: false, percent: 0, finishing: false }), LEAVE_MS);
    }, wait);
  }
}));