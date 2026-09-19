import { useEffect, useState } from 'react';

// BlockCanvas · 更新中心（v0.4.1：软件内页面，不再使用弹窗）
//
// 流程：
//   检测（GitHub Releases，含预发布版）→ 展示版本列表与平台匹配状态
//   → 下载（gh-proxy 镜像加速，进度条）→ 退出后由独立批处理完成文件替换
//   （robocopy 覆盖程序文件、排除 data/、清理全部临时文件）→ 自动重启。
//
// 平台说明：当前只原生适配 Windows；其他平台（mac/linux/android/ios）会显示
// 发行版里有没有对应构建 —— 没有则可检测但不可更新。
// 下载走 https://v4.gh-proxy.org/ 镜像：使用前请关闭 Watt Toolkit / Clash 等后台代理。

interface CheckResult {
  ok: boolean;
  isDev?: boolean;
  error?: string;
  localVersion?: string;
  hasUpdate?: boolean;
  platform?: string;
  releases?: Array<{
    tag: string;
    version: string;
    name: string;
    publishedAt: string;
    prerelease: boolean;
    body?: string;
    assets: { name: string; browser_download_url: string; size: number }[];
  }>;
  latest?: {
    version: string;
    name: string;
    tag: string;
    publishedAt: string;
    prerelease: boolean;
    asset: { url: string; name: string; size: number } | null;
  };
}

const PLATFORM_LABEL: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS / iPhone'
};

function fmtSize(bytes: number): string {
  if (!bytes) return '-';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function UpdateCenter({ onBack }: { onBack: () => void }) {
  const [checking, setChecking] = useState(true);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [progress, setProgress] = useState<{ msg: string; pct?: number } | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [applyError, setApplyError] = useState('');

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
    const off = window.bc.onUpdateProgress((p) => setProgress(p));
    return off;
  }, []);

  const install = async (url: string) => {
    setApplyError('');
    setProgress({ msg: '准备下载…', pct: 0 });
    const r = (await window.bc.applyUpdate(url)) as unknown as { ok: boolean; error?: string };
    if (r.ok) {
      setRestarting(true);
    } else {
      setProgress(null);
      setApplyError(r.error || '更新失败');
    }
  };

  const latest = result?.latest;
  const canInstall = !!latest?.asset;
  const localVersion = result?.localVersion ?? '';

  return (
    <div className="update-page">
      {/* 顶栏 */}
      <div className="update-topbar">
        <button className="fluent-back-btn" onClick={onBack}>← 返回编辑器</button>
        <div className="update-brand">
          <span className="update-brand-logo">⚡</span>
          <span className="update-brand-text">BlockCanvas 更新中心</span>
        </div>
      </div>

      <div className="update-body">
        {/* —— 当前版本 + 检测 —— */}
        <div className="update-card">
          <div className="update-card-row">
            <div>
              <div className="update-current-label">当前版本</div>
              <div className="update-current-ver">{localVersion || '…'}</div>
            </div>
            <button className="btn-primary" onClick={check} disabled={checking || !!progress}>
              {checking ? '正在检测…' : '检测更新'}
            </button>
          </div>
          <div className="update-mirror-tip">
            ⚠ 下载走 gh-proxy 镜像加速。检测或下载失败时，请先
            <b> 关闭 Watt Toolkit / Clash 等后台代理软件</b>，再重新检测。
          </div>
        </div>

        {checking && <div className="update-status">正在连接 GitHub Releases…</div>}

        {!checking && result && !result.ok && (
          <div className="update-card update-error">
            检测失败：{result.error || '未知错误'}
          </div>
        )}

        {!checking && result?.ok && (
          <>
            {/* —— 检测结论 —— */}
            {result.hasUpdate && latest ? (
              <div className="update-card update-found">
                <div className="update-found-title">
                  发现新版本 <b>{latest.version}</b>
                  {latest.prerelease && <span className="update-prerelease-badge">预发布</span>}
                </div>
                <div className="update-found-sub">{latest.name} · {new Date(latest.publishedAt).toLocaleString()}</div>

                {/* 平台匹配状态 */}
                {canInstall ? (
                  <div className="update-asset">
                    ✓ 当前平台（{PLATFORM_LABEL[result.platform ?? ''] ?? result.platform}）匹配到：
                    <b>{latest.asset!.name}</b>（{fmtSize(latest.asset!.size)}）
                  </div>
                ) : (
                  <div className="update-asset warn">
                    ⚠ 该发行版没有提供 {PLATFORM_LABEL[result.platform ?? ''] ?? result.platform} 平台的构建，
                    本次无法自动更新（发行版里也没有可用的安装包）。可到发行页查看详情。
                  </div>
                )}

                {/* 下载 / 进度 / 完成 */}
                {restarting ? (
                  <div className="update-progress done">
                    ✓ 更新完成！程序正在重启…（重启后即为新版本，你的 data/ 数据全部保留）
                  </div>
                ) : progress ? (
                  <div className="update-progress">
                    <div className="update-progress-msg">{progress.msg}</div>
                    <div className="update-progress-bar">
                      <div className="update-progress-fill" style={{ width: `${progress.pct ?? 0}%` }} />
                    </div>
                  </div>
                ) : canInstall && result.latest ? (
                  <button className="btn-primary update-install-btn" onClick={() => install(result.latest!.asset!.url)}>
                    ⬇ 下载并安装（自动保留 data/ 数据）
                  </button>
                ) : null}

                {applyError && <div className="update-apply-error">更新失败：{applyError}</div>}
              </div>
            ) : (
              <div className="update-card update-up-to-date">
                ✓ 当前已是最新版本{latest ? `（${latest.version}）` : ''}，无需更新。
              </div>
            )}

            {/* —— 发行版列表（含预发布） —— */}
            <div className="update-list-title">发行版列表（含预发布版，最新在前）</div>
            <div className="update-list">
              {(result.releases ?? []).map((r) => (
                <div key={r.tag} className="update-release">
                  <div className="update-release-head">
                    <b>{r.name || r.tag}</b>
                    <span className="update-release-tag">{r.tag}</span>
                    {r.prerelease && <span className="update-prerelease-badge">预发布</span>}
                    <span className="update-release-date">{new Date(r.publishedAt).toLocaleDateString()}</span>
                  </div>
                  {r.body && <pre className="update-release-notes">{r.body}</pre>}
                  <div className="update-release-assets">
                    {r.assets.length === 0 && <span className="update-release-noasset">（无附件）</span>}
                    {r.assets.map((a) => (
                      <span key={a.name} className="update-release-asset" title={`${a.name} · ${fmtSize(a.size)}`}>
                        📦 {a.name}（{fmtSize(a.size)}）
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
