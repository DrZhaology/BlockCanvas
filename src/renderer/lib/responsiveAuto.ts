import { getEffectiveStyle } from '@store/sceneStore';
import type { SceneElement } from './types';

// BlockCanvas · 响应式「整页自动适配」规划器
//
// 目标：切到平板 / 手机断点后，一键把整页按小屏规则批量重排 —— 而不是逐个元素手改。
// 这里只**计算建议**（纯函数，不写 store），由调用方确认后一次性写入（一条撤销即可回退）。
//
// 规则（按小屏阅读体验，且只处理"还没在当前断点覆盖过"的属性，避免覆盖用户已有定制）：
//   1. 固定宽度太宽 → width: 100%（+ box-sizing: border-box）
//   2. 横排 flex 容器且有多个子元素 → flex-direction: column
//   3. 多列 grid 容器 → grid-template-columns: 1fr
//   4. 过大的内边距 → 按 0.6 缩放
//   5. 过大的字号 → 按 0.8 缩放
//   6. 过大的 gap → 按 0.75 缩放
//   7. 强制不换行的文本 → white-space: normal（否则小屏会横向溢出）

export type Breakpoint = 'tablet' | 'mobile';

export interface RespFix {
  id: string;
  type: string;
  label: string;
  patch: Record<string, string | undefined>;
  reasons: string[];
}

/** 判定阈值：不同设备用不同上限 */
const LIMITS: Record<Breakpoint, {
  maxWidth: number;
  maxPadding: number;
  maxFontSize: number;
  maxGap: number;
}> = {
  tablet: { maxWidth: 820, maxPadding: 28, maxFontSize: 34, maxGap: 22 },
  mobile: { maxWidth: 480, maxPadding: 18, maxFontSize: 28, maxGap: 16 }
};

function px(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(-?\d+(?:\.\d+)?)px$/i.exec(v.trim());
  return m ? parseFloat(m[1]) : null;
}

function scalePx(v: string, factor: number, min = 0): string {
  const n = px(v);
  if (n === null) return v;
  return Math.max(min, Math.round(n * factor)) + 'px';
}

function isContainerType(t: string): boolean {
  return ['div', 'section', 'header', 'nav', 'main', 'article', 'aside', 'figure', 'footer', 'form', 'ul', 'ol', 'table'].includes(t);
}

export function planResponsiveFixes(root: SceneElement, bp: Breakpoint): RespFix[] {
  const lim = LIMITS[bp];
  const out: RespFix[] = [];

  const walk = (n: SceneElement): void => {
    if (n.id !== root.id) {
      const eff = (getEffectiveStyle(n, bp) ?? {}) as Record<string, string | undefined>;
      const overridden = (k: string): boolean => {
        const own = (n.responsive?.[bp] ?? {}) as Record<string, unknown>;
        return Object.prototype.hasOwnProperty.call(own, k) && own[k] !== undefined && own[k] !== '';
      };
      const patch: Record<string, string | undefined> = {};
      const reasons: string[] = [];

      // 1. 固定宽度过宽
      const w = px(n.style.width ?? eff.width);
      if (w !== null && w > lim.maxWidth && !overridden('width')) {
        patch.width = '100%';
        patch.boxSizing = 'border-box';
        reasons.push(`固定宽度 ${w}px 超出小屏，改为 100% 自适应`);
      }

      // 2. 横排 flex 容器 → 竖排
      const disp = eff.display ?? '';
      const dir = eff.flexDirection ?? 'row';
      if (
        (disp === 'flex' || disp === 'inline-flex') &&
        dir.startsWith('row') &&
        n.children.length >= 2 &&
        !overridden('flexDirection')
      ) {
        patch.flexDirection = 'column';
        reasons.push('横排容器改为竖排，避免卡片被压成细条');
      }

      // 3. 多列网格 → 单列
      const gtc = eff.gridTemplateColumns ?? '';
      if ((disp === 'grid' || disp === 'inline-grid') && gtc && !overridden('gridTemplateColumns')) {
        const repeatMatch = /repeat\(\s*(\d+)/.exec(gtc);
        const trackCount = gtc.trim().split(/\s+(?![^(]*\))/).length;
        const multi = (repeatMatch && parseInt(repeatMatch[1], 10) >= 2) || (!repeatMatch && trackCount >= 2);
        if (multi) {
          patch.gridTemplateColumns = '1fr';
          reasons.push('多列网格改为单列，小屏更好读');
        }
      }

      // 4. 内边距过大
      for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
        const v = eff[k];
        const n2 = px(v);
        if (n2 !== null && n2 > lim.maxPadding && !overridden(k)) {
          patch[k] = scalePx(v!, 0.6);
          reasons.push('内边距按 60% 收紧');
          break;
        }
      }

      // 5. 字号过大
      const fs = px(eff.fontSize);
      if (fs !== null && fs > lim.maxFontSize && !overridden('fontSize')) {
        patch.fontSize = scalePx(eff.fontSize!, 0.8, 14);
        reasons.push(`字号 ${fs}px 按 80% 缩小`);
      }

      // 6. 间距过大
      const gap = px(eff.gap);
      if (gap !== null && gap > lim.maxGap && !overridden('gap')) {
        patch.gap = scalePx(eff.gap!, 0.75, 8);
        reasons.push('元素间距按 75% 收紧');
      }

      // 7. 强制不换行
      if (eff.whiteSpace === 'nowrap' && !overridden('whiteSpace') && isContainerType(n.type)) {
        patch.whiteSpace = 'normal';
        reasons.push('取消强制不换行，避免横向溢出');
      }

      if (Object.keys(patch).length > 0) {
        out.push({
          id: n.id,
          type: n.type,
          label: n.attrs?.className?.trim()
            ? `.${n.attrs.className.trim().split(/\s+/)[0]}`
            : (n.text ? `“${n.text.slice(0, 10)}”` : `<${n.type}>`),
          patch,
          reasons
        });
      }
    }
    for (const c of n.children) walk(c);
  };

  walk(root);
  return out;
}
