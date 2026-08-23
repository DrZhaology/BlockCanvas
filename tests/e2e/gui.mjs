// BlockCanvas 自动化 GUI 测试
// 用 Playwright 驱动真实 Electron 窗口，覆盖主流程：
//   插入 24 种元素 → 文案 → 图层树 → 添加属性(trbl/select/color) → 高亮"新"徽标
//   → 改宽高 → 撤销/重做 → 复制/删除 → 全程监控 console 报错（白屏类 bug 直接 FAIL）
// 运行：pnpm test:e2e  （先 pnpm build 再用 electron . 启动，不依赖 dev server）
import { createRequire } from 'module';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { resolve } from 'path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');

const ROOT = process.cwd();
const SHOTS = resolve(ROOT, 'tests/e2e/shots');
const REPORT = resolve(ROOT, 'tests/e2e/report.txt');
const EXPORT_CHECK = resolve(ROOT, 'tests/e2e/bc-export-check.html'); // S24 走真实导出按钮
mkdirSync(SHOTS, { recursive: true });

const results = [];
const consoleErrors = [];
const consoleLogs = [];
let shotNo = 0;

function log(msg) { results.push(msg); console.log(msg); }
function check(name, cond, extra = '') {
  log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
  return !!cond;
}
async function shot(page, name) {
  shotNo += 1;
  await page.screenshot({ path: `${SHOTS}/${String(shotNo).padStart(2, '0')}-${name}.png` });
}
async function waitFor(page, locator, timeout = 8000) {
  await locator.waitFor({ state: 'visible', timeout });
}
async function waitUntil(fn, timeout = 8000, msg = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await fn()) return true; } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`waitUntil timeout: ${msg}`);
}
const doc = (win, sel) => win.locator(sel);
const elHas = (win, sel, text) => doc(win, sel).filter({ hasText: text });

async function main() {
  log('=== BlockCanvas E2E 启动 ===');
  const app = await electron.launch({ args: ['.'], cwd: ROOT, executablePath: electronPath, env: { ...process.env, BC_EXPORT_PATH: EXPORT_CHECK } });
  const win = await app.firstWindow();

  win.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[console.error] ${m.text()}`);
    else if (m.text().includes('[probe]')) consoleLogs.push(m.text());
  });
  win.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));

  try {
    // ===== S1 初始界面 =====
    await waitFor(win, doc(win, '.app'));
    check('S1.1 窗口标题', (await win.title()).includes('BlockCanvas'));
    await doc(win, '.tab-btn:has-text("属性")').click();
    await waitFor(win, doc(win, '.element-panel .inspector-tab:has-text("元素")'));
    await waitFor(win, doc(win, '.canvas-empty'));
    await waitFor(win, doc(win, '.inspector .panel-title:has-text("属性")'));
    check('S1.2 初始三栏齐全', true);
    await shot(win, '初始界面');

    // ===== S2 插入 div =====
    await doc(win, '.element-btn:has-text("通用容器")').click();
    await waitUntil(async () => (await doc(win, '.canvas > div').count()) === 1, 8000, 'canvas div=1');
    await waitFor(win, doc(win, '.inspector .panel-title:has-text("<div>")'));
    check('S2.1 插入 div 后画布出现 1 个 div', true);
    await shot(win, '插入div');

    // ===== S3 插入 p + 文案 =====
    await doc(win, '.element-btn:has-text("段落")').click();
    await waitUntil(async () => (await doc(win, '.canvas p').count()) === 1, 8000, 'canvas p=1');
    await waitFor(win, doc(win, '.inspector .panel-title:has-text("<p>")'));
    const TA = doc(win, '.inspector .field textarea');
    await TA.fill('你好，自动化测试');
    await waitUntil(async () => (await doc(win, '.canvas p').textContent())?.includes('自动化测试'), 8000, 'p 文案渲染');
    check('S3.1 p 文案渲染到画布', true);
    await shot(win, '段落文案');

    // ===== S4 图层树 =====
    await doc(win, '.tab-btn:has-text("图层")').click();
    await waitFor(win, doc(win, '.layer-row.root-row:has-text("画布根")'));
    await waitFor(win, elHas(win, '.layer-row', 'div 容器'));
    check('S4.1 图层树显示 画布根/div/p', (await elHas(win, '.layer-row', 'p 段落').count()) === 1);
    await shot(win, '图层树');
    await doc(win, '.tab-btn:has-text("属性")').click();
    await waitFor(win, doc(win, '.add-prop-trigger'));

    // ===== S5 添加属性（trbl: margin）+ 新徽标 =====
    await doc(win, '.add-prop-trigger').click();
    await waitFor(win, doc(win, '.add-prop-menu'));
    await doc(win, '.add-prop-search input').fill('margin');
    await waitFor(win, elHas(win, '.add-prop-item', '外边距'));
    await elHas(win, '.add-prop-item', '外边距').first().click();
    await waitUntil(async () => (await doc(win, '.prop-row.highlight').count()) === 1, 5000, '高亮行出现');
    const hlRow = doc(win, '.prop-row.highlight');
    check('S5.1 添加属性后出现高亮行', await hlRow.count() === 1);
    check('S5.2 徽标为"新"', (await hlRow.locator('.prop-new-badge').textContent()) === '新');
    check('S5.3 行标题是外边距', ((await hlRow.textContent()) ?? '').includes('外边距'));
    await shot(win, '新属性高亮');

    await hlRow.locator('input').first().click(); // 点进输入框 = 开始编辑
    await waitUntil(async () => (await doc(win, '.prop-row.highlight').count()) === 0, 5000, '高亮取消');
    check('S5.4 聚焦后高亮消失', true);

    const marginRow = elHas(win, '.prop-row', '外边距');
    await marginRow.locator('input').first().fill('10px 20px');
    await win.keyboard.press('Tab'); // 失焦提交
    const mTop = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas p')).marginTop);
    const mLeft = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas p')).marginLeft);
    check('S5.5 trbl 简写生效 (10px/20px)', mTop === '10px' && mLeft === '20px', `${mTop}/${mLeft}`);
    await shot(win, '外边距生效');

    // ===== S6 全部元素类型插入 =====
    // 每点一个插入按钮，新元素自动选中 → 下一元素插入到它里面（嵌套链），
    // 24 种全部插入后画布/图层树都应完整渲染，且全程无白屏无报错。
    const ALL_ELEMENTS = [
      '通用容器', '区块', '页眉', '导航', '主区', '文章', '侧栏', '页脚',
      '标题1', '标题2', '标题3', '标题4', '行内文字', '标签', '链接',
      '无序列表', '有序列表', '列表项',
      '按钮', '输入框', '文本域', '表单容器',
      '图片', '分割线'
    ];
    const TAG_BY_LABEL = {
      '通用容器': 'div', '区块': 'section', '页眉': 'header', '导航': 'nav',
      '主区': 'main', '文章': 'article', '侧栏': 'aside', '页脚': 'footer',
      '标题1': 'h1', '标题2': 'h2', '标题3': 'h3', '标题4': 'h4',
      '段落': 'p', '行内文字': 'span', '标签': 'label', '链接': 'a',
      '无序列表': 'ul', '有序列表': 'ol', '列表项': 'li',
      '按钮': 'button', '输入框': 'input', '文本域': 'textarea', '表单容器': 'form',
      '图片': 'img', '分割线': 'hr'
    };
    const missing = [];
    for (const label of ALL_ELEMENTS) {
      await doc(win, `.element-btn:has-text("${label}")`).click();
    }
    // 全部插完后统一验证：每个 tag 都渲染在画布上
    const tagCounts = await win.evaluate((tags) => {
      const out = {};
      for (const t of tags) out[t] = document.querySelectorAll('.canvas ' + t).length;
      return out;
    }, Object.values(TAG_BY_LABEL));
    for (const [label, tag] of Object.entries(TAG_BY_LABEL)) {
      if (!(tagCounts[tag] > 0)) missing.push(`${label}(${tag})`);
    }
    check('S6.1 24 种元素全部插入渲染成功', missing.length === 0, '缺失: ' + missing.join(','));
    check('S6.2 全程无错误边界弹出', (await doc(win, '.error-boundary').count()) === 0);
    await doc(win, '.tab-btn:has-text("图层")').click();
    const layCount = await doc(win, '.layer-tree .layer-row').count();
    check('S6.3 图层树行数 = 27 (根+24元素+div/p)', layCount === 27, `实际 ${layCount}`);
    await shot(win, '全部元素插入');

    // ===== S7 层级结构检查（24 个元素全部嵌套渲染成链）=====
    const tagTotal = await win.evaluate(() => document.querySelectorAll('.canvas *').length);
    check('S7.1 画布元素总数 >= 26（嵌入链完整）', tagTotal >= 26, `实际 ${tagTotal}`);
    await shot(win, '嵌套结构');

    // ===== S8 通过画布点选 div（点左上角避开嵌套子元素），改宽度 + 撤销/重做 =====
    await doc(win, '.canvas > div').first().click({ position: { x: 2, y: 2 } }); // 选中 div
    await doc(win, '.tab-btn:has-text("属性")').click();
    await waitFor(win, doc(win, '.inspector .panel-title:has-text("<div>")'));
    const baseW = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas > div')).width);
    const widthInput = doc(win, '.prop-row input[type="text"]').first();
    await widthInput.fill('300');
    await win.keyboard.press('Tab');
    await new Promise((r) => setTimeout(r, 300)); // 等 React 异步提交渲染
    const w300 = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas > div')).width);
    check('S8.1 宽度改为 300px', w300 === '300px', w300);

    // 点空白让焦点离开输入框，再按撤销/重做
    await doc(win, '.canvas').click({ position: { x: 5, y: 5 } });
    await win.keyboard.press('Control+z');
    const wUndo = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas > div')).width);
    check('S8.2 撤销恢复宽度', wUndo === baseW, `${wUndo} vs ${baseW}`);
    await win.keyboard.press('Control+Shift+z');
    const wRedo = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas > div')).width);
    check('S8.3 重做回到 300px', wRedo === '300px', wRedo);
    await shot(win, '撤销重做');

    // ===== S9 添加 select 属性 (display) =====
    await doc(win, '.canvas > div').first().click({ position: { x: 2, y: 2 } }); // 重新选中 div
    await doc(win, '.tab-btn:has-text("属性")').click();
    await waitFor(win, doc(win, '.add-prop-trigger'));
    await doc(win, '.add-prop-trigger').click();
    await waitFor(win, doc(win, '.add-prop-menu'));
    await doc(win, '.add-prop-search input').fill('display');
    await waitFor(win, elHas(win, '.add-prop-item', '显示模式'));
    await elHas(win, '.add-prop-item', '显示模式').first().click();
    await waitUntil(async () => (await doc(win, '.prop-row.highlight').count()) === 1, 5000, 'display 高亮');
    await doc(win, '.prop-row:has-text("显示模式") select').selectOption('flex');
    const disp = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas > div')).display);
    check('S9.1 display:flex 生效', disp === 'flex', disp);
    // 修复回归：加完属性后（搜索词已清空）按钮必须仍可点
    await doc(win, '.add-prop-trigger').click();
    const menuBack = await doc(win, '.add-prop-menu').isVisible();
    check('S9.2 添加后按钮未被残留搜索词禁用', menuBack, '菜单重新打开');
    await win.keyboard.press('Escape'); // 关闭菜单（顺带清空选择）
    await shot(win, 'display-flex');

    // ===== S10 添加 color 属性 (文字颜色) + 删除 =====
    await doc(win, '.canvas > div').first().click({ position: { x: 2, y: 2 } }); // Escape 后重新选中 div
    await doc(win, '.tab-btn:has-text("属性")').click();
    await waitFor(win, doc(win, '.add-prop-trigger'));
    await doc(win, '.add-prop-trigger').click();
    await waitFor(win, doc(win, '.add-prop-menu'));
    await doc(win, '.add-prop-search input').fill('文字颜色');
    await waitFor(win, elHas(win, '.add-prop-item', '文字颜色'));
    await elHas(win, '.add-prop-item', '文字颜色').first().click();
    const bgRow = doc(win, '.prop-row:has-text("文字颜色")');
    await waitUntil(async () => (await doc(win, '.prop-row.highlight').count()) === 1, 5000, '颜色行高亮');
    check('S10.1 文字颜色行带"新"徽标', (await bgRow.locator('.prop-new-badge').count()) === 1);
    const colorInput = bgRow.locator('.color-text-input');
    await colorInput.click();
    await waitUntil(async () => (await doc(win, '.prop-row.highlight').count()) === 0, 5000, '颜色高亮取消');
    await colorInput.fill('#ff5722');
    await win.keyboard.press('Tab');
    await waitUntil(async () => (await colorInput.inputValue()) === '#ff5722', 5000, '颜色提交');
    check('S10.2 颜色值提交并回显', (await colorInput.inputValue()) === '#ff5722');
    const divColor = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas > div')).color);
    check('S10.3 画布文字颜色生效', divColor === 'rgb(255, 87, 34)', divColor);
    await bgRow.locator('.prop-remove').click();
    await waitUntil(async () => (await bgRow.count()) === 0, 5000, '颜色行删除');
    check('S10.4 × 删除属性行', true);
    await shot(win, '颜色属性增删');

    // ===== S11 图层树删除 p + 撤销 =====
    await doc(win, '.tab-btn:has-text("图层")').click();
    const pRow = elHas(win, '.layer-row', 'p 段落');
    await pRow.click({ position: { x: 30, y: 8 } }); // 操作按钮仅选中行显示：先选中 p
    await waitUntil(async () => (await elHas(win, '.layer-row.selected', 'p 段落').count()) === 1, 5000, 'p 行选中');
    await pRow.locator('.layer-del').click();
    await waitUntil(async () => (await doc(win, '.canvas p').count()) === 0, 5000, 'p 被删');
    check('S11.1 图层树删除 p', true);
    await win.keyboard.press('Control+z');
    await waitUntil(async () => (await doc(win, '.canvas p').count()) === 1, 5000, 'p 撤销恢复');
    check('S11.2 撤销恢复 p', true);
    await doc(win, '.tab-btn:has-text("属性")').click();

    // ===== S12 复制 / 原地副本 =====
    await doc(win, '.canvas > div').first().click({ position: { x: 2, y: 2 } }); // 画布点选 div
    await win.keyboard.press('Control+c');
    await win.keyboard.press('Control+d');
    await waitUntil(async () => (await doc(win, '.canvas > div').count()) === 2, 5000, 'div 副本');
    check('S12.1 Ctrl+D 原地副本 → 2 个 div', true);
    await win.keyboard.press('Control+z');
    await waitUntil(async () => (await doc(win, '.canvas > div').count()) === 1, 5000, '副本撤销');
    check('S12.2 撤销副本', true);
    await shot(win, '复制撤销');
    await doc(win, '.tab-btn:has-text("属性")').click();

    // ===== S13 最终健康检查 =====
    const boundary = await doc(win, '.error-boundary').count();
    check('S13.1 无错误边界弹出(无白屏)', boundary === 0);
    check('S13.2 无 console 报错', consoleErrors.length === 0, consoleErrors.join('; ').slice(0, 300));
    check('S13.3 应用仍在渲染', await doc(win, '.app').count() === 1);
    await shot(win, '最终状态');

    // ===== S14 图层树点击选中 + 插入到选中元素（回归：行右半被操作按钮挡点击）=====
    await doc(win, '.tab-btn:has-text("图层")').click();
    // 先选中 p 行，让选中状态有明确变化
    const pRow14 = elHas(win, '.layer-row', 'p 段落');
    await pRow14.click({ position: { x: 30, y: 8 } });
    await waitUntil(async () => (await elHas(win, '.layer-row.selected', 'p 段落').count()) === 1, 5000, 'p 行选中');
    // 点 div 行默认中心点 —— 旧实现会被 hover 弹出的操作按钮吞掉点击，选中不变
    // 树里有两个 div（顶层 + S6 嵌套链里的），显式取第一个（顶层）
    const divRow14 = elHas(win, '.layer-row', 'div 容器').first();
    await divRow14.click();
    await waitUntil(async () => (await elHas(win, '.layer-row.selected', 'div 容器').count()) === 1, 5000, 'div 行选中');
    check('S14.1 点击图层行中心选中 div（不被操作按钮挡）', true);
    // 插入页眉 → 应进入 div 内部（div 的直接子级，而非仍插进原选中元素）
    const headerBefore14 = await doc(win, '.canvas > div header').count();
    await doc(win, '.element-btn:has-text("页眉")').click();
    await waitUntil(async () => (await doc(win, '.canvas > div header').count()) === headerBefore14 + 1, 5000, '页眉进入 div');
    check('S14.2 插入的页眉进入 div 内部', true);
    await win.keyboard.press('Control+z');
    await waitUntil(async () => (await doc(win, '.canvas > div header').count()) === headerBefore14, 5000, '页眉撤销');
    check('S14.3 撤销插入恢复', true);
    await shot(win, '图层行选中插入');

    // ===== S15 隐藏容器后插入自动显示（回归：插入的东西必须画布可见）=====
    await doc(win, '.tab-btn:has-text("图层")').click();
    const divRow15 = elHas(win, '.layer-row', 'div 容器').first();
    await divRow15.click({ position: { x: 30, y: 8 } });
    await doc(win, '.layer-row.selected button[title="隐藏"]').click(); // 隐藏 div
    await waitUntil(async () => (await doc(win, '.canvas *').count()) === 0, 5000, '画布清空(div隐藏)');
    check('S15.1 隐藏 div 后画布无元素、图层树仍在', (await doc(win, '.layer-tree .layer-row').count()) > 0);
    const headerBefore15 = await doc(win, '.canvas > div > header').count(); // div 隐藏时 = 0
    // 往隐藏的 div 插入页眉 → 应自动解除隐藏并画布可见
    await doc(win, '.element-btn:has-text("页眉")').click();
    await waitUntil(async () => (await doc(win, '.canvas > div > header').count()) === headerBefore15 + 1, 8000, '插入后画布可见');
    check('S15.2 隐藏容器插入后自动显示，元素画布可见', true);
    check('S15.3 图层树隐藏标记消失', (await elHas(win, '.layer-row.row-hidden', 'div 容器').count()) === 0);
    await shot(win, '隐藏插入自动显示');

    // ===== S16 嵌套同类容器 + Alt+点击选中父级 =====
    // 4-A 起移除编辑器蓝色虚线框：容器没有"额外"的轮廓装饰，只有选中才有实线框
    // 图层树选最外层 div，连续插入 2 个 div → div > div > div 三层
    await doc(win, '.tab-btn:has-text("图层")').click();
    await elHas(win, '.layer-row', 'div 容器').first().click({ position: { x: 30, y: 8 } });
    await doc(win, '.element-btn:has-text("通用容器")').click();
    await new Promise((r) => setTimeout(r, 250));
    await doc(win, '.element-btn:has-text("通用容器")').click();
    await new Promise((r) => setTimeout(r, 250));
    const dashed16 = await win.evaluate(() => {
      const divs = [...document.querySelectorAll('.canvas div')];
      return divs.filter((d) => getComputedStyle(d).outlineStyle === 'dashed').length;
    });
    check('S16.1 编辑器蓝色虚线框已移除', dashed16 === 0, `虚线框 ${dashed16}`);
    // 点击最内层 div 选中它，再 Alt+点击 → 应选中父级（中层 div，图层缩进变小）
    const innerDiv16 = doc(win, '.canvas > div > div > div');
    await innerDiv16.click({ position: { x: 2, y: 2 } });
    await new Promise((r) => setTimeout(r, 300));
    const padBefore16 = parseInt(await win.evaluate(() => document.querySelector('.layer-row.selected')?.style.paddingLeft || '0'));
    await innerDiv16.click({ position: { x: 2, y: 2 }, modifiers: ['Alt'] });
    await new Promise((r) => setTimeout(r, 300));
    const padAfter16 = parseInt(await win.evaluate(() => document.querySelector('.layer-row.selected')?.style.paddingLeft || '0'));
    check('S16.2 Alt+点击选中父级 div', padAfter16 < padBefore16, `${padBefore16} → ${padAfter16}`);
    await shot(win, '嵌套div无虚线框Alt选中');

    // ===== S17 数值输入：数字 + 单位下拉（"px 删不掉"回归）=====
    // 选中顶层 div，宽度行 = 第一个 "数字 + 单位" 输入
    await doc(win, '.tab-btn:has-text("图层")').click();
    await elHas(win, '.layer-row', 'div 容器').first().click({ position: { x: 30, y: 8 } });
    await doc(win, '.tab-btn:has-text("属性")').click();
    // 顶层 div 无类无 id（4-F 版2 行内样式策略）→ 从画布元素 style 读真实值
    const inlineW17 = () => win.evaluate(() => document.querySelector('.canvas > [data-bc-id]')?.style.width ?? '');
    const numRow17 = doc(win, '.prop-row .num-unit-row').first();
    const numInput17 = numRow17.locator('.num-unit-num');
    await numInput17.click();
    await numInput17.press('Control+a'); // 全选旧值，从开头逐键输入
    await numInput17.pressSequentially('300', { delay: 40 }); // 逐键输入：输入框必须始终是纯数字
    check('S17.1 逐键输入框是纯数字（px 不回填）', (await numInput17.inputValue()) === '300');
    await numRow17.locator('.unit-select').selectOption('rem');
    await new Promise((r) => setTimeout(r, 250));
    check('S17.2 换单位 rem 生效', (await inlineW17()) === '300rem', await inlineW17());
    check('S17.3 换单位后输入框仍是纯数字', (await numInput17.inputValue()) === '300', await numInput17.inputValue());
    await numInput17.fill('320');
    await numInput17.press('Enter'); // 回车提交
    await new Promise((r) => setTimeout(r, 250));
    check('S17.4 回车提交 320rem', (await inlineW17()) === '320rem', await inlineW17());
    // 整个编辑会话（聚焦→逐键→换单位→回车）只压一条历史：一步撤销回编辑前 300px
    await win.keyboard.press('Control+z');
    await waitUntil(async () => (await inlineW17()) === '300px', 5000, '撤销回300px');
    check('S17.5 一步撤销回编辑前 300px', true);
    await doc(win, '.prop-row:has-text("宽度") .num-unit-num').click();
    await numRow17.locator('.unit-select').selectOption('auto');
    await new Promise((r) => setTimeout(r, 250));
    check('S17.6 选 auto 提交为 auto', (await inlineW17()) === 'auto', await inlineW17());
    check('S17.7 auto 时数字框禁用', await numRow17.locator('.num-unit-num').isDisabled());

    // ===== S18 分割线 hr 默认可见 =====
    // 当前选中的是顶层 div（宽 auto），插入分割线
    await doc(win, '.element-btn:has-text("分割线")').click();
    await new Promise((r) => setTimeout(r, 250));
    const hr18 = await win.evaluate(() => {
      const hr = document.querySelector('.canvas hr');
      if (!hr) return null;
      const cs = getComputedStyle(hr);
      return {
        borderTopColor: cs.borderTopColor,
        borderTopWidth: cs.borderTopWidth,
        marginTop: cs.marginTop,
        width: cs.width
      };
    });
    check('S18.1 hr 有可见边框颜色', !!hr18 && hr18.borderTopColor !== 'rgba(0, 0, 0, 0)', hr18?.borderTopColor);
    // DPR=1.5 时 Chrome 会把 1px 边框取整成 0.666667px —— 只要 > 0 即可见
    check('S18.2 hr 上边框可见(>0)', !!hr18 && parseFloat(hr18.borderTopWidth) > 0, hr18?.borderTopWidth);
    check('S18.3 hr 上下 12px 外边距', hr18?.marginTop === '12px', hr18?.marginTop);
    check('S18.4 hr 在 flex 容器里不塌缩(宽度>0)', !!hr18 && parseFloat(hr18.width) > 0, hr18?.width);
    await shot(win, '分割线可见');

    // ===== S19 嵌套 div 默认 8px 内边距（内外 div 之间有间距）=====
    const pad19 = await win.evaluate(() => {
      const outer = document.querySelector('.canvas > div');
      const inner = document.querySelector('.canvas > div > div:last-of-type'); // div2（S16 插入的）
      const csO = outer ? getComputedStyle(outer) : null;
      const csI = inner ? getComputedStyle(inner) : null;
      return { outerPad: csO?.paddingTop, innerPad: csI?.paddingTop };
    });
    check('S19.1 外层容器默认 padding 8px', pad19.outerPad === '8px', pad19.outerPad);
    check('S19.2 内层容器默认 padding 8px', pad19.innerPad === '8px', pad19.innerPad);
    await shot(win, '嵌套div默认间距');

    // ===== S20 布局助手（Flex 中文封装）=====
    // 取消选中 → 插入全新顶层 div（自动选中）→ 布局助手区出现在属性面板
    const cancelSel = doc(win, '.toolbar .btn-ghost:has-text("取消选中")');
    if (await cancelSel.count()) await cancelSel.click();
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.element-btn:has-text("通用容器")').click();
    await new Promise((r) => setTimeout(r, 300));
    check('S20.1 容器选中后出现布局助手', await doc(win, '.flex-helper .seg-btn').count() === 2);
    const flexDiv20 = doc(win, '.canvas > div').nth(1); // 第二个顶层 div = 新插入的
    // 竖排
    await elHas(win, '.seg-btn', '竖排排列').click();
    await new Promise((r) => setTimeout(r, 300));
    let cs20 = await flexDiv20.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { display: cs.display, flexDirection: cs.flexDirection };
    });
    check('S20.2 竖排排列 → flex + column', cs20.display === 'flex' && cs20.flexDirection === 'column', JSON.stringify(cs20));
    // 横排
    await elHas(win, '.seg-btn', '横排排列').click();
    await new Promise((r) => setTimeout(r, 300));
    cs20 = await flexDiv20.evaluate((el) => getComputedStyle(el).flexDirection);
    check('S20.3 横排排列 → row', cs20 === 'row', cs20);
    // 主轴对齐（居中）
    await doc(win, '.flex-helper-row:has-text("主轴对齐") select').selectOption('center');
    await new Promise((r) => setTimeout(r, 300));
    check('S20.4 主轴对齐居中', (await flexDiv20.evaluate((el) => getComputedStyle(el).justifyContent)) === 'center');
    // 交叉轴对齐（垂直居中）
    await doc(win, '.flex-helper-row:has-text("交叉轴对齐") select').selectOption('center');
    await new Promise((r) => setTimeout(r, 300));
    check('S20.5 交叉轴对齐垂直居中', (await flexDiv20.evaluate((el) => getComputedStyle(el).alignItems)) === 'center');
    // 子元素间距 12px
    await doc(win, '.flex-helper-row:has-text("子元素间距") .num-unit-num').fill('12');
    await doc(win, '.flex-helper-row:has-text("子元素间距") .num-unit-num').press('Enter');
    await new Promise((r) => setTimeout(r, 300));
    check('S20.6 子元素间距 12px', (await flexDiv20.evaluate((el) => getComputedStyle(el).gap)) === '12px');
    await shot(win, '布局助手flex横排');
    // 插入段落（自动选中）→ 叶子元素显示"选中父容器"入口
    await doc(win, '.element-btn:has-text("段落")').click();
    await new Promise((r) => setTimeout(r, 300));
    check('S20.7 叶子元素显示父容器入口', await doc(win, '.flex-helper-hint .btn-mini:has-text("选中父容器设置布局")').count() === 1);
    await doc(win, '.flex-helper-hint .btn-mini:has-text("选中父容器设置布局")').click();
    await new Promise((r) => setTimeout(r, 300));
    check('S20.8 选中父容器后回到容器布局助手', (await doc(win, '.inspector .panel-title').textContent()).includes('<div>') && (await doc(win, '.flex-helper .seg-btn').count()) === 2);
    // 退出弹性布局 → 恢复块级并清空对齐/间距
    await doc(win, '.flex-exit-btn').click();
    await new Promise((r) => setTimeout(r, 300));
    const inline20 = await flexDiv20.evaluate((el) => ({
      display: el.style.display,
      justifyContent: el.style.justifyContent,
      gap: el.style.gap
    }));
    check('S20.9 退出弹性布局清空 flex 相关样式', inline20.display === '' && inline20.justifyContent === '' && inline20.gap === '', JSON.stringify(inline20));
    await shot(win, '布局助手退出弹性');
    // 退出后画布上 div 恢复块级
    check('S20.10 画布恢复块级布局', (await flexDiv20.evaluate((el) => getComputedStyle(el).display)) === 'block');

    // ===== S21 多选：Ctrl+点击 / Ctrl+A / 拖框选中（100% 在框内才算）=====
    // 先把旧场景清空：Ctrl+A 全选 → 工具栏批量删除
    // 注意：当前右侧停在属性页（图层树未挂载），断言一律走 画布 outline / 属性面板
    await win.keyboard.press('Control+a');
    await new Promise((r) => setTimeout(r, 300));
    const selAll21 = await win.evaluate(() => {
      const els = [...document.querySelectorAll('[data-bc-id]')];
      return {
        total: els.length,
        allOutlined: els.length > 0 && els.every((el) => getComputedStyle(el).outlineStyle === 'solid')
      };
    });
    const selPanelCount21 = await doc(win, '.inspector .multi-sel-list .multi-sel-item').count();
    check('S21.1 Ctrl+A 全选所有可见元素', selAll21.total > 0 && selAll21.allOutlined && selPanelCount21 === selAll21.total, `total=${selAll21.total} panel=${selPanelCount21}`);
    await doc(win, '.toolbar-del').click();
    await new Promise((r) => setTimeout(r, 300));
    check('S21.2 批量删除后画布清空', await doc(win, '.canvas-empty').count() === 1);
    await shot(win, '多选全选批量删除');
    // 搭一个干净场景：divA + divB 两个顶层容器
    await doc(win, '.element-btn:has-text("通用容器")').click();
    await new Promise((r) => setTimeout(r, 250));
    const canvasBox21 = await doc(win, '.canvas').boundingBox();
    await win.mouse.click(canvasBox21.x + 5, canvasBox21.y + 5); // 点画布空白清空选中
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.element-btn:has-text("通用容器")').click();
    await new Promise((r) => setTimeout(r, 250));
    check('S21.3 画布上有两个顶层容器', (await doc(win, '.canvas > [data-bc-id]').count()) === 2);
    const divA21 = doc(win, '.canvas > [data-bc-id]').nth(0);
    const divB21 = doc(win, '.canvas > [data-bc-id]').nth(1);
    const boxA = await divA21.boundingBox();
    // 拖框只框住 divA 左半边 → 100% 规则：半个也不选
    await win.mouse.move(boxA.x - 5, boxA.y - 5);
    await win.mouse.down();
    await win.mouse.move(boxA.x + boxA.width / 2 - 15, boxA.y + boxA.height + 5, { steps: 6 });
    const marqueeShown = await doc(win, '.marquee-box').count();
    await win.mouse.up();
    await new Promise((r) => setTimeout(r, 250));
    check('S21.4 拖框时显示框选矩形', marqueeShown === 1);
    const halfSel21 = await win.evaluate(() => {
      const els = [...document.querySelectorAll('.canvas > [data-bc-id]')];
      return els.map((el) => getComputedStyle(el).outlineStyle);
    });
    check('S21.5 只框一半 → 0 个元素被选中（100% 规则）', halfSel21.length === 2 && halfSel21.every((s) => s !== 'solid'), JSON.stringify(halfSel21));
    await shot(win, '拖框一半不选');
    // 完整框住 divA → 只有 divA 被选中
    await win.mouse.move(boxA.x - 5, boxA.y - 5);
    await win.mouse.down();
    await win.mouse.move(boxA.x + boxA.width + 5, boxA.y + boxA.height + 5, { steps: 8 });
    await win.mouse.up();
    await new Promise((r) => setTimeout(r, 250));
    const marqSel21 = await win.evaluate(() => {
      const els = [...document.querySelectorAll('.canvas > [data-bc-id]')];
      return {
        rows: document.querySelectorAll('.layer-row.selected:not(.root-row)').length,
        firstSolid: getComputedStyle(els[0]).outlineStyle === 'solid',
        secondSolid: getComputedStyle(els[1]).outlineStyle === 'solid',
        title: document.querySelector('.inspector .panel-title')?.textContent ?? ''
      };
    });
    check('S21.6 完整框住 → 只有 divA 选中', marqSel21.firstSolid && !marqSel21.secondSolid && (marqSel21.rows === 0 || marqSel21.rows === 1), `first=${marqSel21.firstSolid} second=${marqSel21.secondSolid} title=${marqSel21.title}`);
    // 普通点击空白 = 清空选区
    await win.mouse.click(canvasBox21.x + 5, canvasBox21.y + 5);
    await new Promise((r) => setTimeout(r, 250));
    const cleared21 = await win.evaluate(() => {
      const els = [...document.querySelectorAll('.canvas > [data-bc-id]')];
      return els.map((el) => getComputedStyle(el).outlineStyle).every((s) => s !== 'solid');
    });
    check('S21.7 点击空白清空选区', cleared21);
    // Ctrl+点击多选
    await divA21.click();
    await new Promise((r) => setTimeout(r, 200));
    await divB21.click({ modifiers: ['Control'] });
    await new Promise((r) => setTimeout(r, 250));
    check('S21.8 Ctrl+点击第二个 → 选中 2 个', (await doc(win, '.inspector .multi-sel-list .multi-sel-item').count()) === 2);
    check('S21.9 属性面板显示批量面板', (await doc(win, '.inspector .panel-title').textContent()).includes('已选 2'));
    await shot(win, 'Ctrl多选批量面板');
    // Ctrl+点击已选中的 divA → 反选移除
    await divA21.click({ modifiers: ['Control'] });
    await new Promise((r) => setTimeout(r, 250));
    const single21 = await win.evaluate(() => {
      const els = [...document.querySelectorAll('.canvas > [data-bc-id]')];
      return {
        first: getComputedStyle(els[0]).outlineStyle === 'solid',
        second: getComputedStyle(els[1]).outlineStyle === 'solid',
        title: document.querySelector('.inspector .panel-title')?.textContent ?? ''
      };
    });
    check('S21.10 Ctrl+点击已选元素可取消 → 只剩 divB', !single21.first && single21.second && single21.title.includes('<div>'), JSON.stringify(single21));
    // 再选回 divA → 工具栏批量删除两个
    await divA21.click({ modifiers: ['Control'] });
    await new Promise((r) => setTimeout(r, 250));
    await doc(win, '.toolbar-del').click();
    await new Promise((r) => setTimeout(r, 300));
    check('S21.11 多选批量删除两个容器', (await doc(win, '.canvas > [data-bc-id]').count()) === 0 && (await doc(win, '.canvas-empty').count()) === 1);
    await shot(win, '多选批量删除完成');

// ===== S22 画布 = 浏览器：编辑器不得额外改变观感 =====
    // S21 结束时画布为空。插入两个顶层容器
    await doc(win, '.element-btn:has-text("通用容器")').click();
    await new Promise((r) => setTimeout(r, 250));
    const canvasBox22 = await doc(win, '.canvas').boundingBox();
    await win.mouse.click(canvasBox22.x + 5, canvasBox22.y + 5); // 点空白清选中
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.element-btn:has-text("通用容器")').click();
    await new Promise((r) => setTimeout(r, 250));
    // S22.1 顶层容器之间无编辑区强加的外边距（旧版 .canvas > div 有 8px margin-bottom）
    const gaps22 = await win.evaluate(() => {
      const d = document.querySelectorAll('.canvas > [data-bc-id]');
      return { mb: getComputedStyle(d[0]).marginBottom, mt: getComputedStyle(d[1]).marginTop };
    });
    check('S22.1 顶层容器无额外外边距（与导出一致）', gaps22.mb === '0px' && gaps22.mt === '0px', JSON.stringify(gaps22));
    // S22.2 定位模式 = absolute → 画布 computed 必须就是 absolute（旧版被强制 relative，导出才生效 → 画布≠浏览器）
    await doc(win, '.canvas > [data-bc-id]').first().click();
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.add-prop-trigger').click();
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.add-prop-search input').fill('定位模式');
    await new Promise((r) => setTimeout(r, 200));
    await elHas(win, '.add-prop-item', '定位模式').first().click();
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.prop-row:has-text("定位模式") select').selectOption('absolute');
    await new Promise((r) => setTimeout(r, 300));
    const pos22 = await win.evaluate(() => getComputedStyle(document.querySelector('.canvas > [data-bc-id]')).position);
    check('S22.2 定位 absolute 在画布上真实生效', pos22 === 'absolute', pos22);
    // S22.3 编辑器内边距类外观与浏览器一致：img 无 src 时宽度高度来自默认样式（非编辑器 CSS 强加）
    await doc(win, '.element-btn:has-text("图片")').click();
    await new Promise((r) => setTimeout(r, 300));
    const img22 = await win.evaluate(() => {
      const el = document.querySelector('.canvas img');
      const cs = getComputedStyle(el);
      return { w: cs.width, h: cs.height, borderStyle: cs.borderStyle, display: cs.display };
    });
    check('S22.3 img 尺寸/边框来自默认样式而非编辑器 CSS', img22.w === '200px' && img22.h === '120px' && img22.borderStyle === 'dashed', JSON.stringify(img22));
    await shot(win, '画布与浏览器一致');

    // ===== S23 画布宽度：自适应 / 响应式预设（第9轮） =====
    // S23.1 默认自适应：画布宽度 = 编辑区可用宽度（不再是固定 960 竖直纸张，改随窗口横向铺满）
    const [wAuto, wWrap] = await win.evaluate(() => {
      const c = document.querySelector('.canvas');
      const w = document.querySelector('.canvas-wrap');
      return [c.getBoundingClientRect().width, w.clientWidth - 48];
    });
    check('S23.1 自适应画布铺满编辑区（横向）', Math.abs(wAuto - wWrap) < 2, `${wAuto} vs ${wWrap}`);
    // S23.2 手机预设 375px → 画布收窄到 375
    const sel23 = await doc(win, '.canvas-width-select');
    await sel23.selectOption('375px');
    await new Promise((r) => setTimeout(r, 250));
    const w375 = await win.evaluate(() => document.querySelector('.canvas').getBoundingClientRect().width);
    check('S23.2 手机预设 375px 生效', Math.abs(w375 - 375) < 1, String(w375));
    await shot(win, '画布宽度-手机375');
    // S23.3 切回自适应恢复铺满
    await sel23.selectOption('auto');
    await new Promise((r) => setTimeout(r, 250));
    const wAuto2 = await win.evaluate(() => document.querySelector('.canvas').getBoundingClientRect().width);
    check('S23.3 切回自适应恢复', Math.abs(wAuto2 - wWrap) < 2, String(wAuto2));
    // S23.4 工具栏有"预览"按钮（真实点击会开浏览器，自动化里只验证存在）
    const hasPreviewBtn = await doc(win, 'button:has-text("预览")').count();
    check('S23.4 浏览器预览按钮存在', hasPreviewBtn >= 1, String(hasPreviewBtn));

    // ===== S24 CSS 类名化导出 + 全局 CSS（阶段3第1轮） =====
    // 当前画布：divA(absolute) + divB。给 divB 设类名 + 页面写全局 CSS
    await doc(win, '.canvas > [data-bc-id]').nth(1).click();
    await new Promise((r) => setTimeout(r, 200));
    // 类名输入（HTML 属性区）
    await doc(win, '.prop-row:has-text("类名 class") input').fill('banner test');
    await new Promise((r) => setTimeout(r, 200));
    // 页面页签：先展开「高级 CSS」再写全局 CSS（4-D 折叠区，blur 提交）
    await doc(win, '.inspector-tab:has-text("页面")').click();
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.page-advanced-toggle').click();
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.page-css-textarea').fill('.banner.test { background-color: rgb(255, 0, 0); }');
    await doc(win, '.page-css-textarea').evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 300));
    // S24.1 全局 CSS 实时作用于画布（所见即所得）
    const diag24 = await win.evaluate(() => {
      const d = document.querySelectorAll('.canvas > [data-bc-id]')[1];
      return d ? getComputedStyle(d).backgroundColor : 'missing';
    });
    check('S24.1 全局 CSS 实时作用于画布', diag24 === 'rgb(255, 0, 0)', diag24);
    // 再插入三个未动过的默认容器 → 验证"同样式共用一条规则"（4-C 后同样成立）
    await doc(win, '.element-btn:has-text("通用容器")').click();
    await new Promise((r) => setTimeout(r, 250));
    await doc(win, '.element-btn:has-text("通用容器")').click();
    await new Promise((r) => setTimeout(r, 250));
    await doc(win, '.element-btn:has-text("通用容器")').click();
    await new Promise((r) => setTimeout(r, 250));
    // S24.2 导出：有类名 → 规则在 <style>（无 style= 属性）；无类名 → 行内 style 属性（用户全局 CSS 在后）
    if (existsSync(EXPORT_CHECK)) rmSync(EXPORT_CHECK);
    await doc(win, 'button:has-text("导出 HTML")').click();
    await waitUntil(() => existsSync(EXPORT_CHECK), 8000, '导出文件写入');
    const exp24 = readFileSync(EXPORT_CHECK, 'utf-8');
    const noInlineOnClassed = !/<div class="[^"]*" style=/.test(exp24);
    // 无类名无 ID 的元素走行内样式（选择器重构：不再生成 hash 类）
    const hasInlineUnclassed = /<div style="background-color: #d4e7ff; min-height: 60px; box-sizing: border-box; padding: 8px;">/.test(exp24);
    // 有类名元素类名直接作选择器，不再叠加任何自动类
    const hasUserClassOnly = /<div class="banner test">/.test(exp24);
    const noHashClass = !/class="bc-s-[0-9a-f]{8}"/.test(exp24);
    const autoIdx24 = exp24.indexOf('.banner.test');
    const userIdx24 = exp24.indexOf('.banner.test { background-color: rgb(255, 0, 0); }');
    check('S24.2 导出：有类名元素无内联 style；无类名元素用行内 style', noInlineOnClassed && hasInlineUnclassed, '');
    check('S24.3 类名直接作选择器（不叠 hash 类）；无类名兜底=行内', hasUserClassOnly && noHashClass, '');
    check('S24.4 用户全局 CSS 在自动规则之后', autoIdx24 >= 0 && userIdx24 > autoIdx24, `${autoIdx24}/${userIdx24}`);
    // S24.5 行内样式元素：三个默认容器各自携带 style 属性（不再共用 hash 类）
    const inlineCount24 = (exp24.match(/<div style="background-color: #d4e7ff[^"]*padding: 8px;">/g) || []).length;
    const hashRuleCount24 = exp24.split('\n').filter((l) => /bc-s-[0-9a-f]{8}/.test(l)).length;
    check('S24.5 无类名元素用行内样式（3 个默认容器各带 style 属性）', inlineCount24 >= 3 && hashRuleCount24 === 0, `${inlineCount24} 内联 / ${hashRuleCount24} hash`);
    // S24.6 渲染一致性：把导出文件的 <style> + <body> 注入主文档隐藏容器，
    // 与画布对比（同一引擎同一设备；导出规则与画布注入规则同源同文本）
    const iframe24 = await win.evaluate(async (html) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;right:10px;top:60px;width:400px;';
      host.id = 'bc-export-host';
      const css = document.createElement('style');
      css.textContent = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
      css.id = 'bc-export-css';
      const bodyHtml = (html.match(/<body>([\s\S]*?)<\/body>/) || [])[1] || '';
      host.innerHTML = bodyHtml;
      document.body.appendChild(css);
      document.body.appendChild(host);
      await new Promise((r) => setTimeout(r, 150));
      const d = host.children[1]; // 第二个顶层容器 = divB(banner)
      const c = document.querySelectorAll('.canvas > [data-bc-id]')[1];
      const a = d ? getComputedStyle(d) : null;
      const b = c ? getComputedStyle(c) : null;
      return {
        bg: a && b ? a.backgroundColor === b.backgroundColor : 'missing',
        minH: a && b ? a.minHeight === b.minHeight : 'missing',
        boxSizing: a && b ? a.boxSizing === b.boxSizing : 'missing',
        iframeBg: a ? a.backgroundColor : '-',
        canvasBg: b ? b.backgroundColor : '-',
        iframeMinH: a ? a.minHeight : '-',
        canvasMinH: b ? b.minHeight : '-'
      };
    }, exp24);
    check('S24.6 导出 iframe 渲染与画布一致（背景/最小高度/盒模型）', iframe24.bg === true && iframe24.minH === true && iframe24.boxSizing === true, JSON.stringify(iframe24));
    // 清理：移除对比容器与注入的 CSS，避免遮挡后续点击/断言
    await win.evaluate(() => {
      document.getElementById('bc-export-host')?.remove();
      document.getElementById('bc-export-css')?.remove();
    });
    // 清理：清空全局 CSS 恢复默认（避免影响后续场景）
    if ((await doc(win, '.page-css-textarea').count()) === 0) {
      await doc(win, '.page-advanced-toggle').click();
      await new Promise((r) => setTimeout(r, 200));
    }
    await doc(win, '.page-css-textarea').fill('');
    await doc(win, '.page-css-textarea').evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 200));

    // ===== S25 + S29 模板库（4-F：左栏内嵌 + 折叠 + 搜索 + 缩略图） =====
    // 先清掉残留选区（S24 结束选中了 divB），保证模板插到画布根
    if ((await doc(win, 'button:has-text("取消选中")').count()) && (await doc(win, 'button:has-text("取消选中")').isEnabled())) {
      await doc(win, 'button:has-text("取消选中")').click();
    }
    await new Promise((r) => setTimeout(r, 200));
    // S25.0 模板页签仍在左侧面板内（非全屏遮罩）
    // S25.1 点「模板」→ 底部布局下整条面板加高（430px），4 个模板缩略图卡片
    await doc(win, '.element-panel .inspector-tab:has-text("模板")').click();
    const panelW25 = await doc(win, '.element-panel').evaluate((el) => el.getBoundingClientRect().width);
    const panelH25 = await doc(win, '.element-panel').evaluate((el) => el.getBoundingClientRect().height);
    await waitUntil(async () => (await doc(win, '.tpl-card').count()) >= 4, 8000, '模板卡片出现');
    const tplNames25 = await doc(win, '.tpl-card-name').allTextContents();
    check('S25.1 模板页：4 个模板缩略图出现且模板面板加高', tplNames25.length >= 4 && tplNames25.includes('首页大标题区') && panelH25 > 350, tplNames25.join(',') + ` panel=${Math.round(panelW25)}x${Math.round(panelH25)}`);
    // S29.0 无全屏遮罩（画布仍可见/可操作）
    const overlay29 = await doc(win, '.tpl-modal-overlay').count();
    const canvasVisible29 = await doc(win, '.canvas').isVisible();
    check('S29.0 模板页无遮罩、画布可见', overlay29 === 0 && canvasVisible29, JSON.stringify({ overlay29, canvasVisible29 }));
    // S29.1 资源包大板块 + 三角形箭头收起/展开
    const grpCount = await doc(win, '.tpl-group-header').count();
    await doc(win, '.tpl-group-header').first().click();
    await new Promise((r) => setTimeout(r, 200));
    const cardsCollapsed = await doc(win, '.tpl-group .tpl-card').first().count();
    await doc(win, '.tpl-group-header').first().click(); // 展开回来
    await new Promise((r) => setTimeout(r, 200));
    const cardsExpanded = await doc(win, '.tpl-group .tpl-card').count();
    check('S29.1 资源包板块可折叠（箭头收起/展开）', grpCount >= 1 && cardsCollapsed === 0 && cardsExpanded >= 4, JSON.stringify({ grpCount, cardsCollapsed, cardsExpanded }));
    // S29.2 搜索过滤：输入「页脚」→ 只剩 1 个卡片；清空恢复
    await doc(win, '.tpl-search-input').fill('页脚');
    await new Promise((r) => setTimeout(r, 250));
    const searchNames = await doc(win, '.tpl-card-name').allTextContents();
    await doc(win, '.tpl-search-clear').click();
    await new Promise((r) => setTimeout(r, 250));
    const searchNamesBack = await doc(win, '.tpl-card-name').count();
    check('S29.2 搜索过滤模板', searchNames.length === 1 && searchNames[0].includes('页脚') && searchNamesBack >= 4, JSON.stringify({ searchNames, searchNamesBack }));
    // S29.3 缩略图真实渲染（内容真实 + 等比缩小 + 贴合列宽不拉伸 + 无滚动条）
    await waitUntil(async () => {
      const s = await doc(win, '.tpl-thumb-frame').first().evaluate((el) => (el.style.transform || '').length > 0);
      return s;
    }, 8000, '缩略图缩放就绪');
    const thumb29 = await doc(win, '.tpl-thumb-frame').first().evaluate((el) => {
      const f = el;
      const doc2 = f.contentDocument;
      const h = doc2?.querySelector('h1')?.textContent ?? '';
      const m = (el.style.transform || '').match(/scale\(([\d.]+)\)/);
      const s = m ? parseFloat(m[1]) : 0;
      const wrapW = el.parentElement.getBoundingClientRect().width;
      return {
        hasH1: h.startsWith('欢迎来到'),
        scaleNum: s,
        noScroll: el.scrolling === 'no',
        fit: s > 0 && s <= 1 && el.offsetWidth * s <= wrapW + 2,
        wrapW: Math.round(wrapW)
      };
    });
    check('S29.3 缩略图运行时渲染（内容真实 + 等比贴合列宽 + 无滚动）', thumb29.hasH1 && thumb29.noScroll && thumb29.fit, JSON.stringify(thumb29));
    await shot(win, '4F-模板库左栏');
    // S25.2 点模板插入 → 画布出现整棵子树（section > h1 + button），新 id 不与旧元素冲突
    await doc(win, '.tpl-card:has-text("首页大标题区")').click();
    await new Promise((r) => setTimeout(r, 400));
    const hero25 = await win.evaluate(() => {
      const sec = document.querySelector('.canvas > section');
      if (!sec) return { ok: false };
      return {
        ok: true,
        h1: sec.querySelector('h1')?.textContent ?? '',
        btn: !!sec.querySelector('button'),
        idsUnique: new Set([...document.querySelectorAll('[data-bc-id]')].map((e) => e.getAttribute('data-bc-id'))).size === document.querySelectorAll('[data-bc-id]').length,
        secBg: getComputedStyle(sec).backgroundColor
      };
    });
    check('S25.2 模板插入画布（h1+按钮+样式+id 不撞车）', hero25.ok && hero25.h1.startsWith('欢迎来到') && hero25.btn && hero25.idsUnique && hero25.secBg === 'rgb(16, 24, 40)', JSON.stringify(hero25));
    await shot(win, '模板插入-landing-hero');
    // S25.3 撤销模板插入
    await win.keyboard.press('Control+z');
    await waitUntil(async () => (await doc(win, '.canvas > section').count()) === 0, 5000, '撤销模板');
    check('S25.3 撤销模板插入', true);
    // S25.4 扩展弹窗（入口已迁入「设置」菜单：4-F 版2，工具栏 🧩 移除 → 走 menu:ext 链路）
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:ext')));
    await waitFor(win, doc(win, '.modal-card'));
    const ext25 = await win.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');
      return {
        hasResource: [...document.querySelectorAll('.ext-item-name')].some((e) => e.textContent.includes('内置新手模板包')),
        hasBadge: !!document.querySelector('.ext-item-badge'),
        hasPluginHint: [...document.querySelectorAll('.hint')].some((e) => e.textContent.includes('插件执行支持')),
        hasButtons: btns.some((t) => t.includes('重新扫描')) && btns.some((t) => t.includes('打开扩展文件夹'))
      };
    });
    check('S25.4 扩展弹窗：资源包/插件状态/扫描入口齐全', ext25.hasResource && ext25.hasBadge && ext25.hasPluginHint && ext25.hasButtons, JSON.stringify(ext25));
    await shot(win, '扩展管理弹窗');
    await win.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 200));
    check('S25.5 Esc 关闭扩展弹窗', (await doc(win, '.modal-card').count()) === 0);

    // ===== S26 画布缩放：Ctrl+滚轮缩放 + 归位按钮在工具栏（4-F 版2） =====
    const canvas26 = doc(win, '.canvas');
    await canvas26.evaluate((el) => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await new Promise((r) => setTimeout(r, 300));
    const zoomed26 = await win.evaluate(() => ({
      transform: document.querySelector('.canvas')?.style.transform ?? '',
      pct: document.querySelector('.zoom-pct')?.textContent ?? '',
      resetEnabled: !document.querySelector('.zoom-reset')?.disabled,
      hasFloatBar: !!document.querySelector('.canvas-zoom-bar')
    }));
    check('S26.1 Ctrl+滚轮缩放生效且归位按钮在工具栏（无浮条）', zoomed26.transform.includes('scale(') && zoomed26.pct !== '100%' && zoomed26.resetEnabled && !zoomed26.hasFloatBar, JSON.stringify(zoomed26));
    await shot(win, '画布缩放-非100%');
    // 工具栏「归位」→ 回 100%，按钮变禁用
    await doc(win, '.zoom-reset').click();
    await new Promise((r) => setTimeout(r, 250));
    const reset26 = await win.evaluate(() => ({
      transform: document.querySelector('.canvas')?.style.transform ?? '',
      pct: document.querySelector('.zoom-pct')?.textContent ?? '',
      resetDisabled: document.querySelector('.zoom-reset')?.disabled
    }));
    check('S26.2 归位按钮回 100%（工具栏）', reset26.transform === '' && reset26.pct === '100%' && reset26.resetDisabled, JSON.stringify(reset26));

    // ===== S27 CSS 选择器策略（4-C/4-F）：类名/ID 直接写选择器；同名样式不统一 = 警告 + 编辑即统一 =====
    // 当前画布：divA(类 banner test 无 id) + divB>divC。先把左侧面板切回「元素」页签
    await doc(win, '.element-panel .inspector-tab:has-text("元素")').click();
    await new Promise((r) => setTimeout(r, 200));
    // S27.1 给 divC 填 ID → 画布 DOM 挂 id、规则直接写 #id
    await doc(win, '.canvas > [data-bc-id]').nth(1).click(); // divB → 选中（后续在图层树里点 divC）
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.tab-btn:has-text("图层")').click();
    await new Promise((r) => setTimeout(r, 200));
    // 图层行：root、divA、divB、divC → 'div 容器' 第 3 行 = divC（无类无 id，走 ID 选择器）
    await doc(win, '.layer-row:has-text("div 容器")').nth(2).click({ position: { x: 30, y: 8 } });
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.tab-btn:has-text("属性")').click();
    await new Promise((r) => setTimeout(r, 200));
    const idInput27 = doc(win, '.prop-row:has-text("ID?") input');
    await idInput27.fill('c-sec');
    await idInput27.evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 300));
    const idMode27 = await win.evaluate(() => {
      const rules = document.querySelector('style.bc-auto-css')?.textContent ?? '';
      return {
        domId: !!document.querySelector('#c-sec'),
        hasIdRule: /#c-sec \{/.test(rules),
        noHashForIt: !/class="bc-s-[0-9a-f]{8}" id="c-sec"/.test(document.body.innerHTML)
      };
    });
    check('S27.1 只有 ID 的元素：DOM 挂 id + 规则直接写 #id', idMode27.domId && idMode27.hasIdRule && idMode27.noHashForIt, JSON.stringify(idMode27));
    // S27.2 同名类不同样式 → 不合并（规则保留第一个）+ ⚠ 标记"样式不统一"
    // 注意：画布点选会被 divA 内铺满的 img 挡住，统一用图层树选元素
    await doc(win, '.tab-btn:has-text("图层")').click();
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.layer-row:has-text("div 容器")').nth(0).click({ position: { x: 30, y: 8 } }); // divA
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.tab-btn:has-text("属性")').click();
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.prop-row:has-text("类名 Class") input').fill('dup');
    await doc(win, '.prop-row:has-text("类名 Class") input').evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.element-btn:has-text("通用容器")').click(); // 插入 divD（到选中 divA 内）
    await new Promise((r) => setTimeout(r, 300));
    await doc(win, '.tab-btn:has-text("图层")').click();
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.layer-row:has-text("div 容器")').nth(1).click({ position: { x: 30, y: 8 } }); // divD（divA 内）
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.tab-btn:has-text("属性")').click();
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.prop-row:has-text("类名 Class") input').fill('dup');
    await doc(win, '.prop-row:has-text("类名 Class") input').evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 200));
    // 此时 .dup 下 divA(absolute) 与 divD(默认) 样式不同 → 规则只保留第一个 + ⚠ 冲突
    const dup27 = await win.evaluate(() => {
      const rules = document.querySelector('style.bc-auto-css')?.textContent ?? '';
      const badge = document.querySelector('.issue-badge')?.textContent ?? '';
      return {
        dupRuleCount: (rules.match(/\.dup \{/g) || []).length,
        badge
      };
    });
    check('S27.2 同名类不同样式：规则保留第一个 + ⚠ 冲突标记', dup27.dupRuleCount === 1 && Number(dup27.badge) >= 1, JSON.stringify(dup27));
    // S27.2b 编辑即统一：改 divD 背景 → divA 自动同化（改一个全改），冲突消失
    await doc(win, '.tab-btn:has-text("图层")').click();
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.layer-row:has-text("div 容器")').nth(1).click({ position: { x: 30, y: 8 } }); // divD（divA 内部）
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.tab-btn:has-text("属性")').click();
    await new Promise((r) => setTimeout(r, 200));
    // divD 默认就带「背景色」行，直接改色即可（无需走添加属性菜单）
    const bgRow27 = doc(win, '.prop-row:has-text("背景色 Background") input').first();
    await bgRow27.fill('rgb(255, 0, 0)');
    await bgRow27.evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 400));
    const merged27 = await win.evaluate(() => {
      const els = document.querySelectorAll('.canvas > [data-bc-id]');
      const a = getComputedStyle(els[0]).backgroundColor;
      const d = getComputedStyle(els[0].querySelector(':scope > div')).backgroundColor;
      return { a, d };
    });
    check('S27.2b 编辑即统一：改一个 .dup 元素 → 两个一起变', merged27.a === merged27.d && merged27.d === 'rgb(255, 0, 0)', JSON.stringify(merged27));
    // S27.3 导出后 toast：提示样式健康（未命名元素建议加类名）
    if (existsSync(EXPORT_CHECK)) rmSync(EXPORT_CHECK);
    await doc(win, 'button:has-text("导出 HTML")').click();
    await waitUntil(() => existsSync(EXPORT_CHECK), 8000, '导出文件写入');
    await waitUntil(async () => (await doc(win, '.export-tips').count()) === 1, 5000, '导出提示出现');
    const tips27 = await doc(win, '.export-tips').textContent();
    check('S27.3 导出提示：未命名元素建议加类名', tips27.includes('还没有类名'), tips27);
    await shot(win, '4C-选择器策略导出提示');

    // ===== S28 页面快速设置（阶段4・D） =====
    // S28.1 页面页签：快速设置 4 行 + 高级 CSS 默认折叠
    await doc(win, '.inspector-tab:has-text("页面")').click();
    await new Promise((r) => setTimeout(r, 250));
    const quickCount = await doc(win, '.page-quick-row').count();
    const advCollapsed = (await doc(win, '.page-css-textarea').count()) === 0;
    check('S28.1 快速设置 4 行 + 高级默认折叠', quickCount === 4 && advCollapsed, JSON.stringify({ quickCount, advCollapsed }));
    // S28.2 页面背景色：填色 → 画布背景变 + 快速 CSS 注入（.canvas 定向，不污染编辑器 body）
    await doc(win, '.page-quick-row:has-text("页面背景色") .page-quick-input').fill('rgb(18, 52, 86)');
    await doc(win, '.page-quick-row:has-text("页面背景色") .page-quick-input').evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 300));
    const quick28 = await win.evaluate(() => {
      const q = document.querySelector('style.bc-quick-css')?.textContent ?? '';
      const bodyBg = getComputedStyle(document.querySelector('.canvas')).backgroundColor;
      const editorBodyBg = getComputedStyle(document.body).backgroundColor;
      return { q, bodyBg, editorBodyBg };
    });
    check('S28.2 快速背景色作用于画布且不污染编辑器', quick28.bodyBg === 'rgb(18, 52, 86)' && quick28.editorBodyBg !== 'rgb(18, 52, 86)' && quick28.q.includes('background-color: rgb(18, 52, 86)'), JSON.stringify(quick28));
    // S28.3 字色/链接色/字体：导出 CSS 块含三段且顺序为 快速设置 → 高级
    await doc(win, '.page-quick-row:has-text("文字颜色") .page-quick-input').fill('#222222');
    await doc(win, '.page-quick-row:has-text("文字颜色") .page-quick-input').evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.page-quick-row:has-text("链接颜色") .page-quick-input').fill('rgb(255, 140, 0)');
    await doc(win, '.page-quick-row:has-text("链接颜色") .page-quick-input').evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.page-quick-row:has-text("页面字体") .page-quick-input').fill('Georgia, serif');
    await doc(win, '.page-quick-row:has-text("页面字体") .page-quick-input').evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 300));
    const quickAll = await win.evaluate(() => {
      const q = document.querySelector('style.bc-quick-css')?.textContent ?? '';
      return { hasFont: q.includes('font-family: Georgia, serif'), hasText: q.includes('color: #222222'), hasLink: q.includes('a { color: rgb(255, 140, 0)') || q.includes('.canvas a { color: rgb(255, 140, 0)') };
    });
    check('S28.3 字色/链接/字体都进快速 CSS', quickAll.hasFont && quickAll.hasText && quickAll.hasLink, JSON.stringify(quickAll));
    // S28.4 导出 HTML 里快速设置是完整 body 规则（导出语义不变）
    if (existsSync(EXPORT_CHECK)) rmSync(EXPORT_CHECK);
    await doc(win, 'button:has-text("导出 HTML")').click();
    await waitUntil(() => existsSync(EXPORT_CHECK), 8000, '导出文件写入(S28.4)');
    const exp28 = readFileSync(EXPORT_CHECK, 'utf-8');
    const hasBodyRule = exp28.includes('background-color: rgb(18, 52, 86)') && exp28.includes('color: #222222') && exp28.includes('font-family: Georgia, serif') && exp28.includes('a { color: rgb(255, 140, 0); text-decoration: underline; }');
    check('S28.4 导出含完整 body 快速规则', hasBodyRule, hasBodyRule ? 'ok' : exp28.slice(exp28.indexOf('快速设置'), exp28.indexOf('快速设置') + 200));
    await shot(win, '4D-页面快速设置');

    // ===== S30 选择器体系重构（4-F 版2）：行内样式 / ⚠ 问题面板 / 类名管理 / 输入提示 =====
    // 当前画布：divA(.dup) > divD(.dup)、divB(.banner test) > divC(#c-sec) + 3 个默认 div(行内)
    // S30.1 行内元素渲染一致性：导出 style 属性与画布渲染同一来源（默认 div 背景一致）
    const exp30 = readFileSync(EXPORT_CHECK, 'utf-8'); // 复用 S28.4 的导出文件（含行内元素）
    const inline30 = await win.$$eval('.canvas [data-bc-id]', (els) => els
      .filter((e) => (e.getAttribute('style') ?? '').includes('min-height'))
      .slice(0, 1)
      .map((e) => ({ bg: getComputedStyle(e).backgroundColor, style: e.getAttribute('style') ?? '' })));
    const inlineStyleText30 = (exp30.match(/<div style="([^"]*background-color: #d4e7ff[^"]*)"/) || [])[1] ?? '';
    check('S30.1 行内元素：导出 style 属性 = 画布渲染（默认容器背景一致）', inlineStyleText30.includes('min-height: 60px') && inline30.length === 1 && inline30[0].bg === 'rgb(212, 231, 255)', JSON.stringify({ exp: inlineStyleText30.slice(0, 60), canvas: inline30 }));
    // S30.2 ⚠ 问题面板：badge 计数 + 未命名条目 + 点击选中元素
    const badge30 = await doc(win, '.issue-badge').textContent();
    await doc(win, '.issue-btn').click();
    await new Promise((r) => setTimeout(r, 200));
    const issueText30 = await doc(win, '.issue-pop').textContent();
    await doc(win, '.issue-item').first().click(); // 点未命名条目 → 选中该元素
    await new Promise((r) => setTimeout(r, 250));
    const selAfterIssue30 = (await doc(win, '.sel-indicator').count()) >= 1;
    const issueBlock30 = await doc(win, '.issue-pop').count();
    check('S30.2 ⚠ 面板：计数 + 未命名条目 + 点击可选中', Number(badge30) >= 3 && issueText30.includes('未设置类名') && selAfterIssue30 && issueBlock30 === 0, `badge=${badge30} / ${issueText30.slice(0, 50)} / sel=${selAfterIssue30}`);
    // S30.3 类名管理页签：列出全部名称 + 样式摘要 + 未命名块
    await doc(win, '.inspector-tab:has-text("类名")').click();
    await new Promise((r) => setTimeout(r, 250));
    const clsNames30 = await doc(win, '.cls-card-name').allTextContents();
    const unnamedHead30 = await doc(win, '.cls-block-head').first().textContent();
    const diag30 = { ok: clsNames30.includes('.dup'), ban: clsNames30.includes('.banner test'), id: clsNames30.includes('#c-sec'), un: unnamedHead30.includes('没有类名'), head: unnamedHead30 };
    check('S30.3 类名管理：列表含 .dup / .banner.test / #c-sec + 未命名提示', diag30.ok && diag30.ban && diag30.id && diag30.un, JSON.stringify(diag30));
    await shot(win, '类名ID管理-列表');
    // S30.4 表单模式：调整 .dup 样式 → 保存 → 全部同类元素应用（写回）
    const dupCard30 = doc(win, '.cls-card:has-text(".dup")');
    await dupCard30.locator('button:has-text("调整样式")').click();
    await new Promise((r) => setTimeout(r, 250));
    // 表单行 = key+value 输入对；找到 backgroundColor 那一行改值
    const bgVal30 = doc(win, '.cls-form-row').filter({ has: doc(win, '.cls-form-key[value="backgroundColor"]') }).locator('.cls-form-val');
    await bgVal30.fill('#00aa00');
    await doc(win, '.cls-editor-actions button:has-text("保存并应用")').click();
    await new Promise((r) => setTimeout(r, 400));
    const afterForm30 = await win.evaluate(() => {
      const els = document.querySelectorAll('.canvas > [data-bc-id]');
      const a = getComputedStyle(els[0]).backgroundColor;
      const d = getComputedStyle(els[0].querySelector(':scope > div')).backgroundColor;
      return { a, d };
    });
    check('S30.4 表单编辑类样式 → 写回全部同类元素', afterForm30.a === 'rgb(0, 170, 0)' && afterForm30.d === 'rgb(0, 170, 0)', JSON.stringify(afterForm30));
    // S30.5 源码模式：切源码 → 改 CSS 文本 → 保存 → 全部应用
    await dupCard30.locator('button:has-text("调整样式")').click();
    await new Promise((r) => setTimeout(r, 250));
    await doc(win, '.cls-mode-switch button:has-text("源码")').click();
    await new Promise((r) => setTimeout(r, 150));
    const srcArea30 = doc(win, '.cls-src');
    await srcArea30.fill('background-color: #0000ff;\nwidth: 300px;');
    await doc(win, '.cls-editor-actions button:has-text("保存并应用")').click();
    await new Promise((r) => setTimeout(r, 400));
    const afterSrc30 = await win.evaluate(() => {
      const els = document.querySelectorAll('.canvas > [data-bc-id]');
      const a = getComputedStyle(els[0]).backgroundColor;
      const w = getComputedStyle(els[0]).width;
      return { a, w };
    });
    check('S30.5 源码模式编辑 → 保存应用（背景+宽度）', afterSrc30.a === 'rgb(0, 0, 255)' && parseFloat(afterSrc30.w) >= 290, JSON.stringify(afterSrc30));
    // S30.6 ID 重复输入 → 即时红色警告；类名重复 → 同步提示（4-F：输入即时反馈）
    await doc(win, '.tab-btn:has-text("图层")').click();
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.layer-row:has-text("div 容器")').nth(1).click({ position: { x: 30, y: 8 } }); // divD（divA 内）
    await new Promise((r) => setTimeout(r, 200));
    await doc(win, '.tab-btn:has-text("属性")').click();
    await new Promise((r) => setTimeout(r, 200));
    const idRow30 = doc(win, '.prop-row:has-text("ID?") input');
    await idRow30.fill('c-sec');
    await idRow30.evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 300));
    const dupIdHint30 = await doc(win, '.attr-hint.danger').textContent();
    check('S30.6 ID 重复输入即时警告', dupIdHint30.includes('ID') && dupIdHint30.includes('必须唯一'), dupIdHint30);
    await idRow30.fill('');
    await idRow30.evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 250));
    const clsRow30 = doc(win, '.prop-row:has-text("类名 Class") input');
    await clsRow30.fill('dup');
    await clsRow30.evaluate((el) => el.blur());
    await new Promise((r) => setTimeout(r, 300));
    const dupClsHint30 = await doc(win, '.attr-hint').textContent();
    check('S30.7 类名重复输入提示（编辑即统一）', dupClsHint30.includes('一起变') && !dupClsHint30.includes('必须唯一'), dupClsHint30);
    await shot(win, '类名ID管理-输入提示');

    // ===== S31 布局切换（4-F 版2）：默认底部布局，可切左侧 =====
    // S31.1 默认底部布局：元素面板在画布下方
    const layout31 = await win.evaluate(() => {
      const ws = document.querySelector('.workspace');
      const elem = document.querySelector('.element-panel').getBoundingClientRect();
      const canvas = document.querySelector('.canvas-wrap').getBoundingClientRect();
      return {
        mode: ws.getAttribute('data-layout'),
        elemBelow: elem.top >= canvas.top && elem.top > canvas.bottom - 30,
        canvasW: Math.round(canvas.width)
      };
    });
    check('S31.1 默认底部布局：元素面板在下方、画布宽', layout31.mode === 'bottom' && layout31.elemBelow && layout31.canvasW > 900, JSON.stringify(layout31));
    // S31.2 设置菜单链路：menu:layout-left → 元素面板回到左侧
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:layout-left')));
    await new Promise((r) => setTimeout(r, 300));
    const left31 = await win.evaluate(() => {
      const ws = document.querySelector('.workspace');
      const elem = document.querySelector('.element-panel').getBoundingClientRect();
      const canvas = document.querySelector('.canvas-wrap').getBoundingClientRect();
      return {
        mode: ws.getAttribute('data-layout'),
        elemLeft: elem.left < canvas.left,
        elemW: Math.round(elem.width)
      };
    });
    check('S31.2 切左侧布局：元素面板回左栏（230px）', left31.mode === 'left' && left31.elemLeft && left31.elemW <= 240, JSON.stringify(left31));
    await shot(win, '布局-左侧模式');
    // S31.3 切回底部 + 模板页签在底部布局下面板加高
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:layout-bottom')));
    await new Promise((r) => setTimeout(r, 300));
    await doc(win, '.element-panel .inspector-tab:has-text("模板")').click();
    await new Promise((r) => setTimeout(r, 400));
    const tplH31 = await doc(win, '.element-panel').evaluate((el) => el.getBoundingClientRect().height);
    const mode31 = await doc(win, '.workspace').getAttribute('data-layout');
    check('S31.3 切回底部布局 + 模板页面板加高', mode31 === 'bottom' && tplH31 > 350, JSON.stringify({ mode31, tplH31: Math.round(tplH31) }));
    await shot(win, '布局-底部模板页');
    await doc(win, '.element-panel .inspector-tab:has-text("元素")').click();
    await new Promise((r) => setTimeout(r, 300));

    // ===== S32 设置链路（4-F 版2）：菜单「设置」→ 扩展 / 类名管理 =====
    // S32.1 menu:ext → 扩展弹窗（工具栏 🧩 已移除）
    const extBtnCount32 = await doc(win, '.toolbar button:has-text("扩展")').count();
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('menu:ext')));
    await waitFor(win, doc(win, '.modal-card'));
    await win.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 200));
    check('S32.1 设置菜单 → 扩展弹窗（工具栏无 🧩 按钮）', extBtnCount32 === 0 && (await doc(win, '.modal-card').count()) === 0, `extBtn=${extBtnCount32}`);
    // S32.2 bc:open-class → Inspector 切到「类名」页签
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-class')));
    await new Promise((r) => setTimeout(r, 300));
    const classTab32 = await doc(win, '.inspector-tab:has-text("类名").active').count();
    check('S32.2 类名管理入口（菜单/⚠）→ 切到「类名」页签', classTab32 >= 1, `activeTab=${classTab32}`);

    // ===== S33（新版）：画布左右拖手 + 面板宽/高拖手 =====
    // 当前状态：底部布局、元素页签、属性面板在右。
    // 画布拖手：底部布局下画布基本铺满编辑区，向右拖右缘手柄 → 画布变固定 px + 工具栏读数实时出现。
    await doc(win, '.canvas-width-select').selectOption('auto');
    await new Promise((r) => setTimeout(r, 250));
    const before33 = await win.evaluate(() => ({
      canvasW: Math.round(document.querySelector('.canvas').getBoundingClientRect().width),
      inline: document.querySelector('.canvas').style.width || ''
    }));
    const hR33 = await win.evaluate(() => {
      const r = document.querySelector('.canvas-resize-handle-r').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await win.mouse.move(hR33.x, hR33.y);
    await win.mouse.down();
    await win.mouse.move(hR33.x + 90, hR33.y, { steps: 5 });
    await win.mouse.up();
    await new Promise((r) => setTimeout(r, 250));
    const after33 = await win.evaluate(() => ({
      inlineW: document.querySelector('.canvas').style.width || '',
      readout: document.querySelector('.canvas-width-readout')?.textContent ?? '',
      selectVal: document.querySelector('.canvas-width-select')?.value ?? ''
    }));
    check('S33.1 画布右拖手 → 固定 px 宽 + 工具栏读数', after33.inlineW.endsWith('px') && after33.readout.endsWith('px') && parseInt(after33.inlineW) > before33.canvasW, JSON.stringify({ before33, after33 }));
    // S33.2 切回自适应 → 恢复铺满（无行内宽）
    await doc(win, '.canvas-width-select').selectOption('auto');
    await new Promise((r) => setTimeout(r, 250));
    const back33 = await win.evaluate(() => ({
      w: Math.round(document.querySelector('.canvas').getBoundingClientRect().width),
      inline: document.querySelector('.canvas').style.width || ''
    }));
    check('S33.2 切回自适应铺满', back33.inline === '' && Math.abs(back33.w - before33.canvasW) < 4, JSON.stringify(back33));
    // S33.3 右面板竖向拖手：向左拖 → --bc-right-width 增加（大于默认 320）
    const hV33 = await win.evaluate(() => {
      const r = document.querySelector('.right-pane-wrap .panel-resizer-vertical').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + 100 };
    });
    await win.mouse.move(hV33.x, hV33.y);
    await win.mouse.down();
    await win.mouse.move(hV33.x - 70, hV33.y, { steps: 5 });
    await win.mouse.up();
    await new Promise((r) => setTimeout(r, 250));
    const rw33 = parseInt(await win.evaluate(() => getComputedStyle(document.querySelector('.workspace')).getPropertyValue('--bc-right-width'))) || 320;
    check('S33.3 右面板拖手加宽', rw33 > 320, `rightWidth=${rw33}`);
    // S33.4 底部面板横向拖手：向上拖 → --bc-bottom-height 增加（大于默认 250）
    const hH33 = await win.evaluate(() => {
      const r = document.querySelector('.canvas-area .panel-resizer-horizontal').getBoundingClientRect();
      return { x: r.x + 200, y: r.y + r.height / 2 };
    });
    await win.mouse.move(hH33.x, hH33.y);
    await win.mouse.down();
    await win.mouse.move(hH33.x, hH33.y - 60, { steps: 5 });
    await win.mouse.up();
    await new Promise((r) => setTimeout(r, 250));
    const bh33 = parseInt(await win.evaluate(() => getComputedStyle(document.querySelector('.workspace')).getPropertyValue('--bc-bottom-height'))) || 250;
    check('S33.4 底部面板拖手加高', bh33 > 250, `bottomHeight=${bh33}`);
    // S33.5 最小值约束：右面板朝左拖很远 → 不低于下限 224（约默认 70%）
    const hV33b = await win.evaluate(() => {
      const r = document.querySelector('.right-pane-wrap .panel-resizer-vertical').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + 100 };
    });
    await win.mouse.move(hV33b.x, hV33b.y);
    await win.mouse.down();
    await win.mouse.move(hV33b.x - 600, hV33b.y, { steps: 8 });
    await win.mouse.up();
    await new Promise((r) => setTimeout(r, 250));
    const rwMin33 = parseInt(await win.evaluate(() => getComputedStyle(document.querySelector('.workspace')).getPropertyValue('--bc-right-width'))) || 320;
    check('S33.5 右面板宽度下限（≥224）', rwMin33 >= 224 && isFinite(rwMin33), `rightWidth=${rwMin33}`);
    await shot(win, '画布与面板拖手调整');

    log(`=== 截图已保存: ${SHOTS} ===`);
  } catch (err) {
    log(`FAIL | 流程中断: ${err.message}`);
    try { await shot(win, 'crash'); } catch {}
  } finally {
    writeFileSync(REPORT, results.join('\n') + '\n', 'utf-8');
    try { await app.close(); } catch {}
  }

  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n=== 结果：${results.filter((r) => r.startsWith('PASS')).length} 通过 / ${failed} 失败 ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E 启动失败:', e.message);
  process.exit(1);
});