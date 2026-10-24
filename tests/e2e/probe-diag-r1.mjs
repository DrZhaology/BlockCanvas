// R1 精确复现：未保存项目 → 关闭标签 → 回首页 → 搜索框点不进去
// 用法：node tests/e2e/probe-diag-r1.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const probe = async (win, tag) => {
  const info = await win.evaluate(() => {
    const input = document.querySelector('.eh-search input');
    if (!input) return { missing: true };
    const r = input.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    const chain = [];
    let n = hit;
    while (n && chain.length < 6) {
      chain.push(n.tagName.toLowerCase() + '.' + String(n.className || '').split(' ').filter(Boolean).join('.'));
      n = n.parentElement;
    }
    return {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      hitChain: chain,
      disabled: input.disabled,
      readOnly: input.readOnly,
      homeClass: document.querySelector('.empty-home')?.className,
      homePE: getComputedStyle(document.querySelector('.empty-home')).pointerEvents,
      inputPE: getComputedStyle(input).pointerEvents,
      zIndexAtPoint: hit ? getComputedStyle(hit).zIndex : null,
      // 有没有残留的遮罩/模态
      leftovers: [...document.querySelectorAll('body > *')]
        .map((e) => String(e.className || '').slice(0, 40))
        .filter((c) => /mask|modal|overlay|backdrop|confirm/i.test(c))
    };
  });
  console.log(`\n===== ${tag} =====`);
  console.log(JSON.stringify(info, null, 2));
  try {
    await win.locator('.eh-search input').click({ timeout: 2500 });
    await sleep(150);
    const focused = await win.evaluate(() => document.activeElement?.tagName + '.' + String(document.activeElement?.className || ''));
    console.log('点击后 activeElement:', focused);
    // 试着输入，看 value 是否更新
    await win.keyboard.type('abc', { delay: 20 });
    await sleep(150);
    const val = await win.evaluate(() => document.querySelector('.eh-search input')?.value);
    console.log('输入 abc 后 value:', JSON.stringify(val));
    await win.evaluate(() => { const i = document.querySelector('.eh-search input'); if (i) i.value = ''; });
  } catch (e) {
    console.log('点击失败:', e.message.split('\n')[0]);
  }
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-diag-r1');
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
  await sleep(700);

  await probe(win, '基线：刚启动的首页');

  // 新建项目 → 加一个元素（让它变"脏"）
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement(st.scene.root.id, 'div');
  });
  await sleep(500);
  const dirty = await win.evaluate(() => {
    const st = window.__tabStore.getState();
    const t = st.tabs.find((x) => x.id === st.activeTabId);
    return { name: t?.name, isDirty: t?.isDirty, filePath: t?.filePath };
  });
  console.log('\n当前标签:', JSON.stringify(dirty));

  // 关闭这个未保存的标签
  try {
    await win.locator('.tab-close-btn').first().click({ timeout: 3000 });
    console.log('已点击 .tab-close-btn');
  } catch (e) {
    console.log('点击关闭按钮失败:', e.message.split('\n')[0]);
  }
  await sleep(700);

  // 处理"未保存"确认弹窗
  const dialogSeen = await win.evaluate(() => {
    const mask = document.querySelector('[class*="confirm"], [class*="app-modal"], .modal-mask');
    return mask ? { cls: String(mask.className), text: mask.textContent.replace(/\s+/g, ' ').slice(0, 80) } : null;
  });
  console.log('\n确认弹窗:', JSON.stringify(dialogSeen));

  // 点"直接关闭"
  for (const label of ['直接关闭', '确定', '关闭']) {
    const b = win.locator(`button:has-text("${label}")`).first();
    if (await b.count()) {
      try { await b.click({ timeout: 2000 }); console.log('点击了按钮:', label); break; } catch { /* next */ }
    }
  }
  await sleep(1200);

  await probe(win, '复现：未保存项目关掉后回到首页');

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
