import { useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from '@renderer/assets/logo.svg';
import { readPersisted, writePersisted } from '@lib/usePersisted';
import { Icon } from './Icon';
import { DOC_INDEX, searchDocs, type DocHit } from '@lib/docSearch';
import { useTabStore } from '@store/tabStore';
import { showToast } from '@lib/toast';
import type { ProjectFileInfo } from '../global';

// ============================================================================
// BlockCanvas · 首页（v0.4.5）
// ----------------------------------------------------------------------------
// 关掉所有项目标签后进入这里 —— 做成浏览器"新标签页"的样子：
//   · 组件统一偏上：Logo / 标题 / 大搜索框 / 快捷入口 / 最近项目
//   · 搜索框同时搜「本地工程」和「三份内置文档」，回车或点击直达
//   · 右上角只有一枚 SVG 齿轮，点开是背景设置（预设 / 渐变 / 图片 / 视频）
//   · 背景是"软件外观偏好"，存 localStorage，不进工程文件
//   · 离开首页时淡出，回来时淡入；视频背景在窗口不可见时自动暂停（不烧 GPU）
// ============================================================================

const BG_KEY = 'bc-empty-home-bg';
const SAVED_KEY = 'bc-empty-home-saved';

type BgSpec =
  | { kind: 'preset'; value: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | { kind: 'image'; src: string; dim: number }
  | { kind: 'video'; src: string; dim: number };

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

function bgCss(spec: BgSpec): string {
  if (spec.kind === 'preset') return spec.value;
  if (spec.kind === 'gradient') return `linear-gradient(${spec.angle}deg, ${spec.from}, ${spec.to})`;
  return 'var(--bg)';
}

function loadBg(): BgSpec {
  const raw = readPersisted<unknown>(BG_KEY, null);
  if (!raw) return DEFAULT_BG;
  if (typeof raw === 'string') return { kind: 'preset', value: raw }; // 旧版只存一个 CSS 值
  if (typeof raw === 'object' && raw && 'kind' in (raw as Record<string, unknown>)) return raw as BgSpec;
  return DEFAULT_BG;
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
  const panelRef = useRef<HTMLDivElement>(null);

  // —— 背景草稿（面板里改，点「应用」才落到首页）——
  const [gFrom, setGFrom] = useState(() => (bg.kind === 'gradient' ? bg.from : '#dbeafe'));
  const [gTo, setGTo] = useState(() => (bg.kind === 'gradient' ? bg.to : '#ffffff'));
  const [gAngle, setGAngle] = useState(() => (bg.kind === 'gradient' ? bg.angle : 160));
  const [imgSrc, setImgSrc] = useState(() => (bg.kind === 'image' ? bg.src : ''));
  const [vidSrc, setVidSrc] = useState(() => (bg.kind === 'video' ? bg.src : ''));
  const [dim, setDim] = useState(() => (bg.kind === 'image' || bg.kind === 'video' ? bg.dim : 12));
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

  // 离开首页：先淡出，再执行动作（用户要的"切换到别的页面有过渡动画"）
  const leave = (action: () => void) => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(action, 150);
  };

  // 「打开工程」会弹原生文件对话框：用户取消时页面还停在首页，
  // 但已经进入 is-leaving（透明 + 不可点）。窗口重新获得焦点（对话框关闭）时恢复。
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
  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanelOpen(false); };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [panelOpen]);

  // 搜索框点外部 → 收起结果
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: MouseEvent) => {
      if (searchRef.current?.contains(e.target as Node)) return;
      setFocused(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [focused]);

  // 视频背景：窗口不可见 / 首页卸载时暂停，避免后台空转
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
        st.newTab(p.name, res.project.scene, p.filePath);
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
      if (kind === 'image') setImgSrc(res.path);
      else setVidSrc(res.path);
    } catch {
      showToast('选择文件失败', 'err');
    }
  };

  const saveCurrent = () => {
    const name = saveName.trim() || `我的背景 ${saved.length + 1}`;
    const spec: BgSpec = tab === 'gradient'
      ? { kind: 'gradient', from: gFrom, to: gTo, angle: gAngle }
      : tab === 'image'
        ? { kind: 'image', src: imgSrc.trim(), dim }
        : tab === 'video'
          ? { kind: 'video', src: vidSrc.trim(), dim }
          : bg;
    const item: SavedBg = { id: 'bg-' + Date.now().toString(36), name, spec };
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

  return (
    <div
      className={'empty-home' + (leaving ? ' is-leaving' : '')}
      style={{ background: bgCss(bg) }}
    >
      {bg.kind === 'image' && (
        <div className="eh-media" style={{ backgroundImage: `url("${mediaSrc(media)}")` }} />
      )}
      {bg.kind === 'video' && (
        <video
          ref={videoRef}
          className="eh-media eh-video"
          src={mediaSrc(media)}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      )}
      {isMedia && <div className="eh-dim" style={{ opacity: (bg.kind === 'image' || bg.kind === 'video' ? bg.dim : 0) / 100 }} />}

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
          <div className="eh-panel">
            <div className="eh-panel-head">
              <span>页面设置</span>
              <button className="eh-panel-x" onClick={() => setPanelOpen(false)} title="关闭">
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
                          style={{ background: bgCss(s.spec) }}
                          title={s.name}
                          onClick={() => applyBg(s.spec)}
                        >
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
              <>
                <div className="eh-gradient-preview" style={{ background: `linear-gradient(${gAngle}deg, ${gFrom}, ${gTo})` }} />
                <div className="eh-row">
                  <label className="eh-color">
                    <input type="color" value={gFrom} onChange={(e) => setGFrom(e.target.value)} />
                    <span>起色</span>
                  </label>
                  <label className="eh-color">
                    <input type="color" value={gTo} onChange={(e) => setGTo(e.target.value)} />
                    <span>止色</span>
                  </label>
                </div>
                <div className="eh-row">
                  <input
                    className="eh-range"
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={gAngle}
                    onChange={(e) => setGAngle(Number(e.target.value))}
                  />
                  <span className="eh-val">{gAngle}°</span>
                </div>
                <button className="eh-apply" onClick={() => applyBg({ kind: 'gradient', from: gFrom, to: gTo, angle: gAngle })}>
                  应用这个渐变
                </button>
                <div className="eh-save-row">
                  <input
                    className="eh-input"
                    placeholder="给这个背景起个名字"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                  />
                  <button className="eh-mini" onClick={saveCurrent}>保存</button>
                </div>
              </>
            )}

            {tab === 'image' && (
              <>
                <div className="eh-row">
                  <input
                    className="eh-input"
                    placeholder="相对路径 / 绝对路径 / https 链接"
                    value={imgSrc}
                    onChange={(e) => setImgSrc(e.target.value)}
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
                    onChange={(e) => setDim(Number(e.target.value))}
                  />
                  <span className="eh-val">{dim}%</span>
                </div>
                <button
                  className="eh-apply"
                  disabled={!imgSrc.trim()}
                  onClick={() => applyBg({ kind: 'image', src: imgSrc.trim(), dim })}
                >
                  应用图片背景
                </button>
                <div className="eh-save-row">
                  <input className="eh-input" placeholder="给这个背景起个名字" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
                  <button className="eh-mini" onClick={saveCurrent}>保存</button>
                </div>
              </>
            )}

            {tab === 'video' && (
              <>
                <div className="eh-row">
                  <input
                    className="eh-input"
                    placeholder="视频相对路径 / 绝对路径 / https 链接"
                    value={vidSrc}
                    onChange={(e) => setVidSrc(e.target.value)}
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
                    onChange={(e) => setDim(Number(e.target.value))}
                  />
                  <span className="eh-val">{dim}%</span>
                </div>
                <button
                  className="eh-apply"
                  disabled={!vidSrc.trim()}
                  onClick={() => applyBg({ kind: 'video', src: vidSrc.trim(), dim })}
                >
                  应用视频背景
                </button>
                <div className="eh-save-row">
                  <input className="eh-input" placeholder="给这个背景起个名字" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
                  <button className="eh-mini" onClick={saveCurrent}>保存</button>
                </div>
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
          <button className="eh-btn is-primary" onClick={() => leave(props.onOpen)}>
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
