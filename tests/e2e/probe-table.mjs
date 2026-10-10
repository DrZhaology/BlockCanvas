// 表格编辑器专项探针（v0.4.3 改版后）
// 覆盖：入口 / 空表占位 / 插入轨（点击 + 拖动多插）/ 框选合并拆分 / 结构开关 / 预设 / 帮助问号
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';
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

/** 读当前画布里第一张表的结构 */
const READ_TABLE = `(() => {
  let t = null;
  const w = (n) => { if (!t && n.type === 'table') t = n; for (const c of n.children) w(c); };
  w(window.__sceneStore.getState().scene.root);
  if (!t) return null;
  const secs = t.children.filter((c) => c.type === 'thead' || c.type === 'tbody' || c.type === 'tfoot');
  const rows = [];
  for (const s of secs) for (const r of s.children) rows.push({ sec: s.type, cells: r.children.map((c) => ({ type: c.type, cs: c.attrs && c.attrs.colspan, rs: c.attrs && c.attrs.rowspan, text: c.text ?? '' })) });
  return {
    sections: t.children.map((c) => c.type),
    rows,
    rowCount: rows.length,
    colCount: Math.max(0, ...rows.map((r) => r.cells.length)),
    cls: t.attrs && t.attrs.className,
    childStyles: (t.childStyles || []).map((c) => c.sel),
    borderCollapse: t.style.borderCollapse
  };
})()`;

/** 读当前画布里"最后一张"表（新插的表在树末尾）：合并相关断言都看它 */
const READ_LAST_TABLE = `(() => {
  let t = null;
  const w = (n) => { if (n.type === 'table') t = n; for (const c of n.children) w(c); };
  w(window.__sceneStore.getState().scene.root);
  if (!t) return null;
  const secs = t.children.filter((c) => c.type === 'thead' || c.type === 'tbody' || c.type === 'tfoot');
  const rows = [];
  for (const s of secs) for (const r of s.children) rows.push({ sec: s.type, cells: r.children.map((c) => ({ type: c.type, cs: c.attrs && c.attrs.colspan, rs: c.attrs && c.attrs.rowspan, text: c.text ?? '' })) });
  // 可视列数：把 colspan 摊开（合并后"单元格个数"不等于"列数"）
  const vis = (r) => r.cells.reduce((n, c) => n + (Number(c.cs) || 1), 0);
  return {
    sections: t.children.map((c) => c.type),
    rows,
    rowCount: rows.length,
    visCols: rows.map(vis),
    healthCheck: t.healthCheck === true,
    cls: t.attrs && t.attrs.className
  };
})()`;

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-table-probe');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1200);

  const read = () => win.evaluate(READ_TABLE);

  // ============ 1. 元素面板不再有"表格模板"按钮 + 入口 ============
  await win.locator('.element-btn', { hasText: '表格' }).first().click();
  await sleep(500);
  ok('元素面板已移除表格结构模板按钮', (await win.locator('.element-btn').count()) > 0);
  await win.locator('.tab-btn', { hasText: '属性' }).first().click();
  await sleep(400);
  await win.locator('.tbl-entry button').first().click();
  await win.waitForSelector('.table-page', { timeout: 8000 });
  await sleep(400);
  ok('表格编辑器已打开', (await win.locator('.table-page').count()) === 1);

  // ============ 2. 空表占位 ============
  ok('空表显示占位提示（而不是空网格）', (await win.locator('.tbl-empty-state').count()) === 1);

  // ============ 3. 空表加 3 行 ============
  await win.locator('.tbl-empty-state .tbl-btn', { hasText: '加 3 行' }).first().click();
  await sleep(450);
  let t = await read();
  ok('空表占位加 3 行 → 3 行 × 1 列', t.rowCount === 3 && t.colCount === 1, `${t.rowCount}×${t.colCount}`);

  // ============ 4. 插入轨数量 ============
  let railCols = await win.locator('.tbl-rail-col').count();
  let railRows = await win.locator('.tbl-rail-row').count();
  ok('列轨 = 列数+1', railCols === t.colCount + 1, `${railCols} vs ${t.colCount + 1}`);
  ok('行轨 = 行数+1', railRows === t.rowCount + 1, `${railRows} vs ${t.rowCount + 1}`);

  // ============ 5. 悬浮列轨 → ＋ 浮出 ============
  const colRail = win.locator('.tbl-rail-col').first();
  const opBefore = await colRail.locator('.tbl-rail-btn').evaluate((el) => getComputedStyle(el).opacity);
  await colRail.hover();
  await sleep(320);
  const opAfter = await colRail.locator('.tbl-rail-btn').evaluate((el) => getComputedStyle(el).opacity);
  ok('悬浮插入轨才浮出 ＋（平时隐藏）', Number(opBefore) < 0.1 && Number(opAfter) > 0.9, `${opBefore} → ${opAfter}`);

  // ============ 6. 点一下列轨 = 插 1 列 ============
  const beforeCols = (await read()).colCount;
  await colRail.click();
  await sleep(450);
  t = await read();
  ok('点一下列轨 → 插入 1 列', t.colCount === beforeCols + 1, `${beforeCols} → ${t.colCount}`);

  // ============ 7. 拖动列轨 = 一次插多列 ============
  const box = await win.locator('.tbl-grid').boundingBox();
  const stepInfo = await win.evaluate(() => {
    const g = document.querySelector('.tbl-grid');
    const cols = document.querySelectorAll('.tbl-colhead').length;
    const r = g.getBoundingClientRect();
    return { step: Math.max(48, (r.width - 30 - 46) / cols) };
  });
  const railBox = await win.locator('.tbl-rail-col').last().boundingBox();
  const beforeCols2 = (await read()).colCount;
  await win.mouse.move(railBox.x + railBox.width / 2, railBox.y + railBox.height / 2);
  await win.mouse.down();
  await win.mouse.move(railBox.x + railBox.width / 2 + stepInfo.step * 2.4, railBox.y + railBox.height / 2, { steps: 8 });
  await sleep(220);
  const ghostCount = await win.locator('.tbl-ghost').count();
  const badge = await win.locator('.tbl-count-badge').count();
  await win.mouse.up();
  await sleep(500);
  t = await read();
  ok('拖动列轨出现高亮预览 + 计数气泡', ghostCount === 3 && badge === 1, `ghost=${ghostCount} badge=${badge}`);
  ok('拖动一次插入多列（拖 2.4 格 → 插 3 列）', t.colCount === beforeCols2 + 3, `${beforeCols2} → ${t.colCount}`);

  // 小表格（5 列）不应横向溢出容器（列轨是独立轨道，不该把内容顶出去）
  const of = await win.evaluate(() => {
    const w = document.querySelector('.tbl-grid-wrap');
    const g = document.querySelector('.tbl-grid');
    return { sw: g.scrollWidth, cw: w.clientWidth };
  });
  ok('列数不多时网格不横向溢出（列轨没把内容顶宽）', of.sw <= of.cw + 2, JSON.stringify(of));

  // ============ 8. 行轨点击插 1 行 ============
  const beforeRows = (await read()).rowCount;
  await win.locator('.tbl-rail-row').first().click();
  await sleep(450);
  t = await read();
  ok('点一下行轨 → 插入 1 行', t.rowCount === beforeRows + 1, `${beforeRows} → ${t.rowCount}`);

  // ============ 9. 框选 2×2 → 合并 ============
  const cellBox = async (r, c) => win.locator(`[data-cell="${r}-${c}"]`).boundingBox();
  const c00 = await cellBox(0, 0);
  const c11 = await cellBox(1, 1);
  await win.mouse.move(c00.x + c00.width / 2, c00.y + c00.height / 2);
  await win.mouse.down();
  await win.mouse.move(c11.x + c11.width / 2, c11.y + c11.height / 2, { steps: 10 });
  await win.mouse.up();
  await sleep(400);
  const barLabel = ((await win.locator('.tbl-bar-label').textContent().catch(() => '')) || '').trim();
  ok('拖动框选一片格子（浮动条显示 4 格）', barLabel === '4 格', barLabel);
  await win.locator('.tbl-bar-btn', { hasText: '合并' }).first().click();
  await sleep(450);
  t = await read();
  const a = t.rows[0].cells[0];
  ok('框选 2×2 → 合并成 colspan=2 / rowspan=2', a.cs === '2' && a.rs === '2', JSON.stringify(a));

  // 合并态下：合并按钮应禁用（已合并）、拆分按钮应可用
  const btnsMerged = await win.evaluate(() => {
    const b = [...document.querySelectorAll('.tbl-bar-btn')];
    const g = (txt) => b.find((x) => x.textContent.includes(txt));
    return { merge: g('合并').disabled, split: g('拆分').disabled };
  });
  ok('合并态：合并禁用 / 拆分可用', btnsMerged.merge === true && btnsMerged.split === false, JSON.stringify(btnsMerged));

  // ============ 10. 拆分 ============
  await win.locator('.tbl-bar-btn', { hasText: '拆分' }).first().click();
  await sleep(450);
  t = await read();
  const a2 = t.rows[0].cells[0];
  ok('拆分 → colspan/rowspan 清空', !a2.cs && !a2.rs, JSON.stringify(a2));
  // 关键：拆分后每一行的单元格数都要回到合并前（历史 bug：合并 2×2 再拆分，第二行永久少一列）
  const widths = t.rows.map((r) => r.cells.length);
  ok('拆分后各行单元格数一致（不丢列）', new Set(widths).size === 1, JSON.stringify(widths));

  const btnsSplit = await win.evaluate(() => {
    const b = [...document.querySelectorAll('.tbl-bar-btn')];
    const g = (txt) => b.find((x) => x.textContent.includes(txt));
    return { merge: g('合并').disabled, split: g('拆分').disabled };
  });
  ok('拆分后：合并可用 / 拆分禁用', btnsSplit.merge === false && btnsSplit.split === true, JSON.stringify(btnsSplit));

  // ============ 10.5 光标形态：格子上不能是"十字/加号" ============
  const cursors = await win.evaluate(() => ({
    cell: getComputedStyle(document.querySelector('.tbl-cell')).cursor,
    rail: getComputedStyle(document.querySelector('.tbl-rail')).cursor,
    head: getComputedStyle(document.querySelector('.tbl-colhead')).cursor
  }));
  ok('格子上是普通箭头（不再是 cursor:cell 的十字/加号）', cursors.cell === 'default', cursors.cell);
  ok('插入轨是"小手"', cursors.rail === 'pointer', cursors.rail);
  ok('行/列表头是"小手"', cursors.head === 'pointer', cursors.head);

  // ============ 10.6 Del 只清文字、不动结构（以前会走全局快捷键把画布上的元素删掉） ============
  const beforeDel = await read();
  const tablesBeforeDel = await win.evaluate(() => {
    let n = 0; const w = (x) => { if (x.type === 'table') n++; for (const c of x.children) w(c); };
    w(window.__sceneStore.getState().scene.root); return n;
  });
  await win.locator('[data-cell="0-0"]').click();
  await sleep(250);
  await win.keyboard.press('Delete');
  await sleep(400);
  const afterDel = await read();
  const tablesAfterDel = await win.evaluate(() => {
    let n = 0; const w = (x) => { if (x.type === 'table') n++; for (const c of x.children) w(c); };
    w(window.__sceneStore.getState().scene.root); return n;
  });
  ok('表格编辑器里按 Del：画布元素一个没少', tablesAfterDel === tablesBeforeDel, `${tablesBeforeDel} → ${tablesAfterDel}`);
  ok('表格编辑器里按 Del：行列结构不变', afterDel.rowCount === beforeDel.rowCount && afterDel.colCount === beforeDel.colCount,
    `${beforeDel.rowCount}×${beforeDel.colCount} → ${afterDel.rowCount}×${afterDel.colCount}`);
  ok('表格编辑器里按 Del：只把该格文字清空', (afterDel.rows[0].cells[0].text ?? '') === '',
    JSON.stringify(afterDel.rows[0].cells[0]));

  // ============ 10.7 Ctrl+点 加选（用户反馈"按住 Ctrl 不能多选"） ============
  await win.locator('[data-cell="0-0"]').click();
  await sleep(200);
  await win.locator('[data-cell="1-1"]').click({ modifiers: ['Control'] });
  await sleep(300);
  const ctrlLabel = ((await win.locator('.tbl-bar-label').textContent().catch(() => '')) || '').trim();
  ok('Ctrl+点 把格子并进选区（0,0）+（1,1）= 4 格', ctrlLabel === '4 格', ctrlLabel);
  await win.locator('.tbl-bar-btn', { hasText: '合并' }).first().click();
  await sleep(400);
  t = await read();
  const mergedCtrl = t.rows[0].cells[0];
  ok('Ctrl+点 加选后能正常合并', mergedCtrl.cs === '2' && mergedCtrl.rs === '2', JSON.stringify(mergedCtrl));
  await win.locator('.tbl-bar-btn', { hasText: '拆分' }).first().click();
  await sleep(400);

  // ——— 只留 2 张关键截图（人眼复核用）：① 整体 ② 框选+浮动条 ———
  mkdirSync(resolve(ROOT, 'tests/e2e/shots-v042'), { recursive: true });
    await win.locator('[data-cell="0-0"]').hover();
  await sleep(400);
  await win.screenshot({ path: resolve(ROOT, 'tests/e2e/shots-v042/table-editor.png') });
  const b00 = await win.locator('[data-cell="0-0"]').boundingBox();
  const b12 = await win.locator('[data-cell="1-2"]').boundingBox();
  if (b00 && b12) {
    await win.mouse.move(b00.x + b00.width / 2, b00.y + b00.height / 2);
    await win.mouse.down();
    await win.mouse.move(b12.x + b12.width / 2, b12.y + b12.height / 2, { steps: 8 });
    await win.mouse.up();
    await sleep(500);
    await win.screenshot({ path: resolve(ROOT, 'tests/e2e/shots-v042/table-editor-select.png') });
  }

  // ============ 11. 结构开关：表头行 / 表尾行 / 标题 ============
  await win.locator('.tbl-toggle-row', { hasText: '表头行' }).locator('.tbl-mini').first().click();
  await sleep(350);
  await win.locator('.tbl-toggle-row', { hasText: '表尾行' }).locator('.tbl-mini').first().click();
  await sleep(350);
  await win.locator('.tbl-toggle-row', { hasText: '表格标题' }).locator('.tbl-mini').first().click();
  await sleep(350);
  t = await read();
  ok('能加表头行 / 表尾行 / 表格标题', t.sections.join(',').includes('thead') && t.sections.join(',').includes('tfoot') && t.sections.join(',').includes('caption'), t.sections.join(','));

  // ============ 12. 一键预设 ============
  await win.locator('.tbl-preset', { hasText: '斑马纹' }).first().click();
  await sleep(500);
  t = await read();
  ok('套预设：类名 + 子选择器规则 + border-collapse',
    !!t.cls && t.childStyles.includes('th') && t.childStyles.includes('td') && t.borderCollapse === 'collapse',
    `${t.cls} / ${t.childStyles.join('+')}`);

  // ============ 13. 帮助问号（每张卡都要有） ============
  const helps = await win.locator('.table-page .help-btn').count();
  ok('表格编辑器每张卡都有「?」帮助', helps >= 5, String(helps));

  // ============ 14. 结构模板仍可从编辑器插入新表 ============
  const tinfo = await win.evaluate(() => { let n = 0; const w = (x) => { if (x.type === 'table') n++; for (const c of x.children) w(c); }; w(window.__sceneStore.getState().scene.root); return n; });
  await win.locator('.tbl-preset', { hasText: '价格方案表' }).first().click();
  await sleep(700);
  const tinfo2 = await win.evaluate(() => { let n = 0; const w = (x) => { if (x.type === 'table') n++; for (const c of x.children) w(c); }; w(window.__sceneStore.getState().scene.root); return n; });
  ok('结构模板能插入一张新表', tinfo2 === tinfo + 1, `${tinfo} → ${tinfo2}`);
  ok('插入后自动回到编辑器', (await win.locator('.toolbar').count()) === 1);

  // ============ 15. 画布 Ctrl+点 多选（顺带确认没被本轮的视图收窄改动影响） ============
  await win.locator('.element-btn', { hasText: '通用容器' }).first().click();
  await sleep(400);
  await win.locator('.element-btn', { hasText: '通用容器' }).first().click();
  await sleep(400);
  const childIds = await win.evaluate(() => window.__sceneStore.getState().scene.root.children.map((c) => c.id));
  if (childIds.length >= 2) {
    // 注意：Ctrl 修饰键只能走 locator.click({modifiers})；page.mouse.click 不支持 modifiers（会被静默忽略）
    const a = win.locator(`[data-bc-id="${childIds[0]}"]`).first();
    const b = win.locator(`[data-bc-id="${childIds[1]}"]`).first();
    await a.click({ position: { x: 5, y: 5 } });
    await sleep(250);
    const selOne = await win.evaluate(() => window.__sceneStore.getState().scene.selectedIds.length);
    await b.click({ position: { x: 5, y: 5 }, modifiers: ['Control'] });
    await sleep(300);
    const multi = await win.evaluate(() => window.__sceneStore.getState().scene.selectedIds.length);
    ok('画布 Ctrl+点 能多选', selOne === 1 && multi === 2, `${selOne} → ${multi}`);
  } else {
    ok('画布 Ctrl+点 能多选', false, '元素不足 2 个');
  }

  // ============ 16. 合并逻辑重写（v0.4.3）：干净表上跑关键用例 ============
  // 新插一张干净表 → 3 行 × 3 列。
  // ⚠ 先清空选中：否则新表会插进"当前选中的那个元素"里面（可能是别的表的单元格），
  //   嵌套在"不参与体检"的表里 → 它自己也会被一起跳过，后面的体检断言就没意义了。
  await win.evaluate(() => window.__sceneStore.getState().selectElement(null));
  await sleep(250);
  await win.locator('.element-btn', { hasText: '表格' }).first().click();
  await sleep(500);
  await win.locator('.tab-btn', { hasText: '属性' }).first().click();
  await sleep(400);
  await win.locator('.tbl-entry button').first().click();
  await win.waitForSelector('.table-page', { timeout: 8000 });
  await sleep(400);
  await win.locator('.tbl-empty-state .tbl-btn', { hasText: '加 3 行' }).first().click();
  await sleep(450);
  await win.locator('.tbl-rail-col').last().click();
  await sleep(400);
  await win.locator('.tbl-rail-col').last().click();
  await sleep(400);

  const readLast = () => win.evaluate(READ_LAST_TABLE);
  const dragSelect = async (r0, c0, r1, c1) => {
    const a = await win.locator(`[data-cell="${r0}-${c0}"]`).boundingBox();
    const b = await win.locator(`[data-cell="${r1}-${c1}"]`).boundingBox();
    // ⚠ 落点避开"插入轨"：合并格的几何中心正好压在列轨上（列轨 z-index 更高、会吃掉指针事件），
    //   所以统一取格子左侧靠内的位置，保证指针真的落在格子上。
    const ax = a.x + Math.min(6, a.width / 3);
    const bx = b.x + Math.min(6, b.width / 3);
    await win.mouse.move(ax, a.y + a.height / 2);
    await win.mouse.down();
    await win.mouse.move(bx, b.y + b.height / 2, { steps: 10 });
    await win.mouse.up();
    await sleep(350);
  };
  const clickBar = async (txt) => {
    await win.locator('.tbl-bar-btn', { hasText: txt }).first().click();
    await sleep(450);
  };

  let f = await readLast();
  ok('干净表就绪：3 行 × 3 列', f.rowCount === 3 && f.visCols.join(',') === '3,3,3', JSON.stringify(f.visCols));

  // 16.1 两行各自横向合并
  await dragSelect(0, 0, 0, 1);
  await clickBar('合并');
  await dragSelect(1, 0, 1, 1);
  await clickBar('合并');
  f = await readLast();
  ok('两行各自横向合并 → 都是 colspan=2', f.rows[0].cells[0].cs === '2' && f.rows[1].cells[0].cs === '2',
    JSON.stringify([f.rows[0].cells[0], f.rows[1].cells[0]]));

  // 16.2 再把它们纵向合并成 2×2（旧实现：这种"先横后纵"直接放弃，点了没反应）
  // 拖到 (1,0) 就够：那一格自己已经跨了 0~1 列，选区会按格子盒吸附成 2×2
  await dragSelect(0, 0, 1, 0);
  await clickBar('合并');
  f = await readLast();
  const anchorCell = f.rows[0].cells[0];
  ok('先横后纵 → 合成一块 2×2（colspan=2 + rowspan=2）', anchorCell.cs === '2' && anchorCell.rs === '2', JSON.stringify(anchorCell));
  ok('被吃掉的第 2 行只剩第 3 列那格', f.rows[1].cells.length === 1 && f.visCols[1] === 1, JSON.stringify(f.rows[1].cells));

  // 16.3 拆分复原：每行回到 3 列
  await clickBar('拆分');
  f = await readLast();
  ok('拆分复原：3 行 × 3 列、无跨度残留',
    f.visCols.join(',') === '3,3,3' && f.rows.every((r) => r.cells.every((c) => !c.cs && !c.rs)), JSON.stringify(f.visCols));

  // 16.4 合并格内部插列 → 吸附到该格左侧，各行不错位
  await dragSelect(0, 0, 0, 1);
  await clickBar('合并');
  await win.locator('.tbl-rail-col').nth(1).click(); // 第 2 条缝正落在合并格内部
  await sleep(450);
  f = await readLast();
  ok('合并格内部插列：3 列 → 4 列且每行都是 4 列', f.visCols.join(',') === '4,4,4', JSON.stringify(f.visCols));
  ok('合并格被整体推到第 2 列起（吸附到左侧）', f.rows[0].cells[1]?.cs === '2', JSON.stringify(f.rows[0].cells));

  // ============ 17. 表格编辑器里 Ctrl+Z 能撤销结构操作 ============
  // 16.4 插列后合并格被推到第 2 列起；点它要偏左一点，别落在格子中心的列轨上
  await win.locator('[data-cell="0-1"]').click({ position: { x: 6, y: 8 } });
  await sleep(250);
  await clickBar('拆分');
  const afterSplit = await readLast();
  await win.locator('[data-cell="0-0"]').click({ position: { x: 6, y: 8 } });
  await sleep(200);
  await win.keyboard.press('Control+z');
  await sleep(500);
  const afterUndo = await readLast();
  ok('Ctrl+Z 撤销表格结构操作（拆分被撤回）',
    afterSplit.rows[0].cells.every((c) => !c.cs) && afterUndo.rows[0].cells.some((c) => c.cs === '2'),
    `拆分后=${afterSplit.rows[0].cells.length}格 / 撤销后=${JSON.stringify(afterUndo.rows[0].cells.map((c) => c.cs ?? '1'))}`);

  // ============ 18. 表格默认不参与「导出前体检」 ============
  const swDefault = await win.locator('.tbl-switch-row input[type="checkbox"]').isChecked();
  ok('体检开关默认关闭（表格默认不参与体检）', swDefault === false, String(swDefault));
  ok('数据层默认也没有 healthCheck 标记', (await readLast()).healthCheck === false);

  /** 直接读体检结果（测试钩子 window.__healthCheck），不刮向导 DOM */
  const healthIssues = () => win.evaluate(() =>
    window.__healthCheck(window.__sceneStore.getState().scene.root).map((i) => ({ id: i.id, sev: i.severity, title: i.title })));
  /** 「N 个元素没有类名 / ID」里的 N（没有这条 = 0） */
  const unnamedOf = (list) => {
    const line = (list.find((i) => i.id === 'unnamed') || {}).title || '';
    const m = /(\d+)/.exec(line);
    return m ? Number(m[1]) : 0;
  };
  /** 向导确实能打开（顺带确认没报错） */
  const wizardOpens = async () => {
    await win.locator('.tb-health-btn').click();
    await win.waitForSelector('.hc-modal', { timeout: 8000 });
    await sleep(300);
    const clean = (await win.locator('.hc-clean').count()) > 0;
    const n = await win.locator('.hc-list-item').count();
    await win.locator('.hc-modal .cp-close').click();
    await sleep(300);
    return { clean, n };
  };
  const openTableEditor = async () => {
    await win.locator('.tab-btn', { hasText: '属性' }).first().click();
    await sleep(350);
    await win.locator('.tbl-entry button').first().click();
    await win.waitForSelector('.table-page', { timeout: 8000 });
    await sleep(400);
  };
  const backToEditor = async () => {
    await win.locator('.fluent-back-btn').first().click();
    await sleep(600);
  };

  await backToEditor();
  const listOff = await healthIssues();
  const offCount = unnamedOf(listOff);
  const wizOff = await wizardOpens();
  console.log('  · 表格不参与时：unnamed=' + offCount + ' 清单=' + JSON.stringify(listOff.map((i) => i.id)) + ' 向导=' + JSON.stringify(wizOff));

  await openTableEditor();
  await win.locator('.tbl-switch-row input[type="checkbox"]').check();
  await sleep(500);
  const onFlag = (await readLast()).healthCheck;
  await backToEditor();
  const listOn = await healthIssues();
  const onCount = unnamedOf(listOn);
  const wizOn = await wizardOpens();
  console.log('  · 表格参与时：healthCheck=' + onFlag + ' unnamed=' + onCount + ' 清单=' + JSON.stringify(listOn.map((i) => i.id)) + ' 向导=' + JSON.stringify(wizOn));
  ok('打开开关 → 表格纳入体检（未命名元素数量变多）', onFlag === true && onCount > offCount, `${offCount} → ${onCount}`);
  ok('向导里也能看到这条问题（不是只在数据层）', wizOn.n > wizOff.n || wizOn.n > 0, JSON.stringify([wizOff, wizOn]));

  await openTableEditor();
  await win.locator('.tbl-switch-row input[type="checkbox"]').uncheck();
  await sleep(400);
  const offFlag2 = (await readLast()).healthCheck;
  await backToEditor();
  const offCount2 = unnamedOf(await healthIssues());
  ok('关回去 → 表格重新被跳过（数量回到原值）', offFlag2 === false && offCount2 === offCount, `${onCount} → ${offCount2}（原始 ${offCount}）`);

  // ============ 19. 体检徽标不再被工具栏容器裁掉 ============
  // 徽标只统计"非 info"问题，所以先放一个未命名元素（标题 → warn 级「未命名元素」）保证它出现
  await win.evaluate(() => window.__sceneStore.getState().selectElement(null));
  await sleep(200);
  await win.locator('.element-btn', { hasText: '标题' }).first().click();
  await sleep(500);
  const badgeIssues = await healthIssues();
  console.log('  · 徽标前体检清单：' + JSON.stringify(badgeIssues.map((i) => i.id + ':' + i.sev)));
  await sleep(500);
  const badgeHit = await win.evaluate(() => {
    const b = document.querySelector('.tb-health-badge');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const at = (x, y) => { const el = document.elementFromPoint(x, y); return el === b; };
    const who = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return 'null';
      return el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ').slice(0, 2).join('.');
    };    const parent = b.closest('.tb-right');
    const btn = b.closest('.tb-health-btn');
    const pcs = parent ? getComputedStyle(parent) : null;
    return {
      box: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      hitTL: at(r.left + 1, r.top + 1),
      hitTR: at(r.right - 1, r.top + 1),
      hitBL: at(r.left + 1, r.bottom - 1),
      hitBR: at(r.right - 1, r.bottom - 1),
      // 徽标是胶囊形（border-radius:999px），外接矩形四角本来就在形状外，
      // 所以取"内部若干点"做命中判定，再用裁切矩形做"没被切掉"的几何判定。
      hitCenter: at(r.left + r.width / 2, r.top + r.height / 2),
      hitTop: at(r.left + r.width / 2, r.top + 1),
      hitBottom: at(r.left + r.width / 2, r.bottom - 1),
      insideClip: (() => {
        if (!parent) return false;
        const cs = getComputedStyle(parent);
        const pr = parent.getBoundingClientRect();
        const top = pr.top + parseFloat(cs.borderTopWidth || '0');
        const left = pr.left + parseFloat(cs.borderLeftWidth || '0');
        const right = pr.right - parseFloat(cs.borderRightWidth || '0');
        const bottom = pr.bottom - parseFloat(cs.borderBottomWidth || '0');
        return r.top >= top - 0.5 && r.left >= left - 0.5 && r.right <= right + 0.5 && r.bottom <= bottom + 0.5;
      })(),
      clipRect: (() => {
        if (!parent) return null;
        const cs = getComputedStyle(parent);
        const pr = parent.getBoundingClientRect();
        return { top: +pr.top.toFixed(1), left: +pr.left.toFixed(1), bottom: +pr.bottom.toFixed(1), right: +pr.right.toFixed(1), oy: cs.overflowY, ox: cs.overflowX };
      })(),
      whoTL: who(r.left + 1, r.top + 1),
      whoCenter: who(r.left + r.width / 2, r.top + r.height / 2),
      pe: getComputedStyle(b).pointerEvents,
      zIndex: getComputedStyle(b).zIndex,
      overflowY: pcs ? pcs.overflowY : null,
      containerTop: parent ? +parent.getBoundingClientRect().top.toFixed(1) : null,
      btnTop: btn ? +btn.getBoundingClientRect().top.toFixed(1) : null
    };
  });
  ok('体检徽标整块落在容器裁切区内（不再被 overflow 切掉上沿）',
    !!badgeHit && badgeHit.insideClip, JSON.stringify(badgeHit));
  ok('体检徽标内部各点都点得中（可见可交互）',
    !!badgeHit && badgeHit.hitCenter && badgeHit.hitTop && badgeHit.hitBottom, JSON.stringify(badgeHit));
  ok('徽标确实挂在按钮上沿之外（说明这条断言有效）',
    !!badgeHit && badgeHit.btnTop !== null && badgeHit.box.y < badgeHit.btnTop,
    JSON.stringify(badgeHit));

  // 拍一张徽标特写，留给人眼/多模态复核（几何断言 + 视觉核对，双重保险）
  const btnBox = await win.locator('.tb-health-btn').first().boundingBox();
  if (btnBox) {
    await win.screenshot({
      path: resolve(ROOT, 'tests/e2e/shots-v042/health-badge.png'),
      clip: { x: btnBox.x - 16, y: btnBox.y - 16, width: btnBox.width + 44, height: btnBox.height + 32 }
    });
  }

  // ============ 关键部位截图（只留 2 张，供人眼复核） ============
  mkdirSync(resolve(ROOT, 'tests/e2e/shots-v042'), { recursive: true });

  // ============ 20. 表格编辑器「所见即所得」：样式实时生效 + 一次交互 = 一条 undo ============
  // 选中最后一张表 → 进表格编辑页（section 19 插了个标题元素，选中态已经不在表上）
  const liveTableId = await win.evaluate(() => {
    let t = null;
    const w = (n) => { if (n.type === 'table') t = n; for (const c of n.children) w(c); };
    w(window.__sceneStore.getState().scene.root);
    if (!t) return null;
    window.__sceneStore.getState().selectElement(t.id);
    return t.id;
  });
  await sleep(350);
  await openTableEditor();

  const pastLen = () => win.evaluate(() => window.__sceneStore.getState().history.past.length);
  const pendingEdit = () => win.evaluate(() => window.__sceneStore.getState().styleEditPending === true);
  const cssOf = (sel, prop) => win.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  const cellSel = (r, c) => `[data-cell="${r}-${c}"]`;

  ok('右面板出现「单元格大预览」与「表格样式预览」',
    (await win.locator('.cpv-box').count()) === 1 && (await win.locator('.tpv-table').count()) === 1,
    `cpv=${await win.locator('.cpv-box').count()} tpv=${await win.locator('.tpv-table').count()}`);

  // 20.1 表格级底色 → 左边结构网格必须实时跟着变（旧版编辑器页面完全不跟）
  const pastBeforeTableBg = await pastLen();
  await win.evaluate((id) => window.__sceneStore.getState().updateStyle(id, { backgroundColor: 'rgb(255, 238, 221)' }), liveTableId);
  await sleep(300);
  const gridBg = await cssOf('.tbl-grid', 'background-color');
  ok('改表格底色 → 左侧结构网格实时生效', gridBg === 'rgb(255, 238, 221)', gridBg);
  ok('改表格底色 → 右侧「大致效果」预览实时生效',
    (await cssOf('.tpv-table', 'background-color')) === 'rgb(255, 238, 221)', await cssOf('.tpv-table', 'background-color'));

  // 20.2 单元格底色/字号 → 左侧格子本体实时生效（选中态用半透明叠加，不再盖掉真实底色）
  await win.locator(cellSel(1, 1)).click({ position: { x: 6, y: 8 } });
  await sleep(250);
  const pastBeforeCell = await pastLen();
  await win.evaluate((sel) => {
    const st = window.__sceneStore.getState();
    const el = document.querySelector(sel);
    const id = el && el.getAttribute('data-cell-id');
    if (id) st.updateStyle(id, { backgroundColor: 'rgb(0, 128, 255)', fontSize: '19px' });
  }, cellSel(1, 1));
  await sleep(300);
  const cellBg = await cssOf(cellSel(1, 1), 'background-color');
  const cellFs = await cssOf(cellSel(1, 1), 'font-size');
  ok('改单元格底色/字号 → 左侧格子实时生效（选中态也不盖底色）',
    cellBg === 'rgb(0, 128, 255)' && cellFs === '19px', `bg=${cellBg} fs=${cellFs}`);

  // 20.3 拖「大预览」的上边 → 内边距实时变，且整段拖动只压一条撤销记录
  const padBefore = parseFloat(await cssOf(cellSel(1, 1), 'padding-top')) || 0;
  const pastBeforePadDrag = await pastLen();
  const edge = await win.locator('.cpv-edge.is-top').first().boundingBox();
  await win.mouse.move(edge.x + edge.width / 2, edge.y + 4);
  await win.mouse.down();
  await win.mouse.move(edge.x + edge.width / 2, edge.y + 4 + 24, { steps: 8 });
  await win.mouse.up();
  await sleep(350);
  const padAfter = parseFloat(await cssOf(cellSel(1, 1), 'padding-top')) || 0;
  const pastAfterPadDrag = await pastLen();
  ok('按住预览上边往下拖 → 单元格内边距实时变大',
    Math.abs(padAfter - (padBefore + 24)) <= 2, `${padBefore} → ${padAfter}`);
  ok('一次拖动只压一条撤销记录（不是几十条）',
    pastAfterPadDrag - pastBeforePadDrag === 1, `${pastBeforePadDrag} → ${pastAfterPadDrag}`);
  ok('拖动结束后编辑会话已收尾（不会卡住后续撤销）', (await pendingEdit()) === false);

  await win.keyboard.press('Control+z');
  await sleep(350);
  const padUndone = parseFloat(await cssOf(cellSel(1, 1), 'padding-top')) || 0;
  ok('Ctrl+Z 一次就把整段拖动撤销回去', Math.abs(padUndone - padBefore) <= 1, `${padAfter} → ${padUndone}`);

  // 20.4 颜色：开调色盘点一个色板 → 左边格子与预览都变，且只压一条记录（旧版 <input type=color> 会压几十条）
  const pastBeforeColor = await pastLen();
  await win.locator('.tbl-card', { hasText: '单元格' }).locator('.tbl-field', { hasText: '底色' }).locator('.color-swatch-btn').first().click();
  await win.waitForSelector('.cp-modal', { timeout: 6000 });
  await sleep(300);
  await win.locator('.cp-swatch').nth(8).click(); // 色板第 9 个 = #ef4444
  await sleep(250);
  await win.locator('.cp-ok').first().click();
  await sleep(400);
  const pastAfterColor = await pastLen();
  const colorBg = await cssOf(cellSel(1, 1), 'background-color');
  ok('调色盘选色 → 左侧格子实时生效', colorBg === 'rgb(239, 68, 68)', colorBg);
  ok('调色盘选色 → 右侧大预览同步', (await cssOf('.cpv-box', 'background-color')) === 'rgb(239, 68, 68)',
    await cssOf('.cpv-box', 'background-color'));
  ok('一次取色只压一条撤销记录（旧版会压几十条 → Ctrl+Z 要按半天）',
    pastAfterColor - pastBeforeColor === 1, `${pastBeforeColor} → ${pastAfterColor}`);
  ok('调色盘关闭后编辑会话已收尾', (await pendingEdit()) === false);
  await win.keyboard.press('Control+z');
  await sleep(350);
  const colorUndone = await cssOf(cellSel(1, 1), 'background-color');
  ok('Ctrl+Z 一次就撤销掉取色', colorUndone === 'rgb(0, 128, 255)', `${colorBg} → ${colorUndone}`);

  // 20.5 双击格子就地改字
  const dcBox = await win.locator(cellSel(1, 0)).boundingBox();
  await win.mouse.move(dcBox.x + 8, dcBox.y + dcBox.height / 2);
  await win.mouse.down(); await win.mouse.up();
  await sleep(70);
  await win.mouse.down(); await win.mouse.up();
  await sleep(300);
  const editOpen = await win.locator('.tbl-cell-input').count();
  await win.keyboard.press('Control+a');
  await win.keyboard.type('双击改字OK');
  await win.keyboard.press('Enter');
  await sleep(400);
  const cellText = await win.locator(cellSel(1, 0)).first().evaluate((el) => el.textContent || '');
  ok('双击格子 → 就地出现输入框', editOpen === 1, String(editOpen));
  ok('输入文字回车 → 写回这一格（左侧立刻显示）',
    cellText.includes('双击改字OK') && !(await win.locator('.tbl-cell-input').count()),
    cellText.trim().slice(0, 20));

  // 留一张右侧面板实况图（单元格大预览 / 字号滑杆 / 表格样式预览），供人眼 + 多模态复核
  const sideBox = await win.locator('.table-side').first().boundingBox();
  if (sideBox) {
    const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const x = Math.max(0, sideBox.x);
    const y = Math.max(0, sideBox.y);
    await win.screenshot({
      path: resolve(ROOT, 'tests/e2e/shots-v042/table-live.png'),
      clip: { x, y, width: Math.min(sideBox.width, vp.w - x), height: Math.min(sideBox.height, vp.h - y) }
    });
  }
  // 左侧结构网格也来一张：表格底色 + 单元格底色/内边距的实时渲染效果
  const stageBox = await win.locator('.table-stage').first().boundingBox();
  if (stageBox) {
    await win.screenshot({
      path: resolve(ROOT, 'tests/e2e/shots-v042/table-left-live.png'),
      clip: { x: Math.max(0, stageBox.x), y: Math.max(0, stageBox.y), width: stageBox.width, height: Math.min(stageBox.height, 520) }
    });
  }
  // 「表格样式」卡片滚进视野，单独来一张（大致效果预览）
  await win.locator('.tbl-card', { hasText: '表格样式' }).first().scrollIntoViewIfNeeded().catch(() => {});
  await sleep(300);
  const styleCard = await win.locator('.tbl-card', { hasText: '表格样式' }).first().boundingBox();
  if (styleCard) {
    const vp2 = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const x2 = Math.max(0, styleCard.x);
    const y2 = Math.max(0, Math.min(styleCard.y, vp2.h - 200));
    await win.screenshot({
      path: resolve(ROOT, 'tests/e2e/shots-v042/table-style-preview.png'),
      clip: { x: x2, y: y2, width: styleCard.width, height: Math.min(styleCard.height, vp2.h - y2) }
    });
  }

  await win.locator('.fluent-back-btn').first().click();
  await sleep(500);

  ok('无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n===== 表格探针：${pass} 通过 / ${fail} 失败 =====`);
  await app.close();
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
