import { useState, useEffect, useRef } from 'react';
import { useTabStore } from '@store/tabStore';
import { useClosing } from '@lib/useClosing';
import { appConfirm } from '@lib/appConfirm';
import { Icon } from './Icon';
import type { ProjectFileInfo } from '../global';

// BlockCanvas · 本地全部项目库中心 (ProjectsCenter)
// 遵循《设计语言规范》：
// - 卡片式浏览 data/projects/ 下所有 .bcproj 工程文件
// - 点击项目直接载入为新标签页 (可多工程并存)
// - 点击「历史快照」滑出专属抽屉，按项目隔离查看历史回退版本
// - 删除项目走【三步安全防护】，全程点遮罩不会关闭（只能主动点"取消"退出）：
//     第 1 关：手动完整输入项目全名（**不提供**点击名字自动填充）
//     第 2 关：3 个随机方向 / 随机位置的滑块，必须按顺序拖到位
//     第 3 关：最后一次文字确认 → 才真正删除（同时清理该项目名下全部快照与备份）

// ============ 第二关：滑块挑战的随机参数 ============
interface SlideSpec {
  /** 滑块起始位置（%） */
  start: number;
  /** 目标位置（%） */
  target: number;
  /** 当前值（%） */
  value: number;
  done: boolean;
}

const randPct = () => 4 + Math.random() * 92;

/** 生成 3 个"方向随机、位置随机"的滑块：起点与目标至少差 22%（方向自然随机） */
function makeSlides(): SlideSpec[] {
  const out: SlideSpec[] = [];
  for (let i = 0; i < 3; i += 1) {
    const start = randPct();
    let target = randPct();
    let guard = 0;
    while (Math.abs(target - start) < 22 && guard < 60) { target = randPct(); guard += 1; }
    out.push({ start, target, value: start, done: false });
  }
  return out;
}

const HIT_TOLERANCE = 4; // 距离目标 4% 以内即算"到位"（手感宽松一点，触控板也好拖）

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
  // 快照抽屉：关闭时先播出场动画再卸载（过去是瞬间消失，很突兀）
  const [drawerClosing, setDrawerClosing] = useState(false);
  const closeDrawer = () => {
    setDrawerClosing(true);
    window.setTimeout(() => {
      setDrawerClosing(false);
      setSelectedProjectForBackups(null);
    }, 240);
  };
  const [projectBackups, setProjectBackups] = useState<ProjectFileInfo[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);

  // ============ 三步删除防护弹窗 ============
  const [deleteTarget, setDeleteTarget] = useState<ProjectFileInfo | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  // 退场动画：先播动画再真正卸载
  const { mounted: delMounted, closing: delClosing } = useClosing(delOpen, 200);
  useEffect(() => {
    if (!delMounted) setDeleteTarget(null);
  }, [delMounted]);

  const [delStep, setDelStep] = useState<1 | 2 | 3>(1);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const deleteInputRef = useRef<HTMLInputElement>(null);
  const [slides, setSlides] = useState<SlideSpec[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [busy, setBusy] = useState(false);

  const openDeleteModal = (e: React.MouseEvent, p: ProjectFileInfo) => {
    e.stopPropagation();
    setDeleteTarget(p);
    setDelStep(1);
    setDeleteConfirmInput('');
    setSlides(makeSlides());
    setActiveSlide(0);
    setBusy(false);
    setDelOpen(true);
  };
  const closeDeleteModal = () => setDelOpen(false);

  useEffect(() => {
    if (deleteTarget && delStep === 1) {
      // v0.4.4 修复"输入框有时候点不开/打不了字"：
      // 自动聚焦只在上场动画播完前抢一次（80ms），动画还没结束/焦点被别处抢走时就丢了。
      // 改成多次重试（80ms / 320ms / 900ms），并在整个第 1 关期间"点哪都把焦点还给输入框"。
      const times = [80, 320, 900];
      const timers = times.map((t) => window.setTimeout(() => {
        if (delStep === 1) deleteInputRef.current?.focus();
      }, t));
      return () => timers.forEach((t) => window.clearTimeout(t));
    }
    return undefined;
  }, [deleteTarget, delStep]);

  // 三个滑块都到位 → 自动进入第 3 关（稍等一下，让用户看到第三个打勾）
  const allSlidesDone = slides.length > 0 && slides.every((s) => s.done);
  useEffect(() => {
    if (delStep !== 2 || !allSlidesDone) return;
    const t = window.setTimeout(() => setDelStep(3), 420);
    return () => window.clearTimeout(t);
  }, [delStep, allSlidesDone]);

  /**
   * v0.4.5 第 14 批（用户反馈）：「删除项目的时候有个问题，在滑块验证的后面加一个提示，
   * 如果当前编辑器内会话有这个项目会提示要不要关闭，如果不关闭就是取消，关闭按钮点一下就关闭会话。
   * 现在删除项目后，如果会话还在，再次 Ctrl + S 项目会回来。」
   *
   * 做法：第 3 关（最后确认）里先检查"这个工程是否还开在某个标签里"。
   *   · 开着 → 显示一条醒目提示 + 「关闭这个会话」按钮；**没关掉就不允许删**（等于取消）；
   *   · 点一下「关闭这个会话」→ 直接关掉那个标签（关标签本身不弹窗，弹窗在标签栏的 × 上）；
   *   · 关掉后提示消失，删除按钮才可用 —— 这样删完不会被 Ctrl+S 复活。
   */
  const openTabForTarget = (() => {
    if (!deleteTarget) return null;
    const tabs = useTabStore.getState().tabs;
    const norm = (p: string) => String(p || '').replace(/[\\/]+/g, '/').toLowerCase();
    return tabs.find((t) => t.kind !== 'snapshot' && t.filePath && norm(t.filePath) === norm(deleteTarget.filePath)) ?? null;
  })();
  // 会话状态变化时刷新（关掉标签后提示要立刻消失）
  const [, bumpTabs] = useState(0);
  useEffect(() => {
    if (!deleteTarget) return;
    const off = useTabStore.subscribe(() => bumpTabs((n) => n + 1));
    return off;
  }, [deleteTarget]);

  const closeTabForTarget = () => {
    if (!openTabForTarget) return;
    useTabStore.getState().closeTab(openTabForTarget.id);
    bumpTabs((n) => n + 1);
    showToast(`已关闭「${openTabForTarget.name}」的编辑会话，现在可以安全删除了`);
  };

  // —— 滑块拖动 ——
  const trackRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragIdxRef = useRef<number | null>(null);
  const slidesRef = useRef<SlideSpec[]>([]);
  slidesRef.current = slides;

  const valueFromClientX = (idx: number, clientX: number): number => {
    const el = trackRefs.current[idx];
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return 0;
    return Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
  };

  const applySlideValue = (idx: number, v: number) => {
    setSlides((prev) => {
      const s = prev[idx];
      if (!s || s.done) return prev;
      const hit = Math.abs(v - s.target) <= HIT_TOLERANCE;
      const next = [...prev];
      next[idx] = { ...s, value: hit ? s.target : v, done: hit };
      return next;
    });
  };

  const onSlideMove = (e: PointerEvent) => {
    const idx = dragIdxRef.current;
    if (idx == null) return;
    const s = slidesRef.current[idx];
    if (!s || s.done) return;
    const v = valueFromClientX(idx, e.clientX);
    applySlideValue(idx, v);
    if (Math.abs(v - s.target) <= HIT_TOLERANCE) {
      // 到位：结束这次拖动，解锁下一个滑块（必须按顺序）
      endSlideDrag();
      setActiveSlide((a) => (a === idx ? idx + 1 : a));
    }
  };

  const endSlideDrag = () => {
    dragIdxRef.current = null;
    window.removeEventListener('pointermove', onSlideMove);
    window.removeEventListener('pointerup', endSlideDrag);
  };

  const onSlideDown = (idx: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (idx !== activeSlide || slidesRef.current[idx]?.done) return;
    e.preventDefault();
    e.stopPropagation();
    dragIdxRef.current = idx;
    // 不在这里直接赋值 —— 必须真的"拖动"（pointermove）才会移动滑块
    window.addEventListener('pointermove', onSlideMove);
    window.addEventListener('pointerup', endSlideDrag);
  };

  useEffect(() => () => endSlideDrag(), []);

  // ============ 项目列表 ============
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
      // v0.4.4：同一个文件重复打开 → 切到已打开的标签，不再新开（轻提示，不弹窗）
      const norm = (x: string) => String(x || '').replace(/[\\/]+/g, '/').toLowerCase();
      const st = useTabStore.getState();
      const existing = st.tabs.find((t) => t.filePath && norm(t.filePath) === norm(p.filePath));
      if (existing) {
        st.switchTab(existing.id);
        showToast(`「${existing.name}」已经打开着，已为你切换过去`);
      } else {
        // v0.4.5（用户反馈 C补10）：工程文件里存了撤销历史（sections.history），
        // 但这条路径**没有把它传进去** → 打开后按 Ctrl+Z 一次都撤不动
        //（"文件里有 100 条记录却按了没反应"就是这个原因）。菜单里那条打开路径原本是传了的。
        newTab(p.name, res.project.scene, p.filePath, res.history);
        showToast(`已在新标签页打开「${p.name}」`);
      }
      onBack();
    } else {
      // v0.4.5：工程打不开时不要只丢一句"无效文件"——给出可走的路。
      // 说明具体坏在哪，并让用户选择"尝试修复 / 从快照恢复 / 放弃"。
      const tryRepair = await appConfirm({
        title: '这个工程打不开',
        body:
          `「${p.name}」读取失败：\n${res.error || '文件结构不完整'}\n\n` +
          '常见原因：保存过程中断电/磁盘满、文件被别的程序改过、或从网盘同步了半截文件。\n\n' +
          '点「尝试修复」我会尽量从文件里把场景数据抢救出来（不动原文件）；\n' +
          '如果修不回来，还可以到「历史快照」里找上一个可用的版本。',
        okText: '尝试修复',
        cancelText: '先不动'
      });
      if (!tryRepair) return;
      const salv = await window.bc.salvageProject(p.filePath);
      if (salv.ok && salv.scene) {
        newTab(`${p.name}（已修复）`, salv.scene as never, null);
        showToast('已从损坏文件里恢复出场景，请另存为新工程');
        onBack();
      } else {
        await appConfirm({
          title: '修复没能成功',
          body:
            `${salv.error || '没能从文件里提取出场景数据'}\n\n` +
            (salv.notes?.length ? '过程记录：\n' + salv.notes.join('\n') + '\n\n' : '') +
            '建议到该项目的「历史快照」里恢复上一个可用版本。',
          okText: '知道了'
        });
      }
    }
  };

  // 2. 导入外部 .bcproj 项目文件
  const handleImportProject = async () => {
    const res = await window.bc.openProjectFile();
    if (res.canceled) return;
    if (res.ok && res.project?.scene) {
      const pName = res.project.name || '已导入工程';
      const norm = (x: string) => String(x || '').replace(/[\\/]+/g, '/').toLowerCase();
      const st = useTabStore.getState();
      const existing = st.tabs.find((t) => t.filePath && norm(t.filePath) === norm(res.path || ''));
      if (existing) {
        st.switchTab(existing.id);
        showToast(`「${existing.name}」已经打开着，已为你切换过去`);
      } else {
        newTab(pName, res.project.scene, res.path, res.history);
        showToast(`已导入并打开「${pName}」`);
      }
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

  // 3b. 重命名工程文件（只改文件名，不改项目名；打开着的标签同步换路径）
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const commitRename = async (p: ProjectFileInfo) => {
    setRenamingFile(null);
    const next = renameValue.trim();
    const base = next.replace(/\.bcproj$/i, '');
    if (!base || `${base}.bcproj` === p.fileName) return;
    const res = await window.bc.renameProject(p.fileName, base);
    if (res.ok && res.fileName && res.path) {
      // 打开着的标签同步换到新路径（不换名字 —— 项目名和文件名是两回事）
      useTabStore.getState().renameTabFilePath(p.filePath, res.path);
      showToast(`文件已重命名为「${res.fileName}」`);
      refreshProjects();
    } else {
      showToast('重命名失败：' + (res.error || '未知错误'), 'err');
    }
  };

  // 4. 执行删除（第 3 关确认后）
  const executeDeleteProject = async () => {
    if (!deleteTarget || busy) return;
    if (deleteConfirmInput.trim() !== deleteTarget.name.trim()) return;
    // v0.4.5：会话还开着就**不允许**删 —— 否则那个标签再按 Ctrl+S 会把文件写回来
    if (openTabForTarget) {
      showToast('请先关闭上面那个编辑会话，否则删除后会被 Ctrl + S 写回来', 'err');
      return;
    }
    setBusy(true);
    const res = await window.bc.deleteProject(deleteTarget.fileName, deleteTarget.name);
    setBusy(false);
    if (res.ok) {
      showToast(`已永久删除项目「${deleteTarget.name}」及其所有历史备份`);
      refreshProjects();
      if (selectedProjectForBackups?.fileName === deleteTarget.fileName) {
        setSelectedProjectForBackups(null);
      }
      closeDeleteModal();
    } else {
      showToast('删除失败：' + res.error, 'err');
    }
  };

  // 5. 点击查看该项目专属快照列表
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

  // 6. 只读预览某份专属快照（v0.4.5）：开一个 kind='snapshot' 的标签，画布不可编辑
  const handlePreviewSnapshot = async (b: ProjectFileInfo) => {
    const res = await window.bc.openProjectFile(b.filePath);
    if (!res.ok || !res.project?.scene) {
      await appConfirm({ title: '快照读取失败', body: res.error || '无法读取这份快照文件', okText: '知道了' });
      return;
    }
    const proj = selectedProjectForBackups;
    newTab(
      `${proj?.name || '项目'} · 快照 ${new Date(b.updatedAt).toLocaleTimeString()}`,
      res.project.scene,
      null,
      undefined,
      'snapshot',
      {
        projectName: proj?.name || res.project.name || '项目',
        projectPath: proj?.filePath,
        snapshotPath: b.filePath,
        takenAt: b.updatedAt
      }
    );
    showToast('已打开只读快照预览');
    onBack();
  };

  // 7. 恢复某份专属快照（作为草稿新标签）
  const handleRestoreSnapshot = async (b: ProjectFileInfo) => {
    const okOpen = await appConfirm({
      title: '载入快照',
      body: `确定要将画布载入该备份快照（${new Date(b.updatedAt).toLocaleString()}）吗？`,
      okText: '载入'
    });
    if (okOpen) {
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

  const nameMatches = !!deleteTarget && deleteConfirmInput.trim() === deleteTarget.name.trim();

  /** 各类型数量（给上方问号的说明里显示"你现在有 N 个网页项目 / N 个外部项目…"） */
  const kindCounts: Record<string, number> = { page: 0, site: 0, external: 0, missing: 0 };
  for (const p of projects) {
    const k = p.kind ?? (p.missing ? 'missing' : p.external ? 'external' : 'page');
    kindCounts[k] = (kindCounts[k] ?? 0) + 1;
  }

  return (
    <div className="pc-page">
      {/* 顶部标题与快速操作栏 */}
      <div className="pc-header">
        <div className="pc-header-left">
          <button className="pc-back-btn" onClick={onBack} title="返回画布编辑器">
            <Icon name="chevronLeft" size={13} /> 返回编辑器
          </button>
          <span className="pc-title"><Icon name="folder" size={16} /> 本地全部项目库</span>
          <span className="pc-count-badge">{projects.length} 个工程</span>
          {/* v0.4.5（用户反馈）：以前这里是一个「『外部』是什么？」按钮，点了没反应（只有 title 提示，
              而 title 要点着停住才出现，还经常被系统忽略）。现在换成**一个真正的小问号**，
              点开/悬停都能看到完整说明；所有项目类型的解释都集中在这里。 */}
          <ProjectKindHelp kinds={kindCounts} />
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
            <Icon name="folderOpen" size={13} /> 导入外部项目…
          </button>
          <button className="btn-primary btn-mini" onClick={handleNewProject} title="新建空白工程标签 (Ctrl+N)">
            <Icon name="plus" size={13} /> 新建项目
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
            {filteredProjects.map((p) => {
              const isRenaming = renamingFile === p.fileName;
              return (
              <div
                key={p.fileName}
                className={'pc-card' + (p.missing ? ' is-missing' : '')}
                onClick={() => {
                  if (isRenaming) return;
                  if (p.missing) {
                    showToast('这个工程的文件已经不在原位置了，可能被移动或删除', 'err');
                    return;
                  }
                  handleOpenInNewTab(p);
                }}
                title={p.missing
                  ? `文件已不在原位置：${p.filePath}`
                  : `点击在新标签页打开项目「${p.name}」`}
              >
                <div className="pc-card-cover">
                  <span className="pc-cover-icon"><Icon name="file" size={34} /></span>
                  <span className="pc-cover-badge">{p.elementCount ?? 1} 元素</span>
                </div>

                <div className="pc-card-body">
                  <div className="pc-card-name" title={p.name}>
                    {p.name}
                    {/* v0.4.5：**每个项目都单独标注类型**（以前只有"外部"和"已丢失"两种） */}
                    {(() => {
                      const kind = p.kind ?? (p.missing ? 'missing' : p.external ? 'external' : 'page');
                      const meta = KIND_META.find((k) => k.id === kind) ?? KIND_META[0];
                      const extra = kind === 'external' || kind === 'missing' ? `\n\n${p.filePath}` : '';
                      return (
                        <span
                          className={'pc-badge ' + meta.cls}
                          title={`${meta.label}\n${meta.desc}${extra}`}
                        >{meta.label}</span>
                      );
                    })()}
                  </div>
                  {isRenaming ? (
                    <input
                      type="text"
                      className="pc-rename-input"
                      autoFocus
                      value={renameValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => { void commitRename(p); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { void commitRename(p); }
                        else if (e.key === 'Escape') { setRenamingFile(null); }
                      }}
                      title="输入新的文件名（回车确认，Esc 取消）"
                    />
                  ) : (
                    <div className="pc-card-file" title={`文件名：${p.fileName}（点铅笔按钮可重命名文件）`}>{p.fileName}</div>
                  )}
                  <div className="pc-card-time"><Icon name="calendar" size={11} /> {new Date(p.updatedAt).toLocaleDateString()} {new Date(p.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>

                <div className="pc-card-foot">
                  {p.missing && (
                    <button
                      className="pc-forget-btn"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await window.bc.forgetExternalProject(p.filePath);
                        setProjects((prev) => prev.filter((x) => x.filePath !== p.filePath));
                        showToast('已从列表移除（磁盘文件未删除）');
                      }}
                      title="只移除这条列表记录，不删除任何磁盘文件"
                    >
                      <Icon name="close" size={11} /> 移除记录
                    </button>
                  )}
                  <button
                    className="pc-backup-btn"
                    onClick={(e) => handleViewBackups(e, p)}
                    title={`查看项目「${p.name}」的专属历史备份与快照`}
                  >
                    <Icon name="timer" size={11} /> 历史快照 ({p.backupCount || 0})
                  </button>
                  <span className="spacer" />
                  <button
                    className="pc-card-ren-btn"
                    onClick={(e) => { e.stopPropagation(); setRenamingFile(p.fileName); setRenameValue(p.fileName.replace(/\.bcproj$/i, '')); }}
                    title="重命名此工程文件（只改文件名，不改项目名）"
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                  <button
                    className="pc-card-del-btn"
                    onClick={(e) => openDeleteModal(e, p)}
                    title="删除此项目工程及所有历史备份"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        ) : !loading && (
          <div className="pc-empty-full">
            <div className="pc-empty-icon"><Icon name="folder" size={44} /></div>
            <div className="pc-empty-title">
              {search ? `未找到匹配「${search}」的项目` : '本地项目库暂无已保存工程'}
            </div>
            <div className="pc-empty-desc">
              在画布中按 <b>Ctrl+S</b> 保存当前网页，工程文件就会自动归档在此处。
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn-primary btn-mini" onClick={handleNewProject}>
                <Icon name="plus" size={13} /> 立即新建项目
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 某个项目专属的历史快照抽屉面板 */}
      {selectedProjectForBackups && (
        <div className={'pc-drawer-mask' + (drawerClosing ? ' is-closing' : '')} onClick={closeDrawer}>
          <div className="pc-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="pc-drawer-header">
              <div className="pc-drawer-title">
                <span><Icon name="timer" size={13} /> 「{selectedProjectForBackups.name}」的专属快照</span>
              </div>
              <button className="cp-close" onClick={closeDrawer}><Icon name="close" size={14} /></button>
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
                      onClick={() => void handlePreviewSnapshot(b)}
                      title="以只读快照标签打开：可查看、可覆盖回项目或另存为新项目，但不会改动任何文件"
                    >
                      <Icon name="camera" size={11} /> 只读预览
                    </button>
                    <button
                      className="btn-secondary btn-mini"
                      onClick={() => handleRestoreSnapshot(b)}
                      title="把这份快照当作草稿载入一个新标签（不会立刻写回项目）"
                    >
                      作为草稿打开
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

      {/* ============ 三步删除防护 ============ */}
      {deleteTarget && delMounted && (
        <div className={'modal-mask dd-mask-static' + (delClosing ? ' is-closing' : '')}>
          <div className={'double-delete-modal' + (delClosing ? ' is-closing' : '')} onClick={(e) => e.stopPropagation()}>
            <div className="dd-modal-header">
              <span className="dd-modal-title"><Icon name="warning" size={15} /> 删除项目确认（三步安全防护）</span>
              <button className="cp-close" onClick={closeDeleteModal} title="取消并关闭"><Icon name="close" size={14} /></button>
            </div>

            {/* 步骤指示 */}
            <div className="dd-steps">
              <span className={'dd-step-dot' + (delStep === 1 ? ' active' : ' done')}>
                <span className="dd-step-no">1</span>输入项目名
              </span>
              <span className="dd-step-line" />
              <span className={'dd-step-dot' + (delStep === 2 ? ' active' : delStep > 2 ? ' done' : '')}>
                <span className="dd-step-no">2</span>滑块验证
              </span>
              <span className="dd-step-line" />
              <span className={'dd-step-dot' + (delStep === 3 ? ' active' : '')}>
                <span className="dd-step-no">3</span>最终确认
              </span>
            </div>

            <div className="dd-modal-body">
              <div className="dd-modal-warn">
                您即将永久删除项目工程 <b>「{deleteTarget.name}」</b>（{deleteTarget.fileName}）。
                <br />
                此操作将<b>同时清理该项目名下的所有历史备份与快照</b>，且无法从回收站恢复！
              </div>

              {/* ---- 第 1 关：完整输入项目名 ---- */}
              {delStep === 1 && (
                <div
                  className="dd-modal-input-group"
                  onClick={() => deleteInputRef.current?.focus()}
                >
                  <label className="dd-modal-label">
                    第 1 关 · 为防止误删，请<b>手动完整输入</b>项目全名 <b>{deleteTarget.name}</b> 进行确认：
                  </label>
                  <input
                    ref={deleteInputRef}
                    type="text"
                    className="dd-modal-input"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="在此手动输入项目全名（不支持点击填入）"
                    value={deleteConfirmInput}
                    onChange={(e) => setDeleteConfirmInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && nameMatches) setDelStep(2);
                    }}
                  />
                </div>
              )}

              {/* ---- 第 2 关：三个随机滑块，按顺序拖到位 ---- */}
              {delStep === 2 && (
                <div>
                  <div className="dd-slider-hint">
                    第 2 关 · 请按 <b>1 → 2 → 3</b> 的顺序，把每个滑块拖到竖线标记处。
                    方向与位置每次随机（拖到目标附近会自动吸附并打勾）。
                  </div>
                  <div className="dd-slider-list">
                    {slides.map((s, i) => {
                      const isActive = i === activeSlide && !s.done;
                      const cls = 'dd-slider-item'
                        + (s.done ? ' is-done' : isActive ? ' is-active' : ' is-locked');
                      return (
                        <div key={i} className={cls}>
                          <span className="dd-slider-no">{i + 1}</span>
                          <div
                            ref={(el) => { trackRefs.current[i] = el; }}
                            className="dd-slider-track"
                            onPointerDown={onSlideDown(i)}
                            title={s.done ? '已通过' : isActive ? '按住并拖到竖线处' : '请先完成上一个滑块'}
                          >
                            <span className="dd-slider-target" style={{ left: s.target + '%' }} />
                            <span className="dd-slider-knob" style={{ left: s.value + '%' }} />
                          </div>
                          <span className="dd-slider-state">
                            {s.done
                              ? <Icon name="check" size={13} />
                              : isActive
                                ? (s.target > s.value ? <Icon name="arrowRight" size={13} /> : <Icon name="arrowLeft" size={13} />)
                                : '待'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ---- 第 3 关：最后确认 ---- */}
              {delStep === 3 && (
                <div>
                  {/* v0.4.5：先查"这个工程还开着吗"—— 开着就不让删，否则删完 Ctrl+S 会把它写回来 */}
                  {openTabForTarget ? (
                    <div className="dd-session-warn">
                      <div className="dd-session-warn-head">
                        <Icon name="warning" size={14} /> 这个项目还开在编辑器里
                      </div>
                      <div className="dd-session-warn-body">
                        标签页 <b>「{openTabForTarget.name}」</b> 正在编辑这个工程。
                        如果现在直接删除，那个会话里再按一次 <b>Ctrl + S</b> 就会把文件重新写回来 ——
                        看起来像"删了又出现"。
                        <br />
                        所以这里要先把它关掉。点下面的按钮会<b>直接关闭这个会话</b>（不弹保存提示），
                        不想关就点「取消」，本次删除不会执行。
                      </div>
                      <button className="dd-session-warn-btn" onClick={closeTabForTarget}>
                        <Icon name="close" size={12} /> 关闭这个会话，然后继续删除
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="dd-final-warn">
                        第 3 关 · 最后确认：点击下方按钮后，项目 <b>「{deleteTarget.name}」</b> 会被<b>立即永久删除</b>，
                        且该项目名下<b>所有历史快照 / 自动备份</b>会一并清理，<b>无法撤销、无法恢复</b>。
                      </div>
                      <ul className="dd-final-list">
                        <li>工程文件：{deleteTarget.fileName}</li>
                        <li>历史快照：{deleteTarget.backupCount ?? 0} 份（将一并清理）</li>
                        <li>编辑器会话：已关闭（删除后不会被 Ctrl + S 写回来）</li>
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="dd-modal-footer">
              <button className="btn-secondary dd-cancel-btn" onClick={closeDeleteModal}>
                取消
              </button>
              {delStep === 1 && (
                <button
                  className="btn-primary"
                  disabled={!nameMatches}
                  onClick={() => setDelStep(2)}
                  title={nameMatches ? '进入第 2 关' : '请先完整输入项目全名'}
                >
                  下一步
                </button>
              )}
              {delStep === 2 && (
                <button className="btn-primary" disabled={!allSlidesDone} onClick={() => setDelStep(3)}>
                  {allSlidesDone ? '下一步' : `还剩 ${slides.filter((s) => !s.done).length} 个滑块`}
                </button>
              )}
              {delStep === 3 && (
                <button
                  className="btn-danger"
                  disabled={busy || !!openTabForTarget}
                  title={openTabForTarget ? '请先关闭上面那个编辑会话，否则删了也会被 Ctrl + S 写回来' : undefined}
                  onClick={executeDeleteProject}
                >
                  {busy ? '正在删除…' : openTabForTarget ? '先关闭编辑会话' : '我已确认，永久删除该项目'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 项目类型说明（v0.4.5 第 14 批 · 用户反馈）
// ----------------------------------------------------------------------------
// 用户原话：「项目管理里面界面上方做的优美一点。上方的『外部是什么』按钮点了没用。
//            我觉得你可以用小问号代替，然后不同的项目类型要单独标注，可以有这几种：
//            网页项目、网站项目（对应后续的多网页管理，这一轮没让你做）、
//            外部项目（不在 data/project），以及别的，所有的解释都在上方的小问号。」
//
// 所以：**上方只留一个小问号**，点开是一张说明卡（点外面/Esc 关闭），
// 里面把所有类型、颜色、存放位置、点了会发生什么讲清楚。
// ============================================================================

const KIND_META: Array<{
  id: string;
  label: string;
  cls: string;
  desc: string;
}> = [
  {
    id: 'page',
    label: '网页项目',
    cls: 'is-page',
    desc: '最常见的一种：一个工程 = 一个网页。文件存在本软件的 data/projects/ 里，点开就能编辑。'
  },
  {
    id: 'site',
    label: '网站项目',
    cls: 'is-site',
    desc: '一个工程里包含多个网页（多页管理）。这个能力还在做，等做好后这里会自动出现这种标注。'
  },
  {
    id: 'external',
    label: '外部项目',
    cls: 'is-external',
    desc:
      '文件不在 data/projects/ 里，而是你自己放在别处（桌面、U 盘、网盘目录…）的 .bcproj。\n' +
      '它是通过「导入外部项目…」或双击文件打开时才被记进这个列表的 —— 文件本体始终在你放的位置，' +
      '这里只记了一条路径。把那个文件移走或删掉，这里就会变成「文件已丢失」。'
  },
  {
    id: 'missing',
    label: '文件已丢失',
    cls: 'is-missing',
    desc:
      '登记过，但原位置的 .bcproj 已经不在了（被移动、改名或删除）。\n' +
      '点它会提示，不会打开任何东西。你可以删掉这条记录，或把文件放回原位置后刷新。'
  }
];

function ProjectKindHelp({ kinds }: { kinds: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // 点外面 / Esc 关闭（问号按钮本身不算"外面"）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // 延迟挂载：否则"打开它的那次点击"会立刻把它关掉
    const t = window.setTimeout(() => document.addEventListener('pointerdown', onDown, true), 60);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="pc-kindhelp" ref={wrapRef}>
      <button
        className={'pc-kindhelp-btn' + (open ? ' is-open' : '')}
        onClick={() => setOpen((v) => !v)}
        title="项目类型说明：网页项目 / 网站项目 / 外部项目 / 文件已丢失"
        aria-expanded={open}
      >
        <Icon name="info" size={13} />
      </button>
      {open && (
        <div className="pc-kindhelp-pop" role="dialog" aria-label="项目类型说明">
          <div className="pc-kindhelp-head">项目类型说明</div>
          {KIND_META.map((k) => (
            <div className="pc-kindhelp-row" key={k.id}>
              <span className={'pc-badge ' + k.cls}>{k.label}</span>
              <span className="pc-kindhelp-count">
                {kinds[k.id] ?? 0}
              </span>
              <span className="pc-kindhelp-desc">{k.desc}</span>
            </div>
          ))}
          <div className="pc-kindhelp-foot">
            小提示：卡片上悬停也能看到这条说明；标着「文件已丢失」的可以点垃圾桶清掉记录。
          </div>
        </div>
      )}
    </span>
  );
}
