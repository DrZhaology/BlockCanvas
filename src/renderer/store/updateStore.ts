import { create } from 'zustand';

// BlockCanvas · 更新进行中状态（v0.4.3）
// 更新一旦开始（下载 / 解压 / 替换 / 重启），必须**锁死编辑器**：
//   · App 的 switchView 会拒绝一切视图切换；
//   · 页面上盖一层全屏遮罩（进度条 + 提示），拦截所有鼠标事件；
//   · 更新中心自己的「返回编辑器」也会禁用。
// 这样即使更新过程中出现异常，用户也不会在半途改动工程数据。

interface UpdateBusyState {
  busy: boolean;
  message: string;
  pct: number;
  start: (msg?: string) => void;
  progress: (msg: string, pct?: number) => void;
  finish: () => void;
}

export const useUpdateBusy = create<UpdateBusyState>((set) => ({
  busy: false,
  message: '',
  pct: 0,
  start: (msg = '正在准备更新…') => set({ busy: true, message: msg, pct: 0 }),
  // ⚠ 这里**不能**把 busy 置真：进度通道是和「下载 zip」共用的（update:progress），
  //    而下载 zip 不替换程序、也不该锁编辑器。以前一行 `busy: true` 的副作用是：
  //    只要点了历史版本的「下载 zip」，全屏遮罩就会弹出来并**永远卡在最后那一帧**
  //   （没有任何 finish() 调用）。busy 只由 start() 开启、finish() 结束。
  progress: (msg, pct) => set((st) => ({ message: msg, pct: pct ?? st.pct })),
  finish: () => set({ busy: false, message: '', pct: 0 })
}));
