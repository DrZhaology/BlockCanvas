// 跨平台路径探针（v0.4.4）
// 目的：证明路径判断在 Windows / macOS / Linux 三种语义下都正确。
// 做法：主进程里挂了 __bcPaths（见 src/main/main.ts 的开发态探针钩子），
//       用 Playwright 的 app.evaluate 直接在主进程里跑断言 —— 不需要真的换操作系统。
// 重点回归：旧代码用 `out.startsWith(target + '\\')` 做 zip-slip 判断，
//           在 POSIX 上恒为假 → "导入扩展 zip"一个文件都解不出来。
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';
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

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-paths-probe');
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  mkdirSync(DATA_DIR, { recursive: true });
  for (const rel of [resolve(ROOT, 'builtin-extensions'), resolve(ROOT, 'data', 'extensions')]) {
    if (existsSync(rel)) cpSync(rel, resolve(DATA_DIR, 'extensions'), { recursive: true });
  }
  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1200);

  // 全部断言在主进程里执行（只有主进程才有这些工具）
  const r = await app.evaluate(() => {
    const P = globalThis.__bcPaths;
    const out = { hasHook: !!P };
    if (!P) return out;

    // 注意：evaluate 的沙箱里没有 require —— 只用 __bcPaths 与字符串运算
    const execDir = process.execPath.replace(/[\\/][^\\/]+$/, '');

    // —— 绝对路径判断（三平台通用）——
    out.absWinDriveBack = P.isAbsolutePathAny('C:\\Users\\a\\b.png');
    out.absWinDriveFwd = P.isAbsolutePathAny('C:/Users/a/b.png');
    out.absWinUNC = P.isAbsolutePathAny('\\\\srv\\share\\a.png');
    out.absPosix = P.isAbsolutePathAny('/home/u/a.png');
    out.absMacApp = P.isAbsolutePathAny('/Applications/BlockCanvas.app');
    out.absRelDot = P.isAbsolutePathAny('./assets/x.png');
    out.absRelPlain = P.isAbsolutePathAny('assets/x.png');
    out.absEmpty = P.isAbsolutePathAny('');

    // —— 分隔符互转 ——
    out.webFromWin = P.toWebPath('a\\b\\c');
    out.webKeepPosix = P.toWebPath('/a/b/c');
    out.localWin = P.fromWebPath('a/b/c', 'win32');
    out.localPosix = P.fromWebPath('/a/b/c', 'posix');

    // —— 目录包含判断（核心修复点）——
    out.insidePosixYes = P.isInsideOn('posix', '/app/ext/a.txt', '/app/ext');
    out.insidePosixNo = P.isInsideOn('posix', '/app/ext2/a.txt', '/app/ext');
    out.insidePosixSelf = P.isInsideOn('posix', '/app/ext', '/app/ext');
    out.insidePosixUp = P.isInsideOn('posix', '/app/other/a.txt', '/app/ext');
    out.insideWinYes = P.isInsideOn('win32', 'C:\\App\\ext\\a.txt', 'C:\\App\\ext');
    out.insideWinNo = P.isInsideOn('win32', 'C:\\App\\ext2\\a.txt', 'C:\\App\\ext');
    out.insideWinOtherDrive = P.isInsideOn('win32', 'D:\\App\\ext\\a.txt', 'C:\\App\\ext');

    // 旧写法在 POSIX 上会怎样（用来钉住这个回归）
    out.oldWayPosix = '/app/ext/a.txt'.startsWith('/app/ext' + '\\');

    // —— zip 条目 → 安全绝对路径 ——
    out.zipPosix = P.resolveInside('/app/ext/demo', 'a/b.txt', 'posix');
    out.zipPosixNested = P.resolveInside('/app/ext/demo', 'templates/x.json', 'posix');
    out.zipPosixEscape = P.resolveInside('/app/ext/demo', '../../etc/passwd', 'posix');
    out.zipPosixEscapeMid = P.resolveInside('/app/ext/demo', 'a/../../b.txt', 'posix');
    out.zipWin = P.resolveInside('C:\\App\\ext\\demo', 'templates\\x.json', 'win32');
    out.zipWinFwdEntry = P.resolveInside('C:\\App\\ext\\demo', 'templates/x.json', 'win32');
    out.zipWinEscape = P.resolveInside('C:\\App\\ext\\demo', '..\\..\\Windows\\x.dll', 'win32');

    // —— 程序目录解析（当前机器真实值）——
    const unit = P.installUnitDir();
    out.unitDir = unit;
    out.unitIsAbsolute = P.isAbsolutePathAny(unit);
    out.unitEqualsExecDir = unit === execDir;
    out.baseDir = P.portableBaseDir();
    out.baseIsAbsolute = P.isAbsolutePathAny(out.baseDir);
    return out;
  });

  ok('主进程挂上了跨平台路径工具（__bcPaths）', r.hasHook === true);

  // 1. 绝对路径判断
  ok('Windows 盘符（反斜杠）识别为绝对路径', r.absWinDriveBack === true, String(r.absWinDriveBack));
  ok('Windows 盘符（正斜杠）识别为绝对路径', r.absWinDriveFwd === true, String(r.absWinDriveFwd));
  ok('Windows UNC（\\\\srv\\share）识别为绝对路径', r.absWinUNC === true, String(r.absWinUNC));
  ok('POSIX 绝对路径（/home/u/a.png）识别为绝对路径', r.absPosix === true, String(r.absPosix));
  ok('macOS .app 内路径识别为绝对路径', r.absMacApp === true, String(r.absMacApp));
  ok('./ 相对路径不误判为绝对路径', r.absRelDot === false, String(r.absRelDot));
  ok('裸相对路径不误判为绝对路径', r.absRelPlain === false, String(r.absRelPlain));
  ok('空串不误判为绝对路径', r.absEmpty === false, String(r.absEmpty));

  // 2. 分隔符互转
  ok('toWebPath：Windows 路径 → 正斜杠', r.webFromWin === 'a/b/c', String(r.webFromWin));
  ok('toWebPath：POSIX 路径保持不变', r.webKeepPosix === '/a/b/c', String(r.webKeepPosix));
  ok('fromWebPath(win32)：正斜杠 → 反斜杠', r.localWin === 'a\\b\\c', String(r.localWin));
  ok('fromWebPath(posix)：正斜杠原样保留', r.localPosix === '/a/b/c', String(r.localPosix));

  // 3. 目录包含判断（三平台语义）
  ok('POSIX：子文件在父目录内 → true', r.insidePosixYes === true, String(r.insidePosixYes));
  ok('POSIX：同前缀但不同目录（/app/ext2）→ false', r.insidePosixNo === false, String(r.insidePosixNo));
  ok('POSIX：目录自身 → true', r.insidePosixSelf === true, String(r.insidePosixSelf));
  ok('POSIX：已上跳的路径 → false', r.insidePosixUp === false, String(r.insidePosixUp));
  ok('Windows：子文件在父目录内 → true', r.insideWinYes === true, String(r.insideWinYes));
  ok('Windows：同前缀不同目录 → false', r.insideWinNo === false, String(r.insideWinNo));
  ok('Windows：不同盘符 → false', r.insideWinOtherDrive === false, String(r.insideWinOtherDrive));
  ok('【回归钉】旧写法 startsWith(dir + "\\\\") 在 POSIX 上确实为 false', r.oldWayPosix === false, String(r.oldWayPosix));

  // 4. zip 条目解析（防 zip-slip）
  ok('POSIX：正常条目解析到父目录内', r.zipPosix === '/app/ext/demo/a/b.txt', String(r.zipPosix));
  ok('POSIX：多级条目解析正确', r.zipPosixNested === '/app/ext/demo/templates/x.json', String(r.zipPosixNested));
  ok('POSIX：../../ 逃逸被拒绝（返回 null）', r.zipPosixEscape === null, String(r.zipPosixEscape));
  ok('POSIX：夹在中间的 ../ 逃逸也被拒绝', r.zipPosixEscapeMid === null, String(r.zipPosixEscapeMid));
  ok('Windows：反斜杠条目解析正确', r.zipWin === 'C:\\App\\ext\\demo\\templates\\x.json', String(r.zipWin));
  ok('Windows：正斜杠条目也能解析正确', r.zipWinFwdEntry === 'C:\\App\\ext\\demo\\templates\\x.json', String(r.zipWinFwdEntry));
  ok('Windows：..\\ 逃逸被拒绝', r.zipWinEscape === null, String(r.zipWinEscape));

  // 5. 程序目录（当前机器真实值，开发态 = exe 所在目录）
  ok('installUnitDir() 返回绝对路径', r.unitIsAbsolute === true, String(r.unitDir));
  ok('开发态 installUnitDir() = exe 所在目录', r.unitEqualsExecDir === true, String(r.unitDir));
  ok('portableBaseDir() 返回绝对路径', r.baseIsAbsolute === true, String(r.baseDir));

  // 6. 端到端：data/ 与扩展目录仍在，且能读出来（说明初始化没被路径改动弄坏）
  const dataOk = await win.evaluate(async () => {
    try {
      const list = await window.bc.listProjects();
      return { ok: true, isArray: Array.isArray(list) };
    } catch (e) { return { ok: false, err: String(e) }; }
  });
  ok('data/ 初始化正常（能列出项目）', dataOk.ok === true && dataOk.isArray === true, JSON.stringify(dataOk));

  ok('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  console.log(`\n===== 跨平台路径探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
