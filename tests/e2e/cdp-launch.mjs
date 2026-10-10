// 沙箱友好启动器：直接 spawn electron（stdio inherit，不走命名管道），
// 再用 CDP 端口连上 Playwright。
// 背景：受限沙箱下 Playwright 的 electron.launch 需要命名管道 → spawn EPERM。
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { resolve } from 'path';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { chromium } = require('playwright');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动 BlockCanvas（已构建的 out/），返回 { win, app, close }。
 * opts: { dataDir, port, extraArgs }
 */
export async function launchApp(opts = {}) {
  const ROOT = opts.root ?? process.cwd();
  const DATA_DIR = opts.dataDir ?? resolve(tmpdir(), 'bc-cdp-' + process.pid);
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const port = opts.port ?? 9333;
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    electronPath,
    ['.', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, ...(opts.extraArgs ?? [])],
    { cwd: ROOT, env, stdio: 'inherit', detached: false }
  );

  let browser = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 });
      break;
    } catch {
      await sleep(400);
    }
  }
  if (!browser) { try { child.kill(); } catch {} throw new Error('CDP 连接超时'); }

  let win = null;
  const t2 = Date.now() + 20000;
  while (Date.now() < t2) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    win = pages.find((p) => !p.url().startsWith('devtools://')) ?? null;
    if (win) break;
    await sleep(300);
  }
  if (!win) { try { await browser.close(); } catch {} try { child.kill(); } catch {} throw new Error('没等到窗口'); }

  const close = async () => {
    try { await browser.close(); } catch {}
    try { child.kill(); } catch {}
    await sleep(500);
  };
  return { win, browser, app: child, close };
}
