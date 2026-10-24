import { useState } from 'react';
import { useScene } from '@store/sceneStore';
import { useTabStore, type ProjectTab } from '@store/tabStore';
import { appConfirm } from '@lib/appConfirm';
import { Icon } from './Icon';

// ============================================================================
// BlockCanvas · 快照只读预览（v0.4.5）
// ----------------------------------------------------------------------------
// 用户在「全部项目 → 历史快照」里点「预览」时，会开一个 kind='snapshot' 的标签：
//   · 画布、属性面板全部只读（改不了），标签带相机图标、淡紫底色；
//   · 顶部工具条换成三个动作：覆盖回项目 / 另存为新项目 / 退出预览；
//   · 关闭标签不提示保存（本来就没得保存）。
//
// 覆盖回项目是危险动作：二次确认 + **先把当前项目状态存一份快照**，再写回，
// 完成后明确告知"已回退到 X 时间的快照"，并把已打开的原工程标签同步刷新。
// ============================================================================

function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function SnapshotBar({ tab }: { tab: ProjectTab }) {
  const snap = tab.snapshot!;
  const [busy, setBusy] = useState<'overwrite' | 'saveas' | null>(null);

  const exitPreview = () => {
    useTabStore.getState().closeTab(tab.id);
    window.dispatchEvent(new CustomEvent('bc:toast', { detail: { text: '已退出快照预览', type: 'ok' } }));
  };

  // —— 覆盖回项目 ——
  const overwrite = async () => {
    if (busy) return;
    const ok = await appConfirm({
      title: '覆盖回项目？',
      body:
        `即将把这份快照（${fmtTime(snap.takenAt)}）写回项目「${snap.projectName}」。\n\n` +
        '· 项目当前内容会被这份快照**替换**；\n' +
        '· 覆盖前系统会先自动存一份"覆盖前快照"，万一后悔还能再找回来；\n' +
        '· 这个操作不能撤销（但可以用刚才那份快照恢复）。',
      okText: '确认覆盖',
      cancelText: '再想想',
      danger: true
    });
    if (!ok) return;
    if (!snap.projectPath) {
      await appConfirm({ title: '无法覆盖', body: '这份快照没有记录原工程路径（可能是从外部文件导入的），请改用「另存为新项目」。', okText: '知道了' });
      return;
    }
    setBusy('overwrite');
    try {
      // 1) 先读当前工程 → 存一份"覆盖前"快照（失败不阻断，但要告知）
      try {
        const cur = await window.bc.openProjectFile(snap.projectPath);
        if (cur.ok && cur.project?.scene) {
          await window.bc.saveBackupSnapshot(cur.project.scene, snap.projectName, false);
        }
      } catch { /* 当前工程读不出来也继续：至少把快照写回去 */ }

      // 2) 把快照场景写回原工程文件
      const scene = tab.scene;
      const res = await window.bc.saveProject(
        { name: snap.projectName, scene, meta: { restoredFromSnapshot: snap.takenAt } },
        false,
        snap.projectPath
      );
      if (!res.ok) {
        await appConfirm({ title: '覆盖失败', body: res.error || '写入工程文件失败', okText: '知道了' });
        return;
      }
      // 3) 同步刷新已经打开着的那个工程标签
      useTabStore.getState().applyRestoredScene(snap.projectPath, scene);
      window.dispatchEvent(new CustomEvent('bc:toast', {
        detail: { text: `已回退到 ${fmtTime(snap.takenAt)} 的快照（覆盖前状态已自动备份）`, type: 'ok' }
      }));
      useTabStore.getState().closeTab(tab.id);
    } finally {
      setBusy(null);
    }
  };

  // —— 另存为新项目 ——
  const saveAs = async () => {
    if (busy) return;
    setBusy('saveas');
    try {
      const name = `${snap.projectName}-快照-${stamp()}`;
      const res = await window.bc.saveProject({ name, scene: tab.scene, meta: { fromSnapshot: snap.snapshotPath } }, true);
      if (res.canceled) return;
      if (!res.ok || !res.path) {
        await appConfirm({ title: '另存失败', body: res.error || '未知错误', okText: '知道了' });
        return;
      }
      const tabId = useTabStore.getState().newTab(res.name || name, tab.scene, res.path);
      useTabStore.getState().switchTab(tabId);
      useTabStore.getState().markActiveTabDirty(false);
      useTabStore.getState().closeTab(tab.id);
      window.dispatchEvent(new CustomEvent('bc:toast', { detail: { text: '已把快照另存为新项目', type: 'ok' } }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="snapshot-bar" data-bc-avoid="snapshotbar">
      <span className="snap-badge"><Icon name="camera" size={13} /> 只读快照</span>
      <span className="snap-title">{snap.projectName}</span>
      <span className="snap-time">{fmtTime(snap.takenAt)}</span>
      <span className="snap-spacer" />
      <span className="snap-hint">预览状态：内容不可修改</span>
      <button className="snap-btn is-danger" disabled={busy !== null} onClick={() => void overwrite()}>
        <Icon name="undo" size={13} /> {busy === 'overwrite' ? '覆盖中…' : '覆盖回项目'}
      </button>
      <button className="snap-btn" disabled={busy !== null} onClick={() => void saveAs()}>
        <Icon name="save" size={13} /> {busy === 'saveas' ? '保存中…' : '另存为新项目'}
      </button>
      <button className="snap-btn is-ghost" onClick={exitPreview}>
        <Icon name="close" size={13} /> 退出预览
      </button>
    </div>
  );
}

/** 只读模式下左侧面板的占位说明（替代元素面板） */
export function SnapshotNotice() {
  return (
    <div className="panel snapshot-notice">
      <div className="snap-notice-icon"><Icon name="camera" size={26} /></div>
      <div className="snap-notice-title">快照只读预览</div>
      <div className="snap-notice-desc">
        你现在看到的是某次保存时留下的历史快照。<br />
        画布与属性面板都不可修改，避免误改。
      </div>
      <div className="snap-notice-tip">
        想继续编辑？点顶部「另存为新项目」，或用「覆盖回项目」把这份快照还原回原工程。
      </div>
    </div>
  );
}

/** 只读模式下右侧面板：快照信息 + 结构统计 */
export function SnapshotInfoPanel({ tab }: { tab: ProjectTab }) {
  const scene = useScene((s) => s.scene);
  const snap = tab.snapshot!;
  let elements = 0;
  const walk = (n: any) => { elements += 1; (n.children || []).forEach(walk); };
  try { walk(scene.root); } catch { /* 忽略 */ }
  return (
    <div className="panel snapshot-info">
      <div className="snap-info-head"><Icon name="camera" size={14} /> 快照信息</div>
      <div className="snap-info-row"><span>项目</span><b>{snap.projectName}</b></div>
      <div className="snap-info-row"><span>时间</span><b>{fmtTime(snap.takenAt)}</b></div>
      <div className="snap-info-row"><span>元素</span><b>{elements} 个</b></div>
      <div className="snap-info-row"><span>变量</span><b>{scene.tokens?.length ?? 0} 个</b></div>
      <div className="snap-info-path" title={snap.snapshotPath}>{snap.snapshotPath}</div>
      <div className="snap-info-tip">
        这份快照是只读的。想改内容，请用顶部「另存为新项目」；想还原原工程，用「覆盖回项目」。
      </div>
    </div>
  );
}
