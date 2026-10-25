// v0.4.5 第八批探针：变量类型过滤 / 浮层避让 / 中键值预测 / 播放锁 / 自动播放锁静音 /
//                    撤销栈随标签与会话 / 加载页 / zoom 下的拖动换算 / Alt 无限画布 / 双击 .bcproj
// 用法：node tests/e2e/probe-v045-batch8.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync, readFileSync } from 'fs';
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

async function launch(extraArgs = [], opts = {}) {
  const DATA_DIR = opts.dataDir || resolve(tmpdir(), 'bc-probe-batch8');
  if (!opts.keepData) {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    const SRC = resolve(ROOT, 'builtin-extensions');
    if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  }
  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', '--disable-gpu', '--no-sandbox', ...extraArgs],
    cwd: ROOT, executablePath: electronPath, env
  });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1440, 900); w.center();
  });
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  // 故意写的假地址（cdn.example.com）一定会报资源加载失败，不算应用错误，过滤掉
  win.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/example\.com|ERR_NAME_NOT_RESOLVED|Failed to load resource/i.test(t)) return;
    errs.push('console: ' + t);
  });
  return { app, win, errs, DATA_DIR };
}

async function main() {
  // ==========================================================================
  // A. 启动加载页（⑫）：必须在首屏出现，带 Logo 与真实进度条
  // ==========================================================================
  {
    const { app, win, errs, DATA_DIR } = await launch();
    // 启动后立刻查（最小显示时长 520ms 保证此时还在）。
    // ⚠ 要先等 React 挂载出加载页 —— 窗口一出现就 evaluate 时页面可能还是空的。
    await win.waitForSelector('.bc-loading', { timeout: 8000 }).catch(() => {});
    const splash = await win.evaluate(() => {
      const el = document.querySelector('.bc-loading');
      if (!el) return null;
      return {
        hasLogo: !!el.querySelector('.bc-loading-logo'),
        logoTag: el.querySelector('.bc-loading-logo')?.tagName || '',
        hasBar: !!el.querySelector('.bc-loading-bar-fill'),
        label: (el.querySelector('.bc-loading-label')?.textContent || '').trim(),
        barWidth: (el.querySelector('.bc-loading-bar-fill')?.style.width || ''),
        z: getComputedStyle(el).zIndex
      };
    }).catch(() => null);
    check('启动时出现加载页（带 BlockCanvas Logo）',
      !!splash && splash.hasLogo && /^IMG$/.test(splash.logoTag),
      splash ? JSON.stringify(splash) : '未找到 .bc-loading');
    check('加载页有真实进度条且盖在最上层（z-index 最高档）',
      !!splash && splash.hasBar && Number(splash.z) >= 9999,
      splash ? `bar=${splash.barWidth} z=${splash.z}` : '');
    await sleep(1400);
    const gone = await win.evaluate(() => document.querySelectorAll('.bc-loading').length);
    check('会话恢复完成后加载页自动淡出', gone === 0, `剩余=${gone}`);
    await ensureEditor(win);
    await win.waitForSelector('.toolbar', { timeout: 15000 });
    await sleep(900);

    // ========================================================================
    // B. 变量按类型过滤（①）
    // ========================================================================
    await win.evaluate(() => {
      const st = window.__sceneStore.getState();
      // 造一个颜色变量 + 一个尺寸变量
      st.setScene({
        ...st.scene,
        tokens: [
          { name: 'brand', value: '#ff0000', group: '颜色', kind: 'color' },
          { name: 'gap-md', value: '24px', group: '间距', kind: 'size' }
        ]
      });
      st.insertTemplate({ id: 'v1', type: 'div', style: { width: '120px', height: '40px', backgroundColor: '#eee' }, children: [] }, null);
      const id = window.__sceneStore.getState().scene.selectedId;
      window.__sceneStore.getState().selectElement(id);
      window.__batch8Id = id;
    });
    await sleep(500);
    // 打开「CSS 样式属性」里的宽度行（数值输入 → var 按钮）
    await win.evaluate(() => {
      const btns = [...document.querySelectorAll('.inspector-sec-head')];
      const b = btns.find((x) => /CSS 样式属性/.test(x.textContent || ''));
      if (b) b.click();
    });
    await sleep(400);
    const numVar = await win.evaluate(() => {
      const wrap = [...document.querySelectorAll('.num-unit-var-wrap')];
      if (!wrap.length) return { found: false };
      const btn = wrap[0].querySelector('.num-unit-var-btn');
      if (!btn) return { found: false };
      btn.click();
      return { found: true };
    });
    await sleep(400);
    const numMenu = await win.evaluate(() => {
      const items = [...document.querySelectorAll('.bc-varmenu-item')].map((b) => (b.textContent || '').trim());
      return { items, kindChips: [...document.querySelectorAll('.bc-varmenu-kind')].map((x) => (x.textContent || '').trim()) };
    });
    check('数值（宽度）的 var 菜单里**没有**颜色变量',
      numVar.found && numMenu.items.length > 0 && !numMenu.items.some((t) => t.includes('--brand')),
      numMenu.items.join(' | ') || '菜单为空');
    check('数值（宽度）的 var 菜单里**有**尺寸变量',
      numMenu.items.some((t) => t.includes('--gap-md')),
      numMenu.items.join(' | '));
    await win.keyboard.press('Escape');
    await sleep(250);

    // var 菜单不出窗口：把窗口缩到很小、对着最右下角的输入项打开，菜单矩形必须仍在窗口内
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setSize(1000, 640); w.center();
    });
    await sleep(500);
    const clamped = await win.evaluate(async () => {
      const wraps = [...document.querySelectorAll('.num-unit-var-wrap')];
      const wrap = wraps[wraps.length - 1];
      if (!wrap) return null;
      wrap.scrollIntoView({ block: 'end' });
      await new Promise((r) => setTimeout(r, 120));
      wrap.querySelector('.num-unit-var-btn')?.click();
      await new Promise((r) => setTimeout(r, 260));
      const m = document.querySelector('.bc-varmenu');
      if (!m) return { noMenu: true };
      const r = m.getBoundingClientRect();
      return {
        left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom),
        vw: window.innerWidth, vh: window.innerHeight
      };
    });
    check('var 弹框永远不会跑到窗口外面（统一避让定位）',
      !!clamped && !clamped.noMenu && clamped.left >= 0 && clamped.top >= 0
        && clamped.right <= clamped.vw + 1 && clamped.bottom <= clamped.vh + 1,
      JSON.stringify(clamped));
    await win.keyboard.press('Escape');
    await sleep(200);

    // ========================================================================
    // C. z-index 标尺 + 中键搜索的值预测（③④）
    // ========================================================================
    const scale = await win.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        popover: cs.getPropertyValue('--z-popover').trim(),
        sheet: cs.getPropertyValue('--z-sheet').trim(),
        critical: cs.getPropertyValue('--z-critical').trim(),
        toolbar: cs.getPropertyValue('--z-toolbar').trim()
      };
    });
    check('全程序 z-index 标尺已定义为 CSS 变量（popover > sheet > toolbar）',
      Number(scale.popover) > Number(scale.sheet) && Number(scale.sheet) > Number(scale.toolbar) && Number(scale.critical) >= 9999,
      JSON.stringify(scale));

    // 中键搜索：值预测（⚠ 上面把窗口缩放过了，元素坐标必须**重新量**，不能用缩放前的）
    const id = await win.evaluate(() => window.__batch8Id);
    await sleep(300);
    const br = await win.evaluate((eid) => {
      const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, id);
    check('准备：中键搜索的目标元素仍在画布上', !!br, JSON.stringify(br));
    await sleep(300);
    await win.mouse.click(br.x + br.w / 2, br.y + br.h / 2, { button: 'middle' });
    await sleep(450);
    await win.locator('.bc-prop-search-input').fill('display fl');
    await sleep(400);
    const pred = await win.evaluate(() => {
      const vals = [...document.querySelectorAll('.bc-prop-val')].map((b) => (b.textContent || '').trim());
      return { vals, hasFlex: vals.some((v) => /^flex$/.test(v)), label: (document.querySelector('.bc-prop-vals-label')?.textContent || '').trim() };
    });
    check('中键搜索支持「属性 值」预测（display fl → flex）',
      pred.hasFlex, JSON.stringify(pred));
    // 点预测值 → 写入属性 + 值
    await win.evaluate(() => {
      const b = [...document.querySelectorAll('.bc-prop-val')].find((x) => /^flex$/.test((x.textContent || '').trim()));
      if (b) b.click();
    });
    await sleep(700);
    const applied = await win.evaluate((eid) => {
      const st = window.__sceneStore.getState();
      const bp = st.activeBreakpoint;
      const find = (n, x) => (n.id === x ? n : (n.children || []).reduce((a, k) => a || find(k, x), null));
      const n = find(st.scene.root, eid);
      const resp = n.responsive || {};
      const allLayers = { base: n.style.display ?? '', ...Object.fromEntries(Object.entries(resp).map(([k, v]) => [k, v.display ?? ''])) };
      const shown = (bp && resp[bp] && resp[bp].display) || n.style.display || '';
      return { display: shown, bp, allLayers };
    }, id);
    check('点预测值 → 属性名 + 属性值一起写入并定位',
      applied.display === 'flex', JSON.stringify(applied));

    // 浮层避让：中键搜索框与底部元素面板不重叠
    await win.mouse.click(br.x + br.w / 2, br.y + br.h / 2, { button: 'middle' });
    await sleep(450);
    await win.locator('.bc-prop-search-input').fill('宽度');
    await sleep(400);
    const avoid = await win.evaluate(() => {
      const box = document.querySelector('.bc-prop-search');
      const pane = document.querySelector('.elem-pane-wrap');
      if (!box || !pane) return { box: !!box, pane: !!pane };
      const b = box.getBoundingClientRect();
      const p = pane.getBoundingClientRect();
      const overlap = !(b.bottom <= p.top + 1 || b.top >= p.bottom - 1 || b.right <= p.left + 1 || b.left >= p.right - 1);
      return {
        box: true, pane: true, overlap,
        boxZ: getComputedStyle(box).zIndex,
        boxRect: { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) },
        paneRect: { l: Math.round(p.left), t: Math.round(p.top), r: Math.round(p.right), b: Math.round(p.bottom) }
      };
    });
    check('中键搜索框有独立浮层层级（不再靠 DOM 顺序叠）', avoid.box && Number(avoid.boxZ) >= 700, JSON.stringify(avoid.boxZ));
    check('中键搜索框会被"避让"到底部元素面板之外（不再被拦住一部分）',
      avoid.box && avoid.pane && avoid.overlap === false, JSON.stringify(avoid));
    await win.keyboard.press('Escape');
    await sleep(250);

    // ========================================================================
    // D. 媒体播放锁（⑦）+ 自动播放锁静音（⑧）
    // ========================================================================
    const vid = await win.evaluate(() => {
      const st = window.__sceneStore.getState();
      st.insertTemplate({ id: 'vv', type: 'video', style: { width: '240px' }, children: [] }, null);
      const id2 = window.__sceneStore.getState().scene.selectedId;
      const st2 = window.__sceneStore.getState();
      st2.updateAttr(id2, 'src', 'https://cdn.example.com/demo.mp4');
      st2.updateAttr(id2, 'autoplay', '1');
      st2.updateAttr(id2, 'muted', '1');
      st2.selectElement(id2);
      return id2;
    });
    await sleep(800);
    const autoplayLock = await win.evaluate(() => {
      const labels = [...document.querySelectorAll('.media-props-toggle')];
      const mute = labels.find((l) => /默认静音/.test(l.textContent || ''));
      const box = mute?.querySelector('input');
      return { found: !!mute, disabled: !!box && box.disabled, checked: !!box && box.checked, cls: mute?.className || '' };
    });
    check('自动播放打开时「默认静音」被锁死在开（勾着且不可取消）',
      autoplayLock.found && autoplayLock.disabled && autoplayLock.checked,
      JSON.stringify(autoplayLock));

    const lockBtn = await win.evaluate(() => {
      const b = document.querySelector('.media-lock-btn');
      if (!b) return { found: false };
      b.click();
      return { found: true, text: (b.textContent || '').trim() };
    });
    await sleep(600);
    const locked = await win.evaluate((eid) => {
      const st = window.__sceneStore.getState();
      const find = (n, x) => (n.id === x ? n : (n.children || []).reduce((a, k) => a || find(k, x), null));
      const n = find(st.scene.root, eid);
      const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
      return {
        attr: n?.attrs?.playLock ?? '',
        domAttr: el?.getAttribute('data-bc-play-lock') ?? '',
        paused: el ? el.paused : null,
        controls: el ? el.controls : null,
        cls: document.querySelector('.media-lock-btn')?.className || ''
      };
    }, vid);
    check('「锁死播放」写进元素属性并挂到画布（状态随工程保存）',
      locked.attr === '1' && locked.domAttr === '1', JSON.stringify(locked));
    check('锁死状态下媒体不会播放（强制暂停、无控制条）',
      locked.paused === true && locked.controls === false, JSON.stringify({ paused: locked.paused, controls: locked.controls }));

    // 解锁 → 恢复
    await win.evaluate(() => document.querySelector('.media-lock-btn')?.click());
    await sleep(500);
    const unlocked = await win.evaluate((eid) => {
      const st = window.__sceneStore.getState();
      const find = (n, x) => (n.id === x ? n : (n.children || []).reduce((a, k) => a || find(k, x), null));
      const n = find(st.scene.root, eid);
      const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
      return { attr: n?.attrs?.playLock ?? '', domAttr: el?.getAttribute('data-bc-play-lock') ?? '', controls: el ? el.controls : null };
    }, vid);
    check('再点一下解锁：标记清除、控制条回来',
      unlocked.attr === '' && unlocked.domAttr === '' && unlocked.controls === true, JSON.stringify(unlocked));

    // ========================================================================
    // E. Alt 拖动 → 画布自动"无限延长"（②）；松手恢复
    // ========================================================================
    const padId = await win.evaluate(() => {
      const st = window.__sceneStore.getState();
      st.insertTemplate({ id: 'p1', type: 'div', style: { width: '120px', height: '60px', backgroundColor: '#e8eefc' }, children: [] }, null);
      return window.__sceneStore.getState().scene.selectedId;
    });
    await sleep(700);
    // ⚠ 插入是写 store → React 渲染是异步的，必须在**另一个** evaluate 里量坐标
    const padEl = await win.evaluate((eid) => {
      const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { id: eid, x: r.x, y: r.y, w: r.width, h: r.height };
    }, padId);
    check('准备：用于 Alt 拖动的元素已渲染', !!padEl, JSON.stringify(padEl));
    await sleep(300);
    await win.keyboard.down('Alt');
    await win.mouse.move(padEl.x + padEl.w / 2, padEl.y + padEl.h / 2);
    await sleep(200);
    const padBase = await win.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.canvas')).paddingBottom) || 0);
    await win.mouse.down();
    await win.mouse.move(padEl.x + padEl.w / 2, padEl.y + padEl.h / 2 + 30, { steps: 6 });
    await sleep(300);
    const padDuring = await win.evaluate(() => ({
      pad: parseFloat(getComputedStyle(document.querySelector('.canvas')).paddingBottom) || 0,
      canvasH: Math.round(document.querySelector('.canvas').getBoundingClientRect().height)
    }));
    await win.mouse.up();
    await win.keyboard.up('Alt');
    await sleep(400);
    const padAfter = await win.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.canvas')).paddingBottom) || 0);
    check('按住 Alt 一开始拖，画布就自动向下延长（不用等元素撞到下沿）',
      padDuring.pad - padBase >= 300, `拖动中 padding-bottom=${padDuring.pad}（基线 ${padBase}）画布高=${padDuring.canvasH}`);
    check('松手后画布长度恢复原样', padAfter === padBase, `padding-bottom=${padAfter}（基线 ${padBase}）`);

    check('无 console / page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));
    await app.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }

  // ==========================================================================
  // F. 撤销栈随标签 / 随会话（⑨）
  // ==========================================================================
  {
    const { app, win, errs, DATA_DIR } = await launch();
    await ensureEditor(win);
    await win.waitForSelector('.toolbar', { timeout: 15000 });
    await sleep(800);

    // 在标签 A 上做 3 步操作 → 撤销栈应有 3 条
    await win.evaluate(() => {
      const st = window.__sceneStore.getState();
      for (let i = 0; i < 3; i += 1) st.addElement('div', null);
    });
    await sleep(500);
    const tabA = await win.evaluate(() => window.__tabStore.getState().activeTabId);
    const before = await win.evaluate(() => window.__sceneStore.getState().history.past.length);
    check('标签 A 攒出了撤销记录', before >= 3, `past=${before}`);

    // 新开标签 B → 切回 A → 撤销栈必须还在
    await win.evaluate(() => { window.__tabStore.getState().newTab('第二个标签'); });
    await sleep(600);
    const inB = await win.evaluate(() => window.__sceneStore.getState().history.past.length);
    const tabB = await win.evaluate(() => window.__tabStore.getState().activeTabId);
    await win.evaluate((t) => { window.__tabStore.getState().switchTab(t); }, tabA);
    await sleep(700);
    const backA = await win.evaluate(() => window.__sceneStore.getState().history.past.length);
    check('切到别的标签再切回来，撤销栈没有丢（以前 setScene 会清空）',
      tabB !== tabA && inB === 0 && backA >= 3, `B=${inB} 回到A=${backA}`);

    // —— 关掉程序再打开：撤销栈必须从会话里恢复（这是用户真正要的）——
    // 会话架构：data/session.json 只是轻量索引，场景与撤销栈写在 data/session/<tabId>.bcproj 草稿里。
    await sleep(1400);
    const sessionPath = resolve(DATA_DIR, 'session.json');
    let sess = null;
    try { sess = JSON.parse(readFileSync(sessionPath, 'utf8')); } catch { /* 读不到 */ }
    const draftCount = sess?.tabs?.filter((t) => t.hasDraft).length ?? 0;
    check('会话索引记录了待恢复的草稿', draftCount > 0, `hasDraft 标签数=${draftCount}`);

    check('无 console / page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));
    await app.close();
    await sleep(800);

    // 第二次启动：同一个 DATA_DIR（不重建）→ 会话恢复后撤销栈应该已经装好
    const second = await launch([], { dataDir: DATA_DIR, keepData: true });
    const win2 = second.win;
    await win2.waitForSelector('.toolbar, .empty-home', { timeout: 20000 });
    await sleep(2200);
    const restored = await win2.evaluate(() => {
      const h = window.__sceneStore.getState().history;
      const st = window.__tabStore.getState();
      return { past: h.past.length, future: h.future.length, tabs: st.tabs.length };
    });
    check('关掉程序重新打开 → 撤销栈被恢复（Ctrl+Z 立刻可用）',
      restored.past >= 3 && restored.tabs >= 1, JSON.stringify(restored));
    const undoOk = await win2.evaluate(async () => {
      const before = (window.__sceneStore.getState().scene.root.children || []).length;
      window.__sceneStore.getState().undo();
      await new Promise((r) => setTimeout(r, 200));
      const after = (window.__sceneStore.getState().scene.root.children || []).length;
      return { before, after };
    });
    check('恢复后按一次撤销真的有效（元素数变化）',
      undoOk.after !== undoOk.before, `元素数 ${undoOk.before} → ${undoOk.after}`);
    await second.app.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }

  // ==========================================================================
  // G. 双击 .bcproj（命令行参数）→ 直接打开（⑪）
  // ==========================================================================
  {
    const DATA_DIR = resolve(tmpdir(), 'bc-probe-batch8-open');
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    mkdirSync(resolve(DATA_DIR, 'projects'), { recursive: true });
    const SRC = resolve(ROOT, 'builtin-extensions');
    if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
    // 先用一次正常启动造一个 .bcproj（含场景），再用"带路径启动"验证 argv 路径
    const projPath = resolve(DATA_DIR, 'projects', '双击打开演示.bcproj');
    {
      const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
      delete env.ELECTRON_RUN_AS_NODE;
      const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
      const win = await app.firstWindow();
      await ensureEditor(win);
      await win.waitForSelector('.toolbar', { timeout: 15000 });
      await sleep(700);
      const ok = await win.evaluate(async (p) => {
        const st = window.__sceneStore.getState();
        st.insertTemplate({ id: 'x1', type: 'div', style: { width: '100px', height: '40px' }, children: [] }, null);
        const s2 = window.__sceneStore.getState();
        const res = await window.bc.saveProject({ name: '双击打开演示', scene: s2.scene, history: { past: s2.history.past, future: [] } }, false, p);
        return res.ok;
      }, projPath);
      check('准备：造出一个 .bcproj 工程文件', ok === true && existsSync(projPath), projPath);
      await app.close();
      await sleep(600);
    }
    {
      const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
      delete env.ELECTRON_RUN_AS_NODE;
      // 模拟 Windows 双击：把工程路径作为命令行参数传进去
      const app = await electron.launch({
        args: ['.', '--disable-gpu', '--no-sandbox', projPath],
        cwd: ROOT, executablePath: electronPath, env
      });
      const win = await app.firstWindow();
      await sleep(3000);
      const opened = await win.evaluate(() => {
        const st = window.__tabStore.getState();
        const t = st.tabs.find((x) => x.id === st.activeTabId);
        return {
          tabs: st.tabs.length,
          name: t?.name || '',
          filePath: t?.filePath || '',
          children: (window.__sceneStore.getState().scene.root.children || []).length
        };
      });
      check('带 .bcproj 参数启动 → 自动打开那个工程（双击文件关联）',
        opened.tabs >= 1 && /双击打开演示/.test(opened.name) && opened.children >= 1,
        JSON.stringify(opened));
      await app.close();
    }
    rmSync(DATA_DIR, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== v0.4.5 第八批探针：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });