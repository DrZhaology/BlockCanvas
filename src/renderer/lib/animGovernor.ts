// BlockCanvas · 动画性能总督（v0.4.5）
//
// 用户诉求：「顺便尝试能不能把 css 的动画性能变得更好，因为 css 动画多了就会卡顿。
//            可能不一定从 css 代码方面优化的，可能有别的方法。」
//
// 对，光改 CSS 解决不了 —— 真正的办法是**让动画按运行时的实际情况自动收放**。
// 这个模块做四件事（全部有明确的开关状态，可被探针断言）：
//
//  1. **窗口不可见就全停**（`data-bc-anim="paused"`）
//     `document.hidden` 或窗口失焦时，纯装饰动画（旋转、脉冲、呼吸、进场）暂停不跑。
//     用户切到别的软件时，本程序不该继续烧 GPU/电量。这是**收益最大**的一条。
//
//  2. **持续掉帧就自动精简**（`data-bc-anim="lite"`）
//     用 requestAnimationFrame 采样帧间隔（每帧只是几次加法，开销可忽略）：
//     连续一段时间的第 95 百分位帧时间 > 28ms（≈ 35fps 以下）→ 进入精简档：
//     把所有**装饰性**过渡/动画时长压到 0.01ms（状态视觉仍然正确，只是瞬间到位），
//     但保留"表示正在忙"的旋转指示（否则用户以为卡死了）。
//     等帧率恢复到 > 55fps 并稳定一段时间后自动退回完整档。
//
//  3. **尊重系统的"减少动态效果"**：prefers-reduced-motion: reduce → 直接进精简档，
//     不采样、不来回切（用户已经明确表态了）。
//
//  4. **手动覆盖**：`localStorage['bc-anim-mode']` = 'full' | 'lite' | 'off'
//     给排查问题和"我就是不想要动效"的人一个确定开关（设置页/控制台都能改）。
//
// 暴露给探针：`window.__bcAnim`（当前档位 + 采样数据 + 强制设置的方法）。

export type AnimMode = 'full' | 'lite' | 'off';

const MODE_KEY = 'bc-anim-mode';

/** 帧时间超过这个值就算"这一帧掉了"（28ms ≈ 35fps） */
const BAD_FRAME_MS = 28;
/** 恢复阈值：帧时间低于这个值算"顺"（18ms ≈ 55fps） */
const GOOD_FRAME_MS = 18;
/** 连续多少个采样窗口都很差才降级（避免一次性重活误判） */
const BAD_WINDOWS_TO_LITE = 3;
/** 连续多少个采样窗口都很顺才恢复 */
const GOOD_WINDOWS_TO_FULL = 6;
/** 采样窗口长度（帧） */
const WINDOW_FRAMES = 60;

interface AnimState {
  mode: AnimMode;
  /** 用户手动指定的档位（null = 自动） */
  override: AnimMode | null;
  /** 最近一个窗口的 p95 帧时间 */
  p95: number;
  badStreak: number;
  goodStreak: number;
  /** 是否处于"窗口不可见/失焦"的暂停态 */
  paused: boolean;
}

const state: AnimState = {
  mode: 'full',
  override: null,
  p95: 0,
  badStreak: 0,
  goodStreak: 0,
  paused: false
};

let started = false;
let rafId = 0;
const samples: number[] = [];
let lastTs = 0;

function readOverride(): AnimMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'full' || v === 'lite' || v === 'off' ? v : null;
  } catch { return null; }
}

function prefersReduced(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** 把当前状态写到 <html> 上（CSS 全靠这两个属性工作） */
function apply(mode: AnimMode, paused: boolean) {
  try {
    const el = document.documentElement;
    el.setAttribute('data-bc-anim', mode);
    if (paused) el.setAttribute('data-bc-anim-paused', '1');
    else el.removeAttribute('data-bc-anim-paused');
  } catch { /* 忽略 */ }
}

function setMode(mode: AnimMode, paused = state.paused) {
  state.mode = mode;
  state.paused = paused;
  apply(mode, paused);
}

/** 一帧的采样：满一个窗口就统计 p95，决定要不要降级/恢复 */
function tick(ts: number) {
  rafId = requestAnimationFrame(tick);
  if (lastTs) {
    const dt = ts - lastTs;
    // 明显是切窗口/长时间挂起造成的巨大间隔（>1s）不计入，否则每次切回来都会误判
    if (dt > 0 && dt < 1000) samples.push(dt);
  }
  lastTs = ts;
  if (samples.length < WINDOW_FRAMES) return;

  const sorted = samples.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  samples.length = 0;
  state.p95 = Math.round(p95 * 10) / 10;

  // 手动档位优先，不参与自动升降
  if (state.override === 'full' || state.override === 'off') return;
  if (state.override === 'lite') { setMode('lite'); return; }

  if (p95 > BAD_FRAME_MS) {
    state.badStreak += 1;
    state.goodStreak = 0;
    if (state.badStreak >= BAD_WINDOWS_TO_LITE) setMode('lite');
  } else if (p95 < GOOD_FRAME_MS) {
    state.goodStreak += 1;
    state.badStreak = 0;
    if (state.goodStreak >= GOOD_WINDOWS_TO_FULL) setMode('full');
  } else {
    // 中间地带：保持现状，但把两边计数都往回退一点
    state.badStreak = Math.max(0, state.badStreak - 1);
    state.goodStreak = Math.max(0, state.goodStreak - 1);
  }
}

/** 窗口可见性 / 失焦 → 暂停装饰动画 */
function bindVisibility() {
  const sync = () => {
    const hidden = document.hidden || !document.hasFocus();
    // 「暂停」只是**再叠一层**状态：lite 档遇到不可见也照样停
    state.paused = hidden;
    apply(state.mode, hidden);
  };
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('focus', sync);
  window.addEventListener('blur', sync);
  sync();
}

/**
 * 启动总督（幂等，可以重复调用）。
 * 返回一个手动设档的函数，方便设置页 / 探针使用。
 */
export function startAnimGovernor(): (mode: AnimMode | null) => void {
  if (started) return setAnimMode;
  started = true;
  state.override = readOverride();
  const initial: AnimMode = state.override ?? (prefersReduced() ? 'lite' : 'full');
  setMode(initial);
  bindVisibility();
  // 系统"减少动态效果"中途被改 → 跟随（只在没有手动覆盖时生效）
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener?.('change', () => {
      if (state.override) return;
      setMode(mq.matches ? 'lite' : 'full');
      state.badStreak = 0;
      state.goodStreak = 0;
    });
  } catch { /* 老内核没有 matchMedia 事件，忽略 */ }
  // 只有自动档才需要采样（手动 full / off 不需要一直跑 rAF）
  if (!state.override) rafId = requestAnimationFrame(tick);

  const api = {
    get mode() { return state.mode; },
    get paused() { return state.paused; },
    get p95() { return state.p95; },
    get override() { return state.override; },
    setMode: setAnimMode
  };
  try { (window as unknown as Record<string, unknown>).__bcAnim = api; } catch { /* 忽略 */ }
  return setAnimMode;
}

/** 手动设档：传 null 回到自动（并恢复采样） */
export function setAnimMode(mode: AnimMode | null): void {
  state.override = mode;
  try {
    if (mode) localStorage.setItem(MODE_KEY, mode);
    else localStorage.removeItem(MODE_KEY);
  } catch { /* 忽略 */ }
  if (mode === 'off') { setMode('off'); }
  else if (mode === 'lite') { setMode('lite'); }
  else if (mode === 'full') { setMode('full'); }
  else {
    // 回到自动：清掉计数重新观察
    state.badStreak = 0;
    state.goodStreak = 0;
    setMode(prefersReduced() ? 'lite' : 'full');
  }
  // 采样循环：只有"自动档"才需要
  if (started) {
    if (mode) { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
    else if (!rafId) { lastTs = 0; samples.length = 0; rafId = requestAnimationFrame(tick); }
  }
}

/** 只读当前状态（探针 / 设置页显示用） */
export function animState(): Readonly<AnimState> & { samples: number } {
  return { ...state, samples: samples.length };
}