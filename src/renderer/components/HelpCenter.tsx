import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import README_BUNDLED from '../../../README.md?raw';
// README 里引用的三张图：显式 import 进来后会被 vite 打进产物，
// 于是**打包版**也能看到截图（否则 docs/ 不在 asar 里，图会全挂）。
import shotLogo from '../../../docs/screenshots/logo.png';
import shotEditor from '../../../docs/screenshots/editor-初始界面.png';
import shotLayout from '../../../docs/screenshots/layout-底部模板页.png';

// BlockCanvas · 帮助中心（v0.4.4）
// ----------------------------------------------------------------------------
// 内容 = 项目的 README.md，**不另写一份**（省得两处不同步）。
// "打包硬编码、运行直读"是这样落地的：
//   · 构建时：`import README_BUNDLED from '../../../README.md?raw'` 把整篇内联进渲染层产物
//     → 打包版（asar 里没有 docs/、README）打开就有内容；
//   · 开发时：主进程 `help:get-readme` **实时读盘**，改完 README 刷新页面就能看到，
//     不用重新构建（页眉会标出当前用的是哪一份）。
//
// Markdown 用 marked（MIT 许可，零依赖）渲染 —— 支持 GFM 全量语法：
// 标题 / 表格 / 任务列表 / 嵌套列表 / 代码块 / 引用 / 分隔线 / 行内样式 / 自动链接等。
// ⚠ 因为 README 里有 `<p align="center">` 这类原始 HTML（居中横幅 + 徽章），
//   这里**保留 HTML 透传**；README 是本仓库自带的可信文件，不是远端内容。
//   （远端发行说明走 UpdateCenter 里那套白名单解析器，从不产生原始 HTML。）

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
 * 在**塞进 DOM 之前**就把图片地址换掉。
 * 为什么不能等渲染完再改：Chromium 一拿到 innerHTML 就会立刻去取 `src`，
 * 于是 `docs/screenshots/x.png` 会先按当前页面地址发一次 `file://…/out/renderer/docs/...`
 * → 必然 ERR_FILE_NOT_FOUND（控制台报错、图片位置闪一下空框），改也来不及。
 * 另外 **marked 会把中文文件名做 URL 编码**（`editor-初始界面.png` → `editor-%E5%88%9D…`），
 * 所以匹配前必须先 decodeURIComponent。
 */
function rewriteAssetSrc(html: string): string {
  return html.replace(/(src=")([^"]+)(")/g, (whole, pre: string, url: string, post: string) => {
    if (/^(https?:|data:|blob:|file:|bc-img:|\/|assets\/)/i.test(url)) return whole;
    let decoded = url;
    try { decoded = decodeURIComponent(url); } catch { /* 保持原样 */ }
    const mapped = SHOT_MAP[decoded] || SHOT_MAP[decoded.replace(/^\.\//, '')];
    if (mapped) return pre + mapped + post;
    // 其它相对路径 → 交给主进程注册的本地图片协议（开发态能定位到仓库里的原型文件）
    return pre + 'bc-img:///' + url.replace(/^\.?\//, '') + post;
  });
}

/** 目录里不显示的章节（开发向内容，对普通用户没意义） */
const TOC_SKIP = ['项目声明', '许可证'];

function slugOf(text: string, i: number): string {
  return 'hc-' + i + '-' + text.replace(/[^\w\u4e00-\u9fa5]+/g, '-').slice(0, 24);
}

export function HelpCenter({ onBack }: { onBack: () => void }) {
  const [md, setMd] = useState<string>(README_BUNDLED);
  const [srcLabel, setSrcLabel] = useState<string>('随程序打包（构建时内联）');
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(0);
  const [closing, setClosing] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tocJson = useRef('');

  // 关闭：先播退场动画，再真正切回编辑器（用户要的"开启退出动画"）
  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onBack(), 180);
  };

  // 开发态：读磁盘上的 README（打包态主进程会返回 ok:false，就继续用内联的那份）
  useEffect(() => {
    let alive = true;
    window.bc.getReadme()
      .then((r) => {
        if (!alive || !r?.ok || !r.text) return;
        setMd(r.text);
        setSrcLabel(r.source === 'disk' ? '开发态实时读盘（改完 README 刷新即见）' : '随程序打包（构建时内联）');
      })
      .catch(() => { /* 保持内联版本 */ });
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
        (t as HTMLInputElement).blur();
        return;
      }
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing, queryInput]);

  const html = useMemo(() => {
    try {
      marked.setOptions({ gfm: true, breaks: false });
      // README 第一行是 `# BlockCanvas · 积木画布`，下面紧跟一段居中横幅（原始 HTML 里的 <h1>），
      // 两个同级标题叠在一起很难看 —— 去掉开头那一行，让横幅当封面标题。
      const body = md.replace(/^\uFEFF?#\s+[^\n]*\r?\n/, '');
      return rewriteAssetSrc(marked.parse(body) as string);
    } catch {
      return '<p>Markdown 解析失败，已回退为纯文本。</p>';
    }
  }, [md]);

  // 搜索：把命中的文字包进 <mark>（清空搜索时用原始 HTML 还原）
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(queryInput), 180);
    return () => window.clearTimeout(t);
  }, [queryInput]);

  // 渲染后处理：标题 id / 图片路径 / 链接行为 / 表格横向滚动
  // —— 做成幂等的，搜索还原 innerHTML 之后可以再跑一遍
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
    heads.forEach((h, i) => {
      if (!h.id) h.id = slugOf(h.textContent || '', i);
      const level = Number(h.tagName.slice(1));
      const text = (h.textContent || '').trim();
      if (level <= 3 && !TOC_SKIP.some((s) => text.includes(s))) {
        items.push({ id: h.id, text, level });
      }
    });
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
        // 相对路径 → 走主进程注册的本地图片协议（开发态能定位到仓库里的原型文件）
        img.setAttribute('src', 'bc-img:///' + src.replace(/^\.?\//, ''));
      }
      img.setAttribute('loading', 'lazy');
      img.setAttribute('referrerpolicy', 'no-referrer');
      const hide = () => { (img as HTMLElement).style.display = 'none'; };
      img.addEventListener('error', hide, { once: true });
      // 离线时 shields.io 徽章 / 缺图会失败：已经失败过的直接藏起来，别留破图
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
      } else if (href && !href.startsWith('#')) {
        // 仓库内的相对文件（docs/xxx.md）没有随程序分发 → 给个明确反馈，别静默跳走
        a.addEventListener('click', (e) => {
          e.preventDefault();
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

  // 内容变化 / 首次渲染 → 后处理（搜索为空时就是"还原"）
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
    const first = root.querySelector('mark.hc-hit');
    const scroller = scrollRef.current;
    if (first && scroller) {
      const top = (first as HTMLElement).offsetTop - scroller.clientHeight / 3;
      scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, html]);

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
  }, [toc]);

  const jumpTo = (id: string) => {
    const el = docRef.current?.querySelector('#' + CSS.escape(id)) as HTMLElement | null;
    const scroller = scrollRef.current;
    if (!el || !scroller) return;
    scroller.scrollTo({ top: Math.max(0, el.offsetTop - 24), behavior: 'smooth' });
  };

  return (
    <div className={'help-page' + (closing ? ' is-closing' : '')}>
      <div className="help-topbar">
        <button className="fluent-back-btn" onClick={close} title="返回编辑器 (Esc)">← 返回编辑器</button>
        <div className="help-brand">
          <span className="help-brand-logo">📖</span>
          <span className="help-brand-text">使用手册</span>
        </div>
        <div className="help-search">
          <span className="help-search-ico" aria-hidden="true">🔍</span>
          <input
            className="help-search-input"
            type="text"
            value={queryInput}
            placeholder="在手册里查找…（输入即高亮，跳到第一处）"
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setQueryInput(''); setQuery(''); (e.target as HTMLInputElement).blur(); }
            }}
          />
          {queryInput.trim() && (
            <span className={'help-search-count' + (hits === 0 ? ' is-empty' : '')}>
              {hits === 0 ? '没有匹配' : `${hits} 处`}
            </span>
          )}
        </div>
        <span className="help-src" title="帮助内容直接取自项目根目录的 README.md">
          内容来源：README.md · {srcLabel}
        </span>
      </div>

      <div className="help-body">
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

        <div className="help-scroll bc-scroll" ref={scrollRef}>
          <div className="help-doc" ref={docRef} dangerouslySetInnerHTML={{ __html: html }} />
          <div className="help-foot">
            这一页的内容就是项目根目录的 <code>README.md</code> —— 想改手册内容，直接改那个文件即可。
          </div>
        </div>
      </div>
    </div>
  );
}
