import React, { useState } from 'react';
import { useTabStore, type ProjectTab } from '@store/tabStore';
import { useScene } from '@store/sceneStore';

// BlockCanvas · Windows 11 记事本风格项目多标签栏 (ProjectTabBar)
// 遵循《设计语言规范》与 VS Code 标准交互：
// - 【✏️ 笔图标前置】：放在项目名称左侧，清晰直观，点击或双击即可就地重命名
// - 【VS Code 一模一样的圆点与叉逻辑】：
//     * 未保存 (isDirty)：默认展示圆点 ●，鼠标悬停 (hover) 时圆点变为关闭叉 ×（点击关闭前提示保存）；
//     * 已保存 (!isDirty)：始终直接展示关闭叉 ×，随时可点击关闭，无需等待 hover。

export function ProjectTabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const switchTab = useTabStore((s) => s.switchTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const newTab = useTabStore((s) => s.newTab);

  // 双击/点击铅笔重命名状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const startRename = (e: React.MouseEvent, tab: ProjectTab) => {
    e.stopPropagation();
    setEditingId(tab.id);
    setEditName(tab.name);
  };

  const finishRename = (tab: ProjectTab) => {
    setEditingId(null);
    const n = editName.trim();
    if (n && n !== tab.name) {
      useTabStore.getState().setTabSaved(tab.id, tab.filePath || '', n);
    }
  };

  const handleClose = (e: React.MouseEvent, tab: ProjectTab) => {
    e.stopPropagation();
    if (tab.isDirty && tab.filePath) {
      if (confirm(`项目「${tab.name}」有未保存的修改，是否在关闭前保存？`)) {
        const curScene = useScene.getState().scene;
        window.bc.saveProject({ name: tab.name, scene: curScene }, false, tab.filePath);
      }
    }
    closeTab(tab.id);
  };

  return (
    <div className="project-tab-bar">
      <div className="tab-strip">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isEditing = editingId === tab.id;

          return (
            <div
              key={tab.id}
              className={"tab-item" + (isActive ? " active" : "") + (tab.isDirty ? " is-dirty" : "")}
              onClick={() => switchTab(tab.id)}
              onDoubleClick={(e) => startRename(e, tab)}
              title={tab.filePath ? `${tab.name}\n路径: ${tab.filePath}\n(点击 ✏️ 或双击重命名)` : `${tab.name} (未保存，点击 ✏️ 或双击重命名)`}
            >
              {/* ✏️ 笔图标放到前面 */}
              <button
                className="tab-rename-btn-front"
                onClick={(e) => startRename(e, tab)}
                title="重命名此项目"
              >
                ✏️
              </button>

              {isEditing ? (
                <input
                  type="text"
                  className="tab-rename-input"
                  value={editName}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => finishRename(tab)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finishRename(tab);
                    else if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <span className="tab-title">{tab.name}</span>
              )}

              {/* VS Code 标准指示槽：未保存显示圆点(hover变叉)；已保存直接显示叉 */}
              <div className="tab-indicator-slot">
                <span className="tab-dirty-dot" title="有未保存的修改 (Ctrl+S 保存)" />
                <button
                  className="tab-close-btn"
                  onClick={(e) => handleClose(e, tab)}
                  title="关闭标签"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}

        <button
          className="tab-add-btn"
          onClick={() => newTab()}
          title="新建空白项目工程 (Ctrl+N)"
        >
          ＋
        </button>
      </div>
    </div>
  );
}
