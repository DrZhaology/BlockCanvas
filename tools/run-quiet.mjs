// BlockCanvas · 「安静模式」跑任意 npm 脚本（v0.4.5 第 12 批）
//
// 用途：你一边做别的事、一边让程序在后台跑（开发/截图/探针），
// 不希望窗口突然弹到最前面抢走焦点。
//
//   pnpm dev:quiet      # = electron-vite dev，但窗口不可激活
//   pnpm build:quiet    # = electron-vite build（本来就不开窗口，仅保持一致）
//   node tools/run-quiet.mjs <任意 pnpm 脚本名>
//
// 原理：把 BC_NO_FOCUS=1 传给子进程；主进程看到它就用
// `focusable: false`（Windows: WS_EX_NOACTIVATE）创建窗口 —— 窗口照常显示、照常渲染、
// 任务栏有图标，但**永远不会被激活**，也就不会把你正在用的窗口顶掉。
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = process.argv[2];

if (!script) {
  console.error('用法：node tools/run-quiet.mjs <pnpm 脚本名>   例如 node tools/run-quiet.mjs dev');
  process.exit(2);
}

const child = spawn('pnpm', ['run', script], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, BC_NO_FOCUS: '1' }
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (e) => {
  console.error('[run-quiet] 启动失败：', e.message);
  process.exit(1);
});