// v0.4.6 · 媒体编码探测单测（R6-18）
//
// 为什么先写单测：编码探测是"读二进制头"的活，靠 E2E 黑盒验证太贵（要真视频 + 真解码器），
// 而它的正确性完全可以用固定素材直接断言。素材由 ffmpeg 生成（见 tests/e2e/fixtures/media）。
//
// 覆盖的三种结论：
//   supported   —— H.264（avc1/avc3），Chromium 一定能解
//   unsupported —— HEVC（hvc1 / hev1），Electron 默认不带解码器，正是用户报的那条错误
//   unknown     —— 读不出来 / 不是 MP4/WebM → 调用方必须照常播放（不能误杀）
//
// 用法：node tests/unit/codec-probe.test.mjs
import { probeCodec, codecAdvice } from '../../out/main/codecProbe.js';

let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

// 打包后的模块在 out/main（electron-vite 会把 main 编译成 CJS，所以用 require 兼容两路）
const FIX = new URL('../e2e/fixtures/media/', import.meta.url);
const p = (n) => decodeURIComponent(new URL(n, FIX).pathname).replace(/^\/([A-Za-z]:)/, '$1');

async function main() {
  // ── H.264：必须判为 supported ──────────────────────────────────────
  const h264 = probeCodec(p('h264-faststart.mp4'), 'mp4');
  check('H.264（faststart）判为 supported',
    h264.result === 'supported', `${h264.result} · ${h264.codecs.join(',')}`);
  check('H.264 的 codec 是 avc1/avc3',
    h264.codecs.some((c) => c === 'avc1' || c === 'avc3'), h264.codecs.join(','));

  // moov 在文件尾部（没做 faststart）也要能读到 —— 这是真实 mp4 的常见形态
  const h264b = probeCodec(p('h264-no-faststart.mp4'), 'mp4');
  check('H.264（moov 在尾部）同样判为 supported',
    h264b.result === 'supported', `${h264b.result} · ${h264b.codecs.join(',')}`);

  // ── HEVC：必须判为 unsupported（这两个就是用户那条报错的真凶）──────
  const hvc1 = probeCodec(p('hevc-hvc1.mp4'), 'mp4');
  check('HEVC (hvc1) 判为 unsupported',
    hvc1.result === 'unsupported', `${hvc1.result} · ${hvc1.codecs.join(',')}`);
  check('HEVC (hvc1) 读到了编码标识',
    hvc1.codecs.includes('hvc1'), hvc1.codecs.join(','));

  const hev1 = probeCodec(p('hevc-hev1.mp4'), 'mp4');
  check('HEVC (hev1) 判为 unsupported',
    hev1.result === 'unsupported', `${hev1.result} · ${hev1.codecs.join(',')}`);

  // ── 建议文案：必须指向可执行的出路（转 H.264），不能只报错 ──────────
  const advice = codecAdvice(hvc1.codecs);
  check('HEVC 的建议文案提到 H.264 转码',
    /H\.264|libx264/.test(advice), advice.slice(0, 60));
  check('建议文案能直接抄去用（含 ffmpeg 命令或工具名）',
    /ffmpeg|HandBrake|格式工厂/.test(advice), advice.slice(0, 60));

  // ── 不误杀：读不出来的情况必须返回 unknown ─────────────────────────
  const missing = probeCodec(p('__not_exist__.mp4'), 'mp4');
  check('文件不存在 → unknown（不是 unsupported，不能误杀）',
    missing.result === 'unknown', missing.result);

  const txt = probeCodec(p('h264-faststart.mp4'.replace('.mp4', '.mp4')) + '', 'txt');
  check('未知扩展名 → unknown（交给浏览器判断）',
    txt.result === 'unknown', txt.result);

  // 空文件 / 太小
  const empty = probeCodec(p('__not_exist__.mp4'), '');
  check('空扩展名 + 不存在 → unknown', empty.result === 'unknown', empty.result);

  // ── 关键不变量：supported 永远不能是"猜的"──────────
  check('supported 一定读到了已知可解的编码（不是靠扩展名猜）',
    h264.codecs.length > 0 && h264.codecs.every((c) => /^(avc1|avc3|vp09|av01|mp4v)$/.test(c)),
    h264.codecs.join(','));

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
