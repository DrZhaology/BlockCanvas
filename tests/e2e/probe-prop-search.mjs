// 属性搜索探针（v0.4.4g）
// 覆盖：① 画布中键 → 属性搜索框 → Enter → 右侧「CSS 样式属性」定位并高亮
//      ② 「+ 添加属性」按属性名（权重排序）/ 按属性值（蓝色插入条目）搜索
//      ③ 搜不到时明确显示"没有匹配"
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
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1500);

  const id = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.insertTemplate({ id: 'p1', type: 'div', style: { width: '200px', height: '60px', backgroundColor: '#e8eefc' }, children: [] }, null);
    return window.__sceneStore.getState().scene.selectedId;
  });
  await sleep(500);

  // 中键点击元素中心：每次重新量一次 rect（前面的步骤可能让画布滚动），
  // 否则会点到空白处 → 搜索框不弹，属于探针自身的定位问题。
  const midClickEl = async (eid) => {
    await win.evaluate((e) => {
      document.querySelector(`.canvas [data-bc-id="${e}"]`)?.scrollIntoView({ block: 'center' });
    }, eid);
    await sleep(260);
    const r = await win.evaluate((e) => {
      const b = document.querySelector(`.canvas [data-bc-id="${e}"]`).getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }, eid);
    await win.mouse.click(r.x + r.w / 2, r.y + r.h / 2, { button: 'middle' });
  };

  // ============ 1. 中键搜索 ============
  await midClickEl(id);
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

  // Ctrl+Enter → 添加并定位到右侧属性行并高亮
  //（v0.4.4h：fontSize 原本没添加，直接 Enter 只提示"没有添加"，不会偷偷加 → 用 Ctrl+Enter）
  await win.locator('.bc-prop-search-input').fill('字号');
  await sleep(250);
  await win.locator('.bc-prop-search-input').press('Control+Enter');
  await sleep(700);
  const located = await win.evaluate(() => {
    const row = document.querySelector('[data-prop-key="fontSize"]');
    return {
      exists: !!row,
      flash: !!row && row.className.includes('flash'),
      inCss: !!row && !!row.closest('.inspector-sec')
    };
  });
  ok('回车（Ctrl+Enter）后定位到 fontSize 属性行', located.exists === true, JSON.stringify(located));
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

  // ============ 4. 已添加 / 未添加 两态 + Enter / Ctrl+Enter（v0.4.4h）============
  // 重新打开中键搜索
  await midClickEl(id);
  await sleep(400);
  ok('中键再次弹出属性搜索框', (await win.locator('.bc-prop-search').count()) === 1);

  // backgroundColor 已设置过 → 应显示"已添加"（蓝色）
  await win.locator('.bc-prop-search-input').fill('backgroundcolor');
  await sleep(300);
  const bgItem = await win.evaluate(() => {
    const el = document.querySelector('.bc-prop-search-item.is-best');
    return el ? { cls: el.className, badge: el.querySelector('.bc-prop-search-badge')?.textContent || '' } : null;
  });
  ok('已添加的属性显示为蓝色 + 「已添加」', !!bgItem && /is-added/.test(bgItem.cls) && bgItem.badge === '已添加', JSON.stringify(bgItem));

  // lineHeight（文本行高）没设置过 → 白色 + 「未添加」 + 小字 Ctrl 提示
  await win.locator('.bc-prop-search-input').fill('行高');
  await sleep(300);
  const fsItem = await win.evaluate(() => {
    const el = document.querySelector('.bc-prop-search-item.is-best');
    return el ? { cls: el.className, badge: el.querySelector('.bc-prop-search-badge')?.textContent || '', key: el.querySelector('.bc-prop-search-key')?.textContent || '' } : null;
  });
  ok('未添加的属性显示为白色 + 「未添加」', !!fsItem && /is-missing/.test(fsItem.cls) && fsItem.badge === '未添加', JSON.stringify(fsItem));
  ok('权重第一项未添加时显示 Ctrl+Enter 小字提示', (await win.locator('.bc-prop-search-hint-ctr').count()) === 1);

  // 直接 Enter → 只提示"没有添加"，不写样式
  await win.locator('.bc-prop-search-input').press('Enter');
  await sleep(350);
  const stillOpen = await win.locator('.bc-prop-search').count();
  const msgTxt = await win.locator('.bc-prop-search-msg').innerText().catch(() => '');
  const fsAfter = await win.evaluate((eid) => {
    const n = window.__sceneStore.getState().scene.root.children.find((c) => c.id === eid);
    return n?.style?.lineHeight ?? '';
  }, id);
  // 文案是「还没添加，按 Ctrl+Enter 添加并定位」——断言两种写法都接受
  ok('未添加时按 Enter 只提示"没有添加"（框不关、不写样式）', stillOpen === 1 && /(还没|没有)添加/.test(msgTxt) && fsAfter === '', `open=${stillOpen} msg=${msgTxt} lh=${fsAfter}`);

  // Ctrl+Enter → 快捷添加并定位
  await win.locator('.bc-prop-search-input').press('Control+Enter');
  await sleep(700);
  const added = await win.evaluate(() => {
    const row = document.querySelector('[data-prop-key="lineHeight"]');
    return { exists: !!row, flash: !!row && row.className.includes('flash') };
  });
  ok('Ctrl+Enter 快捷添加并定位到该属性行', added.exists === true && added.flash === true, JSON.stringify(added));

  // ============ 5. 点别处关闭 + 退场动画（v0.4.4h）============
  await midClickEl(id);
  await sleep(400);
  ok('中键弹出搜索框（第 3 次）', (await win.locator('.bc-prop-search').count()) === 1);
  // 点击远处空白（窗口左下角，肯定在搜索框之外）→ 应关闭
  const vp = win.viewportSize() || { width: 1200, height: 800 };
  await win.mouse.click(6, vp.height - 6);
  await sleep(60);
  const closing = await win.locator('.bc-prop-search.is-closing').count();
  await sleep(300);
  const gone = await win.locator('.bc-prop-search').count();
  ok('点击别处即关闭（不只是 Esc）', gone === 0, `gone=${gone} closingClass=${closing}`);

  ok('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  console.log(`\n===== 属性搜索探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
