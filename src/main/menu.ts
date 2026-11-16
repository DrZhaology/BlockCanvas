// BlockCanvas · 应用菜单（文件 / 编辑 / 视图 / 帮助 / 设置）
//
// v0.4.6：窗口改成**无系统标题栏**（frame: false），菜单条由渲染层自绘。
// 于是这里承担两件事：
//   1. `buildAppMenu()` —— 仍然注册成 application menu，**只为了让快捷键生效**
//      （Ctrl+S / Ctrl+Z / F1 / F12… 全部躺在菜单的 accelerator 上）。
//      无边框窗口不会把这条菜单画出来，所以用户看到的是自己那条标题栏。
//   2. `popupMenu(id, x, y)` —— 自绘标题栏点「文件」时，按 id 弹出对应子菜单，
//      坐标是相对窗口内容区的 DIP（无边框窗口下就是 getBoundingClientRect 的值）。
//
// 为什么用原生 Menu.popup 而不是自己画一层菜单：原生菜单有系统级键盘导航、滚动、
// 高 DPI 渲染和"点外部关闭"，自己复刻一遍只会更差。
import { BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { dataRoot } from './userData';
import { extRoot } from './ipc/extensions';

export type MenuId = 'file' | 'edit' | 'view' | 'help' | 'settings';

/** 自绘标题栏上按顺序显示的菜单（label 与渲染层一致，避免两处写死不一致） */
export const MENU_ORDER: Array<{ id: MenuId; label: string }> = [
  { id: 'file', label: '文件' },
  { id: 'edit', label: '编辑' },
  { id: 'view', label: '视图' },
  { id: 'help', label: '帮助' },
  { id: 'settings', label: '设置' }
];

function send(win: BrowserWindow, channel: string) {
  return () => {
    if (!win.isDestroyed()) win.webContents.send(channel);
  };
}

/** 各页签名下的子菜单模板（与 v0.4.6 完全一致，只是拆成了可按 id 取用） */
export function menuTemplate(win: BrowserWindow): Record<MenuId, MenuItemConstructorOptions[]> {
  return {
    file: [
      { label: '新建项目标签 (New Tab)', accelerator: 'CmdOrCtrl+N', click: send(win, 'menu:new-tab') },
      { label: '打开项目 (.bcproj)…', accelerator: 'CmdOrCtrl+O', click: send(win, 'menu:open-project') },
      { label: '保存项目 (.bcproj)', accelerator: 'CmdOrCtrl+S', click: send(win, 'menu:save-project') },
      { label: '项目另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: send(win, 'menu:save-project-as') },
      { type: 'separator' },
      { label: '导出 HTML 网页…', accelerator: 'CmdOrCtrl+E', click: send(win, 'menu:export-html') },
      { label: '在浏览器中预览', accelerator: 'CmdOrCtrl+P', click: send(win, 'menu:preview') },
      { type: 'separator' },
      { label: '浏览本地项目库 (data/projects/)', click: () => shell.openPath(join(dataRoot(), 'projects')) },
      { type: 'separator' },
      { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
    ],
    edit: [
      { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: send(win, 'menu:undo') },
      { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: send(win, 'menu:redo') },
      { type: 'separator' },
      { label: '复制元素', accelerator: 'CmdOrCtrl+C', click: send(win, 'menu:copy') },
      { label: '剪切元素', accelerator: 'CmdOrCtrl+X', click: send(win, 'menu:cut') },
      { label: '粘贴元素', accelerator: 'CmdOrCtrl+V', click: send(win, 'menu:paste') },
      { label: '原地副本', accelerator: 'CmdOrCtrl+D', click: send(win, 'menu:duplicate') },
      { label: '删除元素', accelerator: 'Delete', click: send(win, 'menu:delete') }
    ],
    view: [
      { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
      { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
      { label: '重置缩放', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      { type: 'separator' },
      { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
      { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
      { type: 'separator' },
      { label: '重新加载界面', accelerator: 'CmdOrCtrl+R', role: 'reload' }
    ],
    help: [
      { label: '使用手册（帮助中心）', accelerator: 'F1', click: send(win, 'menu:help') },
      { type: 'separator' },
      { label: '键盘快捷键速查表', accelerator: 'Shift+/', click: send(win, 'menu:shortcuts') },
      { label: '检测更新…', click: send(win, 'menu:check-update') },
      { type: 'separator' },
      { label: '关于 BlockCanvas', click: send(win, 'menu:about') }
    ],
    settings: [
      { label: '偏好设置…', accelerator: 'CmdOrCtrl+,', click: send(win, 'menu:settings') },
      { type: 'separator' },
      { label: '左侧布局（元素面板在左）', click: send(win, 'menu:layout-left') },
      { label: '底部布局（元素面板在下方）', click: send(win, 'menu:layout-bottom') },
      { type: 'separator' },
      { label: '插件与资源包…', click: send(win, 'menu:ext') },
      { label: '打开便携数据文件夹 (data/)…', click: () => shell.openPath(dataRoot()) },
      { label: '打开扩展文件夹 (extensions/)…', click: () => shell.openPath(extRoot()) },
      { type: 'separator' },
      { label: '检测更新…', click: send(win, 'menu:check-update') },
      { type: 'separator' },
      { label: '类名 / ID 总览…', click: send(win, 'menu:class-manager') }
    ]
  };
}

/**
 * 注册 application menu。
 *
 * ⚠ 唯一目的：**让 accelerator 生效**。
 * 无边框窗口不会渲染这条菜单（Windows 上 menu bar 属于系统 frame），
 * 所以它不会和自绘标题栏打架；但一旦不注册，Ctrl+S / F1 / F12 这些全都会失效。
 */
export function buildAppMenu(win: BrowserWindow): Menu {
  const t = menuTemplate(win);
  return Menu.buildFromTemplate(
    MENU_ORDER.map(({ id, label }) => ({ label, submenu: t[id] }))
  );
}

/** 自绘标题栏 → 弹出某个子菜单（x/y 是相对窗口内容区的 DIP 坐标） */
export function popupMenu(win: BrowserWindow, id: string, x: number, y: number): boolean {
  const t = menuTemplate(win);
  const sub = t[id as MenuId];
  if (!sub) return false;
  const menu = Menu.buildFromTemplate(sub);
  menu.popup({ window: win, x: Math.round(x), y: Math.round(y) });
  return true;
}
