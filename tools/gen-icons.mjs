// ============================================================================
// BlockCanvas · 图标集生成器
// ----------------------------------------------------------------------------
// 唯一真源：src/renderer/assets/icons/*.svg（一个图标一个文件，文件名 = 图标名）
//
//   * 文件名用 kebab-case（`arrow-left.svg`），生成的图标名用 camelCase
//     （`arrowLeft`）—— 界面代码里 `name={...}` 接受的仍是 camelCase，历史调用点零改动。
//   * 生成的 `Icon.tsx` 是**产物**，不要手改；改图标 = 加/删/改 svg 文件后重跑本脚本。
//
// 用法：
//   node tools/gen-icons.mjs            生成 Icon.tsx
//   node tools/gen-icons.mjs --check    只校验是否与 svg 目录一致（不一致退出码 1，给 CI 用）
//
// 设计约束（写死在外壳里，不允许单个 svg 覆盖）：
//   24×24 网格、fill:none、stroke:currentColor、1.7px 描边、圆头圆角。
// ============================================================================
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG_DIR = join(ROOT, 'src/renderer/assets/icons');
const OUT_FILE = join(ROOT, 'src/renderer/components/Icon.tsx');
const checkOnly = process.argv.includes('--check');

/** kebab-case 文件名 → camelCase 图标名 */
const toIconName = (base) =>
  base.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** camelCase 图标名 → kebab-case 文件名 */
const toFileName = (name) => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/**
 * SVG 标记 → JSX 片段。
 * 只做必要的名字转换：`stroke-dasharray` → `strokeDasharray` 这类带连字符的属性；
 * `data-*` / `aria-*` 保持原样（JSX 里也是连字符写法）。
 */
function toJsx(markup) {
  return markup
    .replace(/\s+([a-z]+(?:-[a-z]+)+)=/g, (whole, attr) =>
      attr.startsWith('data-') || attr.startsWith('aria-') ? whole : ' ' + attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + '='
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 取出一个 svg 文件里的子元素（去掉外层 <svg>），并校验它符合图标规范。
 * 返回 { name, key, inner } 或抛出可读错误。
 */
function parseIconFile(file) {
  const base = file.replace(/\.svg$/i, '');
  const raw = readFileSync(join(SVG_DIR, file), 'utf-8').replace(/^\uFEFF/, '');

  if (/<\?xml|<!DOCTYPE/i.test(raw)) {
    throw new Error(`${file}：不要带 XML 声明 / DOCTYPE`);
  }
  // 只允许单个根 <svg>
  const roots = [...raw.matchAll(/<svg\b/gi)];
  if (roots.length !== 1) throw new Error(`${file}：必须恰好一个 <svg> 根（找到 ${roots.length} 个）`);

  const open = raw.indexOf('<svg');
  const close = raw.lastIndexOf('</svg>');
  if (close < 0) throw new Error(`${file}：缺少 </svg>`);
  const head = raw.slice(open, raw.indexOf('>', open) + 1);
  const inner = raw.slice(raw.indexOf('>', open) + 1, close).trim();

  // 规范：外层 <svg> 的描边/尺寸由 <Icon> 统一提供，个别文件不许自己盖一遍
  //（盖了也不报错，只是会被忽略 —— 真正要拦的是 viewBox 与尺寸，那会让图标"长得不一样"）
  const vb = /\bviewBox\s*=\s*"([^"]*)"/i.exec(head);
  if (vb && vb[1].replace(/\s+/g, ' ').trim() !== '0 0 24 24') {
    throw new Error(`${file}：viewBox 必须是 "0 0 24 24"（现在是 "${vb[1]}"）`);
  }
  for (const banned of ['width', 'height', 'class', 'style']) {
    // 只认"独立属性名"：stroke-width / 其它带连字符的属性不算
    if (new RegExp(`(?:^|\\s)${banned}\\s*=`, 'i').test(head)) {
      throw new Error(`${file}：外层 <svg> 不要写 ${banned} —— 由 Icon 组件统一提供`);
    }
  }
  if (!inner) throw new Error(`${file}：没有图形内容`);
  // 防脚本注入（图标里不该出现）
  if (/<script|on[a-z]+\s*=/i.test(inner)) throw new Error(`${file}：图标里不允许脚本或事件属性`);

  const name = toIconName(base);
  return { name, inner: toJsx(inner) };
}

function build() {
  if (!existsSync(SVG_DIR)) throw new Error(`找不到图标目录：${SVG_DIR}`);
  const files = readdirSync(SVG_DIR).filter((f) => /\.svg$/i.test(f));
  if (!files.length) throw new Error(`${SVG_DIR} 里没有 .svg 文件`);

  const icons = files
    .map(parseIconFile)
    .sort((a, b) => a.name.localeCompare(b.name));

  // 重名检查（`foo-bar.svg` 与 `fooBar.svg` 会撞成同一个名字）
  const seen = new Map();
  for (const ic of icons) {
    if (seen.has(ic.name)) {
      throw new Error(`图标名冲突：${seen.get(ic.name)} 与 ${toFileName(ic.name)}.svg 都叫 ${ic.name}`);
    }
    seen.set(ic.name, toFileName(ic.name) + '.svg');
  }

  const union = icons.map((ic) => `  | '${ic.name}'`).join('\n');
  const entries = icons
    .map((ic) => `  ${ic.name}: (\n    <>\n      ${ic.inner}\n    </>\n  ),`)
    .join('\n');

  return `// 此文件由 tools/gen-icons.mjs 从 src/renderer/assets/icons/*.svg 生成，请勿手改。
// 加图标：往 assets/icons/ 放一个 24×24 的 .svg（文件名即图标名），然后 pnpm icons:gen。
//
// 设计规矩（2026-10 设计语言更新）：
//   · 只画线条（fill: none），描边由外壳统一给 1.7px、圆头圆角、currentColor；
//   · 只用 1~2 种颜色（currentColor + 局部 fill 点缀），最多 3 种；
//   · 简单直白：一眼能看出含义，不做装饰性细节；
//   · 全部通过 <Icon name="…" /> 使用，界面里不再出现 Emoji。
//   · svg 文件里不要写 width/height/fill/stroke/viewBox —— 由 <Icon> 统一提供，
//     否则一批图标大小粗细不一致。

import type { ReactNode } from 'react';

export type IconName =
${union};

const P: Record<IconName, ReactNode> = {
${entries}
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={'bc-icon' + (className ? ' ' + className : '')}
      data-bc-icon={name}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {P[name]}
    </svg>
  );
}

const ICON_NAME_SET = new Set<string>(Object.keys(P));

/** 把历史遗留的字符串（旧版 Emoji 图标名 / 任意串）解析成可用的 IconName；认不出返回 undefined */
export function resolveIconName(s?: string | null): IconName | undefined {
  return s && ICON_NAME_SET.has(s) ? (s as IconName) : undefined;
}

/** 全部可用图标名（工具链 / 探针 / 图标选择器用） */
export const ICON_NAMES = Object.keys(P) as IconName[];

export default Icon;
`;
}

const next = build();
const count = (next.match(/^ {2}[a-z][A-Za-z0-9]*: \($/gm) || []).length;
const prev = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf-8') : '';
const norm = (s) => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

if (norm(prev) === norm(next)) {
  console.log(`[icons] 已是最新：${count} 个图标`);
  process.exit(0);
}

if (checkOnly) {
  console.error('[icons] Icon.tsx 与 assets/icons/ 不一致 —— 跑 `pnpm icons:gen` 重新生成。');
  process.exit(1);
}

writeFileSync(OUT_FILE, next, 'utf-8');
console.log(`[icons] 已生成 Icon.tsx（${count} 个图标）`);
