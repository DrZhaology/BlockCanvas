import { useEffect, useState } from 'react';
import { useUpdateBusy } from '@store/updateStore';

// BlockCanvas · 更新中心（v0.4.3 重写）
//
// 读取发行版信息：NexaCode 镜像 → gh-proxy(v4) → GitHub 直连（三层自动回退，用户无感）
// 下载更新包：    gh-proxy(v4) → NexaCode → GitHub 直连 + zip 完整性校验
//
// 列表规则：
//   · 当前版本 + 往后的全部版本 → 都可以点「更新到这一版」；
//   · 当前版本往前的 5 个版本   → 纯信息展示（没有更新按钮，避免误降级）；
//   · 更早的版本不展示。
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

function fmtSize(bytes: number): string {
  if (!bytes) return '-';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
/** 发行说明：去掉 markdown 标记，只留可读的几行 */
function tidyNotes(body: string): string {
  return (body || '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()
    .slice(0, 600);
}

export function UpdateCenter({ onBack }: { onBack: () => void }) {
  const [checking, setChecking] = useState(true);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [applyError, setApplyError] = useState('');
  const [restarting, setRestarting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  // 订阅主进程的更新进度推送
  useEffect(() => {
    const off = window.bc.onUpdateProgress((p) => setProgress(p.msg, p.pct));
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const entries = result?.entries ?? [];
  const updateable = entries.filter((e) => e.updateable);
  const history = entries.filter((e) => !e.updateable);
  const latest = result?.latest ?? null;
  const localVersion = result?.localVersion ?? '';
  const platform = result?.platform ?? '';
  const platformAdapted = ADAPTED_PLATFORMS.includes(platform);

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
          <div className="update-mirror-tip">
            <b>读取源</b>（自动回退）：{(result?.mirrors?.read ?? ['NexaCode 镜像', 'gh-proxy 镜像 (v4)', 'GitHub 直连']).join(' → ')}
            <br />
            <b>下载源</b>（自动回退）：{(result?.mirrors?.download ?? ['gh-proxy 镜像 (v4)', 'NexaCode 镜像', 'GitHub 直连']).join(' → ')}
            {result?.source && <span className="update-mirror-hit">本次经由：{result.source}</span>}
            <br />
            <span className="update-mirror-warn">全部失败时，请先关闭 Watt Toolkit / Clash 等后台代理再重试。</span>
          </div>
        </div>

        {!checking && result && !result.ok && (
          <div className="update-card update-error">检测失败：{result.error || '未知错误'}</div>
        )}

        {!checking && result?.ok && (
          <>
            {/* —— 可更新版本 —— */}
            <div className="update-section-title">
              可选择更新
              <span className="update-section-sub">当前版本及之后的版本都可以更新（含重新安装当前版本）</span>
            </div>
            {updateable.length === 0 && (
              <div className="update-card update-up-to-date">✓ 没有可更新的版本。</div>
            )}
            {updateable.map((e, i) => (
              <div key={e.tag} className={'update-card update-release-card' + (i === 0 && latest ? ' is-latest' : '')}>
                <div className="update-release-head">
                  <b>{e.name || e.tag}</b>
                  <span className="update-release-tag">{e.tag}</span>
                  {e.isCurrent && <span className="update-badge current">当前版本</span>}
                  {e.prerelease && <span className="update-badge pre">预发布</span>}
                  {i === 0 && latest && !e.isCurrent && <span className="update-badge latest">最新</span>}
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
                {tidyNotes(e.body) && (
                  <button className="update-notes-toggle" onClick={() => setExpanded(expanded === e.tag ? null : e.tag)}>
                    {expanded === e.tag ? '收起发行说明' : '查看发行说明'}
                  </button>
                )}
                {expanded === e.tag && <pre className="update-release-notes">{tidyNotes(e.body)}</pre>}
                <div className="update-release-actions">
                  <button
                    className={'btn-primary update-install-btn' + (e.isCurrent ? ' is-reinstall' : '')}
                    disabled={!e.asset || busy}
                    onClick={() => install(e)}
                  >
                    {busy ? '更新进行中…' : e.isCurrent ? '⟲ 重新安装此版本' : `⬇ 更新到 v${e.version}`}
                  </button>
                  {!e.asset && <span className="update-asset-none">（本平台无对应安装包）</span>}
                </div>
              </div>
            ))}

            {/* —— 历史版本（只读） —— */}
            {history.length > 0 && (
              <>
                <div className="update-section-title">
                  历史版本
                  <span className="update-section-sub">当前版本之前的 {history.length} 个版本，仅作信息展示</span>
                </div>
                <div className="update-history-list">
                  {history.map((e) => (
                    <div key={e.tag} className="update-history-row">
                      <span className="update-history-ver">{e.tag}</span>
                      <span className="update-history-name">{e.name}</span>
                      <span className="update-history-date">{fmtDate(e.publishedAt)}</span>
                      <span className="update-history-assets">
                        {e.assets.length === 0
                          ? '（无附件）'
                          : e.assets.map((a) => a.name).join('、')}
                      </span>
                    </div>
                  ))}
                </div>
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
