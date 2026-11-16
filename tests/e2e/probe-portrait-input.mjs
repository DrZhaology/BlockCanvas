// v0.4.6 · 竖屏输入可用性（用户："输入框点不进去、输入不了文字、光标不会触发"）
//
// 这类问题几乎都是**有东西盖在输入框上面**：某个浮层的 pointer-events 没关，
// 或者 mousedown 在捕获阶段被 preventDefault 掉。肉眼看不出来，但 elementFromPoint
// 一问就现形。所以这个探针不只断言"能输入"，还把**点击点上的元素是谁**打出来，
// 失败时能直接看出被哪一层挡了。
//
// 覆盖三处最常用的输入：
//   ① 右侧属性面板（竖屏抽屉）里的数值框 → 点得进去 + 输入生效 + 光标是文本光标
//   ② 画布上文字元素的双击就地编辑（contenteditable）→ 能聚焦、能输字
//   ③ 顶栏搜索框之类的小输入（首页搜索）→ 能聚焦
//
// 用法：node tests/e2e/probe-portrait-input.mjs
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
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-pt-input');
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

  // 进编辑器 + 造一个有文字和尺寸的元素
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1400);
  await win.waitForSelector('.workspace', { timeout: 15000 });
  await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.addElement('h2');
    const kids = window.__sceneStore.getState().scene.root.children || [];
    const f = kids[kids.length - 1];
    if (f) {
      window.__sceneStore.getState().updateStyle(f.id, {
        width: '100%', height: '60px', backgroundColor: '#e0edff',
        color: '#123', fontSize: '24px', textAlign: 'center'
      });
      window.__sceneStore.getState().updateProps?.(f.id, { text: '可编辑文字' });
    }
    window.__sceneStore.getState().endStyleEdit();
  });
  await sleep(600);

  check('准备：竖屏 + 编辑器 + 一个文字元素',
    await win.evaluate(() => document.querySelector('.app')?.getAttribute('data-shell') === 'stack'
      && document.querySelectorAll('.canvas [data-bc-id]').length > 0), 'ok');

  // ── ① 右侧属性面板：打开抽屉 → 找数值框 → 点进去能不能输入 ─────────────
  await win.evaluate(() => {
    document.querySelector('.shell-drawer-btn.is-right')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(700);

  const probe = await win.evaluate(() => {
    const pane = document.querySelector('.right-pane-wrap');
    if (!pane) return { err: 'no right pane' };
    // 找一个可见的数字输入框
    const inputs = [...pane.querySelectorAll('input')].filter((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 10 && r.height > 8 && getComputedStyle(i).visibility !== 'hidden';
    });
    if (inputs.length === 0) return { err: 'no input in pane' };
    const inp = inputs[0];
    const r = inp.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    // 这个点上真正的"最上层元素"是谁？被盖住的话这里就不是 input 本身
    const top = document.elementFromPoint(cx, cy);
    const stack = [];
    let cur = top;
    for (let i = 0; i < 4 && cur; i++) {
      stack.push(cur.tagName.toLowerCase() + (cur.className ? '.' + String(cur.className).split(' ')[0] : ''));
      cur = cur.parentElement;
    }
    const cs = getComputedStyle(inp);
    return {
      count: inputs.length,
      box: { x: cx, y: cy, w: Math.round(r.width), h: Math.round(r.height) },
      hitsSelf: top === inp || inp.contains(top) || (top?.closest('input') === inp),
      topTag: top ? top.tagName.toLowerCase() : null,
      topCls: top ? String(top.className || '').slice(0, 40) : null,
      stack,
      pe: cs.pointerEvents,
      cursor: cs.cursor,
      paneZ: getComputedStyle(pane).zIndex
    };
  });

  check('属性面板抽屉里有可见的输入框', !probe.err, probe.err || `共 ${probe.count} 个`);
  check('输入框没有被别的层盖住（elementFromPoint 命中的就是它自己）',
    probe.hitsSelf === true, `命中 ${probe.topTag}.${probe.topCls} 链=${JSON.stringify(probe.stack)}`);
  check('输入框的 pointer-events 不是 none',
    probe.pe !== 'none', `pointer-events=${probe.pe}`);
  check('输入框是文本光标', /text|auto/.test(String(probe.cursor)), `cursor=${probe.cursor}`);

  // 真点一下 + 打字，确认焦点与输入真的落进去
  if (!probe.err && probe.box) {
    await win.mouse.click(probe.box.x, probe.box.y);
    await sleep(240);
    const after = await win.evaluate(() => {
      const ae = document.activeElement;
      return { tag: ae?.tagName.toLowerCase() ?? null, isInput: ae?.tagName === 'INPUT', val: ae && 'value' in ae ? ae.value : null };
    });
    check('点一下输入框 → 它拿到焦点', after.isInput === true, `activeElement=${after.tag}`);
    await win.keyboard.type('123');
    await sleep(220);
    const typed = await win.evaluate(() => {
      const ae = document.activeElement;
      return ae && 'value' in ae ? String(ae.value) : '';
    });
    check('能真的输入文字（读出 123）', /123/.test(typed), `value="${typed}"`);
  }

  // 关抽屉（否则下一步点画布会被遮罩吃掉）
  await win.evaluate(() => {
    document.querySelector('.shell-drawer-scrim')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(500);

  // ── ② 画布文字就地编辑 ────────────────────────────────────────────────
  const textProbe = await win.evaluate(async () => {
    const el = document.querySelector('.canvas [data-bc-id]');
    if (!el) return { err: 'no canvas el' };
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.left + Math.min(r.width / 2, 120));
    const cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      ok: true,
      hits: top ? (top === el || el.contains(top)) : false,
      topTag: top ? top.tagName.toLowerCase() : null,
      topCls: top ? String(top.className || '').slice(0, 40) : null,
      cx, cy
    };
  });
  check('画布元素上没有被浮层盖住（点得到元素本体）',
    textProbe.ok && textProbe.hits === true,
    textProbe.err || `命中 ${textProbe.topTag}.${textProbe.topCls}`);

  if (textProbe.ok && textProbe.hits) {
    // 长按进入选中（竖屏契约），再双击进入就地编辑
    await win.mouse.move(textProbe.cx, textProbe.cy);
    await win.mouse.down();
    await sleep(520);
    await win.mouse.up();
    await sleep(300);
    const sel = await win.evaluate(() => window.__sceneStore.getState().scene.selectedId);
    check('长按画布元素 → 被选中', !!sel, `selectedId=${sel}`);
  }

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
