// 打开生成的宣传页工程并截图（整页 + 手机断点）
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const DATA_DIR = resolve(ROOT, 'data');
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  win.setDefaultTimeout(20000);
  await sleep(1600);
  await win.evaluate((w) => { w.resizeTo(1500, 950); }, win).catch(() => {});

  // 通过工程中心打开（真实 API 名是 openProjectFile，不是 openProject）
  const opened = await win.evaluate(async () => {
    const list = await window.bc.listProjects();
    const target = (list || []).find((p) => String(p.name || '').includes('宣传页') || String(p.fileName || '').includes('宣传页'));
    if (!target) return { ok: false, list: (list || []).map((p) => p.name) };
    const res = await window.bc.openProjectFile(target.filePath);
    return { ok: true, name: target.name, fileName: target.fileName, filePath: target.filePath, resOk: res?.ok, err: res?.error };
  });
  console.log('A 打开工程：', JSON.stringify(opened));
  await sleep(2000);

  // 桌面视图：整页
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.selectElement(null);
  });
  await sleep(400);
  await win.screenshot({ path: 'tests/e2e/shots-diag/promo-full.png', fullPage: false }).catch(() => {});

  // 把画布高度撑开，逐段截图
  const info = await win.evaluate(() => {
    const canvas = document.querySelector('.canvas');
    return { h: canvas ? Math.round(canvas.getBoundingClientRect().height) : 0, w: canvas ? Math.round(canvas.getBoundingClientRect().width) : 0 };
  });
  console.log('B 画布尺寸：', JSON.stringify(info));

  // 切到手机断点看响应式
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.setActiveBreakpoint('mobile');
  });
  await sleep(600);
  await win.screenshot({ path: 'tests/e2e/shots-diag/promo-mobile.png' }).catch(() => {});

  await app.close();
};
main().catch((e) => { console.error(e); process.exit(1); });
