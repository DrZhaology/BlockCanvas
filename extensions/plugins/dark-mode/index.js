// BlockCanvas · 深色模式插件（v2）
// 入口约定：程序用 new Function('Bc', source)(Bc) 求值，Bc 是程序给的宿主对象。
//
// 方案：程序把全部浅色表面/hover 着色都收敛到 CSS 变量（:root 里 20+ 个 --* 语义变量），
// 本插件深色时只覆盖这一组变量 + color-scheme，即可整体正确换肤，
// 不用再逐条覆盖几十个选择器，也不会“点击后闪白”（hover/active 底色随变量变深）。
//
// 另外额外处理程序里写死的斜纹（!important 覆盖）、滚动条、::selection、placeholder。
(function (Bc) {
  // —— 音量：无 ——
  var NS = 'bc-dm';
  var MODE_KEY = NS + ':mode'; // auto | dark | light

  function readMode() {
    try {
      var m = localStorage.getItem(MODE_KEY);
      return m === 'dark' || m === 'light' ? m : 'auto';
    } catch (e) { return 'auto'; }
  }
  function saveMode(m) {
    try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* 忽略 */ }
  }

  var mql = window.matchMedia('(prefers-color-scheme: dark)');
  var onMedia = null;
  var removeCss = null;
  var curMode = readMode();

  function isDark() {
    return curMode === 'dark' || (curMode === 'auto' && mql.matches);
  }
  // 同步顶部原生菜单栏/窗口 chrome 的明暗：CSS 改不到原生 chrome，
  // 只能借主进程 nativeTheme.themeSource（preload 桥暴露的 setNativeTheme）。
  function syncNative() {
    var w = window;
    var src = curMode === 'dark' ? 'dark' : curMode === 'light' ? 'light' : 'system';
    try {
      if (w.bc && typeof w.bc.setNativeTheme === 'function') w.bc.setNativeTheme(src);
    } catch (e) { /* ignore: 无桥时保持默认 */ }
  }
  function apply() {
    var root = document.documentElement;
    if (isDark()) root.setAttribute('data-bc-dark', 'on');
    else root.removeAttribute('data-bc-dark');
    syncNative();
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
    // 程序写死的斜纹底（变量覆盖不到，需 !important 直接改）
    'html[data-bc-dark] .canvas-wrap { ' +
      'background:repeating-linear-gradient(45deg, var(--stripe) 0 8px, transparent 8px 16px) !important; ' +
    '} ' +
    'html[data-bc-dark] .tpl-preview-body { ' +
      'background:repeating-linear-gradient(45deg, var(--stripe2) 0 8px, transparent 8px 16px) !important; ' +
    '} ' +
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

  Bc.onStart(function () {
    removeCss = Bc.registerCss(css);
    onMedia = function () { if (curMode === 'auto') apply(); };
    if (mql.addEventListener) mql.addEventListener('change', onMedia);
    apply();
  });

  Bc.onStop(function () {
    document.documentElement.removeAttribute('data-bc-dark');
    var w = window;
    try { if (w.bc && typeof w.bc.setNativeTheme === 'function') w.bc.setNativeTheme('system'); } catch (e) { /* ignore */ }
    if (mql.removeEventListener && onMedia) { mql.removeEventListener('change', onMedia); onMedia = null; }
    if (removeCss) { removeCss(); removeCss = null; }
  });

  Bc.registerCommand({
    id: 'toggle',
    icon: '🌙',
    label: function () {
      return curMode === 'auto' ? '深色模式(自动)' : curMode === 'dark' ? '深色模式·开' : '深色模式·关';
    },
    title: '深色模式：自动跟随系统 / 手动切换深色或浅色',
    onClick: function () {
      curMode = curMode === 'auto' ? 'dark' : curMode === 'dark' ? 'light' : 'auto';
      saveMode(curMode);
      apply();
    }
  });
})(Bc);