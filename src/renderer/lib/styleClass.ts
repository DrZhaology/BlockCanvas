// BlockCanvas · 样式类系统（画布与导出共用）
// 阶段3第1轮：样式抽成规则放进 <style>（相同样式共用规则，文件更小）。
// 阶段4・4-C（选择器策略）：类名/ID 优先 → 无则自动 hash 类兜底。
// 阶段4・5（选择器体系重构，直接选择器）：
//   - 有类名(attrs.className) → 规则直接写 .类名（.btn.primary），不做任何包裹
//   - 只有 ID(attrs.id) → 规则直接写 #id（重复 ID 记警告，浏览器要求唯一）
//   - 都没有 → 不再生成 hash 类，样式直接写进 style 属性（行内），并记入
//     unclassified（导出/⚠ 面板提示建议加类名，便于统一管理）
//   - 同一名称但样式不一致 → 不再自动合并（合并不直观）：规则保留第一个出现的
//     声明，其余记冲突警告（「类名、ID 管理」里可一键统一写回）
//   - 覆盖靠顺序：自动规则块放最前 → 页面快速设置 → 用户全局 CSS（放最后、
//     同特异性后者胜）→ 用户写的任何同特异性规则都能覆盖自动样式
//   - 画布渲染与 HTML 导出使用同一套逻辑 → 画布 = 浏览器 = 导出

import type { SceneElement, SceneGraph } from '@lib/types';

// style 中这些 key 不是 CSS 属性（img src/alt 等元素属性，不进样式类）
const NON_CSS_STYLE_KEYS = new Set(['src', 'alt']);

export function styleToCssText(style: Record<string, string | undefined>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(style)) {
    if (v == null || v === '') continue;
    if (NON_CSS_STYLE_KEYS.has(k)) continue;
    const cssKey = k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    out.push(`${cssKey}: ${v};`);
  }
  return out.join(' ');
}

// 把 padding/margin/border-radius 等 4 边拆分字段，自动合并为简写形式。
// 注意 **border-width 故意保留长写**（不合并为 border-width shorthand）——
// 否则 React 内联 style 注入会出现"shorthand + longhand 混合 reset"的陷阱：
// 现有 4 个 borderXxxWidth longhand 转 borderWidth shorthand 后，React diff 时
// 会先 reset 4 个 longhand 为 '' 再 set borderWidth=''，但该操作会顺带冲掉隐式的 borderXxxStyle longhand
// （来自之前 borderStyle shorthand 的分解），结果只剩某一边的 longhand style 残留，
// 表现为"border-left:1px dashed; 其它三边无 style"。保留长写可让 React diff 时 prev / next key 集合一致。
export function simplifyStyle(style: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};

  const defined = (v: string | undefined): boolean => v !== undefined && v !== '';

  // emit 后覆盖：尽量避免旧 shorthand shrink 反过来覆盖依据各边新值算出的新 shorthand
  const emittedShort = new Set<string>();

  // padding / margin / border-radius: 完整 4 边时输出简写；部分时输出长写
  const simplify4 = (keys: [string, string, string, string], longKey: string, shorthandKey: string): void => {
    const vals = keys.map((k) => style[k]);
    const present = vals.filter(defined);
    if (present.length === 0) return;
    if (present.length === 4) {
      const [a, b, c, d] = vals as string[];
      if (a === b && b === c && c === d) out[shorthandKey] = a;
      else if (a === c && b === d) out[shorthandKey] = `${a} ${b}`;
      else if (b === d) out[shorthandKey] = `${a} ${b} ${c}`;
      else out[shorthandKey] = `${a} ${b} ${c} ${d}`;
      emittedShort.add(shorthandKey);
    } else {
      const longNames = ['top', 'right', 'bottom', 'left'];
      vals.forEach((v, i) => {
        if (defined(v)) out[`${longKey}-${longNames[i]}`] = v;
      });
    }
  };

  simplify4(['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'], 'padding', 'padding');
  simplify4(['marginTop', 'marginRight', 'marginBottom', 'marginLeft'], 'margin', 'margin');
  // border-width **保留长写** —— 不合并为 border-width shorthand（React diff 长写单向更新更安全）
  // 留给 baseStyle 与 prev key 集合一致
  // 4 边都给值时，直接保留 longhand 形式：输出 borderTopWidth 等 4 个 longhand
  {
    const bwKeys = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];
    for (const k of bwKeys) if (defined(style[k])) out[k] = style[k];
  }
  simplify4(
    ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'],
    'border', 'border-radius'
  );

  // 跳出检查只针对"4 边拆分键"（它们已被 simplify4 合并/长写输出）；
  // 简写键本身（padding/margin/border-radius 单值）必须原样保留，但若已被
  // simplify4 重新算过（即同名的旧 shorthand 会被各边值覆盖），不能再被旧值覆盖回来。
  const COVERED = /^(paddingTop|paddingRight|paddingBottom|paddingLeft|marginTop|marginRight|marginBottom|marginLeft|borderTopWidth|borderRightWidth|borderBottomWidth|borderLeftWidth|borderTopLeftRadius|borderTopRightRadius|borderBottomRightRadius|borderBottomLeftRadius)$/;
  for (const [k, v] of Object.entries(style)) {
    if (v == null || v === '') continue;
    if (NON_CSS_STYLE_KEYS.has(k)) continue;
    if (COVERED.test(k)) continue;
    if (emittedShort.has(k)) continue; // simplify4 已据各边新值算出 shorthand
    out[k] = v;
  }

  return out;
}

// 选择器非法字符兜底（正常名字浏览器方 CSS.escape 可用；坏字符替换为 -）
function escapeSel(s: string): string {
  try {
    return (window as { CSS?: { escape?: (s: string) => string } }).CSS?.escape?.(s) ?? s.replace(/[^a-zA-Z0-9_-]/g, '-');
  } catch {
    return s.replace(/[^a-zA-Z0-9_-]/g, '-');
  }
}

/** 一个元素最终参与规则的方式：
 * - selector 非空：规则选择器（.类名 / #id），DOM 上挂选中的类/id
 * - inlineCss 非空：无类名无 ID → 行内 style（画布与导出都用它）
 */
export interface SelectorInfo {
  selector: string;               // 完整选择器，如 '.btn.primary' / '#hero'；空 = 行内样式
  classAttr: string | null;       // DOM 上要挂的 class（仅用户类名）
  idAttr: string | null;          // DOM 上要挂的 id（仅当用 ID 做选择器时）
  inlineCss: string | null;       // 行内样式元素的 CSS 声明文本（无类无 ID 时）
}

// 决定元素用什么方式写样式：类名 → ID → 行内 style
export function selectorForNode(node: SceneElement): SelectorInfo {
  const cls = (node.attrs?.className ?? '').trim();
  if (cls) {
    return {
      selector: cls.split(/\s+/).map((t) => '.' + escapeSel(t)).join(''),
      classAttr: cls,
      idAttr: null,
      inlineCss: null
    };
  }
  const id = (node.attrs?.id ?? '').trim();
  if (id) {
    return { selector: '#' + escapeSel(id), classAttr: null, idAttr: id, inlineCss: null };
  }
  // 无类名无 ID：行内样式（不生成 hash 类，用户可加类名后自动迁移为规则）
  const cssText = styleToCssText(simplifyStyle(node.style));
  return { selector: '', classAttr: null, idAttr: null, inlineCss: cssText || null };
}

// 声明文本（"a: 1; b: 2; "）→ 对象（key 转 camelCase，供 React 内联/编辑表单使用）
export function cssTextToObject(text: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text) return out;
  for (const part of text.split(';')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k || !v) continue;
    out[k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out;
}

export interface StyleClassSet {
  byId: Map<string, string | null>;      // 节点 id → 要挂到 class 的类（用户类名；行内元素为 null）
  inlineCss: Map<string, string | null>; // 行内样式元素：节点 id → CSS 声明文本（无样式时为 null）
  rules: Map<string, string>;            // selector → 声明文本（冲突时保留首个）
  order: string[];                       // 选择器首次出现顺序
  warnings: { selector: string; reason: string }[]; // 样式不统一（同名不同样式）/ 重复 ID → 提示
  unclassified: { id: string; type: string }[];     // 无类名无 ID 的元素（行内样式）→ 建议加类名
}

export function createStyleClassSet(): StyleClassSet {
  return { byId: new Map(), inlineCss: new Map(), rules: new Map(), order: [], warnings: [], unclassified: [] };
}

// 深度优先收集整棵树的类名与规则（同名类样式不同不合并：保留首个 + 冲突警告）
export function collectStyleClasses(root: SceneElement, ctx: StyleClassSet): void {
  const seenIds = new Map<string, string>(); // 已出现的 id → 首个节点的 node.id（重复检测）
  const walk = (node: SceneElement): void => {
    if (node.hidden) {
      for (const c of node.children) walk(c);
      return;
    }
    const info = selectorForNode(node);
    const clsName = (node.attrs?.className ?? '').trim();
    const idName = (node.attrs?.id ?? '').trim();

    if (info.inlineCss) {
      // 行内样式元素：不进规则表，样式写在 DOM style 属性上（画布与导出一致）
      ctx.inlineCss.set(node.id, info.inlineCss);
      ctx.byId.set(node.id, null);
      ctx.unclassified.push({ id: node.id, type: node.type });
    } else {
      ctx.byId.set(node.id, info.classAttr);
      if (info.selector) {
        const cssText = styleToCssText(simplifyStyle(node.style));
        if (cssText) {
          const existing = ctx.rules.get(info.selector);
          if (existing === undefined) {
            ctx.rules.set(info.selector, cssText);
            ctx.order.push(info.selector);
          } else if (existing !== cssText) {
            // 同名类/ID 但样式不同：不再自动合并（后者覆盖前者不直观），
            // 规则保留第一个出现的声明，并记冲突警告 → 「类名、ID 管理」统一
            ctx.warnings.push({
              selector: info.selector,
              reason: '多个元素共用这个名称但样式不完全一致：目前以第一个为准。到「类名 · ID管理」里统一，或改用不同的名称'
            });
          }
        }
      }
      if (idName) {
        if (seenIds.has(idName)) {
          ctx.warnings.push({
            selector: '#' + idName,
            reason: `ID #${idName} 重复使用（${seenIds.get(idName)} 已用它）：浏览器里 ID 必须唯一，请给这个元素换个 ID`
          });
        } else {
          seenIds.set(idName, node.id);
        }
      }
      if (!clsName && !idName && !info.inlineCss) {
        // 连行内样式都没有的裸元素（如默认无样式元素）：同样算"未命名"，提示可忽略
        ctx.unclassified.push({ id: node.id, type: node.type });
      }
    }
    for (const c of node.children) walk(c);
  };
  walk(root);
}

// 页面快速设置 → CSS 文本（4-D：可视化 body/a 常用项）
// 顺序：自动样式 → 快速设置 → 高级 CSS（高级在最后，用户写的规则总能覆盖快速设置）
export function quickCssToCss(q: SceneGraph['quickCss'] | undefined): string {
  if (!q) return '';
  const bodyDecls: string[] = [];
  if (q.bodyBg) bodyDecls.push(`background-color: ${q.bodyBg};`);
  if (q.textColor) bodyDecls.push(`color: ${q.textColor};`);
  if (q.fontFamily) bodyDecls.push(`font-family: ${q.fontFamily};`);
  const parts: string[] = [];
  if (bodyDecls.length > 0) parts.push(`body {\n  ${bodyDecls.join('\n  ')}\n}`);
  if (q.linkColor) parts.push(`a { color: ${q.linkColor}; text-decoration: underline; }`);
  return parts.join('\n\n');
}

// 生成 <style> 块：① 自动规则 ② 快速设置 ③ 用户全局 CSS（放最后 → 用户可覆盖）
// 规则直接写 .类名 / #id（不做 :where）：自动块在最前面，用户全局 CSS 在最后，
// 同特异性选择器后来者胜 → 用户永远能覆盖自动样式（即"所见即所得、可覆盖"）
export function buildStyleBlock(ctx: StyleClassSet, globalCss?: string, quickCss?: SceneGraph['quickCss']): string {
  const autoRules = ctx.order.map((sel) => `${sel} { ${ctx.rules.get(sel)} }`);
  const rulesBlock = autoRules.length > 0 ? autoRules.join('\n') : '';
  const userCss = (globalCss ?? '').trim();
  const quickBlock = quickCssToCss(quickCss);
  if (!rulesBlock && !userCss && !quickBlock) return '';
  const parts: string[] = [];
  if (rulesBlock) {
    parts.push('/* ==== 自动生成的样式（放最前面；你写的全局 CSS 放最后，同权重规则后写者胜，可以覆盖这里） ==== */\n' + rulesBlock);
  }
  if (quickBlock) {
    parts.push('/* ==== 页面快速设置 ==== */\n' + quickBlock);
  }
  if (userCss) {
    parts.push('/* ==== 你写的全局 CSS（放最后，可以覆盖上面的样式） ==== */\n' + userCss);
  }
  return parts.join('\n\n');
}