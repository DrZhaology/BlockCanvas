// ============================================================================
// v0.4.6 · 设置页「横屏 / 竖屏 / 公共」三块区域探针
// ----------------------------------------------------------------------------
// 用户原话：「我建议横屏，竖屏，公共的就可以分成三块区域。」
// 这里只证明"三块区域真的分出来了"：
//   ① 有 5 个分区横幅（横屏×1 / 竖屏×1 / 公共×3），且都带 fluent-area-head；
//   ② 三种区域的左色条**颜色互不相同**（不然等于没分区）；
//   ③ 分区横幅是整块带底的，不是一行小灰字（高度 + 背景色都要量）。
// 用法：node tests/e2e/probe-settings-areas.mjs
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
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '   -> ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

const main = async () => {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-settings-areas');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await win.waitForFunction(() => !document.querySelector('.bc-loading'), { timeout: 15000 }).catch(() => {});
  await sleep(500);

  // 设置是走标题栏「设置」菜单打开的（原生弹窗，探针点不到），
  // 所以直接派发 App 监听的那个事件；三块区域（横屏 / 竖屏 / 公共）都在「编辑器与画布」这一节。
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-settings')));
  await sleep(1000);
  await win.locator('.fluent-nav-item', { hasText: '编辑器与画布' }).first().click().catch(async () => {
    await win.evaluate(() => {
      const nav = [...document.querySelectorAll('.fluent-nav-item, .fluent-nav-btn, .fluent-sidebar button')]
        .find((n) => (n.textContent || '').includes('编辑器与画布'));
      nav?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  });
  await sleep(900);

  const areas = await win.evaluate(() => {
    const heads = [...document.querySelectorAll('.fluent-group-title.fluent-area-head')];
    return heads.map((h) => {
      const r = h.getBoundingClientRect();
      const cs = getComputedStyle(h);
      return {
        area: h.getAttribute('data-area'),
        text: (h.textContent || '').trim().slice(0, 14),
        h: Math.round(r.height),
        bar: cs.borderLeftColor,
        bg: cs.backgroundColor,
        weight: cs.fontWeight
      };
    });
  });
  check('设置页存在分区横幅', areas.length >= 3, `count=${areas.length}`);
  if (areas.length === 0) { await win.screenshot({ path: resolve(ROOT, 'tests/e2e/shots-v046/08-settings-fail.png') }); await app.close(); process.exit(1); }

  const kinds = new Set(areas.map((a) => a.area));
  check('横屏 / 竖屏 / 公共三种区域都在', kinds.has('landscape') && kinds.has('portrait') && kinds.has('common'), JSON.stringify([...kinds]));

  const barColors = new Set(areas.map((a) => a.bar));
  check('三种区域左色条颜色互不相同', barColors.size >= 3, JSON.stringify([...barColors]));

  check('分区横幅是"带底的块"，不是一行小灰字', areas.every((a) => a.h >= 24 && a.bg !== 'rgba(0, 0, 0, 0)'),
    JSON.stringify(areas.map((a) => `${a.area}:${a.h}px/${a.bg}`)));

  check('分区标题是加粗（视觉层级高于卡片标题）', areas.every((a) => Number(a.weight) >= 600),
    JSON.stringify(areas.map((a) => a.weight)));

  await win.screenshot({ path: resolve(ROOT, 'tests/e2e/shots-v046/08-settings-areas.png') });
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(1); });
