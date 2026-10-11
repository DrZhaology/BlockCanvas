// BlockCanvas · 更新中心专项探针（v0.4.3）
// 覆盖：进入方式 / 读取源默认折叠 / 三板块与默认展开状态 / 按钮样式统一 / 发行说明与历史版本区块
// 特点：**不依赖网络**（GitHub 拉不到发行版时也能跑），只断言页面结构与样式契约。
// ⚠ 单独成文件而不是塞进 probe-v042：在 probe-v042 那一长串用例之后再切到更新页，
//    这个环境的 GPU 进程会偶发 FATAL（"GPU process isn't usable"）把整轮带崩。
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

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

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-update');
  // 上一轮残留的 Electron 可能还锁着临时目录（Windows 会报 EBUSY）——
  // 清不掉就沿用旧目录，别让清理动作把整轮测试打断。
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
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1200);

  // —— 进入更新中心（主进程菜单事件）——
  await win.evaluate(() => window.dispatchEvent(new Event('menu:check-update')));
  await win.waitForSelector('.update-page', { timeout: 8000 });
  await sleep(800);
  ok('进入更新中心（菜单事件 → 独立页面）', (await win.locator('.update-page').count()) === 1);
  // 版本号来自异步检测结果：先轮询等它落定（离线时也会回填本地版本）
  let ver = '';
  for (let i = 0; i < 20; i++) {
    ver = ((await win.locator('.update-current-ver').first().innerText().catch(() => '')) || '').trim();
    if (/^\d+\.\d+/.test(ver)) break;
    await sleep(300);
  }
  ok('显示当前版本号', /^\d+\.\d+/.test(ver), ver);

  // —— 读取源 / 下载源默认折叠 ——
  ok('读取源 / 下载源默认折叠（用户默认看不到）',
    (await win.locator('.update-mirror-tip').count()) === 0,
    `mirror-tip=${await win.locator('.update-mirror-tip').count()}`);
  await win.locator('.update-detail-toggle').first().click();
  await sleep(350);
  const detailText = (await win.locator('.update-mirror-tip').first().innerText().catch(() => '')) || '';
  ok('点「检测详情」才展开，且写明读取源 / 下载源',
    (await win.locator('.update-mirror-tip').count()) === 1 && detailText.includes('读取源') && detailText.includes('下载源'),
    detailText.slice(0, 40).replace(/\n/g, ' '));
  await win.locator('.update-detail-toggle').first().click();
  await sleep(300);
  ok('再点一次可以收起来', (await win.locator('.update-mirror-tip').count()) === 0);

  // —— 三个板块与默认展开状态 ——
  // 注意：只有检测成功（网络可达）才会渲染三板块；离线时这一组自动跳过。
  const secTitles = await win.locator('.update-sec-name').allTextContents();
  if (secTitles.length === 0) {
    console.log('  · 本轮未连上发行版（离线），跳过三板块断言');
  } else {
    const joined = secTitles.join(' | ');
    ok('三个板块：可更新 / 可选择更新（重装）/ 历史版本',
      joined.includes('可更新') && joined.includes('可选择更新') && joined.includes('历史版本'), joined);
    const states = await win.locator('.update-sec').evaluateAll((els) =>
      els.map((el) => ({
        text: (el.querySelector('.update-sec-name')?.textContent || '').replace(/\s+/g, ''),
        caret: (el.querySelector('.update-sec-caret')?.textContent || ''),
        cursor: getComputedStyle(el).cursor,
        count: (el.querySelector('.update-sec-count')?.textContent || '').replace(/\s+/g, ''),
        // 数量角标是否在整行的右端（而不是紧贴标题）
        countAtRight: (() => {
          const c = el.querySelector('.update-sec-count');
          if (!c) return false;
          return el.getBoundingClientRect().right - c.getBoundingClientRect().right < 20;
        })()
      })));
    const find = (kw) => states.find((s) => s.text.includes(kw));
    ok('「可更新」默认展开（▾）', find('可更新')?.caret === '▾', JSON.stringify(find('可更新')));
    ok('「可选择更新」默认折叠（▸）', find('可选择更新')?.caret === '▸', JSON.stringify(find('可选择更新')));
    ok('「历史版本」默认折叠（▸）', find('历史版本')?.caret === '▸', JSON.stringify(find('历史版本')));
    ok('板块标题是手型光标（不是文字光标）', states.every((s) => s.cursor === 'pointer'), JSON.stringify(states.map((s) => s.cursor)));
    ok('数量角标钉在标题行最右端',
      states.every((s) => s.countAtRight && /^\d+$/.test(s.count)),
      JSON.stringify(states.map((s) => `${s.text}=${s.count}@${s.countAtRight}`)));
    ok('旧版那两句冗余小字已删除（"仅作信息展示" / "都可以更新（含重新安装"）',
      !joined.includes('仅作信息展示') && !joined.includes('含重新安装'), joined.slice(0, 60));

    // 展开历史版本 → 每条都有「发行说明」+「下载 zip」
    const histTitle = win.locator('.update-sec', { hasText: '历史版本' }).first();
    if (await histTitle.count()) {
      await histTitle.click();
      await sleep(400);
      const rows = await win.locator('.update-history-row').count();
      if (rows > 0) {
        const acts = await win.locator('.update-history-row').first().locator('button').allTextContents();
        const joined2 = acts.join(' | ');
        ok('历史版本每条都有「发行说明」与「下载 zip」',
          joined2.includes('发行说明') && joined2.includes('下载 zip'), joined2);
        ok('历史版本默认只显示 5 条（其余靠查看更多）', rows <= 5, String(rows));
        const moreTxt = (await win.locator('.update-more-btn').first().innerText().catch(() => '')) || '';
        const hasMore = await win.locator('.update-more-btn').count();
        if (hasMore) {
          await win.locator('.update-more-btn').first().click();
          await sleep(400);
          const rows2 = await win.locator('.update-history-row').count();
          ok('点「查看更多」能放出更多历史版本', rows2 > rows, `${rows} → ${rows2}`);
        } else {
          ok('没有更多历史版本时不显示「查看更多」', true, '（历史总数 ≤ 5）');
        }

        // —— v0.4.4 关键回归：「下载 zip」不得弹全屏遮罩、进度贴卡片下方 ——
        // 把 update:download-asset 换成"永远不返回"的桩，让下载停在进行中，
        // 再从主进程推一条进度（复现真实链路），验证页面行为。
        await app.evaluate(({ ipcMain }) => {
          ipcMain.removeHandler('update:download-asset');
          ipcMain.handle('update:download-asset', async () => new Promise(() => {}));
        });
        const firstRow = win.locator('.update-history-row').first();
        await firstRow.locator('button', { hasText: '下载 zip' }).click();
        await sleep(350);
        await app.evaluate(({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows()[0];
          if (w) w.webContents.send('update:progress', { msg: '已下载 1.2 / 4.8 MB', pct: 42 });
        });
        await sleep(450);
        ok('下载 zip 期间**不弹**全屏更新遮罩（编辑器不被锁）',
          (await win.locator('.bc-update-blocker').count()) === 0,
          `blocker=${await win.locator('.bc-update-blocker').count()}`);
        const strip = firstRow.locator('.update-dl-strip');
        ok('下载进度显示在版本卡片下方', (await strip.count()) === 1);
        const stripTxt = ((await strip.first().innerText().catch(() => '')) || '').replace(/\n/g, ' ');
        ok('进度条带百分比与阶段文案', stripTxt.includes('42%') && stripTxt.includes('1.2 / 4.8'), stripTxt.slice(0, 60));
        const widths = await win.evaluate(() => {
          const s = document.querySelector('.update-history-row .update-dl-strip');
          const r = document.querySelector('.update-history-row');
          return s && r ? { s: Math.round(s.getBoundingClientRect().width), r: Math.round(r.getBoundingClientRect().width) } : null;
        });
        ok('进度条横跨整行（不是挤在右侧按钮旁边）',
          !!widths && widths.s > widths.r * 0.8, JSON.stringify(widths));
      } else {
        console.log('  · 历史版本为空，跳过其内部断言');
      }
    }
  }

  // —— 按钮样式统一（这一轮的产品要求：任何页面都不该出现系统默认按钮）——
  const btns = await win.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { display: cs.display, radius: cs.borderRadius, padL: cs.paddingLeft, bg: cs.backgroundColor, border: cs.borderTopWidth };
    };
    return { primary: pick('.update-head-card .btn-primary'), mini: pick('.btn-mini'), fluent: pick('.fluent-back-btn'), detail: pick('.update-detail-toggle') };
  });
  const styled = (b) => !!b && (b.display === 'flex' || b.display === 'inline-flex') && parseFloat(b.radius) > 0 && parseFloat(b.padL) > 0;
  ok('「重新检测」按钮有真实样式（`.btn-primary` 以前只在工具栏作用域定义过）', styled(btns.primary), JSON.stringify(btns.primary));
  ok('「检测详情」按钮也有真实样式（以前是浏览器默认方灰框，文字还会溢出）', styled(btns.detail), JSON.stringify(btns.detail));
  if (btns.mini) ok('`.btn-mini` 也是同一套语言', styled(btns.mini), JSON.stringify(btns.mini));

  // —— 返回编辑器 ——
  await win.locator('.fluent-back-btn').first().click();
  await sleep(600);
  ok('返回编辑器正常', (await win.locator('.update-page').count()) === 0 && (await win.locator('.workspace').count()) === 1);

  ok('无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n===== 更新中心探针：${pass} 通过 / ${fail} 失败 =====`);
  await app.close();
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
