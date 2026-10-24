// BlockCanvas · 设计变量（Design Tokens）
//
// 解决的问题：改一个主色要在十个元素里改十次。
// 有了变量之后，「主色」只在一个地方定义（--bc-primary），元素里写 var(--bc-primary)，
// 改一处全站跟着变 —— 导出的网页里也会带上 :root 定义，脱离本软件同样生效。
//
// 实现要点：
//  · 变量名统一 --bc-* 前缀，与软件自身的 --accent 等 UI 变量隔开，不会互相污染。
//  · 编辑器里直接把这些变量写到 document.documentElement 上，画布用原生 var() 解析，
//    所以预览所见即所得，不需要额外的"替换"逻辑。
//  · 导出时把 :root{...} 放在 <style> 最前面，后面所有规则都能引用。

export interface TokenEntry {
  /** 变量名（不含 --bc- 前缀，如 primary / radius-md） */
  name: string;
  /** 变量值（如 #1e88e5 / 16px / 0 8px 24px rgba(0,0,0,.1)） */
  value: string;
  /** 用途分组，UI 里分块展示 */
  group: TokenGroup;
  /** 变量类型：决定在编辑器里用什么控件改（颜色走取色盘，其余走文本框） */
  kind: 'color' | 'size' | 'shadow';
}

export type TokenGroup = '颜色' | '圆角' | '间距' | '文字' | '阴影';

export const TOKEN_GROUPS: TokenGroup[] = ['颜色', '圆角', '间距', '文字', '阴影'];

/** 新建项目时的初始变量集（可随时增删） */
export const DEFAULT_TOKENS: TokenEntry[] = [
  { name: 'primary', value: '#1e88e5', group: '颜色', kind: 'color' },
  { name: 'primary-dark', value: '#1565c0', group: '颜色', kind: 'color' },
  { name: 'text', value: '#1f2937', group: '颜色', kind: 'color' },
  { name: 'text-muted', value: '#6b7280', group: '颜色', kind: 'color' },
  { name: 'bg', value: '#ffffff', group: '颜色', kind: 'color' },
  { name: 'border', value: '#e5e7eb', group: '颜色', kind: 'color' },
  { name: 'radius-sm', value: '6px', group: '圆角', kind: 'size' },
  { name: 'radius-md', value: '12px', group: '圆角', kind: 'size' },
  { name: 'radius-lg', value: '20px', group: '圆角', kind: 'size' },
  { name: 'space-sm', value: '8px', group: '间距', kind: 'size' },
  { name: 'space-md', value: '16px', group: '间距', kind: 'size' },
  { name: 'space-lg', value: '32px', group: '间距', kind: 'size' },
  { name: 'font-base', value: '16px', group: '文字', kind: 'size' },
  { name: 'font-lg', value: '24px', group: '文字', kind: 'size' },
  { name: 'shadow-card', value: '0 4px 16px rgba(0, 0, 0, 0.08)', group: '阴影', kind: 'shadow' }
];

/** 完整 CSS 变量名。v0.4.5 起**不再强制加 bc- 前缀**，用户起什么名就是什么名 */
export function cssVarName(name: string): string {
  const n = String(name ?? '').trim().replace(/^--/, '');
  return `--${n}`;
}

/** 旧版变量名（--bc-xxx）。只为兼容已存工程，新代码不要再用 */
export function legacyVarName(name: string): string {
  const n = String(name ?? '').trim().replace(/^--/, '');
  return `--bc-${n}`;
}

/** 可供写进样式的引用（var(--primary)） */
export function tokenRef(name: string): string {
  return `var(${cssVarName(name)})`;
}

/** 变量引用匹配：新名 var(--x) 与旧名 var(--bc-x) 都算 */
const VAR_REF_RE = /^\s*var\(\s*--(?:bc-)?([^)\s]+)\s*\)\s*$/;

/** 是否是一个变量引用（如 var(--primary) / var(--bc-primary)） */
export function isTokenRef(value: string | undefined | null): boolean {
  return !!value && VAR_REF_RE.test(value);
}

/** 从 var(--primary) / var(--bc-primary) 里取出变量名 primary；不是变量引用则返回 null */
export function tokenNameFromRef(value: string | undefined | null): string | null {
  if (!value) return null;
  const m = VAR_REF_RE.exec(value);
  return m ? m[1] : null;
}

/**
 * 生成 :root 定义块。
 *
 * v0.4.5 无感迁移的关键：每个变量**同时输出新名与旧名**。
 * 老工程里写的是 var(--bc-primary)，新代码写 var(--primary)，
 * 两者在导出后都能解析 —— 不需要改写任何已存工程，也不会出现"打开就变样"。
 */
export function tokensToCss(tokens: TokenEntry[]): string {
  if (!tokens || tokens.length === 0) return '';
  const lines = tokens
    .map((t) => `  ${cssVarName(t.name)}: ${t.value};\n  ${legacyVarName(t.name)}: ${t.value};`)
    .join('\n');
  return `:root {\n${lines}\n}`;
}

/** 生成可直接注入编辑器的 CSS 文本（用于让画布实时预览） */
export function tokensToRootCss(tokens: TokenEntry[]): string {
  if (!tokens || tokens.length === 0) return '';
  const lines = tokens
    .map((t) => `${cssVarName(t.name)}: ${t.value}; ${legacyVarName(t.name)}: ${t.value};`)
    .join(' ');
  return `:root { ${lines} }`;
}

/**
 * 变量名合法性：**自由度放宽**。
 * 允许大小写字母、数字、连字符、下划线；首字符不能是连字符（避免 -- 开头）。
 * 不再强制小写，也不再要求必须以字母开头。
 */
export function isValidTokenName(name: string): boolean {
  const n = String(name ?? '').trim();
  if (!n || n.length > 48) return false;
  return /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(n);
}

/** 在给定集合里生成不重复的变量名（保留用户输入的大小写） */
export function uniqueTokenName(base: string, tokens: TokenEntry[]): string {
  const used = new Set(tokens.map((t) => t.name));
  const cleaned = String(base ?? '')
    .trim()
    .replace(/^--/, '')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/^-+/, '');
  const start = isValidTokenName(cleaned) ? cleaned : 'token';
  if (!used.has(start)) return start;
  let i = 2;
  while (used.has(`${start}-${i}`)) i += 1;
  return `${start}-${i}`;
}

/** 按分组归类，UI 分块渲染 */
export function groupTokens(tokens: TokenEntry[]): Array<{ group: TokenGroup; items: TokenEntry[] }> {
  const out: Array<{ group: TokenGroup; items: TokenEntry[] }> = [];
  for (const g of TOKEN_GROUPS) {
    const items = tokens.filter((t) => t.group === g);
    if (items.length > 0) out.push({ group: g, items });
  }
  // 兜底：分组不在预设里时也要显示，避免变量"消失"
  const known = new Set(TOKEN_GROUPS);
  for (const t of tokens) {
    if (known.has(t.group)) continue;
    let bucket = out.find((o) => o.group === t.group);
    if (!bucket) { bucket = { group: t.group, items: [] }; out.push(bucket); }
    if (!bucket.items.some((x) => x.name === t.name)) bucket.items.push(t);
  }
  return out;
}
