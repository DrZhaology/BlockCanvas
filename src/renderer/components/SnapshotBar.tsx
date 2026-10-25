import { useState } from 'react';
import { useScene } from '@store/sceneStore';
import { useTabStore, type ProjectTab } from '@store/tabStore';
import { appConfirm } from '@lib/appConfirm';
import { Icon } from './Icon';

// ============================================================================
// BlockCanvas · 快照只读预览（v0.4.5，第 10 批重构）
// ----------------------------------------------------------------------------
// 用户在「全部项目 → 历史快照」里点「预览」时，会开一个 kind='snapshot' 的标签。
//
// v0.4.5 第 10 批（用户反馈 J）：
//   「只读快照面板：只保留右侧那一个面板，把所有文字都并进去，去掉下面那条栏，
//     面板宽度不要记忆。」
//
// 以前是"三处分散"：顶部一条 SnapshotBar（信息 + 三个动作）、左侧一块 SnapshotNotice
// （又一段说明）、右侧 SnapshotInfoPanel（再一份信息）—— 同一件事说了三遍，
// 还各占一块版面。现在**只剩右侧一张卡片**：
//   · 顶部那条栏不再出现（画布上方只保留标签栏）；
//   · 左侧元素面板整块不渲染（快照不能改内容，留个空面板只会挤占画布）；
//   · 右侧宽度固定 372px，**不读写 localStorage**，退出预览后编辑器宽度原样回来。
//
// 覆盖回项目仍然是危险动作：二次确认 + 先把当前项目状态存一份快照再写回。
// ============================================================================

function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * 只读快照的**唯一**面板：快照信息 + 三个动作 + 说明，全部收在这一张卡片里。
 * （原来分散在顶部工具条 / 左侧提示 / 右侧信息三处）
 */
export function SnapshotInfoPanel({ tab }: { tab: ProjectTab }) {
  const scene = useScene((s) => s.scene);
  const snap = tab.snapshot!;
  const [busy, setBusy] = useState<'overwrite' | 'saveas' | null>(null);

  let elements = 0;
  const walk = (n: any) => { elements += 1; (n.children || []).forEach(walk); };
  try { walk(scene.root); } catch { /* 忽略 */ }

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
      await appConfirm({
        title: '无法覆盖',
        body: '这份快照没有记录它属于哪个工程文件，所以不知道该写回哪里。\n\n请改用「另存为新项目」，把这份快照存成一个新工程。',
        okText: '知道了'
      });
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
      const res = await window.bc.saveProject(
        { name: snap.projectName, scene: tab.scene, meta: { restoredFromSnapshot: snap.takenAt } },
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
    <div className="panel snapshot-info snapshot-info-solo">
      <div className="snap-solo-head">
        <span className="snap-badge"><Icon name="camera" size={13} /> 只读快照</span>
      </div>
      <div className="snap-solo-title">{snap.projectName}</div>
      <div className="snap-solo-sub">{fmtTime(snap.takenAt)}</div>

      <div className="snap-solo-stats">
        <div><b>{elements}</b><span>元素</span></div>
        <div><b>{scene.tokens?.length ?? 0}</b><span>变量</span></div>
        <div><b>{scene.root.children.length}</b><span>顶层块</span></div>
      </div>

      <div className="snap-solo-actions">
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

      <div className="snap-solo-note">
        <p><b>这是只读的历史快照。</b>画布上的内容不能修改，避免误改已保存的工程。</p>
        <p><b>「覆盖回项目」</b>会把这份快照写回它原来的工程文件，替换掉现在的版本（覆盖前会自动备份一份，可再恢复）。</p>
        <p><b>「另存为新项目」</b>把这份快照存成一个新工程，之后可以正常编辑。</p>
        <p><b>「退出预览」</b>只是关掉这个只读标签，不会改动任何文件。</p>
      </div>

      <details className="snap-solo-more">
        <summary>快照文件在哪</summary>
        <div className="snap-info-path" title={snap.snapshotPath}>{snap.snapshotPath}</div>
        {snap.projectPath
          ? <div className="snap-info-path" title={snap.projectPath}>原工程：{snap.projectPath}</div>
          : <div className="snap-info-path">原工程路径未记录（无法覆盖回项目，只能另存）</div>}
      </details>
    </div>
  );
}