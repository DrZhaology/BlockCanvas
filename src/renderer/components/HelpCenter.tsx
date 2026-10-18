import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { Icon } from './Icon';
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

export function HelpCenter({ initialDoc = 'manual', initialTarget = null, onBack }: {
  initialDoc?: DocKey;
  /** 从首页搜索直达某份文档的某一节 */
  initialTarget?: { doc: DocKey; id: string } | null;
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
  const docRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const tocJson = useRef('');
  const pendingJump = useRef<string>(initialTarget?.id ?? '');
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
  useEffect(() => {
    if (!pendingJump.current) return;
    const id = pendingJump.current;
    const t = window.setTimeout(() => {
      const el = docRef.current?.querySelector('#' + CSS.escape(id)) as HTMLElement | null;
      const scroller = scrollRef.current;
      if (el && scroller) {
        scroller.scrollTo({ top: Math.max(0, el.offsetTop - 24), behavior: 'smooth' });
        setActiveId(id);
      }
      pendingJump.current = '';
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
    const el = docRef.current?.querySelector('#' + CSS.escape(id)) as HTMLElement | null;
    const scroller = scrollRef.current;
    if (!el || !scroller) return;
    scroller.scrollTo({ top: Math.max(0, el.offsetTop - 24), behavior: 'smooth' });
  };

  /** 点搜索结果：切到对应文档 + 跳到段落 + 高亮 */
  const goHit = (h: Hit) => {
    setShowResults(false);
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
    tocJson.current = '';
    setToc([]);
    setActiveId('');
    setDocKey(k);
    const sc = scrollRef.current;
    if (sc) sc.scrollTo({ top: 0 });
  };

  return (
    <div className={'help-page' + (closing ? ' is-closing' : '')}>
      <div className="help-topbar">
        <button className="fluent-back-btn" onClick={close} title="返回编辑器 (Esc)">
          <Icon name="chevronLeft" size={14} /> 返回编辑器
        </button>
        <div className="help-brand">
          <span className="help-brand-logo"><Icon name={docDef.icon} size={18} /></span>
          <span className="help-brand-text">{docDef.label}</span>
        </div>
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
        </div>
      </div>
    </div>
  );
}
