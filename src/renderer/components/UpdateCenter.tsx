import { useEffect, useState, type ReactNode } from 'react';
import { useUpdateBusy } from '@store/updateStore';

// BlockCanvas · 更新中心（v0.4.3 重排）
//
// 读取发行版信息：NexaCode 镜像 → gh-proxy(v4) → GitHub 直连（三层自动回退，用户无感）
// 下载更新包：    gh-proxy(v4) → NexaCode → GitHub 直连 + zip 完整性校验
//
// 三个板块（按用户要求重排，自由度优先）：
//   ① 可更新        默认**完全展开**：比本地新的版本 + 直接显示发行说明（Markdown 渲染）+ 更新按钮
//   ② 可选择更新    默认折叠：就是当前在装的这一版，展开后可「重新安装此版本」
//   ③ 历史版本      默认折叠：更早的版本，逐条可查看发行说明（Markdown）、可「下载 zip」到 data/downloads/
//                 底部「查看更多」逐段放开更多历史（后端一次给 30 条）
// 读取源 / 下载源这类技术细节默认收起在「检测详情」里，用户默认看不到，眼不见心不烦。
//
// 更新期间锁死编辑器：见 store/updateStore.ts 与 App.tsx 的全屏遮罩。
// 替换流程（程序退出后由独立进程执行）永远排除 data/ —— 便携版数据全部保留下。

interface VersionEntry {
  tag: string;
  version: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  body: string;
  assets: { name: string; browser_download_url: string; size: number }[];
  updateable: boolean;
  isCurrent: boolean;
  asset: { url: string; name: string; size: number } | null;
}

interface CheckResult {
  ok: boolean;
  isDev?: boolean;
  error?: string;
  localVersion?: string;
  hasUpdate?: boolean;
  platform?: string;
  source?: string;
  mirrors?: { read: string[]; download: string[] };
  entries?: VersionEntry[];
  latest?: VersionEntry | null;
}

const PLATFORM_LABEL: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS / iPhone'
};
/** 已经做好自动替换适配的平台（Android / iOS 留到阶段 6） */
const ADAPTED_PLATFORMS = ['win32', 'darwin', 'linux'];

const HISTORY_PAGE = 5;

function fmtSize(bytes: number): string {
  if (!bytes) return '-';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

/** 从资产列表里挑一个 zip（优先本平台）—— 历史版本没有平台匹配结果，这里自己挑 */
function pickDownloadAsset(entry: VersionEntry): { name: string; url: string; size: number } | null {
  const list = entry.assets || [];
  if (list.length === 0) return null;
  const zips = list.filter((a) => /\.zip$/i.test(a.name));
  const preferred =
    zips.find((a) => /win64|win-x64|windows/i.test(a.name)) ||
    zips.find((a) => /mac|darwin|linux/i.test(a.name)) ||
    zips[0];
  const chosen = preferred || list[0];
  return { name: chosen.name, url: chosen.browser_download_url, size: chosen.size };
}

// ============ 极简 Markdown 渲染（发行说明用） ============
// 只支持 GitHub Release 里最常见的几种：标题 / 列表 / 引用 / 代码块 / 分隔线 + 行内粗体·斜体·代码·链接。
// 不走 dangerouslySetInnerHTML —— 远端内容一律当纯文本节点渲染，天然免疫注入。

/** 行内标记：**粗** *斜* `码` [文字](链接) */
function mdInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-i${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (mm) out.push(<a key={key} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>);
      else out.push(tok);
    } else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let code: string[] | null = null;

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(<ul key={`ul${blocks.length}`} className="md-list">{list}</ul>);
    list = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, '');
    if (/^```/.test(line)) {
      if (code) {
        blocks.push(<pre key={`code${blocks.length}`} className="md-code">{code.join('\n')}</pre>);
        code = null;
      } else {
        flushList();
        code = [];
      }
      return;
    }
    if (code) { code.push(raw); return; }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      const Tag = (h[1].length <= 2 ? 'h4' : 'h5') as 'h4' | 'h5';
      blocks.push(<Tag key={`h${idx}`} className="md-h">{mdInline(h[2], `h${idx}`)}</Tag>);
      return;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      list.push(<li key={`li${idx}`}>{mdInline(line.replace(/^\s*([-*+]|\d+\.)\s+/, ''), `li${idx}`)}</li>);
      return;
    }
    if (/^\s*>\s?/.test(line)) {
      flushList();
      blocks.push(<blockquote key={`q${idx}`} className="md-quote">{mdInline(line.replace(/^\s*>\s?/, ''), `q${idx}`)}</blockquote>);
      return;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushList();
      blocks.push(<hr key={`hr${idx}`} className="md-hr" />);
      return;
    }
    if (!line.trim()) { flushList(); return; }
    flushList();
    blocks.push(<p key={`p${idx}`} className="md-p">{mdInline(line, `p${idx}`)}</p>);
  });
  flushList();
  if (code) blocks.push(<pre key="code-end" className="md-code">{(code as string[]).join('\n')}</pre>);

  if (blocks.length === 0) return <div className="md-empty">（没有发行说明）</div>;
  return <div className="md-body">{blocks}</div>;
}

export function UpdateCenter({ onBack }: { onBack: () => void }) {
  const [checking, setChecking] = useState(true);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [applyError, setApplyError] = useState('');
  const [restarting, setRestarting] = useState(false);
  // 三个板块的折叠状态：① 可更新默认展开；②③ 默认折叠
  const [openUpdatable, setOpenUpdatable] = useState(true);
  const [openReinstall, setOpenReinstall] = useState(false);
  const [openHistory, setOpenHistory] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [historyShown, setHistoryShown] = useState(HISTORY_PAGE);
  // 每条历史版本各自展开的发行说明
  const [notesOpen, setNotesOpen] = useState<string | null>(null);
  // 单独的「下载 zip」状态（不进 updateStore：下载不该锁死编辑器）
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadMsg, setDownloadMsg] = useState('');
  const [downloaded, setDownloaded] = useState<Record<string, string>>({});

  const busy = useUpdateBusy((s) => s.busy);
  // ⚠ 注意：selector 必须返回**稳定值**（基本类型）。写成 `(s) => ({a:s.a,b:s.b})`
  //    每次都会产出新对象 → useSyncExternalStore 判定"快照变了"→ 无限重渲染（白屏）。
  const message = useUpdateBusy((s) => s.message);
  const pct = useUpdateBusy((s) => s.pct);
  const startBusy = useUpdateBusy((s) => s.start);
  const setProgress = useUpdateBusy((s) => s.progress);

  const check = async () => {
    setChecking(true);
    setResult(null);
    setApplyError('');
    setHistoryShown(HISTORY_PAGE);
    try {
      const r = (await window.bc.checkUpdate()) as unknown as CheckResult;
      setResult(r);
    } catch (e: any) {
      setResult({ ok: false, error: e?.message || '检测失败' });
    }
    setChecking(false);
  };

  // 进入页面自动检测一次
  useEffect(() => { void check(); }, []);

  // 订阅主进程的进度推送：更新走全屏遮罩（updateStore），单条 zip 下载只更新本页文案
  useEffect(() => {
    const off = window.bc.onUpdateProgress((p) => {
      if (downloading) setDownloadMsg(p.pct != null ? `${p.msg}（${p.pct}%）` : p.msg);
      setProgress(p.msg, p.pct);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloading]);

  const install = async (entry: VersionEntry) => {
    if (!entry.asset) return;
    const ok = confirm(
      `确定要更新到 v${entry.version} 吗？\n\n` +
      `· 更新包：${entry.asset.name}（${fmtSize(entry.asset.size)}）\n` +
      `· 只替换程序本体，data/ 里的全部工程与快照都会保留；\n` +
      `· 下载完成后程序会自动重启，期间请不要操作软件。`
    );
    if (!ok) return;

    setApplyError('');
    startBusy('正在准备下载…');
    const r = (await window.bc.applyUpdate(entry.asset.url)) as unknown as { ok: boolean; error?: string };
    if (r.ok) {
      setRestarting(true);
    } else {
      useUpdateBusy.getState().finish();
      setApplyError(r.error || '更新失败');
    }
  };

  /** 下载某个版本的 zip 到 data/downloads/（不替换程序，因此不锁编辑器） */
  const downloadZip = async (entry: VersionEntry) => {
    const asset = pickDownloadAsset(entry);
    if (!asset) return;
    setDownloading(entry.tag);
    setDownloadMsg(`正在下载 ${asset.name}…`);
    try {
      const r = await window.bc.downloadReleaseAsset(asset.url, asset.name);
      if (r.ok && r.path) {
        setDownloaded((m) => ({ ...m, [entry.tag]: r.path! }));
        setDownloadMsg('');
      } else {
        setDownloadMsg(`下载失败：${r.error || '未知错误'}`);
      }
    } catch (e: any) {
      setDownloadMsg(`下载失败：${e?.message || '未知错误'}`);
    }
    setDownloading(null);
  };

  const entries = result?.entries ?? [];
  const localVersion = result?.localVersion ?? '';
  const localCmp = (e: VersionEntry) => {
    if (e.isCurrent) return 0;
    return e.updateable ? 1 : -1; // 后端已按版本号算好：updateable = 版本 ≥ 本地
  };
  const newer = entries.filter((e) => localCmp(e) > 0);
  const current = entries.filter((e) => localCmp(e) === 0);
  const older = entries.filter((e) => localCmp(e) < 0);
  const latest = result?.latest ?? null;
  const platform = result?.platform ?? '';
  const platformAdapted = ADAPTED_PLATFORMS.includes(platform);
  const shownOlder = older.slice(0, historyShown);

  return (
    <div className="update-page">
      {/* 顶栏 */}
      <div className="update-topbar">
        <button className="fluent-back-btn" onClick={onBack} disabled={busy}>← 返回编辑器</button>
        <div className="update-brand">
          <span className="update-brand-logo">⚡</span>
          <span className="update-brand-text">BlockCanvas 更新中心</span>
        </div>
        <span className="update-topbar-plat">
          {PLATFORM_LABEL[platform] ?? platform}
          {platform && !platformAdapted && <em>（自动更新暂未适配）</em>}
        </span>
      </div>

      <div className="update-body">
        {/* —— 当前版本 + 检测 —— */}
        <div className="update-card update-head-card">
          <div className="update-card-row">
            <div>
              <div className="update-current-label">当前版本</div>
              <div className="update-current-ver">{localVersion || '…'}</div>
            </div>
            <div className="update-head-status">
              {checking
                ? <span className="update-status-inline">正在连接发行版信息…</span>
                : result?.ok
                  ? result.hasUpdate && latest
                    ? <span className="update-status-inline ok">发现新版本 {latest.version}</span>
                    : <span className="update-status-inline">已是最新版本</span>
                  : <span className="update-status-inline err">连接失败</span>}
            </div>
            <button className="btn-primary" onClick={check} disabled={checking || busy}>
              {checking ? '正在检测…' : '重新检测'}
            </button>
          </div>
          {/* 技术细节默认收起：用户只关心"能不能更新、快不快" */}
          <button className="update-detail-toggle" onClick={() => setDetailOpen((v) => !v)}>
            {detailOpen ? '▾' : '▸'} 检测详情（读取源 / 下载源）
          </button>
          {detailOpen && (
            <div className="update-mirror-tip">
              <b>读取源</b>（自动回退）：{(result?.mirrors?.read ?? ['NexaCode 镜像', 'gh-proxy 镜像 (v4)', 'GitHub 直连']).join(' → ')}
              <br />
              <b>下载源</b>（自动回退）：{(result?.mirrors?.download ?? ['gh-proxy 镜像 (v4)', 'NexaCode 镜像', 'GitHub 直连']).join(' → ')}
              {result?.source && <span className="update-mirror-hit">本次经由：{result.source}</span>}
              <br />
              <span className="update-mirror-warn">全部失败时，请先关闭 Watt Toolkit / Clash 等后台代理再重试。</span>
            </div>
          )}
        </div>

        {!checking && result && !result.ok && (
          <div className="update-card update-error">检测失败：{result.error || '未知错误'}</div>
        )}

        {!checking && result?.ok && (
          <>
            {/* ============ ① 可更新（默认完全展开，发行说明直接显示） ============ */}
            <div className="update-section-title update-sec-toggle" onClick={() => setOpenUpdatable((v) => !v)}>
              <span className="update-sec-caret">{openUpdatable ? '▾' : '▸'}</span>
              可更新
              <span className="update-sec-count">{newer.length}</span>
            </div>
            {openUpdatable && (
              <>
                {newer.length === 0 && (
                  <div className="update-card update-up-to-date">✓ 已是最新版本，没有可更新的内容。</div>
                )}
                {newer.map((e, i) => (
                  <div key={e.tag} className={'update-card update-release-card' + (i === 0 && latest ? ' is-latest' : '')}>
                    <div className="update-release-head">
                      <b>{e.name || e.tag}</b>
                      <span className="update-release-tag">{e.tag}</span>
                      {e.prerelease && <span className="update-badge pre">预发布</span>}
                      {i === 0 && latest && <span className="update-badge latest">最新</span>}
                      <span className="update-release-date">{fmtDate(e.publishedAt)}</span>
                    </div>
                    <div className="update-release-meta">
                      {e.asset ? (
                        <>匹配到当前平台资源：<b>{e.asset.name}</b>（{fmtSize(e.asset.size)}）</>
                      ) : platformAdapted ? (
                        <span className="update-asset-warn">该版本没有提供 {PLATFORM_LABEL[platform] ?? platform} 平台的构建，无法自动更新</span>
                      ) : (
                        <span className="update-asset-warn">当前系统（{PLATFORM_LABEL[platform] ?? platform}）暂未适配自动更新（计划在阶段 6 支持移动端）</span>
                      )}
                    </div>
                    <div className="update-notes-inline">
                      <Markdown text={e.body} />
                    </div>
                    <div className="update-release-actions">
                      <button
                        className="btn-primary update-install-btn"
                        disabled={!e.asset || busy}
                        onClick={() => install(e)}
                      >
                        {busy ? '更新进行中…' : `⬇ 更新到 v${e.version}`}
                      </button>
                      {!e.asset && <span className="update-asset-none">（本平台无对应安装包）</span>}
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* ============ ② 可选择更新（重装，默认折叠） ============ */}
            <div className="update-section-title update-sec-toggle" onClick={() => setOpenReinstall((v) => !v)}>
              <span className="update-sec-caret">{openReinstall ? '▾' : '▸'}</span>
              可选择更新（重装）
              <span className="update-sec-count">{current.length}</span>
            </div>
            {openReinstall && (
              <>
                {current.length === 0 && (
                  <div className="update-card update-up-to-date">发行版里没有和你当前版本号一致的条目。</div>
                )}
                {current.map((e) => (
                  <div key={e.tag} className="update-card update-release-card">
                    <div className="update-release-head">
                      <b>{e.name || e.tag}</b>
                      <span className="update-release-tag">{e.tag}</span>
                      <span className="update-badge current">当前版本</span>
                      <span className="update-release-date">{fmtDate(e.publishedAt)}</span>
                    </div>
                    <div className="update-release-meta">
                      {e.asset
                        ? <>匹配到当前平台资源：<b>{e.asset.name}</b>（{fmtSize(e.asset.size)}）</>
                        : <span className="update-asset-warn">这个版本没有当前平台的安装包，无法重装</span>}
                    </div>
                    <div className="update-notes-inline">
                      <Markdown text={e.body} />
                    </div>
                    <div className="update-release-actions">
                      <button
                        className="btn-secondary update-install-btn"
                        disabled={!e.asset || busy}
                        onClick={() => install(e)}
                      >
                        {busy ? '更新进行中…' : '⟲ 重新安装此版本'}
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* ============ ③ 历史版本（默认折叠；逐条看说明 / 下载 zip / 查看更多） ============ */}
            {older.length > 0 && (
              <>
                <div className="update-section-title update-sec-toggle" onClick={() => setOpenHistory((v) => !v)}>
                  <span className="update-sec-caret">{openHistory ? '▾' : '▸'}</span>
                  历史版本
                  <span className="update-sec-count">{older.length}</span>
                </div>
                {openHistory && (
                  <>
                    <div className="update-history-list">
                      {shownOlder.map((e) => {
                        const asset = pickDownloadAsset(e);
                        const saved = downloaded[e.tag];
                        return (
                          <div key={e.tag} className="update-history-row">
                            <div className="update-history-main">
                              <span className="update-history-ver">{e.tag}</span>
                              <span className="update-history-name">{e.name}</span>
                              <span className="update-history-date">{fmtDate(e.publishedAt)}</span>
                            </div>
                            <div className="update-history-acts">
                              <button
                                className="btn-mini"
                                onClick={() => setNotesOpen(notesOpen === e.tag ? null : e.tag)}
                              >
                                {notesOpen === e.tag ? '收起说明' : '发行说明'}
                              </button>
                              <button
                                className="btn-mini"
                                disabled={!asset || downloading === e.tag}
                                title={asset ? `下载 ${asset.name}（${fmtSize(asset.size)}）到 data/downloads/` : '这个版本没有可下载的附件'}
                                onClick={() => downloadZip(e)}
                              >
                                {downloading === e.tag ? '下载中…' : '下载 zip'}
                              </button>
                              {saved && <span className="update-history-saved" title={saved}>已下载</span>}
                            </div>
                            {notesOpen === e.tag && (
                              <div className="update-history-notes">
                                <Markdown text={e.body} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {historyShown < older.length && (
                      <button className="btn-secondary update-more-btn" onClick={() => setHistoryShown((n) => n + HISTORY_PAGE * 2)}>
                        查看更多（还有 {older.length - historyShown} 个历史版本）
                      </button>
                    )}
                    {downloadMsg && <div className="update-download-msg">{downloadMsg}</div>}
                  </>
                )}
              </>
            )}

            {restarting && (
              <div className="update-card update-progress done">
                ✓ 更新完成！程序正在重启…（重启后即为所选版本，data/ 数据全部保留）
              </div>
            )}
            {applyError && <div className="update-card update-apply-error">更新失败：{applyError}</div>}

            {/* 更新进行中：页面内的进度（全屏遮罩另有更醒目的一份） */}
            {busy && (
              <div className="update-card update-progress">
                <div className="update-progress-msg">{message}</div>
                <div className="update-progress-bar">
                  <div className="update-progress-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
