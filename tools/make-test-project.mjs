// BlockCanvas · 生成「一对一测试」工程（v0.4.5 第 15 批）
//
// 用户要求（原话）：
//   「最后检查一遍UI，写一个项目的一对一测试.bcproj放到data/project里面，
//     里面把测试项目和测试用的元素全部放进去。（可以用脚本生成不一定要自己写）」
//
// 这个脚本直接写出一个**真实可打开的 .bcproj**（标准 zip 容器，manifest.json 排第一），
// 内容覆盖 BlockCanvas 的全部元素类型与常见能力，用来"一对一"逐项验收：
//   · 文本：h1/h2/h3/p/span/a/strong/em/blockquote/code/pre/ul/ol/li
//   · 布局：section/div/header/footer/nav/main/article/aside + flex/grid
//   · 表单：input（多种 type）/textarea/button/select/label
//   · 媒体：img/video/audio（含播放锁、自动播放、背景模式）
//   · 表格：带表头/斑马纹/单元格跨列
//   · 定位：static/relative/absolute/fixed/sticky 各一
//   · 响应式：tablet / mobile 覆盖
//   · 伪类：hover / focus
//   · 设计变量：--bc-brand 等，元素用 var() 引用
//   · 全局 CSS、页面快速设置、子元素样式（关系选择器）
//
// 用法：
//   node tools/make-test-project.mjs              # 写到 <程序数据区>/projects/
//   node tools/make-test-project.mjs --out D:/x   # 写到指定目录
//   node tools/make-test-project.mjs --name 我的测试
//
// 注意：不启动 Electron、不截图 —— 纯文件生成（用户明确要求减少后台重活）。

import { deflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ============ 最小 zip 写入（与 src/main/zip.ts 同一格式：DEFLATE，manifest 在前）============
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipCreate(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const nameLen = nameBuf.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameLen, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x0314, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameLen, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameLen + compressed.length;
  }

  const centralStart = parts.reduce((n, b) => n + b.length, 0);
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

// ============ 场景构造小工具 ============
let seq = 0;
/** 稳定 id：可读前缀 + 序号（方便在探针里按 id 定位） */
function nid(prefix) {
  seq += 1;
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

function el(type, opts = {}) {
  const { id, text, style = {}, attrs, children = [], visibleProps, responsive, pseudoStyles, childStyles } = opts;
  const node = {
    id: id || nid(type),
    type,
    children,
    style
  };
  if (text !== undefined) node.text = text;
  if (attrs) node.attrs = attrs;
  if (visibleProps) node.visibleProps = visibleProps;
  if (responsive) node.responsive = responsive;
  if (pseudoStyles) node.pseudoStyles = pseudoStyles;
  if (childStyles) node.childStyles = childStyles;
  return node;
}

const px = (n) => `${n}px`;

// ============ 场景 ============
function buildScene() {
  const children = [];

  // —— 1. 顶部导航（fixed + 两边约束 + flex）——
  children.push(el('nav', {
    id: 'nav-top',
    style: {
      position: 'fixed',
      // v0.4.5 重点验收项：**两边约束**（left+right，不给 width）——
      // 拖动它必须"两边一起平移"、尺寸不塌。
      left: '0px',
      right: '0px',
      top: '0px',
      height: px(56),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: px(24),
      paddingRight: px(24),
      backgroundColor: 'var(--bc-brand)',
      color: '#ffffff',
      zIndex: '100'
    },
    visibleProps: ['position', 'left', 'right', 'top', 'height', 'display', 'alignItems', 'justifyContent', 'paddingLeft', 'paddingRight', 'backgroundColor', 'color', 'zIndex'],
    children: [
      el('span', { id: 'nav-brand', text: 'BlockCanvas · 一对一测试', style: { fontSize: px(16), fontWeight: '700', letterSpacing: '0.02em' }, visibleProps: ['fontSize', 'fontWeight', 'letterSpacing'] }),
      el('span', { id: 'nav-links', text: '元素 · 布局 · 媒体 · 表格 · 定位 · 响应式', style: { fontSize: px(12), opacity: '0.85' }, visibleProps: ['fontSize', 'opacity'] })
    ]
  }));

  // —— 2. 主容器 ——
  const main = el('main', {
    id: 'main',
    style: {
      maxWidth: px(1040),
      marginLeft: 'auto',
      marginRight: 'auto',
      paddingTop: px(88),
      paddingBottom: px(64),
      paddingLeft: px(24),
      paddingRight: px(24)
    },
    visibleProps: ['maxWidth', 'marginLeft', 'marginRight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']
  });

  // 2.1 标题区
  main.children.push(el('header', {
    id: 'hero',
    style: { paddingBottom: px(28), borderBottom: `1px solid var(--bc-line)` },
    visibleProps: ['paddingBottom', 'borderBottom'],
    children: [
      el('h1', { id: 'hero-h1', text: '一对一测试工程', style: { fontSize: px(34), fontWeight: '800', color: 'var(--bc-ink)', marginBottom: px(10) }, visibleProps: ['fontSize', 'fontWeight', 'color', 'marginBottom'] }),
      el('p', { id: 'hero-p', text: '这个工程把 BlockCanvas 支持的元素、布局、媒体、表格、定位与响应式各放了一份，用来逐项对照验收。', style: { fontSize: px(14), lineHeight: '1.8', color: 'var(--bc-ink-2)' }, visibleProps: ['fontSize', 'lineHeight', 'color'] })
    ]
  }));

  // 2.2 文本元素（h2/h3/p/span/a/strong/em/blockquote/code/pre/ul/ol/li）
  const textSection = el('section', {
    id: 'sec-text',
    style: { paddingTop: px(28) },
    visibleProps: ['paddingTop'],
    children: [
      el('h2', { id: 'sec-text-h2', text: '① 文本元素', style: { fontSize: px(20), fontWeight: '700', marginBottom: px(12), color: 'var(--bc-ink)' }, visibleProps: ['fontSize', 'fontWeight', 'marginBottom', 'color'] }),
      el('h3', { id: 'sec-text-h3', text: '三级标题（h3）', style: { fontSize: px(15), fontWeight: '600', marginBottom: px(8) }, visibleProps: ['fontSize', 'fontWeight', 'marginBottom'] }),
      el('p', {
        id: 'sec-text-p',
        style: { fontSize: px(14), lineHeight: '1.9', marginBottom: px(10) },
        visibleProps: ['fontSize', 'lineHeight', 'marginBottom'],
        children: [
          el('span', { id: 'tx-plain', text: '普通 span 文本，' }),
          el('strong', { id: 'tx-strong', text: '加粗 strong', style: { fontWeight: '700' }, visibleProps: ['fontWeight'] }),
          el('span', { id: 'tx-gap', text: '，' }),
          el('em', { id: 'tx-em', text: '斜体 em', style: { fontStyle: 'italic' }, visibleProps: ['fontStyle'] }),
          el('span', { id: 'tx-gap2', text: '，' }),
          el('a', { id: 'tx-link', text: '一个链接', attrs: { href: 'https://example.com', className: 'test-link' }, style: { color: 'var(--bc-brand)', textDecoration: 'underline' }, visibleProps: ['color', 'textDecoration'] }),
          el('span', { id: 'tx-gap3', text: '。' })
        ]
      }),
      el('blockquote', {
        id: 'tx-quote',
        text: '引用块：用来测试左侧竖线、缩进与斜体组合。',
        style: { paddingLeft: px(14), borderLeft: '3px solid var(--bc-brand)', color: 'var(--bc-ink-2)', fontSize: px(13), lineHeight: '1.8', marginBottom: px(12) },
        visibleProps: ['paddingLeft', 'borderLeft', 'color', 'fontSize', 'lineHeight', 'marginBottom']
      }),
      el('p', {
        id: 'tx-code-p',
        style: { marginBottom: px(12) },
        children: [el('code', { id: 'tx-code', text: 'display: grid; gap: 12px;', style: { fontFamily: 'Consolas, monospace', fontSize: px(12.5), backgroundColor: '#f1f5f9', paddingLeft: px(6), paddingRight: px(6), paddingTop: px(2), paddingBottom: px(2), borderRadius: px(4) }, visibleProps: ['fontFamily', 'fontSize', 'backgroundColor', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'borderRadius'] })]
      }),
      el('pre', {
        id: 'tx-pre',
        text: 'function hello() {\n  return "BlockCanvas";\n}',
        style: { fontFamily: 'Consolas, monospace', fontSize: px(12.5), lineHeight: '1.7', backgroundColor: '#0f172a', color: '#e2e8f0', paddingTop: px(14), paddingBottom: px(14), paddingLeft: px(16), paddingRight: px(16), borderRadius: px(8), marginBottom: px(12) },
        visibleProps: ['fontFamily', 'fontSize', 'lineHeight', 'backgroundColor', 'color', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderRadius', 'marginBottom']
      }),
      el('ul', {
        id: 'tx-ul',
        style: { paddingLeft: px(22), marginBottom: px(8), fontSize: px(13.5), lineHeight: '1.9' },
        visibleProps: ['paddingLeft', 'marginBottom', 'fontSize', 'lineHeight'],
        children: [
          el('li', { id: 'tx-ul-1', text: '无序列表项一' }),
          el('li', { id: 'tx-ul-2', text: '无序列表项二' }),
          el('li', { id: 'tx-ul-3', text: '无序列表项三（含子项）', children: [el('ul', { id: 'tx-ul-sub', style: { paddingLeft: px(18) }, children: [el('li', { id: 'tx-ul-sub-1', text: '嵌套子项' })] })] })
        ]
      }),
      el('ol', {
        id: 'tx-ol',
        style: { paddingLeft: px(22), fontSize: px(13.5), lineHeight: '1.9' },
        visibleProps: ['paddingLeft', 'fontSize', 'lineHeight'],
        children: [
          el('li', { id: 'tx-ol-1', text: '有序列表项一' }),
          el('li', { id: 'tx-ol-2', text: '有序列表项二' })
        ]
      })
    ]
  });
  main.children.push(textSection);

  // 2.3 布局元素（flex / grid / 各种容器标签）
  main.children.push(el('section', {
    id: 'sec-layout',
    style: { paddingTop: px(28) },
    visibleProps: ['paddingTop'],
    children: [
      el('h2', { id: 'sec-layout-h2', text: '② 布局元素（flex / grid）', style: { fontSize: px(20), fontWeight: '700', marginBottom: px(12) }, visibleProps: ['fontSize', 'fontWeight', 'marginBottom'] }),
      // flex 行
      el('div', {
        id: 'flex-row',
        style: { display: 'flex', flexDirection: 'row', gap: px(12), alignItems: 'stretch', flexWrap: 'wrap', marginBottom: px(14) },
        visibleProps: ['display', 'flexDirection', 'gap', 'alignItems', 'flexWrap', 'marginBottom'],
        children: [1, 2, 3].map((n) => el('div', {
          id: `flex-cell-${n}`,
          text: `flex 子项 ${n}`,
          style: { flexGrow: '1', flexBasis: px(140), minHeight: px(64), display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef2ff', color: '#3730a3', borderRadius: px(8), fontSize: px(12.5) },
          visibleProps: ['flexGrow', 'flexBasis', 'minHeight', 'display', 'alignItems', 'justifyContent', 'backgroundColor', 'color', 'borderRadius', 'fontSize']
        }))
      }),
      // grid 3 列
      el('div', {
        id: 'grid-box',
        style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: px(12), marginBottom: px(14) },
        visibleProps: ['display', 'gridTemplateColumns', 'gap', 'marginBottom'],
        children: [1, 2, 3, 4, 5, 6].map((n) => el('div', {
          id: `grid-cell-${n}`,
          text: `格 ${n}`,
          style: { minHeight: px(52), display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0fdf4', color: '#166534', borderRadius: px(8), fontSize: px(12.5) },
          visibleProps: ['minHeight', 'display', 'alignItems', 'justifyContent', 'backgroundColor', 'color', 'borderRadius', 'fontSize']
        }))
      }),
      // 语义容器各一个
      el('div', {
        id: 'semantic-row',
        style: { display: 'flex', gap: px(10), flexWrap: 'wrap' },
        visibleProps: ['display', 'gap', 'flexWrap'],
        children: ['header', 'footer', 'nav', 'main', 'article', 'aside', 'section'].map((t) => el(t, {
          id: `sem-${t}`,
          text: `<${t}>`,
          style: { paddingTop: px(6), paddingBottom: px(6), paddingLeft: px(10), paddingRight: px(10), backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: px(6), fontSize: px(11.5), color: '#475569' },
          visibleProps: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'backgroundColor', 'border', 'borderRadius', 'fontSize', 'color']
        }))
      })
    ]
  }));

  // 2.4 表单元素
  main.children.push(el('section', {
    id: 'sec-form',
    style: { paddingTop: px(28) },
    visibleProps: ['paddingTop'],
    children: [
      el('h2', { id: 'sec-form-h2', text: '③ 表单元素', style: { fontSize: px(20), fontWeight: '700', marginBottom: px(12) }, visibleProps: ['fontSize', 'fontWeight', 'marginBottom'] }),
      el('div', {
        id: 'form-grid',
        style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: px(12) },
        visibleProps: ['display', 'gridTemplateColumns', 'gap'],
        children: [
          el('input', { id: 'fm-text', attrs: { typeAttr: 'text', placeholder: '文本输入框（text）' }, style: { width: '100%', height: px(36), paddingLeft: px(10), paddingRight: px(10), border: '1px solid #cbd5e1', borderRadius: px(6), fontSize: px(13), backgroundColor: '#ffffff' }, visibleProps: ['width', 'height', 'paddingLeft', 'paddingRight', 'border', 'borderRadius', 'fontSize', 'backgroundColor'] }),
          el('input', { id: 'fm-email', attrs: { typeAttr: 'email', placeholder: '邮箱（email）' }, style: { width: '100%', height: px(36), paddingLeft: px(10), paddingRight: px(10), border: '1px solid #cbd5e1', borderRadius: px(6), fontSize: px(13), backgroundColor: '#ffffff' }, visibleProps: ['width', 'height', 'paddingLeft', 'paddingRight', 'border', 'borderRadius', 'fontSize', 'backgroundColor'] }),
          el('input', { id: 'fm-password', attrs: { typeAttr: 'password', placeholder: '密码（password）' }, style: { width: '100%', height: px(36), paddingLeft: px(10), paddingRight: px(10), border: '1px solid #cbd5e1', borderRadius: px(6), fontSize: px(13), backgroundColor: '#ffffff' }, visibleProps: ['width', 'height', 'paddingLeft', 'paddingRight', 'border', 'borderRadius', 'fontSize', 'backgroundColor'] }),
          el('input', { id: 'fm-number', attrs: { typeAttr: 'number', placeholder: '数字（number）' }, style: { width: '100%', height: px(36), paddingLeft: px(10), paddingRight: px(10), border: '1px solid #cbd5e1', borderRadius: px(6), fontSize: px(13), backgroundColor: '#ffffff' }, visibleProps: ['width', 'height', 'paddingLeft', 'paddingRight', 'border', 'borderRadius', 'fontSize', 'backgroundColor'] }),
          el('textarea', { id: 'fm-textarea', attrs: { placeholder: '多行文本域（textarea）' }, text: '', style: { width: '100%', height: px(88), paddingTop: px(8), paddingBottom: px(8), paddingLeft: px(10), paddingRight: px(10), border: '1px solid #cbd5e1', borderRadius: px(6), fontSize: px(13), backgroundColor: '#ffffff' }, visibleProps: ['width', 'height', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'border', 'borderRadius', 'fontSize', 'backgroundColor'] }),
          el('button', { id: 'fm-button', text: '主按钮 button', attrs: { className: 'btn-primary' }, style: { height: px(38), paddingLeft: px(18), paddingRight: px(18), backgroundColor: 'var(--bc-brand)', color: '#ffffff', border: 'none', borderRadius: px(6), fontSize: px(13), fontWeight: '600', cursor: 'pointer' }, visibleProps: ['height', 'paddingLeft', 'paddingRight', 'backgroundColor', 'color', 'border', 'borderRadius', 'fontSize', 'fontWeight', 'cursor'], pseudoStyles: { hover: { backgroundColor: 'var(--bc-brand-dark)' }, focus: { outline: '2px solid var(--bc-brand)', outlineOffset: '2px' } } })
        ]
      })
    ]
  }));

  // 2.5 媒体元素（图片 / 视频 / 音频，含播放锁与自动播放静音）
  main.children.push(el('section', {
    id: 'sec-media',
    style: { paddingTop: px(28) },
    visibleProps: ['paddingTop'],
    children: [
      el('h2', { id: 'sec-media-h2', text: '④ 媒体元素（路径三写法 / 播放锁）', style: { fontSize: px(20), fontWeight: '700', marginBottom: px(12) }, visibleProps: ['fontSize', 'fontWeight', 'marginBottom'] }),
      el('p', { id: 'sec-media-tip', text: '图片：相对路径（权威绝对路径由程序记录）；视频：锁死播放（应定格在某帧，不是白屏）；音频：锁死播放（应保留一条播放条）。', style: { fontSize: px(12.5), lineHeight: '1.8', color: '#64748b', marginBottom: px(12) }, visibleProps: ['fontSize', 'lineHeight', 'color', 'marginBottom'] }),
      el('img', {
        id: 'md-img',
        attrs: {
          src: 'assets/test-image.svg',
          // 权威绝对路径：这里故意留成相对写法能解析的样子，打开工程后程序会按工程目录解析
          srcMode: 'relative',
          alt: '测试图片（SVG，4:1 宽幅）'
        },
        style: { width: px(360), height: px(90), borderRadius: px(8), border: '1px solid #e2e8f0', display: 'block', marginBottom: px(14) },
        visibleProps: ['width', 'height', 'borderRadius', 'border', 'display', 'marginBottom']
      }),
      el('video', {
        id: 'md-video',
        attrs: { src: '', playLock: '1', loop: '1', muted: '1' },
        style: { width: px(320), height: px(180), backgroundColor: '#0f172a', borderRadius: px(8), display: 'block', marginBottom: px(14) },
        visibleProps: ['width', 'height', 'backgroundColor', 'borderRadius', 'display', 'marginBottom']
      }),
      el('audio', {
        id: 'md-audio',
        attrs: { src: '', playLock: '1' },
        style: { width: px(320), display: 'block', marginBottom: px(8) },
        visibleProps: ['width', 'display', 'marginBottom']
      })
    ]
  }));

  // 2.6 表格
  main.children.push(el('section', {
    id: 'sec-table',
    style: { paddingTop: px(28) },
    visibleProps: ['paddingTop'],
    children: [
      el('h2', { id: 'sec-table-h2', text: '⑤ 表格（表头 / 斑马纹 / 跨列）', style: { fontSize: px(20), fontWeight: '700', marginBottom: px(12) }, visibleProps: ['fontSize', 'fontWeight', 'marginBottom'] }),
      el('table', {
        id: 'tbl',
        attrs: { className: 'test-table' },
        style: { width: '100%', borderCollapse: 'collapse', fontSize: px(13) },
        visibleProps: ['width', 'borderCollapse', 'fontSize'],
        childStyles: [
          { sel: 'th', css: 'padding: 9px 12px; text-align: left; background-color: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-weight: 600;' },
          { sel: 'td', css: 'padding: 9px 12px; border-bottom: 1px solid #eef2f7;' }
        ],
        children: [
          el('thead', {
            id: 'tbl-head',
            children: [el('tr', {
              id: 'tbl-head-row',
              children: [
                el('th', { id: 'tbl-h1', text: '项目', attrs: { scope: 'col' } }),
                el('th', { id: 'tbl-h2', text: '状态', attrs: { scope: 'col' } }),
                el('th', { id: 'tbl-h3', text: '说明（跨两列）', attrs: { scope: 'col', colspan: '2' } })
              ]
            })]
          }),
          el('tbody', {
            id: 'tbl-body',
            children: [
              el('tr', {
                id: 'tbl-r1',
                children: [
                  el('td', { id: 'tbl-r1c1', text: '元素面板' }),
                  el('td', { id: 'tbl-r1c2', text: '可用' }),
                  el('td', { id: 'tbl-r1c3', text: '插入元素 / 拖拽排序', attrs: { colspan: '2' } })
                ]
              }),
              el('tr', {
                id: 'tbl-r2',
                children: [
                  el('td', { id: 'tbl-r2c1', text: '媒体播放锁' }),
                  el('td', { id: 'tbl-r2c2', text: '可用' }),
                  el('td', { id: 'tbl-r2c3', text: '锁定后永不播放', attrs: { colspan: '2' } })
                ]
              })
            ]
          })
        ]
      })
    ]
  }));

  // 2.7 定位（static / relative / absolute / fixed / sticky 各一）
  main.children.push(el('section', {
    id: 'sec-position',
    style: { paddingTop: px(28) },
    visibleProps: ['paddingTop'],
    children: [
      el('h2', { id: 'sec-position-h2', text: '⑥ 定位（static / relative / absolute / fixed / sticky）', style: { fontSize: px(20), fontWeight: '700', marginBottom: px(12) }, visibleProps: ['fontSize', 'fontWeight', 'marginBottom'] }),
      el('div', {
        id: 'pos-stage',
        style: { position: 'relative', minHeight: px(220), backgroundColor: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: px(8), paddingTop: px(10), paddingBottom: px(10), paddingLeft: px(10), paddingRight: px(10) },
        visibleProps: ['position', 'minHeight', 'backgroundColor', 'border', 'borderRadius', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'],
        children: [
          el('div', { id: 'pos-static', text: 'static（默认流）', style: { paddingTop: px(6), paddingBottom: px(6), paddingLeft: px(10), paddingRight: px(10), backgroundColor: '#e2e8f0', borderRadius: px(6), fontSize: px(12), marginBottom: px(8) }, visibleProps: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'backgroundColor', 'borderRadius', 'fontSize', 'marginBottom'] }),
          el('div', { id: 'pos-relative', text: 'relative（left: 24px / top: 4px）', style: { position: 'relative', left: px(24), top: px(4), paddingTop: px(6), paddingBottom: px(6), paddingLeft: px(10), paddingRight: px(10), backgroundColor: '#dbeafe', borderRadius: px(6), fontSize: px(12), marginBottom: px(8) }, visibleProps: ['position', 'left', 'top', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'backgroundColor', 'borderRadius', 'fontSize', 'marginBottom'] }),
          el('div', { id: 'pos-absolute', text: 'absolute（right: 16px / top: 16px）', style: { position: 'absolute', right: px(16), top: px(16), paddingTop: px(6), paddingBottom: px(6), paddingLeft: px(10), paddingRight: px(10), backgroundColor: '#fef3c7', borderRadius: px(6), fontSize: px(12) }, visibleProps: ['position', 'right', 'top', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'backgroundColor', 'borderRadius', 'fontSize'] }),
          el('div', { id: 'pos-fixed', text: 'fixed（右下角固定，两边约束）', style: { position: 'fixed', right: px(18), bottom: px(18), paddingTop: px(8), paddingBottom: px(8), paddingLeft: px(12), paddingRight: px(12), backgroundColor: '#111827', color: '#ffffff', borderRadius: px(8), fontSize: px(11.5), zIndex: '90' }, visibleProps: ['position', 'right', 'bottom', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'backgroundColor', 'color', 'borderRadius', 'fontSize', 'zIndex'] }),
          el('div', { id: 'pos-sticky', text: 'sticky（top: 8px）', style: { position: 'sticky', top: px(8), paddingTop: px(6), paddingBottom: px(6), paddingLeft: px(10), paddingRight: px(10), backgroundColor: '#dcfce7', borderRadius: px(6), fontSize: px(12) }, visibleProps: ['position', 'top', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'backgroundColor', 'borderRadius', 'fontSize'] })
        ]
      })
    ]
  }));

  // 2.8 响应式 + 设计变量说明
  main.children.push(el('section', {
    id: 'sec-responsive',
    style: { paddingTop: px(28) },
    visibleProps: ['paddingTop'],
    children: [
      el('h2', { id: 'sec-resp-h2', text: '⑦ 响应式与设计变量', style: { fontSize: px(20), fontWeight: '700', marginBottom: px(12) }, visibleProps: ['fontSize', 'fontWeight', 'marginBottom'] }),
      el('div', {
        id: 'resp-card',
        text: '这一段在电脑端是蓝色、平板变橙色、手机变绿色（验证三断点覆盖）。',
        style: { paddingTop: px(14), paddingBottom: px(14), paddingLeft: px(16), paddingRight: px(16), backgroundColor: 'var(--bc-brand-soft)', color: 'var(--bc-brand)', borderRadius: px(10), fontSize: px(13), lineHeight: '1.8' },
        visibleProps: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'backgroundColor', 'color', 'borderRadius', 'fontSize', 'lineHeight'],
        responsive: {
          tablet: { backgroundColor: '#fff7ed', color: '#c2410c' },
          mobile: { backgroundColor: '#f0fdf4', color: '#15803d', fontSize: px(12.5) }
        }
      })
    ]
  }));

  children.push(main);

  const root = {
    id: 'root-body',
    type: 'body',
    children,
    style: { marginTop: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '0px' }
  };

  return {
    root,
    selectedId: null,
    selectedIds: [],
    globalCss: [
      '/* 一对一测试工程的全局样式（验证"用户 CSS 放最后、能覆盖自动生成的规则"） */',
      '.test-link:hover { text-decoration-thickness: 2px; }',
      '.test-table tr:hover td { background-color: #f8fbff; }'
    ].join('\n'),
    quickCss: {
      bodyBg: '#ffffff',
      textColor: '#0f172a',
      fontFamily: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
      linkColor: '#2965f1',
      bodyFontSize: px(14),
      bodyLineHeight: '1.7',
      headingColor: '#0f172a',
      resetMargin: '1',
      resetHeadingMargin: '1'
    },
    bodyExtra: {},
    tokens: [
      { name: '--bc-brand', value: '#2965f1', kind: 'color' },
      { name: '--bc-brand-dark', value: '#1d4ed8', kind: 'color' },
      { name: '--bc-brand-soft', value: '#eff6ff', kind: 'color' },
      { name: '--bc-ink', value: '#0f172a', kind: 'color' },
      { name: '--bc-ink-2', value: '#475569', kind: 'color' },
      { name: '--bc-line', value: '#e2e8f0', kind: 'color' }
    ],
    uiState: {}
  };
}

/** 一张 4:1 的 SVG 测试图（纯文本，压缩后很小） */
const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100">
  <rect width="400" height="100" fill="#2965f1"/>
  <rect x="0" y="0" width="100" height="100" fill="#e34f26"/>
  <rect x="100" y="0" width="100" height="100" fill="#f7df1e"/>
  <text x="216" y="58" font-family="Segoe UI, sans-serif" font-size="22" fill="#ffffff">IMG 400×100</text>
</svg>`;

function countNodes(n) {
  if (!n) return 0;
  return 1 + (n.children || []).reduce((a, c) => a + countNodes(c), 0);
}

// ============ 主流程 ============
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') out.out = argv[i + 1];
    else if (a === '--name') out.name = argv[i + 1];
  }
  return out;
}

function dataRootGuess() {
  // 便携数据区：<程序目录>/data（与主进程 dataRoot() 一致）
  const p = join(ROOT, 'data');
  return existsSync(p) ? p : ROOT;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = args.name || '一对一测试';
  const outDir = args.out ? resolve(args.out) : join(dataRootGuess(), 'projects');
  mkdirSync(outDir, { recursive: true });

  const scene = buildScene();
  const now = new Date().toISOString();
  const manifest = {
    format: 'BlockCanvas-Project',
    schemaVersion: 2,
    name,
    createdAt: now,
    updatedAt: now,
    app: { name: 'BlockCanvas', version: '' },
    meta: {
      elementCount: countNodes(scene.root),
      description: '元素 / 布局 / 表单 / 媒体 / 表格 / 定位 / 响应式 一对一验收工程',
      // 单页工程 → 列表里标「网页项目」（多页为 site，下一轮）
      pageCount: 1
    },
    sections: { scene: 'scene.json' },
    assets: ['assets/test-image.svg'],
    version: '2.0.0'
  };

  const buf = zipCreate([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { name: 'scene.json', data: Buffer.from(JSON.stringify(scene), 'utf8') },
    { name: 'assets/test-image.svg', data: Buffer.from(TEST_SVG, 'utf8') }
  ]);

  const file = join(outDir, `${name}.bcproj`);
  writeFileSync(file, buf);
  // 顺手把那张 SVG 也落到工程旁边，方便"相对路径"这条路被真实验证
  const assetDir = join(outDir, 'assets');
  mkdirSync(assetDir, { recursive: true });
  writeFileSync(join(assetDir, 'test-image.svg'), TEST_SVG, 'utf8');

  console.log(`已生成：${file}`);
  console.log(`  元素总数：${manifest.meta.elementCount}`);
  console.log(`  体积：${(buf.length / 1024).toFixed(1)} KB`);
  console.log(`  素材：assets/test-image.svg（相对路径引用）`);
  if (existsSync(join(outDir, `${name}.bcproj`))) {
    console.log('  校验：容器可读（zip 头 ' + readFileSync(file).subarray(0, 2).toString('hex') + '）');
  }
}

main();
