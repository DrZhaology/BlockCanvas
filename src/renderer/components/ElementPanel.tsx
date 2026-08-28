import { useEffect, useRef, useState } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import type { ElementType } from '@lib/types';
import { exportHTML } from '@lib/exporter';
import { HelpButton } from './HelpButton';
import { getPluginElements } from '@lib/pluginHost';

// BlockCanvas · 元素面板
// 阶段1：按类别分组，点击插入选中元素的父级（或根）
// 阶段3・第二批：「元素 | 模板」双页签。模板来自扩展的"资源包"
// 阶段4・4-F：模板页升级 ——
//   - 仍在左侧面板内（切到「模板」时面板自动加宽，遮罩删除）
//   - 每个资源包 = 一个大板块，三角形小箭头（▸/▾）点击折叠/展开，默认展开
//   - 顶部搜索框：按模板名/描述/资源包名过滤，× 清空
//   - 模板显示为运行时渲染缩略图：模板树 → exportHTML → iframe srcdoc，
//     按内容真实比例自动缩放贴合所在列宽（不再固定尺寸拉伸/留白），随窗口宽度自适应列数

type ElementDef = {
  type: ElementType;
  label: string;
  help: { tag: string; what: string; where: string };
};

// hover 讲解：tag=真实标签名；what=作用（通俗）；where=能放在哪/常见误用提醒。
// 例：h1~h4 是"标题语义"，不能为了加粗大字去用——那是 strong/字号该干的事。
const GROUPS: { title: string; items: ElementDef[] }[] = [
  {
    title: '容器',
    items: [
      { type: 'div', label: '通用容器', help: { tag: 'div', what: '什么都能装的盒子，用来圈出一块区域统一排版', where: '任意位置；没有特殊含义，纯布局用' } },
      { type: 'section', label: '区块', help: { tag: 'section', what: '页面里一个主题段落区（如"产品介绍"一整段）', where: 'body 或其他容器内；一般带个标题' } },
      { type: 'header', label: '页眉', help: { tag: 'header', what: '页顶区域：Logo、站名、主导航', where: '页面最上方或某个区块的开头' } },
      { type: 'nav', label: '导航', help: { tag: 'nav', what: '装导航链接的容器', where: '通常在 header 里；里面放 a 链接' } },
      { type: 'main', label: '主区', help: { tag: 'main', what: '页面的主体内容（一页只用一次）', where: 'body 直接子级，包住核心内容' } },
      { type: 'article', label: '文章', help: { tag: 'article', what: '一篇独立成文的内容（文章/帖子/评论）', where: 'main 或 section 内' } },
      { type: 'aside', label: '侧栏', help: { tag: 'aside', what: '和主线内容关系不大的旁栏（推荐位/广告/目录）', where: 'main 旁边或文章内部' } },
      { type: 'figure', label: '图文块', help: { tag: 'figure', what: '"图 + 图注"打包的独立内容块', where: '正文里；里面常放 img + figcaption' } },
      { type: 'footer', label: '页脚', help: { tag: 'footer', what: '页底区域：版权、联系方式、备案号', where: '页面最底部或区块结尾' } }
    ]
  },
  {
    title: '标题与段落',
    items: [
      { type: 'h1', label: '标题1', help: { tag: 'h1', what: '全页最大的标题（一页只建议一个）', where: '页面顶部；⚠ 它是"标题语义"，别拿它当加大加粗用' } },
      { type: 'h2', label: '标题2', help: { tag: 'h2', what: '二级标题：章节题目', where: 'h1 之后；⚠ 别为字体效果滥用，加粗请用 strong' } },
      { type: 'h3', label: '标题3', help: { tag: 'h3', what: '三级标题：小节题目（卡片标题常用）', where: '任意容器内；层级要跟在 h2 下面' } },
      { type: 'h4', label: '标题4', help: { tag: 'h4', what: '四级标题：更小的分组题', where: '同上，层级依次递减' } },
      { type: 'p', label: '段落', help: { tag: 'p', what: '一段普通文字，网页里最常用的文本块', where: '任意容器内；一段一个 p' } },
      { type: 'blockquote', label: '引用块', help: { tag: 'blockquote', what: '引用别人的一段话，默认带缩进左线', where: '正文中；里面可再放 p' } }
    ]
  },
  {
    title: '行内文字',
    items: [
      { type: 'span', label: '行内文字', help: { tag: 'span', what: '行内小段文字盒子（配合背景色做徽章等）', where: '放在 p / 标题等文字内部' } },
      { type: 'strong', label: '重点加粗', help: { tag: 'strong', what: '语气强调的加粗（比 b 更有语义）', where: '文字内部包住要强调的词' } },
      { type: 'em', label: '斜体强调', help: { tag: 'em', what: '语气强调的倾斜', where: '文字内部使用' } },
      { type: 'mark', label: '高亮', help: { tag: 'mark', what: '荧光笔划过的黄色高亮', where: '文字内部标出关键词' } },
      { type: 'small', label: '小字', help: { tag: 'small', what: '字号小一号的附属说明', where: '版权声明、备注等旁边' } },
      { type: 'code', label: '代码', help: { tag: 'code', what: '等宽字体的行内代码样式', where: '文字内部包住代码/命令' } },
      { type: 'del', label: '删除线', help: { tag: 'del', what: '已删除/作废的内容（划掉）', where: '文字内部；常见于价格改价' } },
      { type: 'a', label: '链接', help: { tag: 'a', what: '点击跳转的超链接', where: '文字或导航里；href 属性填网址' } }
    ]
  },
  {
    title: '列表',
    items: [
      { type: 'ul', label: '无序列表', help: { tag: 'ul', what: '圆点列表的外壳（不分先后顺序）', where: '里面只放 li 列表项' } },
      { type: 'ol', label: '有序列表', help: { tag: 'ol', what: '带编号的步骤列表', where: '里面只放 li；步骤类内容用它' } },
      { type: 'li', label: '列表项', help: { tag: 'li', what: '列表里的每一项', where: '只能放在 ul / ol 里面' } }
    ]
  },
  {
    title: '表格',
    items: [
      { type: 'table', label: '表格', help: { tag: 'table', what: '行列数据表的外壳（价格表/参数表）', where: '里面按 行 tr → 单元格 th/td 逐层嵌' } },
      { type: 'tr', label: '表格行', help: { tag: 'tr', what: '表格的一行', where: '只能放在 table 里；行里放 th/td' } },
      { type: 'th', label: '表头格', help: { tag: 'th', what: '表头单元格（自动加粗、浅灰底）', where: '放在第一行的 tr 里' } },
      { type: 'td', label: '单元格', help: { tag: 'td', what: '普通数据单元格', where: '放在 tr 里；一行里 th+td 数量要一致' } }
    ]
  },
  {
    title: '表单与交互',
    items: [
      { type: 'button', label: '按钮', help: { tag: 'button', what: '可点击的按钮（后续积木编程接行为）', where: '表单里或任意位置' } },
      { type: 'input', label: '输入框', help: { tag: 'input', what: '单行输入框', where: '通常放进 form 表单容器' } },
      { type: 'textarea', label: '文本域', help: { tag: 'textarea', what: '多行输入框（留言/简介）', where: '同上；文字写在属性面板"文案"里' } },
      { type: 'label', label: '标签文字', help: { tag: 'label', what: '输入框旁的说明文字', where: 'form 里紧挨着 input 放' } },
      { type: 'form', label: '表单容器', help: { tag: 'form', what: '把一组输入框和提交按钮圈起来', where: '需要收集用户填写时使用' } }
    ]
  },
  {
    title: '多媒体与其他',
    items: [
      { type: 'img', label: '图片', help: { tag: 'img', what: '插入一张图片', where: '任意位置；src 选本地文件或填网址' } },
      { type: 'figcaption', label: '图注', help: { tag: 'figcaption', what: 'figure 图文块的说明文字', where: '只能放在 figure 内部' } },
      { type: 'hr', label: '分割线', help: { tag: 'hr', what: '一条水平分割线，隔开两段内容', where: '任意两个区块之间' } },
      { type: 'br', label: '换行', help: { tag: 'br', what: '强制换一行（空元素，无样式可调）', where: '文字内部需要断行的地方' } }
    ]
  }
];

type ScanResult = {
  plugins: { id: string; name: string; version: string; author: string; description: string; enabled: boolean; error: string | null }[];
  resources: {
    id: string; name: string; version: string; author: string; description: string;
    categories?: { id: string; name: string; description: string }[];
    templates: { id: string; name: string; description: string; category?: string }[];
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
  const autoInherit = useScene((s) => s.autoInherit);
  const setAutoInherit = useScene((s) => s.setAutoInherit);
  const [tab, setTab] = useState<'element' | 'templates'>('element');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  // hover 元素讲解卡：1s 延迟缓入
  const [tip, setTip] = useState<{ def: ElementDef; x: number; y: number; below: boolean } | null>(null);
  const hoverTimer = useRef<number>(0);
  const clearHoverTimer = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = 0; }
  };

  // 元素按钮展示模式：'both' 中文+代码标签 | 'zh' 仅中文 | 'tag' 仅英文标签
  const [labelMode, setLabelMode] = useState<'both' | 'zh' | 'tag'>(() => {
    try { return (localStorage.getItem('bc-elem-label-mode') as any) || 'both'; } catch { return 'both'; }
  });

  const cycleLabelMode = () => {
    const next = labelMode === 'both' ? 'zh' : labelMode === 'zh' ? 'tag' : 'both';
    setLabelMode(next);
    try { localStorage.setItem('bc-elem-label-mode', next); } catch {}
  };

  const rescan = () => window.bc.scanExtensions().then((r) => setScan(r));

  useEffect(() => {
    rescan();
    // 监听插件注册新元素
    const onPluginElements = () => setTab('element');
    window.addEventListener('bc:plugin-elements-changed', onPluginElements);
    return () => {
      clearHoverTimer();
      window.removeEventListener('bc:plugin-elements-changed', onPluginElements);
    };
  }, []);

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

  const root = useScene((s) => s.scene.root);
  const selectedNode = selectedId ? findNode(root, selectedId) : null;
  const targetLabel = selectedNode
    ? `<${selectedNode.type}${selectedNode.attrs?.className ? '.' + selectedNode.attrs.className.split(/\s+/)[0] : ''}> 内部`
    : '画布根（最外层）';

  return (
    <div className={"panel element-panel" + (tab === 'templates' ? ' tpl-mode' : '')}>
      <div className="inspector-tabs">
        <button
          className={"inspector-tab" + (tab === 'element' ? ' active' : '')}
          onClick={() => setTab('element')}
          title="可插入的 HTML 元素"
        >元素</button>
        <button
          className={"inspector-tab" + (tab === 'templates' ? ' active' : '')}
          onClick={() => setTab('templates')}
          title="预设组件模板库"
        >模板</button>
      </div>

      {tab === 'element' && (
        <div className="elem-main-wrap">
          <div className="elem-top-bar">
            <div className="elem-target-hint">
              <span>📌 目标:</span>
              <b>{targetLabel}</b>
            </div>
            <div className="elem-inherit-wrap">
              <button
                className="elem-mode-btn"
                onClick={cycleLabelMode}
                title="切换元素按钮展示模式（中文+标签 / 仅中文 / 仅HTML标签）"
              >
                🏷️ {labelMode === 'both' ? '中文+标签' : labelMode === 'zh' ? '仅中文' : '仅代码标签'}
              </button>
              <button
                className={"elem-inherit-btn" + (autoInherit ? ' active' : '')}
                onClick={() => setAutoInherit(!autoInherit)}
                title="点击切换插入继承模式"
              >
                <span>{autoInherit ? '⚡ 同级继承: 开' : '⊘ 独立新建: 关'}</span>
              </button>
              <HelpButton
                title="插入时同级样式继承"
                content={'【同级样式继承】开关作用：\n\n· ⚡ 开启（推荐）：当你在已有子元素的容器内（例如 .card-grid）再次插入相同类型的子元素时，新元素会自动套用同级已有的选择器与样式，省去重复调整！\n\n· ⊘ 关闭：新插入的元素保持默认纯净样式，不继承任何既有样式。\n\n注：画布最外层（根目录）不受影响，永远独立新建。'}
              />
            </div>
          </div>
          <div className="element-body">
            {GROUPS.map((g) => (
              <div key={g.title} className="element-group">
                <div className="group-title">{g.title}</div>
                <div className="element-grid">
                  {g.items.map((it) => {
                    const text = labelMode === 'tag' ? `<${it.help.tag}>` : it.label;
                    const showTag = labelMode === 'both';
                    return (
                      <button
                        key={it.type}
                        className={"element-btn" + (showTag ? " has-tag" : "")}
                        onClick={() => addElement(it.type, selectedId)}
                        onMouseEnter={(e) => {
                          clearHoverTimer();
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const vw = window.innerWidth;
                          hoverTimer.current = window.setTimeout(() => {
                            setTip({
                              def: it,
                              x: Math.min(Math.max(8, r.left), Math.max(8, vw - 288)),
                              y: r.top,
                              below: r.top < 190
                            });
                          }, 1000); // 1秒延迟
                        }}
                        onMouseLeave={() => {
                          clearHoverTimer();
                          setTip(null);
                        }}
                      >
                        <span className="elem-btn-name">{text}</span>
                        {showTag && <span className="elem-btn-tag">&lt;{it.help.tag}&gt;</span>}
                      </button>
                    );
                  })}
                  {(() => {
                    const plugins = getPluginElements();
                    if (plugins.length === 0) return null;
                    return plugins.map((it) => (
                      <button
                        key={it.type}
                        className="element-btn has-tag"
                        onClick={() => addElement(it.type as ElementType, selectedId)}
                        onMouseEnter={(e) => {
                          clearHoverTimer();
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const vw = window.innerWidth;
                          hoverTimer.current = window.setTimeout(() => {
                            setTip({ def: it as any, x: Math.min(Math.max(8, r.left), Math.max(8, vw - 288)), y: r.top, below: r.top < 190 });
                          }, 1000);
                        }}
                        onMouseLeave={() => { clearHoverTimer(); setTip(null); }}
                      >
                        <span className="elem-btn-name">{it.label}</span>
                        <span className="elem-btn-tag">&lt;{it.help.tag}&gt;</span>
                      </button>
                    ));
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* hover 元素讲解卡（fixed，不挤布局；离开按钮即消失） */}
      {tab === 'element' && tip && (
        <div
          className="ele-tip"
          style={{
            left: tip.x,
            ...(tip.below ? { top: tip.y + 34 } : { top: tip.y, transform: 'translateY(-100%)' })
          }}
        >
          <div className="ele-tip-tag">&lt;{tip.def.help.tag}&gt; · {tip.def.label}</div>
          <div className="ele-tip-row"><b>作用</b>{tip.def.help.what}</div>
          <div className="ele-tip-row"><b>放哪</b>{tip.def.help.where}</div>
        </div>
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('bc-tpl-collapsed');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<{ resId: string; tpl: { id: string; name: string; description: string; category?: string } } | null>(null);

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('bc-tpl-collapsed', JSON.stringify(next)); } catch {}
      return next;
    });
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
              || (t.category ?? '').toLowerCase().includes(kw)
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
        const resCollapsed = !!collapsed[r.id];
        // 按分类细分模板
        const catMap = new Map<string, { id: string; name: string; templates: typeof r.templates }>();
        for (const t of r.templates) {
          const catId = t.category || '__uncategorized__';
          if (!catMap.has(catId)) {
            const catName = catId === '__uncategorized__'
              ? '未分类'
              : (r.categories ?? []).find((c: any) => c.id === catId)?.name || catId;
            catMap.set(catId, { id: catId, name: catName, templates: [] });
          }
          catMap.get(catId)!.templates.push(t);
        }
        const cats = Array.from(catMap.values()).filter((c) => c.templates.length > 0);

        return (
          <div key={r.id} className="tpl-group">
            {/* 资源包标题 */}
            <div className="tpl-group-header" onClick={() => toggleCollapsed(r.id)} title={resCollapsed ? '展开此资源包' : '收起此资源包'}>
              <span className={"tpl-group-caret" + (resCollapsed ? '' : ' open')}>▸</span>
              <span className="tpl-group-name">{r.name}</span>
              <span className="tpl-group-meta">
                {r.templates.length} 个模板{r.version ? ' · v' + r.version : ''}
              </span>
            </div>
            {r.error && <div className="hint" style={{ color: '#c0392b' }}>加载失败：{r.error}</div>}
            {!resCollapsed && (
              <div className="tpl-group-inner">
                {cats.length > 1 ? (
                  // 多分类：内部再按分类折叠展示
                  cats.map((cat) => {
                    const catCollapsed = !!collapsed[`${r.id}::${cat.id}`];
                    return (
                      <div key={cat.id} className="tpl-sub-group">
                        <div
                          className="tpl-sub-header"
                          onClick={() => toggleCollapsed(`${r.id}::${cat.id}`)}
                          title={catCollapsed ? '展开此分类' : '收起此分类'}
                        >
                          <span className={"tpl-sub-caret" + (catCollapsed ? '' : ' open')}>▸</span>
                          <span className="tpl-sub-cat-badge">{cat.name}</span>
                          <span className="tpl-group-meta">{cat.templates.length} 个模板</span>
                        </div>
                        {!catCollapsed && (
                          <div className="tpl-grid">
                            {cat.templates.map((t) => (
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
                  })
                ) : (
                  // 单分类或无分类：直接展示模板网格
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