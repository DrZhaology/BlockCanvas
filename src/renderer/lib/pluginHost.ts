import { useToolbar, type ToolbarItem } from '@store/toolbarStore';
import type { PropertySchema } from '@lib/propertySchema';
import { parseManifestPermissions, applyPermissionGate, type PluginPermission } from '@lib/pluginPermissions';

// BlockCanvas · 插件执行宿主
// 原则：插件兼容程序，不是程序兼容插件。
//   - 程序只提供一个稳定的 Bc 宿主对象，插件自己决定行为；
//   - 插件 main 文件是一个立即执行函数 `(function (Bc) { ... })(Bc)`，
//     通过 Bc.onStart / Bc.onStop 接入；
//   - 入口文件以源码字符串下发，渲染进程用 new Function 求值（CSP 已开 unsafe-eval），
//     不改动象素级 DOM 结构，也不注入任何全局变量（每个插件拿到独立的 Bc）。
//
// 插件可注册的能力（v0.4.6 起**必须先在 manifest 里声明**，见 lib/pluginPermissions）：
//   - element    → Bc.registerElement：在元素面板新增按钮（type + label + help）
//   - property   → Bc.registerProperty：在属性面板新增 CSS 属性 schema 项
//   - export     → Bc.registerExportHook：导出 HTML 前后钩子（可修改 HTML 字符串）
//   - command    → Bc.registerCommand：注册工具栏命令（一律收进「⋯更多」）
//   - css        → Bc.registerCss：注入自定义 CSS
//   - hostApi    → Bc.api：透传 window.bc（高危，默认不给）
//
// 安全边界（诚实说明，别当成沙箱）：
//   插件仍与宿主**同上下文**（new Function），所以能触达 window 上的东西。
//   这里做的是"少给参数"：未声明的方法在 Bc 上**根本不存在**，
//   误用会当场 TypeError，而不是静默改坏工程。真隔离（iframe/Worker）留到后面。

interface PluginBindings {
  start?: () => void;
  stop?: () => void;
}

interface ActivePlugin {
  id: string;
  stop?: () => void;
}

let active: ActivePlugin[] = [];

// 全局注册表：插件贡献的内容
const pluginElements: Array<{ type: string; label: string; help: { tag: string; what: string; where: string } }> = [];
const pluginProperties: PropertySchema[] = [];
const exportHooks: Array<{ pre?: (html: string) => string; post?: (html: string) => string }> = [];

/** 导出前钩子：按注册顺序依次执行，可修改 HTML */
export function applyExportPreHooks(html: string): string {
  let result = html;
  for (const hook of exportHooks) {
    if (hook.pre) result = hook.pre(result);
  }
  return result;
}

/** 导出后钩子：按注册顺序依次执行，可修改 HTML */
export function applyExportPostHooks(html: string): string {
  let result = html;
  for (const hook of exportHooks) {
    if (hook.post) result = hook.post(result);
  }
  return result;
}

/** 获取插件注册的元素定义 */
export function getPluginElements() {
  return pluginElements;
}

/** 获取插件注册的属性 schema */
export function getPluginProperties(): PropertySchema[] {
  return pluginProperties;
}

// 每个插件一份独立的 Bc（绑定其 id），插件在其上挂 onStart/onStop、注册样式/命令
function makeBc(pluginId: string) {
  const bindings: PluginBindings = {};

  const registerCss = (css: string): (() => void) => {
    const el = document.createElement('style');
    el.id = 'bc-plugin-css-' + pluginId;
    el.textContent = css;
    document.head.appendChild(el);
    let removed = false;
    return () => {
      if (!removed) { el.remove(); removed = true; }
    };
  };

  const registerCommand = (cmd: {
    id: string;
    label: string | (() => string);
    icon?: string;
    title?: string;
    onClick: () => void;
    /** @deprecated v0.4.4 起**不再生效**：插件按钮一律先进「⋯更多」，由用户在
     *  「设置 → 工具栏管理」里自己把它插到主区 / 右侧。留着只为兼容老插件的类型。 */
    dock?: 'main' | 'right' | 'more';
  }) => {
    const item: ToolbarItem = {
      id: 'plg.' + pluginId + '.' + cmd.id,
      label: cmd.label,
      icon: cmd.icon,
      title: cmd.title,
      onClick: cmd.onClick,
      order: 1000,
      // v0.4.4：插件**不能**把自己直接塞到工具栏上 —— 一律默认收进「⋯更多」。
      // （cmd.dock 以前会被采纳，插件因此可以"劫持"工具栏；现在入口只有一处：
      //   设置 → 工具栏管理 → 目标区域右端的「＋ 插入按钮」）
      defaultDock: 'more'
    };
    useToolbar.getState().addItem(item);
  };

  // 注册新元素类型到左侧面板
  const registerElement = (def: {
    type: string;
    label: string;
    help: { tag: string; what: string; where: string };
  }) => {
    pluginElements.push(def);
    // 触发面板重渲染（通过 dispatchEvent）
    window.dispatchEvent(new CustomEvent('bc:plugin-elements-changed'));
  };

  // 注册新 CSS 属性到属性面板
  const registerProperty = (schema: PropertySchema) => {
    pluginProperties.push(schema);
    window.dispatchEvent(new CustomEvent('bc:plugin-properties-changed'));
  };

  // 注册导出钩子（pre = 导出前修改 HTML，post = 导出后修改 HTML）
  const registerExportHook = (hook: {
    pre?: (html: string) => string;
    post?: (html: string) => string;
  }) => {
    exportHooks.push(hook);
  };

  return {
    bc: {
      onStart: (cb: () => void) => { bindings.start = cb; },
      onStop: (cb: () => void) => { bindings.stop = cb; },
      registerCss,
      registerCommand,
      registerElement,
      registerProperty,
      registerExportHook,
      /** 透传给插件程序原生的 bc API（导出/预览/模板等） */
      api: window.bc,
      log: (...a: unknown[]) => console.log('[插件:' + pluginId + ']', ...a)
    },
    bindings
  };
}

function startPlugin(id: string, source: string, permissions: PluginPermission[]) {
  const { bc, bindings } = makeBc(id);
  /**
   * v0.4.6（R6-22）：按 manifest 声明裁剪 Bc。
   * 未声明的方法**直接删掉**（而不是给个抛错的空函数）—— 空函数会让插件以为注册成功，
   * 排查起来比 `TypeError: Bc.registerCss is not a function` 难十倍。
   */
  const { bc: gated, removed } = applyPermissionGate(bc, permissions);
  if (removed.length > 0) {
    console.info(`[插件:${id}] 未声明能力，已隐藏：${removed.join(', ')}（在 manifest.permissions 里声明即可使用）`);
  }
  // 插件入口形如：(function (Bc) { ... })(Bc)。把 host 当实参传入。
  const fn = new Function('Bc', source);
  fn(gated);
  bindings.start?.();
  return { id, stop: bindings.stop, permissions } as ActivePlugin;
}

/** 重启全部启用插件：停旧的 → 清旧插件项 → 加载新批次 */
export async function refreshPlugins(): Promise<void> {
  for (const a of active) {
    try { a.stop?.(); } catch { /* 插件 stop 抛错不影响继续 */ }
  }
  active = [];
  // 清掉插件贡献的工具栏项（连同 order 里已消失的 id 一并清理）
  useToolbar.setState((st) => ({
    items: st.items.filter((it) => !it.id.startsWith('plg.')),
    order: st.order.filter((id) => st.items.some((x) => x.id === id && !x.id.startsWith('plg.')))
  }));

  try {
    const scan = await window.bc.scanExtensions();
    const plugins = (scan.plugins ?? []).filter((p) => p.enabled);
    for (const p of plugins) {
      try {
        // v0.4.6（R6-22）：先按 manifest 解析接口声明（版本 incompatible 就拒绝加载）
        const decl = parseManifestPermissions((p as unknown as { manifest?: Record<string, unknown> }).manifest);
        if (decl.rejected) {
          console.warn(`[插件:${p.id}] 已拒绝加载：${decl.rejected}`);
          continue;
        }
        if (decl.ignored.length > 0) {
          console.warn(`[插件:${p.id}] 有未知能力被忽略：${decl.ignored.join(', ')}（可能是插件的 API 版本更高）`);
        }
        const src = await window.bc.getPluginSource(p.id);
        if (!src.ok || !src.source) {
          console.warn('[插件:' + p.id + '] 未加载：', src.error ?? '无源码');
          continue;
        }
        active.push(startPlugin(p.id, src.source, decl.permissions));
      } catch (e) {
        console.warn('[插件:' + p.id + '] 执行失败，已跳过：', e);
      }
    }
  } catch (e) {
    console.warn('插件扫描失败：', e);
  }
}
