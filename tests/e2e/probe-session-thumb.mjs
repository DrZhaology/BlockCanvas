// ============================================================================
// v0.4.6 · 会话缩略图保真度取证
// ----------------------------------------------------------------------------
// 用法：node tests/e2e/probe-session-thumb.mjs
// 用户反馈："缩略图只有文字，没有别的元素例如 div"。
// 这条探针就是量：缩略图 iframe 里**有多少个 div 真的有底色/边框/宽高**，
// 以及"设计变量（tokens）+ childStyles"这条链路有没有真的传到缩略图里。
//
// 造的场景刻意覆盖三种样式来源：
//   ① 元素自己的内联样式（最常见的方块）
//   ② 设计变量 var(--pri)：只有 scene.tokens 传到位才有颜色
//   ③ 容器上的 childStyles（`.card h2 { … }`）：只有关系选择器生成正常才生效
// ============================================================================
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, existsSync, cpSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('PASS  ' + name + (detail ? '  → ' + detail : '')); }
  else { fail++; console.log('FAIL  ' + name + '  [' + detail + ']'); }
};

const main = async () => {
  const DATA_DIR = resolve(tmpdir(), 'bc-thumb-' + Date.now());
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push(String(e.message)));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(412, 860);
    w.center();
    w.blur();
  });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await win.waitForFunction(() => !document.querySelector('.bc-loading'), { timeout: 15000 }).catch(() => {});
  await sleep(700);

  await win.locator('.eh-actions .eh-btn', { hasText: '新建项目' }).first().click();
  await sleep(1500);

  // —— 造场景：内联样式 + 设计变量（tokens）两条链路都覆盖 ——
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    // ① 设计变量：--pri 只存在于 scene.tokens，缩略图若丢掉 tokens 就没有这块颜色
    st.setTokens([
      { name: 'pri', value: '#2f6fed', group: 'color', kind: 'color' },
      { name: 'ink', value: '#0f172a', group: 'color', kind: 'color' }
    ]);
    // ② 用变量的色块
    st.addElement('div');
    let r = window.__sceneStore.getState().scene.root;
    const hero = r.children[r.children.length - 1];
    window.__sceneStore.getState().updateStyle(hero.id, {
      width: '100%', height: '220px', background: 'var(--pri)', borderRadius: '16px'
    });
    // ③ 纯内联样式：白底 + 2px 边框 + 圆角 + 阴影（"div 有没有画出来"的主判据）
    st.addElement('div');
    r = window.__sceneStore.getState().scene.root;
    const card = r.children[r.children.length - 1];
    window.__sceneStore.getState().updateStyle(card.id, {
      width: '320px', height: '120px', background: '#ffffff', borderWidth: '2px',
      borderStyle: 'solid', borderColor: '#94a3b8', borderRadius: '12px',
      margin: '20px auto', boxShadow: '0 8px 24px rgba(0,0,0,.18)'
    });
    window.__sceneStore.getState().setText(card.id, '卡片里的字');
    // ④ 再来一块纯色，凑够三个可见块
    st.addElement('div');
    r = window.__sceneStore.getState().scene.root;
    const band = r.children[r.children.length - 1];
    window.__sceneStore.getState().updateStyle(band.id, {
      width: '100%', height: '90px', background: '#fef3c7', padding: '12px'
    });
    window.__sceneStore.getState().setText(band.id, '黄色横条');
  });
  await sleep(900);

  const sceneInfo = await win.evaluate(() => {
    const s = window.__sceneStore.getState().scene;
    return { kids: s.root.children.length, tokens: (s.tokens || []).length };
  });
  check('准备：场景有 3 个块 + 2 个设计变量', sceneInfo.kids >= 3 && sceneInfo.tokens === 2, JSON.stringify(sceneInfo));
  // —— 进会话页 ——
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.pt-bar1 .pt-btn')];
    btns[btns.length - 3]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(1600);

  const thumb = await win.evaluate(() => {
    const f = document.querySelector('.sess-thumb iframe');
    if (!f) return { err: 'no iframe' };
    const doc = f.contentDocument;
    if (!doc) return { err: 'no contentDocument' };
    const els = [...doc.querySelectorAll('div')];
    let painted = 0;
    const samples = [];
    for (const el of els) {
      const cs = doc.defaultView.getComputedStyle(el);
      const bg = cs.backgroundColor;
      const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      const hasBorder = parseFloat(cs.borderTopWidth) > 0;
      const box = el.getBoundingClientRect();
      const sized = box.width > 40 && box.height > 20;
      if ((hasBg || hasBorder) && sized) {
        painted++;
        if (samples.length < 3) samples.push({ bg, w: Math.round(box.width), h: Math.round(box.height) });
      }
    }
    document.querySelectorAll; // no-op
    return {
      divs: els.length,
      painted,
      samples,
      styleBlocks: doc.querySelectorAll('style').length,
      bodyH: Math.round(doc.body.getBoundingClientRect().height)
    };
  });
  console.log('缩略图文档：' + JSON.stringify(thumb));
  check('缩略图 iframe 真的挂上了', !thumb.err, thumb.err || 'ok');
  check('缩略图里有 ≥3 个"有底色/边框且有尺寸"的 div（不是只剩文字）',
    (thumb.painted || 0) >= 3, `painted=${thumb.painted} divs=${thumb.divs}`);
  check('设计变量生效：有一个 div 的底色是 --pri 解析出来的 #2f6fed',
    (thumb.samples || []).some((s) => /47,\s*111,\s*237/.test(s.bg)), JSON.stringify(thumb.samples));
  check('导出的 <style> 块存在（关系选择器/类规则都在里面）',
    (thumb.styleBlocks || 0) >= 1, `styles=${thumb.styleBlocks}`);

  await win.screenshot({ path: resolve(ROOT, 'tests/e2e/shots-ui-full/19-session-thumb.png') });
  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(1); });
