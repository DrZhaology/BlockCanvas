// 检查 Web 单文件产物：体积 / 是否有外链 / 版本号
// 用法：node tools/check-web-build.mjs
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const p = 'dist-web/index.html';
const t = readFileSync(p, 'utf8');
const ext = [...t.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
console.log(JSON.stringify({
  sizeKB: Math.round(t.length / 1024),
  gzipKB: Math.round(gzipSync(Buffer.from(t)).length / 1024),
  externalRefs: ext.length,
  externalSamples: ext.slice(0, 8),
  hasVersion046: t.includes('0.4.6'),
  scriptTags: (t.match(/<script/g) || []).length,
  linkTags: (t.match(/<link/g) || []).length,
  startsWithDoctype: /^\s*<!doctype html>/i.test(t)
}, null, 1));
