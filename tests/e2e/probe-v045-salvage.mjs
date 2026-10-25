// v0.4.5 损坏工程抢救验收
// 用法：node tests/e2e/probe-v045-salvage.mjs
// 造三种坏文件：①不是 ZIP 的垃圾 ②ZIP 但 scene.json 坏了 ③ZIP 缺 manifest
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

// 手写一个最小 ZIP（store，不压缩）—— 避免为测试引入依赖
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);      // store
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([Buffer.concat(locals), centralBuf, end]);
}

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-salvage');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'builtin-extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  const dir = join(DATA_DIR, 'projects');
  mkdirSync(dir, { recursive: true });

  const scene = { root: { id: 'root', type: 'root', tag: 'body', style: {}, children: [{ id: 'a1', type: 'div', style: { width: '100px' }, children: [] }] }, tokens: [] };

  // ① 完全不是工程文件
  const garbage = join(dir, '垃圾.bcproj');
  writeFileSync(garbage, Buffer.from('this is not a project file at all', 'utf8'));

  // ② ZIP 但没有 manifest.json（只有场景）—— 应该还能救出场景
  const noManifest = join(dir, '缺清单.bcproj');
  writeFileSync(noManifest, makeZip([
    { name: 'scene.json', data: JSON.stringify(scene) }
  ]));

  // ③ ZIP 里 scene.json 是坏 JSON，但另有一个备份条目带完整场景
  const brokenScene = join(dir, '场景损坏.bcproj');
  writeFileSync(brokenScene, makeZip([
    { name: 'manifest.json', data: JSON.stringify({ format: 'blockcanvas', schemaVersion: 2, name: '场景损坏' }) },
    { name: 'scene.json', data: '{"root": {"id": "root", "child' },
    { name: 'scene.backup.json', data: JSON.stringify({ name: '从备份恢复', scene }) }
  ]));

  const env = { ...process.env, BC_NO_FOCUS: '1', BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(700);

  // 三个坏文件都应该"打不开"
  const opened = await win.evaluate(async (paths) => {
    const out = {};
    for (const [k, p] of Object.entries(paths)) {
      const r = await window.bc.openProjectFile(p);
      out[k] = { ok: r.ok, error: r.error };
    }
    return out;
  }, { garbage, noManifest, brokenScene });
  console.log('打开结果:', JSON.stringify(opened));

  check('垃圾文件被判定为无效工程', opened.garbage.ok === false, opened.garbage.error || '');
  // 缺 manifest 的容器实际比预期健壮：readProject 会退到"直接读 scene.json"，
  // 所以它能正常打开 —— 这是好事，不该要求它报错。
  check('缺 manifest 的容器仍能正常打开（读 scene 兜底）', opened.noManifest.ok === true,
    opened.noManifest.ok ? '打开成功' : (opened.noManifest.error || ''));
  check('场景损坏的容器也报错', opened.brokenScene.ok === false, opened.brokenScene.error || '');

  // 抢救
  const saved = await win.evaluate(async (paths) => {
    const out = {};
    for (const [k, p] of Object.entries(paths)) {
      const r = await window.bc.salvageProject(p);
      out[k] = { ok: r.ok, hasScene: !!r.scene, notes: (r.notes || []).slice(0, 3), error: r.error };
    }
    return out;
  }, { garbage, noManifest, brokenScene });
  console.log('抢救结果:', JSON.stringify(saved, null, 1));

  check('垃圾文件抢救失败但给出了过程记录',
    saved.garbage.ok === false && (saved.garbage.notes || []).length > 0,
    (saved.garbage.notes || []).join(' / '));
  check('缺 manifest 的容器能直接读到场景（无需抢救）',
    saved.noManifest.ok === true && saved.noManifest.hasScene === true,
    (saved.noManifest.notes || []).join(' / '));
  check('scene.json 损坏时能从备份条目救出场景',
    saved.brokenScene.ok === true && saved.brokenScene.hasScene === true,
    (saved.brokenScene.notes || []).join(' / '));

  await app.close();
  rmSync(DATA_DIR, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    for (const f of failed) console.log(' - ' + f.name);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });