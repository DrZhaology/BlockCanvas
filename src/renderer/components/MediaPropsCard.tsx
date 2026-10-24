import { useState } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { Icon } from './Icon';
import type { ElementType } from '@lib/types';

// ============================================================================
// BlockCanvas · 媒体属性卡（v0.4.5）
// ----------------------------------------------------------------------------
// 给 <video> / <audio> 一个"说人话"的设置面板：
//   · 媒体地址：可直接粘网址，也可以选本地文件（本地文件走 bc-img:// 协议）
//   · 循环播放 / 静音 / 自动播放 / 背景模式：写进元素的 attrs，导出时原样带上
//   · **锁死播放**（v0.4.5 第 8 批新增）：见下方注释
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
  const autoplay = node.attrs?.autoplay === '1';
  const bgMode = node.attrs?.controls === '0';
  // v0.4.5：播放锁（状态存在元素 attrs 上，跟工程一起保存；导出时**不带**这个标记）
  const locked = node.attrs?.playLock === '1';

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

        {/* —— v0.4.5：播放锁 ——
            用户反馈：「为了放置音频和视频操作的时候意外播放，很麻烦，所以右边加一个锁死按钮，
            可以开关，状态保留，按下就视频永远不会触发播放、暂停。这期间就可以使用 Alt 操作。」
            实现：attrs.playLock = '1' 时，画布上的 <video>/<audio>
            ① 不挂 controls（点不出播放条）、② 强制 paused、③ 任何 play 事件立刻 pause 回去、
            ④ mouse 事件交给外层（Alt 拖动照常）。标记只存在编辑器内，导出时不写入 HTML。 */}
        <div className="media-lock-row">
          <button
            className={'media-lock-btn' + (locked ? ' is-on' : '')}
            onClick={() => updateAttr(elementId, 'playLock', locked ? '' : '1')}
            title={locked
              ? '当前已锁死：画布上这个媒体的播放被完全禁止（导出不受影响）。点一下解锁。'
              : '锁死播放：画布上永远不会播放/暂停它，Alt 拖动、排版都不会误触。状态随元素保存。'}
          >
            <Icon name={locked ? 'lock' : 'lockOpen'} size={13} />
            {locked ? '播放已锁死（点一下解锁）' : '锁死播放'}
          </button>
        </div>

        <div className="media-props-toggles">
          <label className="media-props-toggle" title="播放到结尾后自动重新开始">
            <input type="checkbox" checked={loop} onChange={(e) => updateAttr(elementId, 'loop', e.target.checked ? '1' : '')} />
            循环播放
          </label>
          {/* v0.4.5：自动播放打开时，静音必须**锁死在开**（浏览器规定自动播放必须静音，
              以前这里能手动关掉、但关了其实没用 —— 用户反馈"逻辑上就应该锁死这个按钮"） */}
          <label
            className={'media-props-toggle' + (autoplay ? ' is-forced' : '')}
            title={autoplay
              ? '已开启自动播放 —— 浏览器规定自动播放必须静音，所以这一项被锁死在「开」'
              : '默认静音（浏览器允许自动播放的前提）'}
          >
            <input
              type="checkbox"
              checked={autoplay ? true : muted}
              disabled={autoplay}
              onChange={(e) => updateAttr(elementId, 'muted', e.target.checked ? '1' : '')}
            />
            默认静音{autoplay && <span className="media-toggle-forced-tag">自动播放要求 · 已锁死</span>}
          </label>
          <label className="media-props-toggle" title="打开页面就自动播放。浏览器规定：自动播放必须同时静音，否则会被直接拦掉">
            <input type="checkbox" checked={autoplay} onChange={(e) => {
              const on = e.target.checked;
              updateAttr(elementId, 'autoplay', on ? '1' : '');
              // 自动播放必须静音，勾上时顺手把静音也打开，避免"设了不生效"
              if (on) updateAttr(elementId, 'muted', '1');
              else updateAttr(elementId, 'muted', '');
            }} />
            自动播放（需静音）
          </label>
          <label className="media-props-toggle" title="背景模式：导出后不显示播放条，适合当背景视频/背景音乐">
            <input type="checkbox" checked={bgMode} onChange={(e) => updateAttr(elementId, 'controls', e.target.checked ? '0' : '')} />
            背景模式（无控制条）
          </label>
        </div>

        <div className="media-props-tip">
          <b>编辑时怎么播放？</b>没选中的媒体不会显示播放条，点它就是选中元素（方便排版）；
          选中之后才出现控制条，可以直接试播。
          {bgMode && <> 现在开了<b>背景模式</b>，编辑器里也不显示控制条。</>}
          {locked && <> 现在<b>播放已锁死</b>：画布上不会播，可以放心按住 Alt 拖动排版。</>}
          <br />
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