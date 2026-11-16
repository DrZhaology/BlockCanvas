// BlockCanvas · 画布宽度的只读订阅（属性面板判断"自适应 / 具体像素"要用）

import { useState, useEffect } from 'react';

export function useCanvasWidth(): string {
  const [w, setW] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem('bc-canvas-width') || '"auto"') as string; } catch { return 'auto'; }
  });
  useEffect(() => {
    const on = (e: Event) => setW(String((e as CustomEvent).detail ?? 'auto'));
    window.addEventListener('bc-canvas-width-changed', on);
    return () => window.removeEventListener('bc-canvas-width-changed', on);
  }, []);
  return w || 'auto';
}
