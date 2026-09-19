// BlockCanvas · 深色模式插件（v3）
// 入口约定：程序用 new Function('Bc', source)(Bc) 求值，Bc 是程序给的宿主对象。
//
// 方案：程序把全部浅色表面/hover 着色都收敛到 CSS 变量（:root 里 20+ 个 --* 语义变量），
// 本插件深色时只覆盖这一组变量 + color-scheme，即可整体正确换肤。
//
// v3 修复「自动模式下切深色闪一下黑又变白」：
//  - 不再在闭包里缓存 curMode（v2 的病根）：apply / 按钮 / 媒体监听全部现读 localStorage，
//    插件重载后的旧监听、双实例竞态都不会再用陈旧模式把深色撤掉；
//  - 记录 lastDark 做变化检测：手动切换引起的 prefers-color-scheme "回声"再进 apply 时
//    结论幂等，不会抖动；
//  - auto 模式启动先把 nativeTheme 复位 system，并在下一拍复查一次，
//    修正上一会话残留 themeSource 对 matchMedia 的污染。
// 新增：深浅切换瞬间全界面 0.3s 颜色过渡动画（平时不挂 transition，零开销）。
(function (Bc) {
  var NS = 'bc-dm';
  var MODE_KEY = NS + ':mode'; // auto | dark | light

  var mql = window.matchMedia('(prefers-color-scheme: dark)');
  var onMedia = null;
  var removeCss = null;
  var lastDark = null;   // 上次生效的明暗；null = 尚未应用过（首次不播动画）
  var transTimer = 0;
  var ANIM_CLASS = 'bc-dm-anim'; // 切换瞬间挂在 <html> 上，触发全界面颜色过渡

  function readMode() {
    try {
      var m = localStorage.getItem(MODE_KEY);
      return m === 'dark' || m === 'light' ? m : 'auto';
    } catch (e) { return 'auto'; }
  }
  function saveMode(m) {
    try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* 忽略 */ }
  }

  // 每次现读 localStorage + 现查 matchMedia —— 不缓存任何可变状态
  function isDarkNow(mode) {
    return mode === 'dark' || (mode === 'auto' && mql.matches);
  }

  // 同步顶部原生菜单栏/窗口 chrome 的明暗：CSS 改不到原生 chrome，
  // 只能借主进程 nativeTheme.themeSource（preload 桥暴露的 setNativeTheme）。
  function syncNative(mode) {
    try {
      if (window.bc && typeof window.bc.setNativeTheme === 'function') {
        window.bc.setNativeTheme(mode === 'dark' ? 'dark' : mode === 'light' ? 'light' : 'system');
      }
    } catch (e) { /* ignore: 无桥时保持默认 */ }
  }

  // 切换瞬间的 0.3s 颜色过渡：给 <html> 挂一个类，320ms 后摘掉。
  // 过渡规则写在常驻样式表里（用 html.bc-dm-anim 前缀提高特异性），
  // 不再需要临时 <style>，也不必用强制优先级。
  function playTransition() {
    var root = document.documentElement;
    root.classList.add(ANIM_CLASS);
    if (transTimer) clearTimeout(transTimer);
    transTimer = setTimeout(function () {
      root.classList.remove(ANIM_CLASS);
      transTimer = 0;
    }, 320);
  }

  function apply() {
    var mode = readMode();
    var dark = isDarkNow(mode);
    var root = document.documentElement;
    if (dark) root.setAttribute('data-bc-dark', 'on');
    else root.removeAttribute('data-bc-dark');
    // 只在明暗真正翻转时播 0.3s 过渡（首次应用不播，避免启动闪动画）
    if (lastDark !== null && dark !== lastDark) playTransition();
    lastDark = dark;
    // 同步原生 chrome 放最后：手动切换触发的 prefers-color-scheme 回声再次进入本函数时，
    // readMode/isDarkNow 结论不变 → 幂等，不会出现"黑一下又变白"
    syncNative(mode);
    // 刷新工具栏按钮文字（重新 addItem 原地替换 → 工具栏重渲染读到最新模式）
    try { registerToggle(); } catch (e) { /* ignore */ }
  }

  // 深色变量组：值全部收敛到主题变量，因果反向 —— 程序读变量，插件写变量。
  var css = (
    'html[data-bc-dark] { ' +
      '--bg:#1b1c1f; --bg-panel:#242528; --bg-canvas:#2c2d31; ' +
      '--border:#3a3c41; --text:#e8e8e8; --text-muted:#9b9da3; ' +
      '--accent:#4f9cf0; --accent-hover:#6ab0ff; --select:#4f9cf0; --danger:#ff6b6b; ' +
      '--hover:#34363b; --hover-accent:#27323f; --focus-accent:#26343f; --accent-strong-bg:#24364a; ' +
      '--chip-hover:#33353a; --tab-hover:#32343a; ' +
      '--muted-bg:#202124; --muted-bg-2:#26272b; ' +
      '--panel-soft:#222328; --panel-cloud:#202126; --panel-tint:#222429; --panel-tint-2:#282a30; ' +
      '--row-hover:#2a3140; --row-active:#273647; --row-action:#31465e; ' +
      '--seg-active:#2b303c; --line-soft:#33353a; ' +
      '--thumb:#3d3f45; --thumb-hover:#4a4d54; ' +
      '--stripe:#33353a; --stripe2:#2d2f34; ' +
      '--warn-bg:#3a3116; --ok-bg:#15301f; --err-bg:#3a1c1e; --danger-tint:#4a2225; ' +
      '--conflict-bg:#3a2a12; --amber-bg:#3a2c14; --issue-bg:#352b16; ' +
      '--err-boundary-bg:#2b2021; --err-boundary-msg-bg:#352022; ' +
      'color-scheme:dark; ' +
    '} ' +
    // 程序写死的斜纹底：变量覆盖不到，用 html[data-bc-dark] 前缀提高特异性即可覆盖
    // （选择器权重 (0,2,1) 已高于 .canvas-wrap 的 (0,1,0)，无需任何强制优先级）
    'html[data-bc-dark] .canvas-wrap { ' +
      'background:repeating-linear-gradient(45deg, var(--stripe) 0 8px, transparent 8px 16px); ' +
    '} ' +
    'html[data-bc-dark] .tpl-preview-body { ' +
      'background:repeating-linear-gradient(45deg, var(--stripe2) 0 8px, transparent 8px 16px); ' +
    '} ' +
    // 明暗切换瞬间的颜色过渡：挂 html.bc-dm-anim 时生效，320ms 后摘掉。
    // 用前缀把特异性抬到 (0,1,2)/(0,2,2)，足以压过单个类名的 transition。
    'html.bc-dm-anim, ' +
    'html.bc-dm-anim body, ' +
    'html.bc-dm-anim body *, ' +
    'html.bc-dm-anim body *::before, ' +
    'html.bc-dm-anim body *::after, ' +
    'html.bc-dm-anim body .app, ' +
    'html.bc-dm-anim body .app *, ' +
    'html.bc-dm-anim body .app *::before, ' +
    'html.bc-dm-anim body .app *::after { ' +
      'transition:background-color .3s ease,color .3s ease,' +
      'border-color .3s ease,box-shadow .3s ease,fill .3s ease,stroke .3s ease; ' +
    '} ' +
    'html.bc-dm-anim body .workspace { transition:none; } ' +
    // 滚动条 + 文本选区 + 占位符
    'html[data-bc-dark] ::-webkit-scrollbar-thumb { background:var(--thumb); } ' +
    'html[data-bc-dark] ::-webkit-scrollbar-thumb:hover { background:var(--thumb-hover); } ' +
    'html[data-bc-dark] ::selection { background:rgba(79,156,240,.4); color:#fff; } ' +
    'html[data-bc-dark] ::placeholder { color:#7c7e84; } ' +
    'html[data-bc-dark] input, ' +
    'html[data-bc-dark] select, ' +
    'html[data-bc-dark] textarea { ' +
      'background:var(--bg-panel); color:var(--text); border-color:var(--border); caret-color:var(--accent); ' +
    '} ' +
    'html[data-bc-dark] input:focus, ' +
    'html[data-bc-dark] select:focus, ' +
    'html[data-bc-dark] textarea:focus { border-color:var(--accent); outline:none; background:var(--bg-panel); } ' +
    // 画布元素内容本身保持用户样式，仅给画布外框一个深色投影更贴合
    'html[data-bc-dark] .canvas { box-shadow:0 1px 8px rgba(0,0,0,.5); }'
  );

  // 注册工具栏按钮（label 是函数 → 每次渲染求值）。
  // 状态变化后重新调用本函数 = 重新 addItem → store 更新 → 工具栏重渲染，
  // 按钮文字立即显示当前模式（自动/开/关），不再停留在上一次渲染的旧状态。
  function registerToggle() {
    Bc.registerCommand({
      id: 'toggle',
      icon: '🌙',
      label: function () {
        var m = readMode();
        return m === 'auto' ? '深色模式(自动)' : m === 'dark' ? '深色模式·开' : '深色模式·关';
      },
      title: '深色模式：自动跟随系统 / 手动切换深色或浅色（当前：' +
        (function () { var m = readMode(); return m === 'auto' ? '自动' : m === 'dark' ? '深色' : '浅色'; })() + '）',
      onClick: function () {
        var m = readMode();
        m = m === 'auto' ? 'dark' : m === 'dark' ? 'light' : 'auto';
        saveMode(m);
        apply();
      }
    });
  }

  Bc.onStart(function () {
    removeCss = Bc.registerCss(css);
    onMedia = function () { apply(); };
    if (mql.addEventListener) mql.addEventListener('change', onMedia);
    else if (mql.addListener) mql.addListener(onMedia); // 兼容旧 Electron
    apply();
    // auto 兜底：上一会话可能残留非 system 的 themeSource（异常退出没走到 onStop），
    // 上面的 apply 已把它复位为 system；等一拍让 matchMedia 反映真实系统主题后再复查
    setTimeout(function () { apply(); }, 60);
  });

  Bc.onStop(function () {
    document.documentElement.removeAttribute('data-bc-dark');
    document.documentElement.classList.remove(ANIM_CLASS);
    if (transTimer) { clearTimeout(transTimer); transTimer = 0; }
    try { if (window.bc && typeof window.bc.setNativeTheme === 'function') window.bc.setNativeTheme('system'); } catch (e) { /* ignore */ }
    if (mql.removeEventListener && onMedia) { mql.removeEventListener('change', onMedia); onMedia = null; }
    else if (mql.removeListener && onMedia) { mql.removeListener(onMedia); onMedia = null; }
    if (removeCss) { removeCss(); removeCss = null; }
  });

  registerToggle();
})(Bc);
