#!/usr/bin/env node
// BlockCanvas · Git 忽略规则体检（防"切分支就冒出一堆生成物"）
// ---------------------------------------------------------------------------
// 背景（这个脚本存在的原因）：
//   仓库里有两条长期分支 —— `main`（发布台账，一个小版本一条提交，天生落后）
//   与 `alpha`（开发线，天天在提交）。`.gitignore` 属于版本控制内容，于是
//   "alpha 上新加一条忽略规则" 与 "main 上还没有这条规则" 会长期并存。
//   结果：同一批生成物（例如 tests/e2e/shots-v044/*.png）在 alpha 上被忽略、
//   切到 main 就变成"未跟踪"，GitHub Desktop 的改动列表里看着像
//   "暂存区突然多出几张图片"。
//
// 兜底机制：
//   `.git/info/exclude` 位于 .git/ 内部、**不进版本控制**，因此它对**所有分支**
//   完全一致 —— 切到 main / backup-* / rescue-* 都一样生效。本脚本维护的就是它。
//
// 用法：
//   node tools/git-ignore-doctor.mjs            体检（有问题退出码 1）
//   node tools/git-ignore-doctor.mjs --quiet    只输出问题（post-checkout 钩子用）
//   node tools/git-ignore-doctor.mjs --fix      按下面的清单重写 .git/info/exclude 兜底段
//   node tools/git-ignore-doctor.mjs --install-hook   装 post-checkout 钩子（切分支后自动体检）
//   node tools/git-ignore-doctor.mjs --uninstall-hook 卸载该钩子
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BEGIN = '# >>> BlockCanvas 生成物兜底（由 tools/git-ignore-doctor.mjs 维护，请勿手改）>>>';
const END = '# <<< BlockCanvas 生成物兜底 <<<';

/**
 * 需要"跨分支兜底"的生成物规则（唯一真相来源）。
 * ⚠ 只写通配，不写具体版本号目录 —— 这是本机制不腐化的关键。
 */
const GUARD_PATTERNS = [
  '# ---- 依赖 ----',
  'node_modules/',
  '',
  '# ---- 构建 / 打包 / 运行时数据 ----',
  '/out/',
  '/dist/',
  '/release/',
  '/data/',
  'builder-debug.yml',
  '',
  '# ---- 日志与临时配置 ----',
  '*.log',
  'electron.vite.config.*.mjs',
  '',
  '# ---- e2e 生成物：一条通配覆盖 shots / shots-mc / shots-v041 / shots-v042 /',
  '#      shots-v044 / 以及未来所有版本目录（这正是"越加越多、越加越漂"的病根）',
  '/tests/e2e/shots*/',
  '/tests/e2e/*.html',
  '/tests/e2e/report*.txt',
  '',
  '# ---- 编辑器 / 系统 ----',
  '.vscode/*',
  '!.vscode/extensions.json',
  '.idea/',
  '.DS_Store',
  'Thumbs.db'
];

/** `.gitignore` 里必须存在的"通配化"写法（写成逐个目录列举就会再次漂移） */
const REQUIRED_GITIGNORE_PATTERN = 'tests/e2e/shots*/';
/** 明确的"坏味道"：把带版本号的截图目录逐个列出来 */
const SMELLY_GITIGNORE_PATTERN = /^tests\/e2e\/shots-v\d+\/?$/m;

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const FIX = argv.includes('--fix');
const INSTALL_HOOK = argv.includes('--install-hook');
const UNINSTALL_HOOK = argv.includes('--uninstall-hook');

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    .toString('utf-8');
}
function tryGit(args) {
  try { return git(args); } catch { return null; }
}

const problems = [];
const details = [];
const notes = [];
const ok = [];
function fail(msg, detailLines = []) { problems.push(msg); details.push(...detailLines); }
function note(msg) { notes.push(msg); }
function pass(msg) { ok.push(msg); }

function say(...a) { if (!QUIET) console.log(...a); }

const root = resolve(tryGit(['rev-parse', '--show-toplevel'])?.trim() || process.cwd());
process.chdir(root);
const gitDir = resolve(tryGit(['rev-parse', '--git-dir'])?.trim() || join(root, '.git'));
const excludePath = join(gitDir, 'info', 'exclude');
const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() || '(detached)';

const blockBody = [BEGIN,
  '# ---------------------------------------------------------------------------',
  '# 为什么这里还要再写一遍 .gitignore 里已有的规则？',
  '#   本文件位于 .git/info/ 下，**不进版本控制**，因此它的内容对「所有分支」完全一致。',
  '#   而 main（发布台账）天生落后于 alpha（开发线），每次 alpha 新增一条忽略规则',
  '#   （例如 tests/e2e/shots-v044/），切到 main 时那批生成物就会从"被忽略"变成',
  '#   "未跟踪"——在 GitHub Desktop 里表现为"暂存区突然多出几张图片"。',
  '#   把同一套规则兜在这里，就再也不受分支新旧影响。',
  '# 维护：node tools/git-ignore-doctor.mjs（体检）/ --fix（按下面这份清单重写本段）',
  '# ---------------------------------------------------------------------------',
  '',
  ...GUARD_PATTERNS,
  END].join('\n');

// ============ 1. 兜底段：体检 / 修复 ============
const excludeRaw = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : '';
const normalized = excludeRaw.replace(/\r\n/g, '\n');
const hasBlock = normalized.includes(BEGIN) && normalized.includes(END);

function writeBlock() {
  mkdirSync(join(gitDir, 'info'), { recursive: true });
  let base;
  if (hasBlock) {
    const start = normalized.indexOf(BEGIN);
    const end = normalized.indexOf(END) + END.length;
    base = normalized.slice(0, start).replace(/\n+$/, '\n') + normalized.slice(end).replace(/^\n+/, '\n');
  } else {
    base = normalized.replace(/\n*$/, '\n');
  }
  const merged = base.replace(/\n+$/, '\n') + '\n' + blockBody + '\n';
  writeFileSync(excludePath, merged, 'utf-8');
}

if (INSTALL_HOOK || UNINSTALL_HOOK) {
  const hookPath = join(gitDir, 'hooks', 'post-checkout');
  if (UNINSTALL_HOOK) {
    if (existsSync(hookPath) && readFileSync(hookPath, 'utf-8').includes('git-ignore-doctor')) {
      rmSync(hookPath);
      say('已卸载 post-checkout 钩子');
    } else {
      say('没有我们装的 post-checkout 钩子，跳过');
    }
    process.exit(0);
  }
  mkdirSync(join(gitDir, 'hooks'), { recursive: true });
  const hook = `#!/bin/sh
# BlockCanvas · 切分支后自动体检忽略规则（由 tools/git-ignore-doctor.mjs --install-hook 安装）
# 只在"有问题"时才有输出；永远 exit 0，绝不影响 checkout 本身。
# 老分支（还没引入本脚本的分支）上静默跳过，不要报错刷屏。
command -v node >/dev/null 2>&1 || exit 0
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$ROOT" ] || exit 0
[ -f "$ROOT/tools/git-ignore-doctor.mjs" ] || exit 0
# >&2 把「体检结论」转到 stderr（GitHub Desktop / 终端都能看到）；
# 随后的 2>/dev/null 只吞掉 node 自己的异常输出（fd1 已先复制，结论不受影响）。
node "$ROOT/tools/git-ignore-doctor.mjs" --quiet >&2 2>/dev/null || true
exit 0
`;
  writeFileSync(hookPath, hook, 'utf-8');
  try { chmodSync(hookPath, 0o755); } catch { /* Windows 上通常无需执行位 */ }
  say('已安装 post-checkout 钩子：以后每次切分支都会自动体检一次');
  process.exit(0);
}

const missing = GUARD_PATTERNS.filter((l) => l && !l.startsWith('#') && !normalized.includes(l));
if (FIX) {
  // ⚠ 总是重写（而不是"只在缺规则时才写"）：这样兜底段里的**多余、过期**行
  //   也会一并被清掉，本文件与 GUARD_PATTERNS 永远严格一致，可反复执行。
  writeBlock();
  pass('已按 GUARD_PATTERNS 重写 .git/info/exclude 兜底段（多余/过期的行已清除）');
} else if (!hasBlock || missing.length > 0) {
  fail(
    `.git/info/exclude ${hasBlock ? '缺少规则' : '没有兜底段'}（当前分支 ${branch}）：${missing.join(' / ') || '(整段缺失)'}`
    + ' → 跑 `node tools/git-ignore-doctor.mjs --fix` 修复'
  );
} else {
  pass('.git/info/exclude 兜底规则齐全（对所有分支生效，切分支不会再冒生成物）');
}

// ============ 2. 当前分支 .gitignore 是否已"通配化" ============
const giPath = join(root, '.gitignore');
const gi = existsSync(giPath) ? readFileSync(giPath, 'utf-8').replace(/\r\n/g, '\n') : '';
if (!gi.includes(REQUIRED_GITIGNORE_PATTERN)) {
  fail(`.gitignore 缺少通配规则 \`${REQUIRED_GITIGNORE_PATTERN}\``);
} else {
  pass(`.gitignore 用的是通配规则 \`${REQUIRED_GITIGNORE_PATTERN}\`（以后加版本目录不必再改它）`);
}
if (SMELLY_GITIGNORE_PATTERN.test(gi)) {
  note('.gitignore 里仍有「shots-v数字/」这种逐个列举的旧写法 —— 虽然兜底已生效，但建议删掉：它每加一版就要改一次，正是漂移的来源');
}

// ============ 3. 其他分支的 .gitignore 是否落后（仅提示，兜底已覆盖） ============
const locals = (tryGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads']) || '')
  .split('\n').map((s) => s.trim()).filter(Boolean);
const lagging = [];
for (const b of locals) {
  if (b === branch) continue;
  const content = tryGit(['show', `${b}:.gitignore`]);
  if (content === null) continue;
  if (!content.includes(REQUIRED_GITIGNORE_PATTERN)) lagging.push(b);
}
if (lagging.length > 0) {
  note(`这些分支的 .gitignore 还没通配化：${lagging.join(' / ')}（兜底已生效，切过去不会看到生成物；等它们下次随发布/合并同步即可）`);
}

// ============ 4. 现在这一刻的真实状态（= GitHub Desktop 看到的东西） ============
const staged = ((tryGit(['diff', '--cached', '--name-only', '-z']) || '').split('\0').filter(Boolean));
const untrackedRaw = tryGit(['ls-files', '--others', '--exclude-standard', '-z']) || '';
const untracked = untrackedRaw.split('\0').filter(Boolean);
const modified = ((tryGit(['diff', '--name-only', '-z']) || '').split('\0').filter(Boolean));

if (untracked.length === 0) {
  pass('工作区没有"未跟踪文件"（切分支不会再凭空冒出生成物）');
} else {
  const lines = untracked.slice(0, 20).map((f) => '        ' + f);
  if (untracked.length > 20) lines.push(`        …… 还有 ${untracked.length - 20} 个`);
  lines.push('        → 若是生成物，把它们加进 tools/git-ignore-doctor.mjs 的 GUARD_PATTERNS 再跑 --fix');
  fail(`工作区有 ${untracked.length} 个未跟踪文件会被 GitHub Desktop 列出来（= 你看到的"暂存区多了几张图"）`, lines);
}
if (staged.length > 0) {
  note(`当前**真的**有 ${staged.length} 项已暂存（这才是暂存区，和"未跟踪"不是一回事）：${staged.slice(0, 5).join(' / ')}`);
}
if (modified.length > 0) {
  note(`当前有 ${modified.length} 个已修改未暂存的文件：${modified.slice(0, 5).join(' / ')}`);
}

// ============ 输出 ============
say(`\nBlockCanvas · Git 忽略规则体检（分支：${branch}）`);
say('─'.repeat(64));
for (const m of ok) say('  ✓ ' + m);
for (const m of notes) say('  · ' + m);
for (const m of problems) say('  ✗ ' + m);
if (details.length > 0) {
  say('');
  for (const d of details) say(d);
}
say('─'.repeat(64));
if (problems.length === 0) {
  say('  ✓ 一切正常：切到任何分支都不会看到生成物');
  process.exit(0);
}
if (!QUIET) say(`  ✗ ${problems.length} 项需要处理`);
process.exit(1);
