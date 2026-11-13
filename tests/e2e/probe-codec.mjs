// v0.4.6 · 媒体编码探测验收（R6-18）
//
// 问题：用户报「一个 mp4 明明正常播放，下方还红色提示解码不了、退回默认壁纸」，
// 日志是 `ffmpeg_common.cc Unsupported pixel format: -1`。
//
// 根因：那条日志来自 **Chromium 的原生解码器**，JS 侧屏蔽不了。它触发于
// "把 <video src> 挂上去"的瞬间 —— 只要挂了就会尝试初始化解码器。容器里声明的编码
// 属于这个 Electron 不带的那几种（HEVC / 杜比视界 / 10bit H.264）时就白屏。
//
// 本版做法：**挂之前先读容器头**，解不了就根本不挂 <video>，从根上不触发原生解码。
// 读不出来（unknown）时照常播放 —— 绝不因为探测失败就误杀一个正常视频。
//
// 本探针在**主进程**里直接调用探测函数（与 probe-paths 同一手法），
// 用 ffmpeg 生成的真实 mp4 做输入，所以是"真二进制"而不是构造的假数据。
//
// 用法：node tests/e2e/probe-codec.mjs
import { createRequire } from 'module';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

const FIXTURES = resolve(ROOT, 'tests/e2e/fixtures/media');

/** 用 ffmpeg 生成素材（已存在就跳过）——保证探针自带输入，不依赖仓库里的大文件 */
function ensureFixtures() {
  mkdirSync(FIXTURES, { recursive: true });
  const targets = [
    ['h264-faststart.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']],
    ['h264-no-faststart.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
    ['hevc-hvc1.mp4', ['-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p']],
    ['hevc-hev1.mp4', ['-c:v', 'libx265', '-tag:v', 'hev1', '-pix_fmt', 'yuv420p']]
  ];
  const ffmpeg = ['D:\\Application\\FFmpeg\\bin\\ffmpeg.exe', 'ffmpeg']
    .find((p) => existsSync(p)) ?? null;
  for (const [name, codecArgs] of targets) {
    const out = resolve(FIXTURES, name);
    if (existsSync(out)) continue;
    if (!ffmpeg) { console.log(`SKIP  生成 ${name}（本机没有 ffmpeg）`); continue; }
    try {
      execFileSync(ffmpeg, [
        '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=1',
        ...codecArgs, out
      ], { stdio: 'ignore' });
    } catch {
      console.log(`SKIP  生成 ${name} 失败（ffmpeg 缺该编码器）`);
    }
  }
}

async function main() {
  ensureFixtures();
  const have = {
    h264: existsSync(resolve(FIXTURES, 'h264-faststart.mp4')),
    h264b: existsSync(resolve(FIXTURES, 'h264-no-faststart.mp4')),
    hvc1: existsSync(resolve(FIXTURES, 'hevc-hvc1.mp4')),
    hev1: existsSync(resolve(FIXTURES, 'hevc-hev1.mp4'))
  };
  console.log('  素材:', JSON.stringify(have));

  const DATA_DIR = resolve(tmpdir(), 'bc-probe-codec');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);

  // ── ① 主进程里直接跑探测（真二进制）────────────────────────────────
  const probe = await app.evaluate(async (_electron, paths) => {
    // 主进程里没有暴露 probeCodec 到 global，直接走 IPC 的同一入口是不行的；
    // 这里用 __bcCodec 探针钩子（见 src/main/main.ts 的开发态钩子）。
    const P = globalThis.__bcCodec;
    if (!P) return { hooked: false };
    return {
      hooked: true,
      h264: P.probe(paths.h264, 'mp4'),
      h264b: P.probe(paths.h264b, 'mp4'),
      hvc1: P.probe(paths.hvc1, 'mp4'),
      hev1: P.probe(paths.hev1, 'mp4'),
      missing: P.probe(paths.missing, 'mp4'),
      txt: P.probe(paths.h264, 'txt'),
      advice: P.advice(['hvc1'])
    };
  }, {
    h264: resolve(FIXTURES, 'h264-faststart.mp4'),
    h264b: resolve(FIXTURES, 'h264-no-faststart.mp4'),
    hvc1: resolve(FIXTURES, 'hevc-hvc1.mp4'),
    hev1: resolve(FIXTURES, 'hevc-hev1.mp4'),
    missing: resolve(FIXTURES, '__not_exist__.mp4')
  });

  check('主进程挂上了编码探测钩子（__bcCodec）', probe.hooked === true, String(probe.hooked));

  if (probe.hooked) {
    check('H.264（faststart）判为 supported',
      probe.h264.result === 'supported', `${probe.h264.result} · ${probe.h264.codecs.join(',')}`);
    check('H.264 读到 avc1/avc3',
      probe.h264.codecs.some((c) => c === 'avc1' || c === 'avc3'), probe.h264.codecs.join(','));
    check('H.264（moov 在文件尾部）也能判为 supported（按盒大小跳读）',
      probe.h264b.result === 'supported', `${probe.h264b.result} · ${probe.h264b.codecs.join(',')}`);
    check('HEVC (hvc1) 判为 unsupported —— 这就是"Unsupported pixel format"的真凶',
      probe.hvc1.result === 'unsupported', `${probe.hvc1.result} · ${probe.hvc1.codecs.join(',')}`);
    check('HEVC (hev1) 判为 unsupported',
      probe.hev1.result === 'unsupported', `${probe.hev1.result} · ${probe.hev1.codecs.join(',')}`);
    check('文件不存在 → unknown（不是 unsupported，绝不误杀）',
      probe.missing.result === 'unknown', probe.missing.result);
    check('非视频扩展名 → unknown（交给浏览器判断）',
      probe.txt.result === 'unknown', probe.txt.result);
    check('HEVC 的建议给出可执行的转码出路',
      /H\.264/.test(probe.advice) && /ffmpeg|HandBrake|格式工厂/.test(probe.advice),
      probe.advice.slice(0, 80));
  }

  // ── ② 渲染层：解不了的视频在画布上不挂 <video> ────────────────────
  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1200);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  const makeVideo = async (src) => win.evaluate((s) => {
    const st = window.__sceneStore.getState();
    st.beginStyleEdit();
    st.addElement('video');
    const kids = window.__sceneStore.getState().scene.root.children || [];
    const fresh = kids[kids.length - 1];
    if (!fresh) return null;
    window.__sceneStore.getState().updateAttr(fresh.id, 'src', s);
    window.__sceneStore.getState().updateAttr(fresh.id, 'srcAbs', s);
    window.__sceneStore.getState().updateStyle(fresh.id, { width: '320px', height: '180px' });
    window.__sceneStore.getState().endStyleEdit();
    window.__sceneStore.getState().selectElement(fresh.id);
    return fresh.id;
  }, src);

  if (have.hvc1) {
    const hevcId = await makeVideo(resolve(FIXTURES, 'hevc-hvc1.mp4'));
    await sleep(2200);
    const hevcState = await win.evaluate((id) => {
      const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
      return {
        hasVideo: !!(el && el.tagName.toLowerCase() === 'video'),
        hasBlocker: !!(el && el.classList.contains('bc-codec-blocked')),
        text: el ? (el.textContent || '').trim().replace(/\s+/g, ' ') : '',
        tag: el ? el.tagName.toLowerCase() : ''
      };
    }, hevcId);
    check('HEVC 视频在画布上**不挂 <video>**（从根上不触发原生解码）',
      hevcState.hasVideo === false, `tag=${hevcState.tag}`);
    check('改成"编码不支持"占位块（用户看得见、可选中、能拖动）',
      hevcState.hasBlocker === true, `class=bc-codec-blocked → ${hevcState.hasBlocker}`);
    check('占位块写清楚编码与出路',
      /H\.264/.test(hevcState.text) && /hvc1/i.test(hevcState.text), hevcState.text.slice(0, 60));

    // 选中它就应看到属性面板的编码警告卡
    await win.locator('.tab-btn', { hasText: '属性' }).click().catch(() => null);
    await sleep(700);
    const card = await win.evaluate(() => {
      const w = document.querySelector('.media-codec-warn');
      return w ? (w.textContent || '').trim().replace(/\s+/g, ' ') : null;
    });
    check('属性面板给出编码警告卡（不是让用户对着空白猜）',
      !!card && /编码/.test(card), card ? card.slice(0, 60) : '没找到 .media-codec-warn');
  }

  if (have.h264) {
    const okId = await makeVideo(resolve(FIXTURES, 'h264-faststart.mp4'));
    await sleep(2200);
    const okState = await win.evaluate((id) => {
      const el = document.querySelector(`.canvas [data-bc-id="${id}"]`);
      return {
        tag: el ? el.tagName.toLowerCase() : '',
        hasBlocker: !!(el && el.classList.contains('bc-codec-blocked'))
      };
    }, okId);
    check('H.264 视频照常挂 <video>（探测不会误杀正常视频）',
      okState.tag === 'video' && okState.hasBlocker === false, `tag=${okState.tag}`);
  }

  check('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
