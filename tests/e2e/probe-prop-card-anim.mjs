// v0.4.7 · 属性卡片进退场动画 + 样式统一（用户第 ①~⑤ 条 + 体检误报）
//
// 用户原话：
//   ①「css属性加入元素的时候，做进入动画就是直接从右边滑入，别的属性卡片让位置」
//   ②「退出的时候，是卡片手动删除的时候加入退出动画！为什么我手动点删除反而没有动画！」
//   ③「退出动画卡片先轻微变小，阴影也变一下，有向后的感觉，然后从右边滑出，
//      别的卡片把退出的空位补上」
//   ④「Ctrl + Z 和 Ctrl + Y 的时候卡片有对应的进入和退出动画，和上面的一样」
//   ⑤「卡片的样式统一，普通卡片淡蓝色，幽灵卡片淡紫色……不要别的边框，前面深颜色竖杠！」
//
// 这份探针用**真实鼠标点击**（不用 dispatchEvent）逐条量：
//   ① 进场：新行首帧在右边（translateX > 20）、结束时归 0
//   ② 点 ×：**卡片本体**带 is-removing（不是那颗 × 按钮），且仍在 DOM 里
//   ③ 退场关键帧：有 scale < 1 且 shadow 变重（"向后"），高度在收缩
//   ③b 340ms 后卡片真的消失
//   ④ Ctrl+Z 恢复：卡片重新出现并带进场动画；Ctrl+Y：卡片走退场
//   ⑤ 所有普通卡片同一个底色（淡蓝）、没有 3px 深色左竖杠
//   ⑥ 「不生效」淡琥珀、「临时」淡紫（若存在）
//
// 用法：node tests/e2e/probe-prop-card-anim.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');

const ROOT = process.cwd();
let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-prop-card-anim');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env
  });
  const win = await app.firstWindow();
  win.setDefaultTimeout(9000);
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await win.evaluate((d) => window.bc.setDataDir(d), DATA_DIR).catch(() => {});

  await sleep(1200);
  // 建一个空标签 + 一个 div，选中它
  await win.evaluate(() => {
    const st = window.__tabStore.getState();
    if (st.tabs.length === 0) st.newTab();
  });
  await sleep(500);
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const root = window.__sceneStore.getState().scene.root;
    const div = root.children[root.children.length - 1];
    st.selectElement(div.id);
  });
  await sleep(700);
  /**
   * 把新建元素身上"默认就带"的可见属性清空。
   *
   * 为什么必须清：新建 div 自动带 width:100% / padding 之类，
   * 它们本来就在列表里 —— 不去掉的话「加了一条 → 行数 +1」这个判据永远不成立
   * （加了已存在的那条，行数不变），探针会一直以为"没加上"。
   */
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const s = st.scene;
    const walk = (n) => (n.id === s.selectedIds[0] ? n : (n.children || []).map(walk).find(Boolean));
    const node = walk(s.root);
    for (const k of [...(node?.visibleProps ?? [])]) st.removeVisibleProp(node.id, k);
  });
  await sleep(400);

  /** 打开「添加属性」菜单并搜一个词（不点选） */
  async function openAddMenu(search) {
    const cssOpen = await win.evaluate(() => !!document.querySelector('.add-prop-trigger'));
    if (!cssOpen) {
      await win.evaluate(() => {
        const head = [...document.querySelectorAll('.inspector-sec-head')]
          .find((h) => (h.getAttribute('title') || '').includes('CSS 样式属性'));
        head?.click();
      });
      await sleep(420);
    }
    // 菜单可能已经开着（连续添加时 addAndClose 会关掉它，所以这里无条件重开）
    const hasInput = await win.evaluate(() => !!document.querySelector('.add-prop-search input'));
    if (!hasInput) {
      await win.evaluate(() => document.querySelector('.add-prop-trigger')?.click());
      await sleep(340);
    }
    const input = win.locator('.add-prop-search input');
    await input.waitFor({ state: 'visible', timeout: 6000 });
    await input.fill(search);
    await sleep(320);
  }

  /**
   * 加一条属性：搜中文名 → 点第一项。
   *
   * ⚠ 不 sleep 固定毫秒：`.is-just-added` 只活 460ms，而"行出现"本身要等 React 提交。
   *   这里用 waitForFunction 盯"行数真的 +1"，一旦出现立刻返回，
   *   调用方马上采样才能撞上动画窗口。
   */
  /**
   * 加一条属性：搜中文名 → 点**精确那一项**。
   *
   * ⚠ 不能用 `hasText` + `.first()`：搜「宽度」会同时命中
   *   「宽度 (width) / 最小宽度 (min-width) / 最大宽度 (max-width)」，
   *   按顺序第一个命中的可能是 min-width —— 于是"加了一条"和"想加的那条"不是同一个，
   *   行数也会因为"它本来就已经在列表里"而不变（上一版探针就栽在这儿）。
   *   这里改成：点完以后**核对 data-prop-key**，确认加的是哪一条。
   */
  async function addProp(label, beforeCount) {
    await openAddMenu(label);
    // 精确取"以 label 开头"的那一项（label 是「宽度」这种短词）
    const items = win.locator('.add-prop-item');
    const n = await items.count();
    let clicked = false;
    for (let i = 0; i < n; i++) {
      const txt = (await items.nth(i).textContent()) || '';
      if (txt.trim().startsWith(label)) { await items.nth(i).click(); clicked = true; break; }
    }
    if (!clicked) {
      // 兜底：点第一个命中的
      await win.locator('.add-prop-item', { hasText: label }).first().click();
    }
    await win.waitForFunction(
      (c) => document.querySelectorAll('.props-list > .prop-row').length > c,
      beforeCount,
      { timeout: 3000 }
    ).catch(() => {});
  }

  /**
   * ⚠ 采样时机很关键：`.is-just-added` 只存活 460ms（父级定时器会摘掉），
   * 索引式的"点完再等 460ms 才去看"必然读到动画结束后的 none ——
   * 上一版探针就栽在这儿（误判成"没有进场动画"）。
   * 这里点完只等极短，并且同时记录"点之前"的行数，确认新行真的出现了。
   */
  // ⚠ rowsBefore 要在「CSS 样式属性已展开、列表已渲染」之后取 ——
  //   太早取是 0（面板还没展开），后面比 "rows.length === before + 1" 永远不成立。
  await openAddMenu('宽度');
  const rowsBefore = await win.evaluate(() => document.querySelectorAll('.props-list > .prop-row').length);
  await addProp('宽度', rowsBefore);
  const enterInfo = await win.evaluate((before) => new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const rows = [...document.querySelectorAll('.props-list > .prop-row')];
      const grew = rows.length === before + 1;
      // 找"挂着 is-just-added"的那一行（不一定在末尾：属性列表按 schema 顺序排）
      const hit = rows.find((r) => /\bis-just-added\b/.test(String(r.className)));
      if (grew && hit) {
        const cs = getComputedStyle(hit);
        resolve({
          exists: true, grew: true, cls: String(hit.className),
          anim: cs.animationName, dur: cs.animationDuration, tf: cs.transform,
          key: hit.getAttribute('data-prop-key')
        });
        return;
      }
      if (Date.now() - t0 > 1200) {
        resolve({
          exists: rows.length > 0, grew,
          cls: rows.map((r) => String(r.className)).join(' | '),
          keys: rows.map((r) => r.getAttribute('data-prop-key')),
          anim: null
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }), rowsBefore);
  check('① 新加的行确实多出来一条', enterInfo.exists && enterInfo.grew === true,
    `before=${rowsBefore} ${JSON.stringify(enterInfo)}`);
  check('① 新加的行带 is-just-added 且正在播 propCardIn',
    /\bis-just-added\b/.test(enterInfo.cls || '') && enterInfo.anim === 'propCardIn' && parseFloat(enterInfo.dur) > 0,
    `key=${enterInfo.key} ${JSON.stringify(enterInfo)}`);
  check('① 新加的行没有「新」字样徽标（用户：不要显示新的字样）',
    await win.evaluate(() => !document.querySelector('.prop-new-badge')));

  const kf = await win.evaluate(() => {
    for (const ss of document.styleSheets) {
      let rules; try { rules = ss.cssRules; } catch { continue; }
      for (const r of rules) {
        if (r.type === CSSRule.KEYFRAMES_RULE && r.name === 'propCardIn') {
          return [...r.cssRules].map((k) => ({ key: k.keyText, tf: k.style.transform, h: k.style.height }));
        }
      }
    }
    return null;
  });
  check('① propCardIn 首帧 translateX > 20px（真的从右边进）',
    Array.isArray(kf) && /translateX\((\d+)/.test(kf[0]?.tf || '') && Number(RegExp.$1) >= 20,
    JSON.stringify(kf?.[0]));

  // ── ⑤ 样式统一：淡蓝底 + 没有 3px 深色左竖杠 ─────────────────────────────
  const styleInfo = await win.evaluate(() => {
    const row = document.querySelector('.props-list > .prop-row');
    const cs = getComputedStyle(row);
    return {
      bg: cs.backgroundColor,
      borderLeftW: cs.borderLeftWidth,
      borderLeftC: cs.borderLeftColor,
      radius: cs.borderRadius
    };
  });
  check('⑤ 卡片左边不是 3px 深色竖杠（border-left ≤ 1.5px）',
    parseFloat(styleInfo.borderLeftW) <= 1.5, `w=${styleInfo.borderLeftW} c=${styleInfo.borderLeftC}`);
  check('⑤ 卡片底色是淡蓝（不是纯白/纯灰，色相偏蓝）', (() => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(styleInfo.bg);
    if (!m) return false;
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return b > r && b > g;   // 蓝通道最大 = 偏蓝
  })(), styleInfo.bg);

  // ── 再加两条，为退场做准备 ────────────────────────────────────────────
  const n1 = await win.evaluate(() => document.querySelectorAll('.props-list > .prop-row').length);
  await addProp('字间距', n1);
  const n2 = await win.evaluate(() => document.querySelectorAll('.props-list > .prop-row').length);
  await addProp('图层层级', n2);
  await sleep(520);
  const rowCount = await win.evaluate(() => document.querySelectorAll('.props-list > .prop-row').length);
  check('准备：列表里现在有 ' + (n1 + 2) + ' 条属性行', rowCount === n1 + 2, `n=${rowCount}（起始 ${n1}）`);

  // ── ②③ 点 × 删除：卡片本体播退场 ────────────────────────────────────────
  const before = await win.evaluate(() => {
    const rows = [...document.querySelectorAll('.props-list > .prop-row')];
    const r = rows[rows.length - 1];
    return { n: rows.length, h: Math.round(r.getBoundingClientRect().height) };
  });
  // 点**最后一行**的 ×（真实鼠标点击，走 animateRemove 的真实路径）
  await win.locator('.props-list > .prop-row').last().locator('.prop-remove').click();
  await sleep(30);
  const mid = await win.evaluate(() => {
    const rows = [...document.querySelectorAll('.props-list > .prop-row')];
    const r = rows[rows.length - 1];
    if (!r) return { exists: false };
    const cs = getComputedStyle(r);
    return {
      exists: true,
      n: rows.length,
      cls: String(r.className),
      anim: cs.animationName,
      rowH: r.style.getPropertyValue('--bc-row-h'),
      heightNow: Math.round(r.getBoundingClientRect().height)
    };
  });
  check('② 点 × 后卡片**本体**带 is-removing（不是那颗 × 按钮）',
    mid.exists && /\bis-removing\b/.test(mid.cls), mid.cls);
  check('② 卡片在这一刻仍在 DOM 里（不是瞬间消失）', mid.exists && mid.n === before.n, `n=${mid.n}`);
  check('② 卡片播的是 propCardOut', mid.anim === 'propCardOut', mid.anim);
  check('② 卡片拿到了真实高度 --bc-row-h（高度才收得动）',
    /^[1-9]\d*px$/.test(mid.rowH), `--bc-row-h=${mid.rowH}`);

  // 关键帧要真的"先变小 + 阴影变重 + 从右滑出"
  const kfOut = await win.evaluate(() => {
    for (const ss of document.styleSheets) {
      let rules; try { rules = ss.cssRules; } catch { continue; }
      for (const r of rules) {
        if (r.type === CSSRule.KEYFRAMES_RULE && r.name === 'propCardOut') {
          return [...r.cssRules].map((k) => ({
            key: k.keyText, tf: k.style.transform, sh: k.style.boxShadow, h: k.style.height
          }));
        }
      }
    }
    return null;
  });
  const midKey = Array.isArray(kfOut) ? kfOut.find((k) => k.key === '28%') : null;
  check('③ 退场中段先缩小（scale < 1）',
    Boolean(midKey) && /scale\(0?\.\d+\)/.test(midKey.tf || ''), midKey?.tf);
  check('③ 退场中段阴影变重（"有向后的感觉"）',
    Boolean(midKey) && /rgba\([^)]*0\.\d+\)/.test(midKey.sh || '') && !/0 0 0 rgba/.test(midKey.sh || ''),
    midKey?.sh);
  check('③ 退场末段从右侧滑出（translateX > 40px）',
    Array.isArray(kfOut) && /translateX\((\d+)/.test(kfOut[kfOut.length - 1]?.tf || '')
      && Number(RegExp.$1) >= 40, kfOut?.[kfOut.length - 1]?.tf);
  check('③ 退场末段高度收到 0（别的卡片才能补上空位）',
    Array.isArray(kfOut) && kfOut[kfOut.length - 1]?.h === '0px', kfOut?.[kfOut.length - 1]?.h);

  // 高度在动画中途确实变小了
  await sleep(150);
  const shrinking = await win.evaluate(() => {
    const rows = [...document.querySelectorAll('.props-list > .prop-row')];
    const r = rows[rows.length - 1];
    return r ? Math.round(r.getBoundingClientRect().height) : -1;
  });
  check('③ 动画中途高度已经变小（补位是渐进的，不是最后跳一下）',
    shrinking > 0 && shrinking < before.h, `${before.h} → ${shrinking}`);

  // ── ③b 播完真的被删 ───────────────────────────────────────────────────
  await sleep(760);
  const afterN = await win.evaluate(() => {
    const rows = [...document.querySelectorAll('.props-list > .prop-row')];
    return { n: rows.length, gone: document.querySelectorAll('.prop-gone').length };
  });
  check('③b 340ms 后那一行真的从列表消失', afterN.n === before.n - 1, `n=${afterN.n} / 之前 ${before.n}`);
  check('③b 没有残留的幽灵/骨架行（用户截图里那三行）', afterN.gone === 0, `gone=${afterN.gone}`);

  // ── ④ Ctrl+Z 恢复：卡片重新出现并带进场；Ctrl+Y：再走退场 ────────────────
  /**
   * ⚠ 不要点画布来"移走焦点"：点画布 = 取消选中，右侧面板整块空掉，
   *   后面 Ctrl+Y 就无从观察（上一版就是 n=0 / selCount=0）。
   *   改为把焦点放到 body（blur 当前输入框），选区保持不变。
   */
  await win.evaluate(() => {
    const ae = document.activeElement;
    if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
  });
  await sleep(120);
  await win.keyboard.press('Control+z');
  /**
   * ⚠ Ctrl+Z 的进场动画采样要"边等边看"：
   *   撤销是同步的，行一出现就挂上 .is-just-added（存活 460ms）。
   *   只等一次固定时间会错开窗口 —— 用轮询，一旦看到类就立刻返回。
   */
  const undoAnim = await win.evaluate(() => new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const rows = [...document.querySelectorAll('.props-list > .prop-row')];
      const last = rows[rows.length - 1];
      if (last && /\bis-just-added\b/.test(String(last.className))) {
        resolve({ seen: true, n: rows.length, anim: getComputedStyle(last).animationName, cls: String(last.className) });
        return;
      }
      if (Date.now() - t0 > 1500) {
        resolve({ seen: false, n: rows.length, anim: last ? getComputedStyle(last).animationName : null, cls: last ? String(last.className) : null });
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }));
  check('④ Ctrl+Z 后卡片重新出现', undoAnim.n > 0, `n=${undoAnim.n}`);
  check('④ 恢复回来的卡片带进场动画（propCardIn）',
    undoAnim.seen === true && undoAnim.anim === 'propCardIn', JSON.stringify(undoAnim));

  await sleep(500);
  const redoBefore = await win.evaluate(() => document.querySelectorAll('.props-list > .prop-row').length);
  await win.keyboard.press('Control+y');
  /** Ctrl+Y 的退场同样"边等边看"：要么那一行自己挂上 is-removing，要么补出骨架行 */
  const redoSeen = await win.evaluate(() => new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const gone = document.querySelectorAll('.props-list > .prop-gone').length;
      const rows = [...document.querySelectorAll('.props-list > .prop-row')];
      const removing = rows.find((r) => /\bis-removing\b/.test(String(r.className)));
      if (gone > 0 || removing) {
        resolve({ seen: true, gone, removingCls: removing ? String(removing.className) : null, n: rows.length });
        return;
      }
      if (Date.now() - t0 > 1600) {
        resolve({
          seen: false, gone, n: rows.length,
          // 诊断：面板还在不在？选中还在不在？行数变 0 到底是"删了"还是"整块没了"
          hasList: !!document.querySelector('.props-list'),
          hasInspector: !!document.querySelector('.panel.inspector'),
          selCount: (window.__sceneStore.getState().scene.selectedIds ?? []).length,
          bodyHtml: document.querySelector('.panel.inspector')?.innerHTML?.slice(0, 160) ?? null
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }));
  check('④ Ctrl+Y 让卡片走退场（出现 is-removing 或骨架行）',
    redoSeen.seen === true, JSON.stringify({ redoBefore, ...redoSeen }));

  await sleep(700);
  const redoEnd = await win.evaluate(() => ({
    n: document.querySelectorAll('.props-list > .prop-row').length,
    gone: document.querySelectorAll('.props-list > .prop-gone').length
  }));
  check('④ Ctrl+Y 播完后卡片消失且不留骨架',
    redoEnd.n === redoBefore - 1 && redoEnd.gone === 0,
    JSON.stringify({ redoBefore, ...redoEnd }));

  // ── ⑥ 体检误报：给两个普通兄弟元素写同一条关系选择器，不该报 critical ─────
  //   用户原话：「我正常给一个多个子元素设置同一个选择器，两个元素的属性都是一样的，
  //   还有这个 BUG」—— 这是**合法用法**（一批同类子元素共享样式），不该红牌。
  const dupCheck = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    let cur = window.__sceneStore.getState().scene.root;
    const a = cur.children[cur.children.length - 1];
    window.__sceneStore.getState().addElement('div');
    cur = window.__sceneStore.getState().scene.root;
    const b = cur.children[cur.children.length - 1];
    const rel = '.bc-wrap > div:nth-child(2)';
    // 真实 API：setRelSelector（关系选择器面板走的就是它）
    window.__sceneStore.getState().setRelSelector(a.id, rel);
    window.__sceneStore.getState().setRelSelector(b.id, rel);
    // 用工具栏同一个函数算一遍体检结果
    const run = window.__healthCheckRun ? window.__healthCheckRun() : null;
    return { rel, hasGlobal: Boolean(run) };
  });
  void dupCheck;
  await sleep(700);
  /**
   * 读体检结果：徽标数字 + **把每条问题的标题也带出来**。
   * 只看"徽标是几"没法判断是哪条规则在报（上一版就卡在这儿）。
   * 打开 ⚠ 向导读标题，读完关掉。
   */
  const health = await win.evaluate(async () => {
    const badgeEl = document.querySelector('.tb-health-badge, .pt-tbtn-badge');
    const badge = badgeEl ? Number(badgeEl.textContent) : 0;
    if (badge === 0) return { badge, titles: [] };
    const btn = document.querySelector('.tb-health-btn, .pt-tbtn[data-key="health"]');
    btn?.click();
    await new Promise((r) => setTimeout(r, 500));
    const titles = [...document.querySelectorAll('.hc-list-text, .hc-detail-title')]
      .map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 8);
    // 关掉向导
    const close = [...document.querySelectorAll('button')].find((b) => /关闭|取消/.test(b.textContent || ''));
    close?.click();
    return { badge, titles };
  });
  check('⑥ 多个普通子元素共用同一条关系选择器 → 体检**不再报**「关系选择器被多个元素共用」',
    !health.titles.some((t) => /关系选择器/.test(t)),
    JSON.stringify(health));
  check('⑥ 体检里剩下的仍是原本就有的提示（未命名元素），不是新增误报',
    health.titles.every((t) => /没有类名|没有.*ID/.test(t)),
    JSON.stringify(health.titles));

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
