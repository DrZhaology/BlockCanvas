import { useScene, findNode, findParent, getEffectiveStyle } from '@store/sceneStore';
import { CONTAINER_TAGS, TEXT_TAGS } from '@lib/types';
import type { ElementType } from '@lib/types';
import { NumberUnitInput } from './NumberUnitInput';
import { HelpButton } from './HelpButton';
import { GradientEditor } from './GradientEditor';
import { Collapse } from './Collapse';
import { Icon } from './Icon';
import { useEffect, useRef, useState } from 'react';
import { usePersistedBool } from '@lib/usePersisted';
import { askPositionSwitch } from '@lib/posSwitch';
import { readSticky } from './canvas/sticky';
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

/** 定位方式（与 CSS position 的取值一致） */
type PosKind = 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';

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
  const [posOpen, setPosOpen] = usePersistedBool('qh-position-open', false);
  const [marginConfirm, setMarginConfirm] = useState<'x' | 'y' | null>(null);
  const [gradOpen, setGradOpen] = usePersistedBool('qh-textgrad-open', true);
  const gradDraftRef = useRef('');

  const node = findNode(scene.root, elementId);
  if (!node) return null;

  const eff = getEffectiveStyle(node, activeBreakpoint) as Record<string, string | undefined>;

  // —— 定位助手：居中前先看原有 margin，避免和 margin:auto 打架（v0.4.5）——
  const marginSides = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
  const marginVals = marginSides.map((k) => eff[k] ?? '');
  const marginSummary = marginVals
    .map((v, i) => `${['上', '右', '下', '左'][i]} ${v || '0'}`)
    .join(' · ');
  const marginDirty = marginVals.some((v) => !!v && v !== '0' && v !== '0px' && v !== 'auto');
  const marginIrregular = new Set(marginVals.map((v) => v || '0px')).size > 1;

  // —— 定位：四边解锁（v0.4.6 · 用户定的模型）——
  //
  // 用户原话：
  //   「定位助手 fixed 的时候，单独显示 top right left bottom 四个元素，前面是选择框，
  //     没有选中的话，Alt 不能拖动，也不能直接改数值。点击后这个属性就解锁了……
  //     4 个属性可以单独解锁，但是最多只能解锁两个，并且只能解锁对角组合：
  //     left top / left bottom / right top / right bottom。Alt 能在视口内自由拖动的时候，
  //     用两边的定位最稳。用户不懂怎么选就做四个角的预选框：左上/左下/右上/右下。」
  //
  // 所以界面是：4 个带复选框的边 + 4 个角快捷按钮。规则只有一条——
  // **最多一边 X + 一边 Y**（点同轴的另一个就是替换，不是叠加）。
  const OFFSET_SIDES = ['top', 'right', 'bottom', 'left'] as const;
  type Side = typeof OFFSET_SIDES[number];
  const posNow = (eff.position ?? 'static') as PosKind;
  const relLike = posNow === 'relative' || posNow === 'sticky';
  // v0.4.6（R6-17）：sticky 是否真的会吸附（没写 top/bottom 就永远不会）
  const stickyInfo = readSticky(eff as Record<string, string | undefined>);
  const [unlocked, setUnlocked] = useState<Side[]>(() => {
    const on = OFFSET_SIDES.filter((k) => !!eff[k] && eff[k] !== 'auto');
    return on.length ? on.slice(0, 2) : ['left', 'top'];
  });
  useEffect(() => {
    if (relLike) return;
    const on = OFFSET_SIDES.filter((k) => !!eff[k] && eff[k] !== 'auto');
    if (on.length) setUnlocked(on.slice(0, 2));
  }, [relLike, eff.left, eff.right, eff.top, eff.bottom]);

  /** 解锁/锁定一条边：同轴的另一条会被替换（保证"最多一边 X + 一边 Y"） */
  const toggleSide = (k: Side) => {
    const isX = k === 'left' || k === 'right';
    const cur = unlocked.includes(k)
      ? unlocked.filter((s) => s !== k)
      : [...unlocked.filter((s) => (isX ? s !== 'left' && s !== 'right' : s !== 'top' && s !== 'bottom')), k];
    setUnlocked(cur);
    // 锁上的边写回 auto；解锁的边给个 0px 起点，用户马上能改
    const patch: Record<string, string | undefined> = {};
    for (const s of OFFSET_SIDES) {
      if (cur.includes(s)) { if (!eff[s] || eff[s] === 'auto') patch[s] = '0px'; }
      else if (eff[s] && eff[s] !== 'auto') patch[s] = 'auto';
    }
    if (Object.keys(patch).length) {
      beginStyleEdit();
      updateStyle(elementId, patch as never);
      endStyleEdit();
    }
  };

  /**
   * 居中钉死（v0.4.6，用户 A3）：
   *   「横向对齐和竖向对齐也做一下，是选择框，设置了这个对齐，上面的四个属性就不可以设置了。
   *     设置了对齐就相当于钉死在 1 维，另一个方向上下/左右的移动还是照做。」
   *
   * 实现：钉死 = 两侧都写 0 + 外边距 auto（CSS 里这就是"居中"的标准写法）。
   * 一旦钉住，那条轴的复选框禁用，Alt 拖动也不会去改它（否则 left≠right 就不居中了）。
   */
  const isAuto = (v?: string) => (v ?? '') === 'auto';
  /** sticky 现在吸哪一边（写在哪条边上就以哪边为准） */
  const stickySide: 'top' | 'bottom' =
    !!eff.bottom && eff.bottom !== 'auto' && (!eff.top || eff.top === 'auto') ? 'bottom' : 'top';
  const pinX = !!eff.left && eff.left !== 'auto' && !!eff.right && eff.right !== 'auto'
    && isAuto(eff.marginLeft) && isAuto(eff.marginRight);
  const pinY = !!eff.top && eff.top !== 'auto' && !!eff.bottom && eff.bottom !== 'auto'
    && isAuto(eff.marginTop) && isAuto(eff.marginBottom);

  const togglePin = (axis: 'x' | 'y', on: boolean) => {
    const patch: Record<string, string | undefined> = axis === 'x'
      ? (on
        ? { left: '0px', right: '0px', marginLeft: 'auto', marginRight: 'auto' }
        : { right: 'auto', marginLeft: '0px', marginRight: '0px' })
      : (on
        ? { top: '0px', bottom: '0px', marginTop: 'auto', marginBottom: 'auto' }
        : { bottom: 'auto', marginTop: '0px', marginBottom: '0px' });
    beginStyleEdit();
    updateStyle(elementId, patch as never);
    endStyleEdit();
  };

  /** 四角预设：一次把两边的解锁状态设好 */
  const pickCorner = (x: 'left' | 'right', y: 'top' | 'bottom') => {    setUnlocked([x, y]);
    const patch: Record<string, string | undefined> = {};
    for (const s of OFFSET_SIDES) {
      const on = s === x || s === y;
      if (on) { if (!eff[s] || eff[s] === 'auto') patch[s] = '0px'; }
      else if (eff[s] && eff[s] !== 'auto') patch[s] = 'auto';
    }
    beginStyleEdit();
    updateStyle(elementId, patch as never);
    endStyleEdit();
  };

  /**
   * 真正写定位方式。
   *
   * v0.4.6：**统一走 askPositionSwitch**（全屏模态，三选项，第三个绿色）——
   * 以前只有快捷助手里有内联确认条，从 CSS 属性行的下拉直接改 position 就完全不提示，
   * 用户的原话是"有些地方做了，有些时候改的时候不会有提示，这次做统一"。
   */
  const applyPosition = (next: PosKind, clearMargin: boolean) => {
    const patch: Record<string, string | undefined> = { position: next };
    if (next === 'static') {
      patch.left = 'auto'; patch.right = 'auto'; patch.top = 'auto'; patch.bottom = 'auto';
    } else if (next === 'relative' || next === 'sticky') {
      // 相对/粘性：偏移是"相对自身原位的位移"，固定用 left+top（另一边清成 auto）
      patch.right = 'auto';
      patch.bottom = 'auto';
      if (eff.left === undefined || eff.left === 'auto') patch.left = '0px';
      if (eff.top === undefined || eff.top === 'auto') patch.top = '0px';
    } else {
      // absolute / fixed：按当前解锁的组合只留两边，其余置 auto
      for (const s of OFFSET_SIDES) {
        const on = unlocked.includes(s);
        if (!on) patch[s] = 'auto';
        else if (eff[s] === undefined || eff[s] === 'auto') patch[s] = '0px';
      }
    }
    if (clearMargin) {
      patch.marginTop = '0px'; patch.marginRight = '0px';
      patch.marginBottom = '0px'; patch.marginLeft = '0px';
    }
    beginStyleEdit();
    updateStyle(elementId, patch as never);
    endStyleEdit();
    setMarginConfirm(null);
  };

  /** 切换定位方式：margin 不干净 → 先全屏确认（三选项，第三个绿色推荐） */
  const changePosition = async (next: PosKind) => {
    if (next === posNow) return;
    if ((marginDirty || marginIrregular) && next !== 'static') {
      const choice = await askPositionSwitch({
        next: next === 'fixed' ? '固定定位 (fixed)' : next === 'absolute' ? '绝对定位 (absolute)' : next,
        margins: marginSummary,
        elementTag: String(elementType)
      });
      if (choice === 'cancel') return;
      applyPosition(next, choice === 'clear');
      return;
    }
    applyPosition(next, false);
  };

  /**
   * 居中。
   *
   * v0.4.5 第 8 批（用户反馈）：
   * 「整个 fixed 的定位和 relative 非常糟糕，说了 fixed 要自动适配，**不要 4 边的都调整**，
   *   因为我浏览器视口和画布完全不一样！」
   *
   * 以前 fixed 也走 `left:0; right:0; margin:auto` —— 那是**四个边一起被改**，
   * 而且在浏览器里居中的是"真实视口"，画布上看到的完全是另一回事（画布宽度 ≠ 视口宽度）。
   * 现在 fixed 改用**单边 + 百分比**：
   *   left: calc(50% - 元素宽一半)  →  只改 left 一边，且自动适配任何视口宽度。
   * 这样画布里看着居中，导出后在浏览器里同样居中（百分比跟着视口走）。
   */
  const applyCenter = (axis: 'x' | 'y', clearFirst: boolean) => {
    beginStyleEdit();
    const pos = eff.position ?? '';
    const positioned = pos === 'absolute' || pos === 'fixed';
    const isFixed = pos === 'fixed';

    if (isFixed) {
      // 量元素自身的布局尺寸（offsetWidth/Height 是 CSS 像素，不受画布 scale(zoom) 影响）
      const el = document.querySelector(`.canvas [data-bc-id="${CSS.escape(elementId)}"]`) as HTMLElement | null;
      const w = el?.offsetWidth ?? 0;
      const h = el?.offsetHeight ?? 0;
      const patch = axis === 'x'
        ? { left: `calc(50% - ${Math.round(w / 2)}px)`, right: undefined, marginLeft: '0', marginRight: '0' }
        : { top: `calc(50% - ${Math.round(h / 2)}px)`, bottom: undefined, marginTop: '0', marginBottom: '0' };
      updateStyle(elementId, patch as never);
      endStyleEdit();
      setMarginConfirm(null);
      return;
    }

    const clear = clearFirst
      ? (axis === 'x'
        ? { marginLeft: '0px', marginRight: '0px' }
        : { marginTop: '0px', marginBottom: '0px' })
      : {};
    const center = axis === 'x'
      ? (positioned
        ? { left: '0px', right: '0px', marginLeft: 'auto', marginRight: 'auto' }
        : { marginLeft: 'auto', marginRight: 'auto' })
      : (positioned
        ? { top: '0px', bottom: '0px', marginTop: 'auto', marginBottom: 'auto' }
        : { marginTop: 'auto', marginBottom: 'auto' });
    updateStyle(elementId, { ...clear, ...center });
    endStyleEdit();
    setMarginConfirm(null);
  };

  const requestCenter = (axis: 'x' | 'y') => {
    // fixed 走"单边百分比"方案，不改 margin、不需要确认
    if ((eff.position ?? '') === 'fixed') {
      applyCenter(axis, true);
      return;
    }
    if (marginDirty || marginIrregular) {
      setMarginConfirm(axis);
      return;
    }
    applyCenter(axis, false);
  };

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
        <label className="qh-sync-label" title="开启后，快捷助手生成的样式会同时出现在下方「CSS 样式属性」列表里（便于查看与微调）；关闭后下方列表不再显示这些属性，但样式依然生效。">
          <input
            type="checkbox"
            checked={showInCss}
            onChange={(e) => onShowInCssChange(e.target.checked)}
          />
          显示到下方 CSS 属性
        </label>
        <HelpButton
          title="「显示到下方 CSS 属性」是什么意思？"
          content={
            '快捷助手做的事情，本质上是帮你一次性写好几条 CSS 属性：\n\n' +
            '· 弹性布局 = display + flex-direction + gap + …\n' +
            '· 文字渐变 = background-image + background-clip: text + -webkit-text-fill-color: transparent\n\n' +
            '开启本开关：这些属性会同步出现在下方「CSS 样式属性」列表，方便你逐条查看与微调。\n\n' +
            '关闭本开关（默认）：下方列表不再显示它们，面板更清爽；样式本身完全不受影响，随时可在快捷助手里改。\n' +
            '关掉之后如果想临时改其中某一条，在画布上对该元素按**鼠标中键**搜这条属性即可。'
          }
        />
      </div>

      {/* ——— ① 布局（仅容器可用） ——— */}
      {isContainer ? (
        <div className="qh-block">
          <div className="qh-block-head">
            <button className="qh-block-toggle" onClick={() => setLayoutOpen((v) => !v)}>
              <span className={'page-advanced-caret' + (layoutOpen ? ' open' : '')}><Icon name="chevronRight" size={11} /></span>
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
                ><Icon name="indent" size={12} /> 弹性 Flex</button>
                <button
                  className={'seg-btn' + (mode === 'grid' ? ' active' : '')}
                  onClick={() => setMode('grid')}
                  title="Grid 网格布局：快速分列排版"
                ><Icon name="grid" size={12} /> 网格 Grid</button>
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
                      ><Icon name="indent" size={12} /> 横排</button>
                      <button
                        className={'flex-mini-btn' + (flexDir === 'column' ? ' active' : '')}
                        onClick={() => updateStyle(elementId, { flexDirection: 'column' })}
                        title="竖排从上到下 (column)"
                      ><Icon name="outdent" size={12} /> 竖排</button>
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

      {/* ——— ①.5 定位助手（v0.4.5）——— */}
      <div className="qh-block">
        <div className="qh-block-head">
          <button className="qh-block-toggle" onClick={() => setPosOpen((v) => !v)}>
            <span className={'page-advanced-caret' + (posOpen ? ' open' : '')}><Icon name="chevronRight" size={11} /></span>
            定位助手
          </button>
          <span className="qh-block-sub">贴边 / 居中 / 悬浮</span>
          <HelpButton
            title="定位助手"
            content={
              '【它是干什么的】\n' +
              '把「position + left/top/right/bottom + margin:auto」这套要配合起来才生效的定位属性，做成几个按钮。\n\n' +
              '【三种常用姿势】\n' +
              '· 相对定位 relative：元素还在原来的位置，只做偏移（不影响其他元素）。\n' +
              '· 绝对定位 absolute：脱离文档流，相对最近的定位父容器摆放。\n' +
              '· 固定定位 fixed：相对浏览器窗口固定，滚动页面也不动（悬浮按钮 / 回到顶部）。\n\n' +
              '【居中为什么要用 margin:auto】\n' +
              '绝对定位元素写 left:0; right:0; margin-left:auto; margin-right:auto 才会真正水平居中；\n' +
              '只写 left:50% 会以元素左上角对齐中线，看起来偏右。垂直居中同理，且元素需要有明确高度。'
            }
          />
        </div>
        {posOpen && (
          <div className="pos-helper">
            <div className="flex-helper-row">
              <label>定位方式 (position)</label>
              <select
                value={eff.position ?? 'static'}
                onChange={(e) => changePosition(e.target.value as PosKind)}
              >
                <option value="static">默认流式 (static)</option>
                <option value="relative">相对定位 (relative)</option>
                <option value="absolute">绝对定位 (absolute)</option>
                <option value="fixed">固定定位 (fixed · 悬浮在窗口)</option>
                <option value="sticky">粘性定位 (sticky)</option>
              </select>
            </div>

            {/*
              锚定两边（v0.4.5 第十六批 · 用户反复要求）
              ------------------------------------------------------------------
              用户原话：「不要同时给 top right bottom left 同时给数值，画布上就用两个，
                        比如左上角区域就用 left top，不要 4 个都给。」
              CSS 里一个元素在**同一根轴**上同时写 left 与 right（又没写 width）时，
              两边会一起参与计算：元素被"撑满"，或者 one-side 被忽略 —— 表现就是
              "我明明只调了一个数，它却整体变形/不动"。
              所以界面上**只暴露两根轴各一边**，另一边自动写 `auto`（而不是留个空框让人误会）。
              relative / sticky 的偏移是"相对自身原位"的位移，两边同写没有意义，固定用 left/top。
            */}
            {/* 四边解锁（v0.4.6）：勾上哪条边，才能拖/能改那条边的数值；最多一条 X + 一条 Y */}
            <div className={'pos-edges' + (['absolute', 'fixed', 'relative', 'sticky'].includes(eff.position ?? '') ? '' : ' is-disabled')}>
              {relLike ? (
                posNow === 'sticky' ? (
                  /**
                   * 粘性定位（v0.4.6 重排）：用户原话"设置粘不粘的属性和定位混在一起，我不会用"。
                   * 现在按"人怎么想"排：
                   *   ① 吸哪一边（吸顶 / 吸底）—— 二选一，不再是两个数字框让人猜
                   *   ② 距边多少（一个数字框，作用在选中的那一边）
                   * 选一边时另一边自动置 auto，屏幕上永远只有一条吸附距离。
                   */
                  <div className="pos-sticky-box">
                    <div className="pos-line">
                      <label className="pos-line-check"><span>吸附方向</span></label>
                      <div className="pos-sticky-seg">
                        <button
                          className={'pos-corner-btn' + (stickySide === 'top' ? ' is-on' : '')}
                          onClick={() => {
                            beginStyleEdit();
                            updateStyle(elementId, {
                              top: eff.top && eff.top !== 'auto' ? eff.top : '0px',
                              bottom: 'auto'
                            } as never);
                            endStyleEdit();
                          }}
                          title="向下滚动时，元素碰到这条线就挂住"
                        >吸顶</button>
                        <button
                          className={'pos-corner-btn' + (stickySide === 'bottom' ? ' is-on' : '')}
                          onClick={() => {
                            beginStyleEdit();
                            updateStyle(elementId, {
                              bottom: eff.bottom && eff.bottom !== 'auto' ? eff.bottom : '0px',
                              top: 'auto'
                            } as never);
                            endStyleEdit();
                          }}
                          title="向上滚动时，元素碰到这条线就挂住"
                        >吸底</button>
                      </div>
                    </div>
                    <div className="pos-line">
                      <label className="pos-line-check"><span>距边多少</span></label>
                      <NumberUnitInput elementId={elementId} schemaKey={stickySide} unit="px" />
                    </div>
                  </div>
                ) : (
                  <div className="pos-line">
                    <label className="pos-line-check"><span>偏移量</span></label>
                    <NumberUnitInput elementId={elementId} schemaKey="left" unit="px" />
                    <NumberUnitInput elementId={elementId} schemaKey="top" unit="px" />
                  </div>
                )
              ) : (
                <>
                  {OFFSET_SIDES.map((k) => {
                    const on = unlocked.includes(k);
                    const label = k === 'top' ? '上 top' : k === 'right' ? '右 right' : k === 'bottom' ? '下 bottom' : '左 left';
                    return (
                      <div key={k} className={'pos-line' + (on ? ' is-on' : '')}>
                        <label className="pos-line-check">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!['absolute', 'fixed'].includes(eff.position ?? '')
                              || ((k === 'left' || k === 'right') ? pinX : pinY)}
                            onChange={() => toggleSide(k)}
                          />
                          <span>{label}</span>
                        </label>
                        {on
                          ? <NumberUnitInput elementId={elementId} schemaKey={k} unit="px" />
                          : <span className="pos-line-locked">未解锁</span>}
                      </div>
                    );
                  })}
                  {/* 居中钉死：勾上就把这条轴固定在中间，另一条轴照样能拖 */}
                  <div className="pos-pin-row">
                    <label className="pos-line-check" title="钉住左右：两侧写 0 + 外边距 auto，只留上下能拖">
                      <input
                        type="checkbox"
                        checked={pinX}
                        disabled={!['absolute', 'fixed'].includes(eff.position ?? '')}
                        onChange={(e) => togglePin('x', e.target.checked)}
                      />
                      <span>水平居中</span>
                    </label>
                    <label className="pos-line-check" title="钉住上下：两侧写 0 + 外边距 auto，只留左右能拖">
                      <input
                        type="checkbox"
                        checked={pinY}
                        disabled={!['absolute', 'fixed'].includes(eff.position ?? '')}
                        onChange={(e) => togglePin('y', e.target.checked)}
                      />
                      <span>垂直居中</span>
                    </label>
                  </div>

                  {/* 四角预设：不懂"解锁哪两条"的话，点一下角就够了 */}
                  <div className="pos-corner-row">
                    <span className="pos-corner-label">对齐到角</span>
                    <div className="pos-corner-btns">
                      {([
                        ['left', 'top', '左上'],
                        ['right', 'top', '右上'],
                        ['left', 'bottom', '左下'],
                        ['right', 'bottom', '右下']
                      ] as const).map(([x, y, text]) => (
                        <button
                          key={text}
                          className={'pos-corner-btn' + (unlocked.includes(x) && unlocked.includes(y) ? ' is-on' : '')}
                          disabled={!['absolute', 'fixed'].includes(eff.position ?? '')}
                          onClick={() => pickCorner(x, y)}
                          title={`解锁 ${x === 'left' ? '左' : '右'} + ${y === 'top' ? '上' : '下'}（对角两边最稳）`}
                        >{text}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            {/* relative / sticky：把"原文档流位置"写清楚（用户反馈这行字跑到框外面了） */}
            {relLike && (
              <div className="pos-rel-note">
                <Icon name="info" size={12} />
                <span>
                  {posNow === 'sticky'
                    ? <>粘性定位：元素先跟随内容滚动，直到碰到你设的<strong>吸附距离</strong>才挂住。</>
                    : <>相对定位：元素<strong>原文档流位置</strong>不动，只按 left / top 做偏移。所以这里的数值是"位移量"，可以填负数。</>}
                </span>
              </div>
            )}
            {/* v0.4.6（R6-17）：sticky 没写吸附距离 = 永远不会吸附（最常见的错，必须显性提示） */}
            {posNow === 'sticky' && stickyInfo?.state === 'idle' && (
              <div className="pos-sticky-warn">
                <Icon name="warning" size={12} />
                <span>
                  还没设<strong>吸附距离</strong> —— 没有 top / bottom 的话，sticky <strong>永远不会吸附</strong>，
                  看起来和普通元素一模一样。在上面的纵向锚定里填一个值（比如 20px）试试。
                </span>
              </div>
            )}
            {posNow === 'sticky' && stickyInfo?.state === 'armed' && (
              <div className="pos-sticky-ok">
                <Icon name="check" size={12} />
                <span>
                  会吸附：滚动到距{stickyInfo.side === 'top' ? '顶部' : stickyInfo.side === 'bottom' ? '底部' : '侧边'} {stickyInfo.offset} 处挂住
                  （画布上已用角标和虚线标出吸附线）。
                  {stickyInfo.horizontal && ' 横向还设了 left/right：只有容器能横向滚动时才生效。'}
                </span>
              </div>
            )}
            {!['absolute', 'fixed', 'relative', 'sticky'].includes(eff.position ?? '') && (
              <div className="pos-static-note">当前是默认流式布局：先在上面选一种定位方式，偏移才会生效。</div>
            )}
            {/* 绝对/固定定位：偏移不允许为负（用户反馈"甚至能达到负数，不对"）*/}
            {['absolute', 'fixed'].includes(eff.position ?? '') && (
              <div className="pos-clamp-note">
                绝对 / 固定定位只能往容器<strong>内部</strong>排：偏移小于 0 会自动当成 0。
                想让它贴左就用 left、贴右就用 right（不要两边都给）。
              </div>
            )}

            <div className="pos-actions">
              <button
                className="pos-btn"
                onClick={() => requestCenter('x')}
                title={(eff.position ?? '') === 'fixed'
                  ? '写 left: calc(50% - 宽÷2) —— 只改左边一条，自动适配任何视口宽度（不动四边）'
                  : ['absolute'].includes(eff.position ?? '')
                    ? '左右都设 0 + 外边距自动 → 水平居中（需要元素有明确宽度）'
                    : '左右外边距自动 → 块级元素水平居中（需要元素有明确宽度）'}
              ><Icon name="columns" size={13} /> 水平居中</button>
              <button
                className="pos-btn"
                onClick={() => requestCenter('y')}
                title={(eff.position ?? '') === 'fixed'
                  ? '写 top: calc(50% - 高÷2) —— 只改上边一条，自动适配任何视口高度（不动四边）'
                  : '上下都设 0 + 外边距自动 → 垂直居中（需要元素有明确高度；流式元素需要父级是 Flex 才生效）'}
              ><Icon name="rows" size={13} /> 垂直居中</button>
              <button
                className="pos-btn is-ghost"
                onClick={() => {
                  beginStyleEdit();
                  updateStyle(elementId, {
                    position: 'static', left: 'auto', right: 'auto', top: 'auto', bottom: 'auto',
                    marginLeft: 'auto', marginRight: 'auto', marginTop: 'auto', marginBottom: 'auto'
                  });
                  endStyleEdit();
                  setMarginConfirm(null);
                }}
                title="清掉定位与偏移，回到普通文档流"
              ><Icon name="undo" size={13} /> 清除定位</button>
            </div>

            {/* 切换定位方式的 margin 确认：v0.4.6 起统一走全屏模态（lib/posSwitch.tsx），
                不再在这里写内联确认条 —— 否则"有些地方提示、有些地方不提示"。 */}

            {/* 内联确认条（不是全屏弹窗）：原 margin 不对称/非零时，先问一句再清零 */}
            {marginConfirm && (
              <div className="pos-confirm">
                <div className="pos-confirm-text">
                  这个元素已有<strong>非零或不对称</strong>的外边距（{marginSummary}）。
                  居中要用 <code>margin:auto</code>，会和它冲突。
                </div>
                <div className="pos-confirm-actions">
                  <button className="pos-confirm-btn is-primary" onClick={() => applyCenter(marginConfirm, true)}>
                    先清零再居中
                  </button>
                  <button className="pos-confirm-btn" onClick={() => applyCenter(marginConfirm, false)}>
                    保留原 margin
                  </button>
                  <button className="pos-confirm-btn is-ghost" onClick={() => setMarginConfirm(null)}>
                    取消
                  </button>
                </div>
              </div>
            )}

            <div className="pos-hint">
              居中需要元素有<strong>明确宽/高</strong>。<strong>fixed</strong> 导出后相对浏览器视口 ——
              画布上那个<strong>红色框</strong>就是它的参照面。
            </div>
          </div>
        )}
      </div>

      {/* ——— ② 文字渐变（仅文本元素可用） ——— */}
      {isText && (
        <div className="qh-block">
          <div className="qh-block-head">
            <button className="qh-block-toggle" onClick={() => setGradOpen((v) => !v)}>
              <span className={'page-advanced-caret' + (gradOpen ? ' open' : '')}><Icon name="chevronRight" size={11} /></span>
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
