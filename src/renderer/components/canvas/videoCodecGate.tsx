// BlockCanvas · 视频编码预检的 UI 收口（R6-18）
//
// 为什么单独一层：CanvasNode 是热路径组件（每个元素都渲染），把"探测 + 占位块"
// 塞进去会让它越涨越长。这里只做两件事：
//   ① 给 CanvasNode 一个"该不该挂 <video>"的判断；
//   ② 提供那个占位块的 JSX（连同文案），让两个调用方（画布 / 未来别的预览）口径一致。
//
// 三条不能破的规矩：
//   'probing'（探测中）也先别挂 —— 挂上去就等于让它尝试解码；
//   'unknown'（读不出来）**照常播放**，绝不因为探测失败误杀正常视频；
//   只有 'unsupported' 才换成占位块。
import { Icon } from '../Icon';
import { useCodecVerdict, type CodecVerdict } from '@lib/codecGuard';

export type { CodecVerdict };

/** 判断这个节点该不该挂 <video>；返回要用的判定结果与"是否拦下" */
export function useVideoCodecGate(nodeType: string, srcAbs?: string, src?: string): {
  verdict: CodecVerdict;
  blocked: boolean;
} {
  const isVideo = nodeType === 'video';
  const verdict = useCodecVerdict(isVideo ? (srcAbs || src || '') : '');
  return { verdict, blocked: isVideo && verdict.state === 'unsupported' };
}

/**
 * 「编码不支持」占位块。
 *
 * Chromium 的原生解码器遇到不带的编码会报 `ffmpeg_common.cc Unsupported pixel format: -1`
 * 并白屏，那条日志 JS 屏蔽不了 —— 唯一能"根治"的办法就是**根本不挂 <video>**。
 * 这块占位就是这个"不挂"的结果：尺寸/选中/拖动都和真元素一致，只是里面没有 video，
 * 用户看到的是清楚的说明（编码 + 出路），而不是一片空白。
 *
 * ⚠ 必须把 commonProps（data-bc-id / data-bc-sel / data-bc-cg / id）原样铺进来 ——
 *   少了 data-bc-id，选中、拖动、探针全都找不到它（踩过一次：元素在 DOM 里"消失"了）。
 */
export function CodecBlockedNotice({ verdict, commonProps, className, style, onClick, title }: {
  verdict: CodecVerdict;
  commonProps: Record<string, unknown>;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}) {
  const codes = verdict.codecs.length ? verdict.codecs.join(' / ') : '未知编码';
  // className 以 commonProps 里的为准（那是"用户类名"，导出也要一致），这里只追加编辑器类
  const finalCls = 'bc-codec-blocked' + (className ? ' ' + className : '');
  return (
    <div
      {...commonProps}
      className={finalCls}
      style={style}
      onClick={onClick}
      title={title ?? `这个视频的编码编辑器解不了（${codes}）：${verdict.advice || '建议转成 H.264（MP4）'}`}
    >
      <span className="bc-codec-blocked-ico" aria-hidden="true"><Icon name="video" size={18} /></span>
      <span className="bc-codec-blocked-title">视频编码不支持</span>
      <span className="bc-codec-blocked-desc">{codes} · 转成 H.264 后可预览</span>
    </div>
  );
}
