// Web 版探针用的最小 Electron 壳（R6-12）
//
// 它**故意什么预加载都不挂**：
//   · 没有 preload → `window.bc` 不存在 → 渲染层走 adapter/browser.ts；
//   · contextIsolation 关掉 → 探针能直接读 window.__sceneStore 做断言；
//   · 只 loadFile 那个构建出来的单文件 HTML。
//
// 于是它就是"一台没有 preload 的浏览器"，正好用来验证网页版真的能跑
// （比 Playwright 自带的 chromium 更贴近实际，也省掉 130MB 下载）。
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

const target = process.argv[process.argv.length - 1];

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  /**
   * 关键：把这个壳的下载目录固定成临时目录，并把每次下载记下来。
   *
   * 浏览器版的"导出"就是 `<a download>` 触发下载 —— 在真实浏览器里用户会看到下载栏，
   * 但在无头/壳环境里如果不拦一下，文件会默默落到默认目录，探针也就无从断言。
   * 这里记到 `global.__bcDownloads`，供探针读取。
   */
  const dlDir = path.join(app.getPath('temp'), 'bc-web-shell-downloads');
  global.__bcDownloads = [];
  session.defaultSession.on('will-download', (_e, item) => {
    const name = item.getFilename();
    const full = path.join(dlDir, name);
    item.setSavePath(full);
    global.__bcDownloads.push({ name, path: full, state: 'started' });
    item.once('done', (_ev, state) => {
      const rec = global.__bcDownloads.find((d) => d.path === full);
      if (rec) rec.state = state;
    });
  });

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    webPreferences: {
      // 关键：不挂 preload！这就是"浏览器宿主"的前提
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });
  win.loadFile(target);
});

app.on('window-all-closed', () => app.quit());
