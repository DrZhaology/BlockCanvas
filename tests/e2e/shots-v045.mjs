// BlockCanvas · v0.4.5 第二轮视觉存证（只拍图，不断言）
// 产出到 tests/e2e/shots-v045/（已 gitignore）。跑法：
//   node tests/e2e/shots-v045.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const OUT = resolve(ROOT, 'tests/e2e/shots-v045');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const DATA_DIR = resolve(tmpdir(), 'bc-shots-v045');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(900);

  const shot = async (name) => {
    try {
      await win.screenshot({ path: resolve(OUT, name + '.png'), timeout: 8000 });
      console.log('  ✓', name);
    } catch (e) { console.log('  ✗', name, String(e.message).split('\n')[0]); }
  };

  // 1. 首页
  await shot('01-首页-默认');

  // 2. 首页页面设置（背景面板）
  await win.locator('.eh-gear').click();
  await sleep(400);
  await shot('02-首页-页面设置-预设');
  await win.locator('.eh-tab', { hasText: '渐变' }).click();
  await sleep(350);
  await shot('03-首页-页面设置-渐变');
  await win.keyboard.press('Escape');
  await sleep(250);

  // 3. 搜索（工程 + 文档）
  await win.locator('.eh-search input').click();
  await win.locator('.eh-search input').fill('外边距');
  await sleep(500);
  await shot('04-首页-搜索文档');
  await win.locator('.eh-search input').fill('');
  await win.keyboard.press('Escape');

  // 4. 进编辑器：插入几个元素并做一层带 padding/border/margin 的容器
  await win.locator('.empty-home .eh-btn').nth(1).click();
  await win.waitForSelector('.toolbar', { timeout: 15000 });
  await sleep(900);
  await shot('05-编辑器-初始');

  await win.evaluate(() => {
    window.__sceneStore.getState().addElement('div', null);
    const st = window.__sceneStore.getState();
    const root = st.scene.root;
    const id = root.children[root.children.length - 1].id;
    st.updateStyle(id, {
      padding: '18px 22px',
      margin: '14px 0 18px',
      border: '2px solid #1e88e5',
      backgroundColor: '#eef6ff',
      minHeight: '120px'
    });
    st.selectElement(id);
  });
  await sleep(700);
  await shot('06-属性面板-元素');

  // 5. 页面页签：body 设置 + 全局样式卡片
  await win.locator('.panel.inspector .inspector-tabs .inspector-tab', { hasText: '页面' }).first().click();
  await sleep(500);
  await shot('07-页面页签-body设置');
  const gsec = win.locator('.inspector-sec-head', { hasText: '全局样式' }).first();
  if (await gsec.count()) { await gsec.click(); await sleep(400); }
  const addBtn = win.locator('.inspector-sec-body .add-prop-trigger').first();
  if (await addBtn.count()) { await addBtn.click(); await sleep(400); await shot('08-页面页签-添加属性菜单'); await win.keyboard.press('Escape'); }
  await sleep(250);
  await shot('09-页面页签-全局样式');

  // 6. Alt 拖动 → F12 盒模型
  await win.locator('.panel.inspector .inspector-tabs .inspector-tab', { hasText: '元素' }).first().click();
  await sleep(300);
  const box = await win.evaluate(() => {
    const el = document.querySelector('.canvas [data-bc-id]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  });
  if (box) {
    await win.keyboard.down('Alt');
    await win.mouse.move(box.x, box.y);
    await sleep(250);
    await win.mouse.down();
    await win.mouse.move(box.x + 26, box.y + 18, { steps: 10 });
    await sleep(400);
    await shot('10-Alt拖动-盒模型');
    await win.mouse.up();
    await win.keyboard.up('Alt');
  }

  // 7. 深色主题下的警告卡（未命名元素 + 有样式）
  await win.evaluate(() => {
    document.documentElement.setAttribute('data-bc-dark', '1');
  });
  await sleep(500);
  await shot('11-深色-元素面板');
  await win.evaluate(() => document.documentElement.removeAttribute('data-bc-dark'));

  await app.close();
  console.log('完成 →', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
