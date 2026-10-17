// 工程文件容器探针（v0.4.4）
// 覆盖：① .bcproj = ZIP 容器（manifest.json 第一个 + scene.json 紧凑）
//      ② 老 JSON 文件**后台自动迁移**成容器（幂等、读回校验、留 .v1.bak）
//      ③ 读写往返一致；坏文件不影响其它文件
//      ④ 只读 manifest 能拿到工程名/元素数（不解 scene）
//      ⑤ 容器扩展位：sections（blocks）+ assets 能原样往返
//      ⑥ 会话拆分：session.json 只存索引，草稿进 data/session/，保存后草稿被回收
//      ⑦ 体积：容器 ≤ 旧 JSON（同内容）
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, cpSync } from 'fs';
const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');
const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + '  [' + (extra ?? '') + ']'); }
};

const DATA_DIR = resolve(tmpdir(), 'bc-projectfile-probe');
const PROJECTS = join(DATA_DIR, 'projects');
const BACKUPS = join(DATA_DIR, 'backups');
const SESSION = join(DATA_DIR, 'session');

const LEGACY_NAME = '老工程';
const LEGACY_FILE = 'legacy.jsonproj.bcproj';
const BAD_FILE = 'broken.bcproj';

/** 造一棵够大的场景树，方便比较体积 */
function makeScene(n) {
  const children = [];
  for (let i = 0; i < n; i += 1) {
    children.push({
      id: `el-${i}`,
      type: i % 5 === 0 ? 'h2' : 'p',
      text: `第 ${i} 段文字，用来撑出一点真实体积。`,
      attrs: { className: `c-${i % 7}` },
      style: {
        marginTop: '8px', marginBottom: '8px', color: '#1e293b',
        fontSize: `${14 + (i % 5)}px`, lineHeight: '1.7', paddingLeft: '4px'
      },
      children: []
    });
  }
  return { root: { id: 'root', type: 'div', style: { backgroundColor: '#fff' }, children }, selectedId: null, selectedIds: [] };
}

const isZip = (p) => {
  try {
    const b = readFileSync(p);
    return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
  } catch { return false; }
};
const sizeOf = (p) => { try { return readFileSync(p).length; } catch { return -1; } };

async function main() {
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  mkdirSync(PROJECTS, { recursive: true });
  mkdirSync(join(BACKUPS, LEGACY_NAME), { recursive: true });
  for (const rel of [resolve(ROOT, 'extensions'), resolve(ROOT, 'data', 'extensions')]) {
    if (existsSync(rel)) cpSync(rel, resolve(DATA_DIR, 'extensions'), { recursive: true });
  }

  // —— 造老格式（v1 纯 JSON，美化输出）——
  const legacyScene = makeScene(40);
  const legacyJson = JSON.stringify({
    format: 'BlockCanvas-Project', version: '1.0.0', name: LEGACY_NAME,
    updatedAt: '2026-01-01T00:00:00.000Z',
    meta: { elementCount: 41 }, scene: legacyScene
  }, null, 2);
  writeFileSync(join(PROJECTS, LEGACY_FILE), legacyJson, 'utf-8');
  // 老格式快照
  writeFileSync(join(BACKUPS, LEGACY_NAME, 'snapshot-20260101-0000.bcproj'), legacyJson, 'utf-8');
  // 坏文件（应被跳过且保持原样）
  writeFileSync(join(PROJECTS, BAD_FILE), '{ this is not json', 'utf-8');

  const legacySizeBefore = sizeOf(join(PROJECTS, LEGACY_FILE));
  ok('准备：老格式工程是纯 JSON（不是 zip）', isZip(join(PROJECTS, LEGACY_FILE)) === false, String(legacySizeBefore) + 'B');

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1000);

  // ============ ① 后台自动迁移 ============
  // 启动后 1500ms 触发迁移，给它留足时间
  let migrated = false;
  for (let i = 0; i < 20; i += 1) {
    if (isZip(join(PROJECTS, LEGACY_FILE))) { migrated = true; break; }
    await sleep(400);
  }
  ok('【迁移】老 JSON 工程被自动转换成 ZIP 容器', migrated === true, String(sizeOf(join(PROJECTS, LEGACY_FILE))) + 'B');
  ok('【迁移】留下了 .v1.bak 备份（用户可自救）', existsSync(join(PROJECTS, LEGACY_FILE + '.v1.bak')) === true);
  ok('【迁移】老格式快照也被转换', isZip(join(BACKUPS, LEGACY_NAME, 'snapshot-20260101-0000.bcproj')) === true);
  ok('【迁移】坏文件被跳过且保持原样', !isZip(join(PROJECTS, BAD_FILE)) && existsSync(join(PROJECTS, BAD_FILE)));
  ok('【迁移】迁移后体积明显变小', sizeOf(join(PROJECTS, LEGACY_FILE)) < legacySizeBefore,
    `${legacySizeBefore}B → ${sizeOf(join(PROJECTS, LEGACY_FILE))}B`);

  // 迁移后仍能正常读出（内容一致）
  const afterMigrate = await win.evaluate((p) => window.bc.openProjectFile(p), join(PROJECTS, LEGACY_FILE));
  ok('【迁移】迁移后仍能读出工程', afterMigrate.ok === true && afterMigrate.project?.name === LEGACY_NAME, JSON.stringify({ ok: afterMigrate.ok, name: afterMigrate.project?.name }));
  const sceneSame = JSON.stringify(afterMigrate.project?.scene) === JSON.stringify(legacyScene);
  ok('【迁移】迁移前后场景内容完全一致', sceneSame === true);
  ok('【迁移】读到的是容器', afterMigrate.container === 'zip', String(afterMigrate.container));
  ok('【迁移】schemaVersion 已升到 2', afterMigrate.project?.schemaVersion === 2, String(afterMigrate.project?.schemaVersion));

  // 幂等：再跑一次迁移不应产生变化（在 Node 侧读文件，主进程侧只调函数）
  // 注意：app.evaluate 里没有 require，也拿不到外部传参 → 用 process.env 拼路径
  const legacyPath = join(PROJECTS, LEGACY_FILE);
  const beforeBytes = sizeOf(legacyPath);
  const m2 = await app.evaluate(() => {
    const P = globalThis.__bcProjectFile;
    const dir = process.env.BC_DATA_DIR.replace(/\\/g, '/') + '/projects';
    return P.migrateProjectFilesIn([dir]);
  }).catch((e) => ({ err: String(e) }));
  const afterBytes = sizeOf(legacyPath);
  ok('【迁移】重复运行是幂等的（already，不改文件）',
    m2 && !m2.err && m2.already >= 1 && beforeBytes === afterBytes,
    JSON.stringify({ r: m2, beforeBytes, afterBytes }));

  // ============ ② 只读 manifest ============
  const mani = await app.evaluate(() => {
    const P = globalThis.__bcProjectFile;
    const p = process.env.BC_DATA_DIR.replace(/\\/g, '/') + '/projects/legacy.jsonproj.bcproj';
    return P.readManifestOnly(p);
  }).catch((e) => ({ err: String(e) }));
  ok('【manifest】只读 manifest 拿到工程名', mani && mani.ok === true && mani.manifest?.name === LEGACY_NAME, JSON.stringify(mani?.manifest?.name));
  ok('【manifest】只读 manifest 拿到元素数', mani?.manifest?.meta?.elementCount === 41, String(mani?.manifest?.meta?.elementCount));
  ok('【manifest】声明了 scene section', mani?.manifest?.sections?.scene === 'scene.json', String(mani?.manifest?.sections?.scene));

  // ============ ③ 保存往返（走渲染层真实 IPC） ============
  const roundScene = makeScene(120);
  const target = join(PROJECTS, 'roundtrip.bcproj');
  const saved = await win.evaluate(([p, scene]) => window.bc.saveProject({ name: '往返测试', scene }, false, p), [target, roundScene]);
  ok('【往返】保存成功', saved.ok === true, JSON.stringify(saved));
  ok('【往返】落盘的是 ZIP 容器', isZip(target) === true);
  const back = await win.evaluate((p) => window.bc.openProjectFile(p), target);
  ok('【往返】读回场景一致', JSON.stringify(back.project?.scene) === JSON.stringify(roundScene));
  ok('【往返】读回名称一致', back.project?.name === '往返测试', String(back.project?.name));
  ok('【往返】容器比旧美化 JSON 更小', sizeOf(target) < Buffer.byteLength(JSON.stringify({ name: '往返测试', scene: roundScene }, null, 2), 'utf8'),
    `${sizeOf(target)}B vs ${Buffer.byteLength(JSON.stringify({ name: '往返测试', scene: roundScene }, null, 2), 'utf8')}B`);

  // 覆盖保存要继承 createdAt（不能每次保存都变）
  const c1 = back.project?.createdAt;
  await sleep(1100);
  await win.evaluate(([p, scene]) => window.bc.saveProject({ name: '往返测试', scene }, false, p), [target, roundScene]);
  const back2 = await win.evaluate((p) => window.bc.openProjectFile(p), target);
  ok('【往返】覆盖保存继承 createdAt', back2.project?.createdAt === c1, `${c1} → ${back2.project?.createdAt}`);
  ok('【往返】覆盖保存后 updatedAt 变新', back2.project?.updatedAt !== back.project?.updatedAt);

  // ============ ④ 容器结构（在 Node 侧直接读字节） ============
  const zipBuf = readFileSync(target);
  const firstNameLen = zipBuf.readUInt16LE(26);
  const firstName = zipBuf.slice(30, 30 + firstNameLen).toString('utf8');
  ok('【结构】容器第一个条目是 manifest.json（便于只读列表）', firstName === 'manifest.json', firstName);
  ok('【结构】容器魔数 = PK\\x03\\x04', zipBuf.slice(0, 4).toString('hex') === '504b0304', zipBuf.slice(0, 4).toString('hex'));

  // ============ ⑤ 扩展位：sections + assets ============
  const extPath = join(PROJECTS, 'ext.bcproj');
  const ext = await app.evaluate(() => {
    const P = globalThis.__bcProjectFile;
    const p = process.env.BC_DATA_DIR.replace(/\\/g, '/') + '/projects/ext.bcproj';
    // 模拟后续功能：写一个 blocks section + 一张图片资源（Buffer 是 Node 全局，无需 require）
    const w = P.writeProject(p, {
      name: '扩展测试',
      scene: { root: { id: 'root', type: 'div', children: [] } },
      sections: { blocks: { version: 1, scripts: [{ id: 's1', blocks: [{ op: 'move', n: 10 }] }] } },
      assets: [{ name: 'logo.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }]
    });
    const r = P.readProject(p);
    const names = P.readManifestOnly(p);
    const asset = r.payload && r.payload.assets && r.payload.assets[0] ? P.readAsset(p, r.payload.assets[0].path) : null;
    return {
      wrote: w.ok,
      err: w.error,
      blocks: r.payload?.extraSections?.blocks?.scripts?.[0]?.blocks?.[0]?.op,
      assetRefs: r.payload?.assets?.length,
      assetBytes: asset ? Array.from(asset) : null,
      sectionDeclared: names.manifest?.sections?.blocks
    };
  }).catch((e) => ({ err: String(e) }));
  ok('【扩展】写入了 blocks section', ext.wrote === true && ext.blocks === 'move', JSON.stringify(ext));
  ok('【扩展】blocks 在 manifest 里声明', ext.sectionDeclared === 'blocks.json', String(ext.sectionDeclared));
  ok('【扩展】图片资源原样往返（不 base64）', Array.isArray(ext.assetBytes) && ext.assetBytes.join(',') === '137,80,78,71,1,2,3', JSON.stringify(ext.assetBytes));
  ok('【扩展】容器里能列出 blocks.json 条目', (() => {
    try {
      const b = readFileSync(extPath);
      return b.includes(Buffer.from('blocks.json')) && b.includes(Buffer.from('assets/'));
    } catch { return false; }
  })());

  // ============ ⑥ 会话拆分 ============
  const tabs = [
    { id: 'tab-a', name: '已保存的页', filePath: target, isDirty: false, scene: roundScene },
    { id: 'tab-b', name: '未保存的页', filePath: null, isDirty: true, scene: { root: { id: 'r2', type: 'div', children: [] }, selectedId: null, selectedIds: [] } }
  ];
  const wrote = await win.evaluate((t) => window.bc.setSession({ activeTabId: 'tab-b', tabs: t }), tabs);
  await sleep(600);
  ok('【会话】写入成功', wrote === true, String(wrote));
  const sessRaw = (() => { try { return JSON.parse(readFileSync(join(DATA_DIR, 'session.json'), 'utf-8')); } catch { return null; } })();
  ok('【会话】session.json 里**不含** scene（已拆出去）', !!sessRaw && !JSON.stringify(sessRaw).includes('"scene"'), JSON.stringify(sessRaw).slice(0, 160));
  ok('【会话】session.json 有 schemaVersion', sessRaw?.schemaVersion === 2, String(sessRaw?.schemaVersion));
  ok('【会话】已保存的标签不写草稿（零冗余）', !existsSync(join(SESSION, 'tab-a.bcproj')));
  ok('【会话】未保存的标签写了草稿容器', isZip(join(SESSION, 'tab-b.bcproj')) === true);
  const restored = await win.evaluate(() => window.bc.getSession());
  ok('【会话】读回时场景被正确组装', JSON.stringify(restored.tabs.find((t) => t.id === 'tab-b')?.scene) === JSON.stringify(tabs[1].scene));
  ok('【会话】已保存标签从工程文件恢复场景', JSON.stringify(restored.tabs.find((t) => t.id === 'tab-a')?.scene) === JSON.stringify(roundScene));

  // 标签被保存后（有了 filePath 且不脏）→ 草稿应被回收
  await win.evaluate((args) => window.bc.setSession({
    activeTabId: 'tab-a',
    tabs: [
      { id: 'tab-a', name: '已保存的页', filePath: args.filePath, isDirty: false, scene: args.scene },
      { id: 'tab-b', name: '刚保存的页', filePath: args.filePath, isDirty: false, scene: args.scene }
    ]
  }), { filePath: target, scene: roundScene });
  await sleep(600);
  ok('【会话】标签保存后草稿被自动回收', !existsSync(join(SESSION, 'tab-b.bcproj')));

  // 老格式 session.json 能被读并自动迁移
  writeFileSync(join(DATA_DIR, 'session.json'), JSON.stringify({
    activeTabId: 'old-tab',
    tabs: [{ id: 'old-tab', name: '老会话', filePath: null, isDirty: true, scene: { root: { id: 'root', type: 'div', children: [] } } }],
    updatedAt: '2026-01-01T00:00:00.000Z'
  }), 'utf-8');
  const oldRead = await win.evaluate(() => window.bc.getSession());
  await sleep(400);
  const sessAfter = (() => { try { return JSON.parse(readFileSync(join(DATA_DIR, 'session.json'), 'utf-8')); } catch { return null; } })();
  ok('【会话】老格式 session.json 能正常读', oldRead?.tabs?.[0]?.name === '老会话');
  ok('【会话】读到老格式后自动迁移成新结构', sessAfter?.schemaVersion === 2 && !JSON.stringify(sessAfter).includes('"scene"'), JSON.stringify(sessAfter).slice(0, 140));

  // ============ ⑦ 列表页 & 存储统计 ============
  const list = await win.evaluate(() => window.bc.listProjects());
  const rt = list.find((p) => p.name === '往返测试');
  ok('【列表】listProjects 从 manifest 拿到名称与元素数', !!rt && rt.elementCount === 121, JSON.stringify({ n: rt?.name, c: rt?.elementCount }));
  const bd = await win.evaluate(() => window.bc.getStorageBreakdown());
  const sum = bd.categories.reduce((a, c) => a + c.bytes, 0);
  ok('【统计】分类之和仍等于合计（账目没被新目录打破）', sum === bd.grandTotal, `${sum} vs ${bd.grandTotal}`);

  ok('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  console.log(`\n===== 工程文件容器探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
