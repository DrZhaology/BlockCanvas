// BlockCanvas · 中键属性搜索的"请求缓冲"
//
// 场景：在画布上按住中键选中元素 → 敲属性名 → Enter。
// 此时右侧面板可能停在「图层」或「页面 / 类名 / 变量」页签，真正负责定位属性的
// ElementPropsBody 根本还没挂载 —— 直接派发事件会落空（用户反馈的"定位和创建失效"）。
//
// 做法：请求先写进这个模块级缓冲，同时通知订阅者；Inspector 顶层收到后切到「元素」页签，
// ElementPropsBody 挂载时再把缓冲里的请求取走执行。这样无论面板当时在哪一页都不会丢。

export interface PropFocusRequest {
  key: string;
  /** 是否顺便把属性加进可见列表（Ctrl+Enter / 中键搜索的值预测时 true） */
  add: boolean;
  /**
   * 可选的"顺便写入的值"（v0.4.5：中键搜索的属性值预测）。
   * 裸数字会按 schema.unit 自动补单位（见 propertySchema.presetValue）。
   */
  value?: string;
}

let pending: PropFocusRequest | null = null;
const subscribers = new Set<(req: PropFocusRequest) => void>();

export function requestPropFocus(req: PropFocusRequest): void {
  pending = req;
  for (const fn of subscribers) {
    try { fn(req); } catch { /* 单个订阅者出错不影响其它人 */ }
  }
}

/** 取走并清空缓冲（ElementPropsBody 执行定位时调用） */
export function takePendingPropFocus(): PropFocusRequest | null {
  const p = pending;
  pending = null;
  return p;
}

/** 只看不取（Inspector 顶层判断"要不要切到元素页签"） */
export function peekPendingPropFocus(): PropFocusRequest | null {
  return pending;
}

export function subscribePropFocus(fn: (req: PropFocusRequest) => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}
