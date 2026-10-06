// 临时探针：表格编辑器（结构操作 + 预设 + 导出属性）
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';
const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const findTable = () => {
  let t = null;
  const walk = (n) => { if (!t && n.type === 'table') t = n; for (const c of n.children) walk(c); };
  walk(window.__sceneStore.getState().scene.root);
  return t;
};

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

  // 1. 插入表格 → 属性面板出现入口
  await win.locator('.element-btn', { hasText: '表格' }).first().click();
  await sleep(500);
  await win.locator('.tab-btn', { hasText: '属性' }).first().click();
  await sleep(400);
  console.log('入口存在 =', await win.locator('.tbl-entry').count());
  await win.locator('.tbl-entry button').first().click();
  await win.waitForSelector('.table-page', { timeout: 8000 });
  console.log('表格编辑器已打开 =', await win.locator('.table-page').count());
  await sleep(400);

  // 2. 空表 → 加行 / 加列
  await win.locator('.tbl-btn', { hasText: '下方插入行' }).first().click();
  await sleep(350);
  await win.locator('.tbl-btn', { hasText: '右侧插入列' }).first().click();
  await sleep(350);
  await win.locator('.tbl-btn', { hasText: '右侧插入列' }).first().click();
  await sleep(400);
  const after = await win.evaluate(() => {
    const t = (() => { let x = null; const w = (n) => { if (!x && n.type === 'table') x = n; for (const c of n.children) w(c); }; w(window.__sceneStore.getState().scene.root); return x; })();
    const thead = t.children.find((c) => c.type === 'thead');
    const tbody = t.children.find((c) => c.type === 'tbody');
    return {
      sections: t.children.map((c) => c.type),
      bodyRows: tbody ? tbody.children.length : 0,
      cells: tbody && tbody.children[0] ? tbody.children[0].children.length : 0,
      headRows: thead ? thead.children.length : 0
    };
  });
  console.log('结构 =', JSON.stringify(after));
  console.log('网格单元格数 =', await win.locator('.tbl-cell').count());

  // 3. 选中一个单元格 → 合并 / 预设
  await win.locator('.tbl-cell').first().click();
  await sleep(300);
  await win.locator('.tbl-btn', { hasText: '向右合并' }).first().click();
  await sleep(350);
  const merged = await win.evaluate(() => {
    const t = (() => { let x = null; const w = (n) => { if (!x && n.type === 'table') x = n; for (const c of n.children) w(c); }; w(window.__sceneStore.getState().scene.root); return x; })();
    const tbody = t.children.find((c) => c.type === 'tbody');
    const cell = tbody.children[0].children[0];
    return { colspan: cell.attrs && cell.attrs.colspan, cells: tbody.children[0].children.length };
  });
  console.log('合并后 =', JSON.stringify(merged));

  // 4. 表头行 + 标题 + 预设
  await win.locator('.tbl-btn', { hasText: '＋ 表头行' }).first().click();
  await sleep(300);
  await win.locator('.tbl-btn', { hasText: '＋ 表格标题' }).first().click();
  await sleep(300);
  await win.locator('.tbl-preset', { hasText: '斑马纹' }).first().click();
  await sleep(450);
  const styled = await win.evaluate(() => {
    const t = (() => { let x = null; const w = (n) => { if (!x && n.type === 'table') x = n; for (const c of n.children) w(c); }; w(window.__sceneStore.getState().scene.root); return x; })();
    const tbody = t.children.find((c) => c.type === 'tbody');
    const first = tbody.children[0].children[0];
    return {
      cls: t.attrs && t.attrs.className,
      borderCollapse: t.style.borderCollapse,
      childStyles: (t.childStyles || []).map((c) => c.sel),
      headBg: (t.children.find((c) => c.type === 'thead')?.children[0]?.children[0] || {}).style?.backgroundColor,
      caption: t.children.some((c) => c.type === 'caption'),
      cellBorderBottom: first.style.borderBottomColor || first.style.borderBottomWidth || ''
    };
  });
  console.log('预设后 =', JSON.stringify(styled, null, 1));

  // 5. 结构模板：插入一张价格表
  await win.locator('.tbl-preset', { hasText: '价格方案表' }).first().click();
  await sleep(600);
  const tables = await win.evaluate(() => {
    let n = 0; const w = (x) => { if (x.type === 'table') n++; for (const c of x.children) w(c); };
    w(window.__sceneStore.getState().scene.root); return n;
  });
  console.log('画布里表格数量 =', tables, '| 当前视图回到编辑器 =', await win.locator('.toolbar').count());

  console.log('console 错误 =', errs.slice(0, 4));
  await app.close();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
