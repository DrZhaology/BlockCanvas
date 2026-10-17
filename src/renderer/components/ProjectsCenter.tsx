import { useState, useEffect, useRef } from 'react';
import { useTabStore } from '@store/tabStore';
import { useClosing } from '@lib/useClosing';
import type { ProjectFileInfo } from '../global';

// BlockCanvas · 本地全部项目库中心 (ProjectsCenter)
// 遵循《设计语言规范》：
// - 卡片式浏览 data/projects/ 下所有 .bcproj 工程文件
// - 点击项目直接载入为新标签页 (可多工程并存)
// - 点击「⏱️ 快照」滑出专属抽屉，按项目隔离查看历史回退版本
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
        newTab(p.name, res.project.scene, p.filePath);
        showToast(`已在新标签页打开「${p.name}」`);
      }
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
      const norm = (x: string) => String(x || '').replace(/[\\/]+/g, '/').toLowerCase();
      const st = useTabStore.getState();
      const existing = st.tabs.find((t) => t.filePath && norm(t.filePath) === norm(res.path || ''));
      if (existing) {
        st.switchTab(existing.id);
        showToast(`「${existing.name}」已经打开着，已为你切换过去`);
      } else {
        newTab(pName, res.project.scene, res.path);
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

  // 4. 执行删除（第 3 关确认后）
  const executeDeleteProject = async () => {
    if (!deleteTarget || busy) return;
    if (deleteConfirmInput.trim() !== deleteTarget.name.trim()) return;
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

  // 6. 恢复某份专属快照
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

  const nameMatches = !!deleteTarget && deleteConfirmInput.trim() === deleteTarget.name.trim();

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
                    onClick={(e) => openDeleteModal(e, p)}
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
        <div className={'pc-drawer-mask' + (drawerClosing ? ' is-closing' : '')} onClick={closeDrawer}>
          <div className="pc-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="pc-drawer-header">
              <div className="pc-drawer-title">
                <span>⏱️「{selectedProjectForBackups.name}」的专属快照</span>
              </div>
              <button className="cp-close" onClick={closeDrawer}>×</button>
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

      {/* ============ 三步删除防护 ============ */}
      {deleteTarget && delMounted && (
        <div className={'modal-mask dd-mask-static' + (delClosing ? ' is-closing' : '')}>
          <div className={'double-delete-modal' + (delClosing ? ' is-closing' : '')} onClick={(e) => e.stopPropagation()}>
            <div className="dd-modal-header">
              <span className="dd-modal-title">⚠️ 删除项目确认（三步安全防护）</span>
              <button className="cp-close" onClick={closeDeleteModal} title="取消并关闭">×</button>
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
                            {s.done ? '✓' : isActive ? (s.target > s.value ? '→' : '←') : '待'}
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
                  <div className="dd-final-warn">
                    第 3 关 · 最后确认：点击下方按钮后，项目 <b>「{deleteTarget.name}」</b> 会被<b>立即永久删除</b>，
                    且该项目名下<b>所有历史快照 / 自动备份</b>会一并清理，<b>无法撤销、无法恢复</b>。
                  </div>
                  <ul className="dd-final-list">
                    <li>工程文件：{deleteTarget.fileName}</li>
                    <li>历史快照：{deleteTarget.backupCount ?? 0} 份（将一并清理）</li>
                  </ul>
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
                  disabled={busy}
                  onClick={executeDeleteProject}
                >
                  {busy ? '正在删除…' : '我已确认，永久删除该项目'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
