import { useState, useEffect } from 'react';
import { useScene } from '@store/sceneStore';
import { exportHTML } from '@lib/exporter';
import type { ProjectFileInfo } from '../global';

// BlockCanvas · 网页与项目管理中枢 (Web & Project Center)
// - 负责 HTML 网页导出 + 自动双写同名 .bcproj 工程文件（HTML 逆向成本高，双写防丢）
// - 本地项目库管理（一键打开、删除、重命名、另存为）
// - 自动备份快照管理（定时生成，崩溃意外恢复）

export function WebManager(props: {
  onBack: () => void;
  onOpenSettings?: () => void;
}) {
  const { onBack, onOpenSettings } = props;
  const scene = useScene((s) => s.scene);
  const setScene = useScene((s) => s.setScene);

  const [activeTab, setActiveTab] = useState<'projects' | 'backups'>('projects');
  const [projects, setProjects] = useState<ProjectFileInfo[]>([]);
  const [backups, setBackups] = useState<ProjectFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // 导出表单项
  const [projectName, setProjectName] = useState('我的网页');
  const [fileName, setFileName] = useState('index.html');
  const [dualSave, setDualSave] = useState(true); // 导出 HTML 同时自动保存 .bcproj
  const [autoPreview, setAutoPreview] = useState(false);

  const refreshLists = async () => {
    setLoading(true);
    try {
      const pList = await window.bc.listProjects();
      const bList = await window.bc.listBackups();
      setProjects(pList);
      setBackups(bList);
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshLists();
  }, []);

  const showToast = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  // 1. 导出 HTML 网页（支持同时双写 .bcproj）
  const handleExportHTML = async () => {
    const result = exportHTML(scene);
    if (dualSave) {
      const res = await window.bc.exportHTMLWithProject(result.html, scene, fileName, projectName);
      if (res.canceled) return;
      if (res.ok) {
        showToast(`导出成功！已同时生成 HTML 与项目文件：\n${res.htmlPath}`);
        if (autoPreview) window.bc.previewOpen(result.html);
      } else {
        showToast('导出失败：' + (res.error || '未知错误'), 'err');
      }
    } else {
      const res = await window.bc.exportHTML(result.html, fileName);
      if (res.canceled) return;
      if (res.ok) {
        showToast(`网页导出成功：${res.path}`);
        if (autoPreview) window.bc.previewOpen(result.html);
      } else {
        showToast('导出失败：' + (res.error || '未知错误'), 'err');
      }
    }
  };

  // 2. 浏览器即刻预览
  const handlePreview = async () => {
    const result = exportHTML(scene);
    const res = await window.bc.previewOpen(result.html);
    if (!res.ok) showToast('预览失败：' + (res.error || '未知错误'), 'err');
  };

  // 3. 保存当前项目到 data/projects/
  const handleSaveToProjects = async () => {
    const res = await window.bc.saveProject({
      name: projectName,
      scene
    });
    if (res.ok) {
      showToast(`项目「${res.name}」已保存到本地项目库！`);
      refreshLists();
    } else {
      showToast('保存失败：' + (res.error || '未知错误'), 'err');
    }
  };

  // 4. 项目另存为自定义位置 (.bcproj)
  const handleSaveAs = async () => {
    const res = await window.bc.saveProject({
      name: projectName,
      scene
    }, true);
    if (res.canceled) return;
    if (res.ok) {
      showToast(`项目已成功另存为：\n${res.path}`);
      refreshLists();
    } else {
      showToast('保存失败：' + (res.error || '未知错误'), 'err');
    }
  };

  // 5. 打开外部或选定的 .bcproj
  const handleOpenProject = async (filePath?: string) => {
    const res = await window.bc.openProjectFile(filePath);
    if (res.canceled) return;
    if (res.ok && res.project?.scene) {
      setScene(res.project.scene);
      if (res.project.name) setProjectName(res.project.name);
      showToast(`已成功载入项目「${res.project.name || '未命名'}」`);
      setTimeout(() => onBack(), 600);
    } else {
      showToast('打开失败：' + (res.error || '无效工程文件'), 'err');
    }
  };

  // 6. 新建空白工程
  const handleNewProject = () => {
    if (confirm('确定要新建空白工程吗？请确保当前修改已保存。')) {
      useScene.getState().setScene({
        root: {
          id: 'root',
          type: 'div',
          children: [],
          style: { width: '100%', minHeight: '600px', backgroundColor: '#ffffff' }
        },
        selectedId: null,
        selectedIds: []
      });
      setProjectName('新网页项目');
      showToast('已新建空白画布');
      onBack();
    }
  };

  // 7. 删除项目
  const handleDeleteProject = async (p: ProjectFileInfo) => {
    if (confirm(`确定要删除项目「${p.name}」吗？此操作无法撤销。`)) {
      const res = await window.bc.deleteProject(p.fileName);
      if (res.ok) {
        showToast('项目已删除');
        refreshLists();
      } else {
        showToast('删除失败：' + res.error, 'err');
      }
    }
  };

  // 8. 恢复历史备份
  const handleRestoreBackup = async (b: ProjectFileInfo) => {
    if (confirm(`确定要将画布恢复到备份「${b.name}」吗？`)) {
      const res = await window.bc.openProjectFile(b.filePath);
      if (res.ok && res.project?.scene) {
        setScene(res.project.scene);
        showToast('已成功恢复备份快照！');
        setTimeout(() => onBack(), 600);
      }
    }
  };

  // 9. 清空备份历史
  const handleClearBackups = async () => {
    if (confirm('确定要清空全部历史自动备份快照吗？')) {
      const res = await window.bc.clearBackups();
      if (res.ok) {
        showToast('备份已清空');
        refreshLists();
      }
    }
  };

  return (
    <div className="wm-page">
      {/* 顶部标题栏 */}
      <div className="wm-header">
        <div className="wm-header-left">
          <button className="wm-back-btn" onClick={onBack}>
            ← 返回画布编辑器
          </button>
          <span className="wm-title">🌐 网页与项目管理</span>
        </div>
        <div className="wm-header-right">
          {onOpenSettings && (
            <button className="btn-secondary btn-mini" onClick={onOpenSettings}>
              ⚙️ 偏好设置
            </button>
          )}
          <button className="btn-secondary btn-mini" onClick={() => window.bc.openDataPath('projects')}>
            📂 打开项目文件夹
          </button>
        </div>
      </div>

      {msg && (
        <div className={"wm-toast" + (msg.type === 'err' ? ' err' : '')}>
          {msg.text}
        </div>
      )}

      {/* 主双栏布局 */}
      <div className="wm-body">
        {/* 左栏：导出与当前项目保存 */}
        <div className="wm-left-pane">
          <div className="wm-card">
            <div className="wm-card-title">
              <span>🚀 导出 HTML 网页</span>
              <span className="field-hint">发布到任意网站/服务器</span>
            </div>

            <div className="wm-field">
              <label>项目/页面标题</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="例如：我的酷炫产品页"
              />
            </div>

            <div className="wm-field">
              <label>导出 HTML 文件名</label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="index.html"
              />
            </div>

            <div className="wm-check-list">
              <label className="page-check" title="强烈建议开启：HTML 逆向难度大，双写生成 .bcproj 工程文件可保证未来随时可二次编辑！">
                <input
                  type="checkbox"
                  checked={dualSave}
                  onChange={(e) => setDualSave(e.target.checked)}
                />
                <b>同时保存 .bcproj 项目工程文件 (双写防丢，推荐)</b>
              </label>

              <label className="page-check">
                <input
                  type="checkbox"
                  checked={autoPreview}
                  onChange={(e) => setAutoPreview(e.target.checked)}
                />
                导出后立即在浏览器中预览
              </label>
            </div>

            <div className="wm-actions-row">
              <button className="btn-primary wm-export-btn" onClick={handleExportHTML}>
                ⬇ 立即导出 HTML 网页
              </button>
              <button className="btn-secondary" onClick={handlePreview} title="在默认浏览器打开临时预览">
                ▶ 预览 (Ctrl+P)
              </button>
            </div>
          </div>

          <div className="wm-card">
            <div className="wm-card-title">
              <span>💾 项目工程文件 (.bcproj)</span>
              <span className="field-hint">可序列化本地工程</span>
            </div>

            <div className="wm-proj-actions">
              <button className="wm-btn-tile" onClick={handleSaveToProjects}>
                <span className="wm-tile-icon">💾</span>
                <div className="wm-tile-info">
                  <span className="wm-tile-name">保存到本地项目库</span>
                  <span className="wm-tile-desc">快速归档至 data/projects/ 目录</span>
                </div>
              </button>

              <button className="wm-btn-tile" onClick={handleSaveAs}>
                <span className="wm-tile-icon">📁</span>
                <div className="wm-tile-info">
                  <span className="wm-tile-name">项目另存为… (Ctrl+S)</span>
                  <span className="wm-tile-desc">自由选择存储路径与文件名</span>
                </div>
              </button>

              <button className="wm-btn-tile" onClick={() => handleOpenProject()}>
                <span className="wm-tile-icon">📂</span>
                <div className="wm-tile-info">
                  <span className="wm-tile-name">打开外部项目… (Ctrl+O)</span>
                  <span className="wm-tile-desc">从磁盘载入已有 .bcproj 工程</span>
                </div>
              </button>

              <button className="wm-btn-tile" onClick={handleNewProject}>
                <span className="wm-tile-icon">📄</span>
                <div className="wm-tile-info">
                  <span className="wm-tile-name">新建空白项目</span>
                  <span className="wm-tile-desc">清空画布开启全新的创作</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* 右栏：本地项目库与自动备份 */}
        <div className="wm-right-pane">
          <div className="wm-tab-header">
            <button
              className={"wm-tab" + (activeTab === 'projects' ? ' active' : '')}
              onClick={() => setActiveTab('projects')}
            >
              📁 本地项目库 ({projects.length})
            </button>
            <button
              className={"wm-tab" + (activeTab === 'backups' ? ' active' : '')}
              onClick={() => setActiveTab('backups')}
            >
              ⏱️ 自动备份历史 ({backups.length})
            </button>
            <span className="spacer" />
            <button className="btn-mini" onClick={refreshLists} title="刷新列表">
              🔄 刷新
            </button>
            {activeTab === 'backups' && backups.length > 0 && (
              <button className="btn-mini" onClick={handleClearBackups} title="清空全部备份历史">
                清空备份
              </button>
            )}
          </div>

          <div className="wm-tab-content">
            {activeTab === 'projects' && (
              <div className="wm-grid">
                {projects.map((p) => (
                  <div key={p.fileName} className="wm-item-card">
                    <div className="wm-item-head">
                      <span className="wm-item-icon">📄</span>
                      <div className="wm-item-titles">
                        <span className="wm-item-name" title={p.name}>{p.name}</span>
                        <span className="wm-item-meta">{p.fileName}</span>
                      </div>
                    </div>

                    <div className="wm-item-stats">
                      <span>🏷️ {p.elementCount ?? 0} 个元素</span>
                      <span>📅 {new Date(p.updatedAt).toLocaleString()}</span>
                    </div>

                    <div className="wm-item-actions">
                      <button className="btn-primary btn-mini" onClick={() => handleOpenProject(p.filePath)}>
                        打开项目
                      </button>
                      <button className="btn-secondary btn-mini" onClick={() => handleOpenProject(p.filePath)}>
                        载入
                      </button>
                      <button className="btn-mini wm-del-btn" onClick={() => handleDeleteProject(p)}>
                        删除
                      </button>
                    </div>
                  </div>
                ))}
                {projects.length === 0 && !loading && (
                  <div className="wm-empty">
                    <div className="wm-empty-icon">📁</div>
                    <div className="wm-empty-title">本地项目库暂无归档项目</div>
                    <div className="wm-empty-desc">在左侧点击「保存到本地项目库」，工程就会井井有条地显示在这里！</div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'backups' && (
              <div className="wm-grid">
                {backups.map((b) => (
                  <div key={b.fileName} className="wm-item-card wm-backup-card">
                    <div className="wm-item-head">
                      <span className="wm-item-icon">⏱️</span>
                      <div className="wm-item-titles">
                        <span className="wm-item-name">{b.name}</span>
                        <span className="wm-item-meta">{b.fileName}</span>
                      </div>
                    </div>

                    <div className="wm-item-stats">
                      <span>🏷️ {b.elementCount ?? 0} 个元素</span>
                      <span>📅 {new Date(b.updatedAt).toLocaleString()}</span>
                    </div>

                    <div className="wm-item-actions">
                      <button className="btn-primary btn-mini" onClick={() => handleRestoreBackup(b)}>
                        恢复此快照
                      </button>
                      <button className="btn-secondary btn-mini" onClick={() => handleOpenProject(b.filePath)}>
                        另存为
                      </button>
                    </div>
                  </div>
                ))}
                {backups.length === 0 && !loading && (
                  <div className="wm-empty">
                    <div className="wm-empty-icon">⏱️</div>
                    <div className="wm-empty-title">暂无备份快照</div>
                    <div className="wm-empty-desc">系统会在编辑过程中自动创建快照，意外崩溃时可一键秒级恢复！</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
