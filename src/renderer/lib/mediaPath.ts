// BlockCanvas · 媒体路径模型（v0.4.5 第 15 批）
//
// 用户原话：
//   「视频，音频，图片现在的路径统一成 3 种：相对路径，绝对路径，URL。
//     但是相对路径和绝对路径这个只是给人看的，真正程序设置了相对路径，
//     一定要也记录一份绝对路径作为权威资源的路径……
//     默认相对路径，并且相对路径加一个按钮：导出时根据位置自动匹配相对路径。
//     那么程序内看到的路径还是 bcproj 相对的路径，但是导出的时候根据记录的权威绝对路径
//     和导出的位置自动匹配相对路径。」
//
// 所以每个媒体元素记两样东西：
//   · `attrs.src`        —— **给人看/给人改**的写法（相对 / 绝对 / URL 三种模式之一）
//   · `attrs.srcAbs`     —— **权威资源路径**（永远是可读的绝对路径，或 URL 原样）
//
// 画布渲染、导出、打包进 .bcproj 全都用 `srcAbs`（权威）；只有"显示/编辑"用 `src`。
// 这样：
//   · 用户写相对路径 → 程序自己记下它当时解析出的绝对路径 → 换工作目录也不会丢图；
//   · 导出时按"导出目录"重新算一遍相对路径 → 拷到哪儿都能用。

export type MediaSrcMode = 'relative' | 'absolute' | 'url';

/** 看起来像不像一个 URL（http/https/data/blob） */
export function isUrlLike(p: string): boolean {
  return /^(https?:|data:|blob:)/i.test(String(p ?? '').trim());
}

/** 是不是绝对路径（Windows 盘符 / UNC / POSIX 根） */
export function isAbsoluteFsPath(p: string): boolean {
  const s = String(p ?? '').trim();
  if (!s) return false;
  return /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\') || s.startsWith('/');
}

/** 猜一个写法属于哪种模式 */
export function detectSrcMode(p: string): MediaSrcMode {
  const s = String(p ?? '').trim();
  if (isUrlLike(s)) return 'url';
  if (isAbsoluteFsPath(s)) return 'absolute';
  return 'relative';
}

/** 统一成正斜杠（Windows 路径在 UI 里也显示正斜杠，更好读、也方便拼相对路径） */
export function normalizeSlashes(p: string): string {
  return String(p ?? '').replace(/\\/g, '/');
}

/** 取目录部分（纯字符串，跨平台；不依赖 node:path，渲染层能用） */
export function dirname(p: string): string {
  const s = normalizeSlashes(p);
  const i = s.lastIndexOf('/');
  return i <= 0 ? '' : s.slice(0, i);
}

/** 取文件名部分 */
export function basename(p: string): string {
  const s = normalizeSlashes(p);
  return s.slice(s.lastIndexOf('/') + 1);
}

/**
 * 把绝对路径转成"相对导出目录"的写法（导出用）。
 *
 * 例：base = `D:/site`，abs = `D:/site/assets/pic.png` → `assets/pic.png`
 *     base = `D:/site`，abs = `D:/other/pic.png`    → `../other/pic.png`
 *     不同盘符（D: → E:）无法相对 → 原样返回绝对路径（导出时会提示）
 */
export function toRelativeFrom(absPath: string, baseDir: string): { rel: string; crossDrive: boolean } {
  const abs = normalizeSlashes(absPath);
  const base = normalizeSlashes(baseDir).replace(/\/+$/, '');
  if (!abs || !base) return { rel: absPath, crossDrive: false };
  // 盘符不同（Windows）→ 没法相对
  const da = /^([a-zA-Z]):/.exec(abs)?.[1]?.toLowerCase();
  const db = /^([a-zA-Z]):/.exec(base)?.[1]?.toLowerCase();
  if (da && db && da !== db) return { rel: absPath, crossDrive: true };

  const A = abs.split('/').filter((x) => x !== '');
  const B = base.split('/').filter((x) => x !== '');
  let i = 0;
  while (i < A.length && i < B.length && A[i].toLowerCase() === B[i].toLowerCase()) i += 1;
  const up = B.length - i;
  const rest = A.slice(i).join('/');
  const rel = up === 0 ? rest : Array(up).fill('..').join('/') + (rest ? '/' + rest : '');
  return { rel: rel || '.', crossDrive: false };
}

/**
 * 把相对写法解析成绝对路径（需要 baseDir = 工程文件所在目录）。
 * 已经是绝对/URL 的原样返回。
 */
export function resolveToAbsolute(src: string, baseDir: string): string {
  const s = String(src ?? '').trim();
  if (!s) return '';
  if (isUrlLike(s)) return s;
  if (isAbsoluteFsPath(s)) return normalizeSlashes(s);
  const base = normalizeSlashes(baseDir).replace(/\/+$/, '');
  if (!base) return s;
  const clean = s.replace(/^\.\//, '');
  return normalizeSlashes(base + '/' + clean).replace(/\/\.\//g, '/');
}

/**
 * 决定"权威路径"：优先用记下来的 srcAbs；没有就用 src 按工程目录解析。
 * 返回的字符串一定能直接交给主进程读文件（或是一个 URL）。
 */
export function authoritativeSrc(
  attrs: Record<string, string | undefined> | undefined,
  projectDir: string
): string {
  const abs = String(attrs?.srcAbs ?? '').trim();
  if (abs) return abs;
  return resolveToAbsolute(String(attrs?.src ?? ''), projectDir);
}
