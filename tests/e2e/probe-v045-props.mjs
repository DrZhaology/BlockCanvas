// v0.4.5 E1 验收：补齐的 CSS 属性是否真的进了属性库并能渲染成卡片
// 用法：node tests/e2e/probe-v045-props.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync } from 'fs';

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

const NEW_KEYS = {
  aspectRatio: '16 / 9',
  overflowX: 'hidden',
  overflowY: 'auto',
  clipPath: 'circle(50%)',
  mixBlendMode: 'multiply',
  isolation: 'isolate',
  backgroundAttachment: 'fixed',
  backgroundBlendMode: 'screen',
  scrollBehavior: 'smooth',
  textIndent: '2em',
  writingMode: 'vertical-rl',
  columnCount: '2'
};

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-props');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  const id = await win.evaluate((keys) => {
    const st = window.__sceneStore.getState();
    const before = new Set((st.scene.root.children || []).map((c) => c.id));
    st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    const fresh = kids.find((c) => !before.has(c.id)) || kids[kids.length - 1];
    if (!fresh) return null;
    s2.updateStyle(fresh.id, keys);
    window.__sceneStore.getState().selectElement(fresh.id);
    return fresh.id;
  }, NEW_KEYS);
  console.log('元素:', id);
  await sleep(900);

  await win.locator('.tab-btn', { hasText: '属性' }).click();
  await sleep(500);
  // 「CSS 样式属性」可能本来就是展开的 —— 先看有没有内容，没有才去点标题（否则会把它点收起）
  const ensureCssOpen = async () => {
    const open = await win.evaluate(() =>
      !!document.querySelector('.add-prop-trigger')
      || document.querySelectorAll('.prop-row[data-prop-key]').length > 0
    );
    if (open) return;
    await win.evaluate(() => {
      const btn = [...document.querySelectorAll('.inspector-sec-head')]
        .find((b) => /CSS 样式属性/.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await sleep(700);
  };
  await ensureCssOpen();

  const rows = await win.evaluate(() =>
    [...document.querySelectorAll('.prop-row[data-prop-key]')].map((r) => r.getAttribute('data-prop-key'))
  );
  const missing = Object.keys(NEW_KEYS).filter((k) => !rows.includes(k));
  check('12 个补齐的 CSS 属性都渲染成了属性卡片', missing.length === 0,
    missing.length ? `缺少：${missing.join(', ')}` : `共 ${rows.length} 张卡片`);

  // 抽查几个值是否真的写进场景并生效
  const applied = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const n = (st.scene.root.children || [])[0];
    const el = document.querySelector('.canvas [data-bc-id]');
    const cs = el ? getComputedStyle(el) : null;
    return {
      style: n ? {
        aspectRatio: n.style.aspectRatio,
        writingMode: n.style.writingMode,
        mixBlendMode: n.style.mixBlendMode,
        clipPath: n.style.clipPath
      } : null,
      computed: cs ? {
        aspectRatio: cs.aspectRatio,
        writingMode: cs.writingMode,
        mixBlendMode: cs.mixBlendMode
      } : null
    };
  });
  check('新属性值被写入场景', !!applied.style && applied.style.aspectRatio === '16 / 9',
    applied.style ? JSON.stringify(applied.style) : '无元素');
  check('新属性在画布上真实生效（computed）',
    !!applied.computed && applied.computed.writingMode === 'vertical-rl' && applied.computed.mixBlendMode === 'multiply',
    applied.computed ? JSON.stringify(applied.computed) : '无元素');

  // 注意：候选菜单 = SCHEMA 减去"该元素已有"的属性，所以上面那个元素里这 12 个
  // 已经加过、菜单里当然不会再有。换成新建的**空元素**来验证"菜单能列出它们"。
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const before = new Set((st.scene.root.children || []).map((c) => c.id));
    st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    const fresh = kids.find((c) => !before.has(c.id));
    if (fresh) s2.selectElement(fresh.id);
  });
  await sleep(800);
  await ensureCssOpen();
  const trigger = win.locator('.add-prop-trigger').first();
  if (await trigger.count()) {
    await trigger.click();
    await sleep(700);
  }
  const menuItems = await win.evaluate(() =>
    [...document.querySelectorAll('.add-prop-item-label')].map((e) => (e.textContent || '').trim())
  );
  check('添加属性菜单里能看到补齐的属性（宽高比 / 书写方向 / 分栏数）',
    menuItems.some((t) => t.includes('宽高比'))
    && menuItems.some((t) => t.includes('书写方向'))
    && menuItems.some((t) => t.includes('分栏数')),
    menuItems.length ? `菜单共 ${menuItems.length} 项` : '菜单没打开');

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });