// ============================================================================
// BlockCanvas · 版本号单一来源同步
// ----------------------------------------------------------------------------
// 只改根目录 version.json 一个文件，本脚本把它同步进 package.json：
//   version  → package.json.version   （Electron app.getVersion() / 更新中心 / 安装包元数据都读它）
//   stage    → package.json.bcStage   （「关于」页显示"版本 x.x.x · 阶段 N …"）
//
// 用法：
//   node tools/sync-version.mjs          同步（有变化才写盘）
//   node tools/sync-version.mjs --check  只检查是否一致，不一致退出码 1（给打包/CI 用）
//
// 调用时机：`pnpm build` 前自动跑（package.json 的 prebuild）、build-exe.ps1 第 0 步、
//          也可手动 `pnpm version:sync`。
// ============================================================================
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_FILE = join(ROOT, 'version.json');
const PKG_FILE = join(ROOT, 'package.json');
const checkOnly = process.argv.includes('--check');

/** 读 JSON（容忍 UTF-8 BOM） */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, ''));
}

const ver = readJson(VERSION_FILE);
const version = String(ver.version ?? '').trim();
const stage = String(ver.stage ?? '').trim();

if (!/^\d+\.\d+(\.\d+)?$/.test(version)) {
  console.error(`[version] version.json 里的 version 不合法：「${version}」（应形如 0.4.2 或 1.0）`);
  process.exit(1);
}

// package.json 在本仓库是 CRLF，写回时保持（避免整文件 diff）
const pkgRaw = readFileSync(PKG_FILE, 'utf-8').replace(/^\uFEFF/, '');
const pkg = JSON.parse(pkgRaw);
const same = pkg.version === version && (pkg.bcStage ?? '') === stage;

if (checkOnly) {
  if (!same) {
    console.error(`[version] 不一致：version.json = ${version} / package.json = ${pkg.version}`);
    console.error('[version] 跑一下 `pnpm version:sync` 或 `node tools/sync-version.mjs` 同步。');
    process.exit(1);
  }
  console.log(`[version] OK：${version}${stage ? ' · ' + stage : ''}`);
  process.exit(0);
}

if (same) {
  console.log(`[version] 已是最新：${version}${stage ? ' · ' + stage : ''}`);
  process.exit(0);
}

const prev = pkg.version;
// bcStage 紧跟在 version 后面（否则会掉到文件末尾，看着像野字段）
const ordered = {};
for (const [k, v] of Object.entries(pkg)) {
  if (k === 'bcStage') continue;
  ordered[k] = k === 'version' ? version : v;
  if (k === 'version' && stage) ordered.bcStage = stage;
}

// JSON.stringify 给的是 LF，仓库里 package.json 是 CRLF —— 写回时统一成 CRLF
const out = (JSON.stringify(ordered, null, 2) + '\n').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
writeFileSync(PKG_FILE, out, 'utf-8');

console.log(`[version] ${prev} → ${version}${stage ? ' · ' + stage : ''}（已写入 package.json）`);
