import { useEffect, useState } from 'react';

// BlockCanvas · 浮层「退场动画」通用小工具
//
// 问题：条件渲染（{open && <Pop/>}）只有进场没有退场 —— 关掉时元素被瞬间移除，
// 动画根本来不及播，看起来就是"啪一下没了"。
//
// 解决：把「显示中」拆成两个阶段
//   mounted=true  closing=false → 播进场动画
//   mounted=true  closing=true  → 播退场动画
//   mounted=false               → 真正卸载
// 调用方只要把 returned 的 mounted 用于条件渲染、closing 拼到 className 上即可。
//
// 配套样式约定（styles.css）：
//   .bc-mask / .bc-pop + .is-closing

export function useClosing(open: boolean, ms = 160): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, ms);
    return () => window.clearTimeout(t);
  }, [open, mounted, ms]);

  return { mounted, closing };
}
