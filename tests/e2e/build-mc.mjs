// BlockCanvas · 「挖矿天地」Minecraft 服务器宣传页自动搭建脚本
// 用 Playwright 驱动真实 Electron 窗口，像真人一样点按钮插入元素、改文案、加属性
//
// 页面设计（从上到下）：
//   header   深色导航栏：logo + 3 个链接
//   section  Hero：大标题 + 宣传语 + 加入按钮 + 服务器地址徽章 + QQ 群提示
//   main     数据栏(4 张卡片) / 玩法介绍(3 张卡片) / 如何加入(步骤+地址框) / 最新公告
//   footer   版权 + 免责声明
//
// 运行：
//   node tests/e2e/build-mc.mjs            # 搭建 + 自检 + 自动导出 HTML，完成后保留窗口（可手动再导出/微调）
//   node tests/e2e/build-mc.mjs --close    # 自检 + 自动导出后自动关闭（CI/回归用）
import { createRequire } from 'module';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');

const ROOT = process.cwd();
// 默认搭建完成后保持窗口打开（供手动导出 HTML）；加 --close 则自动关闭（CI/自测用）
const KEEP_OPEN = !process.argv.includes('--close');
// 自检通过后自动导出到这里（走主进程 BC_EXPORT_PATH 钩子，跳过保存对话框）
const EXPORT_PATH = resolve(ROOT, 'tests/e2e/mc-kuangkuang.html');
const SHOTS = resolve(ROOT, 'tests/e2e/shots-mc');
const REPORT = resolve(ROOT, 'tests/e2e/report-mc.txt');
mkdirSync(SHOTS, { recursive: true });

const logs = [];
function log(m) { logs.push(m); console.log(m); }
const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
const doc = (win, sel) => win.locator(sel);
const elHas = (win, sel, text) => doc(win, sel).filter({ hasText: text });
const row = (win, label) => doc(win, `.prop-row:has(.prop-row-header:has-text("${label}"))`);

async function shot(win, name) {
  await win.screenshot({ path: `${SHOTS}/${name}.png` });
}

// ============ 原子操作 ============
async function ins(win, label) {
  log(`  [ins ${label}]`);
  await doc(win, `.element-btn:has-text("${label}")`).click();
  await waitMs(200);
}
async function txt(win, s) {
  await doc(win, '.inspector .field textarea').fill(s);
  await waitMs(60);
}
// 属性行已显示（默认样式/之前加过）则直接用；否则走 "+ 添加属性" 菜单。
// 不能一律走菜单：默认行（如容器的背景色/内边距、标题的字号/字重）不在候选里，点了会找不到。
async function ensureRow(win, propLabel) {
  const r = doc(win, `.prop-row:has(.prop-row-header:has-text("${propLabel}"))`);
  if ((await r.count()) > 0) { log(`  [row-dir ${propLabel}]`); return; }
  log(`  [row-add ${propLabel}]`);
  await doc(win, '.add-prop-trigger').click();
  await waitMs(150);
  await doc(win, '.add-prop-search input').fill(propLabel);
  await waitMs(120);
  await doc(win, `.add-prop-item:has-text("${propLabel}")`).first().click();
  await waitMs(200); // 等行渲染 & 高亮稳定
}
async function num(win, propLabel, v) {
  await ensureRow(win, propLabel);
  const i = row(win, propLabel).locator('.num-unit-num');
  await i.fill(String(v));
  await i.press('Enter');
  await waitMs(70);
}
async function numDirect(win, propLabel, v) { // 宽度/高度 是默认行，不进菜单
  const i = row(win, propLabel).first().locator('.num-unit-num');
  await i.fill(String(v));
  await i.press('Enter');
  await waitMs(70);
}
async function trbl(win, propLabel, v) {
  await ensureRow(win, propLabel);
  const i = row(win, propLabel).locator('.trbl-input');
  await i.fill(String(v));
  await i.press('Enter');
  await waitMs(70);
}
async function txtProp(win, propLabel, v) {
  await ensureRow(win, propLabel);
  const i = row(win, propLabel).locator('.prop-row-body input[type="text"]');
  await i.fill(String(v));
  await i.press('Tab');
  await waitMs(70);
}
async function sel(win, propLabel, v) {
  await ensureRow(win, propLabel);
  await row(win, propLabel).locator('select').selectOption(String(v));
  await waitMs(160); // 给 React 状态传播 + Canvas 重绘留充裕时间（之前 70ms 偶尔没接上）
}
async function color(win, propLabel, v) {
  await ensureRow(win, propLabel);
  const i = row(win, propLabel).locator('.color-text-input');
  await i.fill(String(v));
  await i.press('Tab');
  await waitMs(70);
}
async function box4(win, propLabel, v) {
  await ensureRow(win, propLabel);
  const cells = row(win, propLabel).locator('.box4-cell input');
  for (let k = 0; k < 4; k++) {
    await cells.nth(k).fill(String(v));
    await cells.nth(k).press('Tab');
  }
  await waitMs(70);
}
async function attr(win, label, v) {
  const i = doc(win, `.prop-row:has(.prop-row-header:has-text("${label}")) .attr-row-body input`);
  await i.fill(String(v));
  await i.press('Tab');
  await waitMs(70);
}
async function selectTree(win, text, nth = 0) {
  log(`  [tree ${text}#${nth}]`);
  await doc(win, '.tab-btn:has-text("图层")').click();
  await waitMs(60);
  await elHas(win, '.layer-row', text).nth(nth).click({ position: { x: 80, y: 8 } });
  await waitMs(150);
  await doc(win, '.tab-btn:has-text("属性")').click();
  await waitMs(60);
}

// ============ 主体 ============
async function build(win) {
  let divN = -1; // div 行在图层树里的序号（按插入顺序 = DFS 顺序）

  // ===== 1. header 导航 =====
  await ins(win, '页眉');
  await color(win, '背景色', '#10150c');
  await trbl(win, '内边距', '10px 20px');
  await sel(win, '显示模式', 'flex');
  await sel(win, '主轴对齐', 'space-between');
  await sel(win, '交叉轴对齐', 'center');
  await num(win, '子元素间距', 16);

  await ins(win, '行内文字');
  await txt(win, '⛏️ 挖矿天地');
  await color(win, '文字颜色', '#ffffff');
  await num(win, '字号', 17);
  await sel(win, '字重', 'bold');
  await color(win, '背景色', 'rgba(0,0,0,0)');
  await trbl(win, '内边距', '0');

  await selectTree(win, 'header 页眉');
  await ins(win, '通用容器'); // 菜单容器
  divN = 0;
  await sel(win, '显示模式', 'flex');
  await num(win, '子元素间距', 16);
  await color(win, '背景色', 'rgba(0,0,0,0)');
  await trbl(win, '内边距', '0');

  for (const t of ['首页', '玩法介绍', '如何加入']) {
    await selectTree(win, 'div 容器', divN);
    await ins(win, '链接');
    await txt(win, t);
    await color(win, '文字颜色', '#b8c7a8');
    await num(win, '字号', 13);
    await attr(win, '链接地址', '#');
  }

  // ===== 2. hero =====
  await selectTree(win, '画布根');
  await ins(win, '区块');
  await color(win, '背景色', '#1b2416');
  await trbl(win, '内边距', '48px 24px 40px');
  await sel(win, '文字对齐', 'center');
  await trbl(win, '外边距', '0 0 12px 0');

  await ins(win, '标题1');
  await txt(win, '挖矿天地 · Minecraft 生存服务器');
  await color(win, '文字颜色', '#ffffff');
  await num(win, '字号', 36);
  await sel(win, '字重', 'bold');
  await txtProp(win, '文字阴影', '0 3px 0 rgba(0,0,0,0.35)');
  await trbl(win, '外边距', '0 0 12px 0');
  await num(win, '字间距', 1);

  await ins(win, '段落');
  await txt(win, '原版生存 · 空岛 · 小游戏，Java 版 1.21.4，24 小时不间断运行');
  await color(win, '文字颜色', '#b8c7a8');
  await num(win, '字号', 16);
  await trbl(win, '外边距', '0 0 24px 0');

  await ins(win, '通用容器'); // hero-btns
  divN = 1;
  await sel(win, '显示模式', 'flex');
  await sel(win, '主轴对齐', 'center');
  await num(win, '子元素间距', 16);
  await color(win, '背景色', 'rgba(0,0,0,0)');
  await trbl(win, '内边距', '0');

  await ins(win, '按钮'); // CTA
  await txt(win, '加入服务器');
  await color(win, '背景色', '#5b8731');
  await color(win, '文字颜色', '#ffffff');
  await sel(win, '边框样式', 'solid');
  await box4(win, '边框宽度', 2);
  await color(win, '边框颜色', '#3c5a1e');
  await trbl(win, '圆角', 6);
  await trbl(win, '内边距', '12px 28px');
  await num(win, '字号', 15);
  await sel(win, '字重', 'bold');
  await txtProp(win, '盒子阴影', '0 3px 0 #3c5a1e');
  await sel(win, '鼠标指针', 'pointer');

  await selectTree(win, 'div 容器', 1);
  await ins(win, '链接'); // IP 徽章
  await txt(win, 'mc.kuangkuang.top:25565');
  await color(win, '背景色', '#0e140a');
  await color(win, '文字颜色', '#a8d08d');
  await sel(win, '边框样式', 'solid');
  await box4(win, '边框宽度', 1);
  await color(win, '边框颜色', '#5b8731');
  await trbl(win, '圆角', 6);
  await trbl(win, '内边距', '10px 16px');
  await num(win, '字号', 14);
  await sel(win, '字重', 'bold');
  await txtProp(win, '字体', 'Consolas, monospace');
  await attr(win, '链接地址', '#');

  await selectTree(win, 'section 区块');
  await ins(win, '段落');
  await txt(win, 'QQ 群 123456789 · 新人入群领新手礼包');
  await color(win, '文字颜色', '#7d8a6e');
  await num(win, '字号', 12);
  await trbl(win, '外边距', '20px 0 0 0');

  // ===== 3. main =====
  await selectTree(win, '画布根');
  await ins(win, '主区');
  await color(win, '背景色', '#ffffff');

  // 3.1 数据栏
  await ins(win, '通用容器'); // stats
  divN = 2;
  await color(win, '背景色', '#171d13');
  await trbl(win, '内边距', '24px 16px');
  await trbl(win, '外边距', '0 0 12px 0');
  await sel(win, '显示模式', 'flex');
  await sel(win, '主轴对齐', 'space-evenly');
  await sel(win, '交叉轴对齐', 'center');
  await num(win, '子元素间距', 8);

  const stats = [['128', '在线玩家'], ['12,800', '累计注册'], ['900+', '连续开服天数'], ['30ms', '平均延迟']];
  for (const [n, l] of stats) {
    await selectTree(win, 'div 容器', 2);
    await ins(win, '通用容器'); // stat card
    divN++;
    await color(win, '背景色', '#1e2818');
    await sel(win, '边框样式', 'solid');
    await box4(win, '边框宽度', 1);
    await color(win, '边框颜色', '#2e3b22');
    await trbl(win, '圆角', 8);
    await trbl(win, '内边距', '16px 24px');
    await sel(win, '文字对齐', 'center');
    await ins(win, '标题3');
    await txt(win, n);
    await color(win, '文字颜色', '#9ecb6e');
    await num(win, '字号', 24);
    await trbl(win, '外边距', '0 0 4px 0');
    await ins(win, '段落');
    await txt(win, l);
    await color(win, '文字颜色', '#8fa07f');
    await num(win, '字号', 12);
    await trbl(win, '外边距', '0');
  }

  // 3.2 玩法介绍
  await selectTree(win, '主区');
  await ins(win, '通用容器'); // features
  divN = 7;
  await color(win, '背景色', '#171d13');
  await trbl(win, '内边距', '28px 24px');
  await trbl(win, '外边距', '0 0 12px 0');

  await ins(win, '标题2');
  await txt(win, '玩法介绍');
  await color(win, '文字颜色', '#ffffff');
  await num(win, '字号', 22);
  await sel(win, '文字对齐', 'center');
  await num(win, '字间距', 2);
  await trbl(win, '外边距', '0 0 24px 0');

  await selectTree(win, 'div 容器', 7);
  await ins(win, '通用容器'); // feat-row
  divN = 8;
  await sel(win, '显示模式', 'flex');
  await sel(win, '主轴对齐', 'center');
  await num(win, '子元素间距', 16);
  await color(win, '背景色', 'rgba(0,0,0,0)');
  await trbl(win, '内边距', '0');

  const feats = [
    ['原版生存', '纯原版玩法，红石、建筑、农业样样齐全，每周举办建筑大赛与末地挑战。'],
    ['空岛', '开局一座浮空岛，从石头与泥土开始，打造属于你的天空之城。'],
    ['小游戏', '起床战争、空岛战争、跑酷竞速每周轮换，随时开黑随时玩。']
  ];
  for (const [t, d] of feats) {
    await selectTree(win, 'div 容器', 8);
    await ins(win, '通用容器'); // feat card
    divN++;
    await color(win, '背景色', '#1e2818');
    await sel(win, '边框样式', 'solid');
    await box4(win, '边框宽度', 1);
    await color(win, '边框颜色', '#2e3b22');
    await trbl(win, '圆角', 8);
    await trbl(win, '内边距', '20px');
    await numDirect(win, '宽度', 240);
    await ins(win, '标题3');
    await txt(win, t);
    await color(win, '文字颜色', '#9ecb6e');
    await num(win, '字号', 16);
    await trbl(win, '外边距', '0 0 10px 0');
    await ins(win, '段落');
    await txt(win, d);
    await color(win, '文字颜色', '#a9b89b');
    await num(win, '字号', 13);
    await txtProp(win, '行高', 1.7);
    await trbl(win, '外边距', '0');
  }

  // 3.3 如何加入
  await selectTree(win, '主区');
  await ins(win, '通用容器'); // join
  divN = 12;
  await color(win, '背景色', '#171d13');
  await trbl(win, '内边距', '28px 24px');
  await trbl(win, '外边距', '0 0 12px 0');

  await ins(win, '标题2');
  await txt(win, '如何加入');
  await color(win, '文字颜色', '#ffffff');
  await num(win, '字号', 22);
  await sel(win, '文字对齐', 'center');
  await num(win, '字间距', 2);
  await trbl(win, '外边距', '0 0 24px 0');

  const steps = [
    '① 准备 Java 版 Minecraft 1.21.4（基岩版 / 网易版暂不支持）',
    '② 打开「多人游戏」→「添加服务器」，填入下方地址',
    '③ 点击「加入服务器」，首次进入自动领取新人礼包'
  ];
  for (const s of steps) {
    await selectTree(win, 'div 容器', 12);
    await ins(win, '段落');
    await txt(win, s);
    await color(win, '文字颜色', '#a9b89b');
    await num(win, '字号', 14);
    await txtProp(win, '行高', 1.8);
    await trbl(win, '外边距', '0 0 8px 0');
  }

  await selectTree(win, 'div 容器', 12);
  await ins(win, '分割线');
  await color(win, '边框颜色', '#33402a');
  await trbl(win, '外边距', '16px 0');

  await selectTree(win, 'div 容器', 12);
  await ins(win, '通用容器'); // ip-box
  divN = 13;
  await sel(win, '显示模式', 'flex');
  await sel(win, '主轴对齐', 'center');
  await sel(win, '交叉轴对齐', 'center');
  await num(win, '子元素间距', 16);
  await color(win, '背景色', '#12170f');
  await sel(win, '边框样式', 'dashed');
  await box4(win, '边框宽度', 1);
  await color(win, '边框颜色', '#5b8731');
  await trbl(win, '圆角', 8);
  await trbl(win, '内边距', '14px 18px');

  await selectTree(win, 'div 容器', 13);
  await ins(win, '行内文字');
  await txt(win, '服务器地址');
  await color(win, '文字颜色', '#8fa07f');
  await color(win, '背景色', 'rgba(0,0,0,0)');
  await num(win, '字号', 13);
  await trbl(win, '内边距', '0');

  await selectTree(win, 'div 容器', 13);
  await ins(win, '行内文字');
  await txt(win, 'mc.kuangkuang.top:25565');
  await color(win, '文字颜色', '#a8d08d');
  await color(win, '背景色', 'rgba(0,0,0,0)');
  await num(win, '字号', 15);
  await sel(win, '字重', 'bold');
  await txtProp(win, '字体', 'Consolas, monospace');
  await num(win, '字间距', 1);
  await trbl(win, '内边距', '0');

  await selectTree(win, 'div 容器', 13);
  await ins(win, '按钮');
  await txt(win, '复制地址');
  await color(win, '背景色', '#5b8731');
  await color(win, '文字颜色', '#ffffff');
  await sel(win, '边框样式', 'solid');
  await box4(win, '边框宽度', 2);
  await color(win, '边框颜色', '#3c5a1e');
  await trbl(win, '圆角', 4);
  await trbl(win, '内边距', '6px 14px');
  await num(win, '字号', 12);
  await sel(win, '鼠标指针', 'pointer');

  // 3.4 最新公告
  await selectTree(win, '主区');
  await ins(win, '通用容器'); // news
  divN = 14;
  await color(win, '背景色', '#171d13');
  await trbl(win, '内边距', '28px 24px');

  await ins(win, '标题2');
  await txt(win, '最新公告');
  await color(win, '文字颜色', '#ffffff');
  await num(win, '字号', 22);
  await sel(win, '文字对齐', 'center');
  await num(win, '字间距', 2);
  await trbl(win, '外边距', '0 0 24px 0');

  await ins(win, '段落');
  await txt(win, '2026-08-17：服务器已升级至 Java 1.21.4，存档无损迁移；本周六 20:00 举行第一届建筑大赛，冠军可得限定称号与 20 万金币！');
  await color(win, '文字颜色', '#a9b89b');
  await num(win, '字号', 13);
  await txtProp(win, '行高', 1.8);
  await trbl(win, '外边距', '0');

  // ===== 4. footer =====
  await selectTree(win, '画布根');
  await ins(win, '页脚');
  await color(win, '背景色', '#0f130c');
  await trbl(win, '内边距', '16px 20px');
  await sel(win, '文字对齐', 'center');

  await ins(win, '段落');
  await txt(win, '© 2026 挖矿天地 · Minecraft 服务器');
  await color(win, '文字颜色', '#7d8a6e');
  await num(win, '字号', 12);
  await trbl(win, '外边距', '0 0 4px 0');

  await selectTree(win, 'footer 页脚');
  await ins(win, '段落');
  await txt(win, '非官方页面，与 Mojang 无关 · 网页由 BlockCanvas 制作');
  await color(win, '文字颜色', '#5d6a50');
  await num(win, '字号', 11);
  await trbl(win, '外边距', '0');

  log(`构建完成：图层树 div 计数预期 15（含卡片），实际序号到 ${divN}`);
}

async function verify(win) {
  const checks = await win.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const c = (s) => document.querySelector(s);
    const hero = c('.canvas > section');
    const ipLink = c('.canvas > section a');
    const statsRow = c('.canvas > main > div:nth-child(1)');
    const featRow = c('.canvas > main > div:nth-child(2) > div:nth-child(2)');
    const ipBox = c('.canvas > main > div:nth-child(3) > div:last-child');
    return {
      header: q('.canvas > header'), section: q('.canvas > section'), main: q('.canvas > main'), footer: q('.canvas > footer'),
      navLinks: q('.canvas > header a'), statCards: q('.canvas > main > div:nth-child(1) > div'),
      featCards: q('.canvas > main > div:nth-child(2) > div:nth-child(2) > div'),
      heroBg: hero ? getComputedStyle(hero).backgroundColor : null,
      heroAlign: hero ? getComputedStyle(hero).textAlign : null,
      ctaBg: c('.canvas > section button') ? getComputedStyle(c('.canvas > section button')).backgroundColor : null,
      ipFont: ipLink ? getComputedStyle(ipLink).fontFamily : null,
      ipColor: ipLink ? getComputedStyle(ipLink).color : null,
      statCardsBg: statsRow ? getComputedStyle(statsRow.firstElementChild).backgroundColor : null,
      featRowDisplay: featRow ? getComputedStyle(featRow).display : null,
      ipBoxBorder: ipBox ? getComputedStyle(ipBox).borderTopStyle : null,
      ipBoxRadius: ipBox ? getComputedStyle(ipBox).borderTopLeftRadius : null
    };
  });
  for (const [k, v] of Object.entries(checks)) log(`  ${k} = ${v}`);
  const ok =
    checks.header === 1 && checks.section === 1 && checks.main === 1 && checks.footer === 1 &&
    checks.navLinks === 3 && checks.statCards === 4 && checks.featCards === 3 &&
    checks.heroBg === 'rgb(27, 36, 22)' && checks.heroAlign === 'center' &&
    checks.ctaBg === 'rgb(91, 135, 49)' && checks.ipColor === 'rgb(168, 208, 141)' &&
    checks.featRowDisplay === 'flex' && checks.ipBoxBorder === 'dashed';
  log(`自检：${ok ? '全部通过' : '有问题！'}`);
  return ok;
}

async function autoExport(app, dest) {
  log(`[export] 自动导出 → ${dest}`);
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.webContents.send('menu:export-html');
    });
    for (let i = 0; i < 40; i++) { // 最多等 8s
      if (existsSync(dest)) { log(`[export] 已导出 ${dest}`); return dest; }
      await waitMs(200);
    }
    log('[export] 等待超时，未生成文件');
    return null;
  } catch (e) {
    log(`[export] 触发失败: ${e.message}`);
    return null;
  }
}

async function main() {
  log('=== 搭建 Minecraft 宣传页 ===');
  const app = await electron.launch({ args: ['.'], cwd: ROOT, executablePath: electronPath, env: { ...process.env, BC_EXPORT_PATH: EXPORT_PATH } });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  try {
    await doc(win, '.app').waitFor({ state: 'visible', timeout: 15000 });
    await win.setViewportSize({ width: 1280, height: 1900 });
    await build(win);
    await shot(win, '01-搭建完成');
    const ok = await verify(win);
    await shot(win, '02-自检');
    await autoExport(app, EXPORT_PATH);
    log('页面已就绪。' + (KEEP_OPEN ? '窗口保持打开，可手动再导出/微调。' : '即将关闭窗口。'));
    if (!ok && !KEEP_OPEN) process.exitCode = 1;
  } catch (err) {
    log(`FAIL | 流程中断: ${err.message}`);
    try {
      const dump = await win.evaluate(() => {
        const rows = [...document.querySelectorAll('.prop-row')].map((r) => r.textContent.trim().slice(0, 80));
        const sel = document.querySelector('.inspector .panel-title')?.textContent ?? '';
        const trbl = document.querySelectorAll('.trbl-input').length;
        const trigger = document.querySelector('.add-prop-trigger')?.textContent ?? '';
        const menuOpen = !!document.querySelector('.add-prop-menu');
        const searchVal = document.querySelector('.add-prop-search input')?.value ?? '';
        const items = [...document.querySelectorAll('.add-prop-item')].map((i) => i.textContent.trim().slice(0, 50));
        const matched = [...document.querySelectorAll('.prop-row')].filter((r) => (r.querySelector('.prop-row-header')?.textContent ?? '').includes('内边距')).map((r) => r.textContent.trim().slice(0, 80));
        const rightPane = document.querySelector('.right-pane')?.textContent.trim().slice(0, 300) ?? '';
        const activeTab = document.querySelector('.tab-btn.active')?.textContent ?? '';
        const bodyErr = document.querySelector('.tab-body')?.innerHTML.slice(0, 300) ?? '';
        return { sel, rows, trbl, trigger, menuOpen, searchVal, items, matched, rightPane, activeTab, bodyErr };
      });
      log('INSPECT: ' + JSON.stringify(dump, null, 1));
    } catch (e2) { log('INSPECT-FAIL: ' + e2.message); }
    try { await shot(win, 'crash'); } catch {}
    process.exitCode = 1;
  } finally {
    writeFileSync(REPORT, logs.join('\n') + '\n', 'utf-8');
    if (KEEP_OPEN) {
      // 保持窗口打开：等用户看完/导出/关窗后再退出脚本
      try { await app.waitForEvent('close'); } catch {}
      log('窗口已关闭，脚本退出。');
      writeFileSync(REPORT, logs.join('\n') + '\n', 'utf-8');
      process.exit(0);
    } else {
      try { await app.close(); } catch {}
      process.exit(process.exitCode ?? 0);
    }
  }
}

main().catch((e) => {
  console.error('E2E 启动失败:', e.message);
  process.exit(1);
});