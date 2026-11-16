// 探针：属性卡片「删不掉」—— 断点层残留
//
// 用户原话（v0.4.7）：「删除属性卡片删不掉，会卡」
//
// 复现机理：
//   写值跟着 activeBreakpoint 走（右侧面板够宽时画布落到 tablet），
//   值写进 node.responsive.tablet；
//   而面板判断"这一行该不该显示"用基础层 + 当前断点层合并后的样式。
//   如果删除只清基础层 → tablet 层原封不动 → hasStyleValue() 仍为真 → 行当场回来。
//
// 用法：node tests/e2e/probe-prop-delete.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');

const ROOT = process.cwd();
let pass = 0; let fail = 0;
const ck = (name, ok, detail) => {
  if (ok) { pass += 1; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail += 1; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-prop-delete');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  win.setDefaultTimeout(12000);
  await sleep(1800);
  await win.evaluate(() => { const st = window.__tabStore.getState(); st.newTab(); });
  await sleep(600);

  const id = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('div');
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    const fresh = kids[kids.length - 1];
    s2.selectElement(fresh.id);
    return fresh.id;
  });
  await sleep(700);

  // 清掉新建元素自带的可见属性，让「加一条 → 行数 +1」的判定成立
  await win.evaluate((eid) => {
    const st = window.__sceneStore.getState();
    const find = (n) => (n.id === eid ? n : (n.children || []).map(find).find(Boolean));
    const node = find(st.scene.root);
    for (const k of [...(node?.visibleProps ?? [])]) st.removeVisibleProp(eid, k);
  }, id);
  await sleep(400);

  // ---- 场景 A：值写在 tablet 断点层（面板宽 → 画布窄） ----
  const tabletOnly = await win.evaluate((eid) => {
    const st = window.__sceneStore.getState();
    st.updateStyle(eid, { paddingTop: '24px' }, 'tablet');
    st.addVisibleProp(eid, 'padding');
    const s2 = window.__sceneStore.getState();
    const find = (n) => (n.id === eid ? n : (n.children || []).map(find).find(Boolean));
    const node = find(s2.scene.root);
    return {
      base: node.style.paddingTop ?? null,
      tablet: node.responsive?.tablet?.paddingTop ?? null,
      visible: (node.visibleProps ?? []).filter((k) => k === 'padding')
    };
  }, id);
  ck('值确实只落在 tablet 层（复现条件成立）',
    tabletOnly.tablet === '24px' && tabletOnly.base === null,
    JSON.stringify(tabletOnly));

  // 切到 tablet 断点，让这一行真的显示出来
  await win.evaluate(() => window.__sceneStore.getState().setActiveBreakpoint('tablet'));
  await sleep(400);
  // CSS 属性区默认折叠 → 先展开，否则 .props-list 里什么都没有
  await win.evaluate(() => {
    if (document.querySelector('.add-prop-trigger')) return;
    const head = [...document.querySelectorAll('.inspector-sec-head')]
      .find((h) => (h.getAttribute('title') || '').includes('CSS'));
    head?.click();
  });
  await sleep(600);
  const rowThereBefore = await win.evaluate(() => {
    const rows = [...document.querySelectorAll('.props-list .prop-row')];
    return { hasList: Boolean(document.querySelector('.props-list')), rows: rows.length, texts: rows.map((r) => (r.textContent || '').slice(0, 12)) };
  });
  ck('切换断点后能看到「内边距」行', rowThereBefore.hasList && rowThereBefore.rows > 0,
    JSON.stringify(rowThereBefore));

  // 删
  await win.evaluate((eid) => window.__sceneStore.getState().removeVisibleProp(eid, 'padding'), id);
  await sleep(700);
  const after = await win.evaluate((eid) => {
    const st = window.__sceneStore.getState();
    const find = (n) => (n.id === eid ? n : (n.children || []).map(find).find(Boolean));
    const node = find(st.scene.root);
    const rows = [...document.querySelectorAll('.props-list .prop-row')];
    return {
      base: node.style.paddingTop ?? null,
      tablet: node.responsive?.tablet?.paddingTop ?? null,
      visible: (node.visibleProps ?? []).includes('padding'),
      rowStillInDom: rows.some((r) => (r.textContent || '').includes('内边距'))
    };
  }, id);
  ck('删除后 tablet 层也清干净了', after.tablet === null, `tablet=${after.tablet}`);
  ck('删除后行不再回来', !after.rowStillInDom, `rowStillInDom=${after.rowStillInDom}`);

  // ---- 场景 B：border 只写宽度（旧脏数据）也必须能删掉 ----
  await win.evaluate((eid) => {
    const st = window.__sceneStore.getState();
    st.updateStyle(eid, { borderTopWidth: '2px', borderTopColor: '#333333' });
    st.addVisibleProp(eid, 'border');
  }, id);
  await sleep(500);
  const beforeB = await win.evaluate((eid) => {
    const st = window.__sceneStore.getState();
    const find = (n) => (n.id === eid ? n : (n.children || []).map(find).find(Boolean));
    const node = find(st.scene.root);
    return { w: node.style.borderTopWidth ?? null, visible: (node.visibleProps ?? []).includes('border') };
  }, id);
  ck('边框行存在（写宽度即视为已设置）', beforeB.visible, JSON.stringify(beforeB));

  await win.evaluate((eid) => window.__sceneStore.getState().removeVisibleProp(eid, 'border'), id);
  await sleep(700);
  const afterB = await win.evaluate((eid) => {
    const st = window.__sceneStore.getState();
    const find = (n) => (n.id === eid ? n : (n.children || []).map(find).find(Boolean));
    const node = find(st.scene.root);
    const rows = [...document.querySelectorAll('.props-list .prop-row')];
    return {
      w: node.style.borderTopWidth ?? null,
      style: node.style.borderTopStyle ?? null,
      rowStillInDom: rows.some((r) => (r.textContent || '').includes('边框'))
    };
  }, id);
  ck('边框删除后长写宽度也清掉了', afterB.w === null, `borderTopWidth=${afterB.w}`);
  ck('边框行不再回来', !afterB.rowStillInDom, `rowStillInDom=${afterB.rowStillInDom}`);

  await win.screenshot({ path: 'tests/e2e/shots-diag/probe-prop-delete.png' }).catch(() => {});
  await app.close();
  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  if (fail) process.exit(1);
};
main().catch((e) => { console.error(e); process.exit(1); });
