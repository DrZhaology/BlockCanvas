// v0.4.5 变量系统专项验收
// 覆盖：命名自由度 / 去掉 bc 前缀 / 旧引用无感兼容 / padding 支持变量
// 用法：node tests/e2e/probe-v045-tokens.mjs
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

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-tokens');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'extensions');
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

  // 造两个变量：一个大小写+下划线混排的尺寸变量，一个颜色变量
  const setup = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.setTokens([
      { name: 'Brand_2', value: '16px', group: '间距', kind: 'size' },
      { name: 'primary', value: '#ff0000', group: '颜色', kind: 'color' }
    ]);
    const id = st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const target = id || (s2.scene.root.children || [])[(s2.scene.root.children || []).length - 1]?.id;
    if (!target) return { ok: false };
    // 新写法（无前缀）+ 旧写法（--bc-）同时验证
    s2.updateStyle(target, {
      color: 'var(--bc-primary)',        // 旧引用：必须仍然生效
      paddingTop: 'var(--Brand_2)',      // 新引用 + 混合大小写
      paddingLeft: 'var(--Brand_2)'
    });
    window.__sceneStore.getState().selectElement(target);
    return { ok: true, id: target };
  });
  console.log('准备:', JSON.stringify(setup));
  await sleep(900);

  const css = await win.evaluate(() => {
    const styles = [...document.querySelectorAll('style')].map((s) => s.textContent || '');
    return styles.find((t) => t.includes('--Brand_2') || t.includes('--bc-Brand_2')) || '';
  });

  check('新变量名不再加 bc- 前缀', /--Brand_2\s*:\s*16px/.test(css), css ? css.slice(0, 120) : '未找到注入的 :root');
  check('旧变量名 --bc-* 仍同时输出（无感兼容）', /--bc-Brand_2\s*:\s*16px/.test(css), '');
  check('名称自由度：大小写 + 下划线被接受', css.includes('--Brand_2'), '');

  const computed = await win.evaluate(() => {
    const el = document.querySelector('.canvas [data-bc-id]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { color: cs.color, paddingTop: cs.paddingTop, paddingLeft: cs.paddingLeft };
  });
  check('旧引用 var(--bc-primary) 解析正确（红色）', !!computed && computed.color === 'rgb(255, 0, 0)', computed ? computed.color : '未找到元素');
  check('新引用 var(--Brand_2) 解析正确（16px）',
    !!computed && computed.paddingTop === '16px' && computed.paddingLeft === '16px',
    computed ? `paddingTop=${computed.paddingTop} paddingLeft=${computed.paddingLeft}` : '');

  // padding 卡片的「var」入口
  await win.locator('.tab-btn', { hasText: '属性' }).click();
  await sleep(500);
  await win.evaluate(() => {
    const btn = [...document.querySelectorAll('.inspector-sec-head')]
      .find((b) => /CSS 样式属性/.test(b.textContent || ''));
    if (btn) btn.click();
  });
  await sleep(600);
  const trblVar = await win.evaluate(() => {
    const btn = document.querySelector('.trbl4-var-btn');
    if (!btn) return { exists: false };
    btn.click();
    return { exists: true };
  });
  await sleep(400);
  const menu = await win.evaluate(() => {
    const items = [...document.querySelectorAll('.trbl4-var-item')].map((b) => (b.textContent || '').trim());
    return { count: items.length, items: items.slice(0, 4) };
  });
  check('padding/margin 卡片有 var 入口', trblVar.exists, trblVar.exists ? '找到 .trbl4-var-btn' : '未找到');
  check('var 菜单列出间距类变量（不再拼单位）',
    menu.count > 0 && menu.items.some((t) => t.includes('--Brand_2')),
    menu.count > 0 ? menu.items.join(' | ') : '菜单为空');

  // 点一下菜单项：四边应写成 var(--Brand_2)，不能变成 var(--Brand_2)px
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.trbl4-var-item')].find((x) => (x.textContent || '').includes('--Brand_2'));
    if (b) b.click();
  });
  await sleep(500);
  const after = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    const n = (st.scene.root.children || []).find((c) => c.style && String(c.style.paddingTop || '').includes('var('));
    return n ? { top: n.style.paddingTop, right: n.style.paddingRight, bottom: n.style.paddingBottom, left: n.style.paddingLeft } : null;
  });
  check('四边写成纯 var() 引用（没有拼上 px）',
    !!after && after.top === 'var(--Brand_2)' && after.right === 'var(--Brand_2)'
      && after.bottom === 'var(--Brand_2)' && after.left === 'var(--Brand_2)',
    after ? JSON.stringify(after) : '未写入');

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
