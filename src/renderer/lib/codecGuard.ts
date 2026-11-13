// BlockCanvas · 视频编码预检（R6-18）
//
// 问题：`ffmpeg_common.cc Unsupported pixel format: -1` 这条日志来自 **Chromium 的原生解码器**，
// JS 侧屏蔽不了。它出现在"把 <video src=…> 挂上去"的瞬间 —— 只要挂了就会尝试初始化解码器。
//
// 唯一能根治的办法：**挂之前先读容器头**（主进程解析 MP4 的 moov/stsd 四字码、
// WebM 的 CodecID），确定解不了就根本不挂 <video>，一个解码器都不初始化。
//
// 三条绝不能破坏的规则：
//   1. 探测失败（unknown）≠ 视频坏 → **照常播放**。读不出容器头的原因太多了（分片 mp4、
//      非常规封装），不能因此误杀一个正常视频（v0.4.5 第 15 批就因为"超时=坏"误判过一次）。
//   2. 结果按 `src` 缓存（含失败），一次会话内同一个文件只探一次。
//   3. 用户换了文件要重新探 —— 缓存键带上路径，路径变了自然就重探。
import { useEffect, useState } from 'react';

export type CodecVerdict = {
  /** 正在探测 / supported / unsupported / unknown */
  state: 'probing' | 'supported' | 'unsupported' | 'unknown';
  /** 给用户看的转换建议（unsupported 时才有） */
  advice: string;
  /** 容器头里读到的编码四字码（诊断用） */
  codecs: string[];
};

const cache = new Map<string, CodecVerdict>();

/** 清掉缓存（探针 / 重新导入同名文件时用） */
export function clearCodecCache(): void {
  cache.clear();
}

/** 探测一个媒体源；结果按路径缓存 */
export async function probeCodecOnce(src: string): Promise<CodecVerdict> {
  const key = String(src ?? '').trim();
  if (!key) return { state: 'unknown', advice: '', codecs: [] };
  const hit = cache.get(key);
  if (hit) return hit;
  let verdict: CodecVerdict = { state: 'unknown', advice: '', codecs: [] };
  try {
    const res = await window.bc.probeMediaCodec(key);
    const state = res?.result === 'supported' || res?.result === 'unsupported' ? res.result : 'unknown';
    verdict = { state, advice: res?.advice ?? '', codecs: res?.codecs ?? [] };
  } catch {
    // 探测本身出错 → 当作未知，绝不阻塞播放
    verdict = { state: 'unknown', advice: '', codecs: [] };
  }
  cache.set(key, verdict);
  return verdict;
}

/**
 * 组件里用的版本：先返回 'probing'，探完再给出结论。
 *
 * ⚠ 调用方必须把 `verdict.state === 'probing'` 当作"**先别挂 <video>**"：
 * 挂上去就等于让它尝试解码，正是我们要避免的。探测通常几毫秒（只读文件头几百字节），
 * 所以这一帧的空白用户感知不到。
 */
export function useCodecVerdict(src: string | undefined): CodecVerdict {
  const key = String(src ?? '').trim();
  const [verdict, setVerdict] = useState<CodecVerdict>(() => cache.get(key) ?? { state: 'probing', advice: '', codecs: [] });

  useEffect(() => {
    if (!key) { setVerdict({ state: 'unknown', advice: '', codecs: [] }); return; }
    const hit = cache.get(key);
    if (hit) { setVerdict(hit); return; }
    let alive = true;
    setVerdict({ state: 'probing', advice: '', codecs: [] });
    void probeCodecOnce(key).then((v) => { if (alive) setVerdict(v); });
    return () => { alive = false; };
  }, [key]);

  return verdict;
}
