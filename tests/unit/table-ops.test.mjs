// 表格结构操作单测（纯逻辑，秒级；不启动 Electron）
//
// 做法：把 tableOps.ts 复制到系统临时目录并把 `@store/sceneStore` 换成同目录的桩，
// 再用 Node 内置的 TS 类型剥离直接跑（tableOps 只依赖 createElement 一个运行时函数）。
//
//   node tests/unit/table-ops.test.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { tmpdir } from 'os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
// 生成物放系统临时目录：受限沙箱下"在仓库里新建目录"会被拒（EPERM），临时区可以写
const TMP = join(tmpdir(), 'bc-tableops-unit');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

writeFileSync(
  resolve(TMP, 'tableOps.ts'),
  readFileSync(resolve(ROOT, 'src/renderer/lib/tableOps.ts'), 'utf8')
    .replace("from '@store/sceneStore'", "from './scene-stub.ts'")
);
writeFileSync(
  resolve(TMP, 'scene-stub.ts'),
  `let n = 0;
export function createElement(type, overrides = {}) {
  return { id: 'n' + (++n), type, children: [], style: {}, text: undefined, ...overrides };
}
`
);

const { createTableTree, applyTableOp, buildGrid, canMergeRange, normalizeTable, readTable } =
  await import(pathToFileURL(resolve(TMP, 'tableOps.ts')).href);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail += 1; console.log('  ✗ ' + name + '  [' + (extra ?? '') + ']'); }
};

const partsOf = (t) => readTable(normalizeTable(t));
const gridOf = (t) => buildGrid(partsOf(t).rows);
const cellAt = (t, r, c) => gridOf(t).cells.find((g) => g.row === r && g.col === c)?.cell;
/** 每行"可视列布局"：0:2x2 表示第 0 列起跨 2 列 2 行 */
const shape = (t) => {
  const grid = gridOf(t);
  const rows = [];
  const visCols = [];
  for (let r = 0; r < grid.rowCount; r += 1) {
    const inRow = grid.cells.filter((g) => g.row === r);
    rows.push(inRow.map((g) => `${g.col}:${g.cs}x${g.rs}`).join(' '));
    visCols.push(inRow.reduce((n, g) => n + g.cs, 0));
  }
  return { cols: grid.cols, rowCount: grid.rowCount, cells: grid.cells.length, rows, visCols, childCounts: grid.rows.map((r) => r.children.length) };
};
/** 不变量：网格里每一格占的每个位置都必须指向它自己（重叠会当场露馅） */
const gridSound = (t) => {
  const grid = gridOf(t);
  for (const g of grid.cells) {
    for (let dr = 0; dr < g.rs; dr += 1) {
      for (let dc = 0; dc < g.cs; dc += 1) {
        if (grid.occ[g.row + dr]?.[g.col + dc] !== g.cell.id) return `重叠/错位 @${g.row + dr},${g.col + dc}`;
      }
    }
  }
  // 反过来：占位表里每个非空格子都必须有主
  for (let r = 0; r < grid.occ.length; r += 1) {
    for (let c = 0; c < (grid.occ[r]?.length ?? 0); c += 1) {
      if (grid.occ[r][c] && !grid.byId.has(grid.occ[r][c])) return `野占位 @${r},${c}`;
    }
  }
  return '';
};
const checkSound = (name, t) => ok(name + ' · 网格无重叠/错位', gridSound(t) === '', gridSound(t));

console.log('\n=== 1. 干净的 3×3：合并 2×2 ===');
let t = createTableTree(3, 3, {});
const a00 = cellAt(t, 0, 0).id;
t = applyTableOp(t, { kind: 'mergeRange', cellId: a00, width: 2, height: 2 });
let s = shape(t);
ok('合并后第 2 行只剩右边那 1 格', s.rowCount === 3 && s.childCounts.join(',') === '2,1,3', s.childCounts.join(','));
ok('锚点 = 第 0 行第 0 列 2×2', s.rows[0].startsWith('0:2x2'), s.rows[0]);
ok('可视列数仍是 3', s.cols === 3, String(s.cols));
checkSound('合并 2×2', t);

console.log('\n=== 2. 再拆回来：3×3 复原（历史 BUG：第二行掉一列）===');
t = applyTableOp(t, { kind: 'unmerge', cellId: a00 });
s = shape(t);
ok('每行都是 3 格', s.childCounts.join(',') === '3,3,3', s.childCounts.join(','));
ok('没有任何跨度残留', s.rows.every((r) => !r.includes('x2')), s.rows.join(' | '));
checkSound('拆分复原', t);

console.log('\n=== 3. 先把两行各自横向合并，再纵向合并（旧代码直接放弃）===');
t = createTableTree(3, 3, {});
t = applyTableOp(t, { kind: 'mergeRange', cellId: cellAt(t, 0, 0).id, width: 2, height: 1 });
t = applyTableOp(t, { kind: 'mergeRange', cellId: cellAt(t, 1, 0).id, width: 2, height: 1 });
s = shape(t);
ok('两行各是 0:2x1', s.rows[0].startsWith('0:2x1') && s.rows[1].startsWith('0:2x1'), s.rows.slice(0, 2).join(' | '));
t = applyTableOp(t, { kind: 'mergeRange', cellId: cellAt(t, 0, 0).id, width: 2, height: 2 });
s = shape(t);
ok('纵向合并成功 → 0:2x2', s.rows[0].startsWith('0:2x2'), s.rows[0]);
ok('第 2 行只剩第 3 列那格（被合并的 2×1 整格被吃掉）', s.childCounts.join(',') === '2,1,3', s.childCounts.join(','));
checkSound('先横后纵合并', t);
t = applyTableOp(t, { kind: 'unmerge', cellId: cellAt(t, 0, 0).id });
s = shape(t);
ok('拆回 3 行 × 3 格', s.childCounts.join(',') === '3,3,3' && s.cols === 3, s.childCounts.join(',') + ' / cols ' + s.cols);
checkSound('先横后纵再拆', t);

console.log('\n=== 4. 合并格内部插列：吸附到该格左侧，各行不错位 ===');
t = createTableTree(3, 3, {});
t = applyTableOp(t, { kind: 'mergeRange', cellId: cellAt(t, 0, 0).id, width: 2, height: 1 });
t = applyTableOp(t, { kind: 'insertColAt', vcol: 1, count: 1 }); // 1 落在合并格(0~1列)内部
s = shape(t);
ok('列数 3 → 4', s.cols === 4, String(s.cols));
ok('每一行都变成 4 列', s.rows.every((r) => r.split(' ').filter(Boolean).reduce((n, x) => n + Number(x.split(':')[1].split('x')[0]), 0) === 4), s.rows.join(' | '));
ok('合并格被推到第 1 列起（吸附到左侧）', s.rows[0].includes('1:2x1'), s.rows[0]);
checkSound('合并格内插列', t);

console.log('\n=== 5. 删列：不硬拆合并格，其余行照删且不错位 ===');
t = applyTableOp(t, { kind: 'deleteCols', indexes: [2] });
s = shape(t);
// 第 2 列落在合并格（1:2x1）内部 → 那一行删不掉、整列留着；其余行各删掉自己的第 2 列
ok('列数仍是 4（合并格内部那一列不硬拆）', s.cols === 4, String(s.cols));
ok('第 2、3 行各少 1 格', s.childCounts.join(',') === '3,3,3', s.childCounts.join(','));
ok('合并格原样保留（0 列新格 + 1:2x1 + 3 列格）', s.rows[0] === '0:1x1 1:2x1 3:1x1', s.rows[0]);
checkSound('删列', t);

console.log('\n=== 6. 跨行合并下方插行：新行不会多出一列 ===');
t = createTableTree(3, 3, {});
t = applyTableOp(t, { kind: 'mergeRange', cellId: cellAt(t, 0, 0).id, width: 2, height: 2 });
const row1Id = partsOf(t).rows[1].id;
t = applyTableOp(t, { kind: 'insertRow', refRowId: row1Id, side: 'before', count: 1 });
s = shape(t);
ok('新行只有 1 格（0、1 列被上面的跨行格占着）', s.childCounts[1] === 1, s.childCounts.join(','));
ok('新行落在第 2 列', s.rows[1] === '2:1x1', s.rows[1]);
checkSound('跨行格下插行', t);

console.log('\n=== 6b. 最上方 / 最下方插行：新行与整表同宽（探针抓到的真 BUG）===');
t = createTableTree(3, 3, {});
const firstRowId = partsOf(t).rows[0].id;
const lastRowId = partsOf(t).rows[2].id;
t = applyTableOp(t, { kind: 'insertRow', refRowId: firstRowId, side: 'before', count: 1 });
s = shape(t);
ok('最上方插行：新行 3 格', s.childCounts[0] === 3, s.childCounts.join(','));
t = applyTableOp(t, { kind: 'insertRow', refRowId: lastRowId, side: 'after', count: 2 });
s = shape(t);
ok('最下方插 2 行：两行都是 3 格', s.childCounts.slice(-2).every((n) => n === 3), s.childCounts.join(','));
ok('整表每行都是 3 列', s.visCols.every((v) => v === 3), s.visCols.join(','));
checkSound('首尾插行', t);

console.log('\n=== 7. canMergeRange 判定与 mergeRange 完全一致 ===');
t = createTableTree(3, 3, {});
t = applyTableOp(t, { kind: 'mergeRange', cellId: cellAt(t, 0, 0).id, width: 2, height: 1 });
let g = gridOf(t);
const xId = cellAt(t, 0, 0).id;
ok('已经合并过的格子（2×1）再点合并 → 灰着', canMergeRange(g, xId, 2, 1) === false);
ok('切到半个格子（选 1 格宽但压到合并格右边）→ 灰着', canMergeRange(g, xId, 1, 2) === false);
ok('越界矩形 → 灰着', canMergeRange(g, cellAt(t, 0, 2).id, 2, 1) === false);
ok('干净的两格 → 可合并', canMergeRange(g, xId, 3, 1) === true);
ok('相邻行两格 → 可合并', canMergeRange(g, xId, 2, 2) === true);

console.log('\n=== 8. 表头/表尾区块与合并共存 ===');
t = createTableTree(4, 3, { header: true, footer: true, caption: true });
s = shape(t);
ok('结构 = caption + thead + tbody + tfoot', partsOf(t).caption !== null && partsOf(t).thead !== null && partsOf(t).tfoot !== null);
const headCell = cellAt(t, 0, 0).id;
t = applyTableOp(t, { kind: 'mergeRange', cellId: headCell, width: 3, height: 1 });
s = shape(t);
ok('表头行整行合并成 1 格 3 列', s.rows[0] === '0:3x1', s.rows[0]);
t = applyTableOp(t, { kind: 'unmerge', cellId: headCell });
s = shape(t);
ok('拆回表头行 3 格', s.childCounts[0] === 3, s.childCounts.join(','));
checkSound('表头合并拆分', t);

console.log(`\n${fail === 0 ? '✅' : '❌'}  表格结构单测：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
