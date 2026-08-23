import { useEffect, useRef, useState } from 'react';
import { useScene } from '@store/sceneStore';
import type { ElementType } from '@lib/types';
import { exportHTML } from '@lib/exporter';

// BlockCanvas · 元素面板
// 阶段1：按类别分组，点击插入选中元素的父级（或根）
// 阶段3・第二批：「元素 | 模板」双页签。模板来自扩展的"资源包"
// 阶段4・4-F：模板页升级 ——
//   - 仍在左侧面板内（切到「模板」时面板自动加宽，遮罩删除）
//   - 每个资源包 = 一个大板块，三角形小箭头（▸/▾）点击折叠/展开，默认展开
//   - 顶部搜索框：按模板名/描述/资源包名过滤，× 清空
//   - 模板显示为运行时渲染缩略图：模板树 → exportHTML → iframe srcdoc，
//     按内容真实比例自动缩放贴合所在列宽（不再固定尺寸拉伸/留白），随窗口宽度自适应列数

type ElementDef = { type: ElementType; label: string; hint?: string };

const GROUPS: { title: string; items: ElementDef[] }[] = [
  {
    title: '容器',
    items: [
      { type: 'div', label: '通用容器' },
      { type: 'section', label: '区块' },
      { type: 'header', label: '页眉' },
      { type: 'nav', label: '导航' },
      { type: 'main', label: '主区' },
      { type: 'article', label: '文章' },
      { type: 'aside', label: '侧栏' },
      { type: 'footer', label: '页脚' }
    ]
  },
  {
    title: '文本',
    items: [
      { type: 'h1', label: '标题1' },
      { type: 'h2', label: '标题2' },
      { type: 'h3', label: '标题3' },
      { type: 'h4', label: '标题4' },
      { type: 'p', label: '段落' },
      { type: 'span', label: '行内文字' },
      { type: 'label', label: '标签' },
      { type: 'a', label: '链接' }
    ]
  },
  {
    title: '列表',
    items: [
      { type: 'ul', label: '无序列表' },
      { type: 'ol', label: '有序列表' },
      { type: 'li', label: '列表项' }
    ]
  },
  {
    title: '表单与交互',
    items: [
      { type: 'button', label: '按钮' },
      { type: 'input', label: '输入框' },
      { type: 'textarea', label: '文本域' },
      { type: 'form', label: '表单容器' }
    ]
  },
  {
    title: '其他',
    items: [
      { type: 'img', label: '图片' },
      { type: 'hr', label: '分割线' }
    ]
  }
];

type ScanResult = {
  plugins: { id: string; name: string; version: string; author: string; description: string; enabled: boolean; error: string | null }[];
  resources: {
    id: string; name: string; version: string; author: string; description: string;
    templates: { id: string; name: string; description: string }[];
    enabled: boolean; error: string | null;
  }[];
  errors: string[];
};

// 缩略图基准宽：优先取模板 root 自带 style.width；没有则用 1280（让响应式模板依屏幕宽表现，
// 而非塞进 320 固定窄壳）。实际渲染宽通过 scrollWidth 充触，scale 让整张元素尽量完整显示。
const THUMB_FALLBACK_W = 1280;
const THUMB_MAX_H = 260; // 设计高度上限（超过裁掉底部，防止漏斗型长页面把卡片拉得过高）
const THUMB_VIEW_H = 150; // 缩略图可视区高度上限
const THUMB_MAX_W = THUMB_FALLBACK_W * 2; // 内容宽度上限

export function ElementPanel() {
  const addElement = useScene((s) => s.addElement);
  const selectedId = useScene((s) => s.scene.selectedId);
  const insertTemplate = useScene((s) => s.insertTemplate);
  const [tab, setTab] = useState<'element' | 'templates'>('element');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);

  const rescan = () => window.bc.scanExtensions().then((r) => setScan(r));

  useEffect(() => { rescan(); }, []);

  const onInsertTemplate = async (resId: string, tplId: string) => {
    setBusy(true);
    try {
      const res = await window.bc.readTemplate(resId, tplId);
      if (!res.ok || !res.template) {
        alert('模板加载失败：' + (res.error ?? '未知错误'));
        return;
      }
      insertTemplate(res.template, selectedId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={"panel element-panel" + (tab === 'templates' ? ' tpl-mode' : '')}>
      <div className="inspector-tabs">
        <button
          className={"inspector-tab" + (tab === 'element' ? ' active' : '')}
          onClick={() => setTab('element')}
        >元素</button>
        <button
          className={"inspector-tab" + (tab === 'templates' ? ' active' : '')}
          onClick={() => setTab('templates')}
        >模板</button>
      </div>

      {tab === 'element' && (
        <>
          <div className="panel-title">元素</div>
          <div className="hint" style={{ marginBottom: 10 }}>
            {selectedId ? '点击按钮插入到当前选中元素的内部' : '点击按钮插入到画布根'}
          </div>
          <div className="element-body">
            {GROUPS.map((g) => (
              <div key={g.title} className="element-group">
                <div className="group-title">{g.title}</div>
                <div className="element-grid">
                  {g.items.map((it) => (
                    <button
                      key={it.type}
                      className="element-btn"
                      onClick={() => addElement(it.type, selectedId)}
                      title={`插入 ${it.label}${it.hint ? ' (' + it.hint + ')' : ''}`}
                    >
                      {it.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'templates' && (
        <div className="tpl-body">
          <TemplateLibrary
            scan={scan}
            busy={busy}
            onInsert={onInsertTemplate}
          />
        </div>
      )}
    </div>
  );
}

// ============ 模板库（4-F：面板内嵌，无遮罩） ============
function TemplateLibrary(props: {
  scan: ScanResult | null;
  busy: boolean;
  onInsert: (resId: string, tplId: string) => void;
}) {
  const { scan, busy, onInsert } = props;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<{ resId: string; tpl: { id: string; name: string; description: string } } | null>(null);

  const toggleCollapsed = (resId: string) => {
    setCollapsed((prev) => ({ ...prev, [resId]: !prev[resId] }));
  };

  const kw = search.trim().toLowerCase();
  // 只展示启用的资源包（禁用 = 隐藏，文件保留）
  const enabledResources = scan ? scan.resources.filter((r) => r.enabled) : [];
  const filtered = scan
    ? enabledResources
        .map((r) => ({
          ...r,
          templates: r.templates.filter(
            (t) => !kw
              || t.name.toLowerCase().includes(kw)
              || (t.description ?? '').toLowerCase().includes(kw)
              || r.name.toLowerCase().includes(kw)
          )
        }))
        .filter((r) => r.templates.length > 0 || !kw)
    : [];

  const total = enabledResources.reduce((n, r) => n + r.templates.length, 0) ?? 0;

  return (
    <>
      <div className="panel-title">
        模板库
        <span className="group-sub">{scan ? `共 ${total} 个` : '扫描中…'}</span>
      </div>
      <div className="tpl-search-row">
        <input
          className="tpl-search-input"
          placeholder="搜索模板名称/描述/资源包…"
          value={search}
          spellCheck={false}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search !== '' && (
          <button className="tpl-search-clear" title="清空搜索" onClick={() => setSearch('')}>×</button>
        )}
      </div>
      {!scan && <div className="hint">正在扫描扩展目录…</div>}
      {scan && scan.resources.length === 0 && (
        <div className="hint">
          还没有资源包。去「设置 → 插件与资源包」导入一个，或生成一个资源包结构。
        </div>
      )}
      {scan && scan.resources.length > 0 && enabledResources.length === 0 && (
        <div className="hint">资源包都被禁用了，去「设置 → 插件与资源包」里启用。</div>
      )}
      {scan && kw !== '' && filtered.length === 0 && (
        <div className="hint">没有匹配「{search}」的模板。</div>
      )}
      {filtered.map((r) => {
        const isCollapsed = !!collapsed[r.id];
        return (
          <div key={r.id} className="tpl-group">
            <div className="tpl-group-header" onClick={() => toggleCollapsed(r.id)} title={isCollapsed ? '展开此资源包' : '收起此资源包'}>
              <span className={"tpl-group-caret" + (isCollapsed ? '' : ' open')}>▸</span>
              <span className="tpl-group-name">{r.name}</span>
              <span className="tpl-group-meta">
                {r.templates.length} 个模板{r.version ? ' · v' + r.version : ''}
              </span>
            </div>
            {r.error && <div className="hint" style={{ color: '#c0392b' }}>加载失败：{r.error}</div>}
            {!isCollapsed && (
              <div className="tpl-grid">
                {r.templates.map((t) => (
                  <TemplateCard
                    key={t.id}
                    resId={r.id}
                    tpl={t}
                    disabled={busy}
                    onInsert={() => onInsert(r.id, t.id)}
                    onPreview={() => setPreview({ resId: r.id, tpl: t })}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {preview && (
        <TemplatePreviewOverlay
          resId={preview.resId}
          tpl={preview.tpl}
          busy={busy}
          onInsert={() => { onInsert(preview.resId, preview.tpl.id); }}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

// 生成模板缩略图 shell 的 HTML（与导出同逻辑；外面套一层定宽、隐藏溢出的壳）
function buildThumbHTML(tree: any, baseW: number): string {
  const shell: any = {
    id: 'tpl-shell',
    type: 'div',
    text: undefined,
    children: [tree],
    style: {
      width: baseW + 'px', boxSizing: 'border-box',
      overflow: 'hidden', padding: '0px', backgroundColor: '#ffffff'
    }
  };
  return exportHTML({ root: shell, selectedId: null, selectedIds: [] }).html;
}

// ============ 模板卡片：运行时渲染缩略图（真实比例贴合列宽） ============
function TemplateCard(props: {
  resId: string;
  tpl: { id: string; name: string; description: string };
  disabled: boolean;
  onInsert: () => void;
  onPreview: () => void;
}) {
  const { resId, tpl, disabled, onInsert, onPreview } = props;
  const [srcdoc, setSrcdoc] = useState('');
  const [failed, setFailed] = useState(false);
  const [contentW, setContentW] = useState(THUMB_FALLBACK_W); // iframe 文档真实宽度（封顶）
  const [contentH, setContentH] = useState(0); // iframe 文档真实高度（封顶）
  const [viewW, setViewW] = useState(0); // 可视区宽度（跟随列宽）
  // 右键菜单：null=关闭；否则保存"预览"入口坐标
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 关闭右键菜单：点别处 / 滚轮 / Esc
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // 渲染缩略图 HTML（模板树 → 与导出同逻辑）
  useEffect(() => {
    let alive = true;
    setFailed(false);
    (async () => {
      try {
        const res = await window.bc.readTemplate(resId, tpl.id);
        if (!res.ok || !res.template) throw new Error(res.error ?? '');
        // 优先读模板根元素自身 style.width 作为基准宽；没有则用 fallback 1280
        const rootWidthRaw = res.template.style?.width;
        const parsed = rootWidthRaw ? parseInt(String(rootWidthRaw)) : NaN;
        const baseW = parsed > 0 ? parsed : THUMB_FALLBACK_W;
        if (alive) setSrcdoc(buildThumbHTML(res.template, baseW));
      } catch (e) {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [resId, tpl.id]);

  // 跟踪可视区宽度变化（列宽随窗口变化）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const onFrameLoad = () => {
    const f = wrapRef.current?.querySelector('iframe');
    const doc = f?.contentDocument;
    if (!doc) return;
    // 禁掉 iframe 内滚动（滚动条在做缩略图时很难看）：宽/高都按内容量出后再裁
    const style = doc.createElement('style');
    style.textContent = 'html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }';
    doc.head.appendChild(style);
    // 宽度取实际内容宽（用 template root 自带宽度作为基准，scrollWidth 充触防止超宽元素溢出），
    // 高度同样从真实内容量（封顶防长页面撑高卡片）
    const w = Math.min(Math.max(doc.documentElement.scrollWidth, THUMB_FALLBACK_W), THUMB_MAX_W);
    const h = Math.min(doc.body.scrollHeight, THUMB_MAX_H);
    setContentW(w);
    setContentH(h);
  };

  // 视觉尺寸：scale = 列宽/内容宽（宽元素同样不溢出、不拉伸），高度不超过可视区上限
  const scale = viewW > 0 && contentH > 0 ? Math.min(viewW / contentW, THUMB_VIEW_H / contentH) : 0;
  const viewH = scale * contentH;
  const ready = srcdoc !== '' && contentH > 0 && viewW > 0;

  return (
    <div
      ref={cardRef}
      className={"tpl-card" + (disabled ? ' busy' : '')}
      onClick={onInsert}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      title={(tpl.description || '插入此模板') + '（点击插入画布，右键更多操作）'}
    >
      <div
        ref={wrapRef}
        className="tpl-thumb"
        style={ready ? { height: Math.round(viewH) } : undefined}
      >
        {srcdoc ? (
          <iframe
            className="tpl-thumb-frame"
            title={tpl.name}
            srcDoc={srcdoc}
            scrolling="no"
            onLoad={onFrameLoad}
            style={
              ready
                ? {
                    width: contentW,
                    height: contentH,
                    transform: `scale(${scale})`,
                    transformOrigin: 'left top',
                    pointerEvents: 'none'
                  }
                : undefined
            }
          />
        ) : failed ? (
          <div className="tpl-thumb-fail">预览失败</div>
        ) : (
          <div className="tpl-thumb-loading">加载中…</div>
        )}
      </div>
      <div className="tpl-card-name">{tpl.name}</div>
      <div className="tpl-card-desc">{tpl.description || '点击插入画布'}</div>
      {menu && (
        <div className="tpl-context-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { onPreview(); setMenu(null); }}>
            <span className="tpl-ctx-icon">🔎</span> 预览模板
          </button>
          <button onClick={() => { if (!disabled) onInsert(); setMenu(null); }}>
            <span className="tpl-ctx-icon">＋</span> 插入到画布
          </button>
        </div>
      )}
    </div>
  );
}

// ============ 模板右键预览：覆盖层大图（可滚动看细节，Esc 关闭） ============
function TemplatePreviewOverlay(props: {
  resId: string;
  tpl: { id: string; name: string; description: string };
  busy: boolean;
  onInsert: () => void;
  onClose: () => void;
}) {
  const { resId, tpl, busy, onInsert, onClose } = props;
  const [srcdoc, setSrcdoc] = useState('');
  const [failed, setFailed] = useState(false);
  const [contentW, setContentW] = useState(THUMB_FALLBACK_W); // 模板自然宽（无测量时用基准）
  const [contentH, setContentH] = useState(0); // 模板自然高（onLoad 后测得；未测先用占位）
  const [viewW, setViewW] = useState(0); // 预览卡片可视区宽
  const bodyRef = useRef<HTMLDivElement>(null);

  // 渲染全尺寸 HTML
  useEffect(() => {
    let alive = true;
    setFailed(false);
    setSrcdoc('');
    setContentH(0);
    (async () => {
      try {
        const res = await window.bc.readTemplate(resId, tpl.id);
        if (!res.ok || !res.template) throw new Error(res.error ?? '');
        const rootWidthRaw = res.template.style?.width;
        const parsed = rootWidthRaw ? parseInt(String(rootWidthRaw)) : NaN;
        const baseW = parsed > 0 ? parsed : THUMB_FALLBACK_W;
        setContentW(baseW);
        if (alive) setSrcdoc(buildThumbHTML(res.template, baseW));
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [resId, tpl.id]);

  // 视口宽度：跟随预览卡片可视区（用于把宽模板缩放到不超过卡片宽）
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const update = () => setViewW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onFrameLoad = () => {
    const f = bodyRef.current?.querySelector('iframe');
    const doc = f?.contentDocument;
    if (!doc) return;
    // 禁掉 iframe 内滚动（由外层卡片统一滚动）
    const style = doc.createElement('style');
    style.textContent = 'html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }';
    doc.head.appendChild(style);
    const w = Math.min(Math.max(doc.documentElement.scrollWidth, THUMB_FALLBACK_W), THUMB_MAX_W);
    const h = doc.body.scrollHeight;
    setContentW(w);
    setContentH(h);
  };

  // 宽模板缩到不超过卡片宽（不放大）；高度交给外层滚动
  const sx = viewW > 0 && contentW > 0 ? Math.min(1, viewW / contentW) : 1;
  // 未测出高度前用占位高度，保证 iframe 立即可见（不出现空白卡）
  const fitH = Math.max(contentH, 260);
  const ready = srcdoc !== '' && !failed;

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="tpl-preview-mask" onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div className="tpl-preview-card" onClick={(e) => e.stopPropagation()}>
        <div className="tpl-preview-head">
          <span className="tpl-preview-title">{tpl.name}</span>
          <span className="hint">Esc 关闭</span>
          <button className="tpl-preview-close" onClick={onClose} title="关闭 (Esc)">×</button>
        </div>
        <div ref={bodyRef} className="tpl-preview-body">
          {ready ? (
            <span
              className="tpl-preview-fit"
              style={{ width: Math.round(contentW * sx), height: Math.round(fitH * sx) }}
            >
              <iframe
                title={tpl.name}
                srcDoc={srcdoc}
                scrolling="no"
                onLoad={onFrameLoad}
                style={{ width: contentW, height: fitH, transform: `scale(${sx})`, transformOrigin: 'left top', pointerEvents: 'none' }}
              />
            </span>
          ) : failed ? (
            <div className="tpl-thumb-fail">预览失败</div>
          ) : (
            <div className="tpl-thumb-loading">加载中…</div>
          )}
        </div>
        <div className="tpl-preview-foot">
          {tpl.description && <span className="hint">{tpl.description}</span>}
          <span className="spacer" />
          <button className="btn-ghost" onClick={onClose}>关闭</button>
          <button className="btn-primary" disabled={busy} onClick={() => { onInsert(); onClose(); }}>插入到画布</button>
        </div>
      </div>
    </div>
  );
}