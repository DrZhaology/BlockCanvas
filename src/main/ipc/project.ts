// BlockCanvas · 工程与备份 IPC（project:* / session:* / backup:*）
//
// 这一层管三件与"数据不丢"直接相关的事：
//   ① 工程文件 CRUD（列表 / 保存 / 打开 / 改名 / 删除 / 抢救）
//   ② 会话记忆（关掉程序再打开，标签页与草稿还在）
//   ③ 备份与自动保存（工程级快照 + 崩溃恢复）
//
// 四条必须保留的语义：
//   1. **保存是原子替换**：先写临时文件再 rename，中途崩溃不会留下半个工程；
//   2. **删除工程只删数据不动备份**（备份另有清理入口，用户可能想抢救）；
//   3. **改名只改文件名，不改容器里的项目名** —— 项目名（标签页标题）与文件名是两件事；
//   4. **会话写入要轻**：它每几秒就可能写一次，不能走工程那套重流程。
import { app, ipcMain } from 'electron';
import { join } from 'node:path';
import { existsSync, unlinkSync, statSync, renameSync, readdirSync } from 'node:fs';
import {
  dataRoot, listProjects, listProjectBackups, saveProjectSnapshotFile, deleteProjectBackupFolder,
  forgetExternalProject, readAppConfig, registerExternalProject
} from '../userData';
import { readSession, writeSession } from '../session';
import { readProject, writeProject, readManifestOnly } from '../projectFile';
import * as projectFileApi from '../projectFile';
import { collectSceneAssets, extractProjectAssets, listAssetCache, importAssetToCache } from '../assets';
import { probeCodec, codecAdvice } from '../codecProbe';
import { isAbsolutePathAny } from '../paths';
import { showOpenDialog, showSaveDialog } from './context';
import { emitLoad } from '../main';

/** 工程名 → 安全文件名：**保留中文**，只剔除 Windows 非法字符 */
function safeFileName(s: string): string {
  return (s || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80);
}

/**
 * 统计节点数（**含根节点**）。
 *
 * ⚠ 这里刻意不"减 1 去掉根"：工程元数据里的 elementCount 从 v1 起就是这么算的，
 * 探针与项目列表都以它为准（改成净元素数会让所有历史工程的数量突然差 1）。
 */
function countNodes(node: unknown): number {
  let n = 0;
  const walk = (x: unknown) => {
    if (!x || typeof x !== 'object') return;
    n += 1;
    const kids = (x as { children?: unknown[] }).children;
    if (Array.isArray(kids)) for (const k of kids) walk(k);
  };
  walk(node);
  return n;
}



export function registerProjectIpc(): void {
  ipcMain.handle('project:list', () => listProjects());

  // v0.4.5：把某个外部工程从列表里移除（不动磁盘文件）
  ipcMain.handle('project:forget-external', (_evt, filePath: string) => forgetExternalProject(filePath));

  // v0.4.5：素材库（图库面板）—— 列出缓存里的素材 / 导入新素材
  ipcMain.handle('assets:list', () => listAssetCache());

  /**
   * v0.4.6（R6-18）：媒体编码探测 —— 挂载 `<video>` **之前**先问一句"这个编码现在能解吗"。
   *
   * 为什么需要：Chromium 遇到不带的编码（HEVC / 杜比视界 / 10bit H.264）会打
   * `ffmpeg_common.cc Unsupported pixel format: -1` 并白屏。那条日志来自**原生解码器**，
   * JS 侧屏蔽不了 —— 唯一能"根治"的办法就是别让它有机会尝试：先读容器头，
   * 确定解不了就根本不挂 <video>。
   *
   * 返回 result = 'unknown' 时（读不出来 / 不是 MP4/WebM）调用方应当**照常尝试播放**，
   * 绝不能因为探测失败就误杀一个正常视频。
   */
  ipcMain.handle('media:probe-codec', (_evt, filePath: string) => {
    try {
      const raw = decodeURIComponent(String(filePath ?? '')).replace(/^bc-img:\/\/file\//i, '');
      let p = raw;
      if (!isAbsolutePathAny(p)) {
        const clean = p.replace(/^\.?\/+/, '');
        const cands = [join(dataRoot(), 'projects', clean), join(dataRoot(), clean), join(app.getAppPath(), clean)];
        for (const c of cands) if (existsSync(c)) { p = c; break; }
      }
      const ext = (p.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
      const r = probeCodec(p, ext);
      return { ok: true, ...r, advice: r.result === 'unsupported' ? codecAdvice(r.codecs) : '' };
    } catch (e) {
      // 探测本身失败永远不该阻塞播放
      return { ok: false, result: 'unknown', codecs: [], advice: '', error: String(e) };
    }
  });

  ipcMain.handle('assets:import', async () => {
    const res = await showOpenDialog({
      title: '导入素材',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'] },
        { name: '视频', extensions: ['mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v'] },
        { name: '音频', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'opus'] }
      ]
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
    const items = res.filePaths.map((p) => importAssetToCache(p)).filter(Boolean);
    return { ok: true, items };
  });

  ipcMain.handle('project:salvage', (_evt, filePath: string) => projectFileApi.salvageProject(filePath));

  /**
   * 工程名 → 安全文件名：**保留中文等 Unicode 字符**，只剔除 Windows 文件名的非法字符。
   * （修复：以前用 sanitizeId 只留 a-z0-9，中文名整个被清空 → 首次保存弹出的默认文件名
   *   永远是 "project.bcproj"。文件名不是元素 ID，就该让"演示站点"存成"演示站点.bcproj"。）
   */
  function safeFileName(s: string): string {
    return (s || '')
      .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')   // Windows 非法字符 → 空格
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')        // 首尾的点/空格（Windows 不允许结尾带点）
      .slice(0, 80);
  }

  // 重命名工程文件（项目中心里的"改文件名"）：只改磁盘文件名，**不改**容器内的项目名
  // —— 项目名（标签页）与文件名是两个东西，分开管理（用户口径）。
  ipcMain.handle('project:rename', async (_evt, oldFileName: string, newName: string) => {
    try {
      const base = safeFileName(String(newName || '').replace(/\.bcproj$/i, ''));
      if (!base) return { ok: false, error: '文件名无效' };
      const dir = join(dataRoot(), 'projects');
      const from = join(dir, oldFileName);
      const to = join(dir, `${base}.bcproj`);
      if (!existsSync(from)) return { ok: false, error: '找不到工程文件' };
      if (to !== from && existsSync(to)) return { ok: false, error: '同名文件已存在' };
      renameSync(from, to);
      return { ok: true, fileName: `${base}.bcproj`, path: to };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('project:save', async (_evt, projectData: { name?: string; scene: any; meta?: any }, saveAs = false, customPath?: string) => {
    try {
      const pName = (projectData.name || '未命名网页').trim();
      const cleanName = safeFileName(pName) || 'project';
      const defaultFullDir = join(dataRoot(), 'projects');
      let targetPath = customPath;

      if (!targetPath) {
        if (saveAs) {
          // 关键修复：默认路径传入完整绝对路径，文件选择器自动跳转定位至 BlockCanvas\data\projects\
          const res = await showSaveDialog({
            title: '保存项目工程文件 (.bcproj)',
            defaultPath: join(defaultFullDir, `${cleanName}.bcproj`),
            filters: [{ name: 'BlockCanvas 工程文件', extensions: ['bcproj', 'json'] }]
          });
          if (res.canceled || !res.filePath) return { ok: false, canceled: true };
          targetPath = res.filePath;
        } else {
          // 默认存进 data/projects/
          targetPath = join(defaultFullDir, `${cleanName}.bcproj`);
        }
      }

      // 撤销历史随工程保存（v0.4.4）：sections.history = { past, future }，条数受
      // config.undoHistoryLimit 控制（默认 100，设 0 = 不保存）。ZIP 容器的多 section
      // 能力在这里派上用场：老版本程序读到不认识的 section 会忽略但保留，不会丢数据。
      const sections: Record<string, unknown> = {};
      try {
        const limit = Math.max(0, Math.floor(Number(readAppConfig().undoHistoryLimit ?? 100) || 0));
        const h = (projectData as any).history;
        if (limit > 0 && h && Array.isArray(h.past) && h.past.length > 0) {
          sections.history = {
            savedAt: new Date().toISOString(),
            limit,
            past: h.past.slice(-limit),
            future: (Array.isArray(h.future) ? h.future : []).slice(0, Math.min(limit, 50))
          };
        }
      } catch { /* 历史保存失败不影响工程保存 */ }

      // v0.4.5：素材打包 —— 把场景里 bc-img://file/<本地路径> 引用的文件读进容器
      // （assets/<sha1>.<ext>），并把引用改写成 bc-img://asset/<hash>.<ext>。
      // 这样工程换机器/换目录打开也不会丢图。
      let sceneToSave = projectData.scene;
      let collectedAssets: { name: string; data: Buffer; mime?: string }[] = [];
      let missingAssets: string[] = [];
      try {
        const collected = collectSceneAssets(projectData.scene);
        sceneToSave = collected.scene;
        collectedAssets = collected.assets;
        missingAssets = collected.missing;
      } catch { /* 收集失败就按原样保存，至少不丢工程 */ }

      // v2：写 ZIP 容器（manifest.json + scene.json + assets/），原子替换、自动继承 createdAt
      const w = writeProject(targetPath, {
        name: pName,
        scene: sceneToSave,
        meta: {
          ...(projectData.meta || {}),
          elementCount: countNodes(projectData.scene?.root)
        },
        assets: collectedAssets,
        sections
      });
      if (!w.ok) return { ok: false, error: w.error || '写入工程文件失败' };
      return {
        ok: true,
        path: targetPath,
        name: pName,
        assets: collectedAssets.length,
        missingAssets
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('project:open-file', async (_evt, customPath?: string) => {
    const loadId = 'open-' + Date.now().toString(36);
    try {
      let targetPath = customPath;
      if (!targetPath) {
        const res = await showOpenDialog({
          title: '打开项目工程文件',
          defaultPath: join(dataRoot(), 'projects'),
          properties: ['openFile'],
          filters: [{ name: 'BlockCanvas 工程文件', extensions: ['bcproj', 'json'] }]
        });
        if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
        targetPath = res.filePaths[0];
      }
      if (!existsSync(targetPath)) return { ok: false, error: '文件不存在' };
      // —— 真实进度播报（启动加载页用；每一步都是真的做完了才报）——
      emitLoad(loadId, '正在读取工程文件…', 8);
      // v1（纯 JSON）与 v2（ZIP 容器）都能读
      const r = readProject(targetPath);
      if (!r.ok || !r.payload) return { ok: false, error: r.error || '文件不是有效的 BlockCanvas 工程文件' };
      emitLoad(loadId, '正在解析场景…', 34);
      // v0.4.5：把容器里的 assets/ 解到缓存目录，`bc-img://asset/...` 才有东西可服务
      let extracted = 0;
      try {
        const assetCount = (r.payload as unknown as { assets?: unknown[] }).assets?.length ?? 0;
        extracted = extractProjectAssets(targetPath, r.payload, (done, total) => {
          // 素材解包占 34% → 92% 这一段
          const span = total > 0 ? done / total : 1;
          emitLoad(loadId, `正在准备素材 ${done}/${total || assetCount}…`, 34 + span * 58);
        });
      } catch { /* 解包失败不阻断打开 */ }
      emitLoad(loadId, '正在登记到项目列表…', 95);
      // v0.4.5：从 data/projects 以外打开的工程登记进项目列表（否则用户在列表里找不到它）
      try { registerExternalProject(targetPath, r.payload.name); } catch { /* 登记失败不影响打开 */ }
      emitLoad(loadId, '即将进入编辑界面…', 100);
      return {
        ok: true, project: r.payload, path: targetPath, container: r.container,
        extractedAssets: extracted,
        loadId,
        // 随工程保存的撤销历史（老工程没有这一节 → undefined）
        history: (r.payload as any)?.extraSections?.history
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('project:delete', async (_evt, fileName: string, projectName?: string) => {
    try {
      const full = join(dataRoot(), 'projects', fileName);
      let innerName = '';
      if (existsSync(full)) {
        // 容器或旧 JSON 都能取到内部 name（只读 manifest，不解 scene）
        const m = readManifestOnly(full);
        innerName = m.ok && m.manifest ? m.manifest.name : '';
        unlinkSync(full);
      }
      // 1. 按文件名清理对应快照目录
      const fBase = fileName.replace(/\.bcproj$/i, '');
      deleteProjectBackupFolder(fBase);
      // 2. 按项目内部 name 清理对应快照目录
      if (innerName && innerName !== fBase) {
        deleteProjectBackupFolder(innerName);
      }
      // 3. 按前端传入的 projectName 清理
      if (projectName && projectName !== fBase && projectName !== innerName) {
        deleteProjectBackupFolder(projectName);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('session:get', () => readSession());
  ipcMain.handle('session:set', (_evt, sessionData: any) => writeSession(sessionData));

  // ============ 自动备份与崩溃恢复 (按项目隔离专属快照) ============
  ipcMain.handle('backup:save-snapshot', async (_evt, scene: any, projectName?: string, isAuto = true) => {
    try {
      const time = saveProjectSnapshotFile(scene, projectName, isAuto);
      return { ok: true, timestamp: time };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('backup:get-autosave', (_evt, projectName?: string) => {
    try {
      const folder = (projectName || '_general').trim().replace(/[\\/:*?"<>|]+/g, '_');
      const f = join(dataRoot(), 'backups', folder, 'autosave.bcproj');
      if (!existsSync(f)) return { ok: false };
      const r = readProject(f);
      if (!r.ok || !r.payload) return { ok: false };
      const stat = statSync(f);
      return { ok: true, autosave: r.payload, updatedAt: stat.mtime.toISOString(), elementCount: countNodes((r.payload.scene as any)?.root) };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('backup:list', (_evt, projectName?: string) => listProjectBackups(projectName));

  ipcMain.handle('backup:clear-all', async () => {
    try {
      const bDir = join(dataRoot(), 'backups');
      if (existsSync(bDir)) {
        for (const f of readdirSync(bDir)) {
          try { unlinkSync(join(bDir, f)); } catch {}
        }
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}

/** 供其它模块复用：工程名 → 合法文件名 */
export { safeFileName, countNodes };
