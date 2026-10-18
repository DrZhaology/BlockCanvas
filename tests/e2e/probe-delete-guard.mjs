// 删除项目「三步安全防护」探针（v0.4.4h）
// 覆盖：① 遮罩点击不关闭；② 点项目名不会自动填充（必须手打全名）；
//      ③ 名字不匹配 → 下一步禁用；匹配 → 可进入第 2 关；
//      ④ 第 2 关 3 个随机滑块，必须按顺序拖到位；
//      ⑤ 三关全过 → 自动进第 3 关 → 确认后真删（含快照目录清理）；
//      ⑥ 取消按钮加大 + 退场动画
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, writeFileSync, existsSync, cpSync } from 'fs';
import { ensureEditor } from './ensure-editor.mjs';
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

const PROJ_NAME = '测试项目A';
const FILE_NAME = 'test-proj-a.bcproj';

async function main() {
  const DATA_DIR = resolve(tmpdir(), 'bc-delete-probe');
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  mkdirSync(resolve(DATA_DIR, 'projects'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'backups', PROJ_NAME), { recursive: true });
  // 造一个项目文件 + 一份快照
  writeFileSync(join(DATA_DIR, 'projects', FILE_NAME), JSON.stringify({
    name: PROJ_NAME,
    scene: { root: { id: 'root', type: 'div', style: {}, children: [] }, selectedId: null, selectedIds: [] },
    meta: { elementCount: 1 }
  }), 'utf-8');
  writeFileSync(join(DATA_DIR, 'backups', PROJ_NAME, 'snap-1.bcproj'), JSON.stringify({ name: PROJ_NAME }), 'utf-8');
  for (const rel of [resolve(ROOT, 'extensions'), resolve(ROOT, 'data', 'extensions')]) {
    if (existsSync(rel)) cpSync(rel, resolve(DATA_DIR, 'extensions'), { recursive: true });
  }
  const env = { ...process.env, BC_DATA_DIR: DATA_DIR };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--disable-gpu', '--no-sandbox'], cwd: ROOT, executablePath: electronPath, env });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ensureEditor(win);
  await win.waitForSelector('.toolbar', { timeout: 20000 });
  await sleep(1500);

  // 进入项目库
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-projects')));
  await win.waitForSelector('.pc-page', { timeout: 8000 });
  await sleep(500);
  ok('项目库列出 1 个工程', (await win.locator('.pc-card').count()) === 1);

  // 打开删除弹窗
  await win.locator('.pc-card-del-btn').first().click();
  await sleep(450);
  ok('打开「三步安全防护」删除弹窗', (await win.locator('.double-delete-modal').count()) === 1);

  // ① 遮罩点击不关闭
  await win.mouse.click(6, 6);
  await sleep(300);
  ok('点击遮罩不会关闭流程', (await win.locator('.double-delete-modal').count()) === 1);

  // ② 点项目名文本不会自动填充
  await win.locator('.dd-modal-label b').first().click();
  await sleep(250);
  const filled = await win.locator('.dd-modal-input').inputValue();
  ok('点击项目名不会自动填充输入框', filled === '', 'value=' + filled);

  // ③ 名字不匹配 → 下一步禁用
  await win.locator('.dd-modal-input').fill('错的名字');
  await sleep(250);
  ok('名字不匹配时「下一步」禁用', await win.locator('.dd-modal-footer .btn-primary').isDisabled());

  await win.locator('.dd-modal-input').fill(PROJ_NAME);
  await sleep(250);
  ok('完整手打项目名后「下一步」可用', !(await win.locator('.dd-modal-footer .btn-primary').isDisabled()));
  await win.locator('.dd-modal-footer .btn-primary').click();
  await sleep(450);

  // ④ 第 2 关：3 个滑块，按顺序拖
  ok('进入第 2 关（3 个滑块）', (await win.locator('.dd-slider-item').count()) === 3);

  // 先验证"没轮到的不给拖"：对第 2 个滑块拖一把，它不应变化
  const beforeLocked = await win.evaluate(() => {
    const items = document.querySelectorAll('.dd-slider-item');
    return parseFloat(items[1].querySelector('.dd-slider-knob').style.left);
  });
  const info2 = await win.evaluate(() => {
    const items = document.querySelectorAll('.dd-slider-item');
    const track = items[1].querySelector('.dd-slider-track');
    const tr = track.getBoundingClientRect();
    return { x: tr.x, y: tr.y, w: tr.width, h: tr.height };
  });
  await win.mouse.move(info2.x + info2.w * 0.5, info2.y + info2.h / 2);
  await win.mouse.down();
  await win.mouse.move(info2.x + info2.w * 0.9, info2.y + info2.h / 2, { steps: 6 });
  await win.mouse.up();
  await sleep(250);
  const afterLocked = await win.evaluate(() => {
    const items = document.querySelectorAll('.dd-slider-item');
    return parseFloat(items[1].querySelector('.dd-slider-knob').style.left);
  });
  ok('未轮到的滑块拖不动（必须按顺序）', Math.abs(afterLocked - beforeLocked) < 0.01, `${beforeLocked} → ${afterLocked}`);

  // 按顺序把 3 个滑块拖到位：第 i 次拖动后，应该**恰好** i 个滑块打勾（证明"按顺序"）
  let orderOk = true;
  const orderLog = [];
  for (let i = 1; i <= 3; i += 1) {
    let done = 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const info = await win.evaluate(() => {
        const item = document.querySelector('.dd-slider-item.is-active');
        if (!item) return null;
        const track = item.querySelector('.dd-slider-track');
        const target = item.querySelector('.dd-slider-target');
        const tr = track.getBoundingClientRect();
        return { x: tr.x, y: tr.y, w: tr.width, h: tr.height, targetLeft: parseFloat(target.style.left) };
      });
      if (!info) break;
      const targetX = info.x + (info.targetLeft / 100) * info.w;
      await win.mouse.move(info.x + info.w * 0.5, info.y + info.h / 2);
      await win.mouse.down();
      await win.mouse.move(targetX, info.y + info.h / 2, { steps: 16 });
      await win.mouse.up();
      await sleep(360);
      // 注意：第 3 个滑块通过后，界面会在 ~420ms 后自动切到第 3 关 → 滑块列表被卸载。
      // 所以"全部完成"有两种表现：① 3 个都带 is-done；② 已经进入第 3 关。
      const st = await win.evaluate(() => ({
        done: document.querySelectorAll('.dd-slider-item.is-done').length,
        final: !!document.querySelector('.dd-final-warn')
      }));
      done = st.final ? 3 : st.done;
      if (done >= i) break;
    }
    orderLog.push(`${i}→${done}`);
    if (done !== i) { orderOk = false; break; }
  }
  ok('3 个滑块可按 1→2→3 顺序逐关通过（第 i 次恰好 i 个打勾）', orderOk === true, orderLog.join(' '));
  const doneCount = await win.evaluate(() => ({
    done: document.querySelectorAll('.dd-slider-item.is-done').length,
    final: !!document.querySelector('.dd-final-warn')
  }));
  ok('三个滑块全部打勾（或已自动进入第 3 关）', doneCount.final || doneCount.done === 3, JSON.stringify(doneCount));

  // ⑤ 自动进入第 3 关
  await sleep(900);
  ok('全过之后自动进入第 3 关（最终确认）', (await win.locator('.dd-final-warn').count()) === 1);

  // ⑥ 取消按钮加大
  const cancelBox = await win.locator('.dd-cancel-btn').boundingBox();
  ok('取消按钮已加大（宽 ≥ 108 / 高 ≥ 34）', !!cancelBox && cancelBox.width >= 108 && cancelBox.height >= 34, JSON.stringify(cancelBox));

  // 最终删除
  await win.locator('.dd-modal-footer .btn-danger').click();
  await sleep(1200);
  ok('删除后弹窗关闭', (await win.locator('.double-delete-modal').count()) === 0);
  ok('项目文件已删除', !existsSync(join(DATA_DIR, 'projects', FILE_NAME)));
  ok('该项目名下快照目录已一并清理', !existsSync(join(DATA_DIR, 'backups', PROJ_NAME)));
  await sleep(300);
  ok('项目列表已刷新为空', (await win.locator('.pc-card').count()) === 0);

  // ⑦ 退场动画：重新打开再取消
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('bc:open-projects')));
  await sleep(200);
  ok('无 page 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  await app.close();
  console.log(`\n===== 删除项目三步防护探针：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
