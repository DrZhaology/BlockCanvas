import { useEffect, useMemo, useRef, useState } from 'react';
import { exportHTML } from '@lib/exporter';

// BlockCanvas · 扩展管理（全页界面）
// 取代旧的弹窗式 ExtensionsDialog：
//  - 资源包 / 插件 卡片：启停开关、导出（zip / 文件夹）、删除（回收站、双重确认）
//  - 资源包卡片小三角可展开，直接预览包内模板
//  - 导入：资源包文件夹 / 单个模板 JSON / zip 资源包
//  - 生成资源包结构：输入元信息 → 生成 manifest + templates 目录骨架
// 禁用 = 隐藏（文件保留）；删除 = 移入回收站

export function ExtensionManager(props: { onBack: () => void }) {
  const { onBack } = props;
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'plugins' | 'resources'; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [makeForm, setMakeForm] = useState({ name: '', id: '', version: '1.0.0', author: '', description: '' });

  const rescan = () => {
    setScan(null);
    window.bc.scanExtensions().then(setScan);
  };
  useEffect(() => { rescan(); }, []);

  const toggleExpand = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // 一次操作：包装成败提示，结束后重新扫描
  const run = async (label: string, fn: () => Promise<{ ok: boolean; error?: string; canceled?: boolean; path?: string }>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) {
        if (r.path) alert(label + '成功：' + r.path);
      } else if (r.canceled) {
        // 用户取消，静默
      } else {
        alert(label + '失败：' + (r.error ?? '未知错误'));
      }
      rescan();
      return r.ok;
    } finally {
      setBusy(false);
    }
  };

  // 插件改动（启停/导入/删除）后通知宿主刷新
  const pluginsChanged = () => window.dispatchEvent(new CustomEvent('bc:plugins-changed'));

  const onToggleEnabled = async (kind: 'plugins' | 'resources', id: string, enabled: boolean) => {
    const ok = await run(enabled ? '启用' : '禁用', () => window.bc.setExtensionEnabled(kind, id, enabled));
    if (kind === 'plugins' && ok) pluginsChanged();
  };

  const onDelete = async (kind: 'plugins' | 'resources', id: string) => {
    const ok = await run('删除（移入回收站）', () => window.bc.deleteExtension(kind, id));
    if (kind === 'plugins' && ok) pluginsChanged();
    setConfirmDelete(null);
  };

  const onImportFolder = () => run('导入资源包', () => window.bc.importExtensionFolder('resources'));
  const onImportJson = () => run('导入模板', () => window.bc.importJsonTemplate());
  const onImportZip = () => run('导入 zip 资源包', () => window.bc.importExtensionZip('resources'));

  // —— 插件导入：文件夹 / zip 均可；导入或改动插件后刷新插件宿主 ——
  const onImportPluginFolder = async () => {
    const ok = await run('导入插件', () => window.bc.importExtensionFolder('plugins'));
    if (ok) pluginsChanged();
  };
  const onImportPluginZip = async () => {
    const ok = await run('导入插件 zip', () => window.bc.importExtensionZip('plugins'));
    if (ok) pluginsChanged();
  };

  const onExportResource = (id: string, format: 'folder' | 'zip') =>
    run(format === 'zip' ? '导出 zip 资源包' : '导出资源包文件夹', () => window.bc.exportResource(id, format));

  const onOpenDir = async () => { const r = await window.bc.openExtensionsDir(); if (!r.ok) alert('打开扩展文件夹失败：' + (r.error ?? '')); };

  const onCreatePackage = async () => {
    if (!makeForm.name.trim()) { alert('请填写资源包名称'); return; }
    const r = await window.bc.createResourcePackage({ ...makeForm, id: makeForm.id || undefined });
    if (r.ok) {
      alert('已生成资源包结构：\n' + (r.path ?? ''));
      setCreating(false);
      setMakeForm({ name: '', id: '', version: '1.0.0', author: '', description: '' });
      rescan();
    } else {
      alert('生成失败：' + (r.error ?? '未知错误'));
    }
  };

  const showTotal = useMemo(() => {
    if (!scan) return null;
    return {
      res: scan.resources.filter((r) => r.enabled).length,
      tpl: scan.resources.reduce((n, r) => n + (r.templates?.length ?? 0), 0),
      plug: scan.plugins.filter((p) => p.enabled).length
    };
  }, [scan]);

  return (
    <div className="extm">
      <div className="extm-topbar">
        <button className="extm-back" onClick={onBack}>← 返回编辑</button>
        <span className="extm-title">扩展管理</span>
        <span className="spacer" />
        <button className="extm-btn" onClick={() => rescan()} disabled={busy}>⟳ 重新扫描</button>
        <button className="extm-btn" onClick={onOpenDir}>📂 打开扩展文件夹</button>
      </div>

      <div className="extm-scroll">
      {showTotal && (
        <div className="extm-summary">
          已启用资源包 {showTotal.res} 个 · 模板 {showTotal.tpl} 个 · 插件 {showTotal.plug} 个
          <span className="extm-summary-sub">（禁用项不显示在模板库，但文件保留）</span>
        </div>
      )}

      {/* 导入与生成 */}
      <div className="extm-actions">
        <div className="extm-action-group">
          <span className="extm-action-label">资源</span>
          <button className="extm-btn" onClick={onImportFolder} disabled={busy}>导入资源包文件夹</button>
          <button className="extm-btn" onClick={onImportZip} disabled={busy}>导入 zip 资源包</button>
          <button className="extm-btn" onClick={onImportJson} disabled={busy}>导入模板 JSON</button>
        </div>
        <div className="extm-action-group">
          <span className="extm-action-label">插件</span>
          <button className="extm-btn" onClick={onImportPluginFolder} disabled={busy}>导入插件文件夹</button>
          <button className="extm-btn" onClick={onImportPluginZip} disabled={busy}>导入插件 zip</button>
        </div>
        <div className="extm-action-group">
          <span className="extm-action-label">生成</span>
          <button className="extm-btn" onClick={() => setCreating(!creating)}>{creating ? '收起' : '＋ 生成资源包结构'}</button>
        </div>
      </div>

      {creating && (
        <div className="extm-maker">
          <div className="extm-maker-cols">
            <label className="extm-field">
              <span>资源包名称 *</span>
              <input value={makeForm.name} onChange={(e) => setMakeForm({ ...makeForm, name: e.target.value })} placeholder="例如：营销组件" />
            </label>
            <label className="extm-field">
              <span>目录 id（英文，留空自动从名称生成）</span>
              <input value={makeForm.id} onChange={(e) => setMakeForm({ ...makeForm, id: e.target.value })} placeholder="例如：marketing-kit" />
            </label>
            <label className="extm-field">
              <span>版本</span>
              <input value={makeForm.version} onChange={(e) => setMakeForm({ ...makeForm, version: e.target.value })} placeholder="1.0.0" />
            </label>
            <label className="extm-field">
              <span>作者</span>
              <input value={makeForm.author} onChange={(e) => setMakeForm({ ...makeForm, author: e.target.value })} placeholder="（可选）" />
            </label>
            <label className="extm-field extm-field-wide">
              <span>介绍</span>
              <input value={makeForm.description} onChange={(e) => setMakeForm({ ...makeForm, description: e.target.value })} placeholder="一句话说明该资源包的用途（可选）" />
            </label>
          </div>
          <div className="extm-maker-tip">
            生成后在 <code>extensions\resources\&lt;id&gt;\</code> 得到 <code>manifest.json</code> + <code>templates\\</code> 空目录。
            把单个模板 JSON 放进 templates\\ ，并在 manifest.json 的 templates 数组加一条即可。
          </div>
          <button className="extm-btn extm-btn-primary" onClick={onCreatePackage} disabled={busy}>生成</button>
        </div>
      )}

      {/* 资源包列表 */}
      <div className="extm-section-title">资源包（提供模板）</div>
      {!scan && <div className="hint">扫描中…</div>}
      {scan && scan.resources.length === 0 && <div className="hint">还没有资源包，可用上方「导入」或「生成资源包结构」创建。</div>}
      {scan && scan.resources.map((r) => (
        <div key={r.id} className={"extm-card" + (r.enabled ? '' : ' extm-card-disabled')}>
          <div className="extm-card-head">
            <button className="extm-caret" onClick={() => toggleExpand(r.id)} title={expanded[r.id] ? '收起预览' : '展开预览模板'}>
              <span className={expanded[r.id] ? 'open' : ''}>▸</span>
            </button>
            <div className="extm-card-title">
              <span className="extm-name">{r.name}</span>
              {r.version && <span className="extm-sub">v{r.version}</span>}
              {r.author && <span className="extm-sub">作者：{r.author}</span>}
              {!r.enabled && <span className="extm-badge">已禁用</span>}
            </div>
            <span className="extm-card-meta">{r.templates.length} 个模板</span>
            <span className="spacer" />
            <div className="extm-card-actions">
              <button className="extm-btn" onClick={() => onExportResource(r.id, 'zip')} disabled={busy}>导出 zip</button>
              <button className="extm-btn" onClick={() => onExportResource(r.id, 'folder')} disabled={busy}>导出文件夹</button>
              <button
                className="extm-btn"
                onClick={() => onToggleEnabled('resources', r.id, !r.enabled)}
                disabled={busy}
                title="禁用后此资源包在模板库隐藏，文件保留"
              >{r.enabled ? '禁用' : '启用'}</button>
              <button className="extm-btn extm-btn-danger" onClick={() => setConfirmDelete({ kind: 'resources', id: r.id, name: r.name })} disabled={busy}>删除</button>
            </div>
          </div>
          {r.description && <div className="extm-desc">{r.description}</div>}
          {r.error && <div className="hint" style={{ color: '#c0392b' }}>加载失败：{r.error}</div>}
          {expanded[r.id] && (
            <div className="extm-preview">
              {r.templates.map((t) => (
                <TemplatePreviewThumb key={t.id} resId={r.id} tpl={t} />
              ))}
              {r.templates.length === 0 && <div className="hint">此资源包还没有模板。</div>}
            </div>
          )}
        </div>
      ))}

      {/* 插件列表 */}
      <div className="extm-section-title" style={{ marginTop: 18 }}>插件（改界面与功能）</div>
      {scan && scan.plugins.length === 0 && (
        <div className="hint">还没有插件。可导入包含 manifest.json（type: plugin + main 入口）的插件文件夹或 zip，启用后插件代码随即生效。</div>
      )}
      {scan && scan.plugins.map((p) => (
        <div key={p.id} className={"extm-card" + (p.enabled ? '' : ' extm-card-disabled')}>
          <div className="extm-card-head">
            <div className="extm-card-title">
              <span className="extm-name">{p.name}</span>
              {p.version && <span className="extm-sub">v{p.version}</span>}
              {p.author && <span className="extm-sub">作者：{p.author}</span>}
              {p.enabled ? <span className="extm-badge extm-badge-ok">已启用</span> : <span className="extm-badge">已禁用</span>}
            </div>
            <span className="spacer" />
            <div className="extm-card-actions">
              <button className="extm-btn" onClick={() => onToggleEnabled('plugins', p.id, !p.enabled)} disabled={busy}>
                {p.enabled ? '禁用' : '启用'}
              </button>
              <button className="extm-btn extm-btn-danger" onClick={() => setConfirmDelete({ kind: 'plugins', id: p.id, name: p.name })} disabled={busy}>删除</button>
            </div>
          </div>
          {(p.description || p.id) && <div className="extm-desc">{p.description || p.id}</div>}
          {p.error && <div className="hint" style={{ color: '#c0392b' }}>加载失败：{p.error}</div>}
        </div>
      ))}

      {scan && scan.errors.length > 0 && (
        <div className="extm-errors">
          {scan.errors.map((e, i) => <div key={i} className="hint" style={{ color: '#c0392b' }}>{e}</div>)}
        </div>
      )}
      </div>

      {/* 删除双重确认遮罩 */}
      {confirmDelete && (
        <div className="modal-mask" onClick={() => setConfirmDelete(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">确认删除</span>
              <button className="modal-close" onClick={() => setConfirmDelete(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>确定要删除「{confirmDelete.name}」（{confirmDelete.kind === 'resources' ? '资源包' : '插件'}）吗？</p>
              <p className="hint">删除会将其移到<strong>回收站</strong>，可以恢复。此操作不可撤销在程序内的显示。</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>取消</button>
              <button className="extm-btn extm-btn-danger" onClick={() => onDelete(confirmDelete.kind, confirmDelete.id)} disabled={busy}>确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 资源包内模板的轻量预览（展开小三角时显示） ============
function TemplatePreviewThumb(props: { resId: string; tpl: { id: string; name: string; description: string } }) {
  const { resId, tpl } = props;
  const [srcdoc, setSrcdoc] = useState('');
  const [failed, setFailed] = useState(false);
  const [contentW, setContentW] = useState(1280);
  const [contentH, setContentH] = useState(0);
  const [viewW, setViewW] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await window.bc.readTemplate(resId, tpl.id);
        if (!res.ok || !res.template) throw new Error(res.error ?? '');
        const rootW = res.template.style?.width;
        const parsed = rootW ? parseInt(String(rootW)) : NaN;
        const baseW = parsed > 0 ? parsed : 1280;
        const shell: any = {
          id: 'tpl-shell', type: 'div', text: undefined, children: [res.template],
          style: { width: baseW + 'px', boxSizing: 'border-box', overflow: 'hidden', padding: '0px', backgroundColor: '#ffffff' }
        };
        const { html } = exportHTML({ root: shell, selectedId: null, selectedIds: [] });
        if (alive) setSrcdoc(html);
      } catch { if (alive) setFailed(true); }
    })();
    return () => { alive = false; };
  }, [resId, tpl.id]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const onLoad = () => {
    const f = wrapRef.current?.querySelector('iframe');
    const doc = f?.contentDocument;
    if (!doc) return;
    const st = doc.createElement('style');
    st.textContent = 'html, body { overflow: hidden !important; }';
    doc.head.appendChild(st);
    setContentW(Math.min(Math.max(doc.documentElement.scrollWidth, 1280), 2560));
    setContentH(Math.min(doc.body.scrollHeight, 200));
  };

  const scale = viewW > 0 && contentH > 0 ? Math.min(viewW / contentW, 150 / contentH) : 0;
  const viewH = scale * contentH;
  const ready = srcdoc !== '' && contentH > 0 && viewW > 0;

  return (
    <div className="tpl-card">
      <div ref={wrapRef} className="tpl-thumb" style={ready ? { height: Math.round(viewH) } : undefined}>
        {srcdoc ? (
          <iframe
            className="tpl-thumb-frame"
            title={tpl.name}
            srcDoc={srcdoc}
            scrolling="no"
            onLoad={onLoad}
            style={ready ? { width: contentW, height: contentH, transform: `scale(${scale})`, transformOrigin: 'left top', pointerEvents: 'none' } : undefined}
          />
        ) : failed ? (
          <div className="tpl-thumb-fail">预览失败</div>
        ) : (
          <div className="tpl-thumb-loading">加载中…</div>
        )}
      </div>
      <div className="tpl-card-name">{tpl.name}</div>
      <div className="tpl-card-desc">{tpl.description || '模板'}</div>
    </div>
  );
}