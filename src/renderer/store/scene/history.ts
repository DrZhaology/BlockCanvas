// BlockCanvas · 撤销 / 重做历史栈（R6-5）
//
// 这个文件很小，但它决定了"一条 Ctrl+Z 撤多少" —— 项目里最容易出体感问题的地方。
//
// 三条必须保留的语义：
//   1. **压栈就清空 future**：用户做了新操作之后，redo 链必须失效，
//      否则"撤销几步再做一个新操作"会让重做栈里留着已经不适用的快照，点重做就跳乱。
//   2. **栈有上限**：每一步存的是整棵场景树的快照，不封顶会吃光内存。
//      （历史值是 200，这里原样保留 —— 降到 80 会改变用户体验，不属于重构范围。）
//   3. **连续编辑只压一次**：靠调用方的 styleEditPending 标记配合 ——
//      beginStyleEdit 压检查点，中间提交不再压，endStyleEdit 收尾。
import type { SceneGraph } from '@lib/types';

/** 撤销栈上限：每步是整树快照，太多会吃光内存 */
export const HISTORY_LIMIT = 200;

/** 历史栈形状（store 与各模块共用这一份声明） */
export interface History {
  past: SceneGraph[];
  future: SceneGraph[];
}

/**
 * 压入一步历史（并把 future 清空）。
 *
 * @param h 当前历史
 * @param snapshot 操作**之前**的场景快照（撤销时恢复到它）
 */
export function pushPast(h: History, snapshot: SceneGraph): History {
  const past = [...h.past, snapshot];
  if (past.length > HISTORY_LIMIT) past.shift();
  // 压栈即清空 redo 链：新操作之后，旧的"未来"已经不适用了
  return { past, future: [] };
}
