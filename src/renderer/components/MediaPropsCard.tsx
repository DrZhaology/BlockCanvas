import { useState } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { Icon } from './Icon';
import type { ElementType } from '@lib/types';

// ============================================================================
// BlockCanvas · 媒体属性卡（v0.4.5）
// ----------------------------------------------------------------------------
// 给 <video> / <audio> 一个"说人话"的设置面板：
//   · 媒体地址：可直接粘网址，也可以选本地文件（本地文件走 bc-img:// 协议）
//   · 循环播放 / 静音：两个开关，写进元素的 attrs，导出时原样带上
//
// 为什么单独做一张卡：这两个元素的可用属性其实只有 4 个，
// 让用户去「添加属性」里手填 src="…" 太反人类（而且很容易写成 src= 带引号的各种变形）。
// ============================================================================

export function MediaPropsCard({ elementId, elementType }: { elementId: string; elementType: ElementType }) {
  const scene = useScene((s) => s.scene);
  const updateAttr = useScene((s) => s.updateAttr);
  const node = findNode(scene.root, elementId);
  const [picking, setPicking] = useState(false);

  if (!node) return null;
  const isVideo = elementType === 'video';
  const src = String(node.attrs?.src ?? '');
  const loop = node.attrs?.loop === '1';
  const muted = node.attrs?.muted === '1';

  const pickLocal = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const r = await window.bc.pickMediaSrc(isVideo ? 'video' : 'audio');
      if (!r?.ok || !r.path) return;
      updateAttr(elementId, 'src', r.path);
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="inspector-sec media-props">
      <div className="inspector-sec-head static">
        <span className="media-props-title">
          <Icon name={isVideo ? 'video' : 'note'} size={13} />
          {isVideo ? '视频播放' : '音频播放'}
        </span>
        <span className="media-props-hint">{isVideo ? '<video>' : '<audio>'}</span>
      </div>

      <div className="media-props-body">
        <label className="media-props-row">
          <span className="media-props-label">媒体地址</span>
          <input
            className="media-props-src"
            value={src}
            placeholder={isVideo ? '粘贴视频地址，或点右侧选择本地文件' : '粘贴音频地址，或点右侧选择本地文件'}
            spellCheck={false}
            onChange={(e) => updateAttr(elementId, 'src', e.target.value)}
          />
          <button
            className="btn-mini media-props-pick"
            onClick={() => void pickLocal()}
            disabled={picking}
            title={isVideo ? '从本机选一个视频文件' : '从本机选一个音频文件'}
          >{picking ? '选择中…' : '本地文件…'}</button>
        </label>

        <div className="media-props-toggles">
          <label className="media-props-toggle" title="播放到结尾后自动重新开始">
            <input type="checkbox" checked={loop} onChange={(e) => updateAttr(elementId, 'loop', e.target.checked ? '1' : '')} />
            循环播放
          </label>
          <label className="media-props-toggle" title="默认静音（浏览器允许自动播放的前提）">
            <input type="checkbox" checked={muted} onChange={(e) => updateAttr(elementId, 'muted', e.target.checked ? '1' : '')} />
            默认静音
          </label>
        </div>

        <div className="media-props-tip">
          {isVideo
            ? '视频会按原始比例显示；想固定画面大小，可以再加「宽度 / 高度」或「宽高比」属性。'
            : '音频没有画面，默认只显示一条播放条；它的高度由浏览器决定。'}
          {src && /^([a-zA-Z]:|\\\\|\/)/.test(src) && (
            <> 本地文件会在保存工程时一起打包进 .bcproj，换机器打开也能播。</>
          )}
        </div>
      </div>
    </div>
  );
}