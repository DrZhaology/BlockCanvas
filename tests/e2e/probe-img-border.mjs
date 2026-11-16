// 探针：图片插入链路 + 边框可见性
//
// 用户本轮亲口报的三件事：
//   ① 「图片崩了本地不能加载」/「插入的图片直接成窄的一条线了」
//      → 插进去要真有画面；空图时要有可点中的盒子，且不被写死比例
//   ② 「边框设置不了，写了浏览器不显示」
//      → 只写 border-*-width 时 computed border-style 是 none，宽度算 0
//
// 用法：node tests/e2e/probe-img-border.mjs
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const ck = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const main = async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  win.setDefaultTimeout(15000);
  await sleep(2200);
  // 干净单页：新的空标签，排除"长文档把图挤到视口外"的干扰
  await win.evaluate(() => { const st = window.__tabStore.getState(); st.newTab(); });
  await sleep(900);

  const assets = await win.evaluate(() => window.bc.listAssets());
  const firstImg = (Array.isArray(assets) ? assets : []).find((a) => a.kind === 'image');
  ck('素材库能列出图片', Boolean(firstImg), firstImg ? firstImg.url : `共 ${assets ? assets.length : 0} 条`);

  // ---------- ① 空图：有盒子、没写死 height ----------
  const id = await win.evaluate(() => {
    const st = window.__sceneStore.getState();
    st.addElement('img');
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    return kids[kids.length - 1].id;
  });
  await sleep(600);
  const empty = await win.evaluate((eid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      h: Math.round(r.height), w: Math.round(r.width),
      inlineHeight: el.style.height || '(none)',
      cssH: cs.height, minH: cs.minHeight
    };
  }, id);
  ck('空图有可点中的盒子（不是一条线）', Boolean(empty) && empty.h >= 100, JSON.stringify(empty));
  ck('空图没有写死 height（比例可自由调）', Boolean(empty) && empty.inlineHeight === '(none)',
    `inline height=${empty && empty.inlineHeight}，minHeight=${empty && empty.minH}`);

  // ---------- ② 有图：真的解码 + 外框比例 = 真实比例 ----------
  if (firstImg) {
    await win.evaluate(([eid, url]) => {
      window.__sceneStore.getState().updateAttr(eid, 'src', url);
    }, [id, firstImg.url]);
    await sleep(1800);
    const shot = await win.evaluate((eid) => {
      const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        nw: el.naturalWidth, nh: el.naturalHeight, complete: el.complete,
        loading: el.getAttribute('loading'), decoding: el.getAttribute('decoding'),
        w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
        viewportH: window.innerHeight,
        cssH: cs.height, objectFit: cs.objectFit,
        currentSrc: (el.currentSrc || el.getAttribute('src') || '').slice(0, 48)
      };
    }, id);
    ck('图片在画布上真的解码出来了', Boolean(shot) && shot.nw > 0 && shot.nh > 0,
      `nw=${shot && shot.nw} nh=${shot && shot.nh} complete=${shot && shot.complete} loading=${shot && shot.loading} src=${shot && shot.currentSrc}`);
    if (shot && shot.nw > 0) {
      const boxRatio = shot.w / shot.h;
      const natRatio = shot.nw / shot.nh;
      const dev = Math.abs(boxRatio - natRatio) / natRatio;
      ck('外框比例 = 图片真实比例（偏差 < 2%）', dev < 0.02,
        `外框 ${shot.w}×${shot.h} (${boxRatio.toFixed(3)}) vs 原图 ${shot.nw}×${shot.nh} (${natRatio.toFixed(3)}) 偏差 ${(dev * 100).toFixed(1)}%`);
    }
  }

  // ---------- ③ 边框：只写宽度 → 必须看得见 ----------
  await win.evaluate((eid) => {
    window.__sceneStore.getState().updateStyle(eid, { borderTopWidth: '3px', borderTopColor: '#e11d48' });
  }, id);
  await sleep(500);
  const raw = await win.evaluate((eid) => {
    const el = document.querySelector(`.canvas [data-bc-id="${eid}"]`);
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.borderTopWidth) || 0;
    return { style: cs.borderTopStyle, width: cs.borderTopWidth, px, color: cs.borderTopColor };
  }, id);
  // 画布可能被缩放（zoom），computed 宽度是视觉像素 → 只要求"非 none 且 > 0"
  ck('旧数据里"只有宽度"的边框也能显示', raw.style !== 'none' && raw.px > 0,
    `computed style=${raw.style} width=${raw.width}`);

  await win.screenshot({ path: 'tests/e2e/shots-diag/probe-img-border.png' }).catch(() => {});
  await app.close();

  const fail = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - fail.length}/${results.length} 通过 =====`);
  if (fail.length) { console.log('失败项：'); fail.forEach((f) => console.log(' - ' + f.name + ' ' + (f.detail || ''))); process.exit(1); }
};
main().catch((e) => { console.error(e); process.exit(1); });
