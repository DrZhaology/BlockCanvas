// v0.4.6 · 结构重构验收探针（R6-1 / R6-2 / R6-3 / R6-4 / R6-5 通用）
//
// 重构的铁律是"行为零变化"，所以这个探针只查两件**结构性**的事：
//   ① 文件粒度：被拆过的模块每个 ≤600 行（超了说明又长回去了）；
//   ② 职责边界：拆分出来的模块不许越界（纯计算层不许 import React、画布子模块不许反向依赖组装层）。
// 行为本身由既有的 50+ 个探针覆盖 —— 这里不重复造断言。
//
// 用法：node tests/e2e/probe-arch.mjs
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const R = (p) => join(ROOT, p);
let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

const lines = (p) => (existsSync(p) ? readFileSync(p, 'utf-8').replace(/^\uFEFF/, '').split(/\r?\n/).length : -1);
const text = (p) => (existsSync(p) ? readFileSync(p, 'utf-8').replace(/^\uFEFF/, '') : '');

/** 一个目录里所有 .ts/.tsx 的最大行数 */
function maxLines(dir) {
  if (!existsSync(R(dir))) return { max: 0, file: '', files: [] };
  const files = readdirSync(R(dir)).filter((f) => /\.tsx?$/.test(f));
  let max = 0; let which = '';
  for (const f of files) {
    const n = lines(join(dir, f));
    if (n > max) { max = n; which = f; }
  }
  return { max, file: which, files };
}

// ── R6-1：Canvas 拆分 ─────────────────────────────────────────────
console.log('\n── R6-1 Canvas 拆分 ──');
const canvasDir = 'src/renderer/components/canvas';
check('canvas/ 目录存在', existsSync(R(canvasDir)), canvasDir);
const expectModules = ['CanvasNode.tsx', 'useAltDrag.ts', 'useMarquee.ts', 'geometry.ts', 'walls.ts', 'altDragMove.ts', 'types.ts', 'mediaSrc.ts', 'AltOverlays.tsx'];
const got = existsSync(R(canvasDir)) ? readdirSync(R(canvasDir)) : [];
const missMods = expectModules.filter((m) => !got.includes(m));
check('预期模块齐全', missMods.length === 0, missMods.join(', '));
const cMax = maxLines(canvasDir);
check('canvas/ 下每个文件 ≤600 行', cMax.max <= 600, `最大 ${cMax.file} = ${cMax.max} 行`);
const canvasLines = lines('src/renderer/components/Canvas.tsx');
check('Canvas.tsx（组装层）≤400 行', canvasLines > 0 && canvasLines <= 400, `${canvasLines} 行`);

// 纯计算层不许碰 React
for (const f of ['geometry.ts', 'walls.ts', 'mediaSrc.ts', 'types.ts']) {
  const t = text(join(canvasDir, f));
  check(`${f} 不依赖 React`, !/from 'react'/.test(t), '');
}
// 子模块不许反向 import 组装层（否则又绕回上帝组件）
const backRefs = got.filter((f) => /from '\.\.\/Canvas'/.test(text(join(canvasDir, f))));
check('canvas/ 子模块不反向依赖 Canvas.tsx', backRefs.length === 0, backRefs.join(', '));
// 渲染节点不许自己算墙（那是 walls.ts 的事）
check('CanvasNode.tsx 不直接 import walls.ts（渲染与几何分离）',
  !/from '\.\/walls'/.test(text(join(canvasDir, 'CanvasNode.tsx'))), '');

// ── 全项目单文件行数红线 ─────────────────────────────────────────
console.log('\n── 单文件行数红线 ──');
function walk(dir, out = []) {
  if (!existsSync(R(dir))) return out;
  for (const e of readdirSync(R(dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}
const all = walk('src');
const big = all.map((f) => ({ f, n: lines(f) })).filter((x) => x.n > 700).sort((a, b) => b.n - a.n);
check('src 下没有 >700 行的文件（本轮拆分目标 600，留 100 行余量）',
  big.length === 0, big.slice(0, 5).map((x) => `${x.f.replace(/^src\//, '')}=${x.n}`).join(', '));

// ── 拆分后"入口导出"还在（不能把对外的名字弄丢）──────────────────
console.log('\n── 对外契约 ──');
const canvasTxt = text('src/renderer/components/Canvas.tsx');
check('Canvas.tsx 仍导出 Canvas 组件', /export function Canvas\b/.test(canvasTxt), '');
const appTxt = text('src/renderer/App.tsx');
check('App.tsx 仍从 @comp/Canvas 导入 Canvas', /import \{ Canvas \} from '@comp\/Canvas'/.test(appTxt), '');

console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
if (fail) process.exitCode = 1;
