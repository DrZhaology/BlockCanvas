import { useEffect, useState, type ReactNode } from 'react';
import { useUpdateBusy } from '@store/updateStore';
import { useTasks } from '@store/taskStore';
import { InlineTaskStrip } from './TaskButton';
import { RESUMABLE_STATUS, type BgTask } from '@lib/taskTypes';

// BlockCanvas · 更新中心（v0.4.4 第三版）
//
// 读取发行版信息：NexaCode 镜像 → gh-proxy(v4) → GitHub 直连（三层自动回退，用户无感）
// 下载：           gh-proxy(v4) → NexaCode → GitHub 直连 + zip 完整性校验
//
// 三个板块：① 可更新（默认完全展开）② 可选择更新（重装）③ 历史版本（默认折叠）
//
// v0.4.4 的两处结构性变化：
//   · **进度不再由本页记** —— 下载/更新都是主进程里的"后台任务"，页面只是订阅者。
//     于是：离开这一页、切到别的视图、甚至重启软件，任务与"已下载"都还在；
//     也能在工具栏「任务」按钮里统一查看与暂停/继续（以前进度存在组件 state 里，一离开就没了）。
//   · **少弹窗**：更新不再有 confirm 确认框 —— 点「更新到这一版」直接开始，
//     进度显示在版本卡片下方 + 工具栏任务按钮里；替换程序那一步才锁编辑器。
//
// ⚠ 两条硬规则（v0.4.4 起）：
//   · 「更新」（替换程序）最后一步才锁死编辑器 + 全屏遮罩；
//   · 「下载 zip」只落盘、不替换程序 → 绝不弹全屏遮罩、绝不锁编辑器。

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
// ⚠ 这一份是给**远端内容**（GitHub Release 正文）用的：只做白名单式解析，
//   从不产生原始 HTML，所以天然免疫注入。
//   帮助中心渲染本地 README 用的是 marked（见 HelpCenter.tsx）—— 那里需要保留 README 里的
//   居中横幅等原始 HTML，属于可信来源，两者用途不同、刻意分开。

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

export function Markdown({ text }: { text: string }) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let code: string[] | null = null;
  // 列表项缩进层级（2 空格 = 一级），用来还原 GitHub Release 里的子条目
  const itemIndent = (raw: string) => Math.floor((/^\s*/.exec(raw)?.[0] ?? '').replace(/\t/g, '  ').length / 2);

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

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      // 层级固定映射成三档视觉权重，避免 h1..h6 六种字号把说明页切得七零八落
      const lv = h[1].length;
      const Tag = (lv <= 2 ? 'h4' : lv === 3 ? 'h5' : 'h6') as 'h4' | 'h5' | 'h6';
      blocks.push(<Tag key={`h${idx}`} className="md-h">{mdInline(h[2], `h${idx}`)}</Tag>);
      return;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const depth = Math.min(2, itemIndent(line));
      list.push(
        <li key={`li${idx}`} className={depth > 0 ? 'md-li-sub' : undefined}>
          {mdInline(line.replace(/^\s*([-*+]|\d+\.)\s+/, ''), `li${idx}`)}
        </li>
      );
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

  if (blocks.length === 0) return <div className="md-empty">（这个版本没有写发行说明）</div>;
  return <div className="md-body">{blocks}</div>;
}

/** 板块标题：左侧箭头 + 标题，右侧数量角标（点整行折叠/展开） */
function SectionTitle(props: {
  open: boolean;
  onToggle: () => void;
  title: string;
  count: number;
  countHint?: string;
}) {
  const { open, onToggle, title, count, countHint } = props;
  return (
    <button
      type="button"
      className={'update-sec' + (open ? ' is-open' : '')}
      onClick={onToggle}
      aria-expanded={open}
      title={countHint ?? `${title}：${count} 项，点击${open ? '收起' : '展开'}`}
    >
      <span className="update-sec-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      <span className="update-sec-name">{title}</span>
      <span className="update-sec-count">{count}</span>
    </button>
  );
}

export function UpdateCenter({ onBack }: { onBack: () => void }) {
  const [checking, setChecking] = useState(true);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [applyError, setApplyError] = useState('');
  // 三个板块的折叠状态：① 可更新默认展开；②③ 默认折叠
  const [openUpdatable, setOpenUpdatable] = useState(true);
  const [openReinstall, setOpenReinstall] = useState(false);
  const [openHistory, setOpenHistory] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [historyShown, setHistoryShown] = useState(HISTORY_PAGE);
  // 每条历史版本各自展开的发行说明
  const [notesOpen, setNotesOpen] = useState<string | null>(null);

  // 后台任务（主进程持有真相）：进度、暂停、继续、取消都从这里来
  const tasks = useTasks((s) => s.tasks);
  const busy = useUpdateBusy((s) => s.busy);

  /** 某个版本 tag 相关的任务：更新的（tag 相同）或下载 zip 的 */
  const taskOfTag = (tag: string, kind: 'download' | 'update'): BgTask | undefined =>
    tasks.find((t) => t.tag === tag && t.kind === kind);

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

  /**
   * 更新到某一版：**不再弹 confirm**（v0.4.4「尽量少弹窗」）。
   * 点一下就直接开始 —— 下载进度会出现在这张卡片下方，同时工具栏「任务」按钮里也能看到。
   * 只有到"解压 / 替换程序"那一步才锁编辑器（全屏遮罩）。
   */
  const install = async (entry: VersionEntry) => {
    if (!entry.asset) return;
    setApplyError('');
    const r = (await window.bc.applyUpdate(
      entry.asset.url, entry.asset.name, entry.version, entry.tag
    )) as unknown as { ok: boolean; error?: string };
    if (!r.ok) setApplyError(r.error || '更新失败');
  };

  /** 下载某个版本的 zip 到 data/downloads/（后台任务：可暂停/继续，离开页面也不会断） */
  const downloadZip = async (entry: VersionEntry) => {
    const asset = pickDownloadAsset(entry);
    if (!asset) return;
    const r = (await window.bc.downloadReleaseAsset(
      asset.url, asset.name, entry.tag, `下载 ${entry.tag} 的 zip`
    )) as unknown as { ok: boolean; error?: string };
    if (!r.ok) setApplyError(r.error || '下载启动失败');
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

  /** 正在跑的更新任务（页面顶部也会显示一条总览） */
  const runningUpdate = tasks.find((t) => t.kind === 'update' && (t.status === 'running' || t.status === 'applying'));

  /**
   * 版本卡片下方的任务条：
   *   · update 任务 → 显示"更新进行中"的阶段与进度
   *   · download 任务 → 进行中/可继续/失败都显示
   *   · 下载完成 → 「✓ 已下到 data/downloads」+「打开 zip 所在的文件夹」
   * 数据全部来自主进程，所以**下次打开这一页它还在**。
   */
  const renderTaskStrip = (tag: string) => {
    const dlTask = taskOfTag(tag, 'download');
    const upTask = taskOfTag(tag, 'update');
    const strips: ReactNode[] = [];

    if (upTask) {
      const failed = upTask.status === 'error';
      strips.push(
        <div key={`up-${upTask.id}`} className={'update-dl-strip' + (failed ? ' is-error' : '')}>
          <div className="update-dl-head">
            <span className="update-dl-msg">{upTask.detail}</span>
            {!failed && <span className="update-dl-pct">{Math.round(upTask.pct)}%</span>}
            {failed && (
              <button className="btn-mini" onClick={() => void window.bc.dismissTask(upTask.id)}>知道了</button>
            )}
          </div>
          {!failed && (
            <div className="update-dl-bar">
              <div className="update-dl-fill" style={{ width: `${Math.max(0, Math.min(100, upTask.pct))}%` }} />
            </div>
          )}
          {upTask.status === 'running' && (
            <div className="update-dl-actions">
              <button className="btn-mini" onClick={() => void window.bc.pauseTask(upTask.id)}>停止</button>
              <button className="btn-mini" onClick={() => void window.bc.cancelTask(upTask.id)}>取消</button>
              <span className="update-dl-hint">下载期间可以继续编辑，不影响。</span>
            </div>
          )}
          {RESUMABLE_STATUS.includes(upTask.status) && upTask.kind === 'update' && (
            <div className="update-dl-actions">
              <button className="btn-mini btn-primary" onClick={() => void window.bc.resumeTask(upTask.id)}>继续更新</button>
              <button className="btn-mini" onClick={() => void window.bc.dismissTask(upTask.id)}>移除记录</button>
            </div>
          )}
          {upTask.status === 'applying' && (
            <div className="update-dl-hint">正在替换程序本体，请不要关闭软件；data/ 下的一切都会保留。</div>
          )}
        </div>
      );
    }

    if (dlTask) {
      if (dlTask.status === 'done') {
        strips.push(
          <div key={`dl-${dlTask.id}`} className="update-dl-strip is-done">
            <span className="update-dl-done">✓ 已下载 <b title={dlTask.dest}>{dlTask.fileName}</b></span>
            <button
              className="btn-mini"
              onClick={() => void window.bc.revealTask(dlTask.id)}
              title="在文件管理器里打开这个 zip 所在的文件夹"
            >打开 zip 所在文件夹</button>
            <button
              className="btn-mini"
              onClick={() => void window.bc.dismissTask(dlTask.id)}
              title="只从任务列表移除这条记录（磁盘文件不动）"
            >移除记录</button>
          </div>
        );
      } else {
        strips.push(<InlineTaskStrip key={`dl-${dlTask.id}`} task={dlTask} />);
      }
    }

    return strips.length > 0 ? <>{strips}</> : null;
  };

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
            <div className="update-head-ver">
              <div className="update-current-label">当前版本</div>
              <div className="update-current-ver">{localVersion || '…'}</div>
            </div>
            <div className="update-head-status">
              {checking
                ? <span className="update-status-inline">正在连接发行版信息…</span>
                : result?.ok
                  ? result.hasUpdate && latest
                    ? <span className="update-status-inline ok">发现新版本 {latest.version}，可在下面更新</span>
                    : <span className="update-status-inline ok">✓ 已是最新版本</span>
                  : <span className="update-status-inline err">连接失败</span>}
            </div>
            <button className="btn-primary update-recheck-btn" onClick={check} disabled={checking}>
              {checking ? '正在检测…' : '↻ 重新检测'}
            </button>
          </div>
          {/* 技术细节默认收起：用户只关心"能不能更新、快不快" */}
          <button
            type="button"
            className={'update-detail-toggle' + (detailOpen ? ' is-open' : '')}
            onClick={() => setDetailOpen((v) => !v)}
            aria-expanded={detailOpen}
            title="展开后可看到这次的读取源 / 下载源与回退顺序"
          >
            <span className="update-sec-caret" aria-hidden="true">{detailOpen ? '▾' : '▸'}</span>
            检测详情
            <span className="update-detail-sub">（读取源 / 下载源）</span>
          </button>
          {detailOpen && (
            <div className="update-mirror-tip">
              <b>读取源</b>（自动回退）：{(result?.mirrors?.read ?? ['NexaCode 镜像', 'gh-proxy 镜像 (v4)', 'GitHub 直连']).join(' → ')}
              {result?.source && <span className="update-mirror-hit">本次经由：{result.source}</span>}
              <br />
              <b>下载源</b>（自动回退）：{(result?.mirrors?.download ?? ['gh-proxy 镜像 (v4)', 'NexaCode 镜像', 'GitHub 直连']).join(' → ')}
              <br />
              <span className="update-mirror-warn">下载支持暂停 / 断点续传；任务在工具栏「任务」按钮里也能看到。</span>
            </div>
          )}
        </div>

        {/* 更新任务总览（下载 / 解压 / 替换三个阶段都在这里说明白） */}
        {runningUpdate && (
          <div className="update-card update-running-card">
            <div className="update-running-head">
              <b>{runningUpdate.title}</b>
              <span className="update-running-stage">
                {runningUpdate.status === 'applying' ? '正在替换程序' : '正在下载更新包'}
              </span>
              <span className="update-running-pct">{Math.round(runningUpdate.pct)}%</span>
            </div>
            <div className="update-progress-bar">
              <div className="update-progress-fill" style={{ width: `${Math.max(0, Math.min(100, runningUpdate.pct))}%` }} />
            </div>
            <div className="update-running-detail">{runningUpdate.detail}</div>
            <div className="update-dl-actions">
              {runningUpdate.status === 'running' && (
                <>
                  <button className="btn-mini" onClick={() => void window.bc.pauseTask(runningUpdate.id)}>停止下载</button>
                  <button className="btn-mini" onClick={() => void window.bc.cancelTask(runningUpdate.id)}>取消更新</button>
                </>
              )}
              <span className="update-dl-hint">
                {runningUpdate.status === 'applying'
                  ? '正在替换程序本体，请不要关闭软件。'
                  : '下载期间可以继续编辑别的内容；替换程序那一步才会自动重启。'}
              </span>
            </div>
          </div>
        )}

        {!checking && result && !result.ok && (
          <div className="update-card update-error">检测失败：{result.error || '未知错误'}</div>
        )}

        {!checking && result?.ok && (
          <>
            {/* ============ ① 可更新（默认完全展开，发行说明直接显示） ============ */}
            <SectionTitle
              open={openUpdatable}
              onToggle={() => setOpenUpdatable((v) => !v)}
              title="可更新"
              count={newer.length}
              countHint={newer.length > 0 ? `${newer.length} 个比当前新的版本` : '没有比当前更新的版本'}
            />
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
                        disabled={!e.asset || busy || Boolean(taskOfTag(e.tag, 'update') && taskOfTag(e.tag, 'update')!.status === 'running')}
                        onClick={() => install(e)}
                      >
                        {`⬇ 更新到 v${e.version}`}
                      </button>
                      {!e.asset && <span className="update-asset-none">（本平台无对应安装包）</span>}
                      <span className="update-asset-none">点击即开始，无需二次确认</span>
                    </div>
                    {renderTaskStrip(e.tag)}
                  </div>
                ))}
              </>
            )}

            {/* ============ ② 可选择更新（重装，默认折叠） ============ */}
            <SectionTitle
              open={openReinstall}
              onToggle={() => setOpenReinstall((v) => !v)}
              title="可选择更新（重装）"
              count={current.length}
              countHint={current.length > 0 ? `${current.length} 个与当前版本号一致的条目，可重新安装` : '发行版里没有与当前版本号一致的条目'}
            />
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
                        ⟲ 重新安装此版本
                      </button>
                    </div>
                    {renderTaskStrip(e.tag)}
                  </div>
                ))}
              </>
            )}

            {/* ============ ③ 历史版本（默认折叠；逐条看说明 / 下载 zip / 查看更多） ============ */}
            {older.length > 0 && (
              <>
                <SectionTitle
                  open={openHistory}
                  onToggle={() => setOpenHistory((v) => !v)}
                  title="历史版本"
                  count={older.length}
                  countHint={`${older.length} 个比当前更早的版本，可查看发行说明或下载 zip 到 data/downloads/`}
                />
                {openHistory && (
                  <>
                    <div className="update-history-list">
                      {shownOlder.map((e) => {
                        const asset = pickDownloadAsset(e);
                        const dlTask = taskOfTag(e.tag, 'download');
                        const isDownloading = dlTask?.status === 'running' || dlTask?.status === 'applying';
                        const saved = dlTask?.status === 'done';
                        return (
                          <div key={e.tag} className="update-history-row">
                            <div className="update-history-main">
                              <span className="update-history-ver">{e.tag}</span>
                              <span className="update-history-name">{e.name}</span>
                              <span className="update-history-date">{fmtDate(e.publishedAt)}</span>
                            </div>
                            <div className="update-history-acts">
                              <button
                                className={'update-notes-toggle' + (notesOpen === e.tag ? ' is-open' : '')}
                                onClick={() => setNotesOpen(notesOpen === e.tag ? null : e.tag)}
                                aria-expanded={notesOpen === e.tag}
                              >
                                {notesOpen === e.tag ? '▾ 收起说明' : '▸ 发行说明'}
                              </button>
                              <button
                                className="btn-mini update-dl-btn"
                                disabled={!asset || isDownloading}
                                title={asset ? `下载 ${asset.name}（${fmtSize(asset.size)}）到 data/downloads/` : '这个版本没有可下载的附件'}
                                onClick={() => downloadZip(e)}
                              >
                                {isDownloading ? '下载中…' : saved ? '重新下载' : '⬇ 下载 zip'}
                              </button>
                              {saved && <span className="update-history-saved" title={dlTask?.dest}>已下载</span>}
                            </div>
                            {renderTaskStrip(e.tag)}
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
                  </>
                )}
              </>
            )}

            {applyError && <div className="update-card update-apply-error">{applyError}</div>}
          </>
        )}
      </div>
    </div>
  );
}
