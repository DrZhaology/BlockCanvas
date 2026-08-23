import { useToolbar, type ToolbarItem } from '@store/toolbarStore';

// BlockCanvas · 插件执行宿主
// 原则：插件兼容程序，不是程序兼容插件。
//   - 程序只提供一个稳定的 Bc 宿主对象，插件自己决定行为；
//   - 插件 main 文件是一个立即执行函数 `(function (Bc) { ... })(Bc)`，
//     通过 Bc.onStart / Bc.onStop / Bc.registerCss / Bc.registerCommand 接入程序；
//   - 入口文件以源码字符串下发，渲染进程用 new Function 求值（CSP 已开 unsafe-eval），
//     不改动象素级 DOM 结构，也不注入任何全局变量（每个插件拿到独立的 Bc）。
//
// 生命周期：
//   refreshPlugins()：先停掉上一个批次所有插件、清掉它们注册的工具栏项，
//           再扫描「已启用」插件并逐个执行 → 供启动、启用/禁用/导入/删除后刷新调用。

interface PluginBindings {
  start?: () => void;
  stop?: () => void;
}

interface ActivePlugin {
  id: string;
  stop?: () => void;
}

let active: ActivePlugin[] = [];

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
  }) => {
    const item: ToolbarItem = {
      id: 'plg.' + pluginId + '.' + cmd.id,
      label: cmd.label,
      icon: cmd.icon,
      title: cmd.title,
      onClick: cmd.onClick,
      order: 1000,
      defaultVisible: false
    };
    useToolbar.getState().addItem(item);
  };

  return {
    bc: {
      onStart: (cb: () => void) => { bindings.start = cb; },
      onStop: (cb: () => void) => { bindings.stop = cb; },
      registerCss,
      registerCommand,
      /** 透传给插件程序原生的 bc API（导出/预览/模板等） */
      api: window.bc,
      log: (...a: unknown[]) => console.log('[插件:' + pluginId + ']', ...a)
    },
    bindings
  };
}

function startPlugin(id: string, source: string) {
  const { bc, bindings } = makeBc(id);
  // 插件入口形如：(function (Bc) { ... })(Bc)。把 host 当实参传入。
  const fn = new Function('Bc', source);
  fn(bc);
  bindings.start?.();
  return { id, stop: bindings.stop } as ActivePlugin;
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
        const src = await window.bc.getPluginSource(p.id);
        if (!src.ok || !src.source) {
          console.warn('[插件:' + p.id + '] 未加载：', src.error ?? '无源码');
          continue;
        }
        active.push(startPlugin(p.id, src.source));
      } catch (e) {
        console.warn('[插件:' + p.id + '] 执行失败，已跳过：', e);
      }
    }
  } catch (e) {
    console.warn('插件扫描失败：', e);
  }
}