import { useState, useEffect } from 'react';
import { useScene } from '@store/sceneStore';

// BlockCanvas · 意外退出自动恢复提示条
// 应用启动时自动检测 data/backups/autosave.bcproj
// 若存在未保存草稿，浮出醒目提示供用户一键无缝恢复！

export function DisasterRecoveryBanner() {
  const [draftInfo, setDraftInfo] = useState<{ autosave: any; updatedAt: string; elementCount: number } | null>(null);
  const [closed, setClosed] = useState(false);
  const setScene = useScene((s) => s.setScene);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.bc.getAutosaveBackup();
        if (res.ok && res.autosave && res.elementCount && res.elementCount > 1) {
          // 仅当草稿非空时弹出恢复提示
          setDraftInfo({
            autosave: res.autosave,
            updatedAt: res.updatedAt || '',
            elementCount: res.elementCount
          });
        }
      } catch {}
    })();
  }, []);

  if (!draftInfo || closed) return null;

  const timeStr = draftInfo.updatedAt ? new Date(draftInfo.updatedAt).toLocaleTimeString() : '刚刚';

  const handleRestore = () => {
    if (draftInfo.autosave?.scene) {
      setScene(draftInfo.autosave.scene);
    }
    setClosed(true);
  };

  return (
    <div className="recovery-banner">
      <div className="recovery-banner-content">
        <span className="recovery-icon">💡</span>
        <span className="recovery-txt">
          检测到上次意外退出的自动保存草稿（<b>{timeStr}</b>，包含 {draftInfo.elementCount} 个元素）。是否恢复？
        </span>
      </div>
      <div className="recovery-banner-actions">
        <button className="btn-primary btn-mini" onClick={handleRestore}>
          恢复此草稿
        </button>
        <button className="btn-mini recovery-ignore-btn" onClick={() => setClosed(true)}>
          忽略
        </button>
      </div>
    </div>
  );
}
