// 扩展目录统一 + 内置插件种子 验收
// 用法：node tests/e2e/probe-v045-extdir.mjs
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs';

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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-extdir');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  // 故意不预置扩展：要看程序自己会不会把内置插件种进来

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(1500);

  // ---------- 目录统一 ----------
  check('仓库根目录不再有 extensions/（已改名 builtin-extensions/）',
    !existsSync(join(ROOT, 'extensions')) && existsSync(join(ROOT, 'builtin-extensions')),
    existsSync(join(ROOT, 'builtin-extensions')) ? 'builtin-extensions 存在' : 'builtin-extensions 不存在');

  // ---------- 内置插件被种进 data/extensions ----------
  const extDir = join(DATA_DIR, 'extensions');
  const pluginDir = join(extDir, 'plugins', 'dark-mode');
  check('data/extensions/ 已创建（运行时唯一扩展目录）', existsSync(extDir), extDir);
  check('内置插件 dark-mode 被种进 data/extensions/plugins/',
    existsSync(join(pluginDir, 'manifest.json')) && existsSync(join(pluginDir, 'index.js')),
    existsSync(pluginDir) ? readdirSync(pluginDir).join(', ') : '目录不存在');

  const resDir = join(extDir, 'resources', 'showcase-templates');
  check('内置资源包 showcase-templates 也被种进来',
    existsSync(join(resDir, 'manifest.json')),
    existsSync(resDir) ? 'manifest.json 存在' : '目录不存在');

  const manifest = existsSync(join(pluginDir, 'manifest.json'))
    ? JSON.parse(readFileSync(join(pluginDir, 'manifest.json'), 'utf8'))
    : null;
  check('插件清单可读且格式正确（id/type/main）',
    !!manifest && manifest.id === 'dark-mode' && manifest.type === 'plugin' && !!manifest.main,
    manifest ? `id=${manifest.id} type=${manifest.type} main=${manifest.main}` : '读不到');

  // ---------- 扩展中心能看到它 ----------
  const scanned = await win.evaluate(async () => {
    const api = window.bc;
    const fn = api.scanExtensions || api.extScan;
    if (!fn) return { missing: true };
    const r = await fn();
    return { plugins: (r?.plugins || []).map((p) => `${p.id}:${p.enabled}`), resources: (r?.resources || []).length };
  });
  check('扩展中心接口能扫到内置插件',
    !scanned.missing && (scanned.plugins || []).some((p) => p.startsWith('dark-mode')),
    scanned.missing ? '找不到 scanExtensions 接口' : (scanned.plugins || []).join(', ') || '没有插件');

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