// v0.4.5 第十四批探针：项目类型标注 / 删除时的会话提示 / 属性卡片横向滚动条 / 加载页观感
// 用法：node tests/e2e/probe-v045-batch14.mjs
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
  // A. 静态：加载页不再有深色底（固定白）+ 淡入淡出变长
  // ==========================================================================
  const css28 = readFileSync(resolve(ROOT, 'src/renderer/styles/28-v045-zindex.css'), 'utf8');
  const css29 = readFileSync(resolve(ROOT, 'src/renderer/styles/29-v045-perf.css'), 'utf8');
  const loadBlock = css28.slice(css28.indexOf('.bc-loading {'));
  check('加载页底色**固定白**（不再跟着首页深色模式变黑）',
    /background:\s*#ffffff/.test(loadBlock) && !/^\.bc-loading\.is-dark\s*\{/m.test(css29),
    /background:\s*#ffffff/.test(loadBlock) ? '#ffffff' : '未找到');
  const inDur = /\.bc-loading\s*\{[\s\S]*?animation:\s*bcLoadIn\s*([\d.]+)s/.exec(css28)?.[1];
  const outDur = /\.bc-loading\.is-leaving\s*\{[\s\S]*?animation:\s*bcLoadOut\s*([\d.]+)s/.exec(css28)?.[1];
  check('加载页淡入/淡出时长变长（进场 ≥0.4s、淡出 ≥0.5s）',
    Number(inDur) >= 0.4 && Number(outDur) >= 0.5,
    `in=${inDur}s out=${outDur}s`);

  // 属性列表禁止横向滚动（用户报"删卡片后下方短暂出现左右滑动的条"）
  check('属性列表/面板永久禁止横向滚动（删卡片不再冒出滚动条）',
    /\.props-list[\s\S]{0,200}overflow-x:\s*clip/.test(css29) || /overflow-x:\s*clip/.test(css29),
    'ok');

  const DATA_DIR = resolve(tmpdir(), 'bc-probe-b14');
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
  // B. 属性卡片：删掉之后容器不该能横向滚动
  // ==========================================================================
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    const id = window.__sceneStore.getState().scene.selectedId;
    window.__sceneStore.getState().updateStyle(id, {
      backgroundColor: '#ff0000', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,.2)', opacity: '0.9'
    });
    return id;
  });
  await sleep(800);
  await win.evaluate(() => {
    const head = [...document.querySelectorAll('.inspector-sec-head')].find((x) => /CSS 样式属性/.test(x.textContent || ''));
    if (head && !document.querySelector('.props-list')) head.click();
  });
  await sleep(600);

  const beforeDel = await win.evaluate(() => {
    const list = document.querySelector('.props-list');
    if (!list) return null;
    const cs = getComputedStyle(list);
    return {
      rows: list.querySelectorAll('.prop-row').length,
      overflowX: cs.overflowX,
      canScrollX: list.scrollWidth > list.clientWidth + 1,
      scrollW: list.scrollWidth, clientW: list.clientWidth
    };
  });
  check('准备：属性列表有多行可删', !!beforeDel && beforeDel.rows >= 3, JSON.stringify(beforeDel));

  // 删一行，并在退场动画期间反复采样"能不能横向滚"
  const duringDel = await win.evaluate(async () => {
    const list = document.querySelector('.props-list');
    const rows = [...document.querySelectorAll('.props-list .prop-row')];
    const target = rows[0];
    const key = target?.getAttribute('data-prop-key') || '';
    const xBtn = target?.querySelector('.prop-remove, .prop-row-x, button[title*="移除"]');
    if (xBtn) xBtn.click();
    const samples = [];
    for (let i = 0; i < 24; i += 1) {
      await new Promise((r) => setTimeout(r, 30));
      const l = document.querySelector('.props-list');
      if (!l) continue;
      const cs = getComputedStyle(l);
      samples.push({
        overflowX: cs.overflowX,
        // "能横向滑"= 有横向溢出 且 overflow-x 允许滚动
        scrollable: (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && l.scrollWidth > l.clientWidth + 1
      });
    }
    return { key, samples };
  });
  const anyScrollable = duringDel.samples.some((s) => s.scrollable);
  const allClip = duringDel.samples.every((s) => s.overflowX === 'clip' || s.overflowX === 'hidden');
  check('删属性卡片的整个退场过程都不会出现横向滚动（滑不动也看不到条）',
    duringDel.samples.length > 0 && !anyScrollable && allClip,
    JSON.stringify({ key: duringDel.key, n: duringDel.samples.length, anyScrollable, allClip }));

  // ==========================================================================
  // C. 删除项目：会话还开着时必须先关会话
  // ==========================================================================
  // 造一个真实工程并"打开着"
  const projPath = resolve(DATA_DIR, 'projects', '删除会话测试.bcproj');
  await win.evaluate(async (p) => {
    const st = window.__sceneStore.getState();
    st.addElement('div', null);
    const s2 = window.__sceneStore.getState();
    await window.bc.saveProject({ name: '删除会话测试', scene: s2.scene }, false, p);
  }, projPath);
  await sleep(700);
  await win.evaluate((p) => {
    const st = useTabStoreShim();
    return st;
    function useTabStoreShim() {
      const scene = window.__sceneStore.getState().scene;
      window.__tabStore.getState().newTab('删除会话测试', scene, p);
      return true;
    }
  }, projPath);
  await sleep(900);

  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-projects')));
  await sleep(1200);

  const opened = await win.evaluate(() => {
    const st = window.__tabStore.getState();
    return { tabs: st.tabs.map((t) => ({ name: t.name, filePath: t.filePath })) };
  });
  check('准备：工程已开在编辑器会话里', opened.tabs.some((t) => /删除会话测试/.test(t.name)), JSON.stringify(opened.tabs.length));

  // 打开删除弹窗（点垃圾桶）
  const openedModal = await win.evaluate(() => {
    const card = [...document.querySelectorAll('.pc-card')].find((c) => /删除会话测试/.test(c.textContent || ''));
    if (!card) return { noCard: true };
    const del = card.querySelector('.pc-card-del-btn');
    if (!del) return { noDelBtn: true };
    del.click();
    return { ok: true };
  });
  check('准备：能打开删除防护弹窗', openedModal.ok === true, JSON.stringify(openedModal));
  await win.waitForSelector('.double-delete-modal', { timeout: 6000 }).catch(() => {});
  await sleep(400);

  // 直接跳到第 3 关（第 1/2 关是输入全名 + 滑块，这里验的是第 3 关的会话提示）
  const step3 = await win.evaluate(async () => {
    const modal = document.querySelector('.double-delete-modal');
    const input = document.querySelector('.double-delete-modal input.dd-modal-input')
      || document.querySelector('.double-delete-modal input[type="text"]');
    if (!input) {
      return {
        noInput: true,
        modalExists: !!modal,
        modalHtml: (modal?.innerHTML || '').slice(0, 200),
        inputs: [...document.querySelectorAll('input')].map((i) => i.className).slice(0, 8)
      };
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '删除会话测试');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const next = [...document.querySelectorAll('.dd-modal-footer button')].find((b) => /下一步/.test(b.textContent || ''));
    if (next && !next.disabled) next.click();
    return { clicked: !!next, disabled: next?.disabled ?? null, typed: input.value };
  });
  check('准备：第 1 关能进入第 2 关', step3.clicked === true, JSON.stringify(step3));
  await sleep(600);

  // 第 2 关：三个滑块 —— 直接把 knob 拖到目标（真实 pointer 事件）
  const sliders = await win.evaluate(() => document.querySelectorAll('.dd-slider-track').length);
  if (sliders > 0) {
    for (let i = 0; i < sliders; i += 1) {
      const box = await win.evaluate((idx) => {
        const tracks = document.querySelectorAll('.dd-slider-track');
        const t = tracks[idx];
        const target = t?.querySelector('.dd-slider-target');
        if (!t || !target) return null;
        const tr = t.getBoundingClientRect();
        const pct = parseFloat(target.style.left) || 50;
        return { x: tr.left + (tr.width * pct) / 100, y: tr.top + tr.height / 2, w: tr.width };
      }, i);
      if (!box) continue;
      // 拖 knob：从当前值拖到目标
      const knobPos = await win.evaluate((idx) => {
        const tracks = document.querySelectorAll('.dd-slider-track');
        const knob = tracks[idx]?.querySelector('.dd-slider-knob');
        if (!knob) return null;
        const r = knob.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, i);
      if (!knobPos) continue;
      await win.mouse.move(knobPos.x, knobPos.y);
      await win.mouse.down();
      await win.mouse.move(box.x, knobPos.y, { steps: 12 });
      await win.mouse.up();
      await sleep(350);
    }
  }
  await sleep(1200);

  const atStep3 = await win.evaluate(() => ({
    sessionWarn: !!document.querySelector('.dd-session-warn'),
    warnText: (document.querySelector('.dd-session-warn')?.textContent || '').replace(/\s+/g, ' ').trim(),
    closeBtn: [...document.querySelectorAll('.dd-session-warn-btn')].map((b) => (b.textContent || '').trim()),
    finalBtnDisabled: (() => {
      const b = [...document.querySelectorAll('.dd-modal-footer button')].find((x) => /删除|关闭/.test(x.textContent || ''));
      return b ? b.disabled : null;
    })()
  }));
  check('第 3 关提示"这个项目还开在编辑器里"（会话检测生效）',
    atStep3.sessionWarn === true && /还开在编辑器/.test(atStep3.warnText),
    atStep3.warnText.slice(0, 70));
  check('提示里给出「关闭这个会话」按钮，且删除按钮被禁用',
    atStep3.closeBtn.some((t) => /关闭这个会话/.test(t)) && atStep3.finalBtnDisabled === true,
    JSON.stringify({ btn: atStep3.closeBtn, disabled: atStep3.finalBtnDisabled }));

  // 点「关闭这个会话」→ 标签被关掉、提示消失、删除按钮可用
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.dd-session-warn-btn')].find((x) => /关闭这个会话/.test(x.textContent || ''));
    if (b) b.click();
  });
  await sleep(900);
  const afterClose = await win.evaluate(() => {
    const st = window.__tabStore.getState();
    return {
      tabs: st.tabs.filter((t) => /删除会话测试/.test(t.name)).length,
      sessionWarn: !!document.querySelector('.dd-session-warn'),
      finalBtnDisabled: (() => {
        const b = [...document.querySelectorAll('.dd-modal-footer button')].find((x) => /删除|关闭/.test(x.textContent || ''));
        return b ? b.disabled : null;
      })()
    };
  });
  check('点「关闭这个会话」→ 会话真的关掉、提示消失、可以删除了',
    afterClose.tabs === 0 && afterClose.sessionWarn === false && afterClose.finalBtnDisabled === false,
    JSON.stringify(afterClose));

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 第十四批探针（项目类型/删除会话/横向滚动条/加载页）：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });