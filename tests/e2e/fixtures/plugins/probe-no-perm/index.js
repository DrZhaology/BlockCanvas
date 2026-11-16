// 探针插件：声明了 0 个权限（只给默认最小集），然后逐一尝试越权调用。
//
// 期望结果（probe-plugin-perms 断言）：
//   · window.__probePluginAccess 里每一项都是 'undefined' —— 未声明的方法在 Bc 上根本不存在；
//   · 已声明的 registerElement / registerProperty 是 'function'（最小集照常可用）。
//
// 注意：这里**故意不 try/catch**，因为访问 undefined 上的属性本身不会抛错；
// 我们要断言的就是"它是 undefined"，而不是"调用时抛错"。
(function (Bc) {
  window.__probePluginAccess = {
    // 声明过的（最小集）
    registerElement: typeof Bc.registerElement,
    registerProperty: typeof Bc.registerProperty,
    // 没声明的（高危能力，必须不存在）
    registerExportHook: typeof Bc.registerExportHook,
    registerCommand: typeof Bc.registerCommand,
    registerCss: typeof Bc.registerCss,
    api: typeof Bc.api
  };

  // 顺手试一下"真的调用会怎样"：调用未声明的方法必须抛 TypeError
  window.__probePluginThrows = {
    css: (function () {
      try { Bc.registerCss('body { color: red }'); return 'no-throw'; }
      catch (e) { return e instanceof TypeError ? 'TypeError' : 'other:' + e; }
    })(),
    command: (function () {
      try { Bc.registerCommand({ id: 'x', label: 'x', onClick: function () {} }); return 'no-throw'; }
      catch (e) { return e instanceof TypeError ? 'TypeError' : 'other:' + e; }
    })(),
    exportHook: (function () {
      try { Bc.registerExportHook({ pre: function (h) { return h; } }); return 'no-throw'; }
      catch (e) { return e instanceof TypeError ? 'TypeError' : 'other:' + e; }
    })(),
    // 最小集里的两个应当可以正常调用
    element: (function () {
      try {
        Bc.registerElement({ type: 'div', label: '探针元素', help: { tag: 'div', what: '探针', where: '探针' } });
        return 'no-throw';
      } catch (e) { return 'threw:' + e; }
    })()
  };
})(Bc);
