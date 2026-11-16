import { useRef, useState } from 'react';
import { useScene, findNode, getEffectiveStyle } from '@store/sceneStore';
import { ColorField } from './ColorPicker';
import { useWheelAdjust } from '@lib/wheelAdjust';

// BlockCanvas · 边框可视化编辑器 (BorderInput)
//
// 目标：把"边框"从一堆分散的文本框，变成**看得见、点得到**的一块：
//   · 顶部实时预览：当前边框长什么样，直接画给你看；
//   · 线型：无 / 实线 / 虚线 / 点线 / 双线（按钮上直接画出来）；
//   · 粗细：滑杆 + 数字，长按数字还能拖动调值；
//   · 四条边独立开关：想只留底边框？点掉上/右/左即可；
//   · 颜色：统一调色盘（全屏遮罩那个）。
//
// 兼容：老项目里写的 `border: 1px solid #ccc` 简写会被自动解析进来，
// 用户一旦在可视化面板里改动，就会改写成 4 条 longhand + style + color（导出代码依旧干净）。

interface Props {
  elementId: string;
  pseudo?: string | null;
}

const SIDES: Array<{ label: string; widthKey: string; styleKey: string; short: string }> = [
  { label: '上', widthKey: 'borderTopWidth', styleKey: 'borderTopStyle', short: 'top' },
  { label: '右', widthKey: 'borderRightWidth', styleKey: 'borderRightStyle', short: 'right' },
  { label: '下', widthKey: 'borderBottomWidth', styleKey: 'borderBottomStyle', short: 'bottom' },
  { label: '左', widthKey: 'borderLeftWidth', styleKey: 'borderLeftStyle', short: 'left' }
];

const STYLE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'none', label: '无' },
  { id: 'solid', label: '实线' },
  { id: 'dashed', label: '虚线' },
  { id: 'dotted', label: '点线' },
  { id: 'double', label: '双线' }
];

function parseShorthand(v: string): { width?: string; style?: string; color?: string } {
  const out: { width?: string; style?: string; color?: string } = {};
  for (const p of v.split(/\s+/).filter(Boolean)) {
    if (/^[\d.]+[a-z%]*$/i.test(p) || /^(thin|medium|thick)$/i.test(p)) out.width = p;
    else if (/^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(p)) out.style = p;
    else out.color = p;
  }
  return out;
}

export function BorderInput({ elementId, pseudo }: Props) {
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyle = useScene((s) => s.updateStyle);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updatePseudoStyle = useScene((s) => s.updatePseudoStyle);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);

  const node = findNode(scene.root, elementId);
  if (!node) return null;
  const isPseudo = Boolean(pseudo);
  const own = isPseudo
    ? (node.pseudoStyles?.[pseudo!] ?? {})
    : (node.style ?? {});
  const eff = (getEffectiveStyle(node, activeBreakpoint) ?? {}) as Record<string, string | undefined>;
  const S = (isPseudo ? (own as Record<string, string | undefined>) : eff);

  // 简写兼容：没有 longhand 时用 border 简写兜底显示
  const sh = !S.borderTopWidth && !S.borderRightWidth && !S.borderBottomWidth && !S.borderLeftWidth && S.border
    ? parseShorthand(S.border)
    : null;

  const widthOf = (wKey: string): string => (S[wKey] ?? sh?.width ?? '');
  const styleOf = (): string => (S.borderStyle ?? sh?.style ?? (S.border ? 'solid' : 'solid'));
  const colorOf = (): string => (S.borderColor ?? sh?.color ?? '#e2e8f0');

  const widthNums = SIDES.map((s) => parseFloat(widthOf(s.widthKey) || '0') || 0);
  const anySide = widthNums.some((n) => n > 0);
  const uniformWidth = widthNums.every((n) => n === widthNums[0]) ? widthNums[0] : null;
  const currentStyle = styleOf();
  const currentColor = colorOf();

  /**
   * 写入：统一转成 longhand（并清掉简写，避免两份值打架）
   *
   * ⚠ v0.4.7 修的真 BUG（用户：「边框为什么设置不了了？我这是 div 啊？」「你生成的边框写法
   *   可能不对，浏览器也不显示」）：
   *
   * 以前这里**只写 borderTopWidth 等四个宽度，从不写 border-style**。
   * 而 CSS 里 `border-style` 的初始值是 `none` —— 只要它是 none，
   * 宽度写多大浏览器都不画。实测：style 里是 4 条 `borderXWidth: '2px'`，
   * computed 却是 `borderTopWidth: 0px`、`borderTopStyle: none`。
   * 面板上半部分的"边框预览"是拿当前值拼完整 `border: 2px solid #xxx` 画的，
   * 所以**预览里看得见、画布上什么都没有** —— 这正是用户看到的"设置不了"。
   *
   * 现在：只要这次写入了任何 > 0 的宽度，就同时补上 borderStyle（缺省 solid）。
   * 这条对所有调用点生效（滑杆、数字框、点某一侧、鼠标滚轮），不用逐个补。
   */
  const commit = (patch: Record<string, string | undefined>, transient = false) => {
    const body: Record<string, string | undefined> = { ...patch, border: undefined };

    // 这次是否把某一侧写成了 > 0 的宽度？
    const widthKeys = SIDES.map((s) => s.widthKey);
    const writesWidth = widthKeys.some((k) => {
      const v = patch[k];
      if (v === undefined) return false;
      return (parseFloat(v) || 0) > 0;
    });
    // 有宽度就必须有 style，否则浏览器一个像素都不画
    if (writesWidth) {
      const curStyle = S.borderStyle ?? sh?.style ?? '';
      if (!curStyle || curStyle === 'none' || curStyle === 'hidden') body.borderStyle = 'solid';
    }

    if (isPseudo) updatePseudoStyle(elementId, pseudo!, body as any);
    else if (transient) updateStyleTransient(elementId, body as any);
    else updateStyle(elementId, body as any);
  };

  /**
   * 统一改"粗细"（滑杆 / 数字框 / 滚轮都走这里）。
   *
   * ⚠ v0.4.7 修的真 BUG（用户：「边框的像素滑块移动的时候默认给上下左右都开启了，
   *   我就想给下面加边框很烦」）：
   *
   * 以前的条件是 `cur > 0 || px > 0` —— 只要拖到一个大于 0 的值，**四条边全被写**。
   * 于是"先点「下」只开下面一条、再拖滑块调粗细"这个最自然的操作，
   * 会在拖的瞬间把上/右/左也一起打开（它们本来是 0），用户还得回去一条条关掉。
   *
   * 现在分两种情况：
   *   · **已经有边开着**（哪怕只有一条）→ 只改这些边，其它边一个字节都不动；
   *   · **一条都没开**（刚添加边框、还没选边）→ 四条一起开，
   *     因为"给这个盒子加一圈边框"是最常见的意图，此时全开才是对的行为。
   */
  const setAllWidths = (px: number, transient = false) => {
    const patch: Record<string, string | undefined> = {};
    const anyOn = widthNums.some((n) => n > 0);
    SIDES.forEach((s, i) => {
      if (anyOn) {
        // 只动已开启的那几条边
        if (widthNums[i] > 0) patch[s.widthKey] = px + 'px';
      } else {
        // 还没选边：整体加一圈
        patch[s.widthKey] = px + 'px';
      }
    });
    // 一条边都没被写（例如 px=0 且没有任何边开着）也要提交，让 style 回到"无边框"
    commit(patch, transient);
  };

  const setStyle = (v: string) => {
    beginStyleEdit();
    const patch: Record<string, string | undefined> = { borderStyle: v };
    if (v === 'none') SIDES.forEach((s) => { patch[s.widthKey] = '0px'; });
    else SIDES.forEach((s, i) => { if (widthNums[i] <= 0) patch[s.widthKey] = '1px'; });
    commit(patch);
    endStyleEdit();
  };

  const toggleSide = (i: number) => {
    beginStyleEdit();
    const wKey = SIDES[i].widthKey;
    const cur = widthNums[i];
    commit({ [wKey]: cur > 0 ? '0px' : `${uniformWidth && uniformWidth > 0 ? uniformWidth : 1}px` });
    endStyleEdit();
  };

  // 粗细数字框：聚焦后滚轮调值（Shift ×10）
  const baseRef = useRef(uniformWidth ?? 1);
  baseRef.current = uniformWidth ?? (widthNums.find((n) => n > 0) ?? 1);
  const wheel = useWheelAdjust({
    getBase: () => baseRef.current,
    min: 0,
    onStart: () => beginStyleEdit(),
    onPreview: (v) => setAllWidths(Math.max(0, Math.round(v)), true),
    onCommit: (v) => { setAllWidths(Math.max(0, Math.round(v))); endStyleEdit(); }
  });

  // v0.4.4 修复：预览**逐边独立** —— 过去预览用"统一宽度"画四条边，
  // 单独勾选某一边时预览完全对不上（四边同宽同显）。
  const previewStyle: React.CSSProperties = {
    borderTop: `${widthNums[0]}px ${currentStyle} ${currentColor}`,
    borderRight: `${widthNums[1]}px ${currentStyle} ${currentColor}`,
    borderBottom: `${widthNums[2]}px ${currentStyle} ${currentColor}`,
    borderLeft: `${widthNums[3]}px ${currentStyle} ${currentColor}`
  };
  const lastRangeW = useRef(uniformWidth ?? 0);

  /**
   * 粗细输入框的本地草稿（见下方 input 处的长注释）。
   * `null` = 没在编辑 → 显示 store 里的真实值；非 null = 用户正在敲，只显示他敲的。
   */
  const [widthDraft, setWidthDraft] = useState<string | null>(null);
  const commitWidthDraft = () => {
    if (widthDraft === null) return;
    const raw = widthDraft.trim();
    const n = raw === '' ? 0 : parseFloat(raw);
    setWidthDraft(null);
    if (Number.isNaN(n)) { endStyleEdit(); return; }
    setAllWidths(Math.max(0, Math.round(n)));
    endStyleEdit();
  };

  return (
    <div className="border-editor">
      {/* 实时预览 */}
      <div className="be-preview-wrap">
        <div className="be-preview" style={previewStyle}>
          <span>边框预览</span>
        </div>
        <div className="be-sides">
          {SIDES.map((s, i) => (
            <button
              key={s.short}
              className={'be-side-btn' + (widthNums[i] > 0 ? ' active' : '')}
              onClick={() => toggleSide(i)}
              title={widthNums[i] > 0 ? `关闭「${s.label}」边框` : `打开「${s.label}」边框`}
            >{s.label}</button>
          ))}
        </div>
      </div>

      {/* 线型 */}
      <div className="be-row">
        <span className="be-label">线型</span>
        <div className="be-styles">
          {STYLE_OPTIONS.map((o) => (
            <button
              key={o.id}
              className={'be-style-btn' + (currentStyle === o.id ? ' active' : '')}
              onClick={() => setStyle(o.id)}
              title={o.label}
            >
              <span className={'be-style-sample is-' + o.id} />
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* 粗细 */}
      <div className="be-row">
        <span className="be-label">粗细</span>
        <input
          type="range"
          min={0}
          max={16}
          step={1}
          value={uniformWidth ?? (widthNums.find((n) => n > 0) ?? 0)}
          onPointerDown={() => beginStyleEdit()}
          onChange={(e) => { const n = Number(e.target.value); lastRangeW.current = n; setAllWidths(n, true); }}
          onPointerUp={() => { setAllWidths(lastRangeW.current); endStyleEdit(); }}
          className="be-width-range"
          title="拖动调整四边边框粗细"
        />
        <input
          ref={wheel.ref}
          type="text"
          className="be-width-num"
          /**
           * ⚠ v0.4.7 修的真 BUG（用户：「直接改数值始终有个 1 删不掉，想打个 2 结果出来 12」）：
           *
           * 以前这是**受控输入**：value 永远等于 store 里算出来的数字，onChange 里每敲一个字符
           * 就立刻写回 store。于是：
           *   ① 想把 1 删掉 → 输入框变成空串 → parseFloat('') = NaN → 不写 store →
           *      store 还是 1 → React 立刻把 value 又渲染回 "1"，**那个 1 删不掉**；
           *   ② 接着敲 2 → 输入框里是 "12" → 写进 store 12。用户想输 2，结果得到 12。
           *
           * 现在改成**本地草稿**：敲的时候只动 draft（不回写 store），
           * Enter / 失焦时才解析并提交一次。空串 = 先允许它是空的。
           */
          value={widthDraft ?? String(uniformWidth ?? (widthNums.find((n) => n > 0) ?? 0))}
          title="输一个数字，回车或点别处生效；也能聚焦后滚轮调（Shift 一次 10）"
          onChange={(e) => {
            setWidthDraft(e.target.value);
          }}
          onFocus={() => {
            setWidthDraft(String(uniformWidth ?? (widthNums.find((n) => n > 0) ?? 0)));
            beginStyleEdit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commitWidthDraft(); (e.currentTarget as HTMLInputElement).blur(); }
            if (e.key === 'Escape') { setWidthDraft(null); (e.currentTarget as HTMLInputElement).blur(); }
          }}
          onBlur={() => { commitWidthDraft(); wheel.finish(); }}
        />
        <span className="be-unit">px</span>
      </div>

      {/* 颜色 */}
      <div className="be-row">
        <span className="be-label">颜色</span>
        <div className="be-color">
          <ColorField
            value={S.borderColor ?? sh?.color ?? '#e2e8f0'}
            fallback="#e2e8f0"
            onInputFocus={() => beginStyleEdit()}
            onChange={(c) => commit({ borderColor: c }, true)}
            onInputBlur={(c) => { commit({ borderColor: c }); endStyleEdit(); }}
            onModalOpen={() => beginStyleEdit()}
            onModalClose={(c) => { commit({ borderColor: c }); endStyleEdit(); }}
          />
        </div>
      </div>

      {!anySide && currentStyle !== 'none' && (
        <div className="be-hint">当前四边粗细都是 0，看不出边框。拖动上面的「粗细」或点开某一侧即可。</div>
      )}
    </div>
  );
}

export default BorderInput;
