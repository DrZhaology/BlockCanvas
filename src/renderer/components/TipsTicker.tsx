import { useEffect, useRef, useState } from 'react';
import { TIPS, tipsEnabled, setTipsEnabled } from './CanvasOverlays';

// BlockCanvas · 「小技巧」轮播条
//
// v0.4.3：从工具栏第二行移到 **项目标签栏右侧**（常驻，不随标签滚动）。
// 设计理念：技巧是常驻的一行文字，路过就读到一句，不打断操作。
//
// 行为：
//  · 每 15 秒淡出→换一条→淡入；
//  · 标签栏变体（tabbar）：**双击文字** 立刻换一条（单击留给切换标签的肌肉记忆，
//    避免误触），只保留一个 × 关闭按钮；不再显示计数与 ↻；
//  · 点 × 收起（设置 → 个性化与外观 里可以重新打开）。

const ROTATE_MS = 15000;

export function TipsTicker({ variant = 'toolbar' }: { variant?: 'toolbar' | 'tabbar' }) {
  const [visible, setVisible] = useState<boolean>(() => tipsEnabled());
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * Math.max(1, TIPS.length)));
  const timer = useRef(0);

  useEffect(() => {
    const onChanged = () => setVisible(tipsEnabled());
    window.addEventListener('bc:canvas-tips-changed', onChanged);
    window.addEventListener('storage', onChanged);
    return () => {
      window.removeEventListener('bc:canvas-tips-changed', onChanged);
      window.removeEventListener('storage', onChanged);
      window.clearInterval(timer.current);
    };
  }, []);

  const next = () => {
    setIdx((prev) => {
      if (TIPS.length <= 1) return prev;
      let n = Math.floor(Math.random() * TIPS.length);
      let guard = 0;
      while (n === prev && guard < 24) { n = Math.floor(Math.random() * TIPS.length); guard += 1; }
      return n;
    });
  };

  // 换一条后重新计时：避免刚手动切完 1 秒就又被自动换掉
  useEffect(() => {
    if (!visible) return;
    window.clearInterval(timer.current);
    timer.current = window.setInterval(next, ROTATE_MS);
    return () => window.clearInterval(timer.current);
  }, [visible, idx]);

  if (!visible || TIPS.length === 0) return null;

  if (variant === 'tabbar') {
    return (
      <div className="tabbar-tips" title="编辑器小技巧：每隔一会儿自动换一条；双击文字立刻换下一条">
        <span className="tt-icon">💡</span>
        {/* key 变化 → 重新挂载 → 入场动画重播，形成"淡出换入"的轮播感 */}
        <button
          className="tt-text"
          key={idx}
          onDoubleClick={next}
          title="双击换一条"
          dangerouslySetInnerHTML={{ __html: TIPS[idx] }}
        />
        <button
          className="tt-btn"
          onClick={() => setTipsEnabled(false)}
          title="不再显示技巧（可随时在「设置 → 个性化与外观」重新打开）"
        >×</button>
      </div>
    );
  }

  return (
    <div className="tips-ticker" title="编辑器小技巧：每隔一会儿自动换一条；点文字立刻换下一条">
      <span className="tt-icon">💡</span>
      <button
        className="tt-text"
        key={idx}
        onClick={next}
        dangerouslySetInnerHTML={{ __html: TIPS[idx] }}
      />
      <span className="tt-count">{idx + 1}/{TIPS.length}</span>
      <button className="tt-btn" onClick={next} title="换一条">↻</button>
      <button
        className="tt-btn"
        onClick={() => setTipsEnabled(false)}
        title="不再在工具栏显示技巧（可随时在「设置 → 个性化与外观」重新打开）"
      >×</button>
    </div>
  );
}
