// 属性搜索探针（v0.4.4g）
// 覆盖：① 画布中键 → 属性搜索框 → Enter → 右侧「CSS 样式属性」定位并高亮
//      ② 「+ 添加属性」按属性名（权重排序）/ 按属性值（蓝色插入条目）搜索
//      ③ 搜不到时明确显示"没有匹配"
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

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-propsearch-probe');
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  mkdirSync(DATA_DIR, { recursive: true });
  for (const rel of [resolve(ROOT, 'extensions'), resolve(ROOT, 'data', 'extensions')]) {
    if (existsSync(rel)) cpSync(rel, resolve(DATA_DIR, 'extensions'), { recursive: true });
  }
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1500);

  const id = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'p1', type: 'div', style: { width: '200px', height: '60px', backgroundColor: '#e8eefc' }, children: [] }, null);
    return window.__sceneStore.getState().scene.selectedId;
  });
  await sleep(500);
  const rect = await win.evaluate((eid) => {
    const r = document.querySelector(`.canvas [data-bc-id="${eid}"]`).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, id);

  // ============ 1. 中键搜索 ============
  await win.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2, { button: 'middle' });
  await sleep(400);
  ok('中键弹出属性搜索框', (await win.locator('.bc-prop-search').count()) === 1);

  // 输入"字号"（应命中 fontSize）
  await win.locator('.bc-prop-search-input').fill('字号');
  await sleep(300);
  const best = await win.locator('.bc-prop-search-item.is-best .bc-prop-search-key').innerText().catch(() => '');
  ok('权重最高结果是 fontSize', best === 'fontSize', best);

  // 容错：拼错也能命中（fontsize → fontsizee）
  await win.locator('.bc-prop-search-input').fill('fontsizee');
  await sleep(300);
  const best2 = await win.locator('.bc-prop-search-item.is-best .bc-prop-search-key').innerText().catch(() => '');
  ok('拼错也能命中 fontSize', best2 === 'fontSize', best2);

  // 回车 → 定位到右侧属性行并高亮
  await win.locator('.bc-prop-search-input').fill('字号');
  await sleep(250);
  await win.locator('.bc-prop-search-input').press('Enter');
  await sleep(700);
  const located = await win.evaluate(() => {
    const row = document.querySelector('[data-prop-key="fontSize"]');
    return {
      exists: !!row,
      flash: !!row && row.className.includes('flash'),
      inCss: !!row && !!row.closest('.inspector-sec')
    };
  });
  ok('回车后定位到 fontSize 属性行', located.exists === true, JSON.stringify(located));
  ok('该行带橙色高亮（flash）', located.flash === true, JSON.stringify(located));

  // ============ 2. 「+ 添加属性」按值搜索 ============
  await win.locator('.add-prop-trigger').click();
  await sleep(300);
  await win.locator('.add-prop-search input').fill('flex');
  await sleep(400);
  const blueCount = await win.locator('.add-prop-value-item').count();
  ok('按属性值搜索出现蓝色插入条目', blueCount > 0, String(blueCount));
  const blueTxt = await win.locator('.add-prop-value-item').first().innerText().catch(() => '');
  ok('蓝色条目显示「属性名 = 属性值」', /=/.test(blueTxt) && /flex/i.test(blueTxt), blueTxt.replace(/\n/g, ' '));

  // 点蓝色条目 → 直接插入属性名 + 属性值
  await win.locator('.add-prop-value-item').first().click();
  await sleep(500);
  const disp = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return { display: n.style.display, flexDirection: n.style.flexDirection, justifyContent: n.style.justifyContent, alignItems: n.style.alignItems };
  }, id);
  ok('点蓝色条目后「属性名 + 属性值」一起写入', Object.values(disp).some((v) => v === 'flex'), JSON.stringify(disp));

  // ============ 3. 搜不到 → 明确"没有匹配" ============
  await win.locator('.add-prop-trigger').click();
  await sleep(300);
  await win.locator('.add-prop-search input').fill('zzzzzzzz不存在的东西');
  await sleep(400);
  const empty = await win.locator('.add-prop-empty').count();
  const items = await win.locator('.add-prop-item').count();
  ok('搜不到时显示"没有匹配"且不列随机结果', empty === 1 && items === 0, `empty=${empty} items=${items}`);
  await win.keyboard.press('Escape');
  await sleep(300);

  ok('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  console.log(`\n===== 属性搜索探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
