// v0.4.6 · 竖屏底部两条操作栏契约（第 43 批重构后的形态）
//
// 这一版的界面是用户逐字指定的，四条逐项量：
//   ① 第二条栏：**固定一行**、9 个按钮、按钮高度彼此一致；
//      并且**没有抽屉展开**（用户原话："整个第二条菜单本来可以展开，关闭像一个抽屉，
//      但是后面删除了，但是上方像抽屉把手的横条没有删除，删除一下"）。
//   ② 三个二级菜单（操作 / 设备 / 更多）都**贴着按钮上沿**弹出，且不溢出视口
//      （"二级菜单统一出现在按钮的上面，同时不会溢出到视口外面"）。
//   ③ 第三层「情境栏」按需出现：选中元素 → 取消选中；缩放 ≠100% → 还原大小；
//      一个按钮都没有时高度为 0（"没有固定位置，先到的先排右边"）。
//   ④ 入口「三」的菜单：fixed 定位、整块在第二条栏**上方**（不盖住工具栏）、
//      点旁边会关（"打开的二级菜单在按钮上面，不要跑到二层菜单上面"）。
//
// 用法：node tests/e2e/probe-portrait-bars.mjs
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
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-bars');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(300, 400);
    w.setContentSize(412, 860);
    w.center();
  });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1500);
  await win.waitForSelector('.pt-bar2', { timeout: 15000 });
  await sleep(400);

  // —— ① 固定单行 · 9 个按钮 · 高度一致 ——
  const bars = await win.evaluate(() => {
    const b2 = document.querySelector('.pt-bar2');
    const row = document.querySelector('.pt-bar2 .pt-toolbar');
    const btns = [...document.querySelectorAll('.pt-bar2 .pt-tbtn')];
    const hs = btns.map((b) => Math.round(b.getBoundingClientRect().height));
    const r = b2?.getBoundingClientRect();
    const rr = row?.getBoundingClientRect();
    return {
      bar2H: r ? Math.round(r.height) : 0,
      rowTop: rr ? Math.round(rr.top) : 0,
      rowH: rr ? Math.round(rr.height) : 0,
      count: btns.length,
      keys: btns.map((b) => b.getAttribute('data-key')),
      minH: hs.length ? Math.min(...hs) : 0,
      maxH: hs.length ? Math.max(...hs) : 0,
      expanded: b2?.classList.contains('is-expanded') ?? null,
      // 抽屉把手那条横条必须已经删掉
      hasHead: !!document.querySelector('.pt-bar2-head')
    };
  });
  check('① 第二条栏只有一行（栏高 ≤ 72）', bars.bar2H > 0 && bars.bar2H <= 72, `bar2=${bars.bar2H} row=${bars.rowH}`);
  check('① 固定 9 个按钮且顺序对', bars.count === 9
    && bars.keys.join(',') === 'ops,device,more,preview,outline,health,export-html,projects,export-template',
    `${bars.count} → ${bars.keys.join(',')}`);
  check('① 所有按钮高度一致（±1px）', bars.minH > 0 && bars.maxH - bars.minH <= 1, `${bars.minH}~${bars.maxH}`);
  check('① 抽屉把手横条已删除、也没有展开态', bars.hasHead === false && bars.expanded === false,
    `hasHead=${bars.hasHead} expanded=${bars.expanded}`);

  // —— ② 三个二级菜单贴按钮上沿、不溢出视口 ——
  for (const [key, label] of [['ops', '操作'], ['device', '设备'], ['more', '更多']]) {
    const btn = win.locator(`.pt-bar2 .pt-tbtn[data-key="${key}"]`);
    await btn.click();
    await sleep(320);
    const geo = await win.evaluate((k) => {
      const b = document.querySelector(`.pt-bar2 .pt-tbtn[data-key="${k}"]`);
      const m = document.querySelector('.pt-tbtn-menu');
      if (!b || !m) return { exists: false };
      const rb = b.getBoundingClientRect();
      const rm = m.getBoundingClientRect();
      return {
        exists: true,
        menuBottom: Math.round(rm.bottom),
        btnTop: Math.round(rb.top),
        top: Math.round(rm.top),
        left: Math.round(rm.left),
        right: Math.round(rm.right),
        vw: window.innerWidth,
        vh: window.innerHeight,
        items: [...m.querySelectorAll('.tb-more-item, .pt-menu-switch')].map((x) => x.textContent?.trim() ?? '')
      };
    }, key);
    // AnchoredPanel 会留 6px 视觉间距：只要在按钮上方且不悬空太远就算贴住
    check(`② 「${label}」菜单贴按钮上沿（底边在按钮顶边之上 0~12px）`,
      geo.exists && geo.btnTop - geo.menuBottom >= 0 && geo.btnTop - geo.menuBottom <= 12,
      `menuBottom=${geo.menuBottom} btnTop=${geo.btnTop}`);
    check(`② 「${label}」菜单不溢出视口`, geo.exists && geo.top >= 0 && geo.left >= 0 && geo.right <= geo.vw,
      `top=${geo.top} left=${geo.left} right=${geo.right}/${geo.vw}`);
    if (key === 'more') {
      const has = (t) => geo.items.some((x) => x.includes(t));
      check('② 「更多」里有 放大 / 缩小 / 缩放 三档且都带缩放语义',
        has('放大') && has('缩小') && has('缩放'), geo.items.join(' | '));
      check('② 「更多」里放着 Alt 模式开关', has('Alt 模式'), geo.items.slice(0, 4).join(' | '));
    }
    // 关掉菜单（点一次同一个按钮）
    await btn.click();
    await sleep(220);
  }

  // —— 放大 / 缩小真的改缩放（不只画了颗按钮） ——
  const pctOf = () => win.evaluate(() => {
    const row = [...document.querySelectorAll('.pt-tbtn-menu .tb-more-item')]
      .find((x) => (x.textContent || '').includes('缩放'));
    return row ? parseInt((row.querySelector('.pt-menu-val')?.textContent || '0'), 10) : -1;
  });
  await win.locator('.pt-bar2 .pt-tbtn[data-key="more"]').click();
  await sleep(300);
  const pct0 = await pctOf();
  await win.locator('.pt-tbtn-menu .tb-more-item', { hasText: '放大' }).click();
  await sleep(260);
  const pct1 = await pctOf();
  await win.locator('.pt-tbtn-menu .tb-more-item', { hasText: '缩小' }).click();
  await sleep(260);
  const pct2 = await pctOf();
  await win.locator('.pt-tbtn-menu .tb-more-item', { hasText: '缩小' }).click();
  await sleep(260);
  const pct3 = await pctOf();
  check('② 放大真的放大一档（100 → 125）', pct0 === 100 && pct1 === 125, `${pct0} → ${pct1}`);
  check('② 缩小能回到 100 再往下一档（125 → 100 → 75）', pct2 === 100 && pct3 === 75, `${pct2} → ${pct3}`);
  // 收尾：把缩放还原回 100，否则后面情境栏会一直多一颗「还原大小」
  await win.locator('.pt-tbtn-menu .tb-more-item', { hasText: '缩放' }).click();
  await sleep(320);

  // —— ③ 情境栏：按需出现 / 没有按钮时高度为 0 ——
  const ctxEmpty = await win.evaluate(() => {
    const c = document.querySelector('.pt-ctx');
    return { exists: !!c, h: c ? Math.round(c.getBoundingClientRect().height) : -1, n: document.querySelectorAll('.pt-ctx-btn').length };
  });
  check('③ 没有可显示的按钮时情境栏整层不渲染（不占位、不吃点击）',
    ctxEmpty.n === 0 && (!ctxEmpty.exists || ctxEmpty.h === 0),
    `exists=${ctxEmpty.exists} h=${ctxEmpty.h} n=${ctxEmpty.n}`);

  // 选中一个元素 → 出现「取消选中」
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const root = window.__sceneStore.getState().scene.root.children;
    const last = root[root.length - 1];
    if (last) window.__sceneStore.getState().selectElement(last.id);
  });
  await sleep(360);
  const ctxSel = await win.evaluate(() => {
    const c = document.querySelector('.pt-ctx');
    return {
      h: c ? Math.round(c.getBoundingClientRect().height) : -1,
      btns: [...document.querySelectorAll('.pt-ctx-btn')].map((b) => (b.textContent || '').trim())
    };
  });
  check('③ 选中元素 → 情境栏出现「取消选中」',
    ctxSel.btns.some((t) => t.includes('取消选中')), `${ctxSel.h}px → ${ctxSel.btns.join(' | ')}`);
  await win.locator('.pt-ctx-btn', { hasText: '取消选中' }).click();
  await sleep(320);
  const afterClear = await win.evaluate(() => ({
    n: document.querySelectorAll('.pt-ctx-btn').length,
    sel: window.__sceneStore.getState().scene.selectedIds.length
  }));
  check('③ 点「取消选中」→ 选区清空且按钮收回', afterClear.sel === 0 && afterClear.n === 0,
    `sel=${afterClear.sel} btns=${afterClear.n}`);

  // 缩放 ≠ 100% → 出现「还原大小」
  await win.evaluate(() => window.__sceneStore.getState && null);
  await win.locator('.pt-bar2 .pt-tbtn[data-key="more"]').click();
  await sleep(280);
  await win.locator('.pt-tbtn-menu .tb-more-item', { hasText: '放大' }).click();
  await sleep(320);
  const ctxZoom = await win.evaluate(() => ({
    btns: [...document.querySelectorAll('.pt-ctx-btn')].map((b) => (b.textContent || '').trim())
  }));
  check('③ 缩放 ≠100% → 情境栏出现「还原大小」',
    ctxZoom.btns.some((t) => t.includes('还原大小')), ctxZoom.btns.join(' | '));

  // —— ④ 入口「三」的菜单：不盖住第二条栏 ——
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.pt-bar1 .pt-btn')];
    btns[btns.length - 1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(420);
  const menu = await win.evaluate(() => {
    const el = document.querySelector('.pt-entry-menu');
    const b2 = document.querySelector('.pt-bar2');
    const b1 = document.querySelector('.pt-bar1');
    if (!el) return { exists: false };
    const r = el.getBoundingClientRect();
    const r2 = b2?.getBoundingClientRect();
    const r1 = b1?.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      exists: true,
      position: cs.position,
      bottom: Math.round(r.bottom),
      bar2Top: r2 ? Math.round(r2.top) : -1,
      bar1Top: r1 ? Math.round(r1.top) : -1,
      onTop: !!el.contains(top),
      topCls: top ? String(top.className || '').slice(0, 30) : null
    };
  });
  check('④ 入口菜单存在且是 fixed 定位', menu.exists && menu.position === 'fixed', JSON.stringify(menu));
  check('④ 菜单整块在第二条栏上方（不盖住工具栏）',
    menu.exists && menu.bottom <= menu.bar2Top + 2,
    `menuBottom=${menu.bottom} bar2Top=${menu.bar2Top}`);
  check('④ 菜单没被栏盖住（中心点命中的就是菜单自己）',
    menu.exists && menu.onTop === true, `命中=${menu.topCls}`);

  await win.evaluate(() => {
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  });
  await sleep(300);
  const closed = await win.evaluate(() => !document.querySelector('.pt-entry-menu'));
  check('④ 点旁边 → 菜单关闭', closed === true, String(closed));

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
