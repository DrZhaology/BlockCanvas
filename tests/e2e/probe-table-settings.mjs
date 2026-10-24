// BlockCanvas · 表格编辑器「每一个设置项到底有没有生效」专项探针（v0.4.4）
// ---------------------------------------------------------------------------
// 用户反馈："表格里面很多设置项设置了没有作用，或者里面的样式和最后画布上的不一样"
// → 这里把右侧面板的每一项都真实操作一遍，断言它落到了场景数据里；
//   最后再回到画布，断言画布上真的按这套样式渲染（数据 + 渲染双验证）。
// 跑法：env -u ELECTRON_RUN_AS_NODE node tests/e2e/probe-table-settings.mjs
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

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + '  [' + (extra ?? '') + ']'); }
};

const READ = `(() => {
  let t = null;
  const find = (n) => { if (!t && n.type === 'table') t = n; for (const c of n.children) find(c); };
  find(window.__sceneStore.getState().scene.root);
  if (!t) return null;
  const secs = t.children.filter((c) => c.type === 'thead' || c.type === 'tbody' || c.type === 'tfoot');
  const rows = [];
  for (const s of secs) for (const r of s.children) rows.push(r);
  const cell = rows[1] ? rows[1].children[0] : (rows[0] ? rows[0].children[0] : null);
  return {
    table: { id: t.id, cls: (t.attrs && t.attrs.className) || '', style: { ...(t.style || {}) }, childStyles: (t.childStyles || []).map((c) => ({ ...c })) },
    rows: rows.length,
    firstCell: cell ? { id: cell.id, type: cell.type, text: cell.text ?? '', style: { ...(cell.style || {}) }, attrs: { ...(cell.attrs || {}) } } : null
  };
})()`;

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-table-settings');
  // 上一轮残留的 Electron 可能还锁着临时目录（Windows 会报 EBUSY）——
  // 清不掉就沿用旧目录，别让清理动作把整轮测试打断。
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  win.setDefaultTimeout(8000);
  const errs = [];
  win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1200);

  const read = () => win.evaluate(READ);

  // —— 建一张 3 行 3 列的表并进入表格编辑器 ——
  await win.locator('.element-btn', { hasText: '表格' }).first().click();
  await sleep(600);
  await win.locator('.tab-btn', { hasText: '属性' }).first().click();
  await sleep(400);
  await win.locator('.tbl-entry button').first().click();
  await win.waitForSelector('.table-page', { timeout: 8000 });
  await sleep(600);
  await win.locator('.tbl-empty-state .tbl-btn', { hasText: '加 3 行' }).first().click();
  await sleep(500);
  await win.locator('.tbl-rail-col').last().click();
  await sleep(350);
  await win.locator('.tbl-rail-col').last().click();
  await sleep(450);
  // 选中第 2 行第 1 格（避开第 1 行，验证"改它不会动别人"）
  await win.locator('.tbl-cell[data-cell="1-0"]').first().click({ position: { x: 8, y: 10 } });
  await sleep(400);

  const settingsCard = win.locator('.tbl-card', { hasText: '表格设置' }).first();
  const cellCard = win.locator('.tbl-card', { hasText: '单元格设置' }).first();
  const field = (card, label) => card.locator('.tbl-field').filter({ hasText: label }).first();

  console.log('\n===== A. 预设（先套，因为预设会重设整张表的外观） =====');
  {
    const before3 = await read();
    await win.locator('.tbl-preset', { hasText: '斑马' }).first().click().catch(async () => {
      await win.locator('.tbl-preset').first().click();
    });
    await sleep(500);
    const after3 = await read();
    ok('套预设 → table.childStyles 有 th / td 规则',
      (after3.table.childStyles || []).some((c) => c.sel === 'th' || c.sel === 'td'),
      JSON.stringify((after3.table.childStyles || []).map((c) => c.sel)));
    ok('套预设 → 表格样式有变化', JSON.stringify(after3.table.style) !== JSON.stringify(before3.table.style));
  }

  console.log('\n===== B. 表格设置（整张表） =====');
  const t0 = await read();
  ok('表已就绪', !!t0 && t0.rows >= 3, JSON.stringify({ rows: t0?.rows }));

  // 宽度（数值 + 单位）
  {
    const f = field(settingsCard, '宽度');
    await f.locator('.tbl-num-input').fill('480');
    await f.locator('.tbl-num-unit').selectOption('px');
    await sleep(300);
    const s = (await read()).table.style;
    ok('宽度 = 480px（数值框可直接输入 + 单位下拉）', s.width === '480px', JSON.stringify(s.width));
  }
  // 布局算法
  {
    await field(settingsCard, '布局算法').locator('select').selectOption('fixed');
    await sleep(250);
    ok('布局算法 = fixed', (await read()).table.style.tableLayout === 'fixed');
  }
  // 边框合并
  {
    await field(settingsCard, '边框合并').locator('select').selectOption('separate');
    await sleep(250);
    ok('边框合并 = separate', (await read()).table.style.borderCollapse === 'separate');
  }
  // 边框间距
  {
    const f = field(settingsCard, '边框间距');
    await f.locator('.tbl-num-input').fill('6');
    await sleep(250);
    ok('边框间距 = 6px', (await read()).table.style.borderSpacing === '6px', JSON.stringify((await read()).table.style.borderSpacing));
  }
  // 外框样式
  {
    await field(settingsCard, '外框样式').locator('select').selectOption('dashed');
    await sleep(250);
    const s = (await read()).table.style;
    ok('外框样式 = dashed（四边一起）', s.borderTopStyle === 'dashed' && s.borderLeftStyle === 'dashed', JSON.stringify(s.borderTopStyle));
  }
  // 边框粗细
  {
    const f = field(settingsCard, '边框粗细');
    await f.locator('.tbl-num-input').fill('3');
    await sleep(250);
    const s = (await read()).table.style;
    ok('边框粗细 = 3px（四边一起）', s.borderTopWidth === '3px' && s.borderBottomWidth === '3px', JSON.stringify(s.borderTopWidth));
  }
  // 边框颜色
  {
    const f = field(settingsCard, '边框颜色');
    await f.locator('.color-text-input').fill('#123456');
    await f.locator('.color-text-input').blur();
    await sleep(350);
    const s = (await read()).table.style;
    ok('边框颜色 = #123456（四边一起）', s.borderTopColor === '#123456' && s.borderRightColor === '#123456', JSON.stringify(s.borderTopColor));
  }
  // 圆角
  {
    const f = field(settingsCard, '圆角');
    await f.locator('.tbl-num-input').fill('12');
    await sleep(250);
    const s = (await read()).table.style;
    ok('圆角 = 12px（四角一起）', s.borderTopLeftRadius === '12px' && s.borderBottomRightRadius === '12px', JSON.stringify(s.borderTopLeftRadius));
  }
  // 字号
  {
    const f = field(settingsCard, '字号');
    await f.locator('.tbl-num-input').fill('15');
    await sleep(250);
    ok('整表字号 = 15px', (await read()).table.style.fontSize === '15px', JSON.stringify((await read()).table.style.fontSize));
  }
  // 标题位置
  {
    await field(settingsCard, '标题位置').locator('select').selectOption('bottom');
    await sleep(250);
    ok('标题位置 = bottom', (await read()).table.style.captionSide === 'bottom');
  }
  // 字色 / 底色
  {
    const f = field(settingsCard, '字色');
    await f.locator('.color-text-input').fill('#222222');
    await f.locator('.color-text-input').blur();
    await sleep(300);
    ok('整表字色 = #222222', (await read()).table.style.color === '#222222', JSON.stringify((await read()).table.style.color));
  }
  {
    const f = field(settingsCard, '底色');
    await f.locator('.color-text-input').fill('#f7fbff');
    await f.locator('.color-text-input').blur();
    await sleep(300);
    ok('整表底色 = #f7fbff', (await read()).table.style.backgroundColor === '#f7fbff', JSON.stringify((await read()).table.style.backgroundColor));
  }
  // 阴影
  {
    await field(settingsCard, '阴影').locator('input').fill('0 6px 20px rgba(15,23,42,.08)');
    await sleep(300);
    ok('阴影写入', (await read()).table.style.boxShadow === '0 6px 20px rgba(15,23,42,.08)');
  }

  console.log('\n===== C. 单元格设置（只作用于选中的那一格） =====');
  const before = await read();
  {
    await field(cellCard, '文案').locator('input').fill('新文案');
    await field(cellCard, '文案').locator('input').blur();
    await sleep(300);
    ok('文案写入选中格', (await read()).firstCell.text === '新文案', JSON.stringify((await read()).firstCell.text));
  }
  {
    const f = field(cellCard, '单元格底色');
    await f.locator('.color-text-input').fill('#ffeedd');
    await f.locator('.color-text-input').blur();
    await sleep(350);
    ok('单元格底色 = #ffeedd', (await read()).firstCell.style.backgroundColor === '#ffeedd', JSON.stringify((await read()).firstCell.style.backgroundColor));
  }
  {
    const f = field(cellCard, '文字颜色');
    await f.locator('.color-text-input').fill('#aa3300');
    await f.locator('.color-text-input').blur();
    await sleep(350);
    ok('单元格文字色 = #aa3300', (await read()).firstCell.style.color === '#aa3300', JSON.stringify((await read()).firstCell.style.color));
  }
  {
    const f = field(cellCard, '字号');
    await f.locator('.tbl-num-input').fill('19');
    await sleep(300);
    ok('单元格字号 = 19px', (await read()).firstCell.style.fontSize === '19px', JSON.stringify((await read()).firstCell.style.fontSize));
  }
  {
    const f = cellCard.locator('.tbl-field').filter({ hasText: '内边距 上' }).first();
    await f.locator('.tbl-num-input').fill('14');
    await sleep(300);
    ok('内边距 上 = 14px', (await read()).firstCell.style.paddingTop === '14px', JSON.stringify((await read()).firstCell.style.paddingTop));
  }
  {
    await field(cellCard, '水平对齐').locator('select').selectOption('center');
    await sleep(250);
    ok('水平对齐 = center', (await read()).firstCell.style.textAlign === 'center');
  }
  {
    await field(cellCard, '垂直对齐').locator('select').selectOption('bottom');
    await sleep(250);
    ok('垂直对齐 = bottom', (await read()).firstCell.style.verticalAlign === 'bottom');
  }
  {
    await field(cellCard, '不换行').locator('input[type="checkbox"]').check();
    await sleep(250);
    ok('不换行 = nowrap', (await read()).firstCell.style.whiteSpace === 'nowrap');
  }
  {
    await field(cellCard, '类型').locator('select').selectOption('th');
    await sleep(300);
    ok('类型改成 th', (await read()).firstCell.type === 'th', (await read()).firstCell.type);
    // scope 只在 th 上可用 —— 趁着还是 th 立刻验证
    const scopeSel = field(cellCard, 'scope').locator('select');
    ok('scope 下拉在 th 上可用', await scopeSel.isEnabled());
    await scopeSel.selectOption('row');
    await sleep(300);
    ok('scope 写入 = row', (await read()).firstCell.attrs.scope === 'row', JSON.stringify((await read()).firstCell.attrs));
    await field(cellCard, '类型').locator('select').selectOption('td');
    await sleep(350);
    ok('类型改回 td 后 scope 自动禁用', !(await field(cellCard, 'scope').locator('select').isEnabled()));
  }

  console.log('\n===== D. 表头行 / 表尾行 / 表格标题 =====');
  {
    const struct = win.locator('.tbl-card', { hasText: '表格结构' }).first();
    const before2 = await read();
    await struct.locator('button[title*="表头区块末尾加一行"]').click();
    await sleep(450);
    const after2 = await read();
    ok('加表头行 → 行数 +1', after2.rows === before2.rows + 1, `${before2.rows} → ${after2.rows}`);
    await struct.locator('button[title*="表尾区块末尾加一行"]').click();
    await sleep(450);
    ok('加表尾行 → 行数再 +1', (await read()).rows === before2.rows + 2);
    await struct.locator('button[title*="删掉表尾区块最后一行"]').click();
    await sleep(400);
    await struct.locator('button[title*="删掉表头区块最后一行"]').click();
    await sleep(400);
    ok('删表头/表尾行 → 回到原行数', (await read()).rows === before2.rows, String((await read()).rows));
  }

  console.log('\n===== E. 再套一次预设：自定义单元格底色不该被斑马纹冲掉 =====');
  {
    await win.locator('.tbl-cell[data-cell="1-0"]').first().click({ position: { x: 8, y: 10 } });
    await sleep(300);
    const beforeBg = (await read()).firstCell.style.backgroundColor;
    await win.locator('.tbl-preset', { hasText: '斑马' }).first().click().catch(async () => {
      await win.locator('.tbl-preset').first().click();
    });
    await sleep(500);
    const afterBg = (await read()).firstCell.style.backgroundColor;
    ok('套预设后手改过的单元格底色仍然保留', afterBg === beforeBg, `${beforeBg} → ${afterBg}`);
    // 预设会重设整张表的外观 —— 为了让 F 段能验证"设置项到达画布"，这里把表格级设置再写一遍
    await field(settingsCard, '外框样式').locator('select').selectOption('dashed');
    await sleep(200);
    await field(settingsCard, '边框粗细').locator('.tbl-num-input').fill('3');
    await sleep(200);
    const fz = field(settingsCard, '字号');
    await fz.locator('.tbl-num-input').fill('15');
    await sleep(200);
    const fc = field(settingsCard, '字色');
    await fc.locator('.color-text-input').fill('#222222');
    await fc.locator('.color-text-input').blur();
    await sleep(250);
    const fb = field(settingsCard, '底色');
    await fb.locator('.color-text-input').fill('#f7fbff');
    await fb.locator('.color-text-input').blur();
    await sleep(300);
  }

  console.log('\n===== F. 回到画布：渲染真的跟得上吗 =====');
  await win.locator('.fluent-back-btn').first().click();
  await win.waitForSelector('.toolbar', { timeout: 8000 });
  await sleep(800);
  const t = await read();
  const cls = (t.table.cls || '').split(/\s+/)[0];
  const canvas = await win.evaluate(({ tableId, clsName }) => {
    const el = document.querySelector(`.canvas [data-bc-id="${tableId}"]`);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const auto = document.querySelector('.bc-auto-css');
    const firstCell = document.querySelector('.canvas table tbody tr:nth-child(2) td, .canvas table tbody tr:nth-child(2) th');
    const cellCs = firstCell ? getComputedStyle(firstCell) : null;
    return {
      tableBg: cs.backgroundColor, tableBorder: cs.borderTopWidth + ' ' + cs.borderTopStyle,
      tableRadius: cs.borderTopLeftRadius, tableFontSize: cs.fontSize, tableWidth: cs.width,
      tableColor: cs.color,
      cellBg: cellCs ? cellCs.backgroundColor : null,
      cellColor: cellCs ? cellCs.color : null,
      cellFontSize: cellCs ? cellCs.fontSize : null,
      cellPadTop: cellCs ? cellCs.paddingTop : null,
      cellAlign: cellCs ? cellCs.textAlign : null,
      hasTableRule: auto ? auto.textContent.includes(`.${clsName} {`) : false
    };
  }, { tableId: t.table.id, clsName: cls });
  ok('画布能找到这张表', !!canvas, JSON.stringify(canvas));
  if (canvas) {
    ok('画布表格底色跟设置一致', canvas.tableBg === 'rgb(247, 251, 255)', canvas.tableBg);
    ok('画布表格外框跟设置一致（3px dashed）',
      canvas.tableBorder.includes('dashed') && Math.abs(parseFloat(canvas.tableBorder) - 3) < 0.6,
      canvas.tableBorder);
    ok('画布表格圆角跟设置一致（12px）', canvas.tableRadius === '12px', canvas.tableRadius);
    ok('画布表格字号跟设置一致（15px）', canvas.tableFontSize === '15px', canvas.tableFontSize);
    ok('画布表格字色跟设置一致', canvas.tableColor === 'rgb(34, 34, 34)', canvas.tableColor);
    ok('画布表格宽度按设置生效（480px 或受容器约束）', canvas.tableWidth !== 'auto', canvas.tableWidth);
    ok('画布单元格底色跟设置一致', canvas.cellBg === 'rgb(255, 238, 221)', canvas.cellBg);
    ok('画布单元格字色跟设置一致', canvas.cellColor === 'rgb(170, 51, 0)', canvas.cellColor);
    ok('画布单元格字号跟设置一致（19px）', canvas.cellFontSize === '19px', canvas.cellFontSize);
    ok('画布单元格内边距上跟设置一致（14px）', canvas.cellPadTop === '14px', canvas.cellPadTop);
    ok('画布单元格水平对齐跟设置一致（center）', canvas.cellAlign === 'center', canvas.cellAlign);
    ok('画布注入了这张表的样式规则 (.bc-auto-css)', canvas.hasTableRule, String(canvas.hasTableRule));
  }

  console.log('\n===== G. 编辑器里的表格 == 画布上的表格（逐格比对最终外观） =====');
  {
    await win.locator('.tab-btn', { hasText: '属性' }).first().click();
    await sleep(450);
    await win.locator('.tbl-entry button').first().click();
    await win.waitForSelector('.table-page', { timeout: 8000 });
    await sleep(650);
    const inEditor = await win.evaluate(() => {
      const pick = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, padTop: cs.paddingTop, padLeft: cs.paddingLeft, fontSize: cs.fontSize, color: cs.color };
      };
      const out = {};
      for (const r of [0, 1, 2]) out['r' + r] = pick(document.querySelector(`.tbl-cell[data-cell="${r}-0"]`));
      return out;
    });
    await win.locator('.fluent-back-btn').first().click();
    await win.waitForSelector('.toolbar', { timeout: 8000 });
    await sleep(800);
    const onCanvas = await win.evaluate(() => {
      const rows = document.querySelectorAll('.canvas table tbody tr');
      const pick = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, padTop: cs.paddingTop, padLeft: cs.paddingLeft, fontSize: cs.fontSize, color: cs.color };
      };
      const out = {};
      for (const r of [0, 1, 2]) out['r' + r] = pick(rows[r] && rows[r].children[0]);
      return out;
    });
    const diff = ['r0', 'r1', 'r2'].filter((k) => JSON.stringify(inEditor[k]) !== JSON.stringify(onCanvas[k]));
    ok('编辑器每一格的外观都与画布一致（底色/内边距/字号/字色）',
      diff.length === 0, diff.length ? JSON.stringify(diff.map((k) => ({ k, e: inEditor[k], c: onCanvas[k] }))) : '3/3 一致');
  }

  ok('无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n===== 表格设置项探针：${pass} 通过 / ${fail} 失败 =====`);
  await app.close();
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
