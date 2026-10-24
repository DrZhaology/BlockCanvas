import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { dataRoot } from './userData';
import { readProject, writeProject, sceneHash } from './projectFile';

// ============================================================================
// BlockCanvas · 会话记忆（session）
// ----------------------------------------------------------------------------
// 老实现的问题（实测）：`session.json` 把**所有打开标签页的整棵场景**塞进一个文件，
// 场景一变就 400ms 防抖整份重写 → 开销 = O(所有标签的总大小)，且用美化 JSON。
// 开着 3 个大页面时，等于每 400ms 往磁盘写 3 个完整工程。
//
// 新实现：**按"数据是不是重复的"拆开存**
//
//   data/session.json          ← 轻量索引：activeTabId + 每个标签的 id/name/filePath/isDirty/hasDraft
//   data/session/<tabId>.bcproj ← **只存"未保存的草稿"**（和工程文件同一个 ZIP 容器格式）
//
// 关键判断：**什么时候需要草稿？**
//   · 标签从未保存过（没有 filePath）           → 需要（磁盘上没有别的地方存它）
//   · 标签有未保存改动（isDirty）               → 需要（磁盘上的 .bcproj 是旧的）
//   · 标签已保存且不脏                          → **不需要**（直接从 .bcproj 读，零冗余）
//
// 于是：已保存的标签**一份数据都不重复存**；只有真正"悬空"的编辑内容才落草稿。
// 写入也变成"只写变化了的那个标签的草稿"（内容哈希去重），而不是每次都写全部。
//
// 兼容：老 session.json（标签里直接带 scene）照样能读；读到就**顺手迁移**成新结构
//      （把 scene 写成草稿文件 + 重写轻量索引），老文件从此不再产生。这段代码长期保留。
// ============================================================================

/** 新版 session.json 的形状（不含场景数据） */
interface SessionIndex {
  schemaVersion: number;
  activeTabId: string | null;
  tabs: {
    id: string;
    name: string;
    filePath: string | null;
    isDirty: boolean;
    /** 是否在 data/session/ 里有一份草稿 */
    hasDraft: boolean;
  }[];
  updatedAt: string;
}

/** 对渲染层暴露的会话形状（与老实现一致，带 scene） */
export interface SessionTab {
  id: string;
  name: string;
  filePath?: string | null;
  isDirty?: boolean;
  scene: any;
  /**
   * v0.4.5：撤销栈（Ctrl+Z / Ctrl+Y 的 past / future）。
   *
   * 为什么放在这里：用户反馈「说了保存最近的 100 个 Ctrl+Z / Ctrl+Y，但重新打开项目
   * 完全无法执行」。查下来 history 确实写进了工程容器（sections.history），
   * 但**会话恢复这条路**（关掉程序再打开）从来没有存过它 —— 会话只存 scene。
   * 现在顺手写进每个标签的草稿容器（同一个 .bcproj 格式的多 section 能力），
   * 读会话时一起装回来。
   */
  history?: { past: any[]; future: any[] };
}
export interface AppSession {
  activeTabId: string | null;
  tabs: SessionTab[];
  updatedAt: string;
}

const SESSION_SCHEMA = 2;

/** 会话草稿里最多保留多少条撤销记录（工程文件里是 100；会话要小一点） */
const SESSION_HISTORY_LIMIT = 20;

/** 撤销栈"指纹"：参与草稿去重哈希，否则只改历史不会触发重写 */
function histFingerprint(h?: { past?: unknown[]; future?: unknown[] }): string {
  return `${h?.past?.length ?? 0}/${h?.future?.length ?? 0}`;
}

function nowIsoSafe(): string {
  try { return new Date().toISOString(); } catch { return ''; }
}

function sessionDir(): string {
  return join(dataRoot(), 'session');
}
function indexPath(): string {
  return join(dataRoot(), 'session.json');
}
function draftPath(tabId: string): string {
  const safe = String(tabId || 'tab').replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(sessionDir(), `${safe}.bcproj`);
}

/** 内存里的"上次草稿哈希"，用于跳过无变化的写盘 */
const lastDraftHash = new Map<string, string>();

function needDraft(tab: { filePath?: string | null; isDirty?: boolean }): boolean {
  return !tab.filePath || !!tab.isDirty;
}

/** 清掉不再需要的草稿（标签已保存 / 已关闭 / 不在会话里了） */
function pruneDrafts(keep: Set<string>): number {
  const dir = sessionDir();
  if (!existsSync(dir)) return 0;
  let n = 0;
  try {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile() || !/\.bcproj$/i.test(f.name)) continue;
      const tabId = f.name.replace(/\.bcproj$/i, '');
      if (keep.has(tabId)) continue;
      try { unlinkSync(join(dir, f.name)); n += 1; lastDraftHash.delete(tabId); } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
  return n;
}

/**
 * 读会话：组装成"带 scene"的完整形状（渲染层契约不变）。
 * 顺序：草稿 > 工程文件 > 空场景。
 */
export function readSession(): AppSession | null {
  const p = indexPath();
  if (!existsSync(p)) return null;
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
  if (!raw || !Array.isArray(raw.tabs)) return null;
  // 空会话（上次退出时关掉了全部标签）→ 原样返回空，让启动端进入「空页面」状态；
  // 文件不存在（首次运行）才返回 null → 启动端补一个默认新标签。
  if (raw.tabs.length === 0) {
    return { activeTabId: null, tabs: [], updatedAt: String(raw.updatedAt || nowIsoSafe()) };
  }

  // —— 老格式（标签里直接带 scene）：顺手迁移 ——
  const isLegacy = raw.tabs.some((t: any) => t && typeof t === 'object' && 'scene' in t);
  if (isLegacy || typeof raw.schemaVersion !== 'number') {
    const legacy: AppSession = {
      activeTabId: raw.activeTabId ?? null,
      tabs: raw.tabs.map((t: any) => ({
        id: t.id,
        name: t.name,
        filePath: t.filePath ?? null,
        isDirty: !!t.isDirty,
        scene: t.scene
      })),
      updatedAt: raw.updatedAt || new Date().toISOString()
    };
    try { writeSession({ activeTabId: legacy.activeTabId, tabs: legacy.tabs }); } catch { /* 忽略 */ }
    return legacy;
  }

  // —— 新格式：索引 + 按需读草稿/工程文件 ——
  const tabs: SessionTab[] = raw.tabs.map((t: any) => {
    let scene: any = null;
    let history: SessionTab['history'];
    if (t.hasDraft) {
      const r = readProject(draftPath(t.id));
      if (r.ok && r.payload) {
        scene = r.payload.scene;
        history = (r.payload as any)?.extraSections?.history;
      }
    }
    if (scene == null && t.filePath && existsSync(t.filePath)) {
      const r = readProject(t.filePath);
      if (r.ok && r.payload) {
        scene = r.payload.scene;
        // 工程文件里也带着 history（sections.history）—— 已保存且不脏的标签从这儿恢复
        history = (r.payload as any)?.extraSections?.history;
      }
    }
    const h = history && Array.isArray(history.past)
      ? { past: history.past, future: Array.isArray(history.future) ? history.future : [] }
      : undefined;
    return { id: t.id, name: t.name, filePath: t.filePath ?? null, isDirty: !!t.isDirty, scene, ...(h ? { history: h } : {}) };
  });

  return { activeTabId: raw.activeTabId ?? null, tabs, updatedAt: raw.updatedAt || new Date().toISOString() };
}

/**
 * 写会话：轻量索引 + **只写变化了的草稿**。
 * 返回 true 表示索引写入成功（草稿失败不影响整体，下次会重试）。
 */
export function writeSession(session: { activeTabId: string | null; tabs: SessionTab[] }): boolean {
  const tabs = Array.isArray(session?.tabs) ? session.tabs : [];
  const keep = new Set<string>();
  const indexTabs: SessionIndex['tabs'] = [];

  for (const t of tabs) {
    if (!t || !t.id) continue;
    const wants = needDraft(t) && !!t.scene;
    let hasDraft = false;

    if (wants) {
      keep.add(t.id);
      const haveHist = Array.isArray(t.history?.past) && t.history!.past!.length > 0;
      // 哈希里带上撤销栈的指纹：否则"只改动历史"不会触发草稿重写（历史就悄悄丢了）
      const h = sceneHash(t.scene) + '|' + histFingerprint(t.history);
      if (lastDraftHash.get(t.id) !== h || !existsSync(draftPath(t.id))) {
        const sections = haveHist
          ? {
              history: {
                savedAt: nowIsoSafe(),
                limit: SESSION_HISTORY_LIMIT,
                past: (t.history!.past || []).slice(-SESSION_HISTORY_LIMIT),
                future: (t.history!.future || []).slice(0, SESSION_HISTORY_LIMIT)
              }
            }
          : undefined;
        const w = writeProject(draftPath(t.id), {
          name: t.name || '未命名网页',
          scene: t.scene,
          meta: { kind: 'session-draft', tabId: t.id, projectName: t.name || '' },
          ...(sections ? { sections } : {})
        });
        hasDraft = !!w.ok;
        if (w.ok) lastDraftHash.set(t.id, h);
      } else {
        hasDraft = true;   // 内容没变，已有草稿仍有效
      }
    }

    indexTabs.push({
      id: t.id,
      name: t.name || '未命名网页',
      filePath: t.filePath ?? null,
      isDirty: !!t.isDirty,
      hasDraft
    });
  }

  // 清掉不再需要的草稿（已保存 / 已关闭的标签）
  pruneDrafts(keep);

  const payload: SessionIndex = {
    schemaVersion: SESSION_SCHEMA,
    activeTabId: session?.activeTabId ?? null,
    tabs: indexTabs,
    updatedAt: new Date().toISOString()
  };

  try {
    mkdirSync(dataRoot(), { recursive: true });
    // 索引是机器读的，紧凑输出（去掉缩进）
    writeFileSync(indexPath(), JSON.stringify(payload), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** 会话草稿目录当前占用（给存储面板统计用） */
export function sessionDraftBytes(): number {
  const dir = sessionDir();
  if (!existsSync(dir)) return 0;
  let total = 0;
  try {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      try { total += readFileSync(join(dir, f.name)).length; } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
  return total;
}

/** 清空所有会话草稿（存储面板"清理"用；不会删 session.json 索引） */
export function clearSessionDrafts(): number {
  const dir = sessionDir();
  if (!existsSync(dir)) return 0;
  let freed = 0;
  try {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const full = join(dir, f.name);
      try { freed += readFileSync(full).length; unlinkSync(full); } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
  lastDraftHash.clear();
  return freed;
}
