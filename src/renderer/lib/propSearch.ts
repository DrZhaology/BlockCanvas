import type { PropertySchema } from './propertySchema';

// BlockCanvas · 属性名"模糊搜索"（v0.4.4g）
// 用于画布上的"中键搜索"：敲属性名（支持拼错、只敲前几个字母、拼音缩写）→ 找到最匹配的 CSS 属性。
// 打分：精确 > 前缀 > 包含 > 连字符形式 > 别名 > 编辑距离（容错）> 子序列。

/** Levenshtein 编辑距离（容错"拼错"） */
function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const norm = (s: string): string => s.toLowerCase().replace(/[\s()_\-]/g, '');

/** 子序列匹配：q 的字符按顺序出现在 s 里（"fsc" 能匹配 "fontsize"） */
function isSubseq(s: string, q: string): boolean {
  if (!q) return false;
  let i = 0;
  for (const ch of s) {
    if (ch === q[i]) i += 1;
    if (i >= q.length) return true;
  }
  return false;
}

export interface PropHit { item: PropertySchema; score: number }

export function searchProperties(items: PropertySchema[], query: string): PropHit[] {
  const q = norm(query);
  if (!q) return [];
  const out: PropHit[] = [];
  for (const it of items) {
    const key = norm(it.key);
    const label = norm(it.label);
    const dashed = norm(it.key.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase()));
    let score = 0;
    if (key === q || label === q) score = 1000;
    else if (key.startsWith(q)) score = 800;
    else if (label.startsWith(q)) score = 760;
    else if (label.includes(q)) score = 640;
    else if (key.includes(q) || dashed.includes(q)) score = 600;
    else {
      const dk = lev(key, q);
      const dl = lev(label, q);
      const best = Math.min(dk, dl);
      const tol = Math.max(1, Math.floor(q.length / 3));
      if (best <= tol) score = 460 - best * 70;
      else if (isSubseq(key, q)) score = 260;
      else if (isSubseq(label, q)) score = 220;
    }
    if (score > 0) out.push({ item: it, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
