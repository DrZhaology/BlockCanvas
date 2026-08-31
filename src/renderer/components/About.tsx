import { useEffect, useState } from 'react';
import logoUrl from '@renderer/assets/logo.svg';

// BlockCanvas · 关于弹窗
// 展示新 Logo + 应用名/版本/一句话说明；点遮罩、关闭按钮或 Esc 关闭。
export function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    window.bc.getLocalVersion().then(setVersion).catch(() => {});
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="about-mask" onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div className="about-card" onClick={(e) => e.stopPropagation()}>
        <img className="about-logo" src={logoUrl} alt="BlockCanvas Logo" />
        <div className="about-title">BlockCanvas</div>
        <div className="about-sub">积木画布</div>
        <div className="about-version">版本 {version || '…'} · 阶段 3 测试版</div>
        <div className="about-desc">
          傻瓜式可视化静态网页构建工具 —— 拖拖拽拽做出专业网页，
          产物是干净、可读、手写级的 HTML / CSS / JS。
        </div>
        <div className="about-foot">
          <button className="btn-primary" onClick={onClose}>知道了</button>
        </div>
      </div>
    </div>
  );
}
