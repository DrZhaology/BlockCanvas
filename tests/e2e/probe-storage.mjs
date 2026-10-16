// 存储与缓存管理探针（v0.4.4）
// 覆盖：① 分类占用互斥且可加和（所有分类之和 === data/ + Temp 合计）——修掉"数字对不上账"
//      ② 统计与清理同源（清完再统计，数字真的下降）
//      ③ 红线：清 Chromium 缓存**不会**碰 Local Storage / Preferences 这类状态
//      ④ 系统 Temp 里"属于我们"的文件能被识别 + 手动清理
//      ⑤ 启动时自动清理临时文件（开关为开时）
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, writeFileSync, existsSync, cpSync } from 'fs';
const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + '  [' + (extra ?? '') + ']'); }
};

const SYS_TEMP = tmpdir();
const TEMP_FILES = ['bc-preview-probe1.html', 'bc-preview-probe2.html'];
const TEMP_DIR = 'bc-updater-probe1';
const BYTES = (n) => 'x'.repeat(n);

function seedTempFiles() {
  for (const f of TEMP_FILES) writeFileSync(join(SYS_TEMP, f), BYTES(2048), 'utf-8');
  mkdirSync(join(SYS_TEMP, TEMP_DIR), { recursive: true });
  writeFileSync(join(SYS_TEMP, TEMP_DIR, 'apply-update.bat'), BYTES(1024), 'utf-8');
}
function tempFilesGone() {
  const filesGone = TEMP_FILES.every((f) => !existsSync(join(SYS_TEMP, f)));
  const dirGone = !existsSync(join(SYS_TEMP, TEMP_DIR));
  return { filesGone, dirGone };
}

function seedDataDir(DATA_DIR, cfg) {
  mkdirSync(join(DATA_DIR, 'projects'), { recursive: true });
  mkdirSync(join(DATA_DIR, 'backups', 'demo'), { recursive: true });
  mkdirSync(join(DATA_DIR, 'extensions', 'plugins', 'demo'), { recursive: true });
  mkdirSync(join(DATA_DIR, 'downloads'), { recursive: true });
  mkdirSync(join(DATA_DIR, 'user-data', 'Cache'), { recursive: true });
  mkdirSync(join(DATA_DIR, 'user-data', 'Code Cache', 'js'), { recursive: true });
  mkdirSync(join(DATA_DIR, 'user-data', 'Local Storage', 'leveldb'), { recursive: true });

  writeFileSync(join(DATA_DIR, 'projects', 'demo.bcproj'), JSON.stringify({ name: 'demo', scene: { root: { id: 'root', type: 'div', style: {}, children: [] } }, meta: { elementCount: 1 } }), 'utf-8');
  writeFileSync(join(DATA_DIR, 'backups', 'demo', 'snap-1.bcproj'), BYTES(3000), 'utf-8');
  writeFileSync(join(DATA_DIR, 'extensions', 'plugins', 'demo', 'plugin.json'), BYTES(800), 'utf-8');
  writeFileSync(join(DATA_DIR, 'downloads', 'old.zip'), BYTES(4096), 'utf-8');
  // —— 缓存（可清）——
  writeFileSync(join(DATA_DIR, 'user-data', 'Cache', 'data_0'), BYTES(20000), 'utf-8');
  writeFileSync(join(DATA_DIR, 'user-data', 'Code Cache', 'js', 'x.js'), BYTES(10000), 'utf-8');
  // —— 状态（绝不能被清）——
  writeFileSync(join(DATA_DIR, 'user-data', 'Local Storage', 'leveldb', 'x.ldb'), BYTES(5000), 'utf-8');
  writeFileSync(join(DATA_DIR, 'user-data', 'Preferences'), BYTES(1200), 'utf-8');
  mkdirSync(join(DATA_DIR, 'user-data', 'Session Storage'), { recursive: true });
  writeFileSync(join(DATA_DIR, 'user-data', 'Session Storage', 'keep.marker'), BYTES(900), 'utf-8');

  writeFileSync(join(DATA_DIR, 'config.json'), JSON.stringify(cfg, null, 2), 'utf-8');
}

async function launch(DATA_DIR) {
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1400);
  return { app, win, errs };
}

async function main() {
  const DATA_DIR = resolve(SYS_TEMP, 'bc-storage-probe');
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  mkdirSync(DATA_DIR, { recursive: true });
  for (const rel of [resolve(ROOT, 'extensions'), resolve(ROOT, 'data', 'extensions')]) {
    if (existsSync(rel)) cpSync(rel, resolve(DATA_DIR, 'extensions'), { recursive: true });
  }

  // ============ 阶段 A：开关关闭 → 临时文件应保留，可被识别与手动清理 ============
  try { rmSync(join(SYS_TEMP, TEMP_DIR), { recursive: true, force: true }); } catch { /* 忽略 */ }
  seedTempFiles();
  seedDataDir(DATA_DIR, {
    autoCleanTempOnStartup: false,
    autoCleanCacheOnStartup: false,
    autoCleanOrphansOnStartup: false
  });

  let { app, win, errs } = await launch(DATA_DIR);

  const bd = await win.evaluate(() => window.bc.getStorageBreakdown());
  const cat = (id) => bd.categories.find((c) => c.id === id) || { bytes: 0, cleanable: false, label: id };

  ok('拿到分类占用明细', Array.isArray(bd.categories) && bd.categories.length === 8, 'n=' + bd.categories.length);
  ok('Chromium 缓存被识别（Cache + Code Cache）', cat('chromiumCache').bytes >= 30000, String(cat('chromiumCache').bytes));
  ok('系统 Temp 里属于我们的文件被识别', cat('temp').bytes >= 2048 * 2 + 1024, String(cat('temp').bytes));
  ok('更新包下载被识别', cat('downloads').bytes >= 4096, String(cat('downloads').bytes));
  ok('项目工程被识别', cat('projects').bytes > 0, String(cat('projects').bytes));
  ok('历史快照被识别', cat('backups').bytes >= 3000, String(cat('backups').bytes));
  ok('扩展与插件包被识别', cat('extensions').bytes >= 800, String(cat('extensions').bytes));

  // —— 核心：分类互斥且可加和（修掉"数字对不上账"）——
  const sum = bd.categories.reduce((a, c) => a + c.bytes, 0);
  ok('所有分类之和 === data/ + Temp 合计（账目对得上）', sum === bd.grandTotal, `sum=${sum} grand=${bd.grandTotal}`);
  ok('合计 === dataTotal + tempTotal', bd.grandTotal === bd.dataTotal + bd.tempTotal, `${bd.dataTotal}+${bd.tempTotal}=${bd.grandTotal}`);

  // —— 可清 / 不可清 标记 ——
  const cleanableIds = bd.categories.filter((c) => c.cleanable).map((c) => c.id).sort().join(',');
  ok('只有 3 类标记为可清理', cleanableIds === 'chromiumCache,downloads,temp', cleanableIds);
  ok('"界面偏好与会话" 被标记为不可清', cat('userState').cleanable === false, String(cat('userState').bytes));
  ok('"界面偏好与会话" 确实统计到了状态文件', cat('userState').bytes >= 5000 + 1200, String(cat('userState').bytes));

  // —— 红线：清 Chromium 缓存不能碰状态文件 ——
  const cacheBefore = cat('chromiumCache').bytes;
  const clearCacheRes = await win.evaluate(() => window.bc.clearStorageCategory('chromiumCache'));
  await sleep(400);
  ok('清理 Chromium 缓存返回 ok', clearCacheRes.ok === true, JSON.stringify(clearCacheRes));
  ok('清理 Chromium 缓存释放了空间', clearCacheRes.freedBytes >= 30000, String(clearCacheRes.freedBytes));
  // 注意：Chromium 会原子重写 Preferences（写临时文件再改名），断言瞬间可能正好不存在；
  // 所以用 "Preferences 或 Preferences.bad 任一在" 来判断"状态文件没被我们删掉"。
  const localMarker = join(DATA_DIR, 'user-data', 'Local Storage', 'leveldb', 'x.ldb');
  const sessionMarker = join(DATA_DIR, 'user-data', 'Session Storage', 'keep.marker');
  const prefA = join(DATA_DIR, 'user-data', 'Preferences');
  const prefB = join(DATA_DIR, 'user-data', 'Preferences.bad');
  const survived = existsSync(localMarker) && existsSync(sessionMarker) && (existsSync(prefA) || existsSync(prefB));
  ok('【红线】Local Storage / Session Storage / Preferences 都没被碰', survived === true,
    `local=${existsSync(localMarker)} session=${existsSync(sessionMarker)} pref=${existsSync(prefA) || existsSync(prefB)}`);
  const bd2 = await win.evaluate(() => window.bc.getStorageBreakdown());
  const cat2 = (id) => bd2.categories.find((c) => c.id === id) || { bytes: 0 };
  ok('清理后 Chromium 缓存占用真的下降（统计与清理同源）', cat2('chromiumCache').bytes < cacheBefore, `${cacheBefore} → ${cat2('chromiumCache').bytes}`);
  ok('清理后 "界面偏好与会话" 大小不变', cat2('userState').bytes >= 5000 + 1200, String(cat2('userState').bytes));

  // —— 不可清的分类：调用应被拒绝 ——
  const refuse = await win.evaluate(() => window.bc.clearStorageCategory('projects'));
  ok('清理"项目工程文件"被拒绝（不能自动删用户数据）', refuse.ok === false && !!refuse.error, JSON.stringify(refuse));
  ok('拒绝后项目文件仍在', existsSync(join(DATA_DIR, 'projects', 'demo.bcproj')));

  // —— 手动清临时文件 ——
  const clearTemp = await win.evaluate(() => window.bc.clearStorageCategory('temp'));
  await sleep(300);
  const tg = tempFilesGone();
  ok('手动清理后系统 Temp 里我们的文件被删干净', tg.filesGone && tg.dirGone, JSON.stringify(tg));
  ok('清理临时文件释放了空间', clearTemp.freedBytes >= 2048 * 2 + 1024, String(clearTemp.freedBytes));

  // —— 一键清理（可清的三类）——
  const all = await win.evaluate(() => window.bc.clearAllCleanable());
  ok('一键清理全部"可清"分类成功', all.ok === true, JSON.stringify(all));

  // ============ 设置页 UI：占用明细要真的渲染出来 ============
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-settings')));
  await win.waitForSelector('.fluent-settings-page', { timeout: 8000 });
  await sleep(400);
  // 切到「存储」分区
  await win.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.fluent-settings-page button, .fluent-settings-page [role=button]'));
    const target = btns.find((b) => /存储/.test(b.textContent || ''));
    if (target) target.click();
  });
  await sleep(700);
  const ui = await win.evaluate(() => ({
    rows: document.querySelectorAll('.bc-storage-row').length,
    cleanable: document.querySelectorAll('.bc-storage-row.is-cleanable').length,
    cleanBtns: document.querySelectorAll('.bc-storage-btn').length,
    keepTags: document.querySelectorAll('.bc-storage-keep').length,
    total: (document.querySelector('.bc-storage-total')?.textContent || '').replace(/\s+/g, ' ').trim()
  }));
  ok('设置页渲染出 8 行占用明细', ui.rows === 8, JSON.stringify(ui));
  ok('其中 3 行是可清理的（带清理按钮）', ui.cleanable === 3 && ui.cleanBtns === 3, JSON.stringify(ui));
  ok('其余 5 行标为"保留"', ui.keepTags === 5, JSON.stringify(ui));
  ok('合计行同时显示 data/ 与 Temp', /data\/\s*目录/.test(ui.total) && /系统 Temp/.test(ui.total), ui.total);

  ok('阶段 A 无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));
  await app.close();
  await sleep(500);

  // ============ 阶段 B：开关打开 → 启动时自动清理临时文件 ============
  try { rmSync(join(SYS_TEMP, TEMP_DIR), { recursive: true, force: true }); } catch { /* 忽略 */ }
  seedTempFiles();
  seedDataDir(DATA_DIR, {
    autoCleanTempOnStartup: true,
    autoCleanCacheOnStartup: false,
    autoCleanOrphansOnStartup: false
  });
  const launched2 = await launch(DATA_DIR);
  app = launched2.app; win = launched2.win; errs = launched2.errs;
  await sleep(800);
  const tg2 = tempFilesGone();
  ok('启动时自动清理临时文件（开关为开）', tg2.filesGone && tg2.dirGone, JSON.stringify(tg2));
  const bd3 = await win.evaluate(() => window.bc.getStorageBreakdown());
  ok('启动清理后 Temp 分类占用为 0', (bd3.categories.find((c) => c.id === 'temp')?.bytes ?? -1) === 0, String(bd3.categories.find((c) => c.id === 'temp')?.bytes));
  ok('阶段 B 无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));
  await app.close();

  console.log(`\n===== 存储与缓存管理探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
