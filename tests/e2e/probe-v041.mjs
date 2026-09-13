// 针对性探针：验证「宽度数值输入」「四值输入」「渐变」「伪类动效」「设备切换」等关键交互真实生效
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');

const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (name, cond, extra = '') => out.push(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-data');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC_EXT = resolve(ROOT, 'extensions');
  if (existsSync(SRC_EXT)) cpSync(SRC_EXT, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const app = await electron.launch({
    args: ['.', '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'],
    cwd: ROOT,
    executablePath: electronPath,
    env: { ...process.env, BC_DATA_DIR: DATA_DIR }
  });
  const win = await app.firstWindow();
  const errs = [];
  win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1200);

  const openCss = async () => {
    if (await win.locator('.add-prop-trigger').count()) return;
    const h = win.locator('.inspector-sec-head', { hasText: 'CSS 样式属性' }).first();
    if (await h.count()) { await h.click({ force: true }); await sleep(450); }
  };
  const openSec = async (title) => {
    const h = win.locator('.inspector-sec-head', { hasText: title }).first();
    if (!(await h.count())) return;
    const caret = h.locator('.sec-caret').first();
    const t = ((await caret.textContent().catch(() => '')) || '').trim();
    if (t !== '▾') { await h.click({ force: true }); await sleep(450); }
  };

  // 插入一个 div 并选中
  await win.locator('.element-btn', { hasText: '通用容器' }).first().click();
  await sleep(400);
  await win.locator('.tab-btn', { hasText: '属性' }).first().click();
  await sleep(300);
  await openCss();

  // —— 1. 宽度数值输入 ——
  const widthRow = win.locator('.prop-row', { hasText: '宽度' }).first();
  const widthInput = widthRow.locator('.num-unit-num').first();
  ok('宽度行存在', (await widthInput.count()) > 0);
  // 默认宽度是 100%，单位下拉当前为 %；先切成 px 再填数字，验证「数字 + 单位」两段式输入
  await widthRow.locator('.unit-select').selectOption('px');
  await sleep(250);
  await widthInput.fill('300');
  await win.keyboard.press('Tab');
  await sleep(350);
  const w = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas > div')).width);
  ok('宽度数值输入生效 = 300px', w === '300px', w);

  // —— 2. 四值输入（padding） ——
  await win.locator('.add-prop-trigger').first().click();
  await sleep(250);
  await win.locator('.add-prop-search input').fill('padding');
  await sleep(200);
  await win.locator('.add-prop-item', { hasText: '内边距' }).first().click();
  await sleep(450);
  const padRow = win.locator('.prop-row', { hasText: '内边距' }).first();
  const cells = padRow.locator('.trbl4-input');
  ok('内边距渲染 4 个独立数值框', (await cells.count()) === 4, String(await cells.count()));
  await cells.nth(0).fill('12'); await win.keyboard.press('Tab'); await sleep(200);
  await cells.nth(1).fill('24'); await win.keyboard.press('Tab'); await sleep(200);
  const pad = await win.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.canvas > div'));
    return s.paddingTop + '/' + s.paddingRight;
  });
  ok('四值输入生效 = 12px/24px', pad === '12px/24px', pad);

  // —— 3. 四边同步开关 ——
  await padRow.locator('.trbl4-sync input').check();
  await sleep(200);
  await cells.nth(2).fill('40'); await win.keyboard.press('Tab'); await sleep(300);
  const pad2 = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas > div')).paddingTop);
  ok('四边同步：改「下」后「上」也变 40px', pad2 === '40px', pad2);

  // —— 4. 背景渐变（原生代码导入 + 预制） ——
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const id = st.scene.selectedId;
    st.addVisibleProp(id, 'backgroundColor');
    // 模拟"模板里手写的原生渐变代码"
    st.updateStyle(id, { backgroundImage: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' });
  });
  await sleep(400);
  const gradTab = win.locator('.bg-mode-btn', { hasText: '渐变' }).first();
  ok('背景色行出现 纯色/渐变 双模式', (await gradTab.count()) > 0);
  ok('原生渐变代码被识别为渐变模式', (await win.locator('.bg-mode-btn.active').first().textContent())?.includes('渐变'));
  const parsedAngle = await win.locator('.grad-angle-num').first().inputValue();
  ok('原生 135deg 被正确解析', parsedAngle === '135', parsedAngle);
  const stopCount = await win.locator('.grad-stop').count();
  ok('原生 2 个色标被正确解析', stopCount === 2, String(stopCount));
  await win.locator('.grad-presets-toggle').first().click();
  await sleep(400);
  const presetCount = await win.locator('.grad-preset-item').count();
  ok('预制渐变画廊 >= 20 款', presetCount >= 20, String(presetCount));
  await win.locator('.grad-preset-item', { hasText: '午夜星河' }).first().click();
  await sleep(450);
  const bgImg = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas > div')).backgroundImage);
  ok('套用预制渐变生效', bgImg.includes('linear-gradient'), bgImg.slice(0, 60));

  // —— 5. 快捷助手同步开关 ——
  await openSec('快捷助手');
  const syncBox = win.locator('.qh-sync-label input').first();
  ok('快捷助手存在同步开关', (await syncBox.count()) > 0);
  ok('同步开关默认开启', await syncBox.isChecked());

  // —— 6. 伪类预制动效 ——
  await openSec('交互状态');
  await win.locator('.pseudo-tab', { hasText: ':hover' }).first().click();
  await sleep(400);
  const presetBtns = await win.locator('.pseudo-preset-btn').count();
  ok(':hover 预制动效 >= 8 款', presetBtns >= 8, String(presetBtns));
  await win.locator('.pseudo-preset-btn', { hasText: '上浮' }).first().click();
  await sleep(500);
  const hoverTf = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const find = (n) => { if (n.id === st.scene.selectedId) return n; for (const c of n.children) { const r = find(c); if (r) return r; } return null; };
    const n = find(st.scene.root);
    return n?.pseudoStyles?.hover?.transform ?? '';
  });
  ok('预制动效写入 :hover transform', hoverTf.includes('translateY'), hoverTf);
  const sliderCount = await win.locator('.fx-slider-row').count();
  ok('动效微调滑块出现', sliderCount >= 2, String(sliderCount));

  // —— 7. 设备切换（未选中元素也可用） ——
  await win.locator('.canvas').click({ position: { x: 5, y: 5 } });
  await sleep(400);
  const selCount = await win.evaluate(() => window.__sceneStore.getState().scene.selectedIds.length);
  ok('已取消选中', selCount === 0, String(selCount));
  await win.locator('.device-btn', { hasText: '手机' }).first().click();
  await sleep(700);
  const mobileW = await win.evaluate(() => {
    const c = document.querySelector('.canvas');
    return c ? Math.round(c.getBoundingClientRect().width) : -1;
  });
  const bpNow = await win.evaluate(() => window.__sceneStore.getState().activeBreakpoint);
  ok('未选中元素也能切到手机设备', bpNow === 'mobile', bpNow);
  ok('手机设备下画布宽度 ≈375px', Math.abs(mobileW - 375) <= 3, String(mobileW));
  await win.locator('.device-btn', { hasText: '电脑' }).first().click();
  await sleep(600);
  const bpBack = await win.evaluate(() => window.__sceneStore.getState().activeBreakpoint);
  ok('切回电脑设备', bpBack === 'desktop', bpBack);

  // —— 8. 文字渐变 ——
  await win.locator('.element-btn', { hasText: '标题1' }).first().click();
  await sleep(450);
  await openSec('快捷助手');
  const chip = win.locator('.text-grad-chip').first();
  ok('文字渐变预制配色存在', (await chip.count()) > 0);
  await chip.click();
  await sleep(500);
  const tg = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const find = (n) => { if (n.id === st.scene.selectedId) return n; for (const c of n.children) { const r = find(c); if (r) return r; } return null; };
    const n = find(st.scene.root);
    return {
      bg: n?.style.backgroundImage ?? '',
      clip: n?.style.WebkitBackgroundClip ?? n?.style.backgroundClip ?? '',
      fill: n?.style.WebkitTextFillColor ?? ''
    };
  });
  ok('文字渐变三件套写入', tg.bg.includes('gradient') && tg.clip === 'text' && tg.fill === 'transparent', JSON.stringify(tg));

  ok('全程零 console/page 错误', errs.length === 0, errs.slice(0, 3).join(' || '));

  await app.close();
  console.log(out.join('\n'));
  console.log('\n=== ' + out.filter((l) => l.startsWith('PASS')).length + ' 通过 / ' + out.filter((l) => l.startsWith('FAIL')).length + ' 失败 ===');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
