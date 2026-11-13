// BlockCanvas · 媒体编码探测（R6-18）
//
// 问题（用户报的）：某些 mp4 完全正常，Chromium 却打
//   `ffmpeg_common.cc Unsupported pixel format: -1`
// 并且画面一片白。
//
// 根因：那条日志来自 **Chromium 的原生解码器**，JS 侧屏蔽不了。它触发的原因是
// 容器里声明的编码（codec）属于这个 Electron/Chromium 版本不带的解码器 ——
// 典型是 **HEVC/H.265**（hvc1/hev1）与 **AV1**，以及 10bit（Main 10）的 H.264。
// 一旦把 `<video src=…>` 挂上去，Chromium 就会尝试初始化解码器并报这一行，
// 然后画面白屏。反复进页面 = 反复刷同一条错误。
//
// 本版做法：**挂载之前先读容器头**，只解析 MP4/WebM 的 moov/codec 四字码，
// 判断"这个编码现在能不能解"。不能解就根本不挂 <video>，从根上不触发原生解码。
//
// 为什么只读头部就够了：MP4 的 `moov` 盒里 `stsd` 记录了 sample entry 的
// 格式四字码（avc1/hvc1/hev1/av01/vp09…），WebM 的 CodecID 记录在 Segment/Tracks 里。
// 这两处都在文件"前若干 KB"内（moov 在尾部时需要按盒大小跳读，见下）。
// 读不到/看不懂就返回 'unknown'，此时**仍然尝试播放**（绝不因为探测失败就拉黑）。
import { openSync, readSync, closeSync, statSync } from 'node:fs';

export type CodecProbe = 'supported' | 'unsupported' | 'unknown';

/** 这个 Chromium（Electron 33 ≈ Chrome 130）能直接播的 MP4 sample entry 四字码 */
const MP4_OK = new Set([
  'avc1', 'avc3',       // H.264 / AVC（含 High / Main / Baseline）
  'mp4v',               // MPEG-4 Part 2
  'vp09',               // VP9
  'av01'                // AV1（Chromium 有 dav1d 软解，能播）
]);

/**
 * 明确不支持的（会在原生解码器里报 Unsupported pixel format）：
 *   hvc1 / hev1 = HEVC/H.265 —— Electron 默认不带专有解码器
 *   还有一些旧格式（mjpg 等）一并归入不支持
 */
const MP4_BAD = new Set(['hvc1', 'hev1', 'mjpg', 'jpeg', 'dvh1', 'dvhe', 'vvc1', 'vvi1']);

/**
 * 已知的 sample entry 格式四字码白名单。
 *
 * 为什么需要白名单：stsd 里除了编码四字码，还可能夹着 stts / stsc / stsz 这类**表格盒**
 * （正常结构里它们在 sample entry 内部，但异常封装或解析偏差时会落到同一层）。
 * 不筛的话诊断文案会变成 "hvc1 / stts" 这种看不懂的东西，也可能让判定逻辑走错分支。
 */
const KNOWN_ENTRY = new Set([
  ...MP4_OK,
  ...MP4_BAD,
  // 音频（本项目不拦音频，但要认出来别当成视频编码）
  'mp4a', 'ac-3', 'ec-3', 'Opus', 'fLaC', 'alac', 'sowt', 'twos', 'lpcm'
]);

/** WebM 的 CodecID 判定 */
const WEBM_BAD_PREFIX = ['V_MPEGH/ISO/HEVC', 'V_MPEG4/ISO/AVC_10BIT'];
const WEBM_OK_PREFIX = ['V_VP8', 'V_VP9', 'V_AV1', 'V_MPEG4/ISO/AVC'];

type Box = { type: string; start: number; size: number; headerLen: number };

/** 从 fd 读一小段（不改文件位置） */
function readAt(fd: number, offset: number, len: number): Buffer | null {
  try {
    const buf = Buffer.alloc(len);
    const n = readSync(fd, buf, 0, len, offset);
    if (n <= 0) return null;
    return n === len ? buf : buf.subarray(0, n);
  } catch {
    return null;
  }
}

/** 解析一个 MP4 盒头 */
function readBox(buf: Buffer, at: number): Box | null {
  if (at + 8 > buf.length) return null;
  let size = buf.readUInt32BE(at);
  const type = buf.toString('latin1', at + 4, at + 8);
  let headerLen = 8;
  if (size === 1) {
    // 64 位长度
    if (at + 16 > buf.length) return null;
    const hi = buf.readUInt32BE(at + 8);
    const lo = buf.readUInt32BE(at + 12);
    size = hi * 0x100000000 + lo;
    headerLen = 16;
  } else if (size === 0) {
    // 延伸到文件末尾
    size = Infinity;
  }
  return { type, start: at, size, headerLen };
}

/**
 * 在 MP4 里找 moov → trak → mdia → minf → stbl → stsd，取出所有 sample entry 四字码。
 *
 * moov 在文件尾部的情况很常见（没做过 faststart 的文件），所以按盒大小**跳读**，
 * 不会把整个文件读进内存。
 */
function mp4SampleEntries(fd: number, fileSize: number, deepScan: boolean): string[] {
  const out: string[] = [];
  // 顶层盒遍历：只在 top-level 找 moov，之后再进 moov 内部
  const scanForMoov = () => {
    let offset = 0;
    let guard = 0;
    while (offset < fileSize && guard++ < 200) {
      const head = readAt(fd, offset, 16);
      if (!head || head.length < 8) break;
      // ⚠ readBox 返回的 start 是**缓冲区内的相对偏移**（这里恒为 0），
      //   绝对位置必须用外面的 offset —— 混用过一次，导致第二跳就停在 size 处（永远找不到 moov）。
      const box = readBox(head, 0);
      if (!box) break;
      if (box.type === 'moov') {
        return {
          offset: offset + box.headerLen,
          end: offset + (Number.isFinite(box.size) ? box.size : fileSize)
        };
      }
      if (!Number.isFinite(box.size) || box.size <= 0) break;
      offset = offset + box.size;
    }
    return null;
  };

  const moov = scanForMoov();
  if (!moov) return out;

  // moov 里逐个 trak → mdia → minf → stbl → stsd
  const walk = (from: number, to: number, path: string[], depth: number) => {
    if (depth > 6) return;
    let at = from;
    let guard = 0;
    while (at < to && guard++ < 500) {
      const head = readAt(fd, at, 16);
      if (!head || head.length < 8) return;
      const box = readBox(head, 0);
      if (!box) return;
      const next = at + (Number.isFinite(box.size) ? box.size : to - at);
      if (box.type === 'stsd') {
        // stsd: version(1)+flags(3)+entryCount(4)，然后是一串 sample entry（每个 8 字节头 + 内容）
        const body = readAt(fd, at + box.headerLen, Math.min(4096, Number.isFinite(box.size) ? box.size : 4096));
        if (body && body.length > 8) {
          let p = 8; // 跳过 version/flags + entryCount
          let g2 = 0;
          while (p + 8 <= body.length && g2++ < 32) {
            const entrySize = body.readUInt32BE(p);
            const entryType = body.toString('latin1', p + 4, p + 8);
            /**
             * ⚠ 只认 **sample entry 格式四字码**：stsd 里除了 avc1/hvc1，还夹着
             *   stts / stsc / stsz 这类"表格盒"（它们在 sample entry 的**内部**，
             *   但如果不是标准嵌套就会落到这一层）。把它们当编码会让诊断文案变成
             *   "hvc1 / stts" 这种看不懂的东西。
             *   所以这里用白名单：四字码必须是已知的编码类型，其余一律跳过。
             */
            if (KNOWN_ENTRY.has(entryType)) out.push(entryType);
            if (entrySize < 8 || p + entrySize > body.length) break;
            p += entrySize;
          }
        }
        at = next;
        continue;
      }
      // 需要深入的容器：moov / trak / mdia / minf / stbl
      if (['trak', 'mdia', 'minf', 'stbl'].includes(box.type)) {
        walk(at + box.headerLen, next, [...path, box.type], depth + 1);
      }
      at = next;
    }
  };
  walk(moov.offset, moov.end, ['moov'], 0);

  // 兜底：需要时把文件头几 MB 直接当文本扫一遍四字码（极少用到）
  if (out.length === 0 && deepScan) {
    const buf = readAt(fd, 0, Math.min(2 * 1024 * 1024, fileSize));
    if (buf) {
      const s = buf.toString('latin1');
      for (const code of ['hvc1', 'hev1', 'avc1', 'avc3', 'vp09', 'av01', 'mp4v']) {
        if (s.includes(code)) out.push(code);
      }
    }
  }
  return out;
}

/** WebM 的 CodecID（V_VP9 / V_MPEGH/ISO/HEVC …） */
function webmCodecIds(fd: number, fileSize: number): string[] {
  const buf = readAt(fd, 0, Math.min(1024 * 1024, fileSize));
  if (!buf) return [];
  const s = buf.toString('latin1');
  const ids = new Set<string>();
  const re = /V_[A-Z0-9_./-]{2,32}/g;
  let m;
  while ((m = re.exec(s))) ids.add(m[0].replace(/\0+$/, ''));
  return [...ids];
}

/**
 * 判断一个媒体文件"当前 Chromium 能不能播"。
 *
 *   'supported'   —— 容器头里读到了已知可解的编码
 *   'unsupported' —— 读到了明确不支持的编码（HEVC / 10bit AVC …）
 *   'unknown'     —— 读不到 / 不是 MP4/WebM / 看不出来 → **调用方应当照常尝试播放**
 */
export function probeCodec(filePath: string, ext: string): { result: CodecProbe; codecs: string[] } {
  let st;
  try {
    st = statSync(filePath);
  } catch {
    return { result: 'unknown', codecs: [] };
  }
  if (!st.isFile() || st.size < 32) return { result: 'unknown', codecs: [] };

  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const e = ext.toLowerCase().replace(/^\./, '');
    if (e === 'mp4' || e === 'm4v' || e === 'mov') {
      const entries = mp4SampleEntries(fd, st.size, true);
      if (entries.length === 0) return { result: 'unknown', codecs: [] };
      const bad = entries.filter((x) => MP4_BAD.has(x));
      const ok = entries.filter((x) => MP4_OK.has(x));
      if (bad.length > 0) return { result: 'unsupported', codecs: entries };
      if (ok.length > 0) return { result: 'supported', codecs: entries };
      // 只读到不认识的编码（比如 mjpg）→ 交给调用方尝试，别误杀
      return { result: 'unknown', codecs: entries };
    }
    if (e === 'webm' || e === 'mkv') {
      const ids = webmCodecIds(fd, st.size);
      if (ids.length === 0) return { result: 'unknown', codecs: [] };
      if (ids.some((id) => WEBM_BAD_PREFIX.some((p) => id.startsWith(p)))) {
        return { result: 'unsupported', codecs: ids };
      }
      if (ids.some((id) => WEBM_OK_PREFIX.some((p) => id.startsWith(p)))) {
        return { result: 'supported', codecs: ids };
      }
      return { result: 'unknown', codecs: ids };
    }
    // 其它容器（ogg 等）：不猜，交给浏览器
    return { result: 'unknown', codecs: [] };
  } catch {
    return { result: 'unknown', codecs: [] };
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

/** 给用户的准确建议（"换解码路径"做不到时，至少要给出可执行的出路） */
export function codecAdvice(codecs: string[]): string {
  const set = new Set(codecs.map((c) => c.toLowerCase()));
  if (set.has('hvc1') || set.has('hev1') || [...set].some((c) => c.includes('hevc'))) {
    return '这个视频是 H.265 / HEVC 编码，Electron 自带的 Chromium 没有 HEVC 解码器（苹果设备导出常见）。'
      + '用视频工具转成 H.264 即可：格式工厂 / HandBrake 选 "H.264"，或 ffmpeg -i 输入.mp4 -c:v libx264 -crf 20 输出.mp4。';
  }
  if ([...set].some((c) => c === 'vvc1' || c === 'vvi1')) {
    return '这个视频是 H.266 / VVC 编码，目前没有播放器支持。转成 H.264 再插入。';
  }
  if (set.has('dvh1') || set.has('dvhe')) {
    return '这个视频是杜比视界（Dolby Vision），需要专用解码器。转成普通 H.264 即可。';
  }
  return '这个视频的编码当前播放器解不了。建议转成 H.264（MP4）再插入。';
}
