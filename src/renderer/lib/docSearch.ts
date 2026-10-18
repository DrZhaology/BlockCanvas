import README_BUNDLED from '../../../README.md?raw';
import MANUAL_BUNDLED from '../../../docs/使用手册.md?raw';
import HISTORY_BUNDLED from '../../../docs/开发历程.md?raw';
import type { IconName } from '../components/Icon';

// BlockCanvas · 三份内置文档的检索索引
//
// 帮助中心（HelpCenter）和首页搜索框（EmptyHome）共用同一套「按标题切段落 → 加权打分」逻辑，
// 这样两处搜出来的结果和排序完全一致，不会出现"首页搜得到、帮助中心搜不到"的割裂感。

export type DocKey = 'intro' | 'manual' | 'history';

export interface DocDef {
  key: DocKey;
  label: string;
  icon: IconName;
  bundled: string;
  fileName: string;
}

export const DOCS: DocDef[] = [
  { key: 'intro', label: '项目介绍', icon: 'home', bundled: README_BUNDLED, fileName: 'README.md' },
  { key: 'manual', label: '使用手册', icon: 'book', bundled: MANUAL_BUNDLED, fileName: 'docs/使用手册.md' },
  { key: 'history', label: '开发历程', icon: 'history', bundled: HISTORY_BUNDLED, fileName: 'docs/开发历程.md' }
];

export interface DocSection {
  doc: DocKey;
  id: string;
  title: string;
  level: number;
  text: string;
}

export interface DocHit {
  doc: DocKey;
  docLabel: string;
  id: string;
  title: string;
  level: number;
  snippet: string;
  score: number;
}

function slugOf(text: string): string {
  return text.replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'sec';
}

/** 标题 id：文档 key + 序号 + 文字 slug（建索引与 DOM 赋值用同一套公式，保证一致） */
export function headingId(doc: DocKey, i: number, text: string): string {
  return `hc-${doc}-${i}-${slugOf(text)}`;
}

/** 把 markdown 按标题切成"段落块"（用于建搜索索引）；先剥掉围栏代码块避免误判标题 */
export function parseSections(md: string, doc: DocKey): DocSection[] {
  const withoutCode = md.replace(/```[\s\S]*?```/g, '');
  const lines = withoutCode.split(/\r?\n/);
  const out: DocSection[] = [];
  let cur: DocSection | null = null;
  let i = 0;
  for (const line of lines) {
    const m = /^(#{1,4})\s+(.*)$/.exec(line);
    if (m) {
      if (cur) out.push(cur);
      const title = m[2].replace(/[*`_]/g, '').trim();
      cur = { doc, id: headingId(doc, i, title), title, level: m[1].length, text: '' };
      i += 1;
    } else if (cur) {
      cur.text += line + '\n';
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 把正文里的 markdown 记号抹掉，做成适合检索/展示的纯文本 */
export function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countOcc(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0, from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    n += 1; from = at + needle.length;
    if (n > 50) break;
  }
  return n;
}

/** 三份文档的完整索引（模块级只建一次，首屏搜索零延迟） */
export const DOC_INDEX: DocSection[] = DOCS.flatMap((d) => parseSections(d.bundled, d.key));

/** 按权重给"段落块"打分并排序 */
export function searchDocs(index: DocSection[], rawQuery: string, limit = 14): DocHit[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const hits: DocHit[] = [];
  for (const s of index) {
    const title = s.title.toLowerCase();
    const body = plain(s.text).toLowerCase();
    let score = 0;
    if (title === q) score += 200;
    if (title.includes(q)) score += 90 - Math.min(60, title.indexOf(q));
    for (const t of tokens) {
      if (t && title.includes(t)) score += 26;
    }
    const occ = countOcc(body, q);
    if (occ > 0) { score += 18 + Math.min(occ, 15) * 6; }
    else if (tokens.every((t) => body.includes(t))) { score += 10; }
    if (score <= 0) continue;
    score += Math.max(0, 6 - s.level) * 4; // 层级越高越优先
    // 摘要：命中词前后各取一段
    const plainBody = plain(s.text);
    const at = plainBody.toLowerCase().indexOf(q);
    const snippet = at >= 0
      ? (at > 18 ? '…' : '') + plainBody.slice(Math.max(0, at - 18), at + q.length + 42).trim() + '…'
      : plainBody.slice(0, 60) + (plainBody.length > 60 ? '…' : '');
    hits.push({
      doc: s.doc,
      docLabel: DOCS.find((d) => d.key === s.doc)!.label,
      id: s.id,
      title: s.title,
      level: s.level,
      snippet,
      score
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
