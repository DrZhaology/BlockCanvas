// ============================================================================
// BlockCanvas · v0.4.6 关闭标签的「保存 / 不保存 / 取消」确认
// ----------------------------------------------------------------------------
// 用户原话：
//   「现在多标签页的页面关闭都没有保存不保存的提示。」
//   「在多项目管理的标签页里面，你为什么点击了那个叉叉，这个项目好像先退出去，
//     又突然弹出来一个全屏的弹窗显示要不要保存，你应该就在这个地方做一个二级菜单
//     显示要不要保存，你这样的交互设计非常奇怪。」
//
// 于是有了这一版的两个形态：
//   · 调用方给了**锚点**（会话管理页那个 ×）→ 就在 × 旁边弹出一个小二级菜单；
//   · 没给锚点（顶部标签条那种一长条）→ 退回居中小卡片。
// 两条路径共用同一份状态机，只是壳子不同。
//
// 其他设计取舍（写清楚免得下次改坏）：
//   · 用**事件总线**而不是 hook 逐层传：关闭入口分散在顶部标签条、会话管理页，
//     还有将来别的页面；让它们都只发一个 `bc:request-close-tab` 就够了。
//   · 「保存」走的是**现有保存通道**（menu:save-project / menu:save-project-as），
//     不自己造一套写文件的路径 —— 那会绕开路径校验、覆盖提示、最近项目列表。
//   · 保存是异步的（主进程写盘 + 更新最近项目），所以保存后**轮询 isDirty**，
//     清掉才关；2 秒还没清就当失败，把菜单留住让人自己决定，不悄悄关。
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { useTabStore } from '@store/tabStore';

type Anchor = { x: number; y: number; w: number; h: number };
type Pending = { id: string; name: string; hasFile: boolean; anchor?: Anchor };

/** 任何组件调用它就能"请求关闭某个标签"（脏标签会弹确认） */
export function requestTabClose(id: string, anchor?: Anchor): void {
  window.dispatchEvent(new CustomEvent('bc:request-close-tab', { detail: { id, anchor } }));
}

/** 这个标签有没有未保存的修改（调用方想自己决定交互时先问一句） */
export function isTabDirty(id: string): boolean {
  return Boolean(useTabStore.getState().tabs.find((t) => t.id === id)?.isDirty);
}

/**
 * 「保存并关闭」这条路**不自己写盘**：切到那个标签 → 走现有保存通道
 * （menu:save-project / menu:save-project-as，保留路径校验/覆盖提示/最近项目）
 * → 轮询 isDirty，清掉才关。返回 true 表示已经关掉了。
 *
 * 抽成独立函数是因为会话管理页要把确认面板画在**卡片内部**（用户：
 * "关闭会话的保存提示放到会话卡片的下面"），不能再用那个全局浮层。
 */
export async function saveTabThenClose(id: string): Promise<boolean> {
  const st = useTabStore.getState();
  const tab = st.tabs.find((t) => t.id === id);
  if (!tab) return true;
  const hasFile = Boolean(tab.filePath);
  // 保存通道只作用于**当前活动标签**，所以先切过去（切过去不丢任何东西）
  if (st.activeTabId !== id) st.switchTab(id);
  await sleep(120);
  window.dispatchEvent(new CustomEvent(hasFile ? 'menu:save-project' : 'menu:save-project-as'));
  // 轮询到"不再脏"为止：保存是异步的（写盘 + 更新最近项目）
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    const t = useTabStore.getState().tabs.find((x) => x.id === id);
    if (!t) return true;
    if (!t.isDirty) { useTabStore.getState().closeTab(id); return true; }
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 二级菜单大概尺寸（只用于贴边翻转，不必精确） */
const MENU_W = 196;
const MENU_H = 3 * 46 + 16;

export function TabCloseGuard() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    const onReq = (e: Event) => {
      const d = (e as CustomEvent<{ id?: string; anchor?: Anchor }>).detail;
      const id = d?.id;
      if (!id) return;
      const st = useTabStore.getState();
      const tab = st.tabs.find((t) => t.id === id);
      if (!tab) return;
      // 干净的标签不用问，直接关（关掉不丢东西）——**空页面也算干净**：
      // 一个还没放任何元素的标签（新建的、或者画了又全删掉的），问它"要不要保存"
      // 只是噪音。用户抱怨过弹窗打扰，这条短路是故意的。
      const empty = !(tab.scene?.root?.children?.length);
      if (!tab.isDirty || empty) { st.closeTab(id); return; }
      setPending({ id, name: tab.name, hasFile: Boolean(tab.filePath), anchor: d.anchor });
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
    setBusy(true);
    const done = await saveTabThenClose(pending.id);
    setBusy(false);
    if (done) setPending(null);
  };

  const actions = (
    <>
      <button className="bc-confirm-btn is-primary" disabled={busy} onClick={() => void saveThenClose()}>
        {busy ? '保存中…' : '保存并关闭'}
      </button>
      <button className="bc-confirm-btn is-danger" disabled={busy} onClick={closeNow}>不保存</button>
      <button className="bc-confirm-btn" disabled={busy} onClick={() => setPending(null)}>取消</button>
    </>
  );

  // ① 有锚点：贴着 × 弹出的小二级菜单（会话管理页走这条）
  if (pending.anchor) {
    const a = pending.anchor;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(8, a.x + a.w - MENU_W), Math.max(8, vw - MENU_W - 8));
    const above = a.y - 8 - MENU_H;
    const top = Math.min(Math.max(8, above >= 8 ? above : a.y + a.h + 8), Math.max(8, vh - MENU_H - 8));
    return (
      <>
        {/* 透明遮罩：点旁边 = 取消（不抢键盘、不改主题） */}
        <div className="bc-pop-scrim" onClick={() => setPending(null)} />
        <div
          className="bc-pop bc-confirm-pop"
          role="menu"
          aria-label="关闭标签确认"
          style={{ left, top, width: MENU_W }}
        >
          <div className="bc-confirm-pop-title">「{pending.name}」有未保存的修改</div>
          <div className="bc-confirm-actions">{actions}</div>
        </div>
      </>
    );
  }

  // ② 没锚点：居中小卡片（顶部标签条走这条）
  return (
    <div className="bc-confirm-scrim" role="dialog" aria-modal="true" aria-label="关闭标签确认">
      <div className="bc-confirm">
        <div className="bc-confirm-title">「{pending.name}」有未保存的修改</div>
        <div className="bc-confirm-body">关掉之后就找不回来了。</div>
        <div className="bc-confirm-actions">{actions}</div>
      </div>
    </div>
  );
}

export default TabCloseGuard;
