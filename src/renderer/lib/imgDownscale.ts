// ============================================================================
// BlockCanvas · 画布大图降采样（v0.4.5，性能）
// ----------------------------------------------------------------------------
// 问题：<img src="4K.png"> 会按**原始分辨率**解码。一张 4K 图解码后约 33MB（RGBA），
//       50 张就是 1.6GB —— 用户实测插 50 多张 4K 图内存直接冲到 2~3GB、GPU 吃满。
//       loading="lazy" 只推迟解码，图一进视口照样按原尺寸解码，治不了本。
//
// 做法：按元素在画布上的**实际显示尺寸**（× DPR，上限 2）生成一张降采样副本，
//       只把这张小图交给画布渲染；原始地址仍留在场景里，导出/换机器都不受影响。
//       · 顺序执行（一次只处理一张），避免同时解码多张把内存顶到峰值
//       · 结果按【原图地址 + 目标尺寸档】缓存，同一张图多处引用只降采样一次
//       · 只处理"原图明显大于显示尺寸"的图（小于 1.5 倍就跳过，避免无谓损失）
//
// 注意：这是"显示层优化"，不改变任何数据 —— 导出时仍用 node.attrs.src 的原始值。
// ============================================================================

const blobCache = new Map<string, string>();
const processed = new WeakSet<HTMLImageElement>();
const queue: Array<() => void> = [];
let running = false;

/** 目标尺寸按 64px 分档，避免同一张图因 1px 差异生成多份副本 */
const bucket = (n: number) => Math.max(64, Math.ceil(n / 64) * 64);

function next() {
  const job = queue.shift();
  if (!job) { running = false; return; }
  running = true;
  job();
}

function enqueue(job: () => void) {
  queue.push(job);
  if (!running) next();
}

/**
 * 把一张已渲染的 <img> 换成降采样副本。
 * 用 imperative 方式直接改 DOM 的 src：React 只在 props 变化时才写属性，
 * 所以这里设的值不会被下一次渲染冲掉；而数据层完全没动。
 */
function shrink(el: HTMLImageElement) {
  const src = el.currentSrc || el.getAttribute('src') || '';
  if (!src || src.startsWith('blob:')) return;
  if (!el.naturalWidth || !el.naturalHeight) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const shownW = el.clientWidth || el.width || 0;
  const shownH = el.clientHeight || el.height || 0;
  if (!shownW || !shownH) return;

  const needW = bucket(shownW * dpr);
  const needH = bucket(shownH * dpr);
  // 原图不比显示尺寸大多少就没必要降采样（避免白折腾还掉画质）
  if (el.naturalWidth <= needW * 1.5 && el.naturalHeight <= needH * 1.5) return;

  const key = `${src}|${needW}x${needH}`;
  const cached = blobCache.get(key);
  if (cached) { el.src = cached; return; }

  enqueue(() => {
    const img = new Image();
    img.decoding = 'async';
    // 本地文件走 bc-img 协议，需要 CORS 才能读像素（协议已放开）
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const scale = Math.min(needW / img.naturalWidth, needH / img.naturalHeight, 1);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext('2d');
        if (!ctx) { next(); return; }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        // webp 保留透明通道且体积小；浏览器不支持时自动回退 png
        cv.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            blobCache.set(key, url);
            if (el.isConnected) el.src = url;
          }
          // img 出作用域后原始解码位图会被回收 —— 这是内存能降下来的关键
          img.src = '';
          next();
        }, 'image/webp', 0.86);
      } catch {
        next();
      }
    };
    img.onerror = () => { img.src = ''; next(); };
    img.src = src;
  });
}

/**
 * 扫描容器里所有画布图片，把需要降采样的排进队列。
 * 用 requestIdleCallback 起头，不在滚动/拖动时抢主线程。
 */
export function downscaleBigImages(root: HTMLElement | null) {
  if (!root) return;
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-bc-id]'));
  for (const el of imgs) {
    if (processed.has(el)) continue;
    if (!el.complete) {
      // 还没解码完：等它 decode 之后再决定
      el.addEventListener('load', () => { processed.add(el); shrink(el); }, { once: true });
      continue;
    }
    processed.add(el);
    shrink(el);
  }
}