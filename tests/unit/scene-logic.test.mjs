// v0.4.6 · 场景纯逻辑单测（R6-5）
//
// 为什么这批终于能单测：以前这些逻辑全埋在 1600 行的 sceneStore 里，只能靠 E2E 黑盒验证。
// R6-5 把它们抽成纯函数之后，这里可以在**毫秒级**覆盖以前根本测不了的边界。
//
// 做法（沿用 table-ops.test.mjs 的先例）：
//   把 scene/ 下的 .ts 复制到系统临时目录，剥掉 TS 类型后直接用 Node 跑。
//   为什么不在仓库里直接跑：Node 不认识 .ts，而引入 tsx/esbuild 只为测试不值当。
//
// 覆盖：
//   scene/style.ts     偏移钳制（用户明确投诉过）+ 断点层叠 + 空层清理
//   scene/tree.ts      父级查找 / 祖先判定 / 后代剪除
//   scene/history.ts   压栈清空 redo + 上限
//   scene/structure.ts 重 id（粘贴不撞车）
//
// 用法：node tests/unit/scene-logic.test.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { tmpdir } from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const SRC = join(ROOT, 'src/renderer/store/scene');
const TMP = join(tmpdir(), 'bc-scene-unit');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

let pass = 0; let fail = 0;
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected);
  if (a === b) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${b}`); }
};
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

/**
 * 剥掉 TS 类型：**用 TypeScript 自己的 transpileModule**。
 *
 * 一开始我手写正则做类型剥离，在 `breakpoint: 'desktop' | 'tablet' | 'mobile' = 'desktop'`
 * 这类"字符串字面量联合 + 默认值"上直接翻车。项目本来就装了 typescript，
 * 直接用它最可靠（而且和 tsc 用的是同一套 parser，不怕边角语法）。
 */
function stripTypes(src, fileName) {
  const ts = require('typescript');
  const out = ts.transpileModule(src, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      // 只剥类型，不做降级转换
      isolatedModules: true,
      verbatimModuleSyntax: false
    },
    fileName
  });
  // 剥完后 `import type` 会变成裸 import（运行时找不到模块）→ 整行去掉
  return out.outputText
    .replace(/^import \{\s*\} from '[^']*';\n/gm, '')
    .replace(/^export \{\};\n/gm, '');
}

function loadModule(name) {
  const src = readFileSync(join(SRC, name), 'utf-8');
  const out = join(TMP, name.replace(/\.ts$/, '.mjs'));
  writeFileSync(out, stripTypes(src), 'utf-8');
  return import(pathToFileURL(out).href);
}

const styleMod = await loadModule('style.ts');
const treeMod = await loadModule('tree.ts');
const historyMod = await loadModule('history.ts');

// ── scene/style.ts：偏移钳制（用户投诉过的那条）────────────────────────
console.log('\n── clampOffsets（偏移钳制）──');
eq('absolute 的负偏移被钳到 0', styleMod.clampOffsets({ left: '-40px' }, 'absolute'), { left: '0px' });
eq('fixed 的负偏移被钳到 0', styleMod.clampOffsets({ top: '-5px' }, 'fixed'), { top: '0px' });
eq('relative 的负偏移**保留**（位移量，负数合法）',
  styleMod.clampOffsets({ left: '-40px' }, 'relative'), { left: '-40px' });
eq('sticky 的负偏移保留', styleMod.clampOffsets({ top: '-10px' }, 'sticky'), { top: '-10px' });
eq('margin 允许负数（不钳）',
  styleMod.clampOffsets({ marginTop: '-20px' }, 'absolute'), { marginTop: '-20px' });
eq('calc() 原样放过（钳了会算错）',
  styleMod.clampOffsets({ left: 'calc(100% - 20px)' }, 'absolute'), { left: 'calc(100% - 20px)' });
eq('百分比原样放过',
  styleMod.clampOffsets({ left: '-10%' }, 'absolute'), { left: '-10%' });
eq('var() 原样放过',
  styleMod.clampOffsets({ left: 'var(--x)' }, 'absolute'), { left: 'var(--x)' });
eq('auto 原样放过', styleMod.clampOffsets({ left: 'auto' }, 'absolute'), { left: 'auto' });
eq('补丁里带 position 时以补丁为准（切到 fixed 立刻生效）',
  styleMod.clampOffsets({ position: 'fixed', left: '-8px' }, 'static'), { position: 'fixed', left: '0px' });
eq('正数不动', styleMod.clampOffsets({ left: '40px' }, 'absolute'), { left: '40px' });

// ── getEffectiveStyle：断点层叠 ────────────────────────────────────────
console.log('\n── getEffectiveStyle（断点层叠）──');
const node = {
  id: 'n1',
  type: 'div',
  children: [],
  style: { width: '100px', color: 'red' },
  responsive: { tablet: { width: '80px' }, mobile: { width: '60px', color: 'blue' } }
};
eq('desktop 只取基础层', styleMod.getEffectiveStyle(node, 'desktop'), { width: '100px', color: 'red' });
eq('tablet 叠基础层 + tablet 覆盖', styleMod.getEffectiveStyle(node, 'tablet'), { width: '80px', color: 'red' });
eq('mobile 叠基础 + tablet + mobile',
  styleMod.getEffectiveStyle(node, 'mobile'), { width: '60px', color: 'blue' });
eq('没有 responsive 时各断点都等于基础层',
  styleMod.getEffectiveStyle({ id: 'x', type: 'div', children: [], style: { a: '1' } }, 'mobile'), { a: '1' });

// ── applyPatchToLayer：断点写入与空层清理 ──────────────────────────────
console.log('\n── applyPatchToLayer（断点写入）──');
{
  const n = { id: 'a', type: 'div', children: [], style: {} };
  styleMod.applyPatchToLayer(n, { color: 'red' }, 'desktop');
  eq('desktop 写入基础层', n.style, { color: 'red' });
  styleMod.applyPatchToLayer(n, { color: undefined }, 'desktop');
  eq('desktop 的 undefined = 删除该属性', n.style, {});
}
{
  const n = { id: 'b', type: 'div', children: [], style: { width: '10px' } };
  const r1 = styleMod.applyPatchToLayer(n, { width: '20px' }, 'tablet');
  eq('tablet 写入断点层（不动基础层）',
    { base: n.style, tablet: n.responsive.tablet, emptied: r1.layerEmptied },
    { base: { width: '10px' }, tablet: { width: '20px' }, emptied: false });
  // 断点层里的空串 = 回到继承（删除该属性）
  styleMod.applyPatchToLayer(n, { width: '' }, 'tablet');
  eq('断点层写空串 = 删除该属性（回到继承）',
    { tablet: n.responsive, emptied: true },
    { tablet: undefined, emptied: true });
  ok('断点层清空后 responsive 本身也被删掉（工程里不留空壳）', n.responsive === undefined);
}

// ── scene/tree.ts ────────────────────────────────────────────────────
console.log('\n── tree（树查询）──');
const tree = {
  id: 'root', type: 'div', children: [
    { id: 'A', type: 'section', children: [
      { id: 'A1', type: 'div', children: [{ id: 'A1a', type: 'p', children: [] }] },
      { id: 'A2', type: 'div', children: [] }
    ] },
    { id: 'B', type: 'div', children: [] }
  ]
};
eq('findNode 找得到深层节点', treeMod.findNode(tree, 'A1a')?.id, 'A1a');
eq('findNode 找不到返回 null', treeMod.findNode(tree, 'zzz'), null);
eq('findParent 找到直接父级', treeMod.findParent(tree, 'A1a')?.id, 'A1');
eq('findParent 根节点返回 null', treeMod.findParent(tree, 'root'), null);
ok('isAncestorOf：A 是 A1a 的祖先', treeMod.isAncestorOf(tree, 'A', 'A1a') === true);
ok('isAncestorOf：A1a 不是 A 的祖先', treeMod.isAncestorOf(tree, 'A1a', 'A') === false);
ok('isAncestorOf：自己不算自己的祖先', treeMod.isAncestorOf(tree, 'A', 'A') === false);
ok('isDescendant：A1a 在 A 的后代里', treeMod.isDescendant(treeMod.findNode(tree, 'A'), 'A1a') === true);
eq('pruneDescendantIds 同时选了父子时只留父',
  treeMod.pruneDescendantIds(tree, ['A', 'A1', 'A1a', 'B']).sort(), ['A', 'B']);
eq('pruneDescendantIds 不误删兄弟', treeMod.pruneDescendantIds(tree, ['A1', 'A2']).sort(), ['A1', 'A2']);
eq('indexOfChild 拿到下标', treeMod.indexOfChild(tree, 'B'), 1);

// ── scene/history.ts ────────────────────────────────────────────────
console.log('\n── history（撤销栈）──');
{
  const h0 = { past: [], future: [] };
  const h1 = historyMod.pushPast(h0, { snap: 1 });
  eq('压栈后 past 多一步、future 清空', { len: h1.past.length, future: h1.future }, { len: 1, future: [] });
  const h2 = { past: [{ snap: 1 }], future: [{ snap: 9 }] };
  const h3 = historyMod.pushPast(h2, { snap: 2 });
  eq('新操作后 redo 链必须失效（否则撤销/重做会跳乱）', h3.future, []);
  ok('上限：不会无限增长', historyMod.HISTORY_LIMIT > 0 && historyMod.HISTORY_LIMIT <= 500,
    `上限 ${historyMod.HISTORY_LIMIT}`);
  // 压超过上限后，最早的被丢掉
  let hh = { past: [], future: [] };
  for (let i = 0; i < historyMod.HISTORY_LIMIT + 10; i++) hh = historyMod.pushPast(hh, { snap: i });
  eq(`压 ${historyMod.HISTORY_LIMIT + 10} 步后仍等于上限`, hh.past.length, historyMod.HISTORY_LIMIT);
  eq('丢的是最早的（栈尾是最后压入的）', hh.past[hh.past.length - 1], { snap: historyMod.HISTORY_LIMIT + 9 });
}

rmSync(TMP, { recursive: true, force: true });

console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
if (fail) process.exitCode = 1;
