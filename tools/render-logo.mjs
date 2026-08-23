// BlockCanvas · 从 logo 几何定义渲染全套尺寸 PNG（含透明底、抗锯齿）。
// 用法：node tools/render-logo.mjs
// 说明：纯 Node 实现的极简 PNG 编码器（RGBA + zlib），直接按 SVG 里的三块圆角方块
//       逐像素栅格化，无需任何外部图形库，可在此环境的沙箱里直接运行。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'src/renderer/assets');
const SIZES = [512, 256, 128, 64, 48, 32, 16];

// 与 logo.svg 保持一致的几何（256 单位空间）与颜色。
const BLOCKS = [
  { x: 29, y: 29, w: 92, h: 92, r: 20, color: [0x29, 0x65, 0xf1] }, // 左上 · CSS 蓝
  { x: 29, y: 135, w: 92, h: 92, r: 20, color: [0xe3, 0x4f, 0x26] }, // 左下 · HTML 橙
  { x: 135, y: 135, w: 92, h: 92, r: 20, color: [0xf7, 0xdf, 0x1e] } // 右下 · JS 黄
];

// 圆角矩形命中测试（SDF<=0 即在内部）
function inRoundedRect(px, py, bx, by, w, h, r) {
  const cx = bx + w / 2;
  const cy = by + h / 2;
  const hw = w / 2;
  const hh = h / 2;
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r <= 0;
}

function render(size) {
  const scale = size / 256;
  const SS = size <= 64 ? 6 : 4; // 小图高倍数超采样，边缘更平滑
  const buf = Buffer.alloc(size * size * 4); // RGBA，透明底
  const step = 1 / SS;
  const un = 256 / size; // 单位空间下每像素大小

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0;
      let color = null;
      const pxBase = x + 0.5;
      const pyBase = y + 0.5;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // 子像素在单位空间里的坐标（用 0..1 偏移采样中心）
          const u = (pxBase + (sx + 0.5) * step - 0.5) * un;
          const v = (pyBase + (sy + 0.5) * step - 0.5) * un;
          for (const b of BLOCKS) {
            if (inRoundedRect(u, v, b.x, b.y, b.w, b.h, b.r)) {
              cov++;
              color = b.color;
              break;
            }
          }
        }
      }
      const p = (y * size + x) * 4;
      if (color) {
        const a = Math.round((cov / (SS * SS)) * 255);
        buf[p] = color[0];
        buf[p + 1] = color[1];
        buf[p + 2] = color[2];
        buf[p + 3] = a;
      }
    }
  }
  return encodePNG(size, size, buf);
}

// 极简 PNG 编码器：8 位 RGBA、无隔行、每条扫描线 filter=0，IDAT 用 zlib。
function encodePNG(w, h, rgba) {
  // 扫描线前置 filter 字节（0）
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = deflateSync(raw);

  const chunks = [];
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  chunks.push(chunk('IHDR', ihdr));
  chunks.push(chunk('IDAT', idat));
  chunks.push(chunk('IEND', Buffer.alloc(0)));

  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const png = render(size);
  writeFileSync(join(OUT, `logo-${size}.png`), png);
  console.log(`logo-${size}.png <- ${size}x${size}`);
}
console.log('done');
