// ============================================================================
// BlockCanvas · 程序内确认框（v0.4.4）
// ----------------------------------------------------------------------------
// 用户要求：所有的弹窗提示都改成**程序内部**的弹窗，不要再蹦系统原生 confirm()。
// 其中一部分是"高优先级"——不点选择就不能继续操作程序，所以要带黑色遮罩 + 模态
// （挡住整个窗口，Esc 可取消，点遮罩不关闭以防误触）。
//
// 用法（Promise 风格，替换原生 confirm 最省事）：
//   const ok = await appConfirm({ title: '删除', body: '确定吗？', danger: true });
//   if (!ok) return;
// 由 App 挂载的 <ConfirmHost /> 负责渲染（见 26-empty-home.css 的 .bc-confirm-*）。
// ============================================================================

export interface ConfirmOptions {
  title: string;
  body: string;
  okText?: string;
  cancelText?: string;
  /** 危险动作（删除 / 放弃修改）：确认键红色 */
  danger?: boolean;
}

type ResolveFn = (v: boolean) => void;

let seq = 0;
const listeners = new Set<(req: ConfirmOptions & { id: number }, resolve: ResolveFn) => void>();

export function appConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const id = ++seq;
    let settled = false;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    for (const l of listeners) l({ ...opts, id }, done);
    // 没有任何 Host 挂载（理论上不会发生）→ 兜底走原生，保证功能不丢
    if (listeners.size === 0 && typeof window !== 'undefined') {
      done(window.confirm(`${opts.title}\n\n${opts.body}`));
    }
  });
}

/** 给 ConfirmHost 注册回调；返回反注册函数 */
export function onConfirmRequest(l: (req: ConfirmOptions & { id: number }, resolve: ResolveFn) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * 程序内"提示框"（替代原生 alert）：只有确定键，同样走 ConfirmHost 的遮罩模态。
 * 返回 Promise<void>，方便 `await appAlert('...')` 后继续执行。
 */
export function appAlert(body: string, title = '提示'): Promise<void> {
  return appConfirm({ title, body, okText: '知道了', cancelText: '知道了' }).then(() => undefined);
}
