import type { SceneGraph, SceneElement } from '@lib/types';
import { SELF_CLOSING_TAGS } from '@lib/types';
import { collectStyleClasses, buildStyleBlock, createStyleClassSet, styleToCssText, simplifyStyle, type StyleClassSet } from '@lib/styleClass';
import { collectTableSelectors } from '@lib/tableOps';
import { applyExportPostHooks } from './pluginHost';

// BlockCanvas · HTML 导出器
// 阶段 3 第 1 轮（类名化）：样式抽进 <style> 块，相同样式共用规则。
// 阶段 4・4-C（选择器策略）：与画布共用 lib/styleClass 的同一套规则文本 →
//   - 有类名的元素：选择器用它的类名（.btn.primary），不再自动生成 hash 类
//   - 只有 ID：选择器用 #id
//   - 都没有：兜底自动 hash 类（样式相同自动共用）
//   - 同名类样式不同：规则按 CSS 语义合并，warnings 带回（界面导出后提示拆类名）
//   - 无类名无 ID 的元素：unclassified 带回（提示建议添加类名，便于后续用类统一管理）
//   - <style> 块顺序：① 生成的规则 ② 用户全局 CSS（放最后 → 用户可覆盖）

function buildAttrsString(node: SceneElement, ctx: StyleClassSet): { attrsStr: string } {
  const attrs = (node.attrs ?? {}) as Record<string, string | undefined>;
  const get = (k: string): string => (attrs[k] ?? '').trim();
  const out: string[] = [];

  // class 与 id 由收集阶段决定（类名优先 → ID → 行内样式），与画布渲染完全一致
  const cls = ctx.byId.get(node.id);
  if (cls) out.push(`class="${escapeAttr(cls)}"`);
  if (get('id')) out.push(`id="${escapeAttr(get('id'))}"`);

  // 无类名无 ID 的元素 → 行内 style 属性（与画布内联渲染同一文本）
  const inline = ctx.inlineCss.get(node.id);
  if (inline) out.push(`style="${escapeAttr(inline)}"`);

  // 元素专属属性
  if (node.type === 'img') {
    const alt = (get('alt') || node.text || '').trim();
    out.push(`alt="${escapeAttr(alt)}"`);
    const src = get('src');
    if (src) out.push(`src="${escapeAttr(src)}"`);
  }
  if (node.type === 'a' && get('href')) out.push(`href="${escapeAttr(get('href'))}"`);
  if ((node.type === 'input' || node.type === 'textarea') && get('placeholder')) {
    out.push(`placeholder="${escapeAttr(get('placeholder'))}"`);
  }
  if (node.type === 'input' && get('typeAttr')) {
    out.push(`type="${escapeAttr(get('typeAttr'))}"`);
  }
  // 表格单元格：colspan / rowspan（值为 1 时不写，保持代码干净）
  if (node.type === 'th' || node.type === 'td') {
    const cs = get('colspan');
    if (cs && cs !== '1') out.push(`colspan="${escapeAttr(cs)}"`);
    const rs = get('rowspan');
    if (rs && rs !== '1') out.push(`rowspan="${escapeAttr(rs)}"`);
  }
  // 表头单元格：scope（col / row / colgroup / rowgroup）
  if (node.type === 'th' && get('scope')) {
    out.push(`scope="${escapeAttr(get('scope'))}"`);
  }
  const attrsStr = out.length ? ' ' + out.join(' ') : '';
  return { attrsStr };
}

function nodeToHTML(node: SceneElement, ctx: StyleClassSet, indent = 2): string {
  if (node.hidden) return '';
  const pad = ' '.repeat(indent);
  const tag = node.type;
  const { attrsStr } = buildAttrsString(node, ctx);

  let html = `${pad}<${tag}${attrsStr}`;

  if (tag === 'input') {
    if (!node.attrs?.typeAttr) html += ' type="text"';
    html += '>';
    return html;
  }
  if (tag === 'textarea') {
    html += ' rows="3" cols="40">' + (node.text ? escapeText(node.text) : '') + `</${tag}>`;
    return html;
  }
  if (SELF_CLOSING_TAGS.has(tag)) {
    html += '>';
    return html;
  }

  html += '>';
  if (node.runs && node.runs.length > 0) {
    // 富文本片段（v0.4.4d）：带样式的片段输出成 <span style="…">（内联，不用选择器）
    html += node.runs.map((r) => {
      const t = escapeTextBr(r.text);
      const css = r.style ? styleToCssText(simplifyStyle(r.style)) : '';
      return css ? `<span style="${escapeAttr(css)}">${t}</span>` : t;
    }).join('');
  } else if (node.text) {
    html += escapeTextBr(node.text);
  }
  if (node.children.length > 0) {
    const childrenHtml = node.children
      .map((c) => nodeToHTML(c, ctx, indent + 2))
      .filter((s) => s.length > 0);
    if (childrenHtml.length > 0) html += '\n' + childrenHtml.join('\n') + `\n${pad}`;
  }
  html += `</${tag}>`;
  return html;
}

function escapeText(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** 文本内容转义 + 换行转 <br>（v0.4.4e：编辑器里的换行导出成真正的换行标签） */
function escapeTextBr(t: string): string {
  return escapeText(t).replace(/\n/g, '<br>');
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function indentLines(s: string, pad: string): string {
  return s.split('\n').map((l) => (l ? pad + l : l)).join('\n');
}

export interface ExportResult {
  html: string;
  warnings: { selector: string; reason: string }[];
  unclassified: { id: string; type: string }[];
}

export function exportHTML(scene: SceneGraph): ExportResult {
  // 预扫全部元素：决定每个元素的选择器 + 去重合并后的规则（与画布渲染共用同一生成逻辑）
  const ctx: StyleClassSet = createStyleClassSet();
  for (const c of scene.root.children) collectStyleClasses(c, ctx);

  // —— 表格：每张表单独成一个 <style> 标签（v0.4.4）——
  // 理由：表格的 CSS 又多又"只服务这一张表"，混在通用样式里很难读、也容易和别的表互相覆盖。
  // 做法：先把每张表会用到哪些选择器算出来，主块把它们排除，再逐表输出一块。
  const tables: { label: string; selectors: Set<string> }[] = [];
  const collectTables = (n: SceneElement): void => {
    if (n.hidden) return;
    if (n.type === 'table') {
      const cls = (n.attrs?.className ?? '').trim().split(/\s+/)[0];
      tables.push({
        label: cls || `table-${tables.length + 1}`,
        selectors: new Set(collectTableSelectors(n))
      });
    }
    for (const c of n.children) collectTables(c);
  };
  for (const c of scene.root.children) collectTables(c);
  const allTableSelectors = new Set<string>();
  for (const t of tables) for (const s of t.selectors) allTableSelectors.add(s);

  // 基础重置默认【不】添加（用户可在「页面」页签按需勾选）：
  // ① 去白边：html,body 默认 8px 边距 ② 标题/段落默认间距：h1~h6、p、列表等 UA 外边距
  // （真实网站都有 CSS Reset；还原网站排版时勾上第二项即可对齐原站观感）
  const RESET_TAGS = 'h1, h2, h3, h4, h5, h6, p, ul, ol, figure, blockquote, table';
  const resets: string[] = [];
  if (scene.quickCss?.resetMargin === '1') {
    resets.push('/* ==== 基础重置：去掉浏览器默认边距（「页面」页签已开启） ==== */\nhtml, body { margin: 0; padding: 0; }');
  }
  if (scene.quickCss?.resetHeadingMargin === '1') {
    resets.push('/* ==== 重置标题/段落/列表的浏览器默认外边距 ==== */\n' + RESET_TAGS + ' { margin: 0; }');
  }
  const indentBlock = (css: string, attr = ''): string =>
    css ? `  <style${attr}>\n${indentLines(css, '    ')}\n  </style>\n` : '';

  let styleHtml: string;
  if (tables.length === 0) {
    // 没有表格：完全保持原来的单块输出（不打扰既有工程）
    const full = [...resets, buildStyleBlock(ctx, scene.globalCss, scene.quickCss, scene.tokens)].filter(Boolean).join('\n\n');
    styleHtml = indentBlock(full);
  } else {
    // ① 主块：重置 + 设计变量 + 非表格的自动规则 + 非表格响应式
    const mainCss = [
      ...resets,
      buildStyleBlock(ctx, undefined, undefined, scene.tokens, {
        excludeSelectors: allTableSelectors,
        withPageCss: false
      })
    ].filter(Boolean).join('\n\n');
    // ② 每张表一块：只放这张表自己的规则
    const tableBlocks = tables.map((t, i) =>
      indentBlock(
        buildStyleBlock(ctx, undefined, undefined, undefined, {
          onlySelectors: t.selectors,
          withTokens: false,
          withPageCss: false,
          autoComment: `/* ==== 表 ${i + 1} · .${t.label} 的样式（这张表专属） ==== */`
        }),
        ` data-bc-table="${escapeAttr(t.label)}"`
      )
    ).join('');
    // ③ 尾块：快速设置 + 用户全局 CSS（放最后 → 仍然可以覆盖表格样式）
    const tailCss = buildStyleBlock(ctx, scene.globalCss, scene.quickCss, undefined, {
      onlySelectors: new Set<string>(),
      withTokens: false
    });
    styleHtml = indentBlock(mainCss) + tableBlocks + indentBlock(tailCss);
  }

  const bodyInner = scene.root.children
    .map((c) => nodeToHTML(c, ctx, 2))
    .filter((s) => s.length > 0)
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BlockCanvas 导出</title>
${styleHtml}</head>
<body>
${bodyInner}
</body>
</html>`;

  return { html: applyExportPostHooks(html), warnings: ctx.warnings, unclassified: ctx.unclassified };
}

// 测试钩子：E2E 探针直接调导出器验证产物（与 sceneStore 的 window.__sceneStore 同一套做法）
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__bcExportHTML = exportHTML;
}