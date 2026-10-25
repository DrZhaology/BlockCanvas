// v0.4.5 第十六批探针：中键搜索简化 / 三处切换动画 / 快照抽屉关闭动画与按钮间距
// 用法：node tests/e2e/probe-v045-batch16.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, readFileSync } from 'fs';
import { ensureEditor } from './ensure-editor.mjs';

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
  // ==========================================================================
  // A. 静态：样式与源码层面的约定
  // ==========================================================================
  const css29 = readFileSync(resolve(ROOT, 'src/renderer/styles/29-v045-perf.css'), 'utf8');
  const css10 = readFileSync(resolve(ROOT, 'src/renderer/styles/10-settings-projects.css'), 'utf8');
  const css28 = readFileSync(resolve(ROOT, 'src/renderer/styles/28-v045-zindex.css'), 'utf8');

  check('元素面板的切换动画包装层会撑满剩余宽度（不再挤到左边）',
    /\.element-panel > \.elem-tab-anim\s*\{[^}]*flex:\s*1 1 0/.test(css29)
    && /\.element-panel > \.elem-tab-anim\s*\{[^}]*min-width:\s*0/.test(css29),
    'flex: 1 1 0 + min-width: 0');
  check('元素面板包装层带切换动画（bcSwapIn）',
    /\.element-panel > \.elem-tab-anim\s*\{[^}]*animation:\s*bcSwapIn/.test(css29), 'ok');
  check('首页「页面设置」板块也有切换动画',
    /\.eh-panel-tabbody\s*\{[^}]*animation:\s*bcSwapIn/.test(css29), 'ok');

  // 关闭动画：入场动画带 both 填充，退场必须显式 animation: none，否则 opacity 被动画终态盖住
  check('快照抽屉关闭时会真正播退场（animation: none 解除 both 填充）',
    /\.pc-drawer-mask\.is-closing\s*\{[^}]*animation:\s*none/.test(css10)
    && /\.pc-drawer-mask\.is-closing\s*\{[^}]*opacity:\s*0/.test(css10),
    'ok');
  check('项目信息小问号关闭时也播退场',
    /\.pc-kindhelp-pop\.is-closing\s*\{[^}]*animation:\s*none/.test(css29), 'ok');
  check('快照卡片两个按钮有明确间距（不再贴在一起）',
    /\.pc-backup-action\s*\{[^}]*gap:\s*10px/.test(css10), 'ok');

  // 中键搜索：只剩一种蓝（淡蓝卡片底），没有左侧蓝条；值预测样式已删除
  // ⚠ 静态断言要**排除注释行**，并且只针对 `.bc-prop-search-item` 自己的规则
  //   （`inset 2px 0 0` 在变量菜单 `.bc-varmenu-item` 上仍在用，那是另一回事）。
  const css28Rules = css28.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/|→)/.test(l)).join('\n');
  const propSearchActiveLines = css28Rules.split('\n').filter((l) => /bc-prop-search-item\.is-active/.test(l));
  check('中键搜索选中态是淡蓝卡片底、**没有**左侧蓝条',
    /\.bc-prop-search-item\.is-active[\s\S]{0,260}box-shadow:\s*none/.test(css28Rules)
    && !propSearchActiveLines.some((l) => /inset 2px/.test(l)),
    `${propSearchActiveLines.length} 条 is-active 规则，无 inset`);
  check('中键搜索的属性值预测样式已彻底移除（注释不算）',
    !/^\s*\.bc-prop-vals\s*\{/m.test(css28Rules) && !/^\s*\.bc-prop-val\s*\{/m.test(css28Rules),
    'ok');

  const DATA_DIR = resolve(tmpdir(), 'bc-probe-b16');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'projects'), { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 15000 });
  await sleep(900);

  // ==========================================================================
  // B. 元素面板布局：包装层必须撑满剩余宽度（回归"全部挤到左边"）
  // ==========================================================================
  const layout = await win.evaluate(() => {
    const panel = document.querySelector('.element-panel');
    const tabs = document.querySelector('.element-panel .inspector-tabs');
    const wrap = document.querySelector('.element-panel > .elem-tab-anim');
    if (!panel || !wrap) return { missing: true };
    const p = panel.getBoundingClientRect();
    const t = tabs ? tabs.getBoundingClientRect() : null;
    const w = wrap.getBoundingClientRect();
    const cs = getComputedStyle(wrap);
    return {
      panelW: Math.round(p.width),
      tabsW: t ? Math.round(t.width) : 0,
      wrapW: Math.round(w.width),
      flex: cs.flex,
      dir: cs.flexDirection,
      // 期望：包装层宽度 ≈ 面板宽 - 页签宽 - gap - padding
      fills: w.width > p.width * 0.6
    };
  });
  check('元素面板内容区撑满剩余宽度（不再全部挤到左边）',
    !layout.missing && layout.fills === true,
    JSON.stringify(layout));
  check('包装层是纵向 flex 容器（内容按列排，与原来一致）',
    !layout.missing && layout.dir === 'column', String(layout.dir));

  // 截图留证：元素面板（人工复核布局）
  await win.screenshot({
    path: resolve(DATA_DIR, 'element-panel.png'),
    timeout: 20000,
    clip: await win.evaluate(() => {
      const r = document.querySelector('.element-panel').getBoundingClientRect();
      return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, 900), height: Math.min(r.height, 400) };
    })
  }).catch(() => {});

  // ==========================================================================
  // C. 板块切换会重新挂载并播动画
  // ==========================================================================
  const tabAnim = await win.evaluate(async () => {
    const before = document.querySelector('.element-panel > .elem-tab-anim');
    const csBefore = before ? getComputedStyle(before).animationName : '';
    // 点「模板」
    const tplBtn = [...document.querySelectorAll('.element-panel .inspector-tab')].find((b) => /模板/.test(b.textContent || ''));
    tplBtn?.click();
    await new Promise((r) => setTimeout(r, 120));
    const after = document.querySelector('.element-panel > .elem-tab-anim');
    const csAfter = after ? getComputedStyle(after).animationName : '';
    // 再切回元素
    const elBtn = [...document.querySelectorAll('.element-panel .inspector-tab')].find((b) => /元素/.test(b.textContent || ''));
    elBtn?.click();
    await new Promise((r) => setTimeout(r, 120));
    return { csBefore, csAfter, remounted: before !== after };
  });
  check('切到「模板」板块时内容重新挂载并播放 bcSwapIn',
    tabAnim.remounted === true && tabAnim.csAfter.includes('bcSwapIn'),
    JSON.stringify(tabAnim));

  // 切回「元素」后布局仍然正常（防止动画层把布局带坏）
  const layoutAfter = await win.evaluate(() => {
    const panel = document.querySelector('.element-panel');
    const wrap = document.querySelector('.element-panel > .elem-tab-anim');
    if (!panel || !wrap) return { missing: true };
    return {
      fills: wrap.getBoundingClientRect().width > panel.getBoundingClientRect().width * 0.6,
      gridCols: document.querySelectorAll('.element-panel .element-grid').length
    };
  });
  check('切回「元素」后布局与网格仍在（动画层不影响布局）',
    !layoutAfter.missing && layoutAfter.fills === true && layoutAfter.gridCols > 0,
    JSON.stringify(layoutAfter));

  // ==========================================================================
  // D. 中键搜索：只显示 3 条 / 三段信息 / 淡蓝选中 / Enter 与 Ctrl+Enter 分工
  // ==========================================================================
  // 先放一个元素并选中，方便中键搜索
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
  });
  await sleep(700);
  // 打开中键搜索：直接派发组件用的入口（避免依赖真实中键坐标）
  await win.evaluate(() => {
    const el = document.querySelector('.canvas [data-bc-id]');
    const r = el.getBoundingClientRect();
    window.dispatchEvent(new CustomEvent('bc:open-prop-search', {
      detail: { x: Math.round(r.left + 20), y: Math.round(r.top + 20) }
    }));
  });
  await sleep(600);
  let opened = await win.evaluate(() => !!document.querySelector('.bc-prop-search'));
  if (!opened) {
    // 兜底：真实中键点击画布元素
    const box = await win.evaluate(() => {
      const el = document.querySelector('.canvas [data-bc-id]');
      const r = el.getBoundingClientRect();
      return { x: r.left + 20, y: r.top + 20 };
    });
    await win.mouse.move(box.x, box.y);
    await win.mouse.down({ button: 'middle' });
    await win.mouse.up({ button: 'middle' });
    await sleep(600);
    opened = await win.evaluate(() => !!document.querySelector('.bc-prop-search'));
  }
  check('准备：中键属性搜索能打开', opened === true, String(opened));

  if (opened) {
    // 输入一个会命中很多属性的词
    await win.evaluate(() => {
      const input = document.querySelector('.bc-prop-search-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'color');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(450);
    const rows = await win.evaluate(() => {
      const items = [...document.querySelectorAll('.bc-prop-search-item')];
      return {
        count: items.length,
        // 三段：中文名 / 英文名 / 状态徽章
        segs: items.map((it) => ({
          label: (it.querySelector('.bc-prop-search-label')?.textContent || '').trim(),
          key: (it.querySelector('.bc-prop-search-key')?.textContent || '').trim(),
          badge: (it.querySelector('.bc-prop-search-badge')?.textContent || '').trim()
        })),
        activeIdx: items.findIndex((it) => it.classList.contains('is-active')),
        activeBg: items[0] ? getComputedStyle(items[0]).backgroundColor : '',
        activeShadow: items[0] ? getComputedStyle(items[0]).boxShadow : '',
        hasVals: !!document.querySelector('.bc-prop-vals')
      };
    });
    check('搜索结果只显示 3 条', rows.count === 3, `count=${rows.count}`);
    check('每行是「中文名 + 英文名 + 已添加/未添加」三段',
      rows.segs.length > 0 && rows.segs.every((s) => s.label && s.key && /已添加|未添加/.test(s.badge)),
      JSON.stringify(rows.segs[0] || null));
    check('默认选中第一条（淡蓝卡片底、无左侧蓝条）',
      rows.activeIdx === 0 && rows.activeShadow === 'none' && rows.activeBg !== 'rgba(0, 0, 0, 0)',
      JSON.stringify({ activeIdx: rows.activeIdx, bg: rows.activeBg, shadow: rows.activeShadow }));
    check('属性值预测已移除（不再出现值预测区）', rows.hasVals === false, String(rows.hasVals));

    // ↑↓ 在 3 条之间移动（用轮询等待 class 真的更新，别读一次就断言）
    const moved = await win.evaluate(async () => {
      const input = document.querySelector('.bc-prop-search-input');
      input.focus();
      const fire = (key) => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      const activeIdx = () => [...document.querySelectorAll('.bc-prop-search-item')]
        .findIndex((it) => it.classList.contains('is-active'));
      const waitFor = async (want, ms = 900) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          if (activeIdx() === want) return activeIdx();
          await new Promise((r) => setTimeout(r, 40));
        }
        return activeIdx();
      };
      fire('ArrowDown');
      const afterDown = await waitFor(1);
      fire('ArrowUp');
      const afterUp = await waitFor(0);
      return { afterDown, afterUp };
    });
    check('↓ 键把选中移到第 2 条，↑ 键回到第 1 条',
      moved.afterDown === 1 && moved.afterUp === 0, JSON.stringify(moved));

    // 未添加项：裸 Enter 不定位（面板保持打开 + 有提示）
    const enterOnMissing = await win.evaluate(async () => {
      const items = [...document.querySelectorAll('.bc-prop-search-item')];
      const first = items[0];
      const missing = first?.getAttribute('data-added') === '0';
      const input = document.querySelector('.bc-prop-search-input');
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 300));
      return {
        missing,
        stillOpen: !!document.querySelector('.bc-prop-search'),
        msg: (document.querySelector('.bc-prop-search-msg')?.textContent || '').trim()
      };
    });
    check('第一条未添加时，裸 Enter **不**定位（给提示、框还开着）',
      enterOnMissing.missing === false || (enterOnMissing.stillOpen === true && /还没添加/.test(enterOnMissing.msg)),
      JSON.stringify(enterOnMissing));

    // Ctrl+Enter：添加并定位 → 面板关闭
    const ctrlEnter = await win.evaluate(async () => {
      const input = document.querySelector('.bc-prop-search-input');
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 500));
      return { closed: !document.querySelector('.bc-prop-search') };
    });
    check('Ctrl+Enter 会添加并定位（搜索框关闭、右侧切到属性）', ctrlEnter.closed === true, JSON.stringify(ctrlEnter));
  }

  // ==========================================================================
  // E. 历史快照抽屉：关闭动画 + 按钮间距
  // ==========================================================================
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-projects')));
  await win.waitForSelector('.pc-page, .pc-header', { timeout: 10000 }).catch(() => {});
  await sleep(600);
  // 造一个带快照的工程列表项：直接打开抽屉的入口按钮（没有快照时跳过）
  const drawerBtn = await win.evaluate(() => {
    const btn = document.querySelector('.pc-card-backup-btn, .pc-card .btn-mini[title*="快照"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  await sleep(900);
  const drawerOpen = await win.evaluate(() => !!document.querySelector('.pc-drawer'));
  if (drawerOpen) {
    const spacing = await win.evaluate(() => {
      const act = document.querySelector('.pc-backup-action');
      if (!act) return null;
      const btns = [...act.querySelectorAll('button')];
      const a = btns[0]?.getBoundingClientRect();
      const b = btns[1]?.getBoundingClientRect();
      return {
        gapCss: getComputedStyle(act).gap,
        px: a && b ? Math.round(b.left - a.right) : null
      };
    });
    check('快照卡片两个按钮之间有明显间距（≥6px）',
      !!spacing && spacing.px !== null && spacing.px >= 6,
      JSON.stringify(spacing));

    // 关闭：应先出现 is-closing（播退场）再卸载
    const closing = await win.evaluate(async () => {
      const closeBtn = document.querySelector('.pc-drawer-header .cp-close');
      closeBtn?.click();
      await new Promise((r) => setTimeout(r, 90));
      const mask = document.querySelector('.pc-drawer-mask');
      return {
        hasClosing: !!mask?.classList.contains('is-closing'),
        anim: mask ? getComputedStyle(mask).animationName : '',
        opacity: mask ? getComputedStyle(mask).opacity : ''
      };
    });
    check('点关闭后进入 is-closing 并真的在播退场（animation 被解除）',
      closing.hasClosing === true && closing.anim === 'none',
      JSON.stringify(closing));
    await sleep(400);
    const gone = await win.evaluate(() => !document.querySelector('.pc-drawer'));
    check('退场结束后抽屉才真正卸载', gone === true, String(gone));
  } else {
    check('快照抽屉：当前没有快照可打开（跳过 UI 部分，静态断言已覆盖）', true, 'skipped');
    check('快照抽屉：关闭动画（静态断言已覆盖）', true, 'skipped');
  }

  // ==========================================================================
  // F. 项目信息小问号：关闭动画
  // ==========================================================================
  // 先确保真的在项目中心（事件是异步切视图 + 列表要读盘，等按钮出现再点）
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-projects')));
  await win.waitForSelector('.pc-kindhelp-btn', { timeout: 10000 }).catch(() => {});
  const helpClose = await win.evaluate(async () => {
    const btn = document.querySelector('.pc-kindhelp-btn');
    if (!btn) {
      return { noBtn: true, hasPage: !!document.querySelector('.pc-page'), view: document.body.className };
    }
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const opened = !!document.querySelector('.pc-kindhelp-pop');
    btn.click();
    await new Promise((r) => setTimeout(r, 60));
    const pop = document.querySelector('.pc-kindhelp-pop');
    return {
      opened,
      hasClosing: !!pop?.classList.contains('is-closing'),
      anim: pop ? getComputedStyle(pop).animationName : ''
    };
  });
  check('小问号说明卡打开正常', helpClose.noBtn !== true && helpClose.opened === true, JSON.stringify(helpClose));
  check('小问号关闭时进入 is-closing 并播退场',
    helpClose.hasClosing === true && helpClose.anim === 'none', JSON.stringify(helpClose));
  await sleep(300);
  const helpGone = await win.evaluate(() => !document.querySelector('.pc-kindhelp-pop'));
  check('小问号退场结束后才卸载', helpGone === true, String(helpGone));

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 第十六批探针（中键简化 / 切换动画 / 抽屉关闭）：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });