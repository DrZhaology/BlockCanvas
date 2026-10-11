// 帮助中心专项探针（v0.4.4）
// 覆盖：入口（标签栏 ? / 菜单事件）/ README 内容真的进来了 / 完整 Markdown 渲染
//      （标题·表格·代码块·列表·引用·原始 HTML 横幅）/ 图片路径重写 / 目录 / 搜索高亮 /
//      开·关过渡动画 / Esc 关闭
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
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + '  [' + (extra ?? '') + ']'); }
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-help-probe');
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
  win.on('requestfailed', (r) => {
    errs.push('requestfailed: ' + ((r.failure() && r.failure().errorText) || '') + ' ' + r.url().slice(0, 120));
  });
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1200);

  // ============ 1. 入口：菜单「帮助 → 使用手册」(bc:open-help 事件) ============
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-help')));
  await win.waitForSelector('.help-page', { timeout: 8000 });
  await sleep(400);
  ok('「使用手册」入口打开帮助页', (await win.locator('.help-page').count()) === 1);
  ok('默认进入的是《使用手册》文档（不是项目介绍）',
    (await win.locator('.help-doc').innerText().catch(() => '')).includes('五分钟上手'));

  // 切到「项目介绍」再跑 README 相关断言
  await win.locator('.help-doc-tab', { hasText: '项目介绍' }).click();
  await sleep(600);

  // ============ 2. 开·关动画（用户点名要的） ============
  const anim = await win.evaluate(() => {
    const el = document.querySelector('.help-page');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { name: cs.animationName, dur: cs.animationDuration };
  });
  ok('进场有动画（bcViewIn）', !!anim && String(anim.name).includes('bcViewIn'), JSON.stringify(anim));
  ok('进场时长走 token（非 0s）', !!anim && parseFloat(anim.dur) > 0, anim && anim.dur);

  // ============ 3. 内容真的来自 README（不是另写一份） ============
  const docText = ((await win.locator('.help-doc').innerText().catch(() => '')) || '');
  ok('正文包含 README 的章节（项目简介 / 功能特性 / 技术栈）',
    docText.includes('项目简介') && docText.includes('功能特性') && docText.includes('技术栈'),
    docText.slice(0, 40));
  ok('正文包含 README 里的独有长句（确认不是空壳）',
    docText.includes('可视化静态网页构建工具') || docText.includes('积木画布'), docText.slice(0, 50));

  // ============ 4. 完整 Markdown 语法 ============
  const md = await win.evaluate(() => {
    const d = document.querySelector('.help-doc');
    if (!d) return null;
    const q = (s) => d.querySelectorAll(s).length;
    const imgs = Array.from(d.querySelectorAll('img')).map((i) => i.getAttribute('src') || '');
    return {
      h1: q('h1'), h2: q('h2'), h3: q('h3'),
      p: q('p'), strong: q('strong'), em: q('em'), code: q('code'), pre: q('pre'),
      ul: q('ul'), ol: q('ol'), li: q('li'), a: q('a'), hr: q('hr'),
      table: q('table'), tableWrap: q('.hc-table-wrap'), th: q('th'), td: q('td'),
      // README 顶部的居中横幅是原始 HTML —— 说明 HTML 透传生效
      centerHtml: q("p[align='center']"),
      centered: q('h1[align="center"]'),
      imgs
    };
  });
  ok('Markdown 标题层级都渲染了', !!md && md.h1 >= 1 && md.h2 >= 5 && md.h3 >= 1, JSON.stringify(md && { h1: md.h1, h2: md.h2, h3: md.h3 }));
  ok('段落 / 粗体 / 行内代码', !!md && md.p > 5 && md.strong > 5 && md.code > 5, JSON.stringify(md && { p: md.p, strong: md.strong, code: md.code }));
  ok('无序列表 + 列表项（含 emoji 条目）', !!md && md.ul >= 3 && md.li >= 40, JSON.stringify(md && { ul: md.ul, li: md.li }));
  ok('链接渲染（README 里有大量 docs/ 链接）', !!md && md.a >= 5, String(md && md.a));
  ok('分隔线（README 用了 ---）', !!md && md.hr >= 3, String(md && md.hr));
  ok('**表格语法**：技术栈 / 目录结构等 markdown 表格渲染成 <table>',
    !!md && md.table >= 2 && md.th > 0 && md.td > 0, JSON.stringify(md && { table: md.table, th: md.th, td: md.td }));
  ok('表格被包进可横向滚动的容器', !!md && md.tableWrap >= 2, String(md && md.tableWrap));
  ok('代码块（快速开始的 bash 片段）', !!md && md.pre >= 2, String(md && md.pre));
  ok('原始 HTML 透传（居中横幅还在）', !!md && md.centerHtml >= 2, String(md && md.centerHtml));

  // ============ 5. 图片：相对路径被重写，坏图会被隐藏 ============
  const imgs = (md && md.imgs) || [];
  ok('README 里的图片都被处理过（不留裸 docs/screenshots 相对路径）',
    imgs.length > 0 && imgs.every((s) => !/^\.?\/?docs\//.test(s)),
    JSON.stringify(imgs.slice(0, 4)));
  const shownImgs = await win.evaluate(() => {
    const list = Array.from(document.querySelectorAll('.help-doc img'));
    return {
      total: list.length,
      visible: list.filter((i) => getComputedStyle(i).display !== 'none').length,
      loaded: list.filter((i) => i.naturalWidth > 0).length,
      firstBig: Math.max(0, ...list.map((i) => i.naturalWidth))
    };
  });
  ok('本地截图都能真的加载出来（已内联进产物，不是破图）',
    shownImgs && shownImgs.loaded >= 3 && shownImgs.firstBig > 200,
    JSON.stringify(shownImgs));
  ok('没有 404 / 资源加载失败（图片地址在塞进 DOM 之前就换好了）',
    errs.filter((e) => e.includes('requestfailed')).length === 0,
    errs.filter((e) => e.includes('requestfailed')).slice(0, 3).join(' | '));

  // ============ 6. 目录（TOC） ============
  const tocCount = await win.locator('.help-toc-item').count();
  ok('左侧目录自动从标题生成（≥ 8 节）', tocCount >= 8, String(tocCount));
  const tocFirst = ((await win.locator('.help-toc-item').first().innerText().catch(() => '')) || '');
  ok('目录首项是第一章标题', tocFirst.includes('项目简介') || tocFirst.includes('BlockCanvas'), tocFirst.slice(0, 40));
  // 点目录 → 正文滚动
  const before = await win.evaluate(() => document.querySelector('.help-scroll').scrollTop);
  await win.locator('.help-toc-item', { hasText: '技术栈' }).first().click();
  await sleep(700);
  const after = await win.evaluate(() => document.querySelector('.help-scroll').scrollTop);
  ok('点目录能跳到对应章节', after > before, `${before} → ${after}`);

  // ============ 7. 搜索：命中高亮 ============
  await win.locator('.help-search-input').fill('表格');
  await sleep(600);
  const hits = await win.locator('.help-doc mark.hc-hit').count();
  ok('搜索命中并高亮（<mark>）', hits > 0, `hits=${hits}`);
  const hitTxt = ((await win.locator('.help-search-count').innerText().catch(() => '')) || '');
  ok('搜索计数显示在输入框右侧', /\d+\s*处/.test(hitTxt), hitTxt);
  await win.locator('.help-search-input').fill('');
  await sleep(600);
  ok('清空搜索后高亮被清掉', (await win.locator('.help-doc mark.hc-hit').count()) === 0);
  ok('清空搜索后正文还在（innerHTML 正确还原）',
    (((await win.locator('.help-doc').innerText().catch(() => '')) || '')).includes('技术栈'));

  // ============ 7b. 文档内超链接可跳转 ============
  // 项目介绍里有指向 docs/开发历程.md 的链接 → 点击应切到「开发历程」文档
  const clicked = await win.evaluate(() => {
    const a = Array.from(document.querySelectorAll('.help-doc a')).find((x) => {
      let h = x.getAttribute('href') || '';
      try { h = decodeURIComponent(h); } catch { /* 保持原样 */ }
      return h.includes('开发历程.md');
    });
    if (!a) return false;
    a.click();
    return true;
  });
  await sleep(700);
  ok('文档里的「开发历程」超链接存在', clicked === true);
  ok('点超链接切到了《开发历程》文档',
    (await win.locator('.help-doc').innerText().catch(() => '')).includes('开发历程'),
    String(await win.locator('.help-doc-tab.active').innerText().catch(() => '')));

  // 回项目介绍，测搜索下拉
  await win.locator('.help-doc-tab', { hasText: '项目介绍' }).click();
  await sleep(500);
  await win.locator('.help-search-input').fill('渐变');
  await sleep(500);
  const dd = await win.locator('.help-results .help-result').count();
  ok('搜索弹出「权重结果框」', dd > 0, String(dd));
  if (dd > 0) {
    await win.locator('.help-results .help-result').first().click();
    await sleep(700);
    ok('点搜索结果能跳转（结果框收起 + 文档滚动）', (await win.locator('.help-results').count()) === 0);
  }
  await win.locator('.help-search-input').fill('');
  await sleep(500);

  // ============ 8. 退出动画 + Esc 关闭 ============
  await win.evaluate(() => {
    const scroller = document.querySelector('.help-scroll');
    if (scroller) scroller.scrollTop = 0;
  });
  await sleep(200);
  await win.keyboard.press('Escape');
  await sleep(60);
  const closing = await win.evaluate(() => {
    const el = document.querySelector('.help-page');
    if (!el) return null;
    return { cls: el.className, name: getComputedStyle(el).animationName };
  });
  ok('按 Esc 先播退场动画（is-closing + bcViewOut）',
    !!closing && closing.cls.includes('is-closing') && String(closing.name).includes('bcViewOut'),
    JSON.stringify(closing));
  await sleep(600);
  ok('退场后回到编辑器', (await win.locator('.help-page').count()) === 0 && (await win.locator('.toolbar').count()) === 1);

  // ============ 9. 另一条入口：菜单事件（帮助菜单 → F1 走同一条路） ============
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-help')));
  await sleep(600);
  ok('「帮助」菜单事件也能打开手册', (await win.locator('.help-page').count()) === 1);
  await win.locator('.help-topbar .fluent-back-btn').click();
  await sleep(600);
  ok('点「返回编辑器」正常退出', (await win.locator('.help-page').count()) === 0);

  ok('无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n===== 帮助中心探针：${pass} 通过 / ${fail} 失败 =====`);
  await app.close();
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
