// v0.4.5 第九批探针：主界面颜色模式记忆 + 动画性能总督
// 用法：node tests/e2e/probe-v045-perf-anim.mjs
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-perfanim');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });
  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(900);

  // ==========================================================================
  // A. 动画总督：存在、有档位、有采样
  // ==========================================================================
  const gov = await win.evaluate(() => {
    const a = window.__bcAnim;
    return {
      exists: !!a,
      mode: a?.mode,
      override: a?.override,
      attr: document.documentElement.getAttribute('data-bc-anim'),
      hasPausedAttrFlag: document.documentElement.hasAttribute('data-bc-anim-paused')
    };
  });
  check('动画总督已启动并把档位写到 <html data-bc-anim>',
    gov.exists && ['full', 'lite', 'off'].includes(gov.mode) && gov.attr === gov.mode,
    JSON.stringify(gov));

  // ==========================================================================
  // B. 精简档：装饰性过渡被压到近乎 0（但状态类仍在）
  // ==========================================================================
  const fullDur = await win.evaluate(() => {
    const el = document.querySelector('.eh-btn');
    return el ? getComputedStyle(el).transitionDuration : '';
  });
  await win.evaluate(() => { window.__bcAnim.setMode('lite'); });
  await sleep(250);
  const lite = await win.evaluate(() => {
    const el = document.querySelector('.eh-btn');
    const cs = el ? getComputedStyle(el) : null;
    return { attr: document.documentElement.getAttribute('data-bc-anim'), dur: cs ? cs.transitionDuration : '' };
  });
  check('精简档：过渡时长被压到 0.01ms（状态视觉不受影响）',
    lite.attr === 'lite' && /0\.00001s|0\.01ms|1e-05s/.test(lite.dur),
    `完整档=${fullDur} 精简档=${lite.dur}`);

  // 关闭档：连动画都没有
  await win.evaluate(() => { window.__bcAnim.setMode('off'); });
  await sleep(250);
  const off = await win.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-bc-anim'),
    anim: getComputedStyle(document.querySelector('.eh-btn')).animationName
  }));
  check('关闭档：装饰动画彻底不跑', off.attr === 'off' && off.anim === 'none', JSON.stringify(off));

  // 手动覆盖要落到 localStorage（下次启动仍然生效）
  const stored = await win.evaluate(() => localStorage.getItem('bc-anim-mode'));
  check('手动档位被记住（下次启动仍是这个档）', stored === 'off', String(stored));

  // 回到自动
  await win.evaluate(() => { window.__bcAnim.setMode(null); });
  await sleep(300);
  const auto = await win.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-bc-anim'),
    override: window.__bcAnim.override,
    stored: localStorage.getItem('bc-anim-mode')
  }));
  check('可以切回自动档（并按系统"减少动态效果"决定 full/lite）',
    auto.override === null && auto.stored === null && ['full', 'lite'].includes(auto.attr),
    JSON.stringify(auto));

  // ==========================================================================
  // C. 窗口不可见 / 失焦 → 装饰动画暂停
  // ==========================================================================
  // v0.4.5 第 12 批：探针自己就是在**安静模式**下跑的（窗口不可激活 → hasFocus 恒为 false），
  // 而安静模式按设计**不该**把"无焦点"当失焦（否则动效会被永久冻住）。
  // 所以要验两条分支：先切到普通模式验"失焦要暂停"，再切回安静模式验"无焦点也不暂停"。
  await win.evaluate(() => {
    window.__origHasFocus = document.hasFocus.bind(document);
    window.__bcAnim.setQuiet(false);      // 模拟普通用户启动（窗口可激活）
    document.hasFocus = () => false;
    window.dispatchEvent(new Event('blur'));
  });
  await sleep(250);
  const paused = await win.evaluate(() => ({
    flag: document.documentElement.getAttribute('data-bc-anim-paused'),
    paused: window.__bcAnim.paused
  }));
  check('普通模式：窗口失焦 / 不可见时装饰动画进入暂停态（省 GPU / 电量）',
    paused.flag === '1' && paused.paused === true, JSON.stringify(paused));
  await win.evaluate(() => {
    document.hasFocus = window.__origHasFocus;
    window.dispatchEvent(new Event('focus'));
  });
  await sleep(250);
  const resumed = await win.evaluate(() => ({
    flag: document.documentElement.getAttribute('data-bc-anim-paused'),
    paused: window.__bcAnim.paused
  }));
  check('重新获得焦点后恢复播放', resumed.flag === null && resumed.paused === false, JSON.stringify(resumed));

  // 安静启动模式：窗口是"最小化 + 不可激活"的，hasFocus 恒 false。
  // 这里要验的是：**"没有焦点"本身不该被当成失焦**（否则动效会被永久冻住）。
  // 所以先把 document.hidden 固定成 false（模拟"窗口没被最小化"的情形），再看暂停标记。
  const quietBranch = await win.evaluate(() => {
    window.__origHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    window.__bcAnim.setQuiet(true);
    document.hasFocus = () => false;
    window.dispatchEvent(new Event('blur'));
    return { quiet: window.__bcAnim.quiet, paused: window.__bcAnim.paused, flag: document.documentElement.getAttribute('data-bc-anim-paused') };
  });
  check('安静启动模式：窗口"不可激活/无焦点"不会被误判成失焦（动效不会永久冻住）',
    quietBranch.quiet === true && quietBranch.paused === false && quietBranch.flag === null,
    JSON.stringify(quietBranch));
  // 但真正的最小化/隐藏仍然要暂停
  const hiddenBranch = await win.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const r = { paused: window.__bcAnim.paused, flag: document.documentElement.getAttribute('data-bc-anim-paused') };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    return r;
  });
  check('安静启动模式下真正隐藏/最小化时仍然暂停（省电那一层没丢）',
    hiddenBranch.paused === true && hiddenBranch.flag === '1', JSON.stringify(hiddenBranch));
  await win.evaluate(() => {
    window.__bcAnim.setQuiet(null);
    document.hasFocus = window.__origHasFocus;
    if (window.__origHidden) Object.defineProperty(Document.prototype, 'hidden', window.__origHidden);
  });
  await sleep(150);

  // ==========================================================================
  // D. 主界面颜色模式记忆（首帧就对，不再"等一会儿才变白"）
  // ==========================================================================
  // D1. 纯色深底：应当**同步**判定为深色（不需要等任何异步采样）
  await win.evaluate(() => {
    localStorage.setItem('bc-empty-home-bg', JSON.stringify({ kind: 'preset', value: '#101418' }));
  });
  await win.reload();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  const darkPreset = await win.evaluate(() => {
    const el = document.querySelector('.empty-home');
    return {
      isDark: !!el && el.classList.contains('is-dark-bg'),
      remembered: localStorage.getItem('bc-home-dark'),
      sig: localStorage.getItem('bc-home-dark-sig')
    };
  }).catch(() => null);
  check('深色纯色背景：首帧就是白字（同步算亮度，没有过渡期）',
    !!darkPreset && darkPreset.isDark === true, JSON.stringify(darkPreset));
  await sleep(500);
  const remembered = await win.evaluate(() => ({
    flag: localStorage.getItem('bc-home-dark'),
    sig: localStorage.getItem('bc-home-dark-sig')
  }));
  check('颜色模式被记住（下次进首页直接套用，不必重新采样）',
    remembered.flag === 'true' && /preset:#101418/.test(String(remembered.sig)),
    JSON.stringify(remembered));

  // D2. 浅色背景 → 记录成 false
  await win.evaluate(() => {
    localStorage.setItem('bc-empty-home-bg', JSON.stringify({ kind: 'preset', value: '#ffffff' }));
  });
  await win.reload();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(500);
  const light = await win.evaluate(() => ({
    isDark: document.querySelector('.empty-home')?.classList.contains('is-dark-bg'),
    flag: localStorage.getItem('bc-home-dark')
  }));
  check('浅色背景：黑字且记录为 false', light.isDark === false && light.flag === 'false', JSON.stringify(light));

  // D3. 图片背景：先按"记住的模式"出首帧，采样回来后再校正
  // 用一张**确定是白色**的 SVG（data URL 同源，可以读像素），保证"真实结果"与记忆值相反
  const img = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#ffffff"/></svg>'
  );
  await win.evaluate((src) => {
    localStorage.setItem('bc-empty-home-bg', JSON.stringify({ kind: 'image', src, dim: 0, blur: 0 }));
    // 故意记住一个"错"的判定（说是深色），验证首帧确实用了记忆值
    localStorage.setItem('bc-home-dark', 'true');
    localStorage.setItem('bc-home-dark-sig', JSON.stringify('image:' + src + ':0:0'));
  }, img);
  await win.reload();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  // ⚠ data URL 图片是**瞬间**加载完的，"记忆值那一帧"在外部观测不到，
  //   所以这里直接断言那段纯函数（window.__bcHomeDark，见 EmptyHome.tsx 的探针钩子）。
  const decide = await win.evaluate((src) => {
    const api = window.__bcHomeDark;
    if (!api) return { missing: true };
    localStorage.setItem('bc-home-dark', 'true');
    localStorage.setItem('bc-home-dark-sig', JSON.stringify('image:' + src + ':0:0'));
    const remembered = api.initialOnDark({ kind: 'image', src, dim: 0, blur: 0 });
    // 换一个没记过的背景 → 应该退回"上一次的整体模式"(仍是 true)
    localStorage.setItem('bc-home-dark-sig', JSON.stringify('image:other:0:0'));
    const fallback = api.initialOnDark({ kind: 'image', src: 'other', dim: 0, blur: 0 });
    // 纯色：同步算，浅色底 → 黑字
    const lightPreset = api.initialOnDark({ kind: 'preset', value: '#ffffff' });
    const darkPreset = api.initialOnDark({ kind: 'preset', value: '#101418' });
    return { remembered, fallback, lightPreset, darkPreset };
  }, img);
  check('图片/视频背景：首帧直接套用记住的模式（算不出来时不再先黑后白）',
    !decide.missing && decide.remembered === true && decide.fallback === true,
    JSON.stringify(decide));
  check('纯色/渐变背景：同步算亮度，第一帧就是对的',
    decide.lightPreset === false && decide.darkPreset === true, JSON.stringify(decide));
  // 采样回来后仍要校正
  await win.evaluate((src) => {
    localStorage.setItem('bc-home-dark', 'true');
    localStorage.setItem('bc-home-dark-sig', JSON.stringify('image:' + src + ':0:0'));
    window.location.reload();
  }, img);
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(1400);
  const corrected = await win.evaluate(() => ({
    isDark: document.querySelector('.empty-home')?.classList.contains('is-dark-bg'),
    flag: localStorage.getItem('bc-home-dark')
  }));
  check('采样回来后仍会校正成真实结果（记忆只是"首帧"的兜底，不是最终答案）',
    corrected.isDark === false && corrected.flag === 'false',
    JSON.stringify(corrected));

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 第九批探针（颜色模式 + 动画性能）：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });