import { createElement } from '@store/sceneStore';
import type { ElementStyle, SceneElement } from '@lib/types';

// ============================================================================
// BlockCanvas · 表格预设（v0.4.3）
//   ① 样式预设：把一整套表格外观（表头 / 分隔线 / 斑马纹 / 圆角卡片…）一键套到表格上。
//      · 表格自身的样式 → 直接写进 table 的 style；
//      · 单元格的样式   → 写进 table.childStyles（生成 `.类名 th / .类名 td` 规则，
//        导出后是一条条 CSS，而不是给每个 td 塞行内样式 —— 这才是"手写级干净代码"）；
//      · 斑马纹 / 表头底色 → 需要按行/按列区分，CSS 选择器又用不了 :nth-child
//        （见 styleClass.ts 的 isValidChildSelector），所以这两种直接落到单元格样式上。
//   ② 结构模板：一键生成一整张带样例内容的表格（价格表 / 参数对比表 / 空表）。
// ============================================================================

export interface TableStylePreset {
  id: string;
  name: string;
  desc: string;
  /** 套到 <table> 本体 */
  table: Partial<ElementStyle>;
  /** 子元素规则（sel 只允许 标签/.类/#id 组合，不能带伪类） */
  children: { sel: string; css: string }[];
  /** 表头行底色（写到 th 上） */
  headBg?: string;
  headColor?: string;
  /** 斑马纹：偶数数据行底色（写到该行所有单元格上） */
  zebra?: string;
}

export const TABLE_STYLE_PRESETS: TableStylePreset[] = [
  {
    id: 'plain',
    name: '简洁线框',
    desc: '一条外框 + 浅色分隔线，最通用的商务表格',
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
      borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid',
      borderTopColor: '#e2e8f0', borderRightColor: '#e2e8f0', borderBottomColor: '#e2e8f0', borderLeftColor: '#e2e8f0',
      fontSize: '13px',
      color: '#1f2937',
      backgroundColor: '#ffffff'
    },
    children: [
      { sel: 'th', css: 'padding: 9px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; font-weight: 600;' },
      { sel: 'td', css: 'padding: 9px 12px; border-bottom: 1px solid #eef2f7;' }
    ],
    headBg: '#f8fafc'
  },
  {
    id: 'zebra',
    name: '斑马纹',
    desc: '隔行浅灰，行数多也看得清 —— 数据报表首选',
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
      borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid',
      borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb', borderLeftColor: '#e5e7eb',
      fontSize: '13px',
      color: '#111827',
      backgroundColor: '#ffffff'
    },
    children: [
      { sel: 'th', css: 'padding: 9px 12px; text-align: left; font-weight: 700; border-bottom: 1px solid #d7dee8;' },
      { sel: 'td', css: 'padding: 9px 12px;' }
    ],
    headBg: '#eef2f7',
    zebra: '#f8fafc'
  },
  {
    id: 'dark-head',
    name: '深色表头',
    desc: '深底白字表头，数据区保持干净 —— 现代仪表盘风格',
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
      borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid',
      borderTopColor: '#cbd5e1', borderRightColor: '#cbd5e1', borderBottomColor: '#cbd5e1', borderLeftColor: '#cbd5e1',
      fontSize: '13px',
      color: '#1f2937',
      backgroundColor: '#ffffff'
    },
    children: [
      { sel: 'th', css: 'padding: 10px 12px; text-align: left; font-weight: 600;' },
      { sel: 'td', css: 'padding: 9px 12px; border-bottom: 1px solid #eef2f7;' }
    ],
    headBg: '#1e293b',
    headColor: '#ffffff',
    zebra: '#fbfdff'
  },
  {
    id: 'card',
    name: '圆角卡片',
    desc: '无外框、圆角 + 轻阴影，像一张卡片浮在页面里',
    table: {
      width: '100%',
      borderCollapse: 'separate',
      borderSpacing: '0px',
      borderRadius: '10px',
      overflow: 'hidden',
      boxShadow: '0 6px 20px rgba(15, 23, 42, 0.08)',
      fontSize: '13px',
      color: '#1f2937',
      backgroundColor: '#ffffff'
    },
    children: [
      { sel: 'th', css: 'padding: 10px 14px; text-align: left; font-weight: 600;' },
      { sel: 'td', css: 'padding: 10px 14px; border-bottom: 1px solid #eef2f7;' }
    ],
    headBg: '#f1f5f9',
    zebra: '#fafbfc'
  },
  {
    id: 'report',
    name: '报告纸张',
    desc: '全网格线 + 灰底表头，像打印出来的正式报表',
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
      borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid',
      borderTopColor: '#cbd5e1', borderRightColor: '#cbd5e1', borderBottomColor: '#cbd5e1', borderLeftColor: '#cbd5e1',
      fontSize: '12.5px',
      color: '#0f172a',
      backgroundColor: '#ffffff'
    },
    children: [
      { sel: 'th', css: 'padding: 8px 10px; text-align: left; font-weight: 700; border: 1px solid #cbd5e1;' },
      { sel: 'td', css: 'padding: 8px 10px; border: 1px solid #dbe2ea;' }
    ],
    headBg: '#eef2f7'
  },
  {
    id: 'borderless',
    name: '极简无边框',
    desc: '只有表头一条底线，最轻量的清单式表格',
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '13.5px',
      color: '#111827',
      backgroundColor: 'transparent'
    },
    children: [
      { sel: 'th', css: 'padding: 10px 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #111827;' },
      { sel: 'td', css: 'padding: 10px 12px; border-bottom: 1px solid #f1f5f9;' }
    ]
  }
];

const cellList = (table: SceneElement): SceneElement[] => {
  const out: SceneElement[] = [];
  const walk = (n: SceneElement) => {
    if (n.type === 'th' || n.type === 'td') out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(table);
  return out;
};

/**
 * 把样式预设套到整张表格上（返回新树，id 全部保留）。
 * @param table        目标表格
 * @param preset       预设
 * @param className    表格要挂的类名（childStyles 需要挂靠点；为空则用 "data-table"）
 */
export function applyTableStylePreset(table: SceneElement, preset: TableStylePreset, className: string): SceneElement {
  const next = JSON.parse(JSON.stringify(table)) as SceneElement;
  const cls = (next.attrs?.className ?? '').trim() || className || 'data-table';
  next.attrs = { ...(next.attrs ?? {}), className: cls };
  next.style = { ...next.style, ...preset.table };

  // 子元素规则：同 sel 覆盖，其他保留
  const kept = (next.childStyles ?? []).filter((cs) => !preset.children.some((p) => p.sel === cs.sel));
  next.childStyles = [...kept, ...preset.children.map((p) => ({ sel: p.sel, css: p.css }))];

  // 表头底色 / 字色 → 直接写到 th
  const cells = cellList(next);
  for (const c of cells) {
    if (c.type !== 'th') continue;
    if (preset.headBg) c.style = { ...c.style, backgroundColor: preset.headBg };
    if (preset.headColor) c.style = { ...c.style, color: preset.headColor };
    else if (preset.headBg) {
      const s = { ...c.style };
      if (s.color === '#ffffff' && !preset.headColor) delete s.color;
      c.style = s;
    }
  }

  // 斑马纹 → 偶数数据行（tbody 内第 2/4/6… 行）整行底色
  const tbody = next.children.find((c) => c.type === 'tbody');
  const bodyRows = (tbody ? tbody.children : next.children).filter((c) => c.type === 'tr');
  bodyRows.forEach((row, i) => {
    const even = (i + 1) % 2 === 0;
    for (const cell of row.children) {
      if (cell.type !== 'th' && cell.type !== 'td') continue;
      const s = { ...cell.style };
      if (preset.zebra && even) s.backgroundColor = preset.zebra;
      else if (s.backgroundColor === '#f8fafc' || s.backgroundColor === '#fbfdff' || s.backgroundColor === '#fafbfc') delete s.backgroundColor;
      cell.style = s;
    }
  });

  return next;
}

// ============ 结构模板：一键生成一整张带样例内容的表 ============

function th(text: string, scope = 'col'): SceneElement {
  const el = createElement('th');
  el.text = text;
  el.attrs = { scope };
  el.style = { backgroundColor: '#f1f5f9' };
  return el;
}
function td(text: string): SceneElement {
  const el = createElement('td');
  el.text = text;
  el.style = {};
  return el;
}
function tr(cells: SceneElement[]): SceneElement {
  const el = createElement('tr');
  el.text = undefined;
  el.style = {};
  el.children = cells;
  return el;
}
function section(type: 'thead' | 'tbody' | 'tfoot', rows: SceneElement[]): SceneElement {
  const el = createElement(type);
  el.text = undefined;
  el.style = {};
  el.children = rows;
  return el;
}

export interface TableStructureTemplate {
  id: string;
  name: string;
  desc: string;
  build: () => SceneElement;
}

export const TABLE_STRUCTURE_TEMPLATES: TableStructureTemplate[] = [
  {
    id: 'blank-3x3',
    name: '空白 3×3',
    desc: '带表头的一张三列空表，最省事的起点',
    build: () => {
      const table = createElement('table');
      table.style = { width: '100%', backgroundColor: '#ffffff' };
      table.children = [
        section('thead', [tr([th('列 1'), th('列 2'), th('列 3')])]),
        section('tbody', [
          tr([td('单元格'), td('单元格'), td('单元格')]),
          tr([td('单元格'), td('单元格'), td('单元格')])
        ])
      ];
      return table;
    }
  },
  {
    id: 'price',
    name: '价格方案表',
    desc: '三档方案 + 价格 + 说明，带表尾总结行',
    build: () => {
      const table = createElement('table');
      table.style = { width: '100%', backgroundColor: '#ffffff' };
      table.children = [
        createElement('caption'),
        section('thead', [tr([th('方案'), th('价格'), th('包含内容')])]),
        section('tbody', [
          tr([th('基础版', 'row'), td('¥0 / 月'), td('个人使用 · 1 个项目 · 社区支持')]),
          tr([th('专业版', 'row'), td('¥49 / 月'), td('10 个项目 · 优先支持 · 全部模板')]),
          tr([th('团队版', 'row'), td('¥199 / 月'), td('不限项目 · 5 人协作 · 专属顾问')])
        ]),
        section('tfoot', [tr([td('以上价格含税'), td('—'), td('可随时升级或退款')])])
      ];
      const cap = table.children[0];
      cap.text = '价格方案对比';
      return table;
    }
  },
  {
    id: 'spec',
    name: '参数对比表',
    desc: '首列做行头，横向对比两款产品的参数',
    build: () => {
      const table = createElement('table');
      table.style = { width: '100%', backgroundColor: '#ffffff' };
      table.children = [
        section('thead', [tr([th('参数'), th('产品 A'), th('产品 B'), th('产品 C')])]),
        section('tbody', [
          tr([th('屏幕尺寸', 'row'), td('6.1 英寸'), td('6.7 英寸'), td('5.4 英寸')]),
          tr([th('电池容量', 'row'), td('3200 mAh'), td('4400 mAh'), td('2800 mAh')]),
          tr([th('重量', 'row'), td('174 g'), td('206 g'), td('133 g')]),
          tr([th('起售价', 'row'), td('¥4999'), td('¥5999'), td('¥3999')])
        ])
      ];
      return table;
    }
  },
  {
    id: 'schedule',
    name: '日程安排表',
    desc: '时间 × 星期 的日程网格，适合排班与课程表',
    build: () => {
      const table = createElement('table');
      table.style = { width: '100%', backgroundColor: '#ffffff' };
      const days = ['时间', '周一', '周二', '周三', '周四', '周五'];
      table.children = [
        section('thead', [tr(days.map((d, i) => th(d, i === 0 ? 'row' : 'col')))]),
        section('tbody', [
          tr([th('09:00', 'row'), td('例会'), td('—'), td('需求评审'), td('—'), td('周会')]),
          tr([th('14:00', 'row'), td('开发'), td('开发'), td('开发'), td('联调'), td('复盘')]),
          tr([th('19:00', 'row'), td('—'), td('健身'), td('—'), td('健身'), td('—')])
        ])
      ];
      return table;
    }
  }
];
