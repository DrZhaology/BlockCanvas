import { create } from 'zustand';
import type { BgTask } from '@lib/taskTypes';

// BlockCanvas · 后台任务订阅（渲染层的只读镜像）
// ----------------------------------------------------------------------------
// 主进程持有任务的唯一真相（`data/tasks.json` + 内存里的运行句柄），
// 渲染层通过 `task:changed` 广播拿到一份列表快照 —— 所以：
//   · 离开更新页、切到别的视图、甚至重启软件，任务都还在；
//   · 工具栏「任务」按钮和更新中心页面读的是**同一份**数据，天生一致。

interface TaskState {
  tasks: BgTask[];
  /** 是否已经从主进程拉过一次（避免首帧把"还没读到"当成"没有任务"） */
  ready: boolean;
  setTasks: (t: BgTask[]) => void;
  refresh: () => Promise<void>;
}

export const useTasks = create<TaskState>((set) => ({
  tasks: [],
  ready: false,
  setTasks: (t) => set({ tasks: Array.isArray(t) ? t : [], ready: true }),
  refresh: async () => {
    try {
      const list = (await window.bc.listTasks()) as unknown as BgTask[];
      set({ tasks: Array.isArray(list) ? list : [], ready: true });
    } catch {
      set({ ready: true });
    }
  }
}));

/** 订阅广播 + 首次拉取（App 挂载时调一次；返回取消函数） */
export function subscribeTasks(): () => void {
  void useTasks.getState().refresh();
  const off = window.bc.onTasksChanged((list) => {
    useTasks.getState().setTasks((list as BgTask[]) ?? []);
  });
  return off;
}

/** 当前"最值得显示在工具栏"的那一条：优先跑着的，其次可继续的，最后最近完成的 */
export function pickHeadTask(tasks: BgTask[]): BgTask | null {
  if (tasks.length === 0) return null;
  const running = tasks.find((t) => t.status === 'running' || t.status === 'applying');
  if (running) return running;
  const resumable = tasks.find((t) => t.status === 'paused' || t.status === 'interrupted' || t.status === 'error');
  if (resumable) return resumable;
  return tasks[0];
}
