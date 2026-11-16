// BlockCanvas · 画布上媒体元素（video / audio）的播放属性（v0.4.7 从 CanvasNode.tsx 拆出）
//
// 为什么单独一份：这里面每一条都是踩出来的，而且全是"反直觉"的结论 ——
// 混在 CanvasNode 的 JSX 里既读不出逻辑，也压不住文件行数（probe-arch 红线 600）。
//
// 三条硬结论（改之前先读，别凭直觉改回去）：
//
//   ① **音频没有 controls 就是 display:none**。
//      Chromium 的 UA 样式表里写着 `audio:not([controls]) { display: none !important }`，
//      UA 的 !important 在层叠里高于作者样式（author !important < user !important < UA !important），
//      所以"给未选中的音频画个 CSS 占位块"根本画不出来（实测 0×0）。
//      → 音频**始终带控制条**，选中与否只决定"点它是选元素还是操作播放条"。
//
//   ② **不能对原生控件 preventDefault**。
//      Chromium 在原生控件上被 preventDefault 之后连 click 都不再派发，
//      于是元素永远选不中（用户反馈原话「音频根本点击无法选中」）。
//      → 只用 stopPropagation，绝不 preventDefault。
//
//   ③ **锁死播放时不能 preload="none"**。
//      那样浏览器手里一帧数据都没有 → 画出全白（用户反馈「锁死后完全白色了」）。
//      → 视频用 metadata + seek 到第 30 帧再 pause。
import type { SceneElement } from '@lib/types';
import { toRenderableSrc } from './mediaSrc';
import { LOCK_FRAME_SEC } from './useAltDrag';

export type MediaPlayProps = Record<string, unknown>;

export function buildMediaPlayProps(args: {
  node: SceneElement;
  isSelected: boolean;
  codecBlocked: boolean;
  onSelect: (id: string) => void;
}): MediaPlayProps {
  const { node, isSelected, codecBlocked, onSelect } = args;
  if (codecBlocked) return {};

  /** 背景模式：导出后不要播放条，画布上也不显示（当背景视频/背景音乐用） */
  const bgMode = node.attrs?.controls === '0';
  const wantsAutoplay = node.attrs?.autoplay === '1';
  const playLock = node.attrs?.playLock === '1';
  const isAudio = node.type === 'audio';

  // 视频：选中后才出控制条（没选中时点它 = 选中，排版不挡手）。
  // 音频：永远带控制条 —— 见文件头 ①。
  const showControls = bgMode ? false : (isAudio ? true : (isSelected && !playLock));

  return {
    src: node.attrs?.src ? toRenderableSrc(node.attrs.src, node.attrs.srcAbs) : undefined,
    controls: showControls,
    loop: node.attrs?.loop === '1',
    // 自动播放必须静音，否则浏览器会直接拦掉（HTML 规范）
    muted: node.attrs?.muted === '1' || wantsAutoplay || playLock,
    autoPlay: wantsAutoplay && !playLock,
    playsInline: node.type === 'video',
    /**
     * 预载策略：
     *   · 选中 / 锁死 → 必须读 metadata（前者要出控制条，后者要定格到某帧）；
     *   · 未选中且未锁死 → **不预载**。一个页面可能有十几个视频，
     *     全部吃 metadata + 首帧解码会把 GPU 拖住（用户反馈过 CPU 降不下来）。
     */
    preload: (isSelected || playLock) ? 'metadata' : 'none',
    // 锁死标记：CSS 据此画"禁止播放"的虚线描边
    // ⚠ 不要复用 data-bc-locked —— 那是"元素锁定"（不可作为拖放目标），语义不同
    'data-bc-play-lock': playLock ? '1' : undefined,
    ...(playLock
      ? {
        /** 把画面停在"第 30 帧"（30fps ≈ 1 秒；短视频取 20% 处，避免超出时长） */
        onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => {
          const el = e.currentTarget;
          try {
            el.pause();
            if (el.dataset.bcLockSeek === '1') return;
            const dur = Number.isFinite(el.duration) ? el.duration : 0;
            const target = dur > 0
              ? Math.min(LOCK_FRAME_SEC, Math.max(0, dur * 0.2))
              : LOCK_FRAME_SEC;
            el.dataset.bcLockSeek = '1';
            if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
          } catch { /* 忽略 */ }
        },
        // 定格帧定位完成后也再按一次暂停（有些浏览器 seek 会自动恢复播放）
        onSeeked: (e: React.SyntheticEvent<HTMLMediaElement>) => { e.currentTarget.pause(); },
        // 任何播放尝试一律按回去（点播放键、脚本 play()、浏览器自动播放都拦）
        onPlay: (e: React.SyntheticEvent<HTMLMediaElement>) => { e.currentTarget.pause(); },
        onPlaying: (e: React.SyntheticEvent<HTMLMediaElement>) => { e.currentTarget.pause(); },
        // 锁死状态下点它 = 选中元素（见文件头 ②：只 stopPropagation）
        onPointerDownCapture: (e: React.PointerEvent) => {
          e.stopPropagation();
          onSelect(node.id);
        }
      }
      : {
        // 未选中时：这一次点击只用来**选中元素**，不交给原生控件
        onPointerDownCapture: (e: React.PointerEvent) => {
          if (isSelected) return;
          e.stopPropagation();
          onSelect(node.id);
        }
      })
  };
}
