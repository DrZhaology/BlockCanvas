// v0.4.5 外部工程登记验收
// 用法：node tests/e2e/probe-v045-external.mjs
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, statSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-external');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  // 存到 data/projects 之外（模拟"从别处导入的工程"）
  const outsideDir = join(DATA_DIR, 'elsewhere', 'nested');
  mkdirSync(outsideDir, { recursive: true });
  const outsidePath = join(outsideDir, '外部工程.bcproj');

  const saved = await win.evaluate(async (target) => {
    const scene = window.__sceneStore.getState().scene;
    const res = await window.bc.saveProject({ name: '外部工程', scene }, false, target);
    return { ok: res.ok, path: res.path, error: res.error };
  }, outsidePath);
  console.log('保存到外部目录:', JSON.stringify(saved));

  // 打开它 —— 这一步应该触发"登记"
  const opened = await win.evaluate(async (p) => {
    const res = await window.bc.openProjectFile(p);
    return { ok: res.ok, error: res.error };
  }, outsidePath);
  check('外部工程能正常打开', opened.ok, opened.ok ? '' : opened.error);

  // 项目列表里应该出现它，并带 external 标记
  const listed = await win.evaluate(() => window.bc.listProjects());
  const hit = (listed || []).find((p) => (p.filePath || '').endsWith('外部工程.bcproj'));
  check('外部工程出现在项目列表里', !!hit, hit ? `name=${hit.name} external=${hit.external}` : '列表里没有');
  check('列表项带 external 标记（与内置工程区分）', !!hit && hit.external === true, hit ? `external=${hit.external}` : '');
  check('外部工程没有出现在 data/projects 目录里',
    existsSync(outsidePath) && !existsSync(join(DATA_DIR, 'projects', '外部工程.bcproj')),
    '文件仍在原位置');

  // 登记表文件应该写出来了
  const regPath = join(DATA_DIR, 'external-projects.json');
  check('登记表落盘（data/external-projects.json）', existsSync(regPath),
    existsSync(regPath) ? `${statSync(regPath).size} 字节` : '没写出来');

  // ---------- UI：项目中心里的「外部」徽标 ----------
  await win.locator('button:has-text("全部项目")').first().click();
  await sleep(1200);
  const uiExternal = await win.evaluate(() => ({
    cards: document.querySelectorAll('.pc-card').length,
    externalBadges: document.querySelectorAll('.pc-badge.is-external').length
  }));
  check('项目中心卡片上有「外部」徽标', uiExternal.externalBadges >= 1,
    `卡片 ${uiExternal.cards} 张，外部徽标 ${uiExternal.externalBadges} 个`);

  // 回编辑器，再删掉外部文件（模拟"文件被移走"）
  await win.locator('button:has-text("返回编辑器")').first().click();
  await sleep(800);
  rmSync(outsidePath, { force: true });
  await sleep(300);
  await win.locator('button:has-text("全部项目")').first().click();
  await sleep(1200);

  const uiMissing = await win.evaluate(() => {
    const card = document.querySelector('.pc-card.is-missing');
    return {
      missingCards: document.querySelectorAll('.pc-card.is-missing').length,
      hasBadge: !!document.querySelector('.pc-badge.is-missing'),
      hasForget: !!document.querySelector('.pc-forget-btn')
    };
  });
  check('文件丢失的卡片有 is-missing 样式 + 徽标 + 移除按钮',
    uiMissing.missingCards >= 1 && uiMissing.hasBadge && uiMissing.hasForget,
    `卡片=${uiMissing.missingCards} 徽标=${uiMissing.hasBadge} 移除按钮=${uiMissing.hasForget}`);

  // 点「移除记录」→ 卡片消失
  await win.locator('.pc-forget-btn').first().click();
  await sleep(800);
  const afterForget = await win.evaluate(() => document.querySelectorAll('.pc-card.is-missing').length);
  check('点「移除记录」后这条卡片消失', afterForget === 0, `剩余 ${afterForget} 张丢失卡片`);

  // 列表层面也应清掉
  const afterDelete = await win.evaluate(() => window.bc.listProjects());
  const ghost = (afterDelete || []).find((p) => (p.filePath || '').endsWith('外部工程.bcproj'));
  check('移除后列表里不再有这条记录', !ghost, ghost ? '仍在列表' : '已清空');

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });