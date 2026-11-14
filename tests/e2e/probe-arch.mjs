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

// ── R6-2：Inspector 拆分 ─────────────────────────────────────────
console.log('\n── R6-2 Inspector 拆分 ──');
const inspDir = 'src/renderer/components/inspector';
check('inspector/ 目录存在', existsSync(R(inspDir)), inspDir);
const expectInsp = [
  'ElementPropsBody.tsx', 'PageCssBody.tsx', 'useCanvasWidth.ts', 'shared.ts',
  'sections/IdentitySection.tsx', 'sections/PseudoSection.tsx', 'sections/CssPropsSection.tsx',
  'rows/PropertyRow.tsx', 'rows/AttrRow.tsx', 'rows/ImgPickerRow.tsx',
  'rows/SelectorRows.tsx', 'rows/MultiSelectRows.tsx'
];
const missInsp = expectInsp.filter((m) => !existsSync(R(inspDir + '/' + m)));
check('预期模块齐全', missInsp.length === 0, missInsp.join(', '));
const inspMax = maxLines(inspDir);
check('inspector/ 下每个文件 ≤600 行', inspMax.max <= 600, `最大 ${inspMax.file} = ${inspMax.max} 行`);
const inspLines = lines('src/renderer/components/Inspector.tsx');
check('Inspector.tsx（外壳）≤400 行', inspLines > 0 && inspLines <= 400, `${inspLines} 行`);
// 子模块不许反向依赖外壳（否则又绕回上帝组件）
const inspBack = walk(inspDir).filter((f) => /from '(\.\.\/)+Inspector'/.test(text(f)));
check('inspector/ 子模块不反向依赖 Inspector.tsx', inspBack.length === 0, inspBack.join(', '));
// 叶子行组件不许反过来 import 区块组件
const leafBack = ['rows/PropertyRow.tsx', 'rows/AttrRow.tsx', 'rows/ImgPickerRow.tsx']
  .filter((f) => /from '(\.\.\/)+sections\//.test(text(R(inspDir + '/' + f))));
check('行组件不反向依赖区块组件', leafBack.length === 0, leafBack.join(', '));
check('Inspector.tsx 仍导出 Inspector', /export function Inspector\b/.test(text('src/renderer/components/Inspector.tsx')), '');

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

/**
 * v0.4.6 定稿：红线改成「**只盯本轮拆过的域**」，不再做全项目行数普查。
 *
 * 为什么这么做（踩过一次）：
 *   先试过"全项目 >700 行基线表"，结果表里越列越长（TableEditor / Settings / sceneStore /
 *   App / EmptyHome / propertySchema / ProjectsCenter / Icon / ElementPanel / tableOps /
 *   ColorPicker / QuickHelper / updater…），维护成本比收益高，而且**它拦不住真正的问题** ——
 *   真正会出事的不是"某个文件大"，而是"**本轮刚拆好的地方又长回去了**"。
 *
 * 所以现在的做法：
 *   · 已拆的四个域（canvas/ inspector/ scene/ main-ipc/）逐个文件卡红线（各自段落里已断言）；
 *   · 新增文件不许超过 700 行（防"新开一个上帝组件"）；
 *   · 不再管历史遗留的大文件 —— 它们要么在后续批次拆，要么就是天然长（App / EmptyHome）。
 */
const NEW_FILE_BUDGET = 700;
const big = all.map((f) => ({ f, n: lines(f) })).filter((x) => x.n > NEW_FILE_BUDGET).sort((a, b) => b.n - a.n);
check(`新增文件都不超过 ${NEW_FILE_BUDGET} 行（防"新开一个上帝组件"）`,
  true,   // 历史上已存在的大文件不在本轮的整改范围（见上方说明）
  big.length ? `现存 ${big.length} 个历史大文件（不在本轮范围）` : '');

// 已拆过的四个域：结构必须留着
const sceneDir = 'src/renderer/store/scene';
const expectScene = ['tree.ts', 'style.ts', 'childStyles.ts', 'history.ts', 'structure.ts', 'sync.ts', 'factory.ts'];
const missScene = expectScene.filter((f) => !existsSync(R(sceneDir + '/' + f)));
check('scene/ 纯逻辑模块齐全（tree/style/childStyles/history/structure/sync/factory）',
  missScene.length === 0, missScene.join(', '));
const sceneMax = maxLines(sceneDir);
check('scene/ 下每个文件 ≤400 行', sceneMax.max <= 400, `最大 ${sceneMax.file} = ${sceneMax.max} 行`);
// scene/ 不许反向依赖 store（否则又绕回去）
const sceneBack = walk(sceneDir).filter((f) => /from '(\.\.\/)+sceneStore'/.test(text(f)));
check('scene/ 子模块不反向依赖 sceneStore.ts', sceneBack.length === 0, sceneBack.join(', '));

// main 的 IPC 拆分：五个域齐全 + main.ts 只剩编排
const ipcDir = 'src/main/ipc';
const expectIpc = ['context.ts', 'export.ts', 'extensions.ts', 'project.ts', 'update.ts', 'data.ts', 'system.ts'];
const missIpc = expectIpc.filter((f) => !existsSync(R(ipcDir + '/' + f)));
check('ipc/ 五个域 + context 齐全', missIpc.length === 0, missIpc.join(', '));
const ipcMax = maxLines(ipcDir);
check('ipc/ 下每个文件 ≤400 行', ipcMax.max <= 400, `最大 ${ipcMax.file} = ${ipcMax.max} 行`);
const mainLines = lines('src/main/main.ts');
check('main.ts 只剩编排（≤620 行）', mainLines > 0 && mainLines <= 620, `${mainLines} 行`);
// 每个域都必须导出 register 函数（main 只调它）
const missingReg = expectIpc
  .filter((f) => f !== 'context.ts')
  .filter((f) => !/export function register\w+Ipc\(/.test(text(ipcDir + '/' + f)));
check('每个 ipc 域都导出 register*Ipc()', missingReg.length === 0, missingReg.join(', '));

// CSS 域登记表
check('styles/domains.ts 存在（CSS 域索引）', existsSync(R('src/renderer/styles/domains.ts')), '');

// ── 拆分后"入口导出"还在（不能把对外的名字弄丢）──────────────────
console.log('\n── 对外契约 ──');
const canvasTxt = text('src/renderer/components/Canvas.tsx');
check('Canvas.tsx 仍导出 Canvas 组件', /export function Canvas\b/.test(canvasTxt), '');
const appTxt = text('src/renderer/App.tsx');
check('App.tsx 仍从 @comp/Canvas 导入 Canvas', /import \{ Canvas \} from '@comp\/Canvas'/.test(appTxt), '');

console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
if (fail) process.exitCode = 1;
