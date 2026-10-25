import { useState } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { Icon } from './Icon';
import type { ElementType } from '@lib/types';
import { getProjectDir } from '@lib/projectDir';
import {
  type MediaSrcMode, detectSrcMode, isUrlLike, isAbsoluteFsPath,
  normalizeSlashes, resolveToAbsolute, toRelativeFrom
} from '@lib/mediaPath';

// ============================================================================
// BlockCanvas · 媒体属性卡（v0.4.5）
// ----------------------------------------------------------------------------
// 给 <video> / <audio> 一个"说人话"的设置面板：
//   · 媒体地址：三种写法（相对路径 / 绝对路径 / URL），见下
//   · 循环播放 / 静音 / 自动播放 / 背景模式：写进元素的 attrs，导出时原样带上
//   · **锁死播放**：画布上永不播放，可以放心按住 Alt 排版
//
// v0.4.5 第 15 批（用户要求，原话）：
//   「视频，音频，图片现在的路径统一成 3 种：相对路径，绝对路径，URL。
//     但是相对路径和绝对路径这个只是给人看的，真正程序设置了相对路径，
//     一定要也记录一份绝对路径作为权威资源的路径……
//     默认相对路径，并且相对路径加一个按钮：导出时根据位置自动匹配相对路径。」
//
// 所以这里的交互是：
//   ① 三个小标签选择"我将要用哪种写法"；
//   ② 输入框里写的就是**给你看的写法**（相对 / 绝对 / 链接）；
//   ③ 无论写哪种，都会同时把**权威绝对路径**记到 attrs.srcAbs ——
//      画布预览、打包进 .bcproj、导出时找文件，全部只认 srcAbs；
//   ④ 相对路径模式下多给一个「按导出位置自动匹配」的说明按钮，
//      导出时按导出目录重新算相对写法（见 main 的 export:site）。
// ============================================================================

const MODE_LABEL: Record<MediaSrcMode, string> = {
  relative: '相对路径',
  absolute: '绝对路径',
  url: 'URL'
};
const MODE_TIP: Record<MediaSrcMode, string> = {
  relative: '写相对于工程文件的位置，例如 assets/bg.mp4。换机器、整个文件夹搬走都不会坏。',
  absolute: '写完整的本机路径，例如 D:/media/bg.mp4。只在这台机器上有效，但一定找得到。',
  url: '写网址，例如 https://example.com/bg.mp4。导出后照旧可用。'
};

export function MediaPropsCard({ elementId, elementType }: { elementId: string; elementType: ElementType }) {
  const scene = useScene((s) => s.scene);
  const updateAttr = useScene((s) => s.updateAttr);
  const node = findNode(scene.root, elementId);
  const [picking, setPicking] = useState(false);

  if (!node) return null;
  const isVideo = elementType === 'video';
  const src = String(node.attrs?.src ?? '');
  const srcAbs = String(node.attrs?.srcAbs ?? '');
  const mode: MediaSrcMode = (node.attrs?.srcMode as MediaSrcMode)
    || (src ? detectSrcMode(src) : 'relative');
  const loop = node.attrs?.loop === '1';
  const muted = node.attrs?.muted === '1';
  const autoplay = node.attrs?.autoplay === '1';
  const bgMode = node.attrs?.controls === '0';
  const locked = node.attrs?.playLock === '1';
  const projDir = getProjectDir();

  /**
   * 写入路径：一次把三件事记全 —— 显示写法、模式、权威绝对路径。
   * 权威路径的推算：
   *   · URL            → 原样
   *   · 绝对路径        → 原样（规范化斜杠）
   *   · 相对路径        → 按当前工程目录解析成绝对路径；工程未保存时就先空着（保存后会自动补）
   */
  const writeSrc = (value: string, nextMode: MediaSrcMode = mode) => {
    const v = String(value ?? '').trim();
    const abs = !v
      ? ''
      : nextMode === 'url'
        ? v
        : nextMode === 'absolute'
          ? normalizeSlashes(v)
          : resolveToAbsolute(v, projDir);
    updateAttr(elementId, 'src', v);
    updateAttr(elementId, 'srcMode', v ? nextMode : '');
    updateAttr(elementId, 'srcAbs', abs);
  };

  /** 切换写法模式：尽量把当前路径"翻译"成新写法，避免用户重新写一遍 */
  const switchMode = (next: MediaSrcMode) => {
    const cur = src.trim();
    if (!cur) { updateAttr(elementId, 'srcMode', next); return; }
    const authority = srcAbs || (isUrlLike(cur) || isAbsoluteFsPath(cur) ? cur : resolveToAbsolute(cur, projDir));
    if (next === 'url') {
      updateAttr(elementId, 'srcMode', 'url');
      // 不是网址就不强行改内容，只切模式（用户自己会粘）
      if (isUrlLike(authority)) writeSrc(authority, 'url');
      else updateAttr(elementId, 'srcMode', 'url');
      return;
    }
    if (next === 'absolute') {
      writeSrc(authority || cur, 'absolute');
      return;
    }
    // relative：能算相对就算，算不了（跨盘/工程未保存）就保留绝对写法并提示
    if (!projDir) { writeSrc(authority || cur, 'absolute'); return; }
    const r = toRelativeFrom(authority || cur, projDir);
    writeSrc(r.crossDrive ? (authority || cur) : r.rel, r.crossDrive ? 'absolute' : 'relative');
  };

  const pickLocal = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const r = await window.bc.pickMediaSrc(isVideo ? 'video' : 'audio');
      if (!r?.ok || !r.path) return;
      // 选来的就是绝对路径：按当前模式决定显示成什么（默认相对 → 自动算相对写法）
      const abs = normalizeSlashes(r.path);
      if (mode === 'relative' && projDir) {
        const rel = toRelativeFrom(abs, projDir);
        if (!rel.crossDrive) { writeSrc(rel.rel, 'relative'); return; }
      }
      writeSrc(abs, mode === 'url' ? 'absolute' : mode);
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
        {/* —— 路径写法三选一 —— */}
        <div className="media-path-modes" role="group" aria-label="路径写法">
          {(['relative', 'absolute', 'url'] as MediaSrcMode[]).map((m) => (
            <button
              key={m}
              className={'media-path-mode' + (mode === m ? ' is-on' : '')}
              onClick={() => switchMode(m)}
              title={MODE_TIP[m]}
            >{MODE_LABEL[m]}</button>
          ))}
        </div>

        <label className="media-props-row">
          <span className="media-props-label">媒体地址</span>
          <input
            className="media-props-src"
            value={src}
            placeholder={
              mode === 'relative' ? (isVideo ? 'assets/bg.mp4' : 'assets/bgm.mp3')
                : mode === 'absolute' ? (isVideo ? 'D:/media/bg.mp4' : 'D:/media/bgm.mp3')
                  : 'https://example.com/bg.mp4'
            }
            spellCheck={false}
            onChange={(e) => writeSrc(e.target.value)}
          />
          <button
            className="btn-mini media-props-pick"
            onClick={() => void pickLocal()}
            disabled={picking}
            title={isVideo ? '从本机选一个视频文件' : '从本机选一个音频文件'}
          >{picking ? '选择中…' : '本地文件…'}</button>
        </label>

        {/* 权威路径：只读展示，让人知道"程序到底记的是哪个文件" */}
        <div className={'media-path-auth' + (src && !srcAbs ? ' is-warn' : '')}>
          <span className="media-path-auth-k">程序记录的实际文件</span>
          <span className="media-path-auth-v" title={srcAbs || ''}>
            {srcAbs || (src ? '保存工程后自动补上' : '（还没设置）')}
          </span>
        </div>

        {mode === 'relative' && (
          <div className="media-path-relnote">
            <Icon name="info" size={12} />
            <span>
              界面里显示的是<b>相对工程文件</b>的写法；导出时会<b>按你选的导出位置自动重算</b>相对路径，
              并把文件一起拷过去，所以整个文件夹搬到哪都能用。
            </span>
          </div>
        )}

        {/* —— 播放锁 —— */}
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
        {locked && (
          <div className="media-lock-hint">
            已锁死：画布上点它只会选中元素，不会播放；{isVideo ? '画面停在某一帧上（看得出是视频）' : '保留一条播放条（看得出是音频）'}。
            导出后的网页行为不受影响。
          </div>
        )}

        <div className="media-props-toggles">
          <label className="media-props-toggle" title="播放到结尾后自动重新开始">
            <input type="checkbox" checked={loop} onChange={(e) => updateAttr(elementId, 'loop', e.target.checked ? '1' : '')} />
            循环播放
          </label>
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
          <b>编辑时怎么播放？</b>没选中的媒体不显示播放条，点它就是选中元素（方便排版）；
          选中之后才出现控制条，可以直接试播。
          {bgMode && <> 现在开了<b>背景模式</b>，编辑器里也不显示控制条。</>}
          {locked && <> 现在<b>播放已锁死</b>：画布上不会播，可以放心按住 Alt 拖动排版。</>}
          <br />
          {isVideo
            ? '视频按原始比例显示；想改画面大小，拖右下角即可（比例会被锁住，不会变形）。'
            : '音频没有画面，未选中时显示成一条占位条，点一下就能选中它。'}
        </div>
      </div>
    </div>
  );
}