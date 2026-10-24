// v0.4.5 素材打包验收：保存时把本地图片收进 .bcproj，重开后仍能显示
// 用法：node tests/e2e/probe-v045-assets.mjs
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync, readFileSync } from 'fs';

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

// 1×1 红色 PNG（最小合法图片）
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-probe-assets');
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const SRC = resolve(ROOT, 'extensions');
  if (existsSync(SRC)) cpSync(SRC, resolve(DATA_DIR, 'extensions'), { recursive: true });

  // 造一张真实存在的本地图片（模拟"用户电脑上的图片"）
  const imgDir = join(DATA_DIR, 'my-images');
  mkdirSync(imgDir, { recursive: true });
  const imgPath = join(imgDir, 'avatar.png');
  writeFileSync(imgPath, PNG_1X1);

  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.empty-home', { timeout: 20000 });
  await sleep(600);

  await win.locator('.eh-btn', { hasText: '新建项目' }).click();
  await sleep(1000);
  await win.waitForSelector('.project-tab-bar', { timeout: 15000 });

  const projectPath = join(DATA_DIR, 'projects', 'assets-demo.bcproj');

  // 造一个引用本地图片的 img 元素，然后保存
  const saved = await win.evaluate(async ({ img, target }) => {
    const st = window.__sceneStore.getState();
    const before = new Set((st.scene.root.children || []).map((c) => c.id));
    st.addElement('img');
    const s2 = window.__sceneStore.getState();
    const kids = s2.scene.root.children || [];
    const fresh = kids.find((c) => !before.has(c.id));
    if (!fresh) return { ok: false, why: 'no element' };
    const ref = 'bc-img://file/' + encodeURIComponent(img);
    s2.updateStyle(fresh.id, { width: '80px', height: '80px' });
    window.__sceneStore.getState().setText?.(fresh.id, '');
    // img 的地址存在 src 字段上
    window.__sceneStore.getState().updateProp?.(fresh.id, 'src', ref);
    // 兼容：不同版本用的 action 名可能不同，两种都试
    const s3 = window.__sceneStore.getState();
    if (s3.scene.root.children.find((c) => c.id === fresh.id)?.src !== ref) {
      s3.updateStyle(fresh.id, { backgroundImage: `url("${ref}")` });
    }
    const scene = window.__sceneStore.getState().scene;
    const res = await window.bc.saveProject({ name: '素材演示', scene }, false, target);
    return { ok: res.ok, path: res.path, assets: res.assets, missing: res.missingAssets, sceneJson: JSON.stringify(scene) };
  }, { img: imgPath, target: projectPath });
  console.log('保存结果:', JSON.stringify({ ok: saved.ok, assets: saved.assets, missing: saved.missing }));

  check('保存成功并报告收集到的素材数', saved.ok && saved.assets >= 1,
    `assets=${saved.assets} missing=${(saved.missing || []).length}`);
  check('工程文件确实写出来了', existsSync(projectPath), projectPath);

  // 容器里应该真的有 assets/ 条目
  const zipBytes = existsSync(projectPath) ? readFileSync(projectPath) : Buffer.alloc(0);
  check('ZIP 里包含 assets/ 条目', zipBytes.includes(Buffer.from('assets/')),
    `文件 ${zipBytes.length} 字节`);

  // 重开：场景引用应改写成 bc-img://asset/...
  const reopened = await win.evaluate(async (p) => {
    const res = await window.bc.openProjectFile(p);
    if (!res.ok) return { ok: false, error: res.error };
    const json = JSON.stringify(res.project?.scene || {});
    const m = /bc-img:\/\/asset\/[^"'\\\s)]+/.exec(json);
    return {
      ok: true,
      assetRefs: (json.match(/bc-img:\/\/asset\//g) || []).length,
      fileRefs: (json.match(/bc-img:\/\/file\//g) || []).length,
      manifestAssets: (res.project?.assets || []).length,
      extracted: res.extractedAssets,
      assetUrl: m ? m[0] : ''
    };
  }, projectPath);
  console.log('重开结果:', JSON.stringify(reopened));
  check('场景里的本地路径引用被改写成容器内引用',
    reopened.ok && reopened.assetRefs >= 1 && reopened.fileRefs === 0,
    `asset 引用=${reopened.assetRefs} file 引用=${reopened.fileRefs}`);
  check('manifest 里登记了素材', reopened.ok && reopened.manifestAssets >= 1, `assets=${reopened.manifestAssets}`);

  // 协议能不能真的取到（图片加载成功 = 换机器打开也能显示）
  const imgOk = await win.evaluate((url) => new Promise((resolve) => {
    if (!url) return resolve({ ok: false, why: '工程里没有 asset 引用' });
    const el = new Image();
    el.onload = () => resolve({ ok: true, w: el.naturalWidth, h: el.naturalHeight, src: url });
    el.onerror = () => resolve({ ok: false, why: '图片加载失败', src: url });
    el.src = url;
    setTimeout(() => resolve({ ok: false, why: '加载超时' }), 4000);
  }), reopened.assetUrl);
  check('bc-img://asset/... 能被协议读到（换机器不丢图）',
    imgOk.ok && imgOk.w > 0,
    imgOk.ok ? `${imgOk.w}×${imgOk.h} ${imgOk.src}` : imgOk.why);

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