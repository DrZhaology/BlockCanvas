// BlockCanvas · 首页背景**提前预热**（v0.4.5 第 14 批）
//
// 用户反馈：「进入主界面的时候，背景的加载例如图片或者视频会有延迟，这个也优化一下。」
//
// 原因：首页背景存在 localStorage 里（`bc-empty-home-bg`），只有 EmptyHome 挂载时
// 才会去 `new Image()` / `<video src>`。而启动流程是"加载页 → 首页"，
// 等首页真正挂上去才开始下载，用户就会先看到一片白/底色，然后图片"啪"地出现。
//
// 做法：**在启动加载页还盖着的时候就先把背景资源拉起来**。
//   · 图片：`new Image()` 一挂上就开始下载并解码，浏览器会把它放进内存缓存，
//     EmptyHome 再用同一个 URL 当背景时是**缓存命中**，第一帧就有图；
//   · 视频：建一个游离的 `<video preload="auto">` 调 load()，先把头部数据与首帧缓冲好；
//     等 EmptyHome 真的挂上 <video> 时，`readyState` 已经够画第一帧了。
//
// 这个模块刻意做成"纯预热"：不读 DOM、不改状态、失败一律忽略。
// 重复调用是幂等的（内部有去重）。

const BG_KEY = 'bc-empty-home-bg';
/** 已经预热过的资源 URL（避免重复建元素） */
const warmed = new Set<string>();

/** 把 "bc-img://file/xxx" 之类换成浏览器能直接加载的地址（与 EmptyHome 的 mediaSrc 一致） */
function toUrl(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (/^(https?:|data:|blob:|bc-img:)/i.test(t)) return t;
  // Windows 绝对路径 / 相对路径都走自定义协议
  return 'bc-img://file/' + encodeURIComponent(t);
}

function readSavedBg(): { kind?: string; src?: string } | null {
  try {
    const raw = localStorage.getItem(BG_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    return v as { kind?: string; src?: string };
  } catch {
    return null;
  }
}

/**
 * 预热首页背景（幂等）。
 * 返回一个清理函数：把还没加载完的预热资源释放掉（应用卸载/切到编辑器时可不用管，
 * 浏览器缓存本来就该留着）。
 */
export function warmHomeBackground(): void {
  const bg = readSavedBg();
  if (!bg || !bg.kind || (bg.kind !== 'image' && bg.kind !== 'video')) return;
  const url = toUrl(String(bg.src || ''));
  if (!url || warmed.has(url)) return;
  warmed.add(url);

  try {
    if (bg.kind === 'image') {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { img.onload = null; img.onerror = null; };
      img.src = url;
      return;
    }
    // 视频：先缓冲一段（静音、不播放），让首页挂上去时 readyState 已经够用
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.style.position = 'fixed';
    v.style.left = '-9999px';
    v.style.top = '0';
    v.style.width = '2px';
    v.style.height = '2px';
    v.style.opacity = '0';
    v.style.pointerEvents = 'none';
    v.setAttribute('aria-hidden', 'true');
    v.src = url;
    // 挂到 DOM 上才会真正开始下载（游离 video 在某些 Chromium 版本里不会缓冲）
    document.body.appendChild(v);
    const cleanup = () => {
      try { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } catch { /* 忽略 */ }
    };
    // 缓冲到能画第一帧就收工（别让它长期占着解码器）
    const onReady = () => {
      if (v.readyState >= 2) {
        v.removeEventListener('canplay', onReady);
        v.removeEventListener('loadeddata', onReady);
        window.setTimeout(cleanup, 1500);
      }
    };
    v.addEventListener('canplay', onReady);
    v.addEventListener('loadeddata', onReady);
    v.addEventListener('error', cleanup);
    v.load();
    // 兜底：15 秒还没好就不等了（大视频也别一直挂着）
    window.setTimeout(cleanup, 15000);
  } catch {
    /* 预热失败完全不影响功能 */
  }
}