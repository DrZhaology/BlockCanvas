// BlockCanvas · 渐变内核（背景渐变 / 文字渐变共用）
// 设计目标：
//  1. 结构化模型（类型 / 角度 / 色标），供可视化编辑器（PowerPoint 风格）双向绑定；
//  2. 与原生 CSS 字符串 **无损互转** —— 模板里手写的 linear-gradient(...) 能完美导入，
//     编辑后再原样写回 background-image；
//  3. 容错解析：方向关键字(to right)、单位省略、色标缺位置、rgba/英文色名、
//     逗号嵌套（rgba(0,0,0,.5)）都要能正确切分。

export interface GradientStop {
  /** 任意合法 CSS 颜色（hex / rgb / rgba / 英文色名） */
  color: string;
  /** 位置百分比 0~100 */
  pos: number;
}

export interface GradientSpec {
  type: 'linear' | 'radial';
  /** 线性渐变角度（deg）。CSS 语义：0deg = 向上，90deg = 向右，180deg = 向下 */
  angle: number;
  /** 径向渐变的形状 */
  shape: 'circle' | 'ellipse';
  stops: GradientStop[];
}

/** 判断一段 CSS 值是否为渐变 */
export function isGradient(v: string | undefined | null): boolean {
  if (!v) return false;
  return /(?:^|[^-])(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i.test(v);
}

/** 方向关键字 → 角度（CSS 渐变角度：0deg 指向上，顺时针增加） */
const DIR_TO_ANGLE: Record<string, number> = {
  'to top': 0,
  'to right': 90,
  'to bottom': 180,
  'to left': 270,
  'to top right': 45,
  'to right top': 45,
  'to bottom right': 135,
  'to right bottom': 135,
  'to bottom left': 225,
  'to left bottom': 225,
  'to top left': 315,
  'to left top': 315
};

/** 角度 → 人话方向说明（供 UI 提示） */
export function angleHint(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return '向上 (↑)';
  if (d === 90) return '向右 (→)';
  if (d === 180) return '向下 (↓)';
  if (d === 270) return '向左 (←)';
  if (d < 90) return '右上 ↗';
  if (d < 180) return '右下 ↘';
  if (d < 270) return '左下 ↙';
  return '左上 ↖';
}

/** 按顶层逗号切分（忽略括号内的逗号，如 rgba(0, 0, 0, .5)） */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const COLOR_LIKE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|transparent$|currentcolor$|[a-z]+$)/i;

/** 解析单个色标 "rgba(0,0,0,.5) 30%" / "#fff" / "red 0%" */
function parseStop(raw: string): GradientStop | null {
  const t = raw.trim();
  if (!t) return null;
  // 末尾百分比（允许 0、0.5、30.5%）
  const m = t.match(/\s+(-?[\d.]+)%?\s*$/);
  if (m) {
    const before = t.slice(0, m.index).trim();
    if (before && COLOR_LIKE.test(before)) {
      return { color: before, pos: clampNum(parseFloat(m[1]), 0, 100) };
    }
  }
  if (COLOR_LIKE.test(t)) return { color: t, pos: NaN };
  return null;
}

function clampNum(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/** 解析 CSS 渐变字符串 → 结构化模型；非渐变或无法解析时返回 null */
export function parseGradient(input: string | undefined | null): GradientSpec | null {
  if (!input) return null;
  const s = input.trim();
  const m = s.match(/^(repeating-)?(linear|radial|conic)-gradient\s*\(([\s\S]*)\)\s*$/i);
  if (!m) return null;
  const kind = m[2].toLowerCase();
  const body = m[3];
  const parts = splitTopLevel(body);
  if (parts.length < 2) return null;

  const spec: GradientSpec = { type: 'linear', angle: 180, shape: 'circle', stops: [] };
  let rest = parts;

  if (kind === 'linear') {
    spec.type = 'linear';
    const head = parts[0];
    const angleMatch = head.match(/^(-?[\d.]+)deg$/i);
    if (angleMatch) {
      spec.angle = ((parseFloat(angleMatch[1]) % 360) + 360) % 360;
      rest = parts.slice(1);
    } else if (/^to\s+/i.test(head)) {
      const key = head.replace(/\s+/g, ' ').trim().toLowerCase();
      spec.angle = DIR_TO_ANGLE[key] ?? 180;
      rest = parts.slice(1);
    } else {
      spec.angle = 180;
    }
  } else if (kind === 'radial') {
    spec.type = 'radial';
    const head = parts[0].toLowerCase();
    if (/^\s*(circle|ellipse)\b/.test(head) || /^\s*at\s+/.test(head) || /^\s*closest|farthest/.test(head)) {
      spec.shape = head.includes('ellipse') ? 'ellipse' : 'circle';
      rest = parts.slice(1);
    }
  } else {
    // conic 暂不支持可视化编辑，交给原生代码兜底（返回 null 让调用方按纯文本处理）
    return null;
  }

  const stops: GradientStop[] = [];
  for (const p of rest) {
    const st = parseStop(p);
    if (st) stops.push(st);
  }
  if (stops.length < 2) return null;

  // 缺位置的色标按均匀分布补全（保留已有位置，仅填补 NaN）
  const missing = stops.filter((s) => Number.isNaN(s.pos));
  if (missing.length > 0) {
    const n = stops.length;
    stops.forEach((s, i) => {
      if (Number.isNaN(s.pos)) s.pos = n === 1 ? 0 : Math.round((i / (n - 1)) * 100);
    });
  }
  // 位置单调递增修正（保证可读、可视）
  for (let i = 1; i < stops.length; i += 1) {
    if (stops[i].pos < stops[i - 1].pos) stops[i].pos = stops[i - 1].pos;
  }
  spec.stops = stops;
  return spec;
}

/** 结构化模型 → CSS 字符串 */
export function serializeGradient(spec: GradientSpec): string {
  const stops = [...spec.stops].sort((a, b) => a.pos - b.pos);
  const body = stops.map((s) => `${s.color} ${round2(s.pos)}%`).join(', ');
  if (spec.type === 'radial') {
    return `radial-gradient(${spec.shape} at center, ${body})`;
  }
  return `linear-gradient(${round2(spec.angle)}deg, ${body})`;
}

function round2(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 缺省渐变（新建渐变时的初值） */
export function defaultGradient(): GradientSpec {
  return {
    type: 'linear',
    angle: 135,
    shape: 'circle',
    stops: [
      { color: '#667eea', pos: 0 },
      { color: '#764ba2', pos: 100 }
    ]
  };
}

// ============ 预制渐变（PowerPoint 风格的常用好看配色） ============
export interface GradientPreset {
  name: string;
  /** 直接可用的 CSS 值 */
  css: string;
  /** 归类：暖色 / 冷色 / 中性 / 高级 */
  group: '暖色系' | '冷色系' | '自然系' | '高级感';
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  // —— 暖色系 ——
  { name: '晨曦暖阳', group: '暖色系', css: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)' },
  { name: '珊瑚海岸', group: '暖色系', css: 'linear-gradient(135deg, #ff7e5f 0%, #feb47b 100%)' },
  { name: '蜜桃气泡', group: '暖色系', css: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
  { name: '落日熔金', group: '暖色系', css: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)' },
  { name: '烈焰橙红', group: '暖色系', css: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)' },
  { name: '玫瑰金', group: '暖色系', css: 'linear-gradient(135deg, #ffafbd 0%, #ffc3a0 100%)' },
  { name: '焦糖暖棕', group: '暖色系', css: 'linear-gradient(135deg, #c79081 0%, #dfa579 100%)' },

  // —— 冷色系 ——
  { name: '极光紫', group: '冷色系', css: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  { name: '深海蓝调', group: '冷色系', css: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)' },
  { name: '蔚蓝天空', group: '冷色系', css: 'linear-gradient(135deg, #56ccf2 0%, #2f80ed 100%)' },
  { name: '星尘紫', group: '冷色系', css: 'linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)' },
  { name: '紫罗兰', group: '冷色系', css: 'linear-gradient(135deg, #7f00ff 0%, #e100ff 100%)' },
  { name: '薰衣草', group: '冷色系', css: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
  { name: '蓝莓慕斯', group: '冷色系', css: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },

  // —— 自然系 ——
  { name: '薄荷青柠', group: '自然系', css: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  { name: '翡翠湖', group: '自然系', css: 'linear-gradient(135deg, #02aab0 0%, #00cdac 100%)' },
  { name: '森林晨雾', group: '自然系', css: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)' },
  { name: '柠檬青', group: '自然系', css: 'linear-gradient(135deg, #a8ff78 0%, #78ffd6 100%)' },
  { name: '青柠苏打', group: '自然系', css: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)' },

  // —— 高级感 ——
  { name: '午夜星河', group: '高级感', css: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)' },
  { name: '商务深蓝', group: '高级感', css: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)' },
  { name: '石墨灰', group: '高级感', css: 'linear-gradient(135deg, #485563 0%, #29323c 100%)' },
  { name: '黑金暗夜', group: '高级感', css: 'linear-gradient(135deg, #232526 0%, #414345 100%)' },
  { name: '静谧蓝绿', group: '高级感', css: 'linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)' },
  { name: '银灰渐变', group: '高级感', css: 'linear-gradient(135deg, #bdc3c7 0%, #2c3e50 100%)' },
  { name: '玫瑰星云', group: '高级感', css: 'linear-gradient(135deg, #ee9ca7 0%, #ffdde1 100%)' }
];

export const GRADIENT_PRESET_GROUPS: GradientPreset['group'][] = ['暖色系', '冷色系', '自然系', '高级感'];

/** 文字渐变所需的配套属性（CSS 上用多个属性协作才能把渐变"填"进文字里） */
export const TEXT_GRADIENT_KEYS = ['backgroundImage', 'backgroundClip', 'WebkitBackgroundClip', 'WebkitTextFillColor'];

/** 一键生成"文字渐变"样式补丁 */
export function textGradientPatch(css: string): Record<string, string> {
  return {
    backgroundImage: css,
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent'
  };
}
