// ============================================================================
// BlockCanvas · CSS 域索引（v0.4.6 / R6-3）
// ----------------------------------------------------------------------------
// 问题：样式分片是按「哪一批加的」命名的（13-polish-v040 / 23-v044d-ui / 27-v045-ui…），
// 不是按「管什么」命名的。后果 v0.4.5 真实发生过：同一条「中键搜索」样式散在
// 23 / 24 / 27 / 28 四个文件里，改完 28 忘了 27 还留着旧的蓝色竖线。
//
// 本版的做法（务实版，不做一次性大搬迁）：
//   1. **给每个分片declare一个主域**（下面的 DOMAIN_OF）—— 从此"这个文件归谁管"是明确答案，
//      新加规则时先看它该进哪个域，而不是"随手追加到最新的那一片"。
//   2. **按域定义「选择器前缀白名单」**（DOMAIN_PREFIXES）—— 让 probe-css-domains 能自动检查
//      "某个域的选择器跑到了别的域的文件里"。
//   3. **同一选择器出现在多个文件 = 冲突** —— 探针直接报出来，不用人眼翻 1.5 万行。
//
// 为什么不在这一版做大搬迁：34 个文件 1.5 万行，一次搬完无法保证"视觉零变化"，
// 而本轮的验收底线是"52 个探针全绿"。搬迁留到有足够验收预算时做（见文档 R6-3 后续）。
// ============================================================================

/**
 * 每个分片的主域。
 *
 * 域的划分标准是「**谁在用它**」，不是"它长什么样"：
 *   theme       设计 token（颜色/间距/圆角/动效曲线），全程序共用
 *   shell       外壳骨架（app 布局、页签栏、面板框架、分隔条）
 *   canvas      画布本身（工作区、画布、选择框、Alt 覆盖层）
 *   inspector   属性面板（含各类输入控件、快捷助手）
 *   element     元素面板 / 模板 / 类名管理
 *   table       表格编辑器与表格相关 UI
 *   overlay     浮层与提示（toast、菜单、Portal 面板、帮助气泡）
 *   empty-home  空首页
 *   projects    项目中心
 *   settings    设置页
 *   help        帮助中心
 */
export const DOMAIN_OF = {
  '00-theme-tokens.css': 'theme',
  '01-foundation.css': 'shell',
  '02-tabbar.css': 'shell',
  '03-toolbar.css': 'shell',
  '04-workspace-canvas.css': 'canvas',
  '05-inspector-core.css': 'inspector',
  '06-element-panel.css': 'element',
  '07-panels-bottom.css': 'inspector',
  '08-inspector-props.css': 'inspector',
  '09-class-template-ext.css': 'element',
  '10-settings-projects.css': 'settings',
  '11-editors.css': 'inspector',
  '12-toolbar-v041.css': 'shell',
  '13-polish-v040.css': 'shell',
  '14-v04x-append.css': 'canvas',
  '15-v042-ui.css': 'shell',
  '16-v042b-ui.css': 'shell',
  '17-v043-table.css': 'table',
  '18-v044-table-ui.css': 'table',
  '19-v043-ui.css': 'inspector',
  '20-v044-ui.css': 'canvas',
  '21-v044b-ui.css': 'inspector',
  '22-v044c-ui.css': 'inspector',
  '23-v044d-ui.css': 'canvas',
  '24-v044h-ui.css': 'canvas',
  '25-v044-storage-ui.css': 'settings',
  '26-empty-home.css': 'empty-home',
  '27-v045-ui.css': 'inspector',
  '28-v045-zindex.css': 'overlay',
  '29-v045-perf.css': 'shell',
  '30-v046-viewport.css': 'canvas',
  '31-v046-sticky.css': 'canvas',
  '32-v046-codec.css': 'canvas',
  '33-v046-shell.css': 'shell',
  // v0.4.6：全程序级视觉基线（连续曲率圆角 / 圆角尺度 / 自绘标题栏 / 窗口描边）
  '34-v046-visual.css': 'theme'
} as const;

export type CssDomain = typeof DOMAIN_OF[keyof typeof DOMAIN_OF];

/**
 * 各域的「选择器前缀白名单」。
 *
 * 用法：探针扫描每个分片里的顶层选择器，若某个选择器命中了**别的域**的前缀，
 * 就报"这个规则可能放错文件了"。前缀用 `startsWith` 匹配，空的字符串表示"该域不设限"。
 *
 * ⚠ 这份表是**渐进式**的：随着搬迁逐步收紧。现在先只登记"最有辨识度的前缀"，
 * 避免一上来就红一片没人看。
 */
export const DOMAIN_PREFIXES: Record<string, string[]> = {
  /**
   * 空首页：类名一律 eh- 开头（EmptyHome.tsx 里全部如此）。
   *
   * ⚠ 例外：**性能类规则**（will-change / transition / animation）会把多域选择器
   * 写进同一个逗号组（29-v045-perf.css 里 .pc-card, .token-row, .eh-saved-item { … }），
   * 那是刻意的分组优化，不是「放错域」。所以前缀检查跳过「同组里混着别的域」的规则 ——
   * 探针里的判定条件是 every(sel => startsWith(prefix)) 的规则才报。
   */
  'empty-home': ['.eh-'],
  // 表格：tbl- / table- 前缀（表格编辑器与 per-cell 样式）
  table: ['.tbl-', '.table-', '[data-cell'],
  // 帮助中心
  help: ['.help-'],
  // 项目中心
  projects: ['.projects-', '.pc-'],
  // 设置页（Fluent 风格）
  settings: ['.fluent-']
};

/** 给出每个域包含哪些分片（给工具与探针用） */
export function shardsOfDomain(domain: string): string[] {
  return Object.entries(DOMAIN_OF).filter(([, d]) => d === domain).map(([f]) => f);
}
