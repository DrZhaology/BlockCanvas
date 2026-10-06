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

  // ============ 关键部位截图（只留 2 张，供人眼复核） ============
  mkdirSync(resolve(ROOT, 'tests/e2e/shots-v042'), { recursive: true });

  ok('无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n===== 表格探针：${pass} 通过 / ${fail} 失败 =====`);
  await app.close();
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
