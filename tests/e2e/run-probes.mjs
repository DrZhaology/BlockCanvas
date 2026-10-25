// BlockCanvas · 探针批量运行器（v0.4.5 第 11 批）
//
// 背景：`pnpm test:probe` 以前是几十个 `node xxx.mjs && node yyy.mjs && …` 串起来的。
// 两个问题：
//   1. **一个失败就全停** —— 后面几十个探针根本没跑，等于"只测了前三分之一"；
//   2. **Windows 上偶发 exit 2** —— 上一条 Electron 刚退出、临时目录还被锁着，
//      下一条启动时偶发失败（单跑必过、串跑偶发红），看起来像产品坏了，其实是环境问题。
//
// 这个运行器：
//   · 逐个跑，**全部跑完**再汇总（不再中途放弃）；
//   · 非 0 退出**重试一次**，重试通过标成 `PASS*`（诚实标注"重试过"，不是静默吞掉）；
//   · 两次都失败才算 FAIL，并打印该探针最后几行输出；
//   · 末尾给一张汇总表 + 总耗时，失败时退出码 1。
//
// 用法：
//   node tests/e2e/run-probes.mjs              # 跑全部
//   node tests/e2e/run-probes.mjs batch8       # 只跑名字里含 batch8 的
//   node tests/e2e/run-probes.mjs --no-retry   # 关闭重试（排查真问题时用）

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

/** 探针清单：顺序有意义（从"最快能看出整体崩没崩"的排到专项） */
const PROBES = [
  'probe-quiet-window',
  'probe-home',
  'probe-home-media',
  'probe-inspector',
  'probe-css-cards',
  'probe-table',
  'probe-table-settings',
  'probe-help',
  'probe-v042',
  'probe-template-style',
  'probe-text-edit',
  'probe-alt-interact',
  'probe-prop-search',
  'probe-undo-granular',
  'probe-delete-guard',
  'probe-paths',
  'probe-storage',
  'probe-projectfile',
  'probe-update',
  'probe-uiaudit',
  'probe-v045b-cards',
  'probe-v045-tokens',
  'probe-v045-position',
  'probe-v045-home',
  'probe-v045-props',
  'probe-v045-assets',
  'probe-v045-external',
  'probe-v045-salvage',
  'probe-v045-updaterlog',
  'probe-v045-media',
  'probe-v045-mediacard',
  'probe-v045-gallery',
  'probe-v045-updateguard',
  'probe-v045-theme',
  'probe-v045-perf',
  'probe-v045-extdir',
  'probe-v045-media2',
  'probe-v045-batch5',
  'probe-v045-undo2',
  'probe-v045-badvideo',
  'probe-v045-downscale',
  'probe-v045-fixed-side',
  'probe-v045-batch8',
  'probe-v045-perf-anim',
  'probe-v045-docmark',
  'probe-v045-snapshot-ui',
  'probe-v045-thumbs',
  'probe-v045-ghostcard',
  'probe-input-focus',
  'probe-ui-overflow'
];

const args = process.argv.slice(2);
const noRetry = args.includes('--no-retry');
const filters = args.filter((a) => !a.startsWith('--'));
const selected = filters.length > 0
  ? PROBES.filter((p) => filters.some((f) => p.includes(f)))
  : PROBES;

function runOne(name) {
  return new Promise((done) => {
    const file = resolve(HERE, `${name}.mjs`);
    const started = Date.now();
    const child = spawn(process.execPath, [file], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
    });
    const out = [];
    const collect = (buf) => {
      const s = buf.toString('utf8');
      out.push(s);
      // 只把该探针自己的 PASS/FAIL 行转发出来，避免刷屏
      for (const line of s.split(/\r?\n/)) {
        if (/^\s*(✓|✗|PASS|FAIL)\b/.test(line) && /✗|FAIL\b/.test(line)) console.log('   ' + line.trim());
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('close', (code) => {
      done({ name, code: code ?? 1, ms: Date.now() - started, output: out.join('') });
    });
  });
}

/** 从输出里抽出"N 通过 / M 失败"这类汇总（没有就留空） */
function summaryOf(output) {
  const m = /(\d+)\s*(?:通过|PASS)[^\d]{0,8}(\d+)\s*(?:失败|FAIL)/i.exec(output);
  if (m) return `${m[1]}/${Number(m[1]) + Number(m[2])}`;
  const m2 = /(\d+)\/(\d+)\s*(?:通过|passed)/i.exec(output);
  if (m2) return `${m2[1]}/${m2[2]}`;
  return '';
}

async function main() {
  console.log(`\n===== 探针批量运行：${selected.length} 个${noRetry ? '（不重试）' : '（失败自动重试一次）'} =====\n`);
  const rows = [];
  const t0 = Date.now();
  for (const name of selected) {
    process.stdout.write(`▸ ${name} … `);
    let r = await runOne(name);
    let retried = false;
    if (r.code !== 0 && !noRetry) {
      // Windows 上偶发"上一条 Electron 刚退出、临时目录还锁着" —— 隔一下再试一次
      await new Promise((res) => setTimeout(res, 1200));
      process.stdout.write('重试 … ');
      r = await runOne(name);
      retried = true;
    }
    const ok = r.code === 0;
    rows.push({ ...r, ok, retried, summary: summaryOf(r.output) });
    console.log(`${ok ? (retried ? 'PASS*' : 'PASS') : 'FAIL'}  ${r.ms}ms${r.summary ? '  ' + r.summary : ''}`);
  }

  const failed = rows.filter((r) => !r.ok);
  const retriedOk = rows.filter((r) => r.ok && r.retried);

  console.log('\n===== 汇总 =====');
  for (const r of rows) {
    const tag = r.ok ? (r.retried ? 'PASS*' : 'PASS ') : 'FAIL ';
    console.log(`${tag} ${r.name.padEnd(28)} ${String(r.summary || '').padEnd(8)} ${r.ms}ms`);
  }
  console.log(`\n共 ${rows.length} 个探针，通过 ${rows.length - failed.length}，失败 ${failed.length}`
    + `${retriedOk.length > 0 ? `（其中 ${retriedOk.length} 个是重试后通过，标 PASS*）` : ''}`
    + `，总耗时 ${Math.round((Date.now() - t0) / 1000)}s`);

  if (failed.length > 0) {
    console.log('\n===== 失败详情（最后 25 行）=====');
    for (const f of failed) {
      console.log(`\n--- ${f.name}（exit ${f.code}）---`);
      const lines = f.output.split(/\r?\n/).filter(Boolean);
      console.log(lines.slice(-25).join('\n'));
    }
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });