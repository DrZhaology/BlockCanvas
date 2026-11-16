// BlockCanvas · v0.4.6 竖屏偏好（设置页「竖屏设置」那一块的真实开关）
// ----------------------------------------------------------------------------
// 用户原话：「手机端设置分三块（电脑设置 / 通用设置 / 竖屏设置）并真正适配。」
//
// 「真正适配」的意思是：这些开关必须真的改变竖屏行为，不能只是摆设。
// 所以每一条都只有**一个读取入口**，谁要用谁来问，别在组件里各读各的 localStorage
// （那样设置页改完得刷新才生效 —— 上一版"设置不生效"就是这么来的）。
//
// 订阅机制和 altMode.ts 一样：一个模块级变量 + 一组回调，故意不上 zustand ——
// 这几项是"整页重渲染没必要"的低频开关。
import { useEffect, useState } from 'react';

export type PortraitPrefs = {
  /** 是否显示第二条操作栏（桌面工具栏按钮那条） */
  bar2: boolean;
  /** 长按判定时长（ms）：越短越灵敏，越长越不误触 */
  holdMs: number;
  /** 下方图层面板高度（vh） */
  sheetVh: number;
};

const KEY = 'bc-pt-prefs';
export const HOLD_OPTIONS = [300, 420, 600];
export const SHEET_OPTIONS = [35, 42, 55];

const DEFAULTS: PortraitPrefs = { bar2: true, holdMs: 420, sheetVh: 42 };

let cur: PortraitPrefs = { ...DEFAULTS };
const subs = new Set<(v: PortraitPrefs) => void>();

try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const o = JSON.parse(raw) as Partial<PortraitPrefs>;
    cur = {
      bar2: typeof o.bar2 === 'boolean' ? o.bar2 : DEFAULTS.bar2,
      holdMs: HOLD_OPTIONS.includes(Number(o.holdMs)) ? Number(o.holdMs) : DEFAULTS.holdMs,
      sheetVh: SHEET_OPTIONS.includes(Number(o.sheetVh)) ? Number(o.sheetVh) : DEFAULTS.sheetVh
    };
  }
} catch { /* 隐私模式 / 坏数据：用默认值 */ }

export function portraitPrefsNow(): PortraitPrefs { return cur; }

export function setPortraitPrefs(patch: Partial<PortraitPrefs>): void {
  cur = { ...cur, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* ignore */ }
  subs.forEach((fn) => fn(cur));
}

export function usePortraitPrefs(): PortraitPrefs {
  const [v, setV] = useState(cur);
  useEffect(() => {
    subs.add(setV);
    setV(cur);
    return () => { subs.delete(setV); };
  }, []);
  return v;
}
