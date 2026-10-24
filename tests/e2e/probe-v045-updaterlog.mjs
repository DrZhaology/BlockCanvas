// v0.4.5 更新器日志验收
// 用法：node tests/e2e/probe-v045-updaterlog.mjs
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, readFileSync } from 'fs';

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

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-ulog');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(900);

  // 启动就应该写了一条
  const path = await win.evaluate(() => window.bc.updateLogPath());
  check('能拿到更新日志路径', typeof path === 'string' && path.endsWith('.log'), path || '(空)');
  check('日志文件已创建在 data/logs 下',
    !!path && existsSync(path) && path.replace(/\\/g, '/').includes('/logs/'),
    path ? path.replace(/\\/g, '/') : '');

  const content = path && existsSync(path) ? readFileSync(path, 'utf8') : '';
  check('启动时就记了一条（含版本号）',
    /应用启动 v\d+\.\d+\.\d+/.test(content),
    content.split(/\r?\n/).filter(Boolean)[0] || '(空文件)');

  // 读取接口（界面上的"查看日志"会用它）
  const tail = await win.evaluate(() => window.bc.updateLogTail(5));
  check('updateLogTail 能读到内容', typeof tail === 'string' && tail.trim().length > 0,
    (tail || '').split(/\r?\n/).filter(Boolean).slice(-1)[0] || '(空)');

  // 直接触发一次"检测更新"：会走 fetchReleases → 每个镜像都写一行
  const before = content.split(/\r?\n/).filter(Boolean).length;
  await win.evaluate(() => window.bc.checkUpdate());
  await sleep(6000);
  const after = path && existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = after.split(/\r?\n/).filter(Boolean);
  check('检测更新后日志有新增（说明拉取过程被记录）',
    lines.length > before,
    `行数 ${before} → ${lines.length}`);
  check('日志里能看到拉取/镜像相关记录',
    /拉取发行版列表|成功|失败|镜像/.test(after),
    lines.slice(-3).join(' | ') || '(无)');

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });