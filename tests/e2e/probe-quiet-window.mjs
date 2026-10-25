// v0.4.5 第十二批探针：安静启动窗口 —— 可见、可截图、但**不可激活**
// 用法：node tests/e2e/probe-quiet-window.mjs
//
// 这一条验的是"窗口到底有没有抢前台"这个**系统级**事实，不是应用内部状态：
//   · 启动前记下当前前台窗口（PowerShell + user32.GetForegroundWindow）
//   · 启动应用、等它把界面画出来
//   · 再读一次前台窗口 —— 必须**完全没变**
// 同时验证"窗口确实显示了、截图不是空白"（否则"不抢焦点"就是靠把窗口藏起来作弊）。
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { ensureEditor } from './ensure-editor.mjs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

/** 读当前前台窗口（句柄|标题）。Windows only；其它平台返回 null */
function foregroundWindow() {
  if (process.platform !== 'win32') return null;
  const ps = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class BC_FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  public static string Title() {
    var h = GetForegroundWindow();
    var sb = new StringBuilder(300);
    GetWindowTextW(h, sb, 300);
    return h.ToString() + "|" + sb.ToString();
  }
}
"@ -Language CSharp
[BC_FG]::Title()
`;
  try {
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8', timeout: 20000
    }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-quiet');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const fgBefore = foregroundWindow();
  check('准备：能读到系统前台窗口（Windows）', fgBefore !== null, String(fgBefore));

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  // 给足时间：Windows 的"空闲抢前台"通常发生在窗口刚映射的几秒内
  await sleep(4000);

  const fgDuring = foregroundWindow();
  check('启动并画完界面后，系统前台窗口**没有变**（不抢焦点）',
    fgBefore !== null && fgDuring === fgBefore,
    `before=${fgBefore} during=${fgDuring}`);

  // 窗口必须真的"显示着"——否则"不抢焦点"就是靠藏窗口作弊
  const state = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return null;
    const b = w.getBounds();
    const d = screen.getPrimaryDisplay().bounds;
    return {
      visible: w.isVisible(),
      focusable: w.isFocusable(),
      focused: w.isFocused(),
      minimizable: w.isMinimizable(),
      bounds: b,
      // 是否完全落在所有显示器之外
      offScreen: !screen.getAllDisplays().some((s) => {
        const a = s.bounds;
        return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
      }),
      primary: d
    };
  });
  check('窗口确实显示了（不是靠隐藏窗口来"不抢焦点"）', !!state && state.visible === true, JSON.stringify(state?.bounds));
  check('窗口被移到屏幕外（屏幕上什么都不出现，不挡任何东西）',
    !!state && state.offScreen === true, JSON.stringify({ offScreen: state?.offScreen, bounds: state?.bounds }));
  check('窗口没有拿到焦点', !!state && state.focused === false, JSON.stringify({ focused: state?.focused }));
  // 用户明确报过"最小化按钮坏了"—— 这次不能再坏：窗口必须可最小化/可激活
  check('最小化按钮仍然可用（窗口可激活、可最小化，不是 WS_EX_NOACTIVATE）',
    !!state && state.focusable === true && state.minimizable === true,
    JSON.stringify({ focusable: state?.focusable, minimizable: state?.minimizable }));

  // 截图必须不是空白（证明渲染真的在跑，没有被"不可激活"影响）
  const shotPath = resolve(DATA_DIR, 'quiet-shot.png');
  await win.screenshot({ path: shotPath, timeout: 20000 });
  const bytes = existsSync(shotPath) ? statSync(shotPath).size : 0;
  const notBlank = await win.evaluate(() => {
    // 用画布上真实存在的元素反证"页面画出来了"
    return {
      toolbarH: document.querySelector('.toolbar')?.getBoundingClientRect().height || 0,
      canvasH: document.querySelector('.canvas')?.getBoundingClientRect().height || 0
    };
  });
  check('截图正常产出且页面真的画出来了（不是空白帧）',
    bytes > 8000 && notBlank.toolbarH > 20 && notBlank.canvasH > 50,
    `${Math.round(bytes / 1024)}KB toolbar=${Math.round(notBlank.toolbarH)} canvas=${Math.round(notBlank.canvasH)}`);

  // 键盘/鼠标事件经 CDP 注入，不依赖系统焦点 —— 必须照常可用
  const typed = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    return (window.__sceneStore.getState().scene.root.children || []).length;
  });
  await win.keyboard.press('Control+z');
  await sleep(500);
  const afterUndo = await win.evaluate(() => (window.__sceneStore.getState().scene.root.children || []).length);
  check('不可激活的窗口里，键盘事件照常送达（Ctrl+Z 有效）',
    typed === 1 && afterUndo === 0, `元素 ${typed} → ${afterUndo}`);

  const fgAfter = foregroundWindow();
  check('整个过程中前台窗口始终没被夺走',
    fgBefore !== null && fgAfter === fgBefore, `before=${fgBefore} after=${fgAfter}`);

  // 用户报过"最小化按钮坏了"：真的点一下最小化 → 确实最小化 → 还原后仍可用
  const minOk = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.minimize();
    await new Promise((r) => setTimeout(r, 400));
    const minimized = w.isMinimized();
    w.restore();
    await new Promise((r) => setTimeout(r, 400));
    return { minimized, restored: !w.isMinimized(), visible: w.isVisible() };
  });
  check('最小化 → 还原功能正常（不再"按钮坏了"）',
    minOk.minimized === true && minOk.restored === true,
    JSON.stringify(minOk));
  // 还原后页面还能交互（证明渲染没被最小化搞坏）
  const aliveAfterRestore = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    return (window.__sceneStore.getState().scene.root.children || []).length;
  });
  check('还原后页面仍然可交互（渲染没被最小化中断）', aliveAfterRestore >= 1, `元素=${aliveAfterRestore}`);

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 第十二批探针（安静启动窗口）：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });