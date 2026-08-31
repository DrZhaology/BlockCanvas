import { useState, useEffect, useRef } from 'react';
import { useTabStore } from '@store/tabStore';
import type { ProjectFileInfo } from '../global';

// BlockCanvas · 本地全部项目库中心 (ProjectsCenter)
// 遵循《设计语言规范》：
// - 卡片式浏览 data/projects/ 下所有 .bcproj 工程文件
// - 点击项目直接载入为新标签页 (可多工程并存)
// - 点击「⏱️ 快照」滑出专属抽屉，按项目隔离查看历史回退版本
// - 删除项目实施【双重防护模态弹窗】：第一次确认影响，第二次要求手动输入项目全名方可解锁删除！

export function ProjectsCenter(props: {
  onBack: () => void;
}) {
  const { onBack } = props;
  const newTab = useTabStore((s) => s.newTab);

  const [projects, setProjects] = useState<ProjectFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // 查看某个项目专属的快照抽屉
  const [selectedProjectForBackups, setSelectedProjectForBackups] = useState<ProjectFileInfo | null>(null);
  const [projectBackups, setProjectBackups] = useState<ProjectFileInfo[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);

  // 双重删除防护弹窗状态
  const [deleteTarget, setDeleteTarget] = useState<ProjectFileInfo | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const deleteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (deleteTarget) {
      setTimeout(() => {
        if (deleteInputRef.current) {
          deleteInputRef.current.focus();
          deleteInputRef.current.select();
        }
      }, 60);
    }
  }, [deleteTarget]);

  const refreshProjects = async () => {
    setLoading(true);
    try {
      const list = await window.bc.listProjects();
      setProjects(list);
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshProjects();
  }, []);

  const showToast = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3500);
  };

  // 1. 打开项目为新标签页
  const handleOpenInNewTab = async (p: ProjectFileInfo) => {
    const res = await window.bc.openProjectFile(p.filePath);
    if (res.ok && res.project?.scene) {
      newTab(p.name, res.project.scene, p.filePath);
      showToast(`已在新标签页打开「${p.name}」`);
      onBack();
    } else {
      showToast('打开失败：' + (res.error || '无效文件'), 'err');
    }
  };

  // 2. 导入外部 .bcproj 项目文件
  const handleImportProject = async () => {
    const res = await window.bc.openProjectFile();
    if (res.canceled) return;
    if (res.ok && res.project?.scene) {
      const pName = res.project.name || '已导入工程';
      newTab(pName, res.project.scene, res.path);
      showToast(`已导入并打开「${pName}」`);
      onBack();
    } else {
      showToast('导入失败：' + (res.error || '无效文件'), 'err');
    }
  };

  // 3. 新建空白项目
  const handleNewProject = () => {
    newTab();
    showToast('已新建空白项目');
    onBack();
  };

  // 4. 打开双重删除弹窗
  const startDeleteModal = (e: React.MouseEvent, p: ProjectFileInfo) => {
    e.stopPropagation();
    setDeleteTarget(p);
    setDeleteConfirmInput('');
  };

  // 5. 执行双重防护确认删除
  const executeDeleteProject = async () => {
    if (!deleteTarget) return;
    if (deleteConfirmInput.trim() !== deleteTarget.name.trim()) {
      alert('输入的项目名称不匹配，删除已取消。');
      return;
    }
    const res = await window.bc.deleteProject(deleteTarget.fileName, deleteTarget.name);
    if (res.ok) {
      showToast(`已永久删除项目「${deleteTarget.name}」及其所有历史备份`);
      refreshProjects();
      if (selectedProjectForBackups?.fileName === deleteTarget.fileName) {
        setSelectedProjectForBackups(null);
      }
      setDeleteTarget(null);
    } else {
      showToast('删除失败：' + res.error, 'err');
    }
  };

  // 6. 点击查看该项目专属快照列表
  const handleViewBackups = async (e: React.MouseEvent, p: ProjectFileInfo) => {
    e.stopPropagation();
    setSelectedProjectForBackups(p);
    setBackupsLoading(true);
    try {
      const list = await window.bc.listBackups(p.name);
      setProjectBackups(list);
    } catch {}
    finally {
      setBackupsLoading(false);
    }
  };

  // 7. 恢复某份专属快照
  const handleRestoreSnapshot = async (b: ProjectFileInfo) => {
    if (confirm(`确定要将画布载入该备份快照（${new Date(b.updatedAt).toLocaleString()}）吗？`)) {
      const res = await window.bc.openProjectFile(b.filePath);
      if (res.ok && res.project?.scene) {
        newTab(`${selectedProjectForBackups?.name || '项目'} (快照恢复)`, res.project.scene, null);
        showToast('已载入快照草稿！');
        onBack();
      }
    }
  };

  const filteredProjects = projects.filter((p) => {
    const kw = search.trim().toLowerCase();
    if (!kw) return true;
    return p.name.toLowerCase().includes(kw) || p.fileName.toLowerCase().includes(kw);
  });

  return (
    <div className="pc-page">
      {/* 顶部标题与快速操作栏 */}
      <div className="pc-header">
        <div className="pc-header-left">
          <button className="pc-back-btn" onClick={onBack} title="返回画布编辑器">
            ← 返回编辑器
          </button>
          <span className="pc-title">📁 本地全部项目库</span>
          <span className="pc-count-badge">{projects.length} 个工程</span>
        </div>

        <div className="pc-header-right">
          <input
            type="text"
            className="pc-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索项目名称…"
          />
          <button className="btn-secondary btn-mini" onClick={handleImportProject} title="打开并导入任意位置的 .bcproj 文件">
            📂 导入外部项目…
          </button>
          <button className="btn-primary btn-mini" onClick={handleNewProject} title="新建空白工程标签 (Ctrl+N)">
            ＋ 新建项目
          </button>
          <button className="btn-secondary btn-mini" onClick={() => window.bc.openDataPath('projects')} title="在文件资源管理器中查看 data/projects/">
            打开项目目录
          </button>
        </div>
      </div>

      {msg && (
        <div className={"pc-toast" + (msg.type === 'err' ? ' err' : '')}>
          {msg.text}
        </div>
      )}

      {/* 项目列表主体 */}
      <div className="pc-body">
        {filteredProjects.length > 0 ? (
          <div className="pc-grid">
            {filteredProjects.map((p) => (
              <div
                key={p.fileName}
                className="pc-card"
                onClick={() => handleOpenInNewTab(p)}
                title={`点击在新标签页打开项目「${p.name}」`}
              >
                <div className="pc-card-cover">
                  <span className="pc-cover-icon">📄</span>
                  <span className="pc-cover-badge">{p.elementCount ?? 1} 元素</span>
                </div>

                <div className="pc-card-body">
                  <div className="pc-card-name" title={p.name}>{p.name}</div>
                  <div className="pc-card-file">{p.fileName}</div>
                  <div className="pc-card-time">📅 {new Date(p.updatedAt).toLocaleDateString()} {new Date(p.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>

                <div className="pc-card-foot">
                  <button
                    className="pc-backup-btn"
                    onClick={(e) => handleViewBackups(e, p)}
                    title={`查看项目「${p.name}」的专属历史备份与快照`}
                  >
                    ⏱️ 历史快照 ({p.backupCount || 0})
                  </button>
                  <span className="spacer" />
                  <button
                    className="pc-card-del-btn"
                    onClick={(e) => startDeleteModal(e, p)}
                    title="删除此项目工程及所有历史备份"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : !loading && (
          <div className="pc-empty-full">
            <div className="pc-empty-icon">📁</div>
            <div className="pc-empty-title">
              {search ? `未找到匹配「${search}」的项目` : '本地项目库暂无已保存工程'}
            </div>
            <div className="pc-empty-desc">
              在画布中按 <b>Ctrl+S</b> 保存当前网页，工程文件就会自动归档在此处。
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn-primary btn-mini" onClick={handleNewProject}>
                ＋ 立即新建项目
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 某个项目专属的历史快照抽屉面板 */}
      {selectedProjectForBackups && (
        <div className="pc-drawer-mask" onClick={() => setSelectedProjectForBackups(null)}>
          <div className="pc-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="pc-drawer-header">
              <div className="pc-drawer-title">
                <span>⏱️「{selectedProjectForBackups.name}」的专属快照</span>
              </div>
              <button className="cp-close" onClick={() => setSelectedProjectForBackups(null)}>×</button>
            </div>

            <div className="pc-drawer-hint">
              以下是系统为项目 <b>{selectedProjectForBackups.name}</b> 自动保存的时间戳历史快照，点击可安全载入查看：
            </div>

            <div className="pc-drawer-list">
              {projectBackups.map((b) => (
                <div key={b.fileName} className="pc-backup-item">
                  <div className="pc-backup-meta">
                    <span className="pc-backup-tag">{b.name}</span>
                    <span className="pc-backup-time">{new Date(b.updatedAt).toLocaleString()}</span>
                  </div>
                  <div className="pc-backup-action">
                    <button
                      className="btn-primary btn-mini"
                      onClick={() => handleRestoreSnapshot(b)}
                    >
                      载入此版本
                    </button>
                  </div>
                </div>
              ))}

              {projectBackups.length === 0 && !backupsLoading && (
                <div className="hint" style={{ padding: 24, textAlign: 'center' }}>
                  该项目暂无历史快照，编辑过程中系统将自动为你生成。
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 双重删除防护模态弹窗 */}
      {deleteTarget && (
        <div className="modal-mask" onClick={() => setDeleteTarget(null)}>
          <div className="double-delete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dd-modal-header">
              <span className="dd-modal-title">⚠️ 删除项目确认 (双重安全防护)</span>
              <button className="cp-close" onClick={() => setDeleteTarget(null)}>×</button>
            </div>

            <div className="dd-modal-body">
              <div className="dd-modal-warn">
                您即将永久删除项目工程 <b>「{deleteTarget.name}」</b>（{deleteTarget.fileName}）。
                <br />
                此操作将<b>同时清理该项目名下的所有历史备份与快照</b>，且无法从回收站恢复！
              </div>

              <div className="dd-modal-input-group">
                <label className="dd-modal-label">
                  为防止误删，请输入项目全名 <code onClick={() => setDeleteConfirmInput(deleteTarget.name)} title="点击自动填入" style={{ cursor: 'pointer' }}>{deleteTarget.name}</code> 进行确认（可点击名字快速填入）：
                </label>
                <input
                  ref={deleteInputRef}
                  type="text"
                  className="dd-modal-input"
                  placeholder="在此输入项目全名以解锁删除"
                  value={deleteConfirmInput}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDeleteConfirmInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && deleteConfirmInput.trim() === deleteTarget.name.trim()) {
                      executeDeleteProject();
                    }
                  }}
                />
              </div>
            </div>

            <div className="dd-modal-footer">
              <button className="btn-secondary btn-mini" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button
                className="btn-danger btn-mini"
                disabled={deleteConfirmInput.trim() !== deleteTarget.name.trim()}
                onClick={executeDeleteProject}
              >
                我已确认，永久删除该项目
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
