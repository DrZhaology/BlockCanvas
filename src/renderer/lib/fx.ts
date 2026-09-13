// BlockCanvas · 动效数值解析/合成
// 用途：伪类预制动效套用后，用滑块继续微调位移 / 缩放 / 旋转 / 阴影 / 过渡时长。
// 都是"读出来 → 改一个数 → 写回去"的轻量文本处理，不引入完整 CSS 解析器。

export interface TransformParts {
  x: number;
  y: number;
  scale: number;
  rotate: number;
}

export function parseTransform(t: string | undefined): TransformParts {
  const out: TransformParts = { x: 0, y: 0, scale: 1, rotate: 0 };
  if (!t) return out;
  const fnRe = /(translate|translateX|translateY|scale|rotate)\(\s*([-\d.]+)(?:px|deg)?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(t)) !== null) {
    const v = parseFloat(m[2]) || 0;
    switch (m[1]) {
      case 'translate': out.x = v; out.y = v; break;
      case 'translateX': out.x = v; break;
      case 'translateY': out.y = v; break;
      case 'scale': out.scale = v; break;
      case 'rotate': out.rotate = v; break;
    }
  }
  return out;
}

export function buildTransform(p: TransformParts): string {
  const parts: string[] = [];
  if (p.x !== 0) parts.push(`translateX(${round(p.x)}px)`);
  if (p.y !== 0) parts.push(`translateY(${round(p.y)}px)`);
  if (p.rotate !== 0) parts.push(`rotate(${round(p.rotate)}deg)`);
  if (p.scale !== 1) parts.push(`scale(${round(p.scale)})`);
  return parts.join(' ');
}

export function hasTransformKey(t: string | undefined, key: 'x' | 'y' | 'scale' | 'rotate'): boolean {
  if (!t) return false;
  if (key === 'x') return /translateX?\(/.test(t);
  if (key === 'y') return /translateY?\(/.test(t);
  return new RegExp(key + '\\(', 'i').test(t);
}

export interface ShadowParts {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
}

/** 解析一条 box-shadow（取第一段，够用） */
export function parseShadow(s: string | undefined): ShadowParts | null {
  if (!s || !s.trim()) return null;
  const first = s.split(/,(?![^(]*\))/)[0].trim();
  const inset = /inset/i.test(first);
  const colorMatch = first.match(/(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\s*$/);
  const nums = first.replace(/(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/g, '').replace(/inset/gi, '')
    .match(/-?[\d.]+/g);
  if (!nums || nums.length < 2) return null;
  return {
    x: parseFloat(nums[0]) || 0,
    y: parseFloat(nums[1]) || 0,
    blur: nums[2] !== undefined ? parseFloat(nums[2]) : 0,
    spread: nums[3] !== undefined ? parseFloat(nums[3]) : 0,
    color: colorMatch ? colorMatch[1] : 'rgba(0,0,0,0.2)',
    inset
  };
}

export function buildShadow(p: ShadowParts): string {
  return `${p.inset ? 'inset ' : ''}${round(p.x)}px ${round(p.y)}px ${round(p.blur)}px${p.spread ? ' ' + round(p.spread) + 'px' : ''} ${p.color}`;
}

/** 从 transition 里取第一个时长（秒） */
export function parseDuration(t: string | undefined): number {
  if (!t) return 0.3;
  const m = t.match(/([\d.]+)\s*(ms|s)\b/);
  if (!m) return 0.3;
  const v = parseFloat(m[1]);
  return m[2] === 'ms' ? v / 1000 : v;
}

export function buildTransition(seconds: number): string {
  return `all ${round(seconds)}s cubic-bezier(0.16, 1, 0.3, 1)`;
}

/** 解析 transition 的缓动（保留用户原有曲线，滑块只改时长） */
export function transitionEasing(t: string | undefined): string {
  if (!t) return 'cubic-bezier(0.16, 1, 0.3, 1)';
  const m = t.match(/(cubic-bezier\([^)]*\)|ease-in-out|ease-in|ease-out|ease|linear)/i);
  return m ? m[1] : 'ease';
}

export function parseRadius(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.match(/^([\d.]+)px$/);
  return m ? parseFloat(m[1]) : null;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
