// ============================================================================
// BlockCanvas · v0.4.7 · 就地编辑框的"轻点选区弹菜单 + 全选/取消选中"
// ----------------------------------------------------------------------------
// 从 CanvasNode 抽出来的原因：那块逻辑有 80 行，而 CanvasNode 受 600 行预算约束。
// 逻辑本身只有三件事：
//   ① 轻点（按下-抬起没移动）选中的文字 → 打开样式菜单（触摸屏没有右键）；
//   ② 选区变化 → 广播 `bc:text-sel`，第三层「情境栏」据此显示「全选 / 取消选中」；
//   ③ 听 `bc:text-sel-all` / `bc:text-sel-clear` 去操作 textarea。
//
// ⚠ 两个踩过的坑写在这里，改之前先看：
//   ① 浏览器在 **pointerdown 的瞬间就把选区点塌了**（selectionStart==End），
//      所以"按下时有没有选区"不能从 pointerdown 里读，只能记住 onSelect 给出的最后一次非空选区。
//   ② 竖屏手势层会 stopPropagation 吃掉落进 `.canvas-wrap` 的 pointerdown ——
//      textarea 上的这两个处理器要能收到事件，手势层必须先让路（见 useTouchCanvas.onDown）。
// ============================================================================
import { useEffect, useRef } from 'react';

export type TextMenuOpen = (p: {
  mode: 'element' | 'range';
  id: string;
  x: number;
  y: number;
  start: number;
  end: number;
  text: string;
  avoid: DOMRect;
}) => void;

export function useTextTapMenu(opts: {
  id: string;
  editing: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onOpen: TextMenuOpen;
}) {
  const { id, editing, inputRef, onOpen } = opts;
  const tapRef = useRef<{ s: number; e: number; x: number; y: number; t: number } | null>(null);
  const lastSelRef = useRef<{ s: number; e: number } | null>(null);

  /** 打开菜单：整段选中走 element（写元素 CSS），部分选中走 range（内联样式） */
  const open = (ta: HTMLTextAreaElement, s: number, e: number, x: number, y: number) => {
    const avoid = ta.getBoundingClientRect();
    if (s === 0 && e === ta.value.length) {
      onOpen({ mode: 'element', id, x, y, start: 0, end: 0, text: ta.value, avoid });
    } else {
      onOpen({ mode: 'range', id, x, y, start: s, end: e, text: ta.value, avoid });
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const ta = e.currentTarget;
    tapRef.current = { s: ta.selectionStart, e: ta.selectionEnd, x: e.clientX, y: e.clientY, t: Date.now() };
  };

  const onPointerUp = (e: React.PointerEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const ta = e.currentTarget;
    const before = tapRef.current;
    tapRef.current = null;
    if (!before) return;
    const moved = Math.abs(e.clientX - before.x) > 8 || Math.abs(e.clientY - before.y) > 8;
    const quick = Date.now() - before.t < 500;
    const last = lastSelRef.current;
    if (!last || moved || !quick) return;
    ta.setSelectionRange(last.s, last.e);   // 轻点会把选区点塌，先还原
    open(ta, last.s, last.e, e.clientX, e.clientY);
  };

  const onSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const s = ta.selectionStart;
    const e0 = ta.selectionEnd;
    if (e0 > s) lastSelRef.current = { s, e: e0 };
    window.dispatchEvent(new CustomEvent('bc:text-sel', { detail: { selected: e0 > s } }));
  };

  /** 右键（桌面）：同样的分流规则 */
  const onContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const s = ta.selectionStart;
    const e0 = ta.selectionEnd;
    if (s === e0) return;
    e.preventDefault();
    e.stopPropagation();
    open(ta, s, e0, e.clientX, e.clientY);
  };

  // 情境栏的「全选 / 取消选中」：按钮在 App，真正动 textarea 的代码在这里
  useEffect(() => {
    const emit = (selected: boolean) =>
      window.dispatchEvent(new CustomEvent('bc:text-sel', { detail: { selected } }));
    if (!editing) { emit(false); return undefined; }
    const onAll = () => {
      const ta = inputRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(0, ta.value.length);
      lastSelRef.current = { s: 0, e: ta.value.length };
      emit(true);
    };
    const onClear = () => {
      const ta = inputRef.current;
      if (!ta) return;
      const p = ta.selectionEnd;
      ta.focus();
      ta.setSelectionRange(p, p);
      emit(false);
    };
    window.addEventListener('bc:text-sel-all', onAll);
    window.addEventListener('bc:text-sel-clear', onClear);
    return () => {
      window.removeEventListener('bc:text-sel-all', onAll);
      window.removeEventListener('bc:text-sel-clear', onClear);
      emit(false);
    };
  }, [editing, inputRef]);

  return { onPointerDown, onPointerUp, onSelect, onContextMenu };
}
