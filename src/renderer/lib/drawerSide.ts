// ============================================================================
// BlockCanvas · 窄屏抽屉的方位（v0.4.6）
// ----------------------------------------------------------------------------
// 用户原话：
//   「设置里再做一个访问性的设置：抽屉在左侧还是右侧还是左右分布（或者左右反向分布）。
//     电脑端显示这个选项，同时要标名是竖屏相关的设置选项，我建议横屏、竖屏、公共
//     就可以分成三块区域。」
//
// 四种方位（只在窄屏/竖屏生效，宽屏下左右面板本来就是并排的）：
//   split          元素面板在左、属性面板在右（默认，最符合"改左边、看右边"的习惯）
//   split-reverse  反过来：元素面板在右、属性面板在左（左手持机 / 左撇子友好）
//   both-left      两个都收在左边（单手拇指够得着）
//   both-right     两个都收在右边
//
// 为什么用 localStorage 而不是工程文件：这是**这台机器/这个屏幕**的适应项，
// 不该跟着工程走（换一台横屏电脑打开同一个工程，不该突然变成左右反向）。
// ============================================================================
import { useEffect, useState } from 'react';

export type DrawerSideMode = 'split' | 'split-reverse' | 'both-left' | 'both-right';

export const DRAWER_SIDE_KEY = 'bc-drawer-side';
export const DRAWER_SIDE_EVENT = 'bc:drawer-side-changed';

export const DRAWER_SIDE_LABELS: Array<{ value: DrawerSideMode; label: string }> = [
  { value: 'split', label: '左右分布（元素面板左 · 属性面板右）' },
  { value: 'split-reverse', label: '左右反向（元素面板右 · 属性面板左）' },
  { value: 'both-left', label: '都收在左侧（单手够得着）' },
  { value: 'both-right', label: '都收在右侧' }
];

export function readDrawerSide(): DrawerSideMode {
  try {
    const v = localStorage.getItem(DRAWER_SIDE_KEY);
    if (v === 'split' || v === 'split-reverse' || v === 'both-left' || v === 'both-right') return v;
  } catch { /* ignore */ }
  return 'split';
}

export function writeDrawerSide(m: DrawerSideMode): void {
  try { localStorage.setItem(DRAWER_SIDE_KEY, m); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(DRAWER_SIDE_EVENT));
}

export function useDrawerSide(): [DrawerSideMode, (m: DrawerSideMode) => void] {
  const [mode, setMode] = useState<DrawerSideMode>(readDrawerSide);
  useEffect(() => {
    const sync = () => setMode(readDrawerSide());
    window.addEventListener(DRAWER_SIDE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(DRAWER_SIDE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return [mode, writeDrawerSide];
}
