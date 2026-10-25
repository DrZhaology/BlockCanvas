// v0.4.5 语义主题变量验收（深色插件化第 1~2 步）
// 用法：node tests/e2e/probe-v045-theme.mjs
// 验证：语义变量存在、深色下真的切换、迁移后的组件颜色来自变量（不再写死）
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-theme');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);

  const readVars = () => win.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const pick = (n) => cs.getPropertyValue(n).trim();
    return {
      surface0: pick('--surface-0'),
      surface1: pick('--surface-1'),
      line: pick('--line'),
      text1: pick('--text-1'),
      dangerTint: pick('--danger-tint'),
      danger: pick('--danger')
    };
  });

  // 浅色
  await win.evaluate(() => document.documentElement.removeAttribute('data-bc-dark'));
  await sleep(200);
  const light = await readVars();
  check('语义变量已定义（浅色）',
    !!light.surface1 && !!light.text1 && !!light.line,
    `surface-1=${light.surface1} text-1=${light.text1}`);

  // 深色
  await win.evaluate(() => document.documentElement.setAttribute('data-bc-dark', ''));
  await sleep(250);
  const dark = await readVars();
  check('切到深色后表面色真的变化',
    dark.surface0 !== light.surface0 && dark.surface1 !== light.surface1,
    `${light.surface1} → ${dark.surface1}`);
  check('切到深色后文字色真的变化',
    dark.text1 !== light.text1, `${light.text1} → ${dark.text1}`);
  check('危险色在深色下也是独立的一套（不再靠覆盖规则）',
    dark.dangerTint !== light.dangerTint && dark.danger !== light.danger,
    `danger-tint ${light.dangerTint} → ${dark.dangerTint}`);

  // 迁移示范：`.tab-close-btn:hover` 这条规则必须**引用语义变量**，不能再写死 #fee2e2。
  // （按钮默认 opacity:0、hover 才显形，Playwright 抓不到伪类状态，所以校验规则文本本身）
  const migrated = await win.evaluate(() => {
    const hits = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules = [];
      try { rules = Array.from(sheet.cssRules || []); } catch { continue; }
      for (const r of rules) {
        const txt = r.cssText || '';
        if (txt.includes('.tab-close-btn:hover')) hits.push(txt);
      }
    }
    const cs = getComputedStyle(document.documentElement);
    return {
      rule: hits[0] || '',
      count: hits.length,
      dangerTint: cs.getPropertyValue('--danger-tint').trim()
    };
  });
  check('迁移示范：关闭按钮 hover 规则改用语义变量（不再写死颜色）',
    migrated.count > 0
      && migrated.rule.includes('var(--danger-tint)')
      && !/#fee2e2|#7f1d1d/i.test(migrated.rule),
    migrated.rule.slice(0, 120) || '没找到规则');
  check('深色专用覆盖规则已删除（该按钮不再需要 data-bc-dark 分支）',
    migrated.rule !== '' && !migrated.rule.includes('data-bc-dark'),
    `匹配到 ${migrated.count} 条规则`);
  // 复原，避免影响后续探针
  await win.evaluate(() => document.documentElement.removeAttribute('data-bc-dark'));

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