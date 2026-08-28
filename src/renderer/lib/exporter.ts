import type { SceneGraph, SceneElement } from '@lib/types';
import { SELF_CLOSING_TAGS } from '@lib/types';
import { collectStyleClasses, buildStyleBlock, createStyleClassSet, type StyleClassSet } from '@lib/styleClass';
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
  if (node.text) html += escapeText(node.text);
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

  const styleBlock = buildStyleBlock(ctx, scene.globalCss, scene.quickCss);
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
  const fullStyleBlock = [...resets, styleBlock].filter(Boolean).join('\n\n');
  const styleHtml = fullStyleBlock
    ? `  <style>\n${indentLines(fullStyleBlock, '    ')}\n  </style>\n`
    : '';

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