// BlockCanvas · 画布上的单个节点渲染（编辑器所见 = 导出所得的落地点）
// 渲染顺序不能调：hidden → 自闭合 → 文本独占 → audio（自绘外壳）→ 容器/文本。
// ⚠ audio 必须排在"容器型 return"之前，且**不在** SELF_CLOSING_TAGS 里（否则整段是死代码）。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScene, getEffectiveStyle } from '@store/sceneStore';
import { SELF_CLOSING_TAGS, TEXT_ONLY_TAGS, CONTAINER_TAGS, TEXT_TAGS, MEDIA_TAGS } from '@lib/types';
import type { SceneElement } from '@lib/types';
import { selectorForNode, cssTextToObject, simplifyStyle } from '@lib/styleClass';
import { useShowBr } from '@lib/showBr';
import { useVideoCodecGate, CodecBlockedNotice } from './videoCodecGate';
import { Icon } from '../Icon';
import { toRenderableSrc } from './mediaSrc';
import { buildMediaPlayProps } from './mediaPlayProps';
import { useFixedLayer } from './fixedLayer';
import { useTextTapMenu } from './useTextTapMenu';
import type { TextMenuPayload } from '../CanvasTextMenu';

export type CanvasNodeProps = {
  node: SceneElement;
  depth: number;
  selectedIds: string[];
  onSelect: (id: string | null) => void;
  onSelectParent: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onTextMenu: (p: TextMenuPayload) => void;
};

const CanvasNodeBody = React.memo(function CanvasNodeBody(props: CanvasNodeProps) {
  const { node, selectedIds, onSelect, onSelectParent, onToggleSelect, onTextMenu } = props;

  // v0.4.4：伪类实时预览（必须在任何提前 return 之前声明 hook）
  const previewPseudo = useScene((s) => s.previewPseudo);

  // ⚠ hidden 的早退在外层 CanvasNode（见文件末尾）：留在这里会让 hook 数量随隐藏变化 → React #300 白屏。
  const isSelected = selectedIds.includes(node.id);
  const Tag = node.type as keyof React.JSX.IntrinsicElements;
  // 4-C/4-F：选择器 = 类名优先 → ID → 行内样式（与导出同一计算 → DOM 与规则文本一致）
  const selInfo = useMemo(() => selectorForNode(node), [node.style, node.attrs]);

  // 画布双击就地编辑文案（v0.4.4d 重做：多行 textarea + 自动撑高 + 点别处即保存）
  const [editingText, setEditingText] = useState(false);
  const [inlineDraft, setInlineDraft] = useState(node.text ?? '');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editingRef = useRef(false);
  /** 轻点选区弹菜单 / 全选 / 取消选中（80 行逻辑在 canvas/useTextTapMenu.ts） */
  const textMenu = useTextTapMenu({
    id: node.id,
    editing: editingText,
    inputRef,
    onOpen: (pl) => onTextMenu(pl as never)
  });

  editingRef.current = editingText;
  // 「显示 <br>」：与属性面板共用同一份开关（见 lib/showBr.ts）
  const [showBr] = useShowBr();

  /**
   * 选中态测量：display:inline 的元素跨行时 outline 会按行盒**拆成多个框**
   * （一个 span 折成两行 → 两个橙框），所以行内元素改由 Canvas 的
   * `.canvas-inline-sel` 画一个合并外框。
   *
   * ⚠ v0.4.7 修的 BUG（用户：「选中的图片没有橙色框、也不闪」）：
   *   旧判据只看 `display === 'inline'`。而 **`<img>` 的默认 display 就是 inline**，
   *   于是每张图片一被选中就被当成"行内碎片"：data-bc-sel / data-bc-seln 全都不写，
   *   橙框和闪烁一起消失，用户完全看不出图被选中了。
   *   真正的判据是"**被拆成了多个行盒**" —— 用 getClientRects().length > 1 判断，
   *   再排除替换元素（img/video/input 这类永远是单个盒子，不存在拆行问题）。
   */
  const REPLACED_TAGS = new Set(['img', 'video', 'audio', 'input', 'textarea', 'hr', 'select', 'iframe', 'canvas']);
  const [isInlineFrag, setIsInlineFrag] = useState(false);
  useEffect(() => {
    if (!isSelected) { setIsInlineFrag(false); return; }
    let alive = true;
    const check = () => {
      if (!alive) return;
      try {
        const el = document.querySelector(`.canvas [data-bc-id="${CSS.escape(node.id)}"]`);
        if (!el) return;
        const cs = getComputedStyle(el);
        const fragmented = cs.display === 'inline' && el.getClientRects().length > 1;
        setIsInlineFrag(fragmented && !REPLACED_TAGS.has(node.type));
      } catch { /* ignore */ }
    };
    check();
    const raf = requestAnimationFrame(check); // 自动类规则落地后复查
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [isSelected, node.id, node.style, node.attrs, node.type]);

  useEffect(() => {
    if (!editingText) setInlineDraft(node.text ?? '');
  }, [node.text, editingText]);

  /**
   * v0.4.5（用户反馈）：**点下播放锁的瞬间，正在播的媒体要立刻停住**。
   *
   * 只靠 `onPlay` 拦截是不够的 —— 那只能在"将要播放"时按回去；
   * 如果锁上之前它已经在播，React 改 `controls`/`muted` 属性并不会让它暂停，
   * 于是会出现"点了锁死，视频还在放"（探针抓到的就是这个）。
   * 这里在 playLock 变成 '1' 时直接对 DOM 调 pause()，一次到位。
   */
  useEffect(() => {
    if (node.attrs?.playLock !== '1') return;
    if (!MEDIA_TAGS.has(node.type)) return;
    try {
      const host = document.querySelector(`.canvas [data-bc-id="${CSS.escape(node.id)}"]`);
      // 音频外面套了一层编辑器外壳（.bc-audio-slot），真正能 pause 的是里面的 <audio>
      const el = (host?.querySelector?.('audio, video') as HTMLMediaElement | null)
        || (host as HTMLMediaElement | null);
      if (el && typeof el.pause === 'function' && !el.paused) el.pause();
    } catch { /* 忽略 */ }
  }, [node.attrs?.playLock, node.id, node.type]);

  const autoGrow = (ta: HTMLTextAreaElement) => {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 24) + 'px';
  };

  useEffect(() => {
    if (editingText && inputRef.current) {
      const ta = inputRef.current;
      ta.focus();
      ta.select();
      autoGrow(ta);
    }
  }, [editingText]);

  // 「点别的地方就保存」双保险：
  //  ① 画布内的按下 → Canvas 派发 bc:commit-inline（见 onWrapPointerDownCapture）；
  //  ② 画布外（属性面板等）的按下 → 全局 mousedown 兜底。
  // 为什么不能用 onBlur —— 画布的 pointerdown 会 preventDefault()，焦点根本不会转移 → 不触发 blur。
  useEffect(() => {
    if (!editingText) return;
    const onCommitEvt = () => commitInlineText();
    const onDocDown = (ev: MouseEvent) => {
      const ta = inputRef.current;
      if (ta && (ev.target === ta || ta.contains(ev.target as Node))) return;
      commitInlineText();
    };
    window.addEventListener('bc:commit-inline', onCommitEvt);
    document.addEventListener('mousedown', onDocDown, true);
    return () => {
      window.removeEventListener('bc:commit-inline', onCommitEvt);
      document.removeEventListener('mousedown', onDocDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingText]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (node.locked) return;
    if (TEXT_TAGS.has(node.type) || node.text !== undefined) {
      e.stopPropagation();
      setInlineDraft(node.text ?? '');
      setEditingText(true);
    }
  };

  const commitInlineText = () => {
    if (!editingRef.current) return;
    // 直接读 DOM 里的当前值（闭包里的 inlineDraft 可能是旧值）
    const v = inputRef.current ? inputRef.current.value : inlineDraft;
    editingRef.current = false;
    setEditingText(false);
    if (v !== (node.text ?? '')) useScene.getState().setText(node.id, v);
  };

  /** 把纯文本按换行渲染成「文本 + <br>」 */
  const withBreaks = (s: string, keyBase: string): React.ReactNode[] => {
    const parts = s.split('\n');
    const out: React.ReactNode[] = [];
    parts.forEach((p, i) => {
      if (p) out.push(<React.Fragment key={`${keyBase}t${i}`}>{p}</React.Fragment>);
      if (i < parts.length - 1) out.push(<br key={`${keyBase}b${i}`} />);
    });
    return out;
  };

  /** 渲染文字内容：有富文本片段就逐段渲染（带样式的包成内联 span），否则渲染纯文本 */
  const renderTextContent = () => {
    if (node.runs && node.runs.length > 0) {
      return node.runs.map((r, i) => {
        const css = r.style ? simplifyStyle(r.style) : null;
        const inner = withBreaks(r.text, 'r' + i);
        return css ? <span key={i} style={css as React.CSSProperties}>{inner}</span> : <React.Fragment key={i}>{inner}</React.Fragment>;
      });
    }
    return node.text ? withBreaks(node.text, 'p') : null;
  };

  /** 叠加层内容：透明文字（用来定位下划线/删除线）+（开关开启时）淡灰 <br> 标记 */
  const brOverlayNodes = (() => {
    const parts = inlineDraft.split('\n');
    const out: React.ReactNode[] = [];
    parts.forEach((p, i) => {
      if (p) out.push(<span key={`t${i}`}>{p}</span>);
      if (i < parts.length - 1) {
        if (showBr) out.push(<span key={`m${i}`} className="bc-br-mark">{'<br>'}</span>);
        out.push(<br key={`b${i}`} />);
      }
    });
    return out;
  })();
  // 有类名/ID 的元素：样式由自动类承担。无类名无 ID 的元素：行内样式与导出一致。
  // 内联里还混着编辑器交互装饰：选中框、空容器可见性兜底 —— 全部不导出。
  // ⚠ 光标（pointer / Alt 交互的 resize 等）**不再写内联** —— 内联 cursor 会盖过
  //   任何样式表规则，导致 Alt 悬停时无法切换成 resize/move 光标。改由 CSS 按
  //   data-bc-locked / data-bc-alt 属性统一控制（见 23-v044d-ui.css）。
  const baseStyle: React.CSSProperties = {};
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);
  // 无类名无 ID：样式照抄导出的 style 属性值（同一文本 → 画布 = 导出）
  if (selInfo.inlineCss) {
    Object.assign(baseStyle, cssTextToObject(selInfo.inlineCss));
    if (activeBreakpoint !== 'desktop') {
      const eff = getEffectiveStyle(node, activeBreakpoint);
      Object.assign(baseStyle, simplifyStyle(eff));
    }
  }
  // v0.4.4：正在编辑某个伪类时，把它的样式**内联叠加**到选中元素上 ——
  // 无类名元素本来是内联样式，`:hover` 规则永远被压住，用户看不到任何变化。
  // 这里只是编辑器预览，不写进 node.style、不导出（导出仍由 :hover 规则承担）。
  if (previewPseudo && isSelected && node.pseudoStyles?.[previewPseudo]) {
    Object.assign(baseStyle, simplifyStyle(node.pseudoStyles[previewPseudo] as Record<string, string | undefined>));
  }
  // flex 横排容器里，空的无宽子容器会被压缩到 0 宽 → 完全不可见不可点（"插进去看不到"）。
  // 编辑器专用兜底：无显式 width 的容器/hr 补 min-width 60px（不进 node.style、不导出）；
  // 用户设了 width（含百分比）则尊重用户值
  if ((CONTAINER_TAGS.has(node.type) || node.type === 'hr') && !node.style.width) {
    baseStyle.minWidth = '60px';
  }
  if (isSelected && !isInlineFrag) {
    // 选中高亮（v0.4.4）：外框改由 CSS 按 data-bc-sel 画（两种可切换样式，见 25-v044-storage-ui.css）；
    // 这里只保留"内圈白细线"——**追加**在用户自己的 box-shadow 之前，绝不覆盖用户的阴影。
    // （旧实现直接 baseStyle.boxShadow = 'inset ...' —— 内联样式优先级高于类名规则，
    //   结果元素一被选中，它自己的盒子阴影就"消失"了。）
    const ownShadow = (
      (baseStyle.boxShadow as string | undefined)
      ?? ((getEffectiveStyle(node, activeBreakpoint) as Record<string, string | undefined>).boxShadow)
      ?? ''
    ).trim();
    baseStyle.boxShadow = ownShadow
      ? `inset 0 0 0 1.5px #ffffff, ${ownShadow}`
      : 'inset 0 0 0 1.5px #ffffff';
  }

  /** 就地编辑时的"文字观感"：把元素生效的排版样式套到编辑框（含叠加层）上，
   *  让编辑框里的预览与画布一致 —— 字号 / 粗细 / 斜体 / 颜色直接生效；
   *  下划线 / 删除线由叠加层用"透明文字 + 显式 decoration-color"画出（textarea 自身不支持）。 */
  const effForEdit = getEffectiveStyle(node, activeBreakpoint) as Record<string, string | undefined>;
  const pick = (k: string): string => String((node.style as Record<string, string | undefined>)[k] ?? effForEdit[k] ?? '');
  const editTextStyle: React.CSSProperties = {
    fontSize: pick('fontSize') || undefined,
    fontWeight: pick('fontWeight') || undefined,
    fontStyle: pick('fontStyle') || undefined,
    color: pick('color') || undefined,
    lineHeight: pick('lineHeight') || undefined,
    fontFamily: pick('fontFamily') || undefined,
    letterSpacing: pick('letterSpacing') || undefined,
    textAlign: (pick('textAlign') || undefined) as React.CSSProperties['textAlign']
  };
  const editDeco = pick('textDecoration');

  /**
   * v0.4.6（R6-18）：挂载之前先问一句"这个编码能解吗"（判定与占位块都在
   * canvas/videoCodecGate.tsx）。
   */
  const codecGate = useVideoCodecGate(node.type, node.attrs?.srcAbs, node.attrs?.src);
  const codecBlocked = codecGate.blocked;

  // 媒体元素（video / audio）的播放属性：细节全在 mediaPlayProps.tsx（带三条踩坑结论）
  const mediaProps = buildMediaPlayProps({ node, isSelected, codecBlocked, onSelect });

  const commonProps = {
    'data-bc-id': node.id,
    'data-bc-locked': node.locked ? '1' : '0',
    // v0.4.6：fixed 元素钉在「画布内浏览器视口」上（见 lib/fixedViewport.ts）
    'data-bc-fixed': (getEffectiveStyle(node, activeBreakpoint) as Record<string, string | undefined>).position === 'fixed'
      ? '1' : undefined,
    // 选中高亮（v0.4.4）：用 data 属性 + CSS 画，不再写内联 outline ——
    // 两种可切换样式（橙色光晕闪烁 / 蓝色细线）都在样式表里，body.bc-sel-plain 一键切换
    'data-bc-sel': isSelected && !isInlineFrag ? '1' : undefined,
    /**
     * 选中数量档位（v0.4.7）：用户要求
     *   「1~5 个元素，所有选中的元素橙色边框+闪烁，这样显眼；
     *    大于5个，只显示橙色边框，防止卡顿。」
     * 数量不多时给呼吸光晕（合成层动画，代价小、显眼）；一多就只留 2px 橙框。
     * 写成属性而不是多个类名：和 body.bc-sel-plain（用户自选的蓝色细线档）不会互相干扰。
     */
    'data-bc-seln': isSelected && !isInlineFrag ? (selectedIds.length <= 5 ? '1' : '0') : undefined,
    // 类名优先原则：用户类名（或兜底 hash 类）真实挂到 DOM；用 ID 做选择器时挂 id 属性 —— 与导出一致
    className: selInfo.classAttr || undefined,
    id: selInfo.idAttr || undefined,
    // 同类同色（编辑器可视化）：优先类名，其次关系选择器作为分组标记，配合 bc-class-colors 注入描边色
    'data-bc-cg': (node.attrs?.className ?? '').trim().split(/\s+/)[0] || (node.attrs?.relSelector ?? '').trim() || undefined,
    // 表格单元格跨度 / 表头 scope —— 与导出保持一致的所见即所得
    ...(node.type === 'th' || node.type === 'td'
      ? {
          colSpan: Math.max(1, Number(node.attrs?.colspan) || 1),
          rowSpan: Math.max(1, Number(node.attrs?.rowspan) || 1)
        }
      : {}),
    ...(node.type === 'th' && node.attrs?.scope ? { scope: node.attrs.scope } : {}),
    ...mediaProps
  } as const;

  // 统一点击逻辑：Ctrl=多选切换；Alt=选中父级；否则选中自己；locked 不可选
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.locked) return;
    if (e.altKey) onSelectParent(node.id);
    else if (e.ctrlKey || e.metaKey) onToggleSelect(node.id);
    else onSelect(node.id);
  };

  // 自闭合：无 children、无 text
  if (SELF_CLOSING_TAGS.has(node.type)) {
    const selfProps: Record<string, string> = {};
    /** 图片加载完成后：把外框比例校成真实比例（只在差得明显时动，避免无意义的样式写入） */
    let onImgLoad: ((e: React.SyntheticEvent<HTMLImageElement>) => void) | undefined;
    if (node.type === 'img') {
      selfProps.alt = (node.attrs?.alt ?? '') || node.text || '';
      const rawSrc = node.attrs?.src;
      if (rawSrc) selfProps.src = toRenderableSrc(rawSrc, node.attrs?.srcAbs);
      // v0.4.5 性能：4K 图按原分辨率解码，每张约 33MB RGBA —— 50 张就是 1.6GB。
      // lazy 让浏览器只解码视口附近的；async 让解码不阻塞主线程（滚动更顺）。
      selfProps.loading = 'lazy';
      selfProps.decoding = 'async';

      // v0.4.5（用户反馈）：**有 src 的图片不允许改比例**，那外框就必须一开始就是真实比例。
      // 以前插入素材后固定成 200×120（默认占位尺寸），图片被拉变形，
      // 而缩放又锁比例 → 用户看到"比例完全不对、还被锁死了"。
      // 这里在图片解码完成后按真实宽高比校正高度（只在偏差 > 2% 时写一次）。
      if (rawSrc) {
        onImgLoad = (e) => {
          const img = e.currentTarget;
          const natW = img.naturalWidth;
          const natH = img.naturalHeight;
          if (!natW || !natH) return;
          const boxW = img.clientWidth;
          const boxH = img.clientHeight;
          if (!boxW || !boxH) return;
          const boxRatio = boxW / boxH;
          const natRatio = natW / natH;
          // 占位高度（factory 给的 minHeight）只在"还没选图"时有意义；
          // 图一旦解码出来，盒子就该完全由真实比例决定 —— 否则 minHeight 会把
          // 算好的高度顶回去（200px 宽、16:9 应为 112px，被 120px 兜住 → 变形 6%）。
          const hasFloor = Boolean(
            (node.style as Record<string, string | undefined>).minHeight
          );
          if (Math.abs(boxRatio - natRatio) / natRatio >= 0.02 || hasFloor) {
            // 画布可能被缩放（transform: scale(zoom)）：clientWidth 是缩放后的视觉像素，
            // 写进 CSS 的必须是**未缩放**的 CSS 像素，所以这里用 DOM 上的实际缩放比换算。
            const canvasEl = img.closest('.canvas') as HTMLElement | null;
            const scale = canvasEl && canvasEl.offsetWidth
              ? canvasEl.getBoundingClientRect().width / canvasEl.offsetWidth
              : 1;
            useScene.getState().updateStyle(node.id, (hasFloor
              ? { height: Math.round((boxW / (scale || 1)) / natRatio) + 'px', minHeight: undefined }
              : { height: Math.round((boxW / (scale || 1)) / natRatio) + 'px' }) as Partial<typeof node.style>);
          }
        };
      }
    } else if (node.type === 'input') {
      selfProps.type = node.attrs?.typeAttr || 'text';
      if (node.attrs?.placeholder) selfProps.placeholder = node.attrs.placeholder;
    }
    return (
      <Tag
        {...selfProps}
        {...(onImgLoad ? { onLoad: onImgLoad as unknown as React.ReactEventHandler<Element> } : {})}
        style={baseStyle}
        onClick={handleClick}
        {...commonProps}
      />
    );
  }

  // 文本独占（textarea）：有开闭标签但不允许 ReactNode 子元素
  if (TEXT_ONLY_TAGS.has(node.type)) {
    const taProps: Record<string, string> = {};
    if (node.attrs?.placeholder) taProps.placeholder = node.attrs.placeholder;
    return (
      <Tag
        style={baseStyle}
        {...taProps}
        value={node.text ?? ''}
        readOnly
        onChange={() => {/* 画布上不可编辑 */}}
        onClick={handleClick}
        {...commonProps}
      />
    );
  }

  /**
   * v0.4.5 第 15 批（用户反复反馈："音频根本点击无法选中"）：**音频单独走一条渲染路径**。
   *
   * 为什么不能直接渲染 `<audio controls>`：
   *   · `<audio>` 的控制条是 UA 的 shadow DOM，指针事件被控件内部吃掉 ——
   *     实测点击音频中心后 `scene.selectedId` 仍然是 null（click 根本没派发到宿主元素）；
   *   · 而不挂 controls 时，Chromium 的 UA 样式表里有
   *     `audio:not([controls]) { display: none !important }`，
   *     而 **UA 的 !important 高于作者样式**，所以"不挂控件"的音频永远是 display:none，
   *     连占位块都画不出来（实测 0×0）。
   *
   * 结论：编辑器里给音频套一层**自己的外壳**（`<span>`），
   *   · 未选中：外壳显示成一条"♪ 音频"占位条（看得见、点得中，点击就是普通元素点击）；
   *   · 已选中：外壳里才露出真正的 `<audio controls>`，可以试听。
   * 导出的 HTML 仍然只有 `<audio>`（exporter 按 node 生成，不认识这个外壳）。
   *
   * ⚠ 位置很关键：`audio` **不在** `SELF_CLOSING_TAGS`（那里只有 img/input/hr/br），
   * 所以这个分支必须放在"容器型 return"之前，否则永远不会执行（第一版就踩了这个坑）。
   */
  if (node.type === 'audio') {
    const showReal = isSelected && node.attrs?.controls !== '0';
    const userCls = (commonProps as { className?: string }).className;
    return (
      <span
        {...commonProps}
        className={'bc-audio-slot' + (showReal ? ' is-real' : '') + (userCls ? ' ' + userCls : '')}
        style={baseStyle}
        onClick={handleClick}
      >
        {showReal ? (
          <audio
            {...(mediaProps as Record<string, unknown>)}
            style={{ display: 'block', width: '100%' }}
          />
        ) : (
          <span className="bc-audio-ph" aria-hidden="true">♪ 音频</span>
        )}
      </span>
    );
  }

  /**
   * v0.4.6（R6-18）：编码解不了的视频**不挂 <video>**（挂上等于让 Chromium 尝试初始化，
   * 报 Unsupported pixel format 白屏，日志屏蔽不了），改画占位块。
   * ⚠ 必须在"容器型 return"之前（video 属 MEDIA_TAGS，不走 SELF_CLOSING 分支）。
   */
  if (codecBlocked) {
    const userCls = (commonProps as { className?: string }).className;
    return (
      <CodecBlockedNotice
        verdict={codecGate.verdict}
        commonProps={commonProps}
        className={userCls}
        style={baseStyle}
        onClick={handleClick}
      />
    );
  }

  // 容器/文本型：与导出器一致——文字和子元素可以同时存在，先文字后子元素
  return (
    <Tag
      style={baseStyle}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      {...commonProps}
    >
      {/* 文本直接作为文本节点；双击进入就地编辑（多行 textarea，点别处 / Esc 都保存） */}
      {editingText ? (
        <span
          className="bc-inline-edit-wrap"
          style={editTextStyle}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <textarea
            ref={inputRef}
            className="canvas-inline-text-input"
            value={inlineDraft}
            rows={1}
            spellCheck={false}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => { setInlineDraft(e.target.value); autoGrow(e.target); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              // Esc 也保存（用户要求）；换行交给浏览器默认（自动生成 <br>）
              if (e.key === 'Escape') { e.preventDefault(); commitInlineText(); }
            }}
            onPointerDown={textMenu.onPointerDown}
            onPointerUp={textMenu.onPointerUp}
            onSelect={textMenu.onSelect}
            onContextMenu={textMenu.onContextMenu}
          />
          {/* 叠加层：文字透明，只负责画「下划线 / 删除线」和（开关开启时的）淡灰 <br> 标记。
              textarea 本身不渲染 text-decoration，所以用这一层补上，位置与输入文字逐字对齐。 */}
          <div
            className="bc-inline-br-overlay"
            aria-hidden="true"
            style={{ textDecoration: editDeco || undefined, textDecorationColor: editTextStyle.color as string | undefined }}
          >{brOverlayNodes}</div>
        </span>
      ) : (
        renderTextContent()
      )}
      {node.children.length > 0 &&
        node.children.map((c) => (
          <CanvasNode key={c.id} node={c} depth={props.depth + 1} selectedIds={selectedIds} onSelect={onSelect} onSelectParent={onSelectParent} onToggleSelect={onToggleSelect} onTextMenu={onTextMenu} />
        ))}
      {node.locked && <span className="lock-badge"><Icon name="lock" size={12} /></span>}
    </Tag>
  );
});

/**
 * 外层壳：把 `position: fixed` 的节点渲染进「视口层」，让 left/top/right/bottom
 * 相对**视口**解析而不是整张画布（`bottom:0` = 贴视口底）。详见 canvas/fixedLayer.ts。
 * 场景树不动、父子关系不动，只换 DOM 挂载位置。
 */
export const CanvasNode = React.memo(function CanvasNode(props: CanvasNodeProps) {
  const bp = useScene((s) => s.activeBreakpoint);
  const layer = useFixedLayer();
  /** hidden：画布不渲染（导出同）。⚠ 必须在外层：外层恒 2 个 hook，内层整棵不挂载，
   *  否则 hook 数量随隐藏/显示变化 → React #300，隐藏最后一个元素就白屏。 */
  if (props.node.hidden) return null;
  const body = <CanvasNodeBody {...props} />;
  const fixed = (getEffectiveStyle(props.node, bp) as Record<string, string | undefined>).position === 'fixed';
  // 视口层还没挂上（首帧）→ 原地渲染，绝不能让元素凭空消失
  return fixed && layer ? createPortal(body, layer) : body;
});
