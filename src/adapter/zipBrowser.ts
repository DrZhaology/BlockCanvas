// BlockCanvas · 浏览器端的 zip 读写（R6-12）
//
// 为什么不复用 src/main/zip.ts：那个文件 import 了 `node:zlib`（deflateRawSync / inflateRawSync），
// 浏览器里没有。二者算法一致（都是标准 ZIP），但**字节层实现不同**：
//   · 读：用浏览器原生的 `DecompressionStream('deflate-raw')`（Chromium 80+ 支持）
//   · 写：用 **method 0（存储，不压缩）**。原因是 CompressionStream 只有 deflate/gzip，
//         而 ZIP 需要"raw deflate + 自己算 crc + 拼头"，用存储模式既简单又**一定能被任何
//         解压工具打开**（只是文件大一点）。导出的是网页 HTML/JSON，压缩收益本就不大。
//
// 兼容性：读的时候两种方法都支持（0 存储 / 8 压缩），所以能打开编辑器存出来的 .bcproj。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type BrowserZipEntry = { name: string; data: Uint8Array };

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/** 写一个 zip（method 0 存储模式，任何工具都能解） */
export function zipCreateStore(entries: BrowserZipEntry[]): Uint8Array {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const locals: number[] = [];
  const centrals: number[] = [];

  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const localStart = locals.length;

    // 本地头：签名 / 版本 / 标志 / 方法0 / 时间日期 / crc / 压缩后大小 / 原始大小 / 名字长 / extra 长
    locals.push(
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), ...u16(0)
    );
    for (const b of nameBytes) locals.push(b);
    for (const b of e.data) locals.push(b);

    // 中央目录项
    centrals.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(localStart)
    );
    for (const b of nameBytes) centrals.push(b);
  }

  const centralStart = locals.length;
  const all = locals.concat(centrals);
  all.push(
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centrals.length), ...u32(centralStart), ...u16(0)
  );

  return new Uint8Array(all);
}

/** 读出 zip 的条目（方法 0 直接拷，方法 8 用 DecompressionStream） */
export async function zipListBrowser(buf: Uint8Array): Promise<BrowserZipEntry[]> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // 找 EOCD（从尾部往前扫，注释最长 65535）
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到目录尾）');
  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);

  const out: BrowserZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));

    // 本地头：名字/extra 长度可能与中央目录不同，要按本地头算数据起点
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      out.push({ name, data: raw.slice() });
    } else if (method === 8) {
      // 浏览器原生 raw deflate 解压
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([raw.slice() as unknown as BlobPart]).stream().pipeThrough(ds);
      const plain = new Uint8Array(await new Response(stream).arrayBuffer());
      out.push({ name, data: plain });
    } else {
      throw new Error(`不支持的压缩方式 ${method}（只支持 0 存储 / 8 deflate）`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
