// BlockCanvas · v0.4.6 竖屏「Alt 模式」（第二条操作栏的那个开关）
// ----------------------------------------------------------------------------
// 用户原话：
//   「下方工具栏的加入一个按钮，开启 Alt 模式，或者你取个别的名字，开启后按照电脑端的，
//     但是调整按钮，逻辑你自己做了，我后续看有问题再改。」
//
// 为什么需要它：桌面端的定位助手（吸附墙 / 定界框 / 拖到边吸附 / 精确微调）全靠**按住 Alt**。
// 触摸屏没有 Alt 键，竖屏又没有键盘 —— 于是这套能力在平板上等于不存在。
// 给一个开关把"Alt 一直按住"这个状态锁住，就能在竖屏里完整用上桌面那套逻辑。
//
// 两条实现规矩：
//   1. 只做**状态**，不碰逻辑 —— useAltDrag / useMarquee 里凡是读 e.altKey 的地方
//      改成读 `altHeld(e)`，开关关着时行为与以前一模一样；
//   2. 开启时**关掉竖屏手势层**（单指平移/长按选中），否则画布的指针事件全被手势层吃掉，
//      Alt 那套拖拽根本收不到。这是"开启后按照电脑端的"的直接含义。
import { useEffect, useState } from 'react';

const KEY = 'bc-alt-mode';

let on = false;
const subs = new Set<(v: boolean) => void>();

try { on = localStorage.getItem(KEY) === '1'; } catch { /* ignore */ }

export function altModeNow(): boolean { return on; }

export function setAltMode(v: boolean): void {
  on = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  subs.forEach((fn) => fn(v));
}

/** Alt 生效判定：真按了 Alt **或** 开着一键 Alt 模式 */
export function altHeld(e: { altKey?: boolean }): boolean {
  return Boolean(e?.altKey) || on;
}

export function useAltMode(): boolean {
  const [v, setV] = useState(on);
  useEffect(() => {
    subs.add(setV);
    setV(on);
    return () => { subs.delete(setV); };
  }, []);
  return v;
}
