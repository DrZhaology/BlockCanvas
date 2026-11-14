// BlockCanvas · 系统集成 IPC（shell:* / help:* / cfg:* / preview:* / img:pick-src / media:pick-src）
//
// 这一层是"编辑器与操作系统打交道"的边界，全部与用户机器有关：
//   · shell:reveal / open-external / data:open-path  —— 打开文件夹、打开链接
//   · help:*  —— 帮助文档（打包态读不到磁盘，靠构建期内联）
//   · cfg:*   —— 应用配置（主题、工具栏布局、各类开关）
//   · preview:open —— 用系统默认浏览器预览
//   · img:pick-src / media:pick-src —— 选本地文件
//
// 三条安全约定（都是踩过坑加的）：
//   1. **open-external 只放 http/https** —— 否则 file: 与自定义 scheme 会变成任意代码执行入口；
//   2. **预览文件写进 <data>/tmp/preview 并且只留最近 N 个** —— 以前散落系统 Temp 且无限增长；
//      文件名带时间戳（浏览器按 URL 缓存，复用同名会显示上一次的内容）；
//   3. **选文件只返回路径，不读内容** —— 读文件的地方各自校验（导出、素材导入）。
import { app, BrowserWindow, ipcMain, shell, systemPreferences } from 'electron';
import { join, dirname, relative } from 'node:path';
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { readAppConfig, writeAppConfig } from '../userData';
import { previewDir, toWebPath } from '../paths';
import { DEFAULT_PREVIEW_KEEP } from '../storage';
import { popupMenu } from '../menu';
import { showOpenDialog } from './context';

// ============ 帮助文档（项目介绍 / 使用手册 / 开发历程） ============
// 「打包时硬编码、运行时直读」：
//   · 打包版（asar）里没有这些 .md（electron-builder 排除了 docs/**，根目录也只剩 out/**），
//     渲染层用的是构建时内联进去的那几份（vite `?raw`）；
//   · 开发态（pnpm dev）则走这里**实时读盘**，改完文档刷新就能看到，不用重新构建。
const HELP_DOCS: Record<string, string> = {
  intro: 'README.md',
  manual: 'docs/使用手册.md',
  history: 'docs/开发历程.md'
};
// 兼容旧调用（只读 README）
// 帮助页里的相对图片（docs/screenshots/xxx.png）在开发态指向仓库里的真实文件

/** 预览目录只保留最近 N 个（防止"每预览一次就多一个文件"）——阈值与存储预算共用一处 */
const PREVIEW_KEEP = DEFAULT_PREVIEW_KEEP;
function pruneOldPreviews(dir: string, keep: number): number {
  let n = 0;
  try {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /^bc-preview-.*\.html$/i.test(e.name))
      .map((e) => {
        const full = join(dir, e.name);
        let mtime = 0;
        try { mtime = statSync(full).mtimeMs; } catch { /* 忽略 */ }
        return { full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);          // 新的在前
    for (const f of files.slice(keep)) {
      try { unlinkSync(f.full); n += 1; } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
  return n;
}

// 首页背景：选择图片 / 视频文件（只返回路径，不复制；渲染层用 bc-img:// 预览）

export function registerSystemIpc(): void {

  // ============ 自绘窗口标题栏（v0.4.6） ============
  //
  // 窗口是 frame:false，最小化 / 最大化 / 关闭 / 拖动全由渲染层那条标题栏发起。
  // 三个原则：
  //   1. **一律操作"当前窗口"**（多窗口时按 sender 反查，不盲取 0 号窗口）；
  //   2. 状态变化（最大化/还原）**主动推**给渲染层，界面才知道要不要换成"还原"图标；
  //   3. 关闭走正常 close()，让 before-quit / 未保存提示照常生效。
  const winOf = (evt: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    const w = BrowserWindow.fromWebContents(evt.sender);
    return w && !w.isDestroyed() ? w : BrowserWindow.getAllWindows()[0];
  };

  ipcMain.handle('win:minimize', (evt) => {
    winOf(evt)?.minimize();
    return { ok: true };
  });

  ipcMain.handle('win:maximize-toggle', (evt) => {
    const w = winOf(evt);
    if (!w) return { ok: false };
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
    return { ok: true, maximized: w.isMaximized() };
  });

  ipcMain.handle('win:close', (evt) => {
    winOf(evt)?.close();
    return { ok: true };
  });

  ipcMain.handle('win:state', (evt) => {
    const w = winOf(evt);
    return { ok: true, maximized: !!w?.isMaximized(), focused: !!w?.isFocused() };
  });

  /**
   * 系统的强调色（Windows：设置 → 个性化 → 颜色）。
   *
   * 用户要的是「窗口描边用我设的主题色」——这条色不是程序里存的，而是系统里那一条。
   * `getAccentColor()` 返回 RRGGBBAA，这里统一成 #rrggbb。
   * 网页版没有这个概念 → adapter 里返回 null，界面回退到程序自己的 --accent。
   */
  ipcMain.handle('win:accent', () => {
    try {
      if (process.platform === 'win32' || process.platform === 'darwin') {
        const raw = systemPreferences.getAccentColor() || '';
        if (/^[0-9a-f]{6,8}$/i.test(raw)) return { ok: true, color: '#' + raw.slice(0, 6).toLowerCase() };
      }
    } catch { /* 取不到就算了 */ }
    return { ok: false, color: null };
  });

  /** 自绘标题栏点「文件 / 编辑 / …」→ 在该坐标弹原生子菜单 */
  ipcMain.handle('menu:popup', (evt, id: string, x: number, y: number) => {
    const w = winOf(evt);
    if (!w) return { ok: false };
    try {
      return { ok: popupMenu(w, String(id), Number(x) || 0, Number(y) || 0) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  /**
   * 「竖屏验收」（R6-9）：一键把窗口设成手机尺寸。
   *
   * 竖屏 Windows 显示器就是现成的手机验收台；但手动把窗口拖到 412×915 很难精确到像素。
   * 尺寸取真机常见值：
   *   · 412×915 = Pixel 7 / 多数 1080p 安卓（最常用的 Android 逻辑分辨率）
   *   · 390×844 = iPhone 14 / 15
   *   · 360×800 = 国产安卓偏窄的一档（最容易挤爆的宽度）
   * 返回**实际**得到的尺寸（窗口管理器可能因最小尺寸/屏幕边界修正），探针据此断言。
   */
  ipcMain.handle('win:set-acceptance-size', (_evt, preset: 'android' | 'iphone' | 'compact' | 'reset') => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) return { ok: false, error: '没有窗口' };
    const sizes = {
      android: { width: 412, height: 915 },
      iphone: { width: 390, height: 844 },
      compact: { width: 360, height: 800 },
      reset: { width: 1280, height: 800 }
    } as const;
    const s = sizes[preset] ?? sizes.android;
    // 先把最小尺寸放开，否则 setSize 会被钳制在 minWidth 上（这正是以前做不到的原因）
    win.setMinimumSize(320, 480);
    win.setSize(s.width, s.height);
    win.center();
    const [w, h] = win.getSize();
    return { ok: true, width: w, height: h, requested: s };
  });

  /** 在系统文件管理器里定位一个文件（导出后"打开所在文件夹"用） */
  ipcMain.handle('shell:reveal', async (_evt, p: string) => {
    if (!p) return { ok: false, error: '缺少路径' };
    try {
      if (existsSync(p) && statSync(p).isDirectory()) return { ok: !(await shell.openPath(p)) };
      shell.showItemInFolder(p);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  ipcMain.handle('help:get-doc', (_evt, key: string) => {
    if (app.isPackaged) return { ok: false, bundled: true };
    const rel = HELP_DOCS[key];
    if (!rel) return { ok: false, source: 'none', error: '未知文档' };
    const candidates = [
      join(app.getAppPath(), rel),
      join(process.cwd(), rel)
    ];
    for (const p of candidates) {
      try {
        if (existsSync(p)) {
          const text = readFileSync(p, 'utf-8');
          return { ok: true, text, path: p, source: 'disk' };
        }
      } catch { /* 试下一个 */ }
    }
    return { ok: false, source: 'none' };
  });

  ipcMain.handle('help:get-readme', () => {
    if (app.isPackaged) return { ok: false, bundled: true };
    const candidates = [
      join(app.getAppPath(), 'README.md'),
      join(process.cwd(), 'README.md')
    ];
    for (const p of candidates) {
      try {
        if (existsSync(p)) {
          const text = readFileSync(p, 'utf-8');
          return { ok: true, text, path: p, source: 'disk' };
        }
      } catch { /* 试下一个 */ }
    }
    return { ok: false, source: 'none' };
  });

  ipcMain.handle('help:get-root', () => (app.isPackaged ? '' : app.getAppPath()));

  ipcMain.handle('cfg:get', () => readAppConfig());
  ipcMain.handle('cfg:set', (_evt, patch: Record<string, any>) => writeAppConfig(patch));

  ipcMain.handle('preview:open', async (_evt, html: string) => {
    try {
      // v0.4.4：预览页收进 <data>/tmp/preview，并只保留最近 N 个 —— 不再散落系统 Temp、不再无限增长。
      // 为什么仍带时间戳而不是固定文件名：浏览器会按 URL 缓存，复用同一文件名可能显示上一次的内容。
      const dir = previewDir();
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `bc-preview-${Date.now()}.html`);
      writeFileSync(file, html, 'utf-8');
      pruneOldPreviews(dir, PREVIEW_KEEP);
      const err = await shell.openPath(file);
      if (err) return { ok: false, error: err };
      return { ok: true, path: file };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('img:pick-src', async (_evt, mode: 'abs' | 'rel' = 'rel') => {
    const res = await showOpenDialog({
      title: '选择本地图片',
      properties: ['openFile'],
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'] }
      ]
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
    const absPath = res.filePaths[0];
    if (mode === 'rel') {
      const base = app.isPackaged ? dirname(process.execPath) : app.getAppPath();
      let rel = toWebPath(relative(base, absPath));
      if (!rel.startsWith('.') && !rel.startsWith('/')) rel = './' + rel;
      return { ok: true, path: rel, absPath };
    }
    return { ok: true, path: absPath, absPath };
  });

  ipcMain.handle('media:pick-src', async (_evt, kind: 'image' | 'video' | 'audio' = 'image') => {
    const isVideo = kind === 'video';
    const isAudio = kind === 'audio';
    const res = await showOpenDialog({
      title: isVideo ? '选择本地视频' : isAudio ? '选择本地音频' : '选择本地图片',
      properties: ['openFile'],
      filters: isVideo
        ? [{ name: '视频文件', extensions: ['mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v'] }]
        : isAudio
          ? [{ name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'] }]
          : [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'] }]
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0], absPath: res.filePaths[0] };
  });
}
