// BlockCanvas · 「显示 <br>」开关的全局共享状态（v0.4.4g）
// ----------------------------------------------------------------------------
// 这个开关同时被两处读写：画布就地编辑框右上角、以及右侧属性面板「文案内容」下方。
// usePersistedBool 每个调用点各持一份 state，两处不会自动同步 —— 所以这里做一个
// 极小的模块级 store（配 useSyncExternalStore），改一处两边同时变，并持久化。
import { useSyncExternalStore } from 'react';

const KEY = 'bc-flag:canvas-show-br';

function read(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

let value = read();
const subs = new Set<() => void>();

export const showBrStore = {
  get: (): boolean => value,
  set: (v: boolean): void => {
    if (v === value) return;
    value = v;
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* 忽略 */ }
    subs.forEach((f) => f());
  },
  toggle: (): void => showBrStore.set(!value),
  subscribe: (f: () => void): (() => void) => {
    subs.add(f);
    return () => { subs.delete(f); };
  }
};

export function useShowBr(): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(showBrStore.subscribe, showBrStore.get, showBrStore.get);
  return [v, showBrStore.set];
}
