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

  // 逃生开关：任何情况下用户都能一键关掉这个优化
  // （localStorage['bc-img-downscale'] = 'off'）
  try {
    if (localStorage.getItem('bc-img-downscale') === 'off') return;
  } catch { /* 读不到就按默认开 */ }

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const shownW = el.clientWidth || el.width || 0;
  const shownH = el.clientHeight || el.height || 0;
  if (!shownW || !shownH) return;

  const needW = bucket(shownW * dpr);
  const needH = bucket(shownH * dpr);
  // v0.4.5 收紧（用户反馈"高清图被模糊成一坨"）：
  // 只有**收益非常明显**时才降采样 —— 原图至少是需要的 3 倍才动手。
  // 以前是 1.5 倍，等于稍微大一点就被压，画质掉得肉眼可见。
  if (el.naturalWidth <= needW * 3 && el.naturalHeight <= needH * 3) return;

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
        // webp 保留透明通道；质量拉到 0.95（接近无损），避免"高清图被压糊"
        cv.toBlob((blob) => {
          if (!blob) { img.src = ''; next(); return; }
          const url = URL.createObjectURL(blob);
          // v0.4.5 关键防护（用户反馈"图片又不能显示了"）：
          // **先验证这张小图真的能加载**，成功之后才替换。
          // 以前直接 el.src = url，一旦编码/解码有问题，画布上那张图就空白了。
          const probe = new Image();
          probe.onload = () => {
            blobCache.set(key, url);
            if (el.isConnected) el.src = url;
            img.src = '';
            next();
          };
          probe.onerror = () => {
            // 降采样结果不可用 → 保留原图（宁可多占内存，也不能让图消失）
            URL.revokeObjectURL(url);
            img.src = '';
            next();
          };
          probe.src = url;
        }, 'image/webp', 0.95);
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