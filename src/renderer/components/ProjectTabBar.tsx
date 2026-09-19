import React, { useEffect, useRef, useState } from 'react';
import { useTabStore, type ProjectTab } from '@store/tabStore';
import { useScene } from '@store/sceneStore';
import { TipsTicker } from './TipsTicker';

// BlockCanvas · Windows 11 记事本风格项目多标签栏 (ProjectTabBar)
// 遵循《设计语言规范》与 VS Code 标准交互：
// - 【✏️ 笔图标前置】：放在项目名称左侧，清晰直观，点击或双击即可就地重命名
// - 【VS Code 一模一样的圆点与叉逻辑】：
//     * 未保存 (isDirty)：默认展示圆点 ●，鼠标悬停 (hover) 时圆点变为关闭叉 ×（点击关闭前提示保存）；
//     * 已保存 (!isDirty)：始终直接展示关闭叉 ×，随时可点击关闭，无需等待 hover。
// - v0.4.3：标签宽度自适应（少→平分变宽，多→压缩+滚动）；「＋新建」移出滚动区；
//   右侧常驻「小技巧」轮播条（只留 × 关闭，双击换一条）。

export function ProjectTabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const switchTab = useTabStore((s) => s.switchTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const newTab = useTabStore((s) => s.newTab);

  // 双击/点击铅笔重命名状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // 标签条是否已经放不下（出现横向滚动）——放不下时标签不再强行平分宽度
  const stripRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const update = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs]);

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

    // —— v0.4.1 修复：未保存标签关闭保护（模仿记事本）——
    // 过去的 BUG：新建标签页写了内容、从未 Ctrl+S 时，点 × 会被【无提示直接关闭】，
    // 且该标签同时从会话恢复（data/session.json）里移除 —— 项目就这么丢了。
    //
    // 现在的策略：
    //  · 干净标签（无任何修改）→ 直接关，无感；
    //  · 改过 + 已有文件 → 提示"保存后关闭"（确定=保存并关；取消=保持打开）；
    //  · 改过 + 从未保存过 → 明确警告"关闭后无法找回"（确定=放弃；取消=留着）。
    // 关闭整个软件时的会话恢复特性不受影响：没被 × 关掉的标签（含未保存草稿）仍走
    // data/session.json 原地恢复，下次打开还是一样的界面。
    if (tab.isDirty) {
      if (tab.filePath) {
        const saveFirst = confirm(
          `项目「${tab.name}」有未保存的修改。\n\n` +
            `确定 = 保存并关闭\n取消 = 保持打开（不关闭）`
        );
        if (!saveFirst) return;
        const curScene = useScene.getState().scene;
        window.bc.saveProject({ name: tab.name, scene: curScene }, false, tab.filePath).then(() => {
          useTabStore.getState().setTabSaved(tab.id, tab.filePath!, tab.name);
          closeTab(tab.id);
        });
        return;
      }
      const abandon = confirm(
        `「${tab.name}」还没有保存过（Ctrl+S 可保存为 .bcproj 工程文件）。\n\n` +
          `直接关闭后，这个项目将从标签列表移除且无法找回。\n` +
          `（提示：不点 ×、直接退出软件的话，未保存草稿仍会在下次打开时恢复）\n\n` +
          `确定要直接关闭吗？`
      );
      if (!abandon) return;
      closeTab(tab.id);
      return;
    }

    closeTab(tab.id);
  };

  return (
    <div className={"project-tab-bar" + (overflow ? " tabs-overflow" : "")}>
      <div className={"tab-strip" + (overflow ? " has-overflow" : "")} ref={stripRef}>
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
      </div>

      {/* ＋ 新建：不随标签滚动，常驻可见 */}
      <button
        className="tab-add-btn"
        onClick={() => newTab()}
        title="新建空白项目工程 (Ctrl+N)"
      >
        ＋
      </button>

      {/* 小技巧轮播条：标签再多也常驻右端（自身允许收窄省略，绝不把标签挤没） */}
      <TipsTicker variant="tabbar" />
    </div>
  );
}
