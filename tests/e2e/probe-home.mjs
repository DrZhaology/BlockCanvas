// 首页（EmptyHome）探针（v0.4.5）
// 覆盖：启动无标签直接进首页 / 组件偏上 / 搜索工程与文档 / 背景面板（预设、渐变、图片、视频）
//      / 齿轮只显示 SVG / 进入编辑器 / 无 console 错误
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
  const DATA_DIR = resolve(tmpdir(), 'bc-home-probe');
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
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

  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);

  // 1. 启动即首页（没有自动塞「未命名项目 1」）
  ok('启动无标签 → 直接进首页', (await win.locator('.empty-home').count()) === 1);
  ok('首页没有工具栏（还没打开工程）', (await win.locator('.toolbar').count()) === 0);

  // 2. 布局偏上 + 搜索框居中
  const layout = await win.evaluate(() => {
    const c = document.querySelector('.empty-home .eh-center');
    const s = document.querySelector('.eh-search input');
    const cr = c.getBoundingClientRect();
    const sr = s.getBoundingClientRect();
    return {
      centerTop: cr.top,
      centerW: cr.width,
      vh: innerHeight,
      searchW: sr.width,
      searchH: sr.height,
      searchCenter: sr.left + sr.width / 2,
      viewCenter: innerWidth / 2
    };
  });
  ok('首页组件偏上（内容区顶部 < 视口 40%）', layout.centerTop < layout.vh * 0.4,
    `top=${Math.round(layout.centerTop)} vh=${layout.vh}`);
  ok('搜索框够大（高 44~56、宽 ≥ 520）', layout.searchH >= 44 && layout.searchH <= 56 && layout.searchW >= 520,
    `${Math.round(layout.searchW)}×${Math.round(layout.searchH)}`);
  ok('搜索框水平居中（误差 < 4px）', Math.abs(layout.searchCenter - layout.viewCenter) < 4,
    `${layout.searchCenter} vs ${layout.viewCenter}`);

  // 3. 三个快捷入口 + 齿轮只有 SVG
  ok('三个快捷入口都在', (await win.locator('.empty-home .eh-btn').count()) === 3);
  ok('第一个入口是主按钮', (await win.locator('.empty-home .eh-btn.is-primary').count()) === 1);
  const gear = await win.evaluate(() => {
    const g = document.querySelector('.eh-gear');
    return { text: (g?.textContent || '').trim(), svg: g?.querySelectorAll('svg').length || 0 };
  });
  ok('右上角齿轮只有 SVG、没有文字', gear.text === '' && gear.svg === 1, JSON.stringify(gear));

  // 图片 / 视频背景都走 bc-img:// 自定义协议 → CSP 必须放行 img-src 与 media-src
  const csp = await win.evaluate(() =>
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || '');
  ok('CSP 允许 bc-img 的图片与媒体', /img-src[^;]*bc-img:/.test(csp) && /media-src[^;]*bc-img:/.test(csp),
    csp.slice(0, 80));

  // 4. 背景面板：四个页签 + 预设生效 + 保存为我的背景
  await win.locator('.eh-gear').click();
  await sleep(350);
  ok('页面设置面板打开', (await win.locator('.eh-panel').count()) === 1);
  ok('背景面板有 4 个页签（预设/渐变/图片/视频）', (await win.locator('.eh-tab').count()) === 4);
  const before = await win.evaluate(() => getComputedStyle(document.querySelector('.empty-home')).backgroundImage);
  await win.locator('.eh-swatch').nth(1).click();
  await sleep(300);
  const after = await win.evaluate(() => getComputedStyle(document.querySelector('.empty-home')).backgroundImage);
  ok('点预设色块 → 首页背景立刻变化', before !== after && after !== 'none', after.slice(0, 60));
  const saved = await win.evaluate(() => JSON.parse(localStorage.getItem('bc-empty-home-bg') || 'null'));
  ok('背景写进 localStorage（对象格式，带 kind）', saved && saved.kind === 'preset', JSON.stringify(saved));

  await win.locator('.eh-tab', { hasText: '渐变' }).click();
  await sleep(300);
  ok('渐变页有实时预览条', (await win.locator('.eh-gradient-preview').count()) === 1);
  await win.locator('.eh-apply').click();
  await sleep(300);
  const grad = await win.evaluate(() => ({
    css: getComputedStyle(document.querySelector('.empty-home')).backgroundImage,
    saved: JSON.parse(localStorage.getItem('bc-empty-home-bg') || 'null')
  }));
  ok('应用渐变 → 背景是 linear-gradient 且已保存', /linear-gradient/.test(grad.css) && grad.saved?.kind === 'gradient', grad.css.slice(0, 50));
  await win.locator('.eh-save-row .eh-input').fill('探针背景');
  await win.locator('.eh-save-row .eh-mini').click();
  await sleep(300);
  // 「我的背景」只在「预设」页签里展示
  await win.locator('.eh-tab', { hasText: '预设' }).click();
  await sleep(300);
  ok('「保存」把当前背景存成「我的背景」', (await win.locator('.eh-saved').count()) === 1);

  await win.locator('.eh-tab', { hasText: '图片' }).click();
  await sleep(300);
  ok('图片页：未填路径时「应用」禁用', await win.locator('.eh-apply').isDisabled());
  await win.locator('.eh-tab', { hasText: '视频' }).click();
  await sleep(300);
  ok('视频页：未填路径时「应用」禁用', await win.locator('.eh-apply').isDisabled());

  // 5. 搜索：文档结果
  await win.keyboard.press('Escape');
  await sleep(200);
  await win.locator('.eh-search input').click();
  await win.locator('.eh-search input').fill('外边距');
  await sleep(500);
  const hits = await win.locator('.eh-results .eh-hit').count();
  const group = await win.locator('.eh-hit-group', { hasText: '文档' }).count();
  ok('搜索「外边距」出文档结果', hits > 0 && group === 1, `hits=${hits}`);
  ok('搜索结果里有分组标题', (await win.locator('.eh-hit-group').count()) >= 1);
  await win.locator('.eh-search input').fill('');

  // 6. 进入编辑器
  await win.locator('.empty-home .eh-btn').nth(1).click();
  await win.waitForSelector('.toolbar', { timeout: 15000 });
  await sleep(600);
  ok('点「新建项目」→ 进入编辑器（工具栏出现）', (await win.locator('.toolbar').count()) === 1);
  ok('首页已卸载', (await win.locator('.empty-home').count()) === 0);

  // 7. 关掉唯一标签 → 回到首页
  await win.locator('.tab-item.active').hover();
  await win.locator('.tab-item.active .tab-close-btn').click();
  await sleep(700);
  ok('关掉最后一个标签 → 回到首页', (await win.locator('.empty-home').count()) === 1);

  ok('无 console / page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  console.log(`\n===== 首页探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
