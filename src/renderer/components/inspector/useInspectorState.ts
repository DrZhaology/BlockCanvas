// BlockCanvas · 属性面板的「板块折叠记忆」与「快捷助手开关」
//
// 这两块都是"看起来简单、实际上踩过坑"的状态逻辑，所以从 ElementPropsBody 里抽出来单放：
//
// 折叠记忆（secOpen）：
//  · 默认只展开「选择器与标识」—— 新插入的元素先让人看到"叫什么名字"这件事；
//  · 记忆存**工程文件**（scene.uiState.inspectorSec），跟着项目走，不再只写 localStorage；
//  · 从旧版（只写 localStorage）做一次性迁移；
//  · ⚠ 切换元素时**不能**把上一个元素的开关状态写到新元素名下：用 loadedSecKey 守住。
//
// 快捷助手开关（showHelperInCss）：
//  · v0.4.4 起改为**全局统一**（不再按元素/选择器单独记忆）；
//  · 「设置 → 编辑器与画布」里是同一份状态，靠 window 事件双向同步。
import { useEffect, useRef, useState } from 'react';
import { useScene } from '@store/sceneStore';
import type { SceneElement } from '@lib/types';
import { HELPER_IN_CSS_KEY } from './shared';

export type SecKey = 'identity' | 'layout' | 'css' | 'pseudo';
export type SecOpen = Record<SecKey, boolean>;

const DEFAULT_SEC: SecOpen = { identity: true, layout: false, css: false, pseudo: false };

const normalizeSec = (p: Record<string, unknown> | null | undefined): SecOpen => ({
  identity: (p?.identity as boolean | undefined) ?? true,
  layout: (p?.layout as boolean | undefined) ?? false,
  css: (p?.css as boolean | undefined) ?? false,
  pseudo: (p?.pseudo as boolean | undefined) ?? false
});

/**
 * 折叠状态的存储键：同类名 / 同关系选择器的元素共享一份记忆。
 * 优先级：关系选择器 → 类名 → 元素 id（后者是"还没起名"的临时身份）。
 */
export function secStorageKeyOf(selected: SceneElement): string {
  const rel = (selected.attrs?.relSelector ?? '').trim();
  if (rel) return 'bc-inspector-sec-rel-' + rel.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cls = (selected.attrs?.className ?? '').trim();
  if (cls) return 'bc-inspector-sec-cls-' + cls.split(/\s+/)[0];
  return 'bc-inspector-sec-id-' + selected.id;
}

export function useInspectorSectionOpen(selected: SceneElement): { secOpen: SecOpen; setSecOpen: React.Dispatch<React.SetStateAction<SecOpen>> } {
  const elementId = selected.id;
  const secStorageKey = secStorageKeyOf(selected);

  const [secOpen, setSecOpen] = useState<SecOpen>(() => {
    const fromScene = useScene.getState().scene.uiState?.inspectorSec?.[secStorageKey];
    if (fromScene) return normalizeSec(fromScene as Record<string, unknown>);
    for (const k of [secStorageKey, 'bc-inspector-sec-id-' + elementId, 'bc-inspector-sec-' + elementId]) {
      try {
        const saved = localStorage.getItem(k);
        if (saved) {
          const v = normalizeSec(JSON.parse(saved) as Record<string, unknown>);
          queueMicrotask(() => useScene.getState().setInspectorSec(secStorageKey, v));
          return v;
        }
      } catch { /* 忽略 */ }
    }
    return DEFAULT_SEC;
  });

  // 折叠状态变更 → 写进工程文件（scene.uiState）
  // v0.4.4 修：**切换选中元素时不能把上一个元素的开关状态写到新元素名下**。
  // 以前两个 effect 的执行顺序是「先保存（用新 key + 旧 state）→ 再读取」，于是永远读到刚写进去的旧状态，
  // 表现就是"换了个元素，右侧面板还是上一个元素的开合状态"。
  // 这里用 loadedSecKey 记录"当前 state 属于哪个 key"，只在 key 一致时才保存。
  const loadedSecKey = useRef(secStorageKey);
  useEffect(() => {
    if (loadedSecKey.current !== secStorageKey) return;
    useScene.getState().setInspectorSec(secStorageKey, secOpen);
  }, [secOpen, secStorageKey]);

  // 元素切换 / 身份变化时，从工程文件恢复该元素的折叠状态；
  // 并做一次性迁移：元素从「未命名（按 id 记录）」到「有了类名/选择器（按选择器记录）」时，
  // 把原记录搬过去 —— 展开习惯跟着元素走，不会因为起了个名字就全收回去了。
  useEffect(() => {
    const readFrom = (key: string): SecOpen | null => {
      const fromScene = useScene.getState().scene.uiState?.inspectorSec?.[key];
      if (fromScene) return normalizeSec(fromScene as Record<string, unknown>);
      try {
        const saved = localStorage.getItem(key);
        if (saved) return normalizeSec(JSON.parse(saved) as Record<string, unknown>);
      } catch { /* 忽略 */ }
      return null;
    };
    let v = readFrom(secStorageKey);
    if (!v && secStorageKey.startsWith('bc-inspector-sec-cls-')) {
      // 只有"获得类名"才迁移（关系选择器/ID 是另一种身份，习惯未必通用）
      for (const oldKey of ['bc-inspector-sec-id-' + elementId, 'bc-inspector-sec-' + elementId]) {
        const old = readFrom(oldKey);
        if (old) { v = old; break; }
      }
    }
    setSecOpen(v ?? DEFAULT_SEC);
    loadedSecKey.current = secStorageKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secStorageKey, elementId]);

  return { secOpen, setSecOpen };
}

/**
 * 「快捷助手 → 是否显示到下方 CSS 属性」全局开关。
 *
 * v0.4.4：改为**全局统一**（所有元素共用一份，不再按元素/选择器单独记忆），
 * 「设置 → 编辑器与画布」里是同一个开关，两边通过事件即时同步。
 */
export function useHelperInCss(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    /**
     * v0.4.6：**默认关闭**。
     *
     * 用户原话：「默认关闭，也就不把属性显示到下方 CSS」。
     * 以前默认开：快捷助手写的那几条属性（display / gap / background-image…）会一起挤进
     * 下方「CSS 样式属性」列表，一屏里全是"我没手动加过的东西"，反而看不清自己加的那些。
     * 现在默认只管"快捷助手能改"，要查看/微调再手动打开。
     */
    try { return localStorage.getItem(HELPER_IN_CSS_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    const sync = () => {
      try { setOn(localStorage.getItem(HELPER_IN_CSS_KEY) === '1'); } catch { /* ignore */ }
    };
    window.addEventListener('bc:helper-in-css-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('bc:helper-in-css-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const set = (v: boolean) => {
    setOn(v);
    try { localStorage.setItem(HELPER_IN_CSS_KEY, v ? '1' : '0'); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('bc:helper-in-css-changed'));
  };
  return [on, set];
}
