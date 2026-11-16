// ============================================================================
// BlockCanvas · 生成「BlockCanvas 宣传页」工程（v0.4.7）
// ----------------------------------------------------------------------------
// 用户要求：
//   「生成一个纯用 BlockCanvas 内部的编辑器做的 BlockCanvas 宣传页面，我审美太差做不好。
//     你只能用编辑器，并且通过脚本，编辑器内部每个元素都能单独改。图片暂时用不了，
//     Logo 你可以自己拼。项目存在我的 data 下面。」
//
// 所以这个脚本做的事，等价于"一个人在编辑器里一个个拖出来的"：
//   · 只用编辑器支持的元素类型（div/section/h1/p/span/button/a/…）和 ElementStyle 字段；
//   · 不用 <img>（图片暂不可用），Logo 用 3 个色块 div 拼出来；
//   · 每个元素都有独立 id / 自己的 style —— 生成后可以逐个选中单独改；
//   · 布局全走 flex + gap + 断点（tablet/mobile 覆盖），不写 position: absolute，
//     这样在窄屏里自然堆叠，不会挤成一团。
//
// 用法：node tools/make-promo-project.mjs
// 产物：data/projects/BlockCanvas 宣传页.bcproj（走真实 writeProject，格式与编辑器保存一致）
// ============================================================================
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/**
 * 写工程文件。
 *
 * 为什么直接拼 zip 而不是 import src/main/projectFile.ts：
 *   那个模块顶部 import 了 electron（为了 app.getVersion），在纯 node 下加载不了；
 *   用 esbuild 现场转又要求 esbuild 是顶层依赖（本项目里没有）。
 *   而 `src/main/zip.ts` 是**零依赖纯 TS**，Node 22 能直接 import —— 复用它即可，
 *   格式与编辑器保存的完全一致（manifest.json 打头 + scene.json）。
 */
const { zipCreate } = await import('file:///' + resolve(ROOT, 'src/main/zip.ts').replace(/\\/g, '/'));
const SCHEMA_VERSION = 2;
const PROJECT_FORMAT = 'bcproj';
const nowIso = () => new Date().toISOString();
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

function writeProjectFile(path, { name, scene }) {
  const sceneEntry = { name: 'scene.json', data: Buffer.from(JSON.stringify(scene), 'utf8') };
  const manifest = {
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    name,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    app: { name: 'BlockCanvas', version: String(pkg.version ?? '0.4.6') },
    meta: {},
    sections: { scene: 'scene.json' },
    assets: [],
    version: `${SCHEMA_VERSION}.0.0`
  };
  // manifest 必须第一个写（只读它就能列出工程，不解 scene）
  const buf = zipCreate([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    sceneEntry
  ]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  return { ok: true, bytes: buf.length };
}

// ── 设计令牌（一处改、全页跟着改）────────────────────────────────────────────
const C = {
  ink: '#0f172a',
  ink2: '#334155',
  muted: '#64748b',
  line: '#e2e8f0',
  bg: '#f8fafc',
  card: '#ffffff',
  brand: '#2f6fed',
  brand2: '#7c3aed',
  brand3: '#06b6d4',
  amber: '#f59e0b',
  green: '#10b981'
};
const FONT = "'Inter', 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif";

let seq = 0;
const id = (tag) => `promo-${tag}-${(++seq).toString().padStart(3, '0')}`;

/**
 * 造一个元素（等价于编辑器里插入一个元素后逐项改样式）。
 *
 * `cls` 会给元素挂一个**稳定、可读的类名**（`.promo-hero-title` 这种），
 * 这样导出后的 HTML 不是一坨 `div`：用户在"类名总览"里能认出来，
 * 也能直接在全局 CSS 里用 `.promo-hero-title { ... }` 覆盖。
 * 每个元素的类名都是唯一的（编号后缀），所以改一个不会波及别的。
 */
function el(type, opts = {}) {
  const { style = {}, text, children = [], attrs = {}, visibleProps, childStyles, cls } = opts;
  const node = {
    id: id(type),
    type,
    children,
    style: { fontFamily: FONT, ...style }
  };
  if (cls) node.attrs = { ...(node.attrs ?? {}), className: cls };
  if (text !== undefined) node.text = text;
  if (Object.keys(attrs).length) node.attrs = { ...(node.attrs ?? {}), ...attrs };
  if (visibleProps) node.visibleProps = visibleProps;
  if (childStyles) node.childStyles = childStyles;
  return node;
}

/** 一段文字（带默认的排版基线，避免每个都重复写） */
const p = (text, style = {}) => el('p', {
  text,
  style: { marginTop: '0', marginBottom: '0', fontSize: '16px', lineHeight: '1.75', color: C.ink2, ...style }
});

/** 圆角卡片 */
const card = (children, style = {}) => el('div', {
  children,
  style: {
    backgroundColor: C.card,
    borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
    borderStyle: 'solid', borderColor: C.line,
    borderTopLeftRadius: '16px', borderTopRightRadius: '16px',
    borderBottomRightRadius: '16px', borderBottomLeftRadius: '16px',
    paddingTop: '26px', paddingRight: '26px', paddingBottom: '26px', paddingLeft: '26px',
    boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.06)',
    display: 'flex', flexDirection: 'column', gap: '10px',
    ...style
  }
});

/** 小标签（胶囊） */
const pill = (text, color = C.brand, bg = '#eef4ff') => el('span', {
  text,
  style: {
    display: 'inline-block',
    fontSize: '12.5px', fontWeight: '600', letterSpacing: '0.02em',
    color, backgroundColor: bg,
    paddingTop: '5px', paddingRight: '12px', paddingBottom: '5px', paddingLeft: '12px',
    borderTopLeftRadius: '999px', borderTopRightRadius: '999px',
    borderBottomRightRadius: '999px', borderBottomLeftRadius: '999px'
  }
});

/** 章节外壳：统一上下留白 + 最大宽度居中 */
const section = (children, opts = {}) => el('section', {
  cls: opts.cls,
  children,
  style: {
    width: '100%',
    maxWidth: '1120px',
    marginLeft: 'auto', marginRight: 'auto',
    paddingTop: opts.padTop ?? '72px',
    paddingRight: '28px',
    paddingBottom: opts.padBottom ?? '72px',
    paddingLeft: '28px',
    display: 'flex', flexDirection: 'column',
    gap: opts.gap ?? '28px',
    boxSizing: 'border-box',
    ...(opts.style ?? {})
  }
});

/** 章节标题组：eyebrow + 大标题 + 说明 */
const heading = (eyebrow, title, desc, opts = {}) => el('div', {
  children: [
    ...(eyebrow ? [pill(eyebrow, opts.color ?? C.brand, opts.bg ?? '#eef4ff')] : []),
    el('h2', {
      text: title,
      style: {
        marginTop: '14px', marginBottom: '0',
        fontSize: '34px', lineHeight: '1.25', fontWeight: '800',
        letterSpacing: '-0.02em', color: C.ink
      }
    }),
    ...(desc ? [p(desc, { fontSize: '16.5px', color: C.muted, marginTop: '12px', maxWidth: '720px' })] : [])
  ],
  style: { display: 'flex', flexDirection: 'column', alignItems: opts.align ?? 'flex-start' }
});

// ── 1. 顶栏 ─────────────────────────────────────────────────────────────────
/**
 * Logo：**严格照 `src/renderer/assets/logo.svg` 的三色 L 形积木**重画。
 *
 * 真实规格（viewBox 256）：
 *   · 左上 蓝 #2965F1 —— CSS
 *   · 左下 橙 #E34F26 —— HTML
 *   · 右下 黄 #F7DF1E —— JavaScript
 *   · 每块 92×92，圆角 20，块间留 14px；**右上那格是空的**，所以整体是「L」形
 *   · 透明底，无渐变、无描边、无多余装饰
 *
 * 之前我用的是"四个色块错位叠成 2×2"，那是错的 —— 用户要求「不要拼错，是三色 Logo」。
 * 这里按 92:20:14 的比例换算成任意尺寸，块与块之间用 gap 对齐，保证与真 Logo 同构。
 */
const LOGO_COLORS = { css: '#2965F1', html: '#E34F26', js: '#F7DF1E' };

function logoTile(size, bg) {
  // 一块 92/256 的方块，圆角 20/256
  const s = Math.round(size * (92 / 256));
  const r = Math.round(size * (20 / 256));
  return el('div', {
    style: {
      width: `${s}px`, height: `${s}px`, backgroundColor: bg, flexShrink: '0',
      borderTopLeftRadius: `${r}px`, borderTopRightRadius: `${r}px`,
      borderBottomRightRadius: `${r}px`, borderBottomLeftRadius: `${r}px`
    }
  });
}

function logoMark(size = 34) {
  const gap = Math.round(size * (14 / 256));
  return el('div', {
    children: [
      // 上排：蓝 + 空
      el('div', {
        children: [logoTile(size, LOGO_COLORS.css)],
        style: { display: 'flex' }
      }),
      // 下排：橙 + 黄
      el('div', {
        children: [logoTile(size, LOGO_COLORS.html), logoTile(size, LOGO_COLORS.js)],
        style: { display: 'flex', marginTop: `${gap}px` }
      })
    ],
    style: { display: 'flex', flexDirection: 'column', flexShrink: '0' }
  });
}
// 上下排之间的水平错位也要留出来
function logoMarkFixed(size = 34) {
  const gap = Math.round(size * (14 / 256));
  return el('div', {
    children: [
      el('div', {
        children: [logoTile(size, LOGO_COLORS.css)],
        style: { display: 'flex' }
      }),
      el('div', {
        children: [logoTile(size, LOGO_COLORS.html), logoTile(size, LOGO_COLORS.js)],
        style: { display: 'flex', marginTop: `${gap}px`, columnGap: `${gap}px` }
      })
    ],
    style: { display: 'flex', flexDirection: 'column', flexShrink: '0' }
  });
}

const nav = el('header', {
  cls: 'promo-nav',
  children: [
    el('div', {
      children: [
        el('div', {
          children: [logoMarkFixed(34), el('div', {
        cls: 'promo-brand-text',
            children: [
              el('span', { text: 'BlockCanvas', style: { fontSize: '17px', fontWeight: '800', color: C.ink, letterSpacing: '-0.01em', lineHeight: '1.2' } }),
              el('span', { text: '积木画布', style: { fontSize: '11.5px', color: C.muted, letterSpacing: '0.14em', lineHeight: '1.4' } })
            ],
            style: { display: 'flex', flexDirection: 'column', marginLeft: '11px' }
          })],
          style: { display: 'flex', alignItems: 'center' }
        }),
        el('nav', {
          cls: 'promo-nav-links',
          children: ['功能', '为什么', '工作流', '开始'].map((t) => el('span', {
            text: t,
            style: { fontSize: '14px', color: C.ink2, marginLeft: '26px', fontWeight: '500', whiteSpace: 'nowrap', flexShrink: '0' }
          })),
          style: { display: 'flex', alignItems: 'center', flexShrink: '0' }
        })
      ],
      style: {
        width: '100%', maxWidth: '1120px', marginLeft: 'auto', marginRight: 'auto',
        paddingTop: '18px', paddingRight: '28px', paddingBottom: '18px', paddingLeft: '28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxSizing: 'border-box'
      }
    })
  ],
  style: {
    width: '100%', backgroundColor: 'rgba(255,255,255,0.9)',
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: C.line,
    borderTopWidth: '0', borderLeftWidth: '0', borderRightWidth: '0'
  }
});

// ── 2. Hero ────────────────────────────────────────────────────────────────
const hero = section([
  el('div', {
    children: [
      pill('可视化静态网页构建器', C.brand, '#eef4ff'),
      el('h1', {
        cls: 'promo-hero-title',
        text: '把网页拆成积木，\n一块一块搭出来',
        style: {
          marginTop: '22px', marginBottom: '0',
          fontSize: '58px', lineHeight: '1.14', fontWeight: '800',
          letterSpacing: '-0.03em', color: C.ink, whiteSpace: 'pre-line'
        }
      }),
      p('选中、拖拽、改数值 —— 你看到的画布就是导出的网页。不用写一行代码，也不用担心出来的效果和设计不一样：编辑器里的每个像素和导出的 HTML 走的是同一套样式。', {
        fontSize: '18px', lineHeight: '1.8', color: C.muted, marginTop: '20px', maxWidth: '660px'
      }),
      el('div', {
        children: [
          el('button', {
            text: '开始搭第一个页面',
            style: {
              fontSize: '15.5px', fontWeight: '700', color: '#ffffff', backgroundColor: C.brand,
              paddingTop: '14px', paddingRight: '26px', paddingBottom: '14px', paddingLeft: '26px',
              borderTopLeftRadius: '12px', borderTopRightRadius: '12px',
              borderBottomRightRadius: '12px', borderBottomLeftRadius: '12px',
              borderStyle: 'none', cursor: 'pointer',
              boxShadow: '0 8px 20px rgba(47,111,237,0.28)'
            }
          }),
          el('button', {
            text: '看看它是怎么工作的',
            style: {
              fontSize: '15.5px', fontWeight: '600', color: C.ink, backgroundColor: '#ffffff',
              paddingTop: '14px', paddingRight: '24px', paddingBottom: '14px', paddingLeft: '24px',
              borderTopLeftRadius: '12px', borderTopRightRadius: '12px',
              borderBottomRightRadius: '12px', borderBottomLeftRadius: '12px',
              borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
              borderStyle: 'solid', borderColor: C.line, cursor: 'pointer', marginLeft: '12px'
            }
          })
        ],
        style: { display: 'flex', alignItems: 'center', marginTop: '34px', flexWrap: 'wrap' }
      })
    ],
    style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: '780px' }
  }),
  // 一排"数据点"——不用图片，纯文字 + 分隔线
  el('div', {
    children: [
      ['3 种断点', '电脑 / 平板 / 手机 一套设计同时适配', C.brand],
      ['0 行代码', '所有样式都是可视化改的', C.brand2],
      ['1 份产物', '导出即用，没有构建步骤', C.brand3]
    ].flatMap(([big, small, color], i) => {
      const item = el('div', {
        children: [
          el('div', { text: big, style: { fontSize: '22px', fontWeight: '800', color, letterSpacing: '-0.01em' } }),
          p(small, { fontSize: '13.5px', color: C.muted, marginTop: '6px' })
        ],
        style: { display: 'flex', flexDirection: 'column', flexGrow: '1', flexBasis: '0', minWidth: '180px' }
      });
      return i === 0 ? [item] : [
        el('div', { style: { width: '1px', backgroundColor: C.line, alignSelf: 'stretch', marginLeft: '24px', marginRight: '24px' } }),
        item
      ];
    }),
    style: {
      display: 'flex', alignItems: 'flex-start', width: '100%',
      backgroundColor: '#ffffff',
      borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
      borderStyle: 'solid', borderColor: C.line,
      borderTopLeftRadius: '18px', borderTopRightRadius: '18px',
      borderBottomRightRadius: '18px', borderBottomLeftRadius: '18px',
      paddingTop: '26px', paddingRight: '28px', paddingBottom: '26px', paddingLeft: '28px',
      boxSizing: 'border-box', flexWrap: 'wrap', rowGap: '18px'
    }
  })
], { cls: 'promo-hero', padTop: '84px', padBottom: '44px', gap: '48px' });

// ── 3. 三个功能卡 ───────────────────────────────────────────────────────────
function featureCard(iconBg, iconText, title, desc) {
  return card([
    el('div', {
      text: iconText,
      style: {
        width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: iconBg, color: '#ffffff', fontWeight: '800', fontSize: '18px',
        borderTopLeftRadius: '12px', borderTopRightRadius: '12px',
        borderBottomRightRadius: '12px', borderBottomLeftRadius: '12px'
      }
    }),
    el('h3', {
      text: title,
      style: { marginTop: '16px', marginBottom: '0', fontSize: '19px', fontWeight: '750', color: C.ink, letterSpacing: '-0.01em' }
    }),
    p(desc, { fontSize: '14.5px', lineHeight: '1.75', color: C.muted, marginTop: '8px' })
  ], { flexGrow: '1', flexBasis: '0', minWidth: '260px' });
}

const features = section([
  heading('核心能力', '它把"设计"和"代码"之间那道墙拆了',
    '大多数工具要么只能拖、出来的代码没法看；要么只能写代码、改个间距要翻半天。BlockCanvas 让你在两边的中间：拖得动，也改得准。'),
  el('div', {
    children: [
      featureCard('#2f6fed', '◧', '所见即所得的画布',
        '画布就是真实 DOM。你在这里看到的样子，就是导出后浏览器里的样子 —— 不存在"设计稿很漂亮、切出来不一样"。'),
      featureCard('#7c3aed', '⌗', '每个元素都能单独改',
        '选中任何一个元素，右侧面板能改它的尺寸、间距、颜色、字体、边框、阴影、布局。属性是按需添加的，界面不会一开始就糊满。'),
      featureCard('#06b6d4', '⬒', '三断点一次做完',
        '电脑、平板、手机在同一个工程里。窄屏上你只需要改"不一样的那几项"，其余自动继承 —— 不用维护三份页面。')
    ],
    style: { display: 'flex', gap: '20px', flexWrap: 'wrap' }
  })
], { cls: 'promo-features', padTop: '36px', padBottom: '72px' });

// ── 4. 为什么（左文右卡片）─────────────────────────────────────────────────
const why = section([
  el('div', {
    children: [
      el('div', {
        children: [
          heading('为什么是它', '告别"改一个间距\n要翻三个文件"',
            '', { bg: '#f5f3ff', color: C.brand2 }),
          p('传统流程里，改一个间距要：打开代码 → 找选择器 → 改数值 → 切回浏览器 → 刷新 → 发现别处塌了。\nBlockCanvas 里就是：选中 → 改数字 → 看着它变。', {
            fontSize: '16px', lineHeight: '1.85', color: C.muted, marginTop: '18px', whiteSpace: 'pre-line'
          }),
          el('div', {
            children: [
              ['样式只有一份来源', '面板里改的值直接生成 CSS，不存在"这里改了那里没同步"'],
              ['元素按类名/选择器归组', '同名的元素自动共享样式，改一处全跟着变'],
              ['随时能回到上一步', '每一步都可撤销，改坏了 Ctrl+Z 就回来']
            ].flatMap(([t, d], i) => {
              const row = el('div', {
                children: [
                  el('div', {
                    text: '✓',
                    style: {
                      width: '22px', height: '22px', flexShrink: '0',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      backgroundColor: '#ecfdf5', color: C.green, fontSize: '12px', fontWeight: '800',
                      borderTopLeftRadius: '999px', borderTopRightRadius: '999px',
                      borderBottomRightRadius: '999px', borderBottomLeftRadius: '999px'
                    }
                  }),
                  el('div', {
                    children: [
                      el('span', { text: t, style: { fontSize: '15px', fontWeight: '700', color: C.ink } }),
                      p(d, { fontSize: '13.5px', color: C.muted, marginTop: '3px' })
                    ],
                    style: { display: 'flex', flexDirection: 'column', marginLeft: '12px' }
                  })
                ],
                style: { display: 'flex', alignItems: 'flex-start' }
              });
              return i === 0 ? [row] : [el('div', { style: { height: '16px' } }), row];
            }),
            style: { display: 'flex', flexDirection: 'column', marginTop: '26px' }
          })
        ],
        style: { display: 'flex', flexDirection: 'column', flexGrow: '1', flexBasis: '0', minWidth: '320px', paddingRight: '28px' }
      }),
      // 右侧：模拟"属性面板"的示意卡（全用 div 拼，和真实面板长得像）
      card([
        el('div', {
          children: [
            el('span', { text: 'CSS 样式属性', style: { fontSize: '13px', fontWeight: '700', color: C.ink } }),
            el('span', { text: '4', style: { fontSize: '11.5px', color: C.muted, marginLeft: '6px' } })
          ],
          style: { display: 'flex', alignItems: 'center', paddingBottom: '12px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: C.line, borderTopWidth: '0', borderLeftWidth: '0', borderRightWidth: '0' }
        }),
        ...[
          ['内边距', '32 px'],
          ['圆角', '16 px'],
          ['背景颜色', '#ffffff'],
          ['阴影', '0 8px 24px']
        ].map(([k, v]) => el('div', {
          children: [
            el('span', { text: k, style: { fontSize: '12.5px', color: C.muted } }),
            el('span', {
              text: v,
              style: {
                fontSize: '12.5px', color: C.ink, fontWeight: '600',
                backgroundColor: '#f1f5f9',
                paddingTop: '5px', paddingRight: '10px', paddingBottom: '5px', paddingLeft: '10px',
                borderTopLeftRadius: '7px', borderTopRightRadius: '7px',
                borderBottomRightRadius: '7px', borderBottomLeftRadius: '7px'
              }
            })
          ],
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '9px' }
        }))
      ], {
        flexGrow: '1', flexBasis: '0', minWidth: '300px',
        backgroundColor: C.bg, gap: '2px'
      })
    ],
    style: { display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', rowGap: '32px' }
  })
], { cls: 'promo-why', padTop: '24px', padBottom: '72px' });

// ── 5. 工作流三步 ───────────────────────────────────────────────────────────
const steps = section([
  heading('工作流', '三步，从空白到能上线的页面', '没有构建、没有依赖、没有配置文件。'),
  el('div', {
    children: [
      ['01', '搭结构', '从元素面板插入容器和文字，拖成你想要的分区。布局交给 flex / grid，不用算坐标。', C.brand],
      ['02', '调样式', '选中元素，在右侧按需添加属性：间距、颜色、字体、阴影、边框。宽度一变，窄屏自动跟着调。', C.brand2],
      ['03', '导出上线', '导出成一份干净的 HTML（配套素材一起带走），丢到任何静态托管上就能访问。', C.brand3]
    ].map(([num, title, desc, color]) => card([
      el('div', {
        text: num,
        style: { fontSize: '13px', fontWeight: '800', color, letterSpacing: '0.08em' }
      }),
      el('h3', { text: title, style: { marginTop: '10px', marginBottom: '0', fontSize: '20px', fontWeight: '750', color: C.ink } }),
      p(desc, { fontSize: '14.5px', lineHeight: '1.8', color: C.muted, marginTop: '8px' })
    ], { flexGrow: '1', flexBasis: '0', minWidth: '250px' })),
    style: { display: 'flex', gap: '20px', flexWrap: 'wrap' }
  })
], { cls: 'promo-steps', padTop: '0', padBottom: '72px' });

// ── 6. CTA ─────────────────────────────────────────────────────────────────
const cta = section([
  el('div', {
    children: [
      el('h2', {
        cls: 'promo-cta-title',
        text: '现在就可以开始',
        style: { marginTop: '0', marginBottom: '0', fontSize: '38px', lineHeight: '1.2', fontWeight: '800', letterSpacing: '-0.025em', color: '#ffffff' }
      }),
      p('打开 BlockCanvas，新建一个页面，插入第一个区块。剩下的它会带着你走。', {
        fontSize: '16.5px', lineHeight: '1.8', color: 'rgba(255,255,255,0.82)', marginTop: '14px', maxWidth: '560px'
      }),
      el('div', {
        children: [
          el('button', {
            text: '新建第一个页面',
            style: {
              fontSize: '15.5px', fontWeight: '700', color: C.brand, backgroundColor: '#ffffff',
              paddingTop: '14px', paddingRight: '26px', paddingBottom: '14px', paddingLeft: '26px',
              borderTopLeftRadius: '12px', borderTopRightRadius: '12px',
              borderBottomRightRadius: '12px', borderBottomLeftRadius: '12px',
              borderStyle: 'none', cursor: 'pointer', marginTop: '30px'
            }
          }),
          el('span', {
            text: '不需要账号，不联网也能用',
            style: { fontSize: '13px', color: 'rgba(255,255,255,0.7)', marginLeft: '16px' }
          })
        ],
        style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' }
      })
    ],
    style: {
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
      backgroundColor: C.ink,
      borderTopLeftRadius: '24px', borderTopRightRadius: '24px',
      borderBottomRightRadius: '24px', borderBottomLeftRadius: '24px',
      paddingTop: '56px', paddingRight: '52px', paddingBottom: '56px', paddingLeft: '52px',
      boxShadow: '0 24px 60px rgba(15,23,42,0.28)',
      boxSizing: 'border-box', width: '100%'
    }
  })
], { cls: 'promo-cta', padTop: '0', padBottom: '56px' });

// ── 7. 页脚 ────────────────────────────────────────────────────────────────
const footer = el('footer', {
  cls: 'promo-footer',
  children: [
    el('div', {
      children: [
        el('div', {
          children: [
            logoMarkFixed(26),
            el('span', { text: 'BlockCanvas 积木画布', style: { fontSize: '13.5px', fontWeight: '700', color: C.ink, marginLeft: '10px' } })
          ],
          style: { display: 'flex', alignItems: 'center' }
        }),
        el('span', { text: '可视化静态网页构建器 · 本地优先 · 导出的代码是你的', style: { fontSize: '12.5px', color: C.muted } })
      ],
      style: {
        width: '100%', maxWidth: '1120px', marginLeft: 'auto', marginRight: 'auto',
        paddingTop: '24px', paddingRight: '28px', paddingBottom: '24px', paddingLeft: '28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', rowGap: '10px', boxSizing: 'border-box'
      }
    })
  ],
  style: {
    width: '100%', backgroundColor: '#ffffff',
    /* ⚠ 必须 border-box：小屏给 footer 加了左右 18px padding，
       没有它 → 宽度 = 100% + 36px，把整页撑出横向滚动（实测 375 → 411px）。 */
    boxSizing: 'border-box',
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: C.line,
    borderRightWidth: '0', borderBottomWidth: '0', borderLeftWidth: '0'
  }
});

// ── 组装：body root ────────────────────────────────────────────────────────
const root = {
  id: 'promo-root',
  type: 'div',
  children: [nav, hero, features, why, steps, cta, footer],
  style: {
    fontFamily: FONT,
    backgroundColor: C.bg,
    color: C.ink,
    width: '100%',
    minHeight: '100%',
    display: 'flex',
    flexDirection: 'column',
    marginTop: '0', marginRight: '0', marginBottom: '0', marginLeft: '0'
  }
};

// 断点覆盖：窄屏只改"必须改"的几项（字号/方向/间距），其余继承桌面端
const mobileOverrides = {
  'promo-h1-003': { fontSize: '34px', lineHeight: '1.22' },
  'promo-h2-010': { fontSize: '25px' },
  'promo-h2-020': { fontSize: '25px' },
  'promo-h2-029': { fontSize: '25px' },
  'promo-h2-037': { fontSize: '27px' }
};
/**
 * 断点覆盖 + **给每个元素兜底一个类名**（v0.4.7，用户硬要求）。
 *
 * 用户原话：「不要有任何的行内 css，全部用选择器！」
 *
 * 导出器的规则（`styleClass.ts` 的 `selectorForNode`）是：
 *   有 relSelector → 用关系选择器；有 className → 用 .类名；有 id → 用 #id；
 *   **三者都没有 → 写成 DOM 上的 style="…"（行内样式）**。
 * 所以想让导出结果一个行内 style 都没有，唯一办法就是让**每一个元素都有名字**。
 * 这里给没名字的元素自动补 `.promo-<类型>-<序号>`，一次到位；
 * 用户以后在「类名总览」里也能看到这些名字、逐个改。
 */
let named = 0;
(function nameEverything(node) {
  const has = (v) => String(v ?? '').trim().length > 0;
  const a = (node.attrs ??= {});
  if (!has(a.className) && !has(a.id) && !has(a.relSelector)) {
    named += 1;
    a.className = `promo-${node.type}-${String(named).padStart(3, '0')}`;
  }
  (node.children || []).forEach(nameEverything);
})(root);

(function applyResponsive(node) {
  if (node.type === 'h1') node.responsive = { mobile: { fontSize: '34px', lineHeight: '1.24', letterSpacing: '-0.02em' } };
  if (node.type === 'h2') node.responsive = { mobile: { fontSize: '25px', lineHeight: '1.3' } };
  if (node.type === 'section' || node.type === 'header' || node.type === 'footer') {
    node.responsive = { mobile: { paddingLeft: '18px', paddingRight: '18px', boxSizing: 'border-box' } };
  }
  /**
   * 手机端导航：只留品牌，链接整组隐藏。
   *
   * 实测（390px 宽）「功能 / 为什么 / 工作流 / 开始」四个词挤在一行，
   * 每个字被压成一行（宽只剩 14px）、还把页面撑出 41px 横向滚动。
   * 小屏上这排锚点是装饰性的（首页本来就能滚），隐藏最干净。
   */
  const cls = String(node.attrs?.className ?? '');
  if (cls === 'promo-nav-links') {
    node.responsive = { ...(node.responsive ?? {}), mobile: { display: 'none' } };
  }
  // 导航外壳 + 品牌行：小屏收紧内边距，避免和 4 个链接抢宽度
  if (cls === 'promo-nav') {
    node.responsive = { ...(node.responsive ?? {}), mobile: { paddingLeft: '0px', paddingRight: '0px' } };
  }
  /**
   * 右半边那张「CSS 样式属性」示意卡：桌面靠 flexBasis 0 与左栏平分，
   * 小屏要独占一整行（否则和左栏挤在半行里，文字被压成竖排）。
   */
  if (node.type === 'div' && node.style?.minWidth === '300px') {
    node.responsive = { ...(node.responsive ?? {}), mobile: { flexBasis: '100%', minWidth: '0px' } };
  }
  if (node.type === 'div' && node.style?.minWidth === '320px') {
    node.responsive = { ...(node.responsive ?? {}), mobile: { flexBasis: '100%', minWidth: '0px', paddingRight: '0px' } };
  }
  /**
   * 「3 种断点 / 0 行代码 / 1 份产物」那三格：桌面是 minWidth 180px 横排，
   * 390px 屏幕上三格各 180px → 直接撑出横向滚动（实测 +41px）。
   * 小屏允许它们缩到 0 宽并独占一行。
   */
  if (node.type === 'div' && node.style?.minWidth === '180px') {
    node.responsive = { ...(node.responsive ?? {}), mobile: { flexBasis: '100%', minWidth: '0px' } };
  }
  if (node.type === 'div' && node.style?.minWidth === '250px') {
    node.responsive = { ...(node.responsive ?? {}), mobile: { flexBasis: '100%', minWidth: '0px' } };
  }
  if (node.type === 'div' && node.style?.minWidth === '260px') {
    node.responsive = { ...(node.responsive ?? {}), mobile: { flexBasis: '100%', minWidth: '0px' } };
  }
  /**
   * 那三条竖分隔线（width:1px + 上下 margin 24px）在小屏上把整行切成多块，
   * 堆叠后成了没意义的细线 —— 小屏隐藏。
   */
  if (node.type === 'div' && node.style?.width === '1px' && node.style?.marginLeft === '24px') {
    node.responsive = { ...(node.responsive ?? {}), mobile: { display: 'none' } };
  }
  (node.children || []).forEach(applyResponsive);
})(root);
void mobileOverrides;


const scene = {
  root,
  selectedId: null,
  selectedIds: [],
  quickCss: {
    bodyBg: C.bg,
    fontFamily: FONT,
    resetMargin: '1',
    resetHeadingMargin: '1'
  },
  viewportHeight: 900
};

const writeProject = writeProjectFile;
const outPath = resolve(ROOT, 'data/projects/BlockCanvas 宣传页.bcproj');
const res = writeProject(outPath, { name: 'BlockCanvas 宣传页', scene });
if (!res || res.ok === false) {
  console.error('写入失败：', JSON.stringify(res));
  process.exit(1);
}
console.log('已生成：' + outPath);
console.log('  name = BlockCanvas 宣传页');
console.log('  元素数（含层级）= ' + (function count(n) { return 1 + (n.children || []).reduce((s, c) => s + count(c), 0); })(root));
