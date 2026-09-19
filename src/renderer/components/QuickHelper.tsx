import { useScene, findNode, findParent, getEffectiveStyle } from '@store/sceneStore';
import { CONTAINER_TAGS, TEXT_TAGS } from '@lib/types';
import type { ElementType } from '@lib/types';
import { NumberUnitInput } from './NumberUnitInput';
import { HelpButton } from './HelpButton';
import { GradientEditor } from './GradientEditor';
import { Collapse } from './Collapse';
import { useRef } from 'react';
import { usePersistedBool } from '@lib/usePersisted';
import {
  isGradient,
  GRADIENT_PRESETS,
  textGradientPatch
} from '@lib/gradient';

// BlockCanvas · 快捷助手（原「布局助手」，v0.4.1 扩容）
// 定位：把「一组 CSS 属性配合才能做出来的常用效果」打包成一句话就能用的开关。
// 现在包含：
//  ① 布局（Flex 弹性 / Grid 网格）—— 控制子元素排列
//  ② 文字渐变 —— 背景渐变 + background-clip:text 的经典三件套
// 未来还会继续往里加（如毛玻璃、霓虹描边、图片遮罩…）。
//
// 「是否显示到下方 CSS 属性」开关：
//   快捷助手生成的属性默认会同步显示在下方「CSS 样式属性」列表里（方便查看/微调）；
//   关掉后下方列表就隐藏这些属性（样式依然生效），让面板更清爽。
//   开关状态按「选择器」共用记忆（同类名 / 同关系选择器的元素共享一份）。

/** 快捷助手代管的属性 key：开关关闭时，下方「CSS 样式属性」隐藏这些属性 */
export const HELPER_MANAGED_KEYS = new Set<string>([
  'display',
  'flexDirection',
  'justifyContent',
  'alignItems',
  'gap',
  'flexWrap',
  'gridTemplateColumns',
  'gridTemplateRows',
  'justifyItems',
  'backgroundImage',
  'backgroundClip',
  'WebkitBackgroundClip',
  'WebkitTextFillColor'
]);

const JUSTIFY_OPTIONS: Array<[string, string]> = [
  ['flex-start', '开头对齐 (flex-start)'],
  ['center', '居中对齐 (center)'],
  ['flex-end', '结尾靠拢 (flex-end)'],
  ['space-between', '两端贴边平分 (space-between)'],
  ['space-around', '每项两侧等距 (space-around)'],
  ['space-evenly', '整体完全均分 (space-evenly)']
];

const ALIGN_OPTIONS: Array<[string, string]> = [
  ['stretch', '拉伸占满 (stretch)'],
  ['flex-start', '顶部对齐 (flex-start)'],
  ['center', '垂直居中 (center)'],
  ['flex-end', '底部对齐 (flex-end)'],
  ['baseline', '文字基线 (baseline)']
];

const GRID_PRESETS: Array<{ label: string; value: string; desc: string }> = [
  { label: '2 列等分', value: 'repeat(2, 1fr)', desc: '并排 2 列，宽度均分' },
  { label: '3 列等分', value: 'repeat(3, 1fr)', desc: '并排 3 列，卡片组常用' },
  { label: '4 列等分', value: 'repeat(4, 1fr)', desc: '并排 4 列，多数据展示' },
  { label: '自适应流', value: 'repeat(auto-fill, minmax(220px, 1fr))', desc: '智能响应式：随窗口变窄自动换列' },
  { label: '侧栏+主区', value: '240px 1fr', desc: '左侧固定 240px，右侧撑满' }
];

/** 文字渐变的快捷配色（直接取预制渐变里的精选款） */
const TEXT_GRADIENT_QUICK = GRADIENT_PRESETS.filter((p) =>
  ['极光紫', '蔚蓝天空', '珊瑚海岸', '薄荷青柠', '落日熔金', '星尘紫', '午夜星河', '玫瑰金'].includes(p.name)
);

interface Props {
  elementId: string;
  elementType: ElementType;
  /** 「是否显示到下方 CSS 属性」开关状态 */
  showInCss: boolean;
  onShowInCssChange: (v: boolean) => void;
}

export function QuickHelper(props: Props) {
  const { elementId, elementType, showInCss, onShowInCssChange } = props;
  const scene = useScene((s) => s.scene);
  const updateStyle = useScene((s) => s.updateStyle);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const selectElement = useScene((s) => s.selectElement);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);

  // 折叠状态全部记住：下次打开还是用户熟悉的样子
  const [layoutOpen, setLayoutOpen] = usePersistedBool('qh-layout-open', true);
  const [gradOpen, setGradOpen] = usePersistedBool('qh-textgrad-open', true);
  const gradDraftRef = useRef('');

  const node = findNode(scene.root, elementId);
  if (!node) return null;

  const eff = getEffectiveStyle(node, activeBreakpoint) as Record<string, string | undefined>;
  const isContainer = CONTAINER_TAGS.has(elementType);
  const isText = TEXT_TAGS.has(elementType) || node.text !== undefined;

  const display = eff.display ?? '';
  const flexDir = eff.flexDirection ?? 'row';
  const isFlex = display === 'flex' || display === 'inline-flex';
  const isGrid = display === 'grid' || display === 'inline-grid';
  const mode: 'block' | 'flex' | 'grid' = isGrid ? 'grid' : isFlex ? 'flex' : 'block';

  const setMode = (nextMode: 'block' | 'flex' | 'grid') => {
    if (nextMode === 'block') {
      updateStyle(elementId, {
        display: '',
        flexDirection: '',
        justifyContent: '',
        alignItems: '',
        gap: '',
        flexWrap: '',
        gridTemplateColumns: '',
        gridTemplateRows: '',
        justifyItems: ''
      });
    } else if (nextMode === 'flex') {
      updateStyle(elementId, {
        display: 'flex',
        flexDirection: eff.flexDirection || 'row',
        gap: eff.gap || '16px',
        gridTemplateColumns: '',
        gridTemplateRows: '',
        justifyItems: ''
      });
    } else if (nextMode === 'grid') {
      updateStyle(elementId, {
        display: 'grid',
        gridTemplateColumns: eff.gridTemplateColumns || 'repeat(3, 1fr)',
        gap: eff.gap || '16px',
        flexDirection: '',
        justifyContent: '',
        flexWrap: ''
      });
    }
  };

  // —— 文字渐变 ——
  const textGradCss = isGradient(eff.backgroundImage) && eff.WebkitTextFillColor === 'transparent'
    ? (eff.backgroundImage as string)
    : '';
  const hasTextGrad = Boolean(textGradCss);

  const applyTextGradient = (css: string, transient = false) => {
    const patch = textGradientPatch(css);
    if (transient) updateStyleTransient(elementId, patch as any);
    else updateStyle(elementId, patch as any);
  };

  const parent = findParent(scene.root, elementId);

  return (
    <div className="quick-helper">
      {/* ——— 顶部：同步开关 ——— */}
      <div className="qh-sync-bar">
        <label className="qh-sync-label" title="开启后，快捷助手生成的样式会同时出现在下方「CSS 样式属性」列表里（便于查看与微调）；关闭后下方列表不再显示这些属性，但样式依然生效。开关按选择器共用记忆。">
          <input
            type="checkbox"
            checked={showInCss}
            onChange={(e) => onShowInCssChange(e.target.checked)}
          />
          是否显示到下方 CSS 属性
        </label>
        <HelpButton
          title="「显示到下方 CSS 属性」是什么意思？"
          content={
            '快捷助手做的事情，本质上是帮你一次性写好几条 CSS 属性：\n\n' +
            '· 弹性布局 = display + flex-direction + gap + …\n' +
            '· 文字渐变 = background-image + background-clip: text + -webkit-text-fill-color: transparent\n\n' +
            '开启本开关：这些属性会同步出现在下方「CSS 样式属性」列表，方便你逐条查看与微调。\n\n' +
            '关闭本开关：下方列表不再显示它们，面板更清爽；样式本身完全不受影响，随时可在快捷助手里改。\n\n' +
            '开关状态按「选择器」记住：同一类名 / 同一关系选择器的元素共享一份，不用反复设置。'
          }
        />
      </div>

      {/* ——— ① 布局（仅容器可用） ——— */}
      {isContainer ? (
        <div className="qh-block">
          <div className="qh-block-head">
            <button className="qh-block-toggle" onClick={() => setLayoutOpen((v) => !v)}>
              <span className={'page-advanced-caret' + (layoutOpen ? ' open' : '')}>▸</span>
              布局 (Flex &amp; Grid)
            </button>
            <span className="qh-block-sub">控制子元素排列</span>
            <HelpButton
              title="布局模式介绍"
              content={
                '网页的三大主流布局方式：\n\n' +
                '1. 默认流式 (block)：子元素从上到下像写文章一样自然垂直堆叠。\n\n' +
                '2. 弹性布局 (flex)：子元素横向排成一行（可随时切换竖排），支持灵活对齐与自动折行。\n\n' +
                '3. 网格布局 (grid)：现代强大的二维网格系统，做多列等分卡片、响应式卡片流最强大省心！\n\n' +
                '提示：布局属性写在【父容器】上，决定里面所有子元素怎么排。'
              }
            />
          </div>
          <Collapse open={layoutOpen}>
            <div className="qh-block-body">
              <div className="seg-group" role="group" aria-label="布局模式">
                <button
                  className={'seg-btn' + (mode === 'block' ? ' active' : '')}
                  onClick={() => setMode('block')}
                  title="默认流式布局：子元素垂直向下堆叠"
                >默认流式</button>
                <button
                  className={'seg-btn' + (mode === 'flex' ? ' active' : '')}
                  onClick={() => setMode('flex')}
                  title="Flex 弹性布局：支持横竖排、对齐、自动换行"
                >⭲ 弹性 Flex</button>
                <button
                  className={'seg-btn' + (mode === 'grid' ? ' active' : '')}
                  onClick={() => setMode('grid')}
                  title="Grid 网格布局：快速分列排版"
                >⊞ 网格 Grid</button>
              </div>

              {isFlex && (
                <>
                  <div className="flex-helper-row">
                    <label>轴线方向 (flex-direction)</label>
                    <div className="flex-mini-seg">
                      <button
                        className={'flex-mini-btn' + (flexDir === 'row' ? ' active' : '')}
                        onClick={() => updateStyle(elementId, { flexDirection: 'row' })}
                        title="横排从左到右 (row)"
                      >⭲ 横排</button>
                      <button
                        className={'flex-mini-btn' + (flexDir === 'column' ? ' active' : '')}
                        onClick={() => updateStyle(elementId, { flexDirection: 'column' })}
                        title="竖排从上到下 (column)"
                      >⭳ 竖排</button>
                    </div>
                  </div>

                  <div className="flex-helper-row">
                    <label>主轴对齐 (justify-content)</label>
                    <select value={eff.justifyContent ?? ''} onChange={(e) => updateStyle(elementId, { justifyContent: e.target.value })}>
                      <option value="">— 默认 (开头靠拢) —</option>
                      {JUSTIFY_OPTIONS.map(([v, label]) => (<option key={v} value={v}>{label}</option>))}
                    </select>
                  </div>

                  <div className="flex-helper-row">
                    <label>交叉轴对齐 (align-items)</label>
                    <select value={eff.alignItems ?? ''} onChange={(e) => updateStyle(elementId, { alignItems: e.target.value })}>
                      <option value="">— 默认 (拉伸占满) —</option>
                      {ALIGN_OPTIONS.map(([v, label]) => (<option key={v} value={v}>{label}</option>))}
                    </select>
                  </div>

                  <div className="flex-helper-row">
                    <label>自动换行 (flex-wrap)</label>
                    <select value={eff.flexWrap ?? ''} onChange={(e) => updateStyle(elementId, { flexWrap: e.target.value })}>
                      <option value="">不换行 (nowrap) · 单行挤压</option>
                      <option value="wrap">wrap · 自动折行（多卡片推荐）</option>
                      <option value="wrap-reverse">wrap-reverse · 反向折行</option>
                    </select>
                  </div>

                  <div className="flex-helper-row">
                    <label>元素间距 (gap)</label>
                    <NumberUnitInput elementId={elementId} schemaKey="gap" unit="px" />
                  </div>

                  <div className="flex-helper-row flex-helper-exit">
                    <button className="flex-exit-btn" onClick={() => setMode('block')} title="恢复默认块级流式布局">恢复默认流式</button>
                  </div>
                </>
              )}

              {isGrid && (
                <>
                  <div className="flex-helper-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>网格预设 (常用多列模板)</span>
                      <span className="field-hint">点击快速应用</span>
                    </label>
                    <div className="grid-preset-grid">
                      {GRID_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          className={'grid-preset-btn' + (eff.gridTemplateColumns === p.value ? ' active' : '')}
                          onClick={() => updateStyle(elementId, { gridTemplateColumns: p.value })}
                          title={p.desc}
                        >{p.label}</button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-helper-row">
                    <label>列模板 (grid-template-columns)</label>
                    <input
                      type="text"
                      className="grid-template-input"
                      value={eff.gridTemplateColumns ?? ''}
                      placeholder="例：repeat(3, 1fr) 或 200px 1fr"
                      spellCheck={false}
                      onChange={(e) => updateStyle(elementId, { gridTemplateColumns: e.target.value })}
                    />
                  </div>

                  <div className="flex-helper-row">
                    <label>网格间距 (gap)</label>
                    <NumberUnitInput elementId={elementId} schemaKey="gap" unit="px" />
                  </div>

                  <div className="flex-helper-row">
                    <label>单元格对齐 (justify-items)</label>
                    <select value={eff.justifyItems ?? ''} onChange={(e) => updateStyle(elementId, { justifyItems: e.target.value })}>
                      <option value="">拉伸铺满 (stretch)</option>
                      <option value="start">靠左对齐 (start)</option>
                      <option value="center">水平居中 (center)</option>
                      <option value="end">靠右对齐 (end)</option>
                    </select>
                  </div>

                  <div className="flex-helper-row flex-helper-exit">
                    <button className="flex-exit-btn" onClick={() => setMode('block')} title="恢复默认块级流式布局">恢复默认流式</button>
                  </div>
                </>
              )}

              {mode === 'block' && (
                <div className="flex-helper-hint-row">
                  <span>当前为常规流式垂直堆叠。点「弹性 Flex」或「网格 Grid」可快速实现横向多列卡片排列。</span>
                </div>
              )}
            </div>
          </Collapse>
        </div>
      ) : (
        <div className="qh-block">
          <div className="qh-block-head static">
            <span className="qh-block-sub">当前是叶子元素，排版由父容器控制</span>
            {parent && parent.id !== scene.root.id && (
              <button className="btn-mini" onClick={() => selectElement(parent.id)} title="跳到父容器设置它的 Flex / Grid 布局">
                选中父级 &lt;{parent.type}&gt;
              </button>
            )}
          </div>
        </div>
      )}

      {/* ——— ② 文字渐变（仅文本元素可用） ——— */}
      {isText && (
        <div className="qh-block">
          <div className="qh-block-head">
            <button className="qh-block-toggle" onClick={() => setGradOpen((v) => !v)}>
              <span className={'page-advanced-caret' + (gradOpen ? ' open' : '')}>▸</span>
              文字渐变
            </button>
            <span className="qh-block-sub">让文字本身穿上渐变色</span>
            <HelpButton
              title="文字渐变原理与用法"
              content={
                '【为什么文字渐变要"多条属性配合"？】\n' +
                'CSS 没有"文字颜色渐变"这一条属性。业界通用做法是把一段渐变当作背景，再把它"裁"进文字形状里，共三步：\n\n' +
                '1. background-image: linear-gradient(...)  —— 先铺一块渐变\n' +
                '2. background-clip: text                    —— 只保留文字形状内的部分\n' +
                '3. -webkit-text-fill-color: transparent      —— 让文字本身透明，露出底下的渐变\n\n' +
                '【用法】\n' +
                '· 点下方任意一款预制配色，立即出效果；\n' +
                '· 想微调方向 / 颜色，展开渐变编辑器拖角度盘、改色标即可；\n' +
                '· 点「关闭文字渐变」可一键去掉。\n\n' +
                '【注意】\n' +
                '· 渐变会随文字本身一起缩放，超长文本建议配合较大的字号；\n' +
                '· 该效果在所有现代浏览器（Chrome / Edge / Safari / Firefox）都支持。'
              }
            />
          </div>
          <Collapse open={gradOpen}>
            <div className="qh-block-body">
              {!hasTextGrad ? (
                <>
                  <div className="flex-helper-hint-row">
                    <span>还没开启。点下面任意一款配色即可给文字上渐变：</span>
                  </div>
                  <div className="text-grad-quick">
                    {TEXT_GRADIENT_QUICK.map((p) => (
                      <button
                        key={p.name}
                        className="text-grad-chip"
                        style={{ backgroundImage: p.css }}
                        title={`套用「${p.name}」文字渐变`}
                        onClick={() => {
                          beginStyleEdit();
                          applyTextGradient(p.css);
                          endStyleEdit();
                        }}
                      ><span>{p.name}</span></button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-grad-actions">
                    <span className="field-hint">已开启文字渐变，可直接在下方微调</span>
                    <button
                      className="btn-mini btn-danger"
                      onClick={() => {
                        beginStyleEdit();
                        updateStyle(elementId, {
                          backgroundImage: undefined,
                          backgroundClip: undefined,
                          WebkitBackgroundClip: undefined,
                          WebkitTextFillColor: undefined
                        } as any);
                        endStyleEdit();
                      }}
                      title="移除文字渐变，恢复普通文字颜色"
                    >关闭文字渐变</button>
                  </div>
                  {/* 已开启时不再重复列一遍配色胶囊（下方渐变编辑器里已有完整配色画廊） */}
                  <GradientEditor
                    value={textGradCss}
                    scope="text"
                    onChange={(css) => {
                      beginStyleEdit();
                      gradDraftRef.current = css;
                      applyTextGradient(css, true);
                    }}
                    onCommit={() => {
                      applyTextGradient(gradDraftRef.current || textGradCss);
                      endStyleEdit();
                    }}
                    onRemove={() => {
                      beginStyleEdit();
                      updateStyle(elementId, {
                        backgroundImage: undefined,
                        backgroundClip: undefined,
                        WebkitBackgroundClip: undefined,
                        WebkitTextFillColor: undefined
                      } as any);
                      endStyleEdit();
                    }}
                  />
                </>
              )}
            </div>
          </Collapse>
        </div>
      )}

      {!isContainer && !isText && (
        <div className="flex-helper-hint-row">
          <span>该元素既不是容器也不是文本，暂无可用的快捷设置。</span>
        </div>
      )}
    </div>
  );
}

/** 兼容旧引用（原「布局助手」名字） */
export const FlexHelper = QuickHelper;

export default QuickHelper;
