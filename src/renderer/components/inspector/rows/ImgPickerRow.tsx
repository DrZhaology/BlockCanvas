// BlockCanvas · 图片路径行（相对 / 绝对 / 网络 URL 三种模式 + file:// 提示）

import { useState } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { Icon } from '../../Icon';
import { HelpButton } from '../../HelpButton';

export function ImgPickerRow(props: { elementId: string }) {
  const updateAttr = useScene((s) => s.updateAttr);
  const scene = useScene((s) => s.scene);
  const element = findNode(scene.root, props.elementId);
  const currentSrc = element?.attrs?.src ?? '';

  const [pathMode, setPathMode] = useState<'rel' | 'abs' | 'url'>(() => {
    if (currentSrc.startsWith('http://') || currentSrc.startsWith('https://')) return 'url';
    if (/^[a-zA-Z]:[\\/]/.test(currentSrc) || currentSrc.startsWith('\\\\') || currentSrc.startsWith('file://')) return 'abs';
    return 'rel';
  });

  const onPick = async (mode: 'rel' | 'abs') => {
    const res = await window.bc.pickImageSrc(mode);
    if (!res.ok || !res.path) return;
    updateAttr(props.elementId, 'src', res.path);
  };

  // 检测是否是可能在导出 file:// 协议下失效的路径并给出温馨提示
  const isAbsOrFileProto = /^[a-zA-Z]:[\\/]/.test(currentSrc) || currentSrc.startsWith('\\\\') || currentSrc.startsWith('file://');

  return (
    <div className="prop-row">
      <div className="prop-row-header">
        <span>
          图片路径 (src)
          <HelpButton
            title="图片路径与 file:// 协议说明"
            content={
              '【图片路径模式说明】：\n\n' +
              '1. 相对路径（强烈推荐）：\n' +
              '   例如 ./images/photo.png 或 images/photo.png。\n' +
              '   导出的 HTML 文件直接双击在浏览器打开（file:// 协议）或部署上线均能完美显示！\n\n' +
              '2. 网络图片 URL：\n' +
              '   例如 https://example.com/pic.jpg。\n' +
              '   只要电脑能联网，无论本地打开还是线上均能正常显示。\n\n' +
              '3. 本地绝对路径（如 D:\\photo.jpg 或 file://...）：\n' +
              '   注意：编辑器内已做专属特权通道强行正常预览；但导出的 HTML 在现代浏览器由于同源安全限制，通过 file:// 协议可能无法跨盘符读取，建议将图片放入与导出的 HTML 相同或子文件夹内，使用相对路径！'
            }
          />
        </span>
        <div className="img-mode-seg">
          <button className={'img-mode-btn' + (pathMode === 'rel' ? ' active' : '')} onClick={() => setPathMode('rel')}>相对路径</button>
          <button className={'img-mode-btn' + (pathMode === 'abs' ? ' active' : '')} onClick={() => setPathMode('abs')}>绝对路径</button>
          <button className={'img-mode-btn' + (pathMode === 'url' ? ' active' : '')} onClick={() => setPathMode('url')}>网络URL</button>
        </div>
      </div>
      <div className="prop-row-body" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="text"
          value={currentSrc}
          placeholder={pathMode === 'url' ? 'https://example.com/image.png' : pathMode === 'rel' ? './images/banner.png' : 'D:\\images\\photo.png'}
          onChange={(e) => updateAttr(props.elementId, 'src', e.target.value)}
          style={{ flex: 1 }}
        />
        {pathMode !== 'url' && (
          <button
            className="btn-mini"
            onClick={() => onPick(pathMode as 'rel' | 'abs')}
            title={`点击选择本地图片并生成${pathMode === 'rel' ? '相对' : '绝对'}路径`}
          >
            选本地图片…
          </button>
        )}
      </div>
      {isAbsOrFileProto && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#d97706', lineHeight: 1.4 }}>
          <Icon name="warning" size={12} /> 提示：当前为绝对路径。编辑器内已强行支持预览，但导出 HTML 在浏览器中直接双击 (file://) 打开时受跨域安全限制可能无法跨盘显示，推荐使用相对路径 (./images/...)。
        </div>
      )}
    </div>
  );
}
