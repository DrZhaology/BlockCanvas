import { useCallback, useState } from 'react';

// BlockCanvas · 把「用户调过的状态」记到 localStorage
//
// 需求：所有能开/能关、能折叠/能展开的东西，下次打开都应该还是他上次的样子。
// 这里提供两个极小的工具，统一读写约定（避免各处自己写 try/catch 和解析逻辑）：
//   usePersistedBool('bc-xxx', true)   —— 布尔开关
//   usePersistedState('bc-xxx', value) —— 任意可 JSON 序列化的状态
//
// 读取失败（无 localStorage / 脏数据）时一律退回默认值，绝不因为记忆出问题影响启动。

export function readPersisted<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return def;
    return JSON.parse(raw) as T;
  } catch {
    return def;
  }
}

export function writePersisted(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 忽略：隐私模式等 */ }
}

const BOOL_PREFIX = 'bc-flag:';

/** 布尔型开关（内部按 '1' / '0' 存，肉眼可读） */
export function usePersistedBool(key: string, def: boolean): [boolean, (v: boolean | ((p: boolean) => boolean)) => void] {
  const [v, setV] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(BOOL_PREFIX + key);
      return raw === null ? def : raw === '1';
    } catch { return def; }
  });
  const set = useCallback((next: boolean | ((p: boolean) => boolean)) => {
    setV((prev) => {
      const nv = typeof next === 'function' ? (next as (p: boolean) => boolean)(prev) : next;
      try { localStorage.setItem(BOOL_PREFIX + key, nv ? '1' : '0'); } catch { /* ignore */ }
      return nv;
    });
  }, [key]);
  return [v, set];
}

/** 任意可序列化状态（对象 / 字符串 / 数字） */
export function usePersistedState<T>(key: string, def: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => readPersisted<T>(key, def));
  const set = useCallback((next: T | ((p: T) => T)) => {
    setV((prev) => {
      const nv = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      writePersisted(key, nv);
      return nv;
    });
  }, [key]);
  return [v, set];
}
