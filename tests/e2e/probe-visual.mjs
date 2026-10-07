// DOM 几何诊断：找出「导出前体检」按钮徽标 / 向导里被遮挡的元素（不依赖截图）
import { resolve } from 'path';
import { launchApp, sleep } from './cdp-launch.mjs';
const ROOT = process.cwd();

const DIAG = `(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
  const desc = (el) => el ? (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '')) : 'null';
  const overlaps = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  const out = {};

  const badge = document.querySelector('.tb-health-badge');
  if (badge) {
    const br = badge.getBoundingClientRect();
    out.badge = { rect: { x: +br.x.toFixed(1), y: +br.y.toFixed(1), w: +br.width.toFixed(1), h: +br.height.toFixed(1) } };
    // 采样点：四角 + 中心 + 右中
    const pts = [[br.left + 1, br.top + 1], [br.right - 1, br.top + 1], [br.right - 1, br.bottom - 1], [br.left + 1, br.bottom - 1], [br.left + br.width / 2, br.top + br.height / 2]];
    out.badge.hit = pts.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y), el: desc(document.elementFromPoint(x, y)) }));
    // 谁盖住了徽标（排除自身/祖先）
    const cover = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el === badge || el.contains(badge) || badge.contains(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (overlaps(r, br)) cover.push({ el: desc(el), rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }, z: getComputedStyle(el).zIndex, pos: getComputedStyle(el).position });
    });
    out.badge.cover = cover.slice(0, 14);
    // 裁剪祖先（overflow != visible）
    const clip = [];
    let p = badge.parentElement;
    while (p) {
      const cs = getComputedStyle(p);
      if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        clip.push({ el: desc(p), rect: rect(p), overflow: cs.overflow + '/' + cs.overflowX + '/' + cs.overflowY, pad: cs.paddingRight });
      }
      p = p.parentElement;
    }
    out.badge.clipAncestors = clip;
  }
  out.innerWidth = window.innerWidth;

  // 向导：右上角区域所有元素 + 黄色元素
  const modal = document.querySelector('.hc-modal');
  if (modal) {
    const mr = modal.getBoundingClientRect();
    out.modal = { rect: { x: +mr.x.toFixed(1), y: +mr.y.toFixed(1), w: +mr.width.toFixed(1), h: +mr.height.toFixed(1) } };
    // 右上角 140×110 区域里的元素
    const zone = { left: mr.right - 150, top: mr.top, right: mr.right, bottom: mr.top + 120 };
    const inZone = [];
    modal.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (!(r.right <= zone.left || r.left >= zone.right || r.bottom <= zone.top || r.top >= zone.bottom)) {
        const cs = getComputedStyle(el);
        inZone.push({ el: desc(el), rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }, bg: cs.backgroundColor, color: cs.color, z: cs.zIndex, pos: cs.position, ov: cs.overflow });
      }
    });
    out.modal.topRightZone = inZone;
    // 所有"黄色系"元素
    const yellow = [];
    modal.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(cs.backgroundColor);
      if (!m) return;
      const [r, g, b] = [+m[1], +m[2], +m[3]];
      if (r > 150 && g > 110 && b < 140 && r >= g) {
        const rr = el.getBoundingClientRect();
        yellow.push({ el: desc(el), rect: { x: +rr.x.toFixed(1), y: +rr.y.toFixed(1), w: +rr.width.toFixed(1), h: +rr.height.toFixed(1) }, bg: cs.backgroundColor });
      }
    });
    out.modal.yellow = yellow;
  }
  return out;
})()`;

async function main() {
  const { win, close } = await launchApp({ root: ROOT });
  try {
    await win.waitForSelector('.toolbar', { timeout: 20000 });
    await sleep(1500);
    await win.locator('.element-btn', { hasText: '标题' }).first().click();
    await sleep(400);
    await win.locator('.element-btn', { hasText: '段落' }).first().click();
    await sleep(600);
    console.log('===== 工具栏徽标 =====');
    console.log(JSON.stringify(await win.evaluate(DIAG), null, 1));
    await win.locator('.tb-health-btn').first().click();
    await sleep(800);
    console.log('===== 向导右上角 =====');
    console.log(JSON.stringify(await win.evaluate(DIAG), null, 1));
  } finally {
    await close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
