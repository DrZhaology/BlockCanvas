// 存储与缓存管理探针（v0.4.4）
// 覆盖：① 分类占用互斥且可加和（所有分类之和 === data/ + Temp 合计）——修掉"数字对不上账"
//      ② 统计与清理同源（清完再统计，数字真的下降）
//      ③ 红线：清 Chromium 缓存**不会**碰 Local Storage / Preferences 这类状态
//      ④ 系统 Temp 里"属于我们"的文件能被识别 + 手动清理
//      ⑤ 启动时自动清理临时文件（开关为开时）
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, writeFileSync, existsSync, cpSync, readdirSync, unlinkSync, utimesSync } from 'fs';
import { ensureEditor } from './ensure-editor.mjs';
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
  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1400);
  return { app, win, errs };
}

async function main() {
  const DATA_DIR = resolve(SYS_TEMP, 'bc-storage-probe');
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  mkdirSync(DATA_DIR, { recursive: true });
  for (const rel of [resolve(ROOT, 'builtin-extensions'), resolve(ROOT, 'data', 'extensions')]) {
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

  // v0.4.5 第 10 批：新增「素材缩略图缓存」分类（可清理），所以从 8 类变 9 类、
  // 可清理从 3 类变 4 类。断言改成"包含"而不是"等于"，避免每加一类就要改一次。
  ok('拿到分类占用明细（含 v0.4.5 新增的缩略图缓存）',
    Array.isArray(bd.categories) && bd.categories.length >= 9 && !!cat('thumbs'),
    'n=' + bd.categories.length);
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
  // 可清理 = Chromium 缓存 / 临时文件 / 更新包 / 素材缩略图（都是"可再生成"的东西）
  ok('可清理分类正好是那几类可再生成的（缓存 / 临时 / 更新包 / 缩略图）',
    cleanableIds === 'chromiumCache,downloads,temp,thumbs', cleanableIds);
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

  // ============ 便携临时目录（v0.4.4：运行时临时目录收进程序目录） ============
  const tmpDir = join(DATA_DIR, 'tmp');
  ok('程序目录里创建了 data/tmp', existsSync(tmpDir), tmpDir);
  ok('data/tmp/system 存在（Chromium 临时目录已重定向）', existsSync(join(tmpDir, 'system')));
  // 先清一次：system 目录壳必须保留（Chromium 正在用它当临时目录）
  await win.evaluate(() => window.bc.clearStorageCategory('temp'));
  await sleep(300);
  ok('清理临时文件后 system 目录壳仍在（不删内核正在用的目录）', existsSync(join(tmpDir, 'system')));

  mkdirSync(join(tmpDir, 'preview'), { recursive: true });
  writeFileSync(join(tmpDir, 'preview', 'bc-preview-1.html'), BYTES(3000), 'utf-8');
  const bd4 = await win.evaluate(() => window.bc.getStorageBreakdown());
  const tempCat = bd4.categories.find((c) => c.id === 'temp');
  ok('data/tmp 里的文件被计入"临时文件"分类', (tempCat?.bytes ?? 0) >= 3000, String(tempCat?.bytes));
  const sum4 = bd4.categories.reduce((a, c) => a + c.bytes, 0);
  ok('加入 data/tmp 后账目依然对得上', sum4 === bd4.grandTotal, `${sum4} vs ${bd4.grandTotal}`);
  await win.evaluate(() => window.bc.clearStorageCategory('temp'));
  await sleep(350);
  ok('清理"临时文件"会清掉 data/tmp 的内容但保留目录壳',
    !existsSync(join(tmpDir, 'preview', 'bc-preview-1.html')) && existsSync(join(tmpDir, 'preview')),
    JSON.stringify({ file: existsSync(join(tmpDir, 'preview', 'bc-preview-1.html')), dir: existsSync(join(tmpDir, 'preview')) }));

  // ============ 预算兜底（L4）：写进去就不删的目录必须有上限 ============
  // 阈值走 config.json（探针故意调到极小，否则要造几百 MB 假文件才验证得到淘汰逻辑）
  const DL = join(DATA_DIR, 'downloads');
  const NOW = Date.now();
  const backdate = (p, msAgo) => { const t = new Date(NOW - msAgo); utimesSync(p, t, t); };
  mkdirSync(DL, { recursive: true });
  writeFileSync(join(DL, 'old.zip'), BYTES(4096), 'utf-8');     backdate(join(DL, 'old.zip'), 2 * 3600e3);
  writeFileSync(join(DL, 'older.zip'), BYTES(6000), 'utf-8');   backdate(join(DL, 'older.zip'), 3600e3);
  writeFileSync(join(DL, 'newest.zip'), BYTES(6000), 'utf-8');
  writeFileSync(join(DL, 'expired.zip'), BYTES(900), 'utf-8');  backdate(join(DL, 'expired.zip'), 40 * 24 * 3600e3);

  await win.evaluate(() => window.bc.setAppConfig({
    maxDownloadBytes: 7000, maxDownloadAgeDays: 30, maxPreviewFiles: 5, maxTmpBytes: 5000
  }));
  const b1 = await win.evaluate(() => window.bc.enforceStorageBudgets());
  ok('预算：超过 30 天的更新包被清掉（与体积无关）', !existsSync(join(DL, 'expired.zip')));
  ok('预算：下载目录超体积上限时从最旧淘汰，但最近一次永远保留',
    existsSync(join(DL, 'newest.zip')) && !existsSync(join(DL, 'older.zip')) && !existsSync(join(DL, 'old.zip')),
    JSON.stringify({ newest: existsSync(join(DL, 'newest.zip')), older: existsSync(join(DL, 'older.zip')), old: existsSync(join(DL, 'old.zip')), detail: b1.detail }));

  // 预览页按数量保留；临时区总量超限时按时间淘汰，**但跳过 tmp/system**
  const PV = join(DATA_DIR, 'tmp', 'preview');
  const UP = join(DATA_DIR, 'tmp', 'updater');
  const SYSD = join(DATA_DIR, 'tmp', 'system');
  mkdirSync(PV, { recursive: true }); mkdirSync(UP, { recursive: true }); mkdirSync(SYSD, { recursive: true });
  for (let i = 1; i <= 7; i += 1) { const p = join(PV, `bc-preview-${i}.html`); writeFileSync(p, BYTES(10), 'utf-8'); backdate(p, (8 - i) * 60e3); }
  writeFileSync(join(UP, 'a.bin'), BYTES(3000), 'utf-8'); backdate(join(UP, 'a.bin'), 10 * 60e3);
  writeFileSync(join(UP, 'b.bin'), BYTES(3000), 'utf-8'); backdate(join(UP, 'b.bin'), 5 * 60e3);
  writeFileSync(join(SYSD, 'huge.bin'), BYTES(40000), 'utf-8'); backdate(join(SYSD, 'huge.bin'), 30e3);

  const b2 = await win.evaluate(() => window.bc.enforceStorageBudgets());
  const left = readdirSync(PV).filter((f) => f.startsWith('bc-preview-'));
  ok('预算：预览页只留最近 5 个（多的从最旧淘汰）',
    left.length === 5 && !left.includes('bc-preview-1.html') && left.includes('bc-preview-7.html'),
    JSON.stringify({ n: left.length, left }));
  ok('预算：临时区超量时从最旧的开始淘汰', !existsSync(join(UP, 'a.bin')) && existsSync(join(UP, 'b.bin')),
    JSON.stringify({ a: existsSync(join(UP, 'a.bin')), b: existsSync(join(UP, 'b.bin')), detail: b2.detail }));
  ok('预算：绝不碰 tmp/system（Chromium 正在用的运行时目录）', existsSync(join(SYSD, 'huge.bin')));
  // 收尾：别把夹具留给后面的阶段（阶段 B 要断言"启动清理后 Temp 占用为 0"）
  try { rmSync(UP, { recursive: true, force: true }); } catch { /* 忽略 */ }
  try { unlinkSync(join(SYSD, 'huge.bin')); } catch { /* 忽略 */ }

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
  // v0.4.5 第 10 批：9 行（新增「素材缩略图缓存」），可清理 4 行、保留 5 行
  ok('设置页渲染出全部占用明细行（9 行）', ui.rows >= 9, JSON.stringify(ui));
  ok('其中 4 行是可清理的（带清理按钮）', ui.cleanable === 4 && ui.cleanBtns === 4, JSON.stringify(ui));
  ok('其余行标为"保留"', ui.keepTags === ui.rows - ui.cleanable, JSON.stringify(ui));
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
