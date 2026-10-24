import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from '@renderer/assets/logo.svg';
import { readPersisted, writePersisted } from '@lib/usePersisted';
import { Icon } from './Icon';
import { GradientEditor } from './GradientEditor';
import { DOC_INDEX, searchDocs, type DocHit } from '@lib/docSearch';
import { useTabStore } from '@store/tabStore';
import { showToast } from '@lib/toast';
import { withViewTransition } from '@lib/viewTransition';
import type { ProjectFileInfo } from '../global';

// ============================================================================
// BlockCanvas · 首页
// ----------------------------------------------------------------------------
// 关掉所有项目标签后进入这里 —— 做成浏览器"新标签页"的样子：
//   · 组件统一偏上：Logo / 标题 / 大搜索框 / 快捷入口 / 最近项目
//   · 搜索框同时搜「本地工程」和「三份内置文档」，回车或点击直达
//   · 右上角只有一枚 SVG 齿轮，点开是背景设置
//   · 背景 = 预设 / 渐变（复用画布同款渐变编辑器）/ 图片 / 视频，**改动实时生效**
//   · 文字颜色按背景亮度自动切换（视频每 1.8s 采样一次），深色壁纸也看得清
//   · 背景是"软件外观偏好"，存 localStorage，不进工程文件
// ============================================================================

const BG_KEY = 'bc-empty-home-bg';
const SAVED_KEY = 'bc-empty-home-saved';

type BgSpec =
  | { kind: 'preset'; value: string }
  | { kind: 'gradient'; css: string }
  | { kind: 'image'; src: string; dim: number; blur: number }
  | { kind: 'video'; src: string; dim: number; blur: number };

interface SavedBg { id: string; name: string; spec: BgSpec }

const BG_PRESETS: { label: string; value: string }[] = [
  { label: '晴空', value: 'linear-gradient(160deg, #eaf3ff 0%, #f4f9ff 55%, #ffffff 100%)' },
  { label: '晨雾', value: 'linear-gradient(160deg, #eef4f6 0%, #f7fbfc 55%, #ffffff 100%)' },
  { label: '暖阳', value: 'linear-gradient(160deg, #fdf3e7 0%, #fff8ee 55%, #ffffff 100%)' },
  { label: '薄荷', value: 'linear-gradient(160deg, #e9f8ef 0%, #f4fdf8 55%, #ffffff 100%)' },
  { label: '薰衣草', value: 'linear-gradient(160deg, #f1ecfb 0%, #f9f6ff 55%, #ffffff 100%)' },
  { label: '极简白', value: '#ffffff' },
  { label: '浅灰', value: '#f3f5f8' },
  { label: '米色', value: '#faf6ef' }
];

const DEFAULT_BG: BgSpec = { kind: 'preset', value: BG_PRESETS[0].value };
const DEFAULT_GRADIENT = 'linear-gradient(160deg, #dbeafe 0%, #ffffff 100%)';

/**
 * 「解不了的视频」黑名单（v0.4.5）
 *
 * 背景：Chromium 遇到解不了的编码会打 `ffmpeg_common.cc Unsupported pixel format: -1`，
 * 那条日志来自**原生解码器**，JS 完全屏蔽不了。之前只做到「失败就回退背景」，
 * 但每次启动仍会先尝试解码一次 → 每次进首页还是刷同一条错误。
 *
 * 现在把失败过的文件路径记下来：以后连 `<video>` 都不挂载，从根上不再触发解码。
 * 只记最近 20 条，用户换新文件不受影响。
 */
const BAD_VIDEO_KEY = 'bc-empty-home-bad-videos';
function readBadVideos(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(BAD_VIDEO_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function markBadVideo(src: string): void {
  try {
    const list = readBadVideos();
    if (!src || list.includes(src)) return;
    localStorage.setItem(BAD_VIDEO_KEY, JSON.stringify([...list, src].slice(-20)));
  } catch { /* 记不住也无所谓，只是下次还会试一次 */ }
}

/**
 * 视频能不能解（v0.4.5）。
 * Chromium 遇到解不了的编码会打 `Unsupported pixel format: -1`（ffmpeg_common.cc），
 * 那条日志来自原生解码器，JS 没法屏蔽；能做的是**事先探一次**，
 * 解不了就不套用，避免每次进首页都刷同一条错误。
 */
function probeVideoPlayable(src: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    if (!src) { resolve(false); return; }
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.crossOrigin = 'anonymous';
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      v.removeAttribute('src');
      v.load();
      resolve(ok);
    };
    const timer = window.setTimeout(() => done(false), timeoutMs);
    v.onloadedmetadata = () => { window.clearTimeout(timer); done(true); };
    v.onerror = () => { window.clearTimeout(timer); done(false); };
    v.src = src;
  });
}

/** 本地路径 → bc-img://（与画布同一套协议；相对路径由主进程按 data / app 目录解析） */
function mediaSrc(src: string): string {
  const s = (src || '').trim();
  if (!s) return '';
  if (/^(https?:|data:|blob:|bc-img:)/i.test(s)) return s;
  if (/^file:\/\//i.test(s)) {
    const p = decodeURIComponent(s.replace(/^file:\/\//i, '')).replace(/^\//, '');
    return 'bc-img://file/' + encodeURIComponent(p);
  }
  return 'bc-img://file/' + encodeURIComponent(s);
}

/** 需要走自定义协议（本地文件）才加 crossorigin，避免把普通 https 图片/视频搞挂 */
function isLocalMedia(src: string): boolean {
  const s = (src || '').trim();
  return !/^https?:\/\//i.test(s) && !/^(data:|blob:)/i.test(s);
}

function bgCss(spec: BgSpec): string {
  if (spec.kind === 'preset') return spec.value;
  if (spec.kind === 'gradient') return spec.css || DEFAULT_GRADIENT;
  return 'var(--bg)';
}

function loadBg(): BgSpec {
  const raw = readPersisted<unknown>(BG_KEY, null);
  if (!raw) return DEFAULT_BG;
  if (typeof raw === 'string') return { kind: 'preset', value: raw }; // 旧版只存一个 CSS 值
  if (typeof raw === 'object' && raw && 'kind' in (raw as Record<string, unknown>)) {
    const s = raw as Record<string, any>;
    // 旧版渐变 {from,to,angle} → 新的 css 字符串
    if (s.kind === 'gradient' && !s.css && s.from && s.to) {
      return { kind: 'gradient', css: `linear-gradient(${s.angle ?? 160}deg, ${s.from} 0%, ${s.to} 100%)` };
    }
    if (s.kind === 'image' || s.kind === 'video') {
      return { kind: s.kind, src: String(s.src ?? ''), dim: Number(s.dim) || 0, blur: Number(s.blur) || 0 };
    }
    return s as BgSpec;
  }
  return DEFAULT_BG;
}

// ============================================================================
// v0.4.5：**记住主界面的颜色模式**（用户反馈）
// ----------------------------------------------------------------------------
// 用户原话：「比如可以记录主界面的颜色模式，比如背景是淡色的，记录一下，那么显示的字体就是黑色的。
//            因为现在直接进入会有一个过渡期，如果背景深色的，会等一会儿再把文字变成白色。」
//
// 原因：文字反色以前**只能等异步采样**（图片要 onload、视频要等 1.8 秒那一帧），
// 所以进首页时先按"浅色底 → 黑字"画一帧，采样完才翻成白字 —— 那一下很跳。
//
// 现在两道保险：
//  1. **能同步算的就同步算**：纯色 / 渐变直接解析颜色算亮度，第一帧就是对的（根本不进过渡期）；
//  2. **算不了的记住上次结果**：图片 / 视频按"背景签名"（类型+路径+压暗+模糊）记住上次判定，
//     下次进首页直接套用；签名没变就完全不需要再翻色。
// ============================================================================
const BG_DARK_KEY = 'bc-home-dark';        // 上次判定结果（true = 深色底 → 白字）
const BG_DARK_SIG_KEY = 'bc-home-dark-sig'; // 该结果对应的背景签名

/** 背景签名：同一种背景（含压暗/模糊参数）算同一档，换背景就重新判定 */
function bgSignature(spec: BgSpec): string {
  if (spec.kind === 'preset') return 'preset:' + spec.value;
  if (spec.kind === 'gradient') return 'gradient:' + (spec.css || DEFAULT_GRADIENT);
  return `${spec.kind}:${spec.src}:${spec.dim ?? 0}:${spec.blur ?? 0}`;
}

/** 同步判定"要不要用白字"；算不出来的（图片/视频）用记下来的结果兜底 */
function initialOnDark(spec: BgSpec): boolean {
  if (spec.kind === 'preset') return (cssLuminance(spec.value) ?? 1) < 0.5;
  if (spec.kind === 'gradient') return (cssLuminance(spec.css || DEFAULT_GRADIENT) ?? 1) < 0.5;
  const sig = bgSignature(spec);
  const lastSig = readPersisted<string>(BG_DARK_SIG_KEY, '');
  if (lastSig === sig) return readPersisted<boolean>(BG_DARK_KEY, false);
  // 这个背景没记过 → 沿用"上一次的整体模式"，至少不会先黑后白地闪一下
  return readPersisted<boolean>(BG_DARK_KEY, false);
}

/** 记下这次判定（同时记全局默认），下次进首页第一帧就是对的 */
function rememberOnDark(spec: BgSpec, dark: boolean): void {
  try {
    localStorage.setItem(BG_DARK_KEY, JSON.stringify(dark));
    localStorage.setItem(BG_DARK_SIG_KEY, JSON.stringify(bgSignature(spec)));
  } catch { /* 隐私模式下写不了，忽略 */ }
}

// 探针钩子（开发无关，只是让 E2E 能直接断言"首帧判定"这个纯函数，
// 否则一张 data URL 图片加载太快，观测不到"记忆值"那一帧）：
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__bcHomeDark = { initialOnDark, bgSignature, rememberOnDark };
}

function loadSaved(): SavedBg[] {
  const raw = readPersisted<unknown>(SAVED_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is SavedBg =>
    !!x && typeof x === 'object' && typeof (x as SavedBg).id === 'string' && typeof (x as SavedBg).name === 'string');
}

function normPath(p: string) {
  return String(p || '').replace(/[\\/]+/g, '/').toLowerCase();
}

/** 从 CSS 颜色（hex / rgb）里估一个平均亮度（0~1），用于自动切换文字颜色 */
function cssLuminance(css: string): number | null {
  const lums: number[] = [];
  const toLum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  for (const m of css.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    lums.push(toLum(r, g, b));
  }
  for (const m of css.matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/gi)) {
    lums.push(toLum(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  if (lums.length === 0) return null;
  return lums.reduce((a, b) => a + b, 0) / lums.length;
}

/** 把一帧画面缩到 24×24 取平均亮度；取不到（跨域/未加载）返回 null */
function frameLuminance(source: CanvasImageSource): number | null {
  try {
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 24;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, 24, 24);
    const d = ctx.getImageData(0, 0, 24, 24).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      if (a <= 0) continue;
      sum += ((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255) * a;
      n += 1;
    }
    return n ? sum / n : null;
  } catch {
    return null; // canvas 被跨域污染
  }
}

type PanelTab = 'preset' | 'gradient' | 'image' | 'video';

export function EmptyHome(props: {
  onOpen: () => void;
  onNew: () => void;
  onProjects: () => void;
}) {
  const [bg, setBg] = useState<BgSpec>(loadBg);
  const [saved, setSaved] = useState<SavedBg[]>(loadSaved);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>('preset');
  const [leaving, setLeaving] = useState(false);
  // 深色背景 → 文字/玻璃控件自动转白。
  // v0.4.5：**首帧就是对的**——纯色/渐变同步算，图片/视频用记住的上次结果（见 initialOnDark）。
  const [onDark, setOnDark] = useState(() => initialOnDark(bg));
  const panelRef = useRef<HTMLDivElement>(null);

  // 图片 / 视频的草稿参数（输入即生效，所以直接跟 bg 同步）
  const [imgSrc, setImgSrc] = useState(() => (bg.kind === 'image' ? bg.src : ''));
  const [vidSrc, setVidSrc] = useState(() => (bg.kind === 'video' ? bg.src : ''));
  // 已知解不了的视频（A9）：不挂载 <video>，避免原生解码器反复报错
  const [badVideos, setBadVideos] = useState<string[]>(() => readBadVideos());
  const [dim, setDim] = useState(() => (bg.kind === 'image' || bg.kind === 'video' ? bg.dim : 12));
  const [blur, setBlur] = useState(() => (bg.kind === 'image' || bg.kind === 'video' ? bg.blur : 0));
  const [gradCss, setGradCss] = useState(() => (bg.kind === 'gradient' ? bg.css : DEFAULT_GRADIENT));
  const [saveName, setSaveName] = useState('');

  // —— 搜索 ——
  const [projects, setProjects] = useState<ProjectFileInfo[]>([]);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.bc.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  // 离开首页：先淡出内容，再执行动作（背景保持不动，避免"窗口全白"）
  const leave = (action: () => void) => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(action, 150);
  };

  // 「打开工程」会弹原生文件对话框：取消时页面还停在首页，但已进入 is-leaving。
  // 窗口重新获得焦点（对话框关闭）时恢复可交互。
  useEffect(() => {
    const onFocus = () => setLeaving(false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const applyBg = (spec: BgSpec) => {
    setBg(spec);
    writePersisted(BG_KEY, spec);
  };

  // 面板点外部 / Esc 关闭
  // v0.4.5 修复：调色盘 / 变量菜单 / 取色面板都是 createPortal 挂到 body 的，
  // 在它们上面按下鼠标会被当成"点了面板外面"，于是选完色标颜色整个设置面板就关了。
  // 这里把「属于调色盘体系」的浮层排除掉。
  useEffect(() => {
    if (!panelOpen) return;
    const inPicker = (t: EventTarget | null) =>
      !!(t as HTMLElement | null)?.closest?.(
        '.cp-modal, .cp-modal-mask, .cp-varmenu, .cp-varmenu-mask, .bc-varmenu, .cp-sv, .cp-hue, .cp-alpha, .bc-color-portal'
      );
    const onDown = (e: MouseEvent) => {
      if (inPicker(e.target)) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) closePanel();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel(); };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [panelOpen]);

  // 搜索框点外部 → 收起结果
  // v0.4.5 修复：以前只监听 document 的 mousedown，且"点在 .eh-search 内部就不关"。
  // 结果面板本身在 .eh-search 里，于是它挡住下面的按钮时，点按钮的 mousedown 落在面板上
  // → 面板不关、按钮也点不到，形成死锁（用户反馈"首页搜索框点不进去"）。
  // 现在：① 点面板的空白处也关；② 窗口失焦（弹原生对话框等）就关；
  //       ③ Esc 关；④ 组件挂载时清空查询词与焦点状态。
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      // 点结果项本身要交给它自己的 onClick 处理
      if (t?.closest?.('.eh-hit, .eh-result, .eh-search-clear')) return;
      if (searchRef.current?.contains(e.target as Node) && !t?.closest?.('.eh-results')) return;
      setFocused(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocused(false); };
    const onBlur = () => setFocused(false);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [focused]);

  // 回到首页（组件重新挂载）时，搜索状态必须是干净的
  // —— 否则上次的查询词 + 结果面板会挂在页面上挡住按钮。
  useEffect(() => {
    setQuery('');
    setFocused(false);
    setActiveIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // —— 视频背景：窗口不可见 / 首页卸载时暂停，避免后台空转 ——
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (bg.kind !== 'video') return;
    const onVis = () => {
      const v = videoRef.current;
      if (!v) return;
      if (document.hidden) v.pause();
      else void v.play().catch(() => { /* 自动播放被拦时保持静帧 */ });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [bg.kind]);

  // —— 文字颜色自动反色 ——
  // 预设 / 渐变：直接解析颜色算亮度（**同步**，第一帧就对，不会先黑后白）
  useEffect(() => {
    if (bg.kind !== 'preset' && bg.kind !== 'gradient') return;
    const lum = cssLuminance(bgCss(bg));
    if (lum !== null) { const dark = lum < 0.5; setOnDark(dark); rememberOnDark(bg, dark); }
  }, [bg]);
  // 换背景时先用"记住的结果"预置一次，避免异步采样回来之前闪一下反色
  useEffect(() => {
    setOnDark(initialOnDark(bg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgSignature(bg)]);
  // 图片：加载后采样一次
  useEffect(() => {
    if (bg.kind !== 'image' || !bg.src.trim()) return;
    let alive = true;
    const img = new Image();
    if (isLocalMedia(bg.src)) img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive) return;
      const lum = frameLuminance(img);
      if (lum !== null) { const dark = lum < 0.5; setOnDark(dark); rememberOnDark(bg, dark); }
    };
    img.onerror = () => { if (alive) { setOnDark(true); rememberOnDark(bg, true); } };
    img.src = mediaSrc(bg.src);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bg.kind === 'image' ? bg.src : '', bg.kind]);
  // 视频：每 1.8s 采一帧（成本很低：24×24 缩放）
  useEffect(() => {
    if (bg.kind !== 'video') return;
    const tick = () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      const lum = frameLuminance(v);
      if (lum !== null) { const dark = lum < 0.5; setOnDark(dark); rememberOnDark(bg, dark); }
    };
    const t = window.setInterval(tick, 1800);
    window.setTimeout(tick, 600);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bg.kind === 'video' ? bg.src : '', bg.kind]);

  // —— 搜索结果 ——
  const q = query.trim();
  const projectHits = useMemo(() => {
    if (!q) return [];
    const k = q.toLowerCase();
    return projects
      .filter((p) => (p.name || '').toLowerCase().includes(k) || (p.fileName || '').toLowerCase().includes(k))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 6);
  }, [projects, q]);
  const docHits = useMemo<DocHit[]>(() => (q ? searchDocs(DOC_INDEX, q, 8) : []), [q]);

  const recent = useMemo(
    () => [...projects].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 6),
    [projects]
  );

  const totalHits = projectHits.length + docHits.length;
  useEffect(() => { setActiveIdx(0); }, [q]);

  const openProject = async (p: ProjectFileInfo) => {
    try {
      const res = await window.bc.openProjectFile(p.filePath);
      if (!res.ok || !res.project?.scene) {
        showToast('打开失败：' + (res.error || '文件可能已损坏'), 'err');
        return;
      }
      const st = useTabStore.getState();
      const existing = st.tabs.find((t) => t.filePath && normPath(t.filePath) === normPath(p.filePath));
      if (existing) {
        st.switchTab(existing.id);
        showToast(`「${existing.name}」已经打开着，已为你切换过去`);
      } else {
        // v0.4.5：**必须把 res.history 一起传进去** —— 首页「最近项目」这条路以前漏了，
        // 于是从这里打开的工程撤销栈是空的（用户反馈"重新打开项目 Ctrl+Z 完全无法执行"）。
        withViewTransition(() => st.newTab(p.name, res.project.scene, p.filePath, res.history));
      }
      setFocused(false);
    } catch (e) {
      showToast('打开失败：' + String(e), 'err');
    }
  };

  const openDocHit = (h: DocHit) => {
    window.dispatchEvent(new CustomEvent('bc:open-help-doc', { detail: { doc: h.doc, id: h.id } }));
    setFocused(false);
  };

  const activate = (idx: number) => {
    if (idx < projectHits.length) void openProject(projectHits[idx]);
    else {
      const h = docHits[idx - projectHits.length];
      if (h) openDocHit(h);
    }
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (totalHits ? (i + 1) % totalHits : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (totalHits ? (i - 1 + totalHits) % totalHits : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (totalHits) activate(activeIdx);
    } else if (e.key === 'Escape') {
      setQuery('');
      setFocused(false);
      inputRef.current?.blur();
    }
  };

  // —— 背景面板动作 ——
  const pickFile = async (kind: 'image' | 'video') => {
    try {
      const res = await window.bc.pickMediaSrc(kind);
      if (!res?.ok || !res.path) return;
      if (kind === 'image') {
        setImgSrc(res.path);
        applyBg({ kind: 'image', src: res.path, dim, blur });
        setTab('image');
      } else {
        // v0.4.5：先探一次能不能解码，解不了就别套用（否则每次进首页都刷 ffmpeg 错误）
        const playable = await probeVideoPlayable(mediaSrc(res.path));
        if (!playable) {
          showToast('这段视频的编码浏览器解不了（例如某些特殊像素格式），换一个 mp4 / webm 吧', 'err');
          return;
        }
        setVidSrc(res.path);
        applyBg({ kind: 'video', src: res.path, dim, blur });
        setTab('video');
      }
    } catch {
      showToast('选择文件失败', 'err');
    }
  };

  const setImage = (src: string, d = dim, b = blur) => {
    setImgSrc(src);
    if (src.trim()) applyBg({ kind: 'image', src: src.trim(), dim: d, blur: b });
  };
  const setVideo = (src: string, d = dim, b = blur) => {
    setVidSrc(src);
    if (src.trim()) applyBg({ kind: 'video', src: src.trim(), dim: d, blur: b });
  };

  // v0.4.5（用户反馈 A补）：设置面板以前是"条件渲染 → 直接消失"，没有退场。
  // 这里加一个 170ms 的收起过程：先挂 is-closing 播动画，再真正卸载。
  const [panelClosing, setPanelClosing] = useState(false);
  const closePanel = useCallback(() => {
    if (!panelOpen || panelClosing) return;
    setPanelClosing(true);
    window.setTimeout(() => {
      setPanelOpen(false);
      setPanelClosing(false);
    }, 170);
  }, [panelOpen, panelClosing]);

  const saveCurrent = () => {
    const name = saveName.trim() || `我的背景 ${saved.length + 1}`;
    const item: SavedBg = { id: 'bg-' + Date.now().toString(36), name, spec: bg };
    const next = [item, ...saved].slice(0, 24);
    setSaved(next);
    writePersisted(SAVED_KEY, next);
    setSaveName('');
    showToast(`已保存背景「${name}」`);
  };

  const removeSaved = (id: string) => {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    writePersisted(SAVED_KEY, next);
  };

  const isMedia = bg.kind === 'image' || bg.kind === 'video';
  const media = bg.kind === 'image' ? bg.src : bg.kind === 'video' ? bg.src : '';
  const mediaDim = bg.kind === 'image' || bg.kind === 'video' ? bg.dim : 0;
  const mediaBlur = bg.kind === 'image' || bg.kind === 'video' ? bg.blur : 0;

  return (
    <div
      className={'empty-home' + (leaving ? ' is-leaving' : '') + (onDark ? ' is-dark-bg' : '')}
      style={{ background: bgCss(bg) }}
    >
      {bg.kind === 'image' && (
        <div
          className="eh-media"
          style={{
            backgroundImage: `url("${mediaSrc(media)}")`,
            filter: mediaBlur > 0 ? `blur(${mediaBlur}px)` : undefined,
            transform: mediaBlur > 0 ? `scale(${(1 + mediaBlur / 400).toFixed(3)})` : undefined
          }}
        />
      )}
      {/* v0.4.5（A9）：已知解不了的视频**根本不挂载** <video>，
          否则每次进首页都会让原生解码器再报一次 Unsupported pixel format。 */}
      {bg.kind === 'video' && !badVideos.includes(bg.src) && (
        <video
          ref={videoRef}
          className="eh-media eh-video"
          src={mediaSrc(media)}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          crossOrigin={isLocalMedia(media) ? 'anonymous' : undefined}
          // v0.4.5：解码失败（例如 ffmpeg Unsupported pixel format）就回退到默认背景，
          // 并把这条坏配置从本地存储覆盖掉 —— 否则每次进首页都会重试、刷同一条错误。
          onError={() => {
            // 记进黑名单：以后连挂载都不挂，从根上不再触发原生解码错误
            markBadVideo(bg.src);
            setBadVideos((prev) => (prev.includes(bg.src) ? prev : [...prev, bg.src]));
            applyBg(DEFAULT_BG);
            showToast('这段视频的编码浏览器解不了，已切回默认背景（以后不会再尝试它）', 'err');
          }}
          style={{
            filter: mediaBlur > 0 ? `blur(${mediaBlur}px)` : undefined,
            transform: mediaBlur > 0 ? `scale(${(1 + mediaBlur / 400).toFixed(3)})` : undefined
          }}
        />
      )}
      {isMedia && <div className="eh-dim" style={{ opacity: mediaDim / 100 }} />}

      {/* 右上角：只有一枚齿轮，不写文字 */}
      <div className="eh-settings" ref={panelRef}>
        <button
          className={'eh-gear' + (panelOpen ? ' is-open' : '')}
          onClick={() => setPanelOpen((v) => !v)}
          title="页面设置"
          aria-label="页面设置"
        >
          <Icon name="gear" size={16} />
        </button>
        {panelOpen && (
          <div className={"eh-panel" + (panelClosing ? " is-closing" : "")}>
            <div className="eh-panel-head">
              <span>页面设置</span>
              <button className="eh-panel-x" onClick={closePanel} title="关闭">
                <Icon name="close" size={13} />
              </button>
            </div>
            <div className="eh-tabs">
              {([
                ['preset', '预设', 'palette'],
                ['gradient', '渐变', 'gradient'],
                ['image', '图片', 'image'],
                ['video', '视频', 'video']
              ] as const).map(([id, label, icon]) => (
                <button
                  key={id}
                  className={'eh-tab' + (tab === id ? ' is-active' : '')}
                  onClick={() => setTab(id)}
                >
                  <Icon name={icon} size={13} /> {label}
                </button>
              ))}
            </div>

            {tab === 'preset' && (
              <>
                <div className="eh-bggrid">
                  {BG_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      className={'eh-swatch' + (bg.kind === 'preset' && bg.value === p.value ? ' is-active' : '')}
                      style={{ background: p.value }}
                      title={p.label}
                      onClick={() => applyBg({ kind: 'preset', value: p.value })}
                    />
                  ))}
                  <label className="eh-swatch eh-swatch-color" title="自定义纯色">
                    <Icon name="plus" size={14} />
                    <input
                      type="color"
                      value={bg.kind === 'preset' && /^#[0-9a-f]{6}$/i.test(bg.value) ? bg.value : '#f4f7fb'}
                      onChange={(e) => applyBg({ kind: 'preset', value: e.target.value })}
                    />
                  </label>
                </div>
                {saved.length > 0 && (
                  <>
                    <div className="eh-sub">我的背景</div>
                    <div className="eh-bggrid">
                      {saved.map((s) => (
                        <span
                          key={s.id}
                          className="eh-swatch eh-saved"
                          title={s.name}
                          style={s.spec.kind === 'preset' || s.spec.kind === 'gradient'
                            ? { background: bgCss(s.spec) }
                            : undefined}
                          onClick={() => applyBg(s.spec)}
                        >
                          {s.spec.kind === 'image' && (
                            <i className="eh-saved-media" style={{ backgroundImage: `url("${mediaSrc(s.spec.src)}")` }} />
                          )}
                          {s.spec.kind === 'video' && (
                            <>
                              <video className="eh-saved-media" src={mediaSrc(s.spec.src)} muted preload="metadata" />
                              <span className="eh-saved-play"><Icon name="play" size={9} /></span>
                            </>
                          )}
                          <button
                            className="eh-saved-x"
                            title="删除这个背景"
                            onClick={(e) => { e.stopPropagation(); removeSaved(s.id); }}
                          >
                            <Icon name="close" size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {tab === 'gradient' && (
              <div className="eh-gradient-wrap">
                <GradientEditor
                  value={bg.kind === 'gradient' ? bg.css : gradCss}
                  onChange={(css) => {
                    setGradCss(css);
                    applyBg({ kind: 'gradient', css });
                  }}
                  onCommit={() => { /* 首页没有撤销栈，实时生效即可 */ }}
                  onRemove={() => applyBg(DEFAULT_BG)}
                  scope="background"
                />
                <div className="eh-save-row">
                  <input
                    className="eh-input"
                    placeholder="给这个背景起个名字"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                  />
                  <button className="eh-mini" onClick={saveCurrent}>保存</button>
                </div>
              </div>
            )}

            {tab === 'image' && (
              <>
                <div className="eh-row">
                  <input
                    className="eh-input"
                    placeholder="相对路径 / 绝对路径 / https 链接"
                    value={imgSrc}
                    onChange={(e) => setImage(e.target.value)}
                  />
                  <button className="eh-mini" onClick={() => pickFile('image')}>选择</button>
                </div>
                <div className="eh-row">
                  <span className="eh-label">遮罩</span>
                  <input
                    className="eh-range"
                    type="range"
                    min={0}
                    max={80}
                    value={dim}
                    onChange={(e) => { const v = Number(e.target.value); setDim(v); setImage(imgSrc, v, blur); }}
                  />
                  <span className="eh-val">{dim}%</span>
                </div>
                <div className="eh-row">
                  <span className="eh-label">模糊</span>
                  <input
                    className="eh-range"
                    type="range"
                    min={0}
                    max={24}
                    value={blur}
                    onChange={(e) => { const v = Number(e.target.value); setBlur(v); setImage(imgSrc, dim, v); }}
                  />
                  <span className="eh-val">{blur}px</span>
                </div>
                <div className="eh-save-row">
                  <input className="eh-input" placeholder="给这个背景起个名字" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
                  <button className="eh-mini" onClick={saveCurrent}>保存</button>
                </div>
                <div className="eh-panel-foot">填了路径 / 选了文件就立即生效，不需要再点「应用」。</div>
              </>
            )}

            {tab === 'video' && (
              <>
                <div className="eh-row">
                  <input
                    className="eh-input"
                    placeholder="视频路径 / https 链接（mp4 / webm / ogv）"
                    value={vidSrc}
                    onChange={(e) => setVideo(e.target.value)}
                  />
                  <button className="eh-mini" onClick={() => pickFile('video')}>选择</button>
                </div>
                <div className="eh-row">
                  <span className="eh-label">遮罩</span>
                  <input
                    className="eh-range"
                    type="range"
                    min={0}
                    max={80}
                    value={dim}
                    onChange={(e) => { const v = Number(e.target.value); setDim(v); setVideo(vidSrc, v, blur); }}
                  />
                  <span className="eh-val">{dim}%</span>
                </div>
                <div className="eh-row">
                  <span className="eh-label">模糊</span>
                  <input
                    className="eh-range"
                    type="range"
                    min={0}
                    max={24}
                    value={blur}
                    onChange={(e) => { const v = Number(e.target.value); setBlur(v); setVideo(vidSrc, dim, v); }}
                  />
                  <span className="eh-val">{blur}px</span>
                </div>
                <div className="eh-save-row">
                  <input className="eh-input" placeholder="给这个背景起个名字" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
                  <button className="eh-mini" onClick={saveCurrent}>保存</button>
                </div>
                <div className="eh-panel-foot">支持 mp4 / webm / ogv；窗口不可见时自动暂停，不占显卡。</div>
              </>
            )}

            <div className="eh-panel-foot">只影响首页，不会进入工程导出</div>
          </div>
        )}
      </div>

      {/* 中央偏上：Logo / 标题 / 搜索 / 快捷入口 / 最近项目 */}
      <div className="eh-center">
        <img className="eh-logo" src={logoUrl} alt="BlockCanvas" draggable={false} />
        <div className="eh-title">BlockCanvas</div>
        <div className="eh-sub">像搭积木一样做网页</div>

        <div className="eh-search" ref={searchRef}>
          <Icon name="search" size={17} className="eh-search-ico" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocused(true); }}
            onFocus={() => setFocused(true)}
            onKeyDown={onSearchKey}
            placeholder="搜索项目、使用手册、开发历程…"
            spellCheck={false}
          />
          {q && (
            <button className="eh-search-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }} title="清空">
              <Icon name="close" size={13} />
            </button>
          )}

          {focused && q && (
            <div className="eh-results">
              {totalHits === 0 && <div className="eh-empty-hit">没有找到「{q}」相关内容</div>}
              {projectHits.length > 0 && <div className="eh-hit-group">项目</div>}
              {projectHits.map((p, i) => (
                <button
                  key={p.filePath}
                  className={'eh-hit' + (activeIdx === i ? ' is-active' : '')}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => void openProject(p)}
                >
                  <Icon name="file" size={14} />
                  <span className="eh-hit-main">
                    <span className="eh-hit-title">{p.name}</span>
                    <span className="eh-hit-sub">{p.fileName}</span>
                  </span>
                  <span className="eh-hit-meta">{String(p.updatedAt).slice(0, 10)}</span>
                </button>
              ))}
              {docHits.length > 0 && <div className="eh-hit-group">文档</div>}
              {docHits.map((h, i) => {
                const idx = projectHits.length + i;
                return (
                  <button
                    key={h.doc + h.id}
                    className={'eh-hit' + (activeIdx === idx ? ' is-active' : '')}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => openDocHit(h)}
                  >
                    <Icon name={h.doc === 'manual' ? 'book' : h.doc === 'history' ? 'history' : 'home'} size={14} />
                    <span className="eh-hit-main">
                      <span className="eh-hit-title">{h.title}</span>
                      <span className="eh-hit-sub">{h.snippet}</span>
                    </span>
                    <span className="eh-hit-meta">{h.docLabel}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="eh-actions">
          <button className="eh-btn is-primary" onClick={() => props.onOpen()}>
            <Icon name="folderOpen" size={17} />
            <span>打开工程</span>
          </button>
          <button className="eh-btn" onClick={() => leave(props.onNew)}>
            <Icon name="plus" size={17} />
            <span>新建项目</span>
          </button>
          <button className="eh-btn" onClick={() => leave(props.onProjects)}>
            <Icon name="folderTree" size={17} />
            <span>全部项目</span>
          </button>
        </div>

        {recent.length > 0 && (
          <div className="eh-recent">
            <div className="eh-recent-title">最近打开</div>
            <div className="eh-recent-grid">
              {recent.map((p) => (
                <button key={p.filePath} className="eh-card" onClick={() => void openProject(p)} title={p.filePath}>
                  <span className="eh-card-ico"><Icon name="file" size={16} /></span>
                  <span className="eh-card-name">{p.name}</span>
                  <span className="eh-card-sub">{String(p.updatedAt).slice(0, 10)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
