import { useRef, useState } from 'react';
import { useTasks, pickHeadTask } from '@store/taskStore';
import { isActive, RESUMABLE_STATUS, STATUS_LABEL, fmtMB, type BgTask } from '@lib/taskTypes';
import { useHoverPop } from '@lib/hoverPop';
import { AnchoredPanel } from './AnchoredPanel';

// BlockCanvas · 工具栏「任务」按钮（v0.4.4）
// ----------------------------------------------------------------------------
// 位置：工具栏右区，「⋯ 更多」的**左边**（常驻，不参与按钮池拖拽）。
// 作用：把「下载 / 更新」这类后台任务从页面里解放出来 ——
//   · 鼠标浮上去就展开任务面板（当前任务、进度、大小、镜像）；
//   · 面板里可以直接 停止 / 继续 / 取消 / 打开文件夹；
//   · 因为任务状态在主进程里，**离开更新页、切视图、甚至重启软件都还在**。
// 以前这些进度存在更新页组件的 useState 里，一离开页面就没了 —— 用户反馈的正是这一点。
// 悬停节奏统一走 lib/hoverPop（全程序一致：500ms 弹出 / 300ms 收起）。

/** 环形进度（纯 CSS conic-gradient，不引入任何图表依赖） */
function Ring({ pct, status }: { pct: number; status: BgTask['status'] }) {
  const p = Math.max(0, Math.min(100, pct));
  const done = status === 'done';
  const err = status === 'error';
  return (
    <span
      className={'tb-task-ring' + (done ? ' is-done' : err ? ' is-err' : '')}
      style={{ ['--p' as any]: `${p}%` }}
      aria-hidden="true"
    >
      <span className="tb-task-ring-in">{done ? '✓' : err ? '!' : `${Math.round(p)}`}</span>
    </span>
  );
}

export function TaskButton() {
  const tasks = useTasks((s) => s.tasks);
  const { open, setOpen, scheduleOpen, scheduleClose, cancel, toggle } = useHoverPop();
  const btnRef = useRef<HTMLButtonElement>(null);

  const head = pickHeadTask(tasks);
  const running = tasks.filter(isActive).length;
  const resumable = tasks.filter((t) => RESUMABLE_STATUS.includes(t.status) && t.status !== 'error').length;
  const failed = tasks.filter((t) => t.status === 'error').length;

  // 有任务在跑 → 一直显示环形进度；否则只在"有可继续/失败"时给一个提示点
  const showRing = Boolean(head && (isActive(head) || head.status === 'done' || head.status === 'error'));
  const badge = !running && (resumable + failed) > 0
    ? <span className="tb-task-dot" title={`${resumable + failed} 条未完成的任务`} />
    : null;

  const title = !head
    ? '任务：当前没有进行中的下载或更新'
    : `${head.title}\n${head.detail}\n（鼠标浮上来管理任务）`;

  return (
    <div className="tb-task-wrap">
      <button
        ref={btnRef}
        className={'tb-task-btn' + (running > 0 ? ' is-running' : '') + (open ? ' open' : '')}
        title={title}
        onClick={toggle}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
      >
        {showRing && head
          ? <Ring pct={head.status === 'done' ? 100 : head.pct} status={head.status} />
          : <span className="tb-task-ico">{running > 0 ? '⏳' : '🗂'}</span>}
        {badge}
      </button>

      <AnchoredPanel
        open={open}
        anchorRef={btnRef}
        onClose={() => setOpen(false)}
        className="tb-task-panel"
        align="right"
        onMouseEnter={cancel}
        onMouseLeave={scheduleClose}
      >
        <div className="tb-task-pop">
          <div className="tb-task-pop-head">
            <span className="tb-task-pop-title">任务</span>
            <span className="tb-task-pop-sub">
              {tasks.length === 0
                ? '暂无任务'
                : `${running > 0 ? `${running} 个进行中 · ` : ''}共 ${tasks.length} 条`}
            </span>
          </div>
          {tasks.length === 0 && (
            <div className="tb-task-empty">
              还没有下载或更新任务。<br />
              在「更新中心」里点「下载 zip / 更新到这一版」，进度就会出现在这里 ——
              <b>离开这一页也不会中断</b>。
            </div>
          )}
          <div className="tb-task-list bc-hscroll">
            {tasks.slice(0, 8).map((t) => <TaskRow key={t.id} task={t} />)}
          </div>
          {tasks.length > 8 && <div className="tb-task-more">…… 还有 {tasks.length - 8} 条更早的任务</div>}
        </div>
      </AnchoredPanel>
    </div>
  );
}

function TaskRow({ task }: { task: BgTask }) {
  const [busy, setBusy] = useState(false);
  const pct = Math.max(0, Math.min(100, task.pct));
  const canPause = task.status === 'running' && task.kind === 'download';
  const canResume = RESUMABLE_STATUS.includes(task.status);
  const canCancel = task.status === 'running' || task.status === 'paused' || task.status === 'interrupted';
  const canReveal = task.status === 'done';
  const canDismiss = task.status === 'done' || task.status === 'error' || task.status === 'canceled';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div className={'tb-task-row is-' + task.status}>
      <div className="tb-task-row-top">
        <span className="tb-task-name" title={task.title}>{task.title}</span>
        <span className={'tb-task-state st-' + task.status}>{STATUS_LABEL[task.status]}</span>
      </div>
      <div className="tb-task-detail" title={task.detail}>{task.detail}</div>
      {(task.status === 'running' || task.status === 'paused' || task.status === 'interrupted' || task.status === 'applying') && (
        <div className="tb-task-bar">
          <div className="tb-task-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      {task.total > 0 && (
        <div className="tb-task-size">
          {fmtMB(task.received)} / {fmtMB(task.total)}
          {task.mirror ? ` · 经由 ${task.mirror}` : ''}
        </div>
      )}
      <div className="tb-task-acts">
        {canPause && (
          <button className="btn-mini" disabled={busy}
            onClick={() => void run(() => window.bc.pauseTask(task.id))}
            title="停止下载：已经下好的部分会保留，随时可以继续">停止</button>
        )}
        {canResume && (
          <button className="btn-mini btn-primary" disabled={busy}
            onClick={() => void run(() => window.bc.resumeTask(task.id))}
            title="从已下载的部分接着下（断点续传），不会重头再来">继续</button>
        )}
        {canCancel && (
          <button className="btn-mini" disabled={busy}
            onClick={() => void run(() => window.bc.cancelTask(task.id))}
            title="取消并删除已下载的部分">取消</button>
        )}
        {canReveal && (
          <button className="btn-mini" disabled={busy}
            onClick={() => void run(() => window.bc.revealTask(task.id))}
            title="在文件管理器里打开这个 zip 所在的文件夹">打开文件夹</button>
        )}
        {canDismiss && (
          <button className="btn-mini" disabled={busy}
            onClick={() => void run(() => window.bc.dismissTask(task.id))}
            title="只从任务列表里移除这条记录（磁盘文件不动）">移除</button>
        )}
        {task.status === 'applying' && <span className="tb-task-applying">替换程序时请不要关闭软件…</span>}
      </div>
    </div>
  );
}

/** 供更新中心复用的纯展示条（同一个任务在页面里也要能看到进度） */
export function InlineTaskStrip({ task }: { task: BgTask }) {
  const pct = Math.max(0, Math.min(100, task.pct));
  const failed = task.status === 'error';
  return (
    <div className={'update-dl-strip' + (failed ? ' is-error' : '')}>
      <div className="update-dl-head">
        <span className="update-dl-msg">{task.detail}</span>
        {!failed && <span className="update-dl-pct">{Math.round(pct)}%</span>}
      </div>
      {!failed && (
        <div className="update-dl-bar">
          <div className="update-dl-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="update-dl-actions">
        {task.status === 'running' && task.kind === 'download' && (
          <button className="btn-mini" onClick={() => void window.bc.pauseTask(task.id)}>停止</button>
        )}
        {RESUMABLE_STATUS.includes(task.status) && (
          <button className="btn-mini btn-primary" onClick={() => void window.bc.resumeTask(task.id)}>继续</button>
        )}
        {(task.status === 'running' || task.status === 'paused' || task.status === 'interrupted') && (
          <button className="btn-mini" onClick={() => void window.bc.cancelTask(task.id)}>取消</button>
        )}
        <span className="update-dl-hint">下载不替换程序、也不影响编辑，你可以继续做别的事情。</span>
      </div>
    </div>
  );
}
