import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { Icon } from './Icon';
import { useClosing } from '@lib/useClosing';
import { useShellLayout } from '@lib/shellMode';
import {
  DOCS,
  headingId,
  parseSections,
  searchDocs,
  type DocKey,
  type DocHit as Hit,
  type DocSection as Section
} from '@lib/docSearch';
export type { DocKey } from '@lib/docSearch';
// README 里引用的截图：显式 import 进来后会被 vite 打进产物，
// 于是**打包版**也能看到截图（否则 docs/ 不在 asar 里，图会全挂）。
import shotLogo from '../../../docs/screenshots/logo.png';
import shotEditor from '../../../docs/screenshots/editor-初始界面.png';
import shotLayout from '../../../docs/screenshots/layout-底部模板页.png';

// ============================================================================
// BlockCanvas · 帮助中心（v0.4.4d）
// ----------------------------------------------------------------------------
// 三份文档可切换：项目介绍（README.md）/ 使用手册（docs/使用手册.md）/ 开发历程（docs/开发历程.md）。
// "打包硬编码、运行直读"：
//   · 构建时：`import X from '...md?raw'` 把整篇内联进渲染层产物 → 打包版打开就有内容；
//   · 开发时：主进程 `help:get-doc` **实时读盘**，改完文档刷新页面就能看到，不用重新构建。
//
// Markdown 用 marked（MIT 许可，零依赖）渲染 —— 支持 GFM 全量语法。
// ⚠ README 里有 `<p align="center">` 这类原始 HTML（居中横幅 + 徽章），这里**保留 HTML 透传**
//   （README 是本仓库自带的可信文件，不是远端内容）。
//
// 搜索（v0.4.4d 重做）：不再只是"高亮第一处"，而是
//   · 把三份文档按标题切成一节一节的"段落块"建索引；
//   · 按**权重**（标题精确命中 > 标题包含 > 正文出现次数 > 标题层级）排序；
//   · 弹出一个结果框，点某条 → 自动切到对应文档并**跳到具体段落**（同时高亮命中词）。
// ============================================================================

/** 文档内部超链接 → 本帮助中心里的哪份文档（无法映射的返回 null，走"在 GitHub 查看"提示） */
function resolveDocLink(href: string): DocKey | null {
  let h = href;
  try { h = decodeURIComponent(href); } catch { /* 保持原样 */ }
  h = h.replace(/^\.\.?\//, '').replace(/^\.\//, '');
  if (/(^|\/)README\.md$/i.test(h)) return 'intro';
  if (/使用手册\.md$/.test(h)) return 'manual';
  if (/开发历程\.md$/.test(h)) return 'history';
  return null;
}

interface TocItem { id: string; text: string; level: number }

const SHOT_MAP: Record<string, string> = {
  'docs/screenshots/logo.png': shotLogo,
  './docs/screenshots/logo.png': shotLogo,
  'docs/screenshots/editor-初始界面.png': shotEditor,
  './docs/screenshots/editor-初始界面.png': shotEditor,
  'docs/screenshots/layout-底部模板页.png': shotLayout,
  './docs/screenshots/layout-底部模板页.png': shotLayout
};

/**
 * 在**塞进 DOM 之前**就把图片地址换掉（Chromium 一拿到 innerHTML 就会立刻去取 src）。
 * marked 会把中文文件名做 URL 编码，所以匹配前先 decodeURIComponent。
 */
function rewriteAssetSrc(html: string): string {
  return html.replace(/(src=")([^"]+)(")/g, (whole, pre: string, url: string, post: string) => {
    if (/^(https?:|data:|blob:|file:|bc-img:|\/|assets\/)/i.test(url)) return whole;
    let decoded = url;
    try { decoded = decodeURIComponent(url); } catch { /* 保持原样 */ }
    const mapped = SHOT_MAP[decoded] || SHOT_MAP[decoded.replace(/^\.\//, '')];
    if (mapped) return pre + mapped + post;
    return pre + 'bc-img:///' + url.replace(/^\.?\//, '') + post;
  });
}

/** 目录里不显示的章节（开发向内容，对普通用户没意义） */
const TOC_SKIP = ['项目声明', '许可证'];

/**
 * GitHub 风格的标题锚点（用于把文档里 `[xx](#某标题)` 的锚点链接对上）。
 * 例："13. 快捷键速查" → "13-快捷键速查"；"0. 五分钟上手" → "0-五分钟上手"。
 */
function anchorSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-');
}

/** 把 markdown 按标题切成"段落块"（用于建搜索索引）；先剥掉围栏代码块避免误判标题 */

// ============================================================================
// 文档跳转：滚到视口正中 + 黄色荧光笔标出关键词（v0.4.5 第 10 批重做）
// ----------------------------------------------------------------------------
// 用户反馈（A5）：「文档搜索关键词要黄色标记背景，现在只有一个淡入」+「定位有偏差」。
//
// 两个问题分别处理：
//  1. **定位偏差**：以前用 `el.offsetTop` 算目标位置 —— 它相对的是最近的**定位祖先**
//     （offsetParent），不一定是滚动容器；文档根里只要有一层 position:relative，
//     落点就会整体偏一段。现在改用两个 getBoundingClientRect() 的差值，与定位祖先无关。
//  2. **只有淡入没有黄色标记**：以前只加了一个 `.bc-doc-hit` 类，但**那个类根本没有样式**
//     （grep 全仓库只有 `.hc-hit` 有黄色背景）—— 所以看起来"只有淡入"。
//     现在：① 标题本身加黄色荧光笔底；② 小节内所有关键词都用 `<mark class="hc-hit">` 标出，
//     和搜索框里的高亮是同一套视觉。
// ============================================================================
const FLASH_CLASS = 'bc-doc-hit';
const FLASH_MS = 3200;

/** 把某个小节正文里的关键词包成 <mark class="hc-hit">（幂等：先拆掉旧的 mark） */
function markKeywordInSection(section: HTMLElement[], keyword: string): number {
  const q = keyword.trim().toLowerCase();
  if (!q || q.length < 2) return 0;
  let count = 0;
  for (const el of section) {
    // 先把上一次标过的还原成纯文本，避免反复跳转时嵌套 mark
    el.querySelectorAll('mark.hc-hit').forEach((m) => {
      const t = document.createTextNode(m.textContent || '');
      m.parentNode?.replaceChild(t, m);
    });
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    let n: Node | null = walker.nextNode();
    while (n) {
      const p = n.parentElement;
      const tag = p?.tagName;
      if (n.nodeValue && tag !== 'CODE' && tag !== 'PRE' && !p?.closest('.hc-hint')) {
        if (n.nodeValue.toLowerCase().includes(q)) targets.push(n as Text);
      }
      n = walker.nextNode();
    }
    for (const t of targets) {
      const text = t.nodeValue || '';
      const frag = document.createDocumentFragment();
      let from = 0;
      for (;;) {
        const at = text.toLowerCase().indexOf(q, from);
        if (at < 0) { frag.appendChild(document.createTextNode(text.slice(from))); break; }
        if (at > from) frag.appendChild(document.createTextNode(text.slice(from, at)));
        const mark = document.createElement('mark');
        mark.className = 'hc-hit';
        mark.textContent = text.slice(at, at + q.length);
        frag.appendChild(mark);
        count += 1;
        from = at + q.length;
      }
      t.parentNode?.replaceChild(frag, t);
    }
  }
  return count;
}

/**
 * 滚到"这个标题在小节里居中"的位置，并加荧光笔。
 * 位置用 rect 差值算（不依赖 offsetParent），所以不会再偏。
 */
function centerAndFlash(el: HTMLElement, scroller: HTMLElement) {
  const sr = scroller.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  // 目标：标题中心落在滚动容器中心偏上一点（上方留出上下文，读起来更自然）
  const delta = er.top - sr.top - Math.max(24, (scroller.clientHeight - er.height) / 2 - 40);
  const top = scroller.scrollTop + delta;
  scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  el.classList.remove(FLASH_CLASS);
  void el.offsetWidth; // 强制重排：连续点同一个结果也能重新播动画
  el.classList.add(FLASH_CLASS);
  window.setTimeout(() => el.classList.remove(FLASH_CLASS), FLASH_MS);
}

/** 目标小节的正文元素（标题之后、下一个同级或更高级标题之前的**真实 DOM 节点**） */
function sectionBodyOf(heading: HTMLElement): HTMLElement[] {
  const level = Number(/^H([1-4])$/.exec(heading.tagName)?.[1] ?? 4);
  const out: HTMLElement[] = [];
  let cur: Element | null = heading.nextElementSibling;
  while (cur) {
    const m = /^H([1-4])$/.exec(cur.tagName);
    if (m && Number(m[1]) <= level) break;
    if (cur instanceof HTMLElement) out.push(cur);
    cur = cur.nextElementSibling;
  }
  return out;
}

export function HelpCenter({ initialDoc = 'manual', initialTarget = null, onBack }: {
  initialDoc?: DocKey;
  /** 从首页搜索直达某份文档的某一节（q = 当时的搜索词，用来标黄关键词） */
  initialTarget?: { doc: DocKey; id: string; q?: string } | null;
  onBack: () => void;
}) {
  const [docKey, setDocKey] = useState<DocKey>(initialTarget?.doc ?? initialDoc);
  const [mdMap, setMdMap] = useState<Record<DocKey, string>>(
    () => Object.fromEntries(DOCS.map((d) => [d.key, d.bundled])) as Record<DocKey, string>
  );
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [closing, setClosing] = useState(false);
  /**
   * v0.4.6 竖屏：手册页的顶栏（文档页签 + 搜索）和左侧目录在 412px 里太挤，
   * 用户要求「下方第一层工具栏加一个侧边栏按钮，放到最左边，可以打开侧边栏，
   * 切换文档，搜索」。所以竖屏把这三样收进一个抽屉，由第一条栏最左那颗按钮开合。
   */
  const shell = useShellLayout();
  const stacked = shell.layout === 'stack';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /**
   * v0.4.6 第 45 批：竖屏手册侧边栏 —— **往左滑关闭 + 退场动画 + 可打断**。
   *
   * 用户原话：「使用手册右侧的菜单改成往左边滑动关闭，有退出动画和打断动画，
   *   现在退出无动画。」
   *
   * 之前它是 `{sidebarOpen && …}` 条件渲染：一关就整个卸载 → 退场动画根本没机会播，
   * 看起来就是"啪一下没了"。
   *
   * 现在分三层：
   *   · useClosing：关掉之后先留在 DOM 里播退场动画，播完才卸载；
   *   · 拖拽：手指按住抽屉往左拖，抽屉**跟着手指走**（位移写在 CSS 变量上，
   *     不走 React → 拖动跟手）；松手时按位移/速度决定是关闭还是弹回；
   *   · 可打断：退场动画播到一半再按住 → 从**当前位置**重新抓住继续拖，
   *     动画不跳帧、不回起点。
   */
  // 卸载延迟要**大于** CSS 里的滑出时长（--dur-drawer = 0.24s），
  // 否则最后 20ms 会被提前摘掉，看着就是滑到一半突然没了。
  const { mounted: drawerMounted, closing: drawerClosing } = useClosing(sidebarOpen, 320);
  const drawerRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ x0: number; y0: number; base: number; t0: number; axis: 'none' | 'x' | 'y' } | null>(null);
  const [dragging, setDragging] = useState(false);

  /** 抽屉宽度：既是"完全滑出"的距离，也是拖拽的上限 */
  const drawerW = () => drawerRef.current?.offsetWidth ?? 320;
  /** 位移写进 CSS 变量（0 = 完全展开，-宽度 = 完全滑出屏幕左侧） */
  const setDrawerX = (x: number) => drawerRef.current?.style.setProperty('--help-drawer-x', `${x}px`);
  /** 抽屉**此刻**的实际位移（退场动画播到一半时是半路值，打断要从这里接着抓） */
  const drawerXNow = () => {
    const el = drawerRef.current;
    if (!el) return 0;
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return 0;
    try { return new DOMMatrixReadOnly(t).m41; } catch { return 0; }
  };

  /**
   * 所有"关闭"入口（遮罩 / 右上叉 / 第一条栏那颗按钮）都走这里：
   * 先把抽屉**滑出去**再让 state 变 false —— 直接 setSidebarOpen(false) 的话
   * useClosing 只是延后 260ms 卸载，元素停在原地不动，看起来还是"啪一下没了"。
   */
  const closeDrawer = useCallback(() => {
    setDrawerX(-drawerW());
    setSidebarOpen(false);
  }, []);

  /**
   * 进场：**用 keyframes，不用变量过渡**。
   *
   * 踩过的坑：把 --help-drawer-x 从 -w 改到 0 靠 transition 播 —— 对"刚挂载"的元素
   * 不生效（首帧样式就是 0，浏览器不认为发生了从 -w 到 0 的变化），于是进场变成硬切。
   * 用户反馈「左边的菜单进入动画没有了」就是它。
   * 现在挂载后打 260ms 的 is-entering 类，交给 CSS keyframes 播；
   * 播完撤类，transform 回到变量（0），不会跳。
   */
  const [drawerEntering, setDrawerEntering] = useState(false);
  useEffect(() => {
    if (!drawerMounted || drawerClosing) { setDrawerEntering(false); return undefined; }
    if (dragRef.current) return undefined;
    setDrawerEntering(true);
    const t = window.setTimeout(() => setDrawerEntering(false), 260);
    return () => window.clearTimeout(t);
  }, [drawerMounted, drawerClosing]);
  const onDrawerDown = (e: React.PointerEvent) => {
    const el = drawerRef.current;
    if (!el) return;
    /**
     * v0.4.7：**必须抓指针**。
     * 用户反馈「现在滑动关闭不了，会回弹」—— 真机拖到一半手指已经离开抽屉
     * （抽屉跟手往左走，屏幕边缘之外没有可命中的元素），后续 pointermove / pointerup
     * 就全丢了：位移停在半路、松手事件也没人接，看起来就是"拖不动 / 弹回去"。
     * 探针用 dispatchEvent 直接打在 aside 上，所以一直显示通过 —— 这也是我漏掉它的原因。
     */
    try { el.setPointerCapture(e.pointerId); } catch { /* 老内核可能不支持 */ }
    // 退场动画途中被按住 → **从当前位置**重新抓住，动画不跳回起点、不回弹
    const base = drawerXNow();
    el.style.setProperty('--help-drawer-x', `${base}px`);
    dragRef.current = { x0: e.clientX, y0: e.clientY, base, t0: e.timeStamp, axis: 'none' };
    if (drawerClosing) setSidebarOpen(true);
  };

  const onDrawerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (d.axis === 'none') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // 方向锁：横着划归抽屉（滑动关闭），竖着划还给内容自己滚（目录很长）
      d.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (d.axis === 'y') { dragRef.current = null; return; }
      setDragging(true);
    }
    if (d.axis !== 'x') return;
    const w = drawerW();
    const next = d.base + dx;
    // 只往左滑有效；往右给 0.25 的阻尼（橡皮筋手感，不会真的把抽屉拽出容器）
    setDrawerX(next <= 0 ? Math.max(-w, next) : Math.min(w * 0.25, next * 0.25));
  };

  const onDrawerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    try { drawerRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    /** 真机一次滑过 30% 挺难的；22% 就已经是明确意图了（探针同步放宽） */
    setDragging(false);
    const w = drawerW();
    const x = drawerXNow();
    // 只是按了一下（没横向拖）也要有个交代：退场途中按住的，按"出去多少"决定去留。
    // 不处理的话抽屉会**停在半路**（-247px 那种），既不算开也不算关。
    if (!d || d.axis !== 'x') {
      if (x < -w * 0.5) closeDrawer();
      else setDrawerX(0);
      return;
    }
    const dt = Math.max(1, e.timeStamp - d.t0);
    // 速度要**带方向**：只有"往左甩"才算关闭意图。
    // 用 |位移| 的话，用户从半路往右拖回来（拖得急）也会被判成"甩出去"，
    // 明明救回来了却又被关掉（探针里就是这条翻的车）。
    const vx = (x - d.base) / dt;   // px/ms，<0 = 正在往左（关闭方向）
    // 关闭条件（都要"真的滑出去"才成立，避免轻轻一扫就关）：
    //   · 滑过 30% 宽度；或
    //   · 往左甩得很快（>0.8 px/ms）且已经出去 15% 宽度
    if (x < -w * 0.22 || (vx < -0.8 && x < -w * 0.12)) closeDrawer();
    else setDrawerX(0);
  };

  const openRef = useRef(false);
  openRef.current = sidebarOpen;
  useEffect(() => {
    const onToggle = () => { if (openRef.current) closeDrawer(); else setSidebarOpen(true); };
    window.addEventListener('bc:help-sidebar', onToggle);
    return () => window.removeEventListener('bc:help-sidebar', onToggle);
  }, [closeDrawer]);

  const docRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const tocJson = useRef('');
  const pendingJump = useRef<string>(initialTarget?.id ?? '');
  /** v0.4.5：跳转时要用黄色荧光笔标出的关键词（来自首页搜索） */
  const pendingKeyword = useRef<string>(initialTarget?.q ?? '');
  /** 标题锚点 slug → 元素 id（文档里的 `[x](#锚点)` 靠它跳转） */
  const slugMap = useRef<Map<string, string>>(new Map());

  const md = mdMap[docKey];
  const docDef = DOCS.find((d) => d.key === docKey)!;

  // 外部（菜单/事件）再次要求打开某份文档时同步切换
  useEffect(() => { setDocKey(initialDoc); }, [initialDoc]);

  // 关闭：先播退场动画，再真正切回编辑器（用户要的"开启退出动画"）
  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onBack(), 180);
  };

  // 开发态：读三份文档的磁盘最新版（打包态主进程返回 ok:false，就继续用内联的那份）
  useEffect(() => {
    let alive = true;
    DOCS.forEach((d) => {
      window.bc.getDoc(d.key)
        .then((r) => {
          if (!alive || !r?.ok || !r.text) return;
          setMdMap((prev) => ({ ...prev, [d.key]: r.text as string }));
        })
        .catch(() => { /* 保持内联版本 */ });
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      // 输入框里有搜索词：Esc 先只清搜索（不关页面）；已经空了就关页面
      if (inField && queryInput.trim()) {
        setQueryInput('');
        setQuery('');
        setShowResults(false);
        (t as HTMLInputElement).blur();
        return;
      }
      if (showResults) { setShowResults(false); return; }
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing, queryInput, showResults]);

  const html = useMemo(() => {
    try {
      marked.setOptions({ gfm: true, breaks: false });
      // README 第一行是 `# BlockCanvas · 积木画布`，下面紧跟一段居中横幅（原始 HTML 里的 <h1>），
      // 两个同级标题叠在一起很难看 —— 去掉开头那一行，让横幅当封面标题。
      const body = docKey === 'intro' ? md.replace(/^\uFEFF?#\s+[^\n]*\r?\n/, '') : md;
      return rewriteAssetSrc(marked.parse(body) as string);
    } catch {
      return '<p>Markdown 解析失败，已回退为纯文本。</p>';
    }
  }, [md, docKey]);

  // 搜索：防抖
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(queryInput), 160);
    return () => window.clearTimeout(t);
  }, [queryInput]);

  // 三份文档的搜索索引（按标题切段落块）
  const searchIndex = useMemo<Section[]>(() => {
    const all: Section[] = [];
    for (const d of DOCS) all.push(...parseSections(mdMap[d.key], d.key));
    return all;
  }, [mdMap]);

  const results = useMemo(() => searchDocs(searchIndex, query), [searchIndex, query]);

  // 点搜索框外部 → 收起结果框
  useEffect(() => {
    if (!showResults) return;
    const onDoc = (e: MouseEvent) => {
      if (searchRef.current?.contains(e.target as Node)) return;
      setShowResults(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showResults]);

  const flashDocHint = (root: HTMLElement, msg: string) => {
    const old = root.querySelector('.hc-hint');
    if (old) old.remove();
    const div = document.createElement('div');
    div.className = 'hc-hint';
    div.textContent = msg;
    root.insertBefore(div, root.firstChild);
    window.setTimeout(() => div.remove(), 4200);
  };

  const postProcess = (root: HTMLElement) => {
    const heads = Array.from(root.querySelectorAll('h1, h2, h3, h4')) as HTMLElement[];
    const items: TocItem[] = [];
    const slugs = new Map<string, string>();
    heads.forEach((h, i) => {
      const text = (h.textContent || '').trim();
      // 与搜索索引同一套 id 公式 → 点搜索结果能精确落到这一节
      h.id = headingId(docKey, i, text);
      // 额外记一份"GitHub 风格锚点" → 文档里的 #锚点 链接也能跳
      const slug = anchorSlug(text);
      if (slug && !slugs.has(slug)) slugs.set(slug, h.id);
      const level = Number(h.tagName.slice(1));
      if (level <= 3 && !TOC_SKIP.some((s) => text.includes(s))) {
        items.push({ id: h.id, text, level });
      }
    });
    slugMap.current = slugs;
    const next = JSON.stringify(items);
    if (next !== tocJson.current) {
      tocJson.current = next;
      setToc(items);
    }

    root.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      const mapped = SHOT_MAP[src];
      if (mapped) img.setAttribute('src', mapped);
      else if (src && !/^(https?:|data:|blob:|file:|bc-img:|assets\/|\/assets)/i.test(src)) {
        img.setAttribute('src', 'bc-img:///' + src.replace(/^\.?\//, ''));
      }
      img.setAttribute('loading', 'lazy');
      img.setAttribute('referrerpolicy', 'no-referrer');
      const hide = () => { (img as HTMLElement).style.display = 'none'; };
      img.addEventListener('error', hide, { once: true });
      if (img.complete && img.naturalWidth === 0) hide();
    });

    root.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href') || '';
      a.removeAttribute('target');
      a.setAttribute('rel', 'noreferrer');
      if (/^https?:\/\//i.test(href)) {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          void window.bc.openExternal(href);
        });
      } else if (href.startsWith('#')) {
        // 文档内锚点：先按 GitHub 风格 slug 找，找不到再按原样找
        a.addEventListener('click', (e) => {
          e.preventDefault();
          let raw = href.slice(1);
          try { raw = decodeURIComponent(raw); } catch { /* 保持原样 */ }
          const mapped = slugMap.current.get(anchorSlug(raw)) || slugMap.current.get(raw) || raw;
          const target = root.querySelector('#' + CSS.escape(mapped)) as HTMLElement | null;
          const scroller = scrollRef.current;
          if (target && scroller) {
            scroller.scrollTo({ top: Math.max(0, target.offsetTop - 24), behavior: 'smooth' });
            setActiveId(target.id);
          } else {
            flashDocHint(root, `没找到「${raw}」对应的章节。`);
          }
        });
      } else if (href) {
        // 仓库内的相对文档链接：能在帮助中心里切过去的就直接切（README / 使用手册 / 开发历程），
        // 其余的（扩展规范、功能规划…）不随软件分发 → 给个明确反馈
        const target = resolveDocLink(href);
        a.addEventListener('click', (e) => {
          e.preventDefault();
          if (target) { switchDoc(target); return; }
          flashDocHint(root, `「${href}」在仓库 docs/ 目录里（不随软件分发），可在 GitHub 上查看。`);
        });
      }
    });

    // Markdown 表格宽度可能超出：包一层横向滚动容器（滚轮即可左右滚）
    root.querySelectorAll('table').forEach((tb) => {
      const parent = tb.parentElement;
      if (!parent || parent.classList.contains('hc-table-wrap')) return;
      const wrap = document.createElement('div');
      wrap.className = 'hc-table-wrap bc-hscroll';
      parent.insertBefore(wrap, tb);
      wrap.appendChild(tb);
    });
  };

  // 内容变化 / 切换文档 → 后处理 + 搜索高亮
  useEffect(() => {
    const root = docRef.current;
    if (!root) return;
    root.innerHTML = html;
    postProcess(root);
    if (!query.trim()) { setHits(0); return; }
    const q = query.trim().toLowerCase();
    let count = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    let n: Node | null = walker.nextNode();
    while (n) {
      const el = n.parentElement;
      const parentTag = el?.tagName;
      if (n.nodeValue && parentTag !== 'CODE' && parentTag !== 'PRE' && !el?.closest('.hc-hint')) {
        if (n.nodeValue.toLowerCase().includes(q)) targets.push(n as Text);
      }
      n = walker.nextNode();
    }
    for (const t of targets) {
      const text = t.nodeValue || '';
      const frag = document.createDocumentFragment();
      let from = 0;
      for (;;) {
        const at = text.toLowerCase().indexOf(q, from);
        if (at < 0) { frag.appendChild(document.createTextNode(text.slice(from))); break; }
        if (at > from) frag.appendChild(document.createTextNode(text.slice(from, at)));
        const mark = document.createElement('mark');
        mark.className = 'hc-hit';
        mark.textContent = text.slice(at, at + q.length);
        frag.appendChild(mark);
        count += 1;
        from = at + q.length;
      }
      t.parentNode?.replaceChild(frag, t);
    }
    setHits(count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, html]);

  // 待跳转（点搜索结果）→ 内容渲染完成后滚动到目标段落
  // v0.4.5 第 10 批：① 落点位置改用 rect 差值算（不再受 offsetParent 影响）；
  // ② 关键词用**黄色荧光笔**标出来（以前只加了个没有样式的类，看起来只有淡入）。
  useEffect(() => {
    if (!pendingJump.current) return;
    const id = pendingJump.current;
    const kw = pendingKeyword.current;
    const t = window.setTimeout(() => {
      const el = docRef.current?.querySelector('#' + CSS.escape(id)) as HTMLElement | null;
      const scroller = scrollRef.current;
      if (el && scroller) {
        // 先标黄（会影响行高，所以要**在滚动之前**做，否则落点会偏）
        if (kw) markKeywordInSection([el, ...sectionBodyOf(el)], kw);
        centerAndFlash(el, scroller);
        setActiveId(id);
        // 关键词标在正文里时，再把第一个 mark 也闪一下（视觉焦点更明确）
        const first = el.parentElement?.querySelector('mark.hc-hit') as HTMLElement | null;
        if (first) {
          first.classList.add('is-focus');
          window.setTimeout(() => first.classList.remove('is-focus'), FLASH_MS);
        }
      }
      pendingJump.current = '';
      pendingKeyword.current = '';
    }, 60);
    return () => window.clearTimeout(t);
  }, [html, docKey]);

  // 滚动联动：高亮当前所在章节
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const heads = Array.from(docRef.current?.querySelectorAll('h1, h2, h3') ?? []) as HTMLElement[];
      let cur = heads[0]?.id ?? '';
      for (const h of heads) {
        if (h.offsetTop - scroller.scrollTop <= 110) cur = h.id; else break;
      }
      setActiveId(cur);
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [toc, docKey]);

  const jumpTo = (id: string) => {
    setSidebarOpen(false); // 竖屏抽屉里点了目录就收起来，别挡正文
    const el = docRef.current?.querySelector('#' + CSS.escape(id)) as HTMLElement | null;
    const scroller = scrollRef.current;
    if (!el || !scroller) return;
    scroller.scrollTo({ top: Math.max(0, el.offsetTop - 24), behavior: 'smooth' });
  };

  /** 点搜索结果：切到对应文档 + 跳到段落 + 高亮 */
  const goHit = (h: Hit) => {
    setShowResults(false);
    setSidebarOpen(false);
    setQueryInput(h.title);
    setQuery(h.title);
    if (h.doc !== docKey) {
      pendingJump.current = h.id;
      setDocKey(h.doc);
    } else {
      jumpTo(h.id);
      setActiveId(h.id);
    }
  };

  const switchDoc = (k: DocKey) => {
    if (k === docKey) return;
    setSidebarOpen(false);
    tocJson.current = '';
    setToc([]);
    setActiveId('');
    setDocKey(k);
    const sc = scrollRef.current;
    if (sc) sc.scrollTo({ top: 0 });
  };

  // —— 三块可复用的小部件（宽屏放顶栏/左栏，竖屏全收进抽屉）——
  const brandBlock = (
    <div className="help-brand">
      <span className="help-brand-logo"><Icon name={docDef.icon} size={18} /></span>
      <span className="help-brand-text">{docDef.label}</span>
    </div>
  );
  const tabsBlock = (
    <div className="help-doc-tabs">
      {DOCS.map((d) => (
        <button
          key={d.key}
          className={'help-doc-tab' + (d.key === docKey ? ' active' : '')}
          onClick={() => switchDoc(d.key)}
          title={`查看《${d.label}》`}
        >
          <span className="help-doc-tab-ico"><Icon name={d.icon} size={15} /></span>{d.label}
        </button>
      ))}
    </div>
  );
  const searchBlock = (
    <div className="help-search" ref={searchRef}>
      <span className="help-search-ico" aria-hidden="true"><Icon name="search" size={15} /></span>
      <input
        className="help-search-input"
        type="text"
        value={queryInput}
        placeholder="搜索三份文档（回车/点结果跳转）"
        onChange={(e) => { setQueryInput(e.target.value); setShowResults(true); }}
        onFocus={() => { if (queryInput.trim()) setShowResults(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setQueryInput(''); setQuery(''); setShowResults(false); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Enter' && results[0]) goHit(results[0]);
        }}
      />
      {queryInput.trim() && (
        <span
          className={'help-search-count' + (hits === 0 ? ' is-empty' : '')}
          title={hits === 0 ? '当前文档没有匹配' : `当前文档命中 ${hits} 处`}
        >
          {hits === 0 ? '没有匹配' : `${hits} 处`}
        </span>
      )}
      {/* 搜索结果下拉框（按权重排序） */}
      {showResults && queryInput.trim() && (
        <div className="help-results bc-scroll">
          {results.length === 0 && <div className="help-results-empty">没有找到「{queryInput.trim()}」相关内容</div>}
          {results.map((h) => (
            <button key={h.doc + h.id} className="help-result" onClick={() => goHit(h)}>
              <div className="help-result-top">
                <span className="help-result-doc">{h.docLabel}</span>
                <span className={'help-result-title lv' + h.level}>{h.title}</span>
              </div>
              <div className="help-result-snippet">{h.snippet}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
  const tocBlock = (
    <aside className="help-toc bc-hscroll">
      <div className="help-toc-title">目录（{toc.length} 节）</div>
      {toc.map((t) => (
        <button
          key={t.id}
          className={'help-toc-item lv' + t.level + (activeId === t.id ? ' active' : '')}
          onClick={() => jumpTo(t.id)}
          title={t.text}
        >{t.text}</button>
      ))}
      {toc.length === 0 && <div className="help-toc-empty">正在解析文档…</div>}
    </aside>
  );

  return (
    <div className={'help-page' + (closing ? ' is-closing' : '')}>
      {/* 竖屏不渲染顶栏：品牌/页签/搜索都在抽屉里（见下） */}
      {!stacked && (
        <div className="help-topbar">
          <button className="fluent-back-btn" onClick={close} title="返回编辑器 (Esc)">
            <Icon name="chevronLeft" size={14} /> 返回编辑器
          </button>
          {brandBlock}
          {tabsBlock}
          {searchBlock}
        </div>
      )}

      {/* 竖屏侧边栏抽屉：切换文档 / 搜索 / 目录（用户要求收在这里）。
          v0.4.6 第 45 批：**往左滑关闭**（跟手）+ 退场动画 + 可打断。
          · mounted 由 useClosing 管：关掉后先留 DOM 播退场，播完才卸载；
          · 位移写在 --help-drawer-x 上（不走 React → 拖起来跟手）；
          · is-dragging 期间关掉 transition，否则会"追着手指慢慢挪"。 */}
      {stacked && drawerMounted && (
        <>
          <div
            className={'help-drawer-scrim' + (drawerClosing ? ' is-closing' : '')}
            onClick={closeDrawer}
          />
          <aside
            ref={drawerRef}
            className={'help-drawer' + (drawerClosing ? ' is-closing' : '') + (dragging ? ' is-dragging' : '') + (drawerEntering ? ' is-entering' : '')}
            role="dialog"
            aria-label="手册侧边栏"
            aria-hidden={drawerClosing}
            onPointerDown={onDrawerDown}
            onPointerMove={onDrawerMove}
            onPointerUp={onDrawerUp}
            onPointerCancel={onDrawerUp}
          >
            {/* 没有关闭按钮：用户要求"按住侧边栏往左滑"关闭（点遮罩也行） */}
            <div className="help-drawer-head">
              {brandBlock}
            </div>
            {tabsBlock}
            {searchBlock}
            <div className="help-drawer-toc">{tocBlock}</div>
          </aside>
        </>
      )}

      <div className="help-body">
        {!stacked && tocBlock}

        <div className="help-scroll bc-scroll" ref={scrollRef}>
          <div className="help-doc" ref={docRef} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
