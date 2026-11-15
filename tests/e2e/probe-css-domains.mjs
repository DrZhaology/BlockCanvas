// v0.4.6 · CSS 域约束探针（R6-3）
//
// 背景：样式分片以前按「哪一批加的」命名（13-polish-v040 / 27-v045-ui…），
// 后果是 v0.4.5 真实踩过的坑 —— 同一条「中键搜索」样式散在 23/24/27/28 四个文件里，
// 改完 28 忘了 27 还留着旧规则，最后靠"断言时排除注释行"才勉强写对探针。
//
// 本版不做一次性大搬迁（34 个文件 1.5 万行，搬完无法保证视觉零变化），
// 而是建立**可自动检查的约束**：
//   ① 每个分片必须登记主域（styles/domains.ts 的 DOMAIN_OF）—— 新增分片忘登记会红；
//   ② 同一选择器出现在**多个分片**里 = 冲突，直接报出来（不用人眼翻 1.5 万行）；
//   ③ 有辨识度前缀的选择器不许跑到别的域（.eh- 只在空首页、.tbl- 只在表格…）。
//
// 用法：node tests/e2e/probe-css-domains.mjs
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const CSS_DIR = join(ROOT, 'src/renderer/styles');
let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  → ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}  [${detail ?? ''}]`); }
};

/** 从 domains.ts 里解析 DOMAIN_OF（避免在探针里跑 TS） */
function readDomains() {
  const src = readFileSync(join(CSS_DIR, 'domains.ts'), 'utf-8');
  const start = src.indexOf('export const DOMAIN_OF');
  const end = src.indexOf('} as const;', start);
  const body = src.slice(start, end);
  const map = {};
  for (const m of body.matchAll(/'([^']+\.css)':\s*'([^']+)'/g)) map[m[1]] = m[2];
  return map;
}

/** 从 domains.ts 里解析 DOMAIN_PREFIXES */
function readPrefixes() {
  const src = readFileSync(join(CSS_DIR, 'domains.ts'), 'utf-8');
  const start = src.indexOf('export const DOMAIN_PREFIXES');
  const end = src.indexOf('\n};', start);
  const body = src.slice(start, end);
  const map = {};
  for (const m of body.matchAll(/'([^']+)':\s*\[([^\]]*)\]/g)) {
    map[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  return map;
}

/** 去掉注释（块注释 + 行注释），避免把注释里的选择器当真实规则 */
function stripComments(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * 提取顶层选择器（逗号分隔的每个都算），忽略 @media/@keyframes 内部。
 *
 * 做法：按 `{` 配对扫，只处理"花括号深度为 0"处的选择器。
 * @media 里的规则也提取（它们同样会冲突），但要跳过 @keyframes 的百分比选择器。
 */
function extractSelectors(css) {
  const out = [];
  let depth = 0;
  let buf = '';
  let inKeyframes = 0;
  const src = stripComments(css);
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      const sel = buf.trim();
      if (sel.startsWith('@keyframes') || sel.startsWith('@-webkit-keyframes')) {
        inKeyframes += 1;
      } else if (depth === 0 || inKeyframes === 0) {
        if (sel && !sel.startsWith('@')) {
          for (const part of sel.split(',')) {
            const s = part.trim().replace(/\s+/g, ' ');
            // 跳过 @keyframes 里的 0%/100%/from/to
            if (!s || /^(\d+%|from|to)$/.test(s)) continue;
            // group = 这条规则所在的整组选择器（用于判断"是不是性能分组这类跨域组合"）
            out.push({ sel: s, group: sel.split(',').map((x) => x.trim()).filter(Boolean) });
          }
        }
      }
      depth += 1;
      buf = '';
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && inKeyframes > 0) inKeyframes = Math.max(0, inKeyframes - 1);
      buf = '';
      continue;
    }
    buf += ch;
  }
  return out;
}

function main() {
  const files = readdirSync(CSS_DIR).filter((f) => f.endsWith('.css')).sort();
  const domains = readDomains();
  const prefixes = readPrefixes();

  check('分片数量与登记表一致', files.length === Object.keys(domains).length,
    `${files.length} 个文件 / ${Object.keys(domains).length} 条登记`);

  // ① 每个分片都登记了主域
  const unregistered = files.filter((f) => !domains[f]);
  check('每个分片都登记了主域（新增分片时别忘改 styles/domains.ts）',
    unregistered.length === 0, unregistered.join(', '));

  const stale = Object.keys(domains).filter((f) => !existsSync(join(CSS_DIR, f)));
  check('登记表里没有已删除的分片（防止表越攒越旧）',
    stale.length === 0, stale.join(', '));

  // ② 同一选择器跨文件出现 = 冲突
  const owner = new Map();     // selector → [files]
  for (const f of files) {
    const css = readFileSync(join(CSS_DIR, f), 'utf-8');
    for (const { sel } of extractSelectors(css)) {
      if (!owner.has(sel)) owner.set(sel, new Set());
      owner.get(sel).add(f);
    }
  }
  const conflicts = [...owner.entries()]
    .filter(([, set]) => set.size > 1)
    // 同一个域内的重复不算冲突（搬迁是渐进的），跨域才算
    .filter(([, set]) => new Set([...set].map((f) => domains[f])).size > 1)
    .map(([sel, set]) => ({ sel, files: [...set] }));

  /**
   * 跨域重复分两类，只有一类是真问题：
   *   · **真冲突**：同一个选择器在两个域里各写了一遍完整规则（v0.4.5 的中键搜索样式就是这种，
   *     改一处忘一处）。
   *   · **性能分组**：29-v045-perf.css 里刻意把多域选择器写成同一个逗号组做 will-change /
   *     transition 优化（`.pc-card, .token-row, .eh-saved-item { … }`）—— 这是设计，不是错误。
   * 这里只报前者：真冲突的数一下"这个选择器在两个域里有几个不同的声明块"。
   */
  const realConflicts = conflicts.filter((c) => {
    const perfLike = c.files.filter((f) => f.includes('perf'));
    if (perfLike.length === 0) return true;               // 没有 perf 参与 → 真冲突
    // 有 perf 参与：如果其余文件都属于同一个域，视为"性能分组引用"，不算冲突
    const others = c.files.filter((f) => !f.includes('perf'));
    return others.length > 1 && new Set(others.map((f) => domains[f])).size > 1;
  });

  /**
   * ⚠ v0.4.6 定稿：**这一条是"记账"，不是"必须清零"**。
   *
   * 217 条跨域重复是历史遗留（同一个选择器在多个文件里各写一遍）。合并它们必须逐条判断
   * "后声明的哪些属性是修正、哪些是遗留"，而**探针查不出视觉变化**（"颜色淡了一点"
   * 这类只能人眼）。所以本轮的取舍是：
   *   · 把约束**建立起来**（主域登记 + 前缀归位 + 冲突可检测）→ 已完成；
   *   · 实际合并留到有足够视觉验收预算时做（见 docs 的 R6-3 后续）。
   *
   * 这里保留成一条"计数断言"：只要求**数量不再增长**（防止有人新增重复），
   * 并把当前值钉在 BASELINE。要降就得真的去合并，而不是悄悄放宽。
   */
  // v0.4.6 竖屏：+2（36 号分片新增 `.app[data-shell='stack'] .elem-pane-wrap` /
  // `.right-pane-wrap` 的抽屉几何覆盖，以及 `.app[data-shell='stack'] .pt-bar2 .toolbar`
  // 的层级归零）。这两条都是"竖屏要盖掉桌面写法"，合并会牵动宽屏回归，先记账。
  const BASELINE = 219;
  check(`跨域重复选择器不超过基线（当前 ${realConflicts.length} / 基线 ${BASELINE}）`,
    realConflicts.length <= BASELINE,
    realConflicts.length > BASELINE
      ? `新增了 ${realConflicts.length - BASELINE} 条：` + realConflicts.slice(0, 3).map((c) => `${c.sel} → ${c.files.join(' + ')}`).join(' | ')
      : `${owner.size} 个唯一选择器；${conflicts.length - realConflicts.length} 处性能分组引用`);
  if (realConflicts.length > 0) {
    console.log(`      （注：${realConflicts.length} 条历史重复待合并，本版只保证不再增长）`);
  }

  // ③ 有辨识度前缀的选择器不许跑错域
  const misplaced = [];
  for (const [prefix, domain] of Object.entries(prefixes).flatMap(([d, list]) => list.map((p) => [p, d]))) {
    for (const f of files) {
      if (domains[f] === domain) continue;
      const css = readFileSync(join(CSS_DIR, f), 'utf-8');
      for (const { sel, group } of extractSelectors(css)) {
        if (!sel.startsWith(prefix)) continue;
        /**
         * 只看"整组都带这个前缀"的情况。
         *
         * 为什么：性能域会刻意把多域选择器写进同一个逗号组
         * （`.pc-card, .token-row, .eh-saved-item { transition: … }`），
         * 那是分组优化；只有"整个规则都是空首页专属选择器却放在性能文件里"
         * 才是真的放错了地方。
         */
        const allSame = group.every((g) => g.startsWith(prefix) || g.startsWith('.empty-home'));
        if (allSame) misplaced.push({ sel, file: f, shouldBe: domain });
      }
    }
  }
  check('有辨识度前缀的选择器都在自己的域里（.eh- / .tbl- / .help- / .fluent- …）',
    misplaced.length === 0,
    misplaced.length
      ? `${misplaced.length} 处，例如：` + misplaced.slice(0, 3).map((m) => `${m.sel} 在 ${m.file}（应属 ${m.shouldBe}）`).join(' | ')
      : '');

  // ④ 每个域都有文件（防止登记表里出现空域）
  const emptyDomains = Object.keys(prefixes).filter((d) => !Object.values(domains).includes(d));
  check('前缀白名单里的域都真实存在', emptyDomains.length === 0, emptyDomains.join(', '));

  // ⑤ 分片总字节不允许无节制膨胀（搬迁不该让样式变大）
  const total = files.reduce((n, f) => n + readFileSync(join(CSS_DIR, f)).length, 0);
  check('样式总量在合理范围（< 700KB，防重复堆叠）',
    total < 700 * 1024, `${(total / 1024).toFixed(0)} KB / ${files.length} 片`);

  console.log(`\n===== ${pass}/${pass + fail} 通过 =====`);
  if (fail) process.exitCode = 1;
}

main();
