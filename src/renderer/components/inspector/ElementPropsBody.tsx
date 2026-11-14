// BlockCanvas · 属性面板「元素」页签主体
//
// 这一屏是属性面板 90% 的内容：断点条 / 选择器与标识 / 快捷助手 / 交互状态 / CSS 样式属性。
// 拆分前这 960 行全在一个函数里 —— 改一行要担心另外四个区块。
// 行组件在 ./rows，折叠状态与顺序由本文件统一管。

import { useState, useEffect, useRef } from 'react';
import { useScene } from '@store/sceneStore';
import { TEXT_TAGS, CONTAINER_TAGS } from '@lib/types';
import type { SceneElement } from '@lib/types';
import { SCHEMA, ATTRS_SCHEMA, DEFAULT_VISIBLE_PROPS, getSchemaItem, isApplicable, hasStyleValue, presetValue } from '@lib/propertySchema';
import { getPluginProperties } from '@lib/pluginHost';
import { useShowBr } from '@lib/showBr';
import { subscribePropFocus, takePendingPropFocus } from '@lib/propFocus';
import type { PropFocusRequest } from '@lib/propFocus';
import { findTableAncestor } from '@lib/tableOps';
import { isGradient } from '@lib/gradient';
import { requestDevice, useEffectiveDevice } from '@lib/device';
import { planResponsiveFixes } from '@lib/responsiveAuto';
import { appAlert, appConfirm } from '@lib/appConfirm';
import { Icon } from '../Icon';
import { MediaPropsCard } from '../MediaPropsCard';
import { GhostPropCard } from '../GhostPropCard';
import { QuickHelper, HELPER_MANAGED_KEYS } from '../QuickHelper';
import { Collapse } from '../Collapse';
import { useCanvasWidth } from './useCanvasWidth';
import { useHelperInCss, useInspectorSectionOpen } from './useInspectorState';
import { IdentitySection } from './sections/IdentitySection';
import { PseudoSection } from './sections/PseudoSection';
import { CssPropsSection } from './sections/CssPropsSection';

export function ElementPropsBody(props: { selected: SceneElement; justAddedKey: string | null; onJustAdded: (k: string | null) => void }) {
  const { selected, justAddedKey, onJustAdded } = props;
  const updateStyle = useScene((s) => s.updateStyle);
  const setText = useScene((s) => s.setText);
  // 「显示 <br>」开关：与画布就地编辑框共用同一份状态（见 lib/showBr.ts）
  const [showBr, setShowBr] = useShowBr();
  const addVisibleProp = useScene((s) => s.addVisibleProp);
  const removeVisibleProp = useScene((s) => s.removeVisibleProp);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);
  const clearBreakpointOverride = useScene((s) => s.clearBreakpointOverride);
  const setActiveBreakpoint = useScene((s) => s.setActiveBreakpoint);
  const canvasWidth = useCanvasWidth();
  const canvasAuto = !canvasWidth || canvasWidth === 'auto';
  // 设备高亮按**画布实际宽度**判断：自适应时窗口变窄，会自动切到平板 / 手机
  const liveDevice = useEffectiveDevice(canvasWidth);
  // 自适应模式下，编辑断点跟着实际宽度走（否则在 375px 画布上还在改电脑端样式）
  useEffect(() => {
    if (canvasAuto && activeBreakpoint !== liveDevice) setActiveBreakpoint(liveDevice);
  }, [canvasAuto, liveDevice, activeBreakpoint, setActiveBreakpoint]);
  const elementId = selected.id;
  const elementType = selected.type;
  // v0.4.3：选中项是不是表格（或表格里的单元格/行）—— 是则给出「打开表格编辑器」入口
  // （用 getState 取根：本组件由父级随 scene 变化重渲染，无需再订阅一次）
  const tableOwner = findTableAncestor(useScene.getState().scene.root, elementId);
  // 是否已有可挂 CSS 规则的"名字"（类名 / 关系选择器 / ID）—— 没有名字则伪类导出后不生效
  const hasSelector = Boolean(
    (selected.attrs?.relSelector ?? '').trim() ||
    (selected.attrs?.className ?? '').trim() ||
    (selected.attrs?.id ?? '').trim()
  );

  const hasTabletOverride = Boolean(selected.responsive?.tablet && Object.keys(selected.responsive.tablet).length > 0);
  const hasMobileOverride = Boolean(selected.responsive?.mobile && Object.keys(selected.responsive.mobile).length > 0);
  const hasCurBpOverride = Boolean(
    activeBreakpoint !== 'desktop' &&
    selected.responsive?.[activeBreakpoint] &&
    Object.keys(selected.responsive[activeBreakpoint]!).length > 0
  );

  const isCurrentHidden = Boolean(activeBreakpoint !== 'desktop' && selected.responsive?.[activeBreakpoint]?.display === 'none');
  const toggleHideOnDevice = () => {
    updateStyle(elementId, { display: isCurrentHidden ? undefined : 'none' });
  };
  const toggleColumnLayout = () => {
    updateStyle(elementId, { display: 'flex', flexDirection: 'column' });
  };
  const toggleFullWidth = () => {
    updateStyle(elementId, { width: '100%', boxSizing: 'border-box' });
  };

  // ✨ 整页自动适配：按当前断点批量重排（只算建议 → 确认 → 一次性写入，一条撤销可回退）
  const autoFitPage = async () => {
    if (activeBreakpoint === 'desktop') return;
    const bp = activeBreakpoint as 'tablet' | 'mobile';
    const bpName = bp === 'mobile' ? '手机' : '平板';
    const root = useScene.getState().scene.root;
    const fixes = planResponsiveFixes(root, bp);
    if (fixes.length === 0) {
      void appAlert(`这一页在「${bpName}」断点下已经很合适了 —— 没有需要自动调整的地方。`, '无需调整');
      return;
    }
    const preview = fixes.slice(0, 6).map((f) => `· ${f.label}：${f.reasons[0]}`).join('\n');
    const more = fixes.length > 6 ? `\n…还有 ${fixes.length - 6} 个元素` : '';
    const ok = await appConfirm({
      title: `整页自动适配（${bpName}）`,
      body: `将为「${bpName}」断点自动调整 ${fixes.length} 个元素：\n\n${preview}${more}\n\n` +
        `· 只影响当前断点的样式，电脑端完全不受影响\n` +
        `· 全部改动算一步，Ctrl+Z 可整体撤销\n\n继续？`,
      okText: '开始调整'
    });
    if (!ok) return;
    beginStyleEdit();
    for (const f of fixes) updateStyle(f.id, f.patch);
    endStyleEdit();
  };

  // 折叠状态（可独立展开/收起）- 同类名/同选择器元素共享折叠记忆
  // v0.4.4：记忆改存**工程文件**（scene.uiState.inspectorSec），一次性迁移自 localStorage；
  // 切换元素时不会把上一个元素的开关状态写到新元素名下。实现在 useInspectorState.ts。
  const { secOpen, setSecOpen } = useInspectorSectionOpen(selected);

  // 「快捷助手 → 是否显示到下方 CSS 属性」开关（全局统一，设置页同一开关，事件双向同步）
  const [showHelperInCss, changeShowHelperInCss] = useHelperInCss();

  // 伪类编辑区：:hover / :active / :focus / :link
  const PSEUDO_CLASSES = ['hover', 'active', 'focus', 'link'] as const;
  type PseudoClass = typeof PSEUDO_CLASSES[number];
  const pseudoStyles = selected.pseudoStyles ?? {};

  // 智能默认选中：若当前元素已有 :hover 覆盖，自动切到 :hover 标签，避免用户误以为 hover 丢失
  const [activePseudo, setActivePseudo] = useState<PseudoClass | null>(() => {
    if (pseudoStyles.hover && Object.keys(pseudoStyles.hover).length > 0) return 'hover';
    if (pseudoStyles.active && Object.keys(pseudoStyles.active).length > 0) return 'active';
    if (pseudoStyles.focus && Object.keys(pseudoStyles.focus).length > 0) return 'focus';
    if (pseudoStyles.link && Object.keys(pseudoStyles.link).length > 0) return 'link';
    return null;
  });

  // 切换元素时，自动定位到该元素已有的第一个伪类状态（若有），否则回到默认状态
  useEffect(() => {
    const ps = selected.pseudoStyles ?? {};
    if (ps.hover && Object.keys(ps.hover).length > 0) {
      setActivePseudo('hover');
    } else if (ps.active && Object.keys(ps.active).length > 0) {
      setActivePseudo('active');
    } else if (ps.focus && Object.keys(ps.focus).length > 0) {
      setActivePseudo('focus');
    } else if (ps.link && Object.keys(ps.link).length > 0) {
      setActivePseudo('link');
    } else {
      setActivePseudo(null);
    }
  }, [elementId]);

  // v0.4.4：把"正在编辑的伪类"同步给画布做实时预览。
  // 无类名元素走内联样式，:hover 规则永远被内联压住 → 以前画布上完全看不出效果。
  const setPreviewPseudo = useScene((s) => s.setPreviewPseudo);
  useEffect(() => {
    setPreviewPseudo(activePseudo);
    return () => setPreviewPseudo(null);
  }, [activePseudo, elementId, setPreviewPseudo]);

  // ============ 决定"显示哪些属性" ============
  // 1. + DEFAULT_VISIBLE_PROPS (现已默认为空，精简干净)
  // 2. style 里有非空值的所有 schema 属性（含 box4/trbl 4 边任一有值便视为已添加）
  // 3. visibleProps 列表里显式添加过的 key（即使 style 值被清空为空串也不消失）
  // 4. 「背景颜色」行：渐变（background-image）也算已设置，走同一个入口切换纯色/渐变；
  //    但"文字渐变"（-webkit-text-fill-color: transparent）由快捷助手代管，不在此重复出现
  // 5. 快捷助手代管的属性（布局 / 文字渐变）：当「是否显示到下方 CSS 属性」关闭时隐藏
  //    （用户从 + 添加属性 显式加过的除外，避免误藏用户手动加的属性）
  // 6. 文字渐变元素：其渐变本体就是 background-image —— 下方不再重复出现
  //    「背景颜色 / 背景图片」行（显式加过的除外），避免"改文字渐变却跑来改背景"的困惑
  const visibleSchema: typeof SCHEMA = [];
  const visiblePropList = selected.visibleProps ?? [];
  const allSchema = [...SCHEMA, ...getPluginProperties()];
  /**
   * v0.4.5：判断"这条属性已添加了吗"必须看**当前断点合并后的样式**。
   *
   * 以前只看 `selected.style`（基础层）。可是写入是跟着当前断点走的 ——
   * 画布窄一点（右侧面板加宽后默认只有 ~753px）就会落到 tablet 断点，
   * 值写进 `responsive.tablet`，基础层依然是空的 → **刚设好的属性行当场消失**。
   * 合并之后"面板里看到的行"与"画布上生效的样式"始终一致。
   */
  const styleForPresence: Record<string, string | undefined> = {
    ...(selected.style as unknown as Record<string, string | undefined>),
    ...((activeBreakpoint !== 'desktop'
      ? (selected.responsive?.[activeBreakpoint] as unknown as Record<string, string | undefined>)
      : undefined) ?? {})
  };
  const isTextGradientEl = styleForPresence.WebkitTextFillColor === 'transparent';
  // 「过渡动画 (transition)」由「交互状态 (伪类)」区域的滑块统一管理，
  // 不再在下方「CSS 样式属性」里重复出现一条（用户若从 + 添加属性 显式加过，仍然显示）
  const PSEUDO_MANAGED_KEYS = new Set(['transition']);
  for (const s of allSchema) {
    // v0.4.4：显式添加过的属性即使"当前条件不满足"也要渲染出来（行上标「不生效」），
    // 否则 left/right/top/bottom 在 position:static 时加进来会直接消失（用户反馈）。
    if (!isApplicable(s, selected.type) && !visiblePropList.includes(s.key)) continue;
    const extraBg = s.key === 'backgroundColor' && isGradient(styleForPresence.backgroundImage) && !isTextGradientEl;
    const byValue = hasStyleValue(styleForPresence, s as any) || extraBg;
    const helperHidden =
      !showHelperInCss && HELPER_MANAGED_KEYS.has(s.key) && !visiblePropList.includes(s.key);
    const pseudoHidden =
      PSEUDO_MANAGED_KEYS.has(s.key) && !visiblePropList.includes(s.key);
    const textGradHidden =
      isTextGradientEl &&
      (s.key === 'backgroundColor' || s.key === 'backgroundImage') &&
      !visiblePropList.includes(s.key);
    if (
      DEFAULT_VISIBLE_PROPS.includes(s.key) ||
      visiblePropList.includes(s.key) ||
      (byValue && !helperHidden && !pseudoHidden && !textGradHidden)
    ) {
      visibleSchema.push(s as any);
    }
  }

  // ============ "添加属性"回调 ============
  const onAddProperty = (key: string, value?: string) => {
    const item = getSchemaItem(key);
    if (!item) return;
    const patch: Record<string, string> = {};
    if (value !== undefined) {
      // 来自"搜索属性值 → 一键插入"：属性名 + 属性值一起写入
      patch[item.key] = value;
    } else if ((item.input === 'box4' || item.input === 'trbl') && item.sides) {
      for (const s of item.sides) patch[s.key] = '';
    } else if (item.input === 'number' && item.unit) {
      patch[item.key] = '0' + item.unit;
    } else {
      patch[item.key] = '';
    }
    updateStyle(elementId, patch);
    addVisibleProp(elementId, key);
    onJustAdded(key);
  };

  // ============ 中键搜索：定位到某条 CSS 属性（橙色高亮）============
  // 画布上对元素按中键 → 敲属性名 → Enter → 这里展开「CSS 样式属性」、确保该行存在、滚动并闪烁高亮。
  const [flashKey, setFlashKey] = useState<string | null>(null);
  /**
   * 定位「幽灵卡片」（v0.4.5 第十六批 · 用户澄清后的真实需求）
   * ------------------------------------------------------------------
   * 用户原话：「中间选中元素输入 position，Enter 就可以直接定位到这个元素右侧的
   *            position 的幽灵卡片，只是用来临时数据修改，避免去快捷助手里面改。」
   *
   * 所以：中键搜到 position（或 left/top/right/bottom）时，除了展开 CSS 属性区，
   * 还额外弹出这张**临时**卡片 —— 因为 position 的可编辑项分散在快捷助手里，
   * 用户搜 position 却"点不进去"（反馈原话："对于定位 position 元素没有用"）。
   */
  /**
   * 幽灵属性卡片（v0.4.6）
   * ------------------------------------------------------------------
   * 用户原话：「快捷助手关闭了显示到下方 CSS 属性的时候，中键搜索属性的时候，
   *           临时做一个幽灵卡片，颜色做的不一样……中键每次搜索都弹出，
   *           退出当前元素的面板幽灵卡片就没了。」
   *
   * 所以：
   *   · 只有「显示到下方 CSS 属性」**关闭**时才需要它（开着的话下方列表里就有那一行）；
   *   · 每次中键搜索都把搜中的属性放进来（最近的排最前，最多 3 条，避免卡片变成长列表）；
   *   · **没有关闭按钮**：它是"当前这个元素"的临时物件，换元素/关面板自然消失。
   */
  const [ghostKeys, setGhostKeys] = useState<string[]>([]);
  // 换元素 → 上一张幽灵卡片作废（用户要求"退出当前元素的面板幽灵卡片就没了"）
  useEffect(() => { setGhostKeys([]); }, [elementId]);
  // 用 ref 读开关：apply 回调挂在事件订阅里，不能因为它变化就重订阅
  const showHelperInCssRef = useRef(showHelperInCss);
  showHelperInCssRef.current = showHelperInCss;
  useEffect(() => {
    const apply = (req: PropFocusRequest) => {
      const key = req.key;
      if (!key) return;
      // 「显示到下方 CSS 属性」关着 → 下方列表里不会有这一行，改由幽灵卡片承载
      if (!showHelperInCssRef.current) {
        setGhostKeys((prev) => [key, ...prev.filter((k) => k !== key)].slice(0, 3));
      }
      // add 默认 true（老行为）；中键搜索在"未添加"时按 Enter 会传 false —— 只提示、不偷偷加
      const shouldAdd = req.add !== false;
      setSecOpen((p) => ({ ...p, css: true }));
      if (shouldAdd) addVisibleProp(elementId, key);
      // v0.4.5：中键搜索的「属性值预测」—— 顺手把值也写进去（裸数字按 schema.unit 补单位）
      if (req.value !== undefined) {
        const item = getSchemaItem(key);
        const v = item ? presetValue(item, req.value) : req.value;
        updateStyle(elementId, { [key]: v } as never);
      }
      setFlashKey(key);
      // 滚动到该行：**不用 scrollIntoView('center')** —— 行在列表末尾时容器已经滚不动，
      // 只能贴底，容易被面板底部挡住（用户反馈"末尾元素定位不到"）。
      // 这里按"可视区 + 28px 内边距"校正，并且行还没渲染出来时自动重试。
      const scrollToRow = (attempt = 0) => {
        const row = document.querySelector(`[data-prop-key="${CSS.escape(key)}"]`) as HTMLElement | null;
        if (!row) {
          if (attempt < 6) window.setTimeout(() => scrollToRow(attempt + 1), 90);
          return;
        }
        // 右侧是嵌套滚动：`.tab-body` 与 `.panel` 都可能滚，真正能滚的是"内容超出"的那一层
        const findScroller = (start: HTMLElement | null): HTMLElement | null => {
          let cur = start?.parentElement ?? null;
          while (cur) {
            const oy = getComputedStyle(cur).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight + 1) return cur;
            cur = cur.parentElement;
          }
          return null;
        };
        const scroller = findScroller(row);
        if (!scroller) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
        const sr = scroller.getBoundingClientRect();
        const rr = row.getBoundingClientRect();
        const pad = 28;
        if (rr.top < sr.top + pad) {
          scroller.scrollBy({ top: rr.top - sr.top - pad, behavior: 'smooth' });
        } else if (rr.bottom > sr.bottom - pad) {
          scroller.scrollBy({ top: rr.bottom - sr.bottom + pad, behavior: 'smooth' });
        }
        // 折叠区展开有 0.3s 动画，首帧量到的位置会偏 —— 稍后再校验一次，不在可视区就继续校正
        if (attempt < 4) {
          window.setTimeout(() => {
            const r2 = document.querySelector(`[data-prop-key="${CSS.escape(key)}"]`) as HTMLElement | null;
            if (!r2) return;
            const s2 = scroller.getBoundingClientRect();
            const b2 = r2.getBoundingClientRect();
            if (b2.top < s2.top + 4 || b2.bottom > s2.bottom - 4) scrollToRow(attempt + 1);
          }, 280);
        }
      };
      window.setTimeout(() => scrollToRow(), 90);
      window.setTimeout(() => setFlashKey(null), 2200);
    };
    // 挂载瞬间先消费缓冲：从「页面 / 类名 / 图层」切过来的请求，事件早就派发完了
    const first = takePendingPropFocus();
    if (first) apply(first);
    return subscribePropFocus((req) => { takePendingPropFocus(); apply(req); });
  }, [elementId, addVisibleProp]);

  // ============ "删除属性"回调 ============
  const onRemoveProperty = (key: string) => {
    removeVisibleProp(elementId, key);
  };

  // ============ Applicable attrs for this element ============
  const applicableAttrs = ATTRS_SCHEMA.filter((a) => {
    if (!a.onlyTypes) return true;
    return a.onlyTypes.includes(elementType);
  });

  const hasRel = Boolean((selected.attrs?.relSelector ?? '').trim());
  const relText = (selected.attrs?.relSelector ?? '').trim();
  const hasCls = Boolean((selected.attrs?.className ?? '').trim());
  const clsText = (selected.attrs?.className ?? '').trim();
  const hasId = Boolean((selected.attrs?.id ?? '').trim());
  const idText = (selected.attrs?.id ?? '').trim();
  const isNamed = hasRel || hasCls || hasId;
  const stylePropCount = Object.keys(selected.style || {}).filter((k) => selected.style[k] !== undefined && selected.style[k] !== '').length;
  // 仅在无任何类名、无关系选择器、无ID且有自定义样式时，才标注为未命名的行内样式
  const hasInlineStyle = !isNamed && stylePropCount > 0;

  return (
    <>
      {/* 顶部元素信息栏（自适应展示 标签 + 关系选择器 / 类名 / ID / 独立样式） */}
      <div className="panel-title-header">
        <div className="panel-title-left">
          <span className="panel-title-prefix">属性 ·</span>
          <span className="panel-title-tag">&lt;{elementType}&gt;</span>
        </div>
        <div className="panel-title-badges">
          {hasRel && <span className="panel-title-badge is-rel" title={`关系选择器: ${relText}`}><Icon name="bolt" size={11} /> {relText}</span>}
          {hasCls && <span className="panel-title-badge is-cls" title={`类名: .${clsText.split(/\s+/).join(' .')}`}>.{clsText.split(/\s+/).join(' .')}</span>}
          {hasId && <span className="panel-title-badge is-id" title={`ID: #${idText}`}>#{idText}</span>}
          {hasInlineStyle && (
            <span className="panel-title-badge is-inline" title={`未设置类名或选择器，当前包含 ${stylePropCount} 项独立样式`}>
              独立样式
            </span>
          )}
        </div>
      </div>

      {/* 未命名的提醒：没有类名 / ID / 关系选择器时，伪类样式导出后必然失效。
          v0.4.5：从一整块黄色大卡片压成**一行**（图标 + 一句话 + 起名按钮）。
          它每个新元素都会出现，占掉 180px 面板高度实在太吵；
          详细原因放进 title，需要时悬停即可看到。 */}
      {hasInlineStyle && (
        <div
          className="cls-warn-flash"
          role="alert"
          title={
            `这 ${stylePropCount} 项样式会以行内样式导出。\n` +
            '行内样式无法承载 :hover / :active / :focus 这类伪类，\n' +
            '所以给元素起一个类名（或设 ID / 关系选择器）后，伪类样式才能在导出的网页里生效。'
          }
        >
          <span className="cls-warn-ico"><Icon name="warning" size={13} /></span>
          <div className="cls-warn-body">
            <div className="cls-warn-title">样式还没有名字</div>
            <div className="cls-warn-desc">伪类样式导出后会失效</div>
          </div>
          <button
            className="cls-warn-btn"
            onClick={() => setSecOpen((p) => ({ ...p, identity: true }))}
            title="给当前元素起一个类名"
          >起名</button>
          <button
            className="cls-warn-btn is-ghost"
            onClick={() => window.dispatchEvent(new CustomEvent('bc:open-class'))}
            title="到「类名 · ID 总览」里批量给未命名元素起名"
          >总览</button>
        </div>
      )}

      {/* 响应式断点条：三个设备分段（高亮按画布**实际宽度**判断）+ 右侧一枚小的「自适应」按钮（不常亮） */}
      <div className="inspector-bp-bar">
        <div className="inspector-bp-tabs">
          <button
            className={'bp-tab-btn' + (liveDevice === 'desktop' ? ' active' : '')}
            onClick={() => requestDevice('desktop')}
            title="电脑端基础样式（全局基准，平板/手机自动继承）。点此画布宽度切为 1920px"
          >
            <Icon name="laptop" size={14} /><span>电脑</span>
          </button>
          <button
            className={'bp-tab-btn' + (liveDevice === 'tablet' ? ' active' : '') + (hasTabletOverride ? ' has-override' : '')}
            onClick={() => requestDevice('tablet')}
            title="平板端 ≤768px 样式定制。点此画布宽度同步变为 768px，所见即所得"
          >
            <Icon name="tablet" size={14} /><span>平板</span>
            {hasTabletOverride && <span className="bp-dot" title="已有平板端定制覆盖" />}
          </button>
          <button
            className={'bp-tab-btn' + (liveDevice === 'mobile' ? ' active' : '') + (hasMobileOverride ? ' has-override' : '')}
            onClick={() => requestDevice('mobile')}
            title="手机端 ≤480px 样式定制。点此画布宽度同步变为 375px，所见即所得"
          >
            <Icon name="phone" size={14} /><span>手机</span>
            {hasMobileOverride && <span className="bp-dot" title="已有手机端定制覆盖" />}
          </button>
        </div>
        <button
          className={'bp-auto-btn' + (canvasAuto ? ' is-auto' : '')}
          onClick={() => window.dispatchEvent(new CustomEvent('bc:set-device', { detail: 'auto' }))}
          title="自适应宽度：画布铺满编辑区。设备按画布实际宽度自动判断，这个按钮不会常亮"
        >
          <Icon name="responsive" size={14} />
        </button>
      </div>

      {/* 移动端快捷操作与覆盖说明条 */}
      {activeBreakpoint !== 'desktop' && (
        <div className="inspector-bp-banner">
          <div className="inspector-bp-banner-head">
            <span>
              正在定制 <b>{activeBreakpoint === 'mobile' ? '手机端 (≤480px)' : '平板端 (≤768px)'}</b> 样式覆盖
            </span>
            {hasCurBpOverride && (
              <button
                className="btn-mini btn-ghost bp-clear-btn"
                onClick={() => clearBreakpointOverride(elementId, undefined, activeBreakpoint)}
                 title="清空当前设备上的所有定制覆盖，完全恢复电脑端继承"
              >
                <Icon name="undo" size={12} /> 还原继承
              </button>
            )}
          </div>
          <div className="inspector-bp-actions">
            <button
              className={'btn-mini bp-quick-btn' + (isCurrentHidden ? ' active' : '')}
              onClick={toggleHideOnDevice}
              title={isCurrentHidden ? '取消隐藏，在当前设备重新显示' : '在当前设备上隐藏此元素 (display: none)'}
            >
              {isCurrentHidden ? <><Icon name="eye" size={13} /> 取消隐藏</> : <><Icon name="block" size={13} /> 在此设备隐藏</>}
            </button>
            {CONTAINER_TAGS.has(elementType) && (
              <button
                className="btn-mini bp-quick-btn"
                onClick={toggleColumnLayout}
                title="将容器在当前设备转为上下单列竖排 (适合手机单手阅读)"
              >
                <Icon name="refresh" size={13} /> 切竖排
              </button>
            )}
            <button
              className="btn-mini bp-quick-btn"
              onClick={toggleFullWidth}
              title="将宽度设为 100% 撑满屏幕 (手机端卡片与按钮常用)"
            >
              <Icon name="responsive" size={13} /> 撑满全宽
            </button>
            <button
              className="btn-mini bp-quick-btn bp-autofit-btn"
              onClick={autoFitPage}
              title={`一键把整页按「${activeBreakpoint === 'mobile' ? '手机' : '平板'}」规则重排：过宽元素改自适应、横排容器改竖排、多列网格改单列、内边距与字号适度收紧。只影响当前断点，可整体撤销。`}
            >
              <Icon name="sparkle" size={13} /> 整页自动适配
            </button>
          </div>
        </div>
      )}

      {/* 0. 文案内容（针对文本元素）——置顶最上方第一位，直接输入 */}
      {TEXT_TAGS.has(elementType) && (
        <div className="field" style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
            文案内容
          </label>
          <textarea
            className="inspector-text-textarea"
            value={selected.text ?? ''}
            placeholder="在此直接输入文本内容（画布也将同步更新）…换行会导出成 <br>"
            rows={5}
            onChange={(e) => setText(elementId, e.target.value)}
          />
          <button
            className={'bc-br-inspector-toggle' + (showBr ? ' active' : '')}
            onClick={() => setShowBr(!showBr)}
            title="开启后，画布的就地编辑框里会用淡灰色标出换行位置（<br>）；换行本来就会自动生成 <br>"
          >
            {showBr ? <><Icon name="check" size={12} /> 已显示 {'<br>'} 换行标记</> : '显示 <br> 换行标记'}
          </button>
        </div>
      )}

      {/* 0.5 表格元素：直达专用表格编辑器（v0.4.3）
              —— 表格的结构（加行/列、合并拆分、表头表尾）在通用属性面板里做不了，
              所以给一张表一个显眼的入口，直接进「表格编辑器」页面。 */}
      {tableOwner && (
        <div className="tbl-entry">
          <div className="tbl-entry-text">
            <b><Icon name="grid" size={14} /> 这是表格元素</b>
            <span>加行/列、合并拆分单元格、表头表尾与整套样式，都在表格编辑器里一气呵成。</span>
          </div>
          <button
            className="btn-primary btn-mini"
            onClick={() => window.dispatchEvent(new CustomEvent('bc:open-table-editor', { detail: tableOwner.id }))}
          >打开表格编辑器</button>
        </div>
      )}

      <IdentitySection
        open={secOpen.identity}
        onToggle={() => setSecOpen((p) => ({ ...p, identity: !p.identity }))}
        elementId={elementId}
        element={selected}
        elementType={elementType}
        applicableAttrs={applicableAttrs}
      />

      {/* 1.5 媒体属性卡（v0.4.5）：video / audio 专用，只有这几个属性，不该让人手填 src */}
      {(elementType === 'video' || elementType === 'audio') && (
        <MediaPropsCard elementId={elementId} elementType={elementType} />
      )}

      {/* 2. 快捷助手折叠区（Flex & Grid + 文字渐变 + 未来更多） */}
      <div className="inspector-sec">
        <div
          className="inspector-sec-head"
          onClick={() => setSecOpen((p) => ({ ...p, layout: !p.layout }))}
          title="点击展开或收起快捷助手"
        >
          <span>
            <span className="sec-caret"><Icon name={secOpen.layout ? 'chevronDown' : 'chevronRight'} size={12} /></span>
            快捷助手
          </span>
          <span className="prop-scope">排版 / 渐变</span>
        </div>
        <Collapse open={secOpen.layout}>
          <div className="inspector-sec-body">
            <QuickHelper
              elementId={elementId}
              elementType={elementType}
              showInCss={showHelperInCss}
              onShowInCssChange={changeShowHelperInCss}
            />
          </div>
        </Collapse>
      </div>

      <PseudoSection
        open={secOpen.pseudo}
        onToggle={() => setSecOpen((p) => ({ ...p, pseudo: !p.pseudo }))}
        activePseudo={activePseudo}
        setActivePseudo={setActivePseudo}
        pseudoStyles={pseudoStyles}
        hasSelector={hasSelector}
        selected={selected}
        elementId={elementId}
        elementType={elementType}
        onOpenIdentity={() => setSecOpen((p) => ({ ...p, identity: true }))}
      />

      <CssPropsSection
        open={secOpen.css}
        onToggle={() => setSecOpen((p) => ({ ...p, css: !p.css }))}
        elementId={elementId}
        elementType={elementType}
        visibleSchema={visibleSchema}
        elementStyle={selected.style as Record<string, string | undefined>}
        justAddedKey={justAddedKey}
        flashKey={flashKey}
        onAdd={onAddProperty}
        onRemove={onRemoveProperty}
        onEdited={() => onJustAdded(null)}
        ghostSlot={ghostKeys.length > 0
          ? <GhostPropCard elementId={elementId} elementType={elementType} keys={ghostKeys} />
          : undefined}
      />
    </>
  );
}
