import { useCallback, useEffect, useState } from 'react';
import { useScene } from '@store/sceneStore';
import { showToast } from '@lib/toast';
import { Icon } from './Icon';
import type { ElementType } from '@lib/types';

// ============================================================================
// BlockCanvas · 素材库（v0.4.5）
// ----------------------------------------------------------------------------
// 保存工程时会把用到的本地图片/视频打包进 .bcproj 的 assets/，
// 打开时解到 data/cache/assets/。这个面板就是把那份缓存列出来复用：
//   · 缩略图网格（图片直接显示，视频/音频用图标 + 文件名）
//   · 点一下就插入到画布（图片→img，视频→video，音频→audio）
//   · 「导入素材…」把本机文件收进库（内容哈希命名，天然去重）
//
// 为什么值得有：以前每放一张图都要重新去文件管理器翻一遍，
// 同一个 logo 用五次就要选五次文件。
// ============================================================================

type CachedAsset = {
  name: string;
  url: string;
  bytes: number;
  mtime: string;
  kind: 'image' | 'video' | 'audio' | 'other';
};

const fmtKB = (n: number) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

export function AssetGallery() {
  const [items, setItems] = useState<CachedAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.bc.listAssets();
      setItems(Array.isArray(list) ? list : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const insert = (a: CachedAsset) => {
    const type: ElementType = a.kind === 'video' ? 'video' : a.kind === 'audio' ? 'audio' : 'img';
    const st = useScene.getState();
    const before = new Set((st.scene.root.children || []).map((c) => c.id));
    st.addElement(type);
    const s2 = useScene.getState();
    const kids = s2.scene.root.children || [];
    const fresh = kids.find((c) => !before.has(c.id)) || kids[kids.length - 1];
    if (!fresh) { showToast('插入失败：请先选中一个容器', 'err'); return; }
    useScene.getState().updateAttr(fresh.id, 'src', a.url);
    showToast(`已插入 ${a.kind === 'image' ? '图片' : a.kind === 'video' ? '视频' : '音频'}`);
  };

  const importFiles = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await window.bc.importAssets();
      if (r?.canceled) return;
      if (!r?.ok) { showToast('导入失败', 'err'); return; }
      await load();
      showToast(`已导入 ${r.items?.length || 0} 个素材`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="asset-gallery">
      <div className="asset-gallery-head">
        <span className="asset-gallery-title">
          <Icon name="image" size={13} /> 素材库
          <span className="asset-gallery-count">{items.length}</span>
        </span>
        <button className="btn-mini" onClick={() => void importFiles()} disabled={busy}>
          {busy ? '导入中…' : '导入素材…'}
        </button>
      </div>

      {loading && <div className="asset-gallery-empty">正在读取素材…</div>}

      {!loading && items.length === 0 && (
        <div className="asset-gallery-empty">
          <div className="asset-gallery-empty-ico"><Icon name="image" size={26} /></div>
          <p>这里会列出工程里用过的所有图片、视频和音频。</p>
          <p className="hint">保存一次带图片的工程后就会出现，也可以直接「导入素材…」。</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="asset-gallery-grid">
          {items.map((a) => (
            <button
              key={a.name}
              className="asset-item"
              onClick={() => insert(a)}
              title={`${a.name}\n${fmtKB(a.bytes)} · 点击插入到画布`}
            >
              <span className="asset-thumb">
                {a.kind === 'image'
                  ? <img src={a.url} alt="" draggable={false} />
                  : <span className="asset-thumb-ico">
                      <Icon name={a.kind === 'video' ? 'video' : 'note'} size={20} />
                    </span>}
              </span>
              <span className="asset-meta">
                <span className="asset-kind">{a.kind === 'image' ? '图片' : a.kind === 'video' ? '视频' : a.kind === 'audio' ? '音频' : '文件'}</span>
                <span className="asset-size">{fmtKB(a.bytes)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}