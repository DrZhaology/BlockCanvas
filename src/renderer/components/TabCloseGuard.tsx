// ============================================================================
// BlockCanvas · v0.4.6 关闭标签的「保存 / 不保存 / 取消」确认
// ----------------------------------------------------------------------------
// 用户原话：
//   「现在多标签页的页面关闭都没有保存不保存的提示。」
//
// 以前 `tabStore.closeTab` 无条件关，右下角那个未保存圆点只是装饰 ——
// 关掉就等于默默丢掉一整段编辑。这里补一条统一的关闭闸门。
//
// 设计取舍（写清楚免得下次改坏）：
//   · 用**事件总线**而不是 hook 逐层传：关闭入口分散在顶部标签条、会话管理页，
//     还有将来别的页面；让它们都只发一个 `bc:request-close-tab` 就够了。
//   · 「保存」走的是**现有保存通道**（menu:save-project / menu:save-project-as），
//     不自己造一套写文件的路径 —— 那会绕开路径校验、覆盖提示、最近项目列表。
//   · 保存是异步的（主进程写盘 + 更新最近项目），所以保存后**轮询 isDirty**，
//     清掉才关；2 秒还没清就当失败，把弹窗留住让人自己决定，不悄悄关。
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { useTabStore } from '@store/tabStore';

type Pending = { id: string; name: string; hasFile: boolean; dirty: boolean };

/** 任何组件调用它就能"请求关闭某个标签"（脏标签会弹确认） */
export function requestTabClose(id: string): void {
  window.dispatchEvent(new CustomEvent('bc:request-close-tab', { detail: { id } }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function TabCloseGuard() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    const onReq = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      const st = useTabStore.getState();
      const tab = st.tabs.find((t) => t.id === id);
      if (!tab) return;
      // 干净的标签不用问，直接关（关掉不丢东西）
      if (!tab.isDirty) { st.closeTab(id); return; }
      setPending({ id, name: tab.name, hasFile: Boolean(tab.filePath), dirty: true });
    };
    window.addEventListener('bc:request-close-tab', onReq);
    return () => window.removeEventListener('bc:request-close-tab', onReq);
  }, []);

  if (!pending) return null;

  const closeNow = () => {
    useTabStore.getState().closeTab(pending.id);
    setPending(null);
  };

  const saveThenClose = async () => {
    const st = useTabStore.getState();
    // 保存通道只作用于**当前活动标签**，所以先切过去（切过去不丢任何东西）
    if (st.activeTabId !== pending.id) st.switchTab(pending.id);
    await sleep(120);
    window.dispatchEvent(new CustomEvent(pending.hasFile ? 'menu:save-project' : 'menu:save-project-as'));
    setBusy(true);
    // 轮询到"不再脏"为止：保存是异步的（写盘 + 更新最近项目）
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      const t = useTabStore.getState().tabs.find((x) => x.id === pending.id);
      if (!t) { setBusy(false); setPending(null); return; }
      if (!t.isDirty) { useTabStore.getState().closeTab(pending.id); setBusy(false); setPending(null); return; }
    }
    setBusy(false);
  };

  return (
    <div className="bc-confirm-scrim" role="dialog" aria-modal="true" aria-label="关闭标签确认">
      <div className="bc-confirm">
        <div className="bc-confirm-title">「{pending.name}」有未保存的修改</div>
        <div className="bc-confirm-body">关掉之后就找不回来了。</div>
        <div className="bc-confirm-actions">
          <button className="bc-confirm-btn is-primary" disabled={busy} onClick={() => void saveThenClose()}>
            {busy ? '保存中…' : '保存并关闭'}
          </button>
          <button className="bc-confirm-btn is-danger" disabled={busy} onClick={closeNow}>不保存</button>
          <button className="bc-confirm-btn" disabled={busy} onClick={() => setPending(null)}>取消</button>
        </div>
      </div>
    </div>
  );
}
