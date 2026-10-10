// BlockCanvas · v0.4.2 UI 交互探针
// 用 Playwright 驱动真实 Electron 窗口，专测那些"看起来能用、实则别扭"的 UI 交互：
//   1. 二级工具组：默认折叠（剪贴/复制/粘贴、电脑/平板/手机），悬浮展开组内工具
//   2. 工具栏偏好设置按钮已移除
//   3. 工具栏左区/右区都能横向滚动，且「竖向滚轮直接左右滚」（不必按 Shift）
//   4. 全局滚动条变细、且滚动条出现不再把旁边内容挤动
//   5. 模板库多个折叠板块：全部展开时互不重叠、容器可上下滚（历史上的"中间板块点不开"）
//   6. 全程监控 console 报错
// 运行：pnpm build && node tests/e2e/probe-v042.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, readFileSync, writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');

const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (name, cond, extra = '') => {
  out.push(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
  return !!cond;
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-v042-data');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC_EXT = resolve(ROOT, 'extensions');
  if (existsSync(SRC_EXT)) cpSync(SRC_EXT, resolve(DATA_DIR, 'extensions'), { recursive: true });

  // 压测：再克隆 2 个资源包（共 3 包 × 4 分类 = 12 个可折叠板块），
  // 复现"展开的东西过多"时中间板块被压住点不开的极端场景。
  const resRoot = resolve(DATA_DIR, 'extensions', 'resources');
  const srcPack = resolve(resRoot, 'showcase-templates');
  if (existsSync(srcPack)) {
    const man = JSON.parse(readFileSync(resolve(srcPack, 'manifest.json'), 'utf8'));
    for (let i = 2; i <= 3; i++) {
      const dir = resolve(resRoot, `showcase-templates-${i}`);
      cpSync(srcPack, dir, { recursive: true });
      const m = {
        ...man,
        id: `showcase-templates-${i}`,
        name: `压测资源包 ${i}`,
        templates: (man.templates || []).map((t) => ({ ...t, id: `${t.id}-${i}` }))
      };
      writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(m, null, 2));
    }
  }

  // 注意：若宿主环境带 ELECTRON_RUN_AS_NODE=1，Electron 会退化成纯 Node，
  // 表现为 Playwright "Process failed to launch!"，这里显式剔除。
  const childEnv = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: ['.', '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'],
    cwd: ROOT,
    executablePath: electronPath,
    env: childEnv
  });
  const win = await app.firstWindow();
  const errs = [];
  win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1400);

  // ============ 1. 二级工具组：默认已折叠 ============
  const grpBtns = win.locator('.toolbar .tb-grp-btn');
  const grpCount = await grpBtns.count();
  ok('默认存在工具组按钮（剪贴板 / 设备）', grpCount >= 2, String(grpCount));
  const grpText = (await grpBtns.allTextContents()).join(' ');
  ok('含「操作」组（原剪贴板组更名）', grpText.includes('操作'), grpText);
  ok('含「设备」组', grpText.includes('设备'), grpText);

  // 剪切/复制/粘贴 不再各自占位（已折进组里）
  const mainClone = await win.locator('.toolbar .tb-main button', { hasText: '复制' }).count();
  const mainCut = await win.locator('.toolbar .tb-main button', { hasText: '剪切' }).count();
  const mainPaste = await win.locator('.toolbar .tb-main button', { hasText: '粘贴' }).count();
  ok('剪切/复制/粘贴 默认已折叠（主区不再单独占位）', mainClone === 0 && mainCut === 0 && mainPaste === 0,
    `copy=${mainClone} cut=${mainCut} paste=${mainPaste}`);

  // 悬浮展开「操作」组
  await win.locator('.toolbar .tb-grp-btn', { hasText: '操作' }).first().hover();
  await win.waitForSelector('.tb-grp-panel', { state: 'visible', timeout: 4000 }).catch(() => {});
  await sleep(400);
  const clipPanelVisible = await win.locator('.tb-grp-panel').count();
  ok('悬浮「操作」展开组面板', clipPanelVisible > 0);
  const clipItems = await win.locator('.tb-grp-panel .tb-grp-pop-body button').count();
  ok('组面板内含 5 个工具（撤销/重做/复制/剪切/粘贴）', clipItems === 5, String(clipItems));
  const clipText = (await win.locator('.tb-grp-panel .tb-grp-pop-body').innerText().catch(() => '')) || '';
  ok('组面板内确实含撤销/重做/复制/剪切/粘贴', clipText.includes('撤销') && clipText.includes('重做') && clipText.includes('复制') && clipText.includes('剪切') && clipText.includes('粘贴'), clipText.replace(/\n/g, ' '));

  // 鼠标移开 → 组面板收起
  await win.mouse.move(20, 400);
  await sleep(500);
  ok('鼠标移开后组面板自动收起', (await win.locator('.tb-grp-panel').count()) === 0);

  // 悬浮展开「设备」组（电脑/平板/手机折成一个按钮）
  await win.locator('.toolbar .tb-grp-btn', { hasText: '设备' }).first().hover();
  await win.waitForSelector('.tb-grp-panel', { state: 'visible', timeout: 4000 }).catch(() => {});
  await sleep(400);
  const devText = (await win.locator('.tb-grp-panel').innerText().catch(() => '')) || '';
  ok('设备组展开后含 电脑 / 平板 / 手机', devText.includes('电脑') && devText.includes('平板') && devText.includes('手机'), devText.replace(/\n/g, ' '));
  await win.mouse.move(20, 400);
  await sleep(400);

  // ============ 2. 工具栏偏好设置按钮已移除 ============
  const gear = await win.locator('.toolbar button', { hasText: '⚙' }).count();
  const prefTitle = await win.locator('.toolbar button[title*="偏好设置"]').count();
  ok('工具栏已移除「偏好设置」齿轮按钮', gear === 0 && prefTitle === 0, `gear=${gear} title=${prefTitle}`);

  // ============ 2.5 粘贴按钮的禁用态要跟着剪贴板实时变化（历史 BUG：永远灰着）============
  await win.locator('.element-btn', { hasText: '通用容器' }).first().click();
  await sleep(400);
  await win.locator('.toolbar .tb-grp-btn', { hasText: '操作' }).first().hover();
  await win.waitForSelector('.tb-grp-panel .tb-grp-pop-body button', { timeout: 4000 }).catch(() => {});
  await sleep(300);
  const pasteDisabledBefore = await win.locator('.tb-grp-panel .tb-grp-pop-body button', { hasText: '粘贴' }).first().isDisabled().catch(() => true);
  await win.locator('.tb-grp-panel .tb-grp-pop-body button', { hasText: '复制' }).first().click();
  await sleep(350);
  await win.mouse.move(20, 300);
  await sleep(350);
  await win.locator('.toolbar .tb-grp-btn', { hasText: '操作' }).first().hover();
  await win.waitForSelector('.tb-grp-panel .tb-grp-pop-body button', { timeout: 4000 }).catch(() => {});
  await sleep(300);
  const pasteDisabledAfter = await win.locator('.tb-grp-panel .tb-grp-pop-body button', { hasText: '粘贴' }).first().isDisabled().catch(() => true);
  ok('未复制前「粘贴」禁用 → 复制后自动可用（v0.4.3 修复）', pasteDisabledBefore === true && pasteDisabledAfter === false, `before=${pasteDisabledBefore} after=${pasteDisabledAfter}`);
  await win.mouse.move(20, 300);
  await sleep(300);

  // ============ 3. 工具栏左右两区都可横向滚动 + 滚轮直接左右滚 ============
  const overflow = await win.evaluate(() => {
    const m = document.querySelector('.toolbar .tb-main');
    const r = document.querySelector('.toolbar .tb-right');
    return {
      mainOx: m ? getComputedStyle(m).overflowX : 'none',
      rightOx: r ? getComputedStyle(r).overflowX : 'none',
      mainHs: m ? m.classList.contains('bc-hscroll') : false,
      rightHs: r ? r.classList.contains('bc-hscroll') : false
    };
  });
  ok('工具栏主区可横向滚动', overflow.mainOx === 'auto' && overflow.mainHs, JSON.stringify(overflow));
  ok('工具栏右侧区也可横向滚动', overflow.rightOx === 'auto' && overflow.rightHs, JSON.stringify(overflow));

  // 窗口有 minWidth:960，主区只溢出一点点；这里用「设置→工具栏管理」的预览条
  // 做一次更硬的滚轮验证（那里一定放不下，横向溢出明显）。
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-settings')));
  await win.waitForSelector('.fluent-settings-page', { timeout: 8000 });
  await sleep(600);
  await win.locator('.fluent-nav-item', { hasText: '工具栏管理' }).first().click();
  await sleep(700);
  const pvMax = await win.evaluate(() => {
    const el = document.querySelector('.tbman-preview');
    return el ? el.scrollWidth - el.clientWidth : -1;
  });
  ok('工具栏管理预览条出现横向溢出', pvMax > 8, String(pvMax));
  const pvBox = await win.locator('.tbman-preview').first().boundingBox();
  const pvBefore = await win.evaluate(() => document.querySelector('.tbman-preview').scrollLeft);
  if (pvBox) {
    await win.mouse.move(pvBox.x + pvBox.width / 2, pvBox.y + pvBox.height / 2);
    await win.mouse.wheel(0, 200); // 竖向滚轮，不按 Shift
    await sleep(320);
  }
  const pvSl = await win.evaluate(() => document.querySelector('.tbman-preview').scrollLeft);
  // 预览条拆成主区/右区/更多三行后，主区自身溢出量不大 → 断言"滚轮把它推到了末端"
  ok('竖向滚轮直接横向滚动（无需 Shift）', pvSl > pvBefore + 5 && pvSl >= pvMax - 1.5,
    `before=${pvBefore} after=${pvSl} max=${pvMax}`);

  // 设置页里也能看到「工具组」编辑区
  ok('工具栏管理出现「工具组」编辑区', (await win.locator('.tbman-grp-row').count()) >= 2,
    String(await win.locator('.tbman-grp-row').count()));

  await win.locator('.fluent-back-btn').first().click();
  await win.waitForSelector('.toolbar', { timeout: 8000 });
  await sleep(700);

  // ============ 4. 全局滚动条变细 ============
  const sbSize = await win.evaluate(() => {
    const el = document.querySelector('.tab-body') || document.querySelector('.panel');
    if (!el) return -1;
    return el.offsetWidth - el.clientWidth;
  });
  ok('滚动条宽度已收窄（<= 11px，原来约 15~17px）', sbSize >= 0 && sbSize <= 11, String(sbSize));
  const gutter = await win.evaluate(() => {
    const el = document.querySelector('.tab-body') || document.querySelector('.panel');
    return el ? getComputedStyle(el).scrollbarGutter : 'none';
  });
  ok('滚动容器已常驻滚动条槽位（scrollbar-gutter: stable → 内容不再被挤动）', gutter.includes('stable'), gutter);

  // ============ 5. 模板库折叠板块：全部展开互不重叠 + 容器可上下滚 ============
  const checkTemplateSections = async (label) => {
    await win.locator('.inspector-tab', { hasText: '模板' }).first().click();
    await sleep(1300);
    const subHeaders = win.locator('.tpl-sub-header');
    const subCount = await subHeaders.count();
    ok(`[${label}] 模板库存在多个可折叠分类板块`, subCount >= 3, String(subCount));

    // 先把全部板块收起
    for (let i = 0; i < subCount; i++) {
      const cls = (await subHeaders.nth(i).locator('.tpl-sub-caret').getAttribute('class')) || '';
      if (cls.includes('open')) { await subHeaders.nth(i).click(); await sleep(360); }
    }
    // 再逐个展开（历史上"中间板块点不开"就发生在这里）
    for (let i = 0; i < subCount; i++) {
      await subHeaders.nth(i).click();
      await sleep(370);
    }
    await sleep(500);
    mkdirSync(resolve(ROOT, 'tests/e2e/shots-v042'), { recursive: true });
    await win.screenshot({ path: resolve(ROOT, 'tests/e2e/shots-v042', 'tpl-' + label + '.png') });

    const geom = await win.evaluate(() => {
      // 关键：被压扁的板块「盒子变小、内容溢出到盒子外」，所以不能只看盒子是否相邻，
      // 必须量「盒子内所有后代的最大底边」是否超出盒子自身高度。
      const measure = (sel) => Array.from(document.querySelectorAll(sel)).map((g) => {
        const r = g.getBoundingClientRect();
        let maxBottom = r.top;
        g.querySelectorAll('*').forEach((el) => {
          const b = el.getBoundingClientRect().bottom;
          if (b > maxBottom) maxBottom = b;
        });
        return { h: Math.round(r.height), contentH: Math.round(maxBottom - r.top), top: r.top, bottom: r.bottom };
      });
      const body = document.querySelector('.tpl-body');
      // 找一个"真正在滚动"的祖先：底部布局是 .tpl-body 自身，左侧布局是外层 .panel
      const findScroller = (el) => {
        let cur = el;
        while (cur) {
          const oy = getComputedStyle(cur).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight + 2) return cur;
          cur = cur.parentElement;
        }
        return null;
      };
      const scroller = body ? findScroller(body) : null;
      return {
        subs: measure('.tpl-sub-group'),
        packs: measure('.tpl-group'),
        scrollerClass: scroller ? (scroller.className || scroller.tagName) : '(none)',
        scrollerScroll: scroller ? scroller.scrollHeight : 0,
        scrollerClient: scroller ? scroller.clientHeight : 0,
        // 内容超出时，滚动容器必须能覆盖到最后一块板块的底边
        lastBottom: (() => {
          const all = document.querySelectorAll('.tpl-sub-group, .tpl-group');
          const last = all[all.length - 1];
          if (!last || !scroller) return -1;
          return Math.round(last.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop);
        })()
      };
    });
    const all = [...geom.subs, ...geom.packs];
    const overflowing = all.filter((g) => g.contentH > g.h + 3).length;
    ok(`[${label}] 展开内容不溢出板块盒子（无"被压住点不开"）`, overflowing === 0,
      `overflowing=${overflowing}/${all.length} ` + JSON.stringify(all.map((g) => `${g.h}/${g.contentH}`)));
    let overlapped = 0;
    for (let i = 0; i < geom.subs.length - 1; i++) {
      if (geom.subs[i].bottom > geom.subs[i + 1].top + 2) overlapped++;
    }
    ok(`[${label}] 相邻板块盒子不重叠`, overlapped === 0, `overlapped=${overlapped}`);
    ok(`[${label}] 内容过多时能上下滚到最后一块板块`,
      geom.scrollerScroll > geom.scrollerClient && geom.lastBottom <= geom.scrollerScroll + 2,
      `scroller=${geom.scrollerClass} scroll=${geom.scrollerScroll} client=${geom.scrollerClient} lastBottom=${geom.lastBottom}`);
  };

  await checkTemplateSections('底部布局');

  // 换左侧布局再验一遍（两种布局的 CSS 路径完全不同）
  await win.evaluate(() => localStorage.setItem('bc-layout', JSON.stringify('left')));
  await win.reload();
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1800);
  await checkTemplateSections('左侧布局');

  // ============ 6. 设备组：「电脑」= 固定 1920px，「自适应」= 铺满（v0.4.4）============
  // 设备组折在悬浮面板里（Portal + 鼠标移开 220ms 卸载），操作前先确保按钮可见。
  const devBtnAll = () => win.locator('.tb-device .tb-bp-btn');
  const openDeviceGroup = async () => {
    if (await devBtnAll().count()) return;
    const grp = win.locator('.toolbar .tb-grp-btn', { hasText: '设备' }).first();
    if (!(await grp.count())) return;
    await grp.hover({ timeout: 5000 }).catch(() => {});
    await win.waitForSelector('.tb-device .tb-bp-btn', { state: 'visible', timeout: 5000 }).catch(() => {});
    await sleep(200);
  };
  const devBtn = (text) => win.locator('.tb-device .tb-bp-btn', { hasText: text }).first();
  const devBtnActive = (text) => devBtn(text).evaluate((el) => el.classList.contains('active')).catch(() => null);
  const canvasInlineWidth = () => win.evaluate(() => (document.querySelector('.canvas')?.style.width) || '');
  const bpWidthLabel = () => win.locator('.tb-device .tb-bp-width').first().innerText().catch(() => '');

  await openDeviceGroup();
  const devBtnCount = await devBtnAll().count();
  ok('设备组面板含「自适应 + 电脑/平板/手机」4 个按钮', devBtnCount === 4, String(devBtnCount));

  await devBtn('电脑').click({ timeout: 5000 }).catch(() => {});
  await sleep(350);
  const deskInline = await canvasInlineWidth();
  await openDeviceGroup();
  const deskLabel = (await bpWidthLabel()) || '';
  const deskOn = await devBtnActive('电脑');
  const autoOff = await devBtnActive('自适应');
  ok('点「电脑」→ 画布固定 1920px（宽度标签含 1920、电脑高亮、自适应不亮）',
    deskInline === '1920px' && deskLabel.includes('1920') && deskOn === true && autoOff === false,
    `inline=${deskInline} label=${deskLabel} desktopActive=${deskOn} autoActive=${autoOff}`);

  await devBtn('自适应').click({ timeout: 5000 }).catch(() => {});
  await sleep(350);
  const autoInline = await canvasInlineWidth();
  await openDeviceGroup();
  const autoLabel = (await bpWidthLabel()) || '';
  const autoOn = await devBtnActive('自适应');
  const deskOff = await devBtnActive('电脑');
  ok('点「自适应」→ 画布回到铺满（不再写死宽度、显示「自适应」、自适应高亮）',
    autoInline === '' && autoLabel.includes('自适应') && autoOn === true && deskOff === false,
    `inline=${autoInline || '(无)'} label=${autoLabel} autoActive=${autoOn} desktopActive=${deskOff}`);
  await win.mouse.move(20, 400);
  await sleep(400);

  // ============ 7. 标签页关闭保护：空 + 有撤销历史 → 必须二次确认（v0.4.4）============
  const dialogs = [];
  win.on('dialog', (d) => {
    dialogs.push(d.type() + ':' + d.message().slice(0, 24).replace(/\n/g, ' '));
    d.dismiss().catch(() => {});
  });
  const tabCount = () => win.locator('.project-tab-bar .tab-item').count();
  const waitTabCount = async (n, ms = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if ((await tabCount()) === n) return true;
      await sleep(100);
    }
    return (await tabCount()) === n;
  };
  // confirm 会同步阻塞渲染进程 → 用「渲染器还响应吗」给弹窗补一道副证（主证是上面的 dialog 事件）
  const rendererBlocked = async (ms = 600) => {
    try { await win.waitForSelector('.project-tab-bar', { state: 'attached', timeout: ms }); return false; }
    catch { return true; }
  };
  // 未保存标签的关闭叉只在 hover 时出现（CSS :hover），必须先 hover 再点
  const clickActiveTabClose = async () => {
    const tab = win.locator('.project-tab-bar .tab-item.active').first();
    await tab.hover({ timeout: 4000 }).catch(() => {});
    await sleep(150);
    await tab.locator('.tab-close-btn').click({ timeout: 4000 }).catch(() => {});
  };
  const sceneProbe = () => win.evaluate(() => {
    const s = () => window.__sceneStore.getState();
    return { past: s().history.past.length, future: s().history.future.length, children: s().scene.root.children.length };
  });
  const drawThenDelete = () => win.evaluate(() => {
    const s = () => window.__sceneStore.getState();
    s().addElement('div');
    const kids = s().scene.root.children;
    s().removeElement(kids[kids.length - 1].id);
    return { past: s().history.past.length, children: s().scene.root.children.length };
  });

  // 先给「旧标签」造出撤销历史 —— 这样「新开空标签不该继承它的撤销栈」才有区分度
  const seeded = await drawThenDelete();
  ok('（前置）旧标签插入又删除 → 它的撤销栈非空', seeded.past > 0, JSON.stringify(seeded));
  const tabsBase = await tabCount();

  // 7.1 新建空标签：撤销栈必须从零开始（旧行为会沿用上一个标签的历史 → Ctrl+Z 串台）
  await win.locator('.tab-add-btn').first().click({ timeout: 4000 });
  await sleep(350);
  const freshTab = await sceneProbe();
  ok('新开空标签的撤销栈是空的（不再继承上一个标签的撤销历史）',
    freshTab.past === 0 && freshTab.future === 0 && freshTab.children === 0, JSON.stringify(freshTab));

  // 7.2 空 + 无撤销历史 → 点 × 静默关闭，不弹窗
  dialogs.length = 0;
  await clickActiveTabClose();
  const closedSilently = await waitTabCount(tabsBase);
  ok('空且无撤销历史 → 点 × 直接关闭、不弹窗',
    closedSilently && dialogs.length === 0,
    `tabs=${await tabCount()}/${tabsBase} dialogs=${dialogs.length} ${dialogs.join(' | ')}`);

  // 7.3 空 + 有撤销历史 → 点 × 必须二次确认
  await win.locator('.tab-add-btn').first().click({ timeout: 4000 });
  await sleep(350);
  const made = await drawThenDelete();
  ok('（前置）空标签「画过又删掉」：画布回到空、撤销栈非空',
    made.past > 0 && made.children === 0, JSON.stringify(made));
  const tabsBeforeBlock = await tabCount();
  dialogs.length = 0;
  await clickActiveTabClose();
  let blocked = false;
  for (let i = 0; i < 14 && dialogs.length === 0 && !blocked; i++) {
    await sleep(120);
    blocked = await rendererBlocked(500);
  }
  const dialogShown = dialogs.length > 0 || blocked;
  ok('空但有撤销历史 → 点 × 必须二次确认（弹窗拦一道）', dialogShown,
    `dialogs=${dialogs.length} blocked=${blocked} ${dialogs.join(' | ')}`);
  if (blocked && dialogs.length === 0) { try { await win.keyboard.press('Escape'); } catch { /* 兜底关窗 */ } }
  const unblocked = !(await rendererBlocked(2000));
  const tabsAfterCancel = unblocked ? await tabCount() : -1;
  ok('二次确认里选「取消」→ 标签保持打开、不误删',
    unblocked && tabsAfterCancel === tabsBeforeBlock, `tabs=${tabsAfterCancel}/${tabsBeforeBlock} blocked=${!unblocked}`);

  ok('全程零 console / page 错误', errs.length === 0, errs.slice(0, 3).join(' || '));

  await app.close();
  console.log(out.join('\n'));
  console.log('\n=== ' + out.filter((l) => l.startsWith('PASS')).length + ' 通过 / ' + out.filter((l) => l.startsWith('FAIL')).length + ' 失败 ===');
  if (out.some((l) => l.startsWith('FAIL'))) process.exit(2);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
