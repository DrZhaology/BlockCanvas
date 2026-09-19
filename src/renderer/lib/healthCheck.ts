// BlockCanvas · 导出前体检（Health Check）
//
// 目标：把「导出后才发现网页不对」这类问题，前置到导出之前，并且每条都能一键修。
// 设计原则：
//  1. 只做**确定性诊断**——不猜风格、不替用户做审美决定，只报一定能说清因果的问题。
//  2. 每条问题都带「去修复」动作：能自动修的给一键修，不能自动修的把用户送到对应面板。
//  3. 分级：critical（导出必错 / 效果必丢）> warn（不优雅）> info（提示）。
//
// 本模块是纯逻辑（不 import React），工具栏 ⚠ 面板与「导出前体检」向导共用同一份结果。

import { useScene } from '@store/sceneStore';
import { styleToCssText, simplifyStyle } from '@lib/styleClass';
import { isValidClassToken } from '@lib/classColor';
import type { SceneElement } from '@lib/types';

export type Severity = 'critical' | 'warn' | 'info';

export interface HealthIssue {
  /** 稳定 id（同一条问题在多次扫描间保持一致） */
  id: string;
  severity: Severity;
  /** 一句话标题（列表里的大字） */
  title: string;
  /** 为什么这是问题（列表里的小字，讲因果不讲术语） */
  detail: string;
  /** 一键修复按钮文案；没给说明不能自动修 */
  fixLabel?: string;
  /** 一键修复（已经包好 beginStyleEdit/endStyleEdit，调用方无需再包） */
  fix?: () => void;
  /** 「定位」按钮跳到这个元素 */
  locateId?: string;
  /** 「去处理」按钮打开的目标面板 */
  goto?: 'class' | 'inspector';
}

// ============ 工具 ============

/** 收集树里所有非根节点 */
function collect(root: SceneElement): SceneElement[] {
  const out: SceneElement[] = [];
  const walk = (n: SceneElement) => {
    for (const c of n.children) {
      out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** 元素的"名字"：关系选择器 > 类名 > ID。没有则为空 */
function nameOf(n: SceneElement): { kind: 'rel' | 'class' | 'id' | ''; value: string } {
  const rel = (n.attrs?.relSelector ?? '').trim();
  if (rel) return { kind: 'rel', value: rel };
  const cls = (n.attrs?.className ?? '').trim();
  if (cls) return { kind: 'class', value: cls };
  const idv = (n.attrs?.id ?? '').trim();
  if (idv) return { kind: 'id', value: idv };
  return { kind: '', value: '' };
}

/** 已有伪类样式的状态名（hover / active / focus …） */
function pseudoStates(n: SceneElement): string[] {
  return Object.entries(n.pseudoStyles ?? {})
    .filter(([, v]) => v && Object.keys(v).length > 0)
    .map(([k]) => k);
}

/** 依据标签 + 现有类名生成不重复的类名（如 card / card-2） */
function suggestClassName(n: SceneElement, used: Set<string>): string {
  const base = (n.type || 'box').replace(/[^a-zA-Z0-9_-]/g, '') || 'box';
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

// ============ 主扫描 ============

export function runHealthCheck(root: SceneElement): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const all = collect(root);
  if (all.length === 0) {
    issues.push({
      id: 'empty',
      severity: 'info',
      title: '画布还是空的',
      detail: '从左侧「元素」面板点一个元素插入画布，就可以开始排版了。',
      goto: 'inspector'
    });
    return issues;
  }

  // —— 预先统计：已用类名、ID 占用、同名样式差异 ——
  const usedNames = new Set<string>();
  for (const n of all) {
    const nm = nameOf(n);
    if (nm.kind === 'class') for (const t of nm.value.split(/\s+/)) if (t) usedNames.add(t);
    if (nm.kind === 'id') usedNames.add(nm.value);
  }
  const styleByName = new Map<string, string[]>();
  const idOwners = new Map<string, string[]>();
  for (const n of all) {
    const nm = nameOf(n);
    if (nm.kind === 'class' || nm.kind === 'rel') {
      const list = styleByName.get(nm.value) ?? [];
      list.push(styleToCssText(simplifyStyle(n.style)));
      styleByName.set(nm.value, list);
    }
    if (nm.kind === 'id') {
      const list = idOwners.get(nm.value) ?? [];
      list.push(n.id);
      idOwners.set(nm.value, list);
    }
  }

  // ① 伪类样式但元素没名字 —— 导出后 :hover 一定不生效（最容易被忽略）
  const pseudoRisk = all.filter((n) => pseudoStates(n).length > 0 && !nameOf(n).kind);
  if (pseudoRisk.length > 0) {
    const states = [...new Set(pseudoRisk.flatMap(pseudoStates))].map((s) => ':' + s).join(' ');
    issues.push({
      id: 'pseudo-no-name',
      severity: 'critical',
      title: `${pseudoRisk.length} 个元素写了悬停/点击效果，却没有类名`,
      detail:
        `这些元素用了 ${states} 效果，但没有类名也没有 ID，导出的 CSS 找不到它们，效果会全部丢失。\n` +
        `一键修复 = 自动按标签起好类名（如 .btn / .card），并把规则挂上去。`,
      fixLabel: '自动起类名',
      fix: () => {
        const st = useScene.getState();
        st.beginStyleEdit();
        for (const n of pseudoRisk) {
          const name = suggestClassName(n, usedNames);
          usedNames.add(name);
          st.updateAttr(n.id, 'className', name);
        }
        st.endStyleEdit();
      },
      goto: 'class'
    });
  }

  // ② 未命名元素（样式只能写成行内，后续改起来很累）
  const unnamed = all.filter((n) => !nameOf(n).kind);
  if (unnamed.length > 0) {
    issues.push({
      id: 'unnamed',
      severity: 'warn',
      title: `${unnamed.length} 个元素没有类名 / ID`,
      detail:
        '没有名字的元素，样式只能逐条写成行内 style —— 网页能跑，但以后想改「所有卡片」，得一个一个改。\n' +
        '起了类名之后，改一处就能让所有同类元素一起变。',
      fixLabel: '全部自动起名',
      fix: () => {
        const st = useScene.getState();
        st.beginStyleEdit();
        for (const n of unnamed) {
          const name = suggestClassName(n, usedNames);
          usedNames.add(name);
          st.updateAttr(n.id, 'className', name);
        }
        st.endStyleEdit();
      },
      goto: 'class'
    });
  }

  // ③ 重复 ID —— HTML 规范里 ID 必须唯一
  const dupIds: { name: string; ids: string[] }[] = [];
  for (const [name, ids] of idOwners) {
    if (ids.length > 1) dupIds.push({ name, ids });
  }
  if (dupIds.length > 0) {
    issues.push({
      id: 'dup-id',
      severity: 'critical',
      title: `${dupIds.length} 个 ID 被重复使用`,
      detail:
        '同一个 ID 在网页里只能出现一次。重复后浏览器只认第一个，后面的样式与跳转都可能失效。\n' +
        '一键修复 = 保留第一个，其余自动加序号。',
      fixLabel: '自动去重',
      fix: () => {
        const st = useScene.getState();
        st.beginStyleEdit();
        for (const d of dupIds) {
          for (let i = 1; i < d.ids.length; i += 1) {
            let nname = `${d.name}-${i + 1}`;
            let guard = 0;
            while (usedNames.has(nname) && guard < 99) { guard += 1; nname = `${d.name}-${i + 1 + guard}`; }
            usedNames.add(nname);
            st.updateAttr(d.ids[i], 'id', nname);
          }
        }
        st.endStyleEdit();
      },
      goto: 'class'
    });
  }

  // ④ 同名类名但样式不一致 —— 导出的 CSS 会互相覆盖，谁生效看运气
  const conflicts: { name: string; count: number }[] = [];
  for (const [name, list] of styleByName) {
    if (new Set(list).size > 1) conflicts.push({ name, count: list.length });
  }
  if (conflicts.length > 0) {
    issues.push({
      id: 'class-conflict',
      severity: 'warn',
      title: `${conflicts.length} 个名称的样式不统一`,
      detail:
        '叫同一个名字，写的样式却不一样（例如两个 .card 一个红一个蓝）。导出后 CSS 里同名规则互相覆盖，最终长什么样不确定。\n' +
        '一键修复 = 以第一个元素的样式为准，统一所有同名元素。',
      fixLabel: '统一为第一个',
      fix: () => {
        const st = useScene.getState();
        st.beginStyleEdit();
        for (const c of conflicts) {
          const first = all.find((n) => nameOf(n).value === c.name);
          if (first) st.unifyClassName(c.name, first.style, 'class');
        }
        st.endStyleEdit();
      },
      goto: 'class'
    });
  }

  // ⑤ 非法类名 —— CSS 里根本选不中
  const badNames = all.filter((n) => {
    const cls = (n.attrs?.className ?? '').trim();
    if (!cls) return false;
    return cls.split(/\s+/).some((t) => t && !isValidClassToken(t));
  });
  if (badNames.length > 0) {
    issues.push({
      id: 'bad-name',
      severity: 'critical',
      title: `${badNames.length} 个元素的类名不合法`,
      detail:
        '类名里出现了 CSS 不允许的字符（比如中文、空格、数字开头、以 -数字 开头）。\n' +
        '这类名字在 CSS 里选不中，样式会静默失效 —— 去「类名 · ID 总览」改成英文小写字母开头的名字即可。',
      goto: 'class'
    });
  }

  // ⑥ 图片缺 alt —— 可访问性与 SEO
  const imgsNoAlt = all.filter((n) => n.type === 'img' && !(n.attrs?.alt ?? '').trim());
  if (imgsNoAlt.length > 0) {
    issues.push({
      id: 'img-alt',
      severity: 'info',
      title: `${imgsNoAlt.length} 张图片没有替代文字`,
      detail:
        '图片加载失败或读屏软件朗读时，alt 就是它的名字。不影响网页显示，但属于「能做好就做好」的细节。',
      locateId: imgsNoAlt[0].id,
      goto: 'inspector'
    });
  }

  // ⑦ 空链接 —— a 标签没有 href，点击没反应
  const emptyLinks = all.filter((n) => n.type === 'a' && !(n.attrs?.href ?? '').trim());
  if (emptyLinks.length > 0) {
    issues.push({
      id: 'empty-link',
      severity: 'warn',
      title: `${emptyLinks.length} 个链接没有填写地址`,
      detail: '「链接」元素没有 href，点击不会跳转。至少先填个 # 占位。',
      locateId: emptyLinks[0].id,
      goto: 'inspector'
    });
  }

  // ⑧ 固定像素宽度在小屏可能横向溢出（只提示，不自动改）
  const fixedWide = all.filter((n) => {
    const w = (n.style?.width ?? '').trim();
    const m = /^(\d+(?:\.\d+)?)px$/.exec(w);
    return !!m && Number(m[1]) > 360;
  });
  if (fixedWide.length > 0) {
    issues.push({
      id: 'fixed-width',
      severity: 'info',
      title: `${fixedWide.length} 个元素写了固定宽度且大于 360px`,
      detail:
        '手机屏幕通常只有 375px 宽。宽度写死后窄屏会出现横向滚动条。\n' +
        '在「手机」断点下用「✨ 整页自动适配」可以一键改成自适应。',
      locateId: fixedWide[0].id,
      goto: 'inspector'
    });
  }

  const rank: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function countBySeverity(issues: HealthIssue[]): Record<Severity, number> {
  const c: Record<Severity, number> = { critical: 0, warn: 0, info: 0 };
  for (const i of issues) c[i.severity] += 1;
  return c;
}

/** 是否存在「导出必错」级别的问题（用于导出前拦截） */
export function hasBlocking(issues: HealthIssue[]): boolean {
  return issues.some((i) => i.severity === 'critical');
}
