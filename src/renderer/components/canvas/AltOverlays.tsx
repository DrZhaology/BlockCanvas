// BlockCanvas · F12 式盒模型覆盖层（Alt 悬停 / 拖动时实时显示）
//
// 全部用 client 坐标 + position: fixed —— 不随画布滚动 / 缩放漂移。
// 纯展示组件：数据由 useAltDrag 的 readBoxModel 提供，这里只负责排版。
import type { AltBoxModelData } from './types';

export function AltBoxModel({ bm }: { bm: AltBoxModelData }) {
  const { x, y, w, h, mt, mr, mb, ml, bt, br, bb, bl, pt, pr, pb, pl } = bm;
  // 四层盒（外 → 内）：margin 盒 / border 盒 / padding 盒 / content 盒
  const margin = { left: x - ml, top: y - mt, width: w + ml + mr, height: h + mt + mb };
  const border = { left: x, top: y, width: w, height: h };
  const padding = { left: x + bl, top: y + bt, width: Math.max(0, w - bl - br), height: Math.max(0, h - bt - bb) };
  const content = {
    left: padding.left + pl,
    top: padding.top + pt,
    width: Math.max(0, padding.width - pl - pr),
    height: Math.max(0, padding.height - pt - pb)
  };
  const num = (v: number) => Math.round(v);
  const show = (v: number) => v >= 12; // 太窄就不画数字，避免糊成一团
  // v0.4.5：margin 写的是 auto 时显示 "auto"（computed 只会给出算好的像素）
  const isAuto = (k: string) => bm.autoSides.includes(k);
  /** v0.4.7：这条偏移**真的写了值**才标出来（fixed/absolute 只该显示两条） */
  const isSet = (k: 'top' | 'right' | 'bottom' | 'left') => (bm.setSides ?? []).includes(k);
  const mLbl = (k: string, v: number) => (isAuto(k) ? 'auto' : String(num(v)));
  // v0.4.5：定位偏移标签（fixed / absolute / sticky 才画）
  const insetLbl = (k: 'top' | 'right' | 'bottom' | 'left') => {
    const raw = String(bm.insets[k] ?? 'auto').trim();
    if (isAuto(k) || raw === 'auto' || raw === '') return `${k} auto`;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? `${k} ${Math.round(v)}px` : `${k} auto`;
  };
  const showInsets = bm.posKind === 'fixed' || bm.posKind === 'absolute' || bm.posKind === 'sticky';

  return (
    <div className="bc-boxm">
      {/* relative：先画出"元素原本在文档流里占的位置"（虚线幽灵），再画当前盒 */}
      {bm.posKind === 'relative' && (bm.offsetX !== 0 || bm.offsetY !== 0) && (
        <div
          className="bc-boxm-ghost"
          style={{ left: x - bm.offsetX, top: y - bm.offsetY, width: w, height: h }}
        >
          <em>原文档流位置</em>
        </div>
      )}
      <div className="bc-boxm-layer is-margin" style={margin} />
      <div className="bc-boxm-layer is-border" style={border} />
      <div className="bc-boxm-layer is-padding" style={padding} />
      <div className="bc-boxm-layer is-content" style={content} />

      {/* margin 四边数值（auto 时显示 auto） */}
      {(show(mt) || isAuto('marginTop')) && <span className="bc-boxm-num" style={{ left: x + w / 2, top: y - mt / 2 }}>{mLbl('marginTop', mt)}</span>}
      {(show(mb) || isAuto('marginBottom')) && <span className="bc-boxm-num" style={{ left: x + w / 2, top: y + h + mb / 2 }}>{mLbl('marginBottom', mb)}</span>}
      {(show(ml) || isAuto('marginLeft')) && <span className="bc-boxm-num" style={{ left: x - ml / 2, top: y + h / 2 }}>{mLbl('marginLeft', ml)}</span>}
      {(show(mr) || isAuto('marginRight')) && <span className="bc-boxm-num" style={{ left: x + w + mr / 2, top: y + h / 2 }}>{mLbl('marginRight', mr)}</span>}

      {/* 定位偏移：**只标真正在用的那几条**
          v0.4.7（用户第五次反馈，原话「fixed 的 Alt 显示还是四边都显示，说了两边！！！」）：
          以前 fixed/absolute 一按 Alt 就把 top/right/bottom/left 四个数字全标出来，
          可面板里明明只有两条偏移 —— 等于在告诉用户"你有四条"。现在没写的边不画。 */}
      {showInsets && isSet('top') && (
        <span className="bc-boxm-inset is-top" style={{ left: x + w / 2, top: y - 17 }}>{insetLbl('top')}</span>
      )}
      {showInsets && isSet('bottom') && (
        <span className="bc-boxm-inset is-bottom" style={{ left: x + w / 2, top: y + h + 17 }}>{insetLbl('bottom')}</span>
      )}
      {showInsets && isSet('left') && (
        <span className="bc-boxm-inset is-left" style={{ left: x - 22, top: y + h / 2 }}>{insetLbl('left')}</span>
      )}
      {showInsets && isSet('right') && (
        <span className="bc-boxm-inset is-right" style={{ left: x + w + 22, top: y + h / 2 }}>{insetLbl('right')}</span>
      )}

      {/* padding 四边数值 */}
      {show(pt) && <span className="bc-boxm-num is-pad" style={{ left: x + w / 2, top: padding.top + pt / 2 }}>{num(pt)}</span>}
      {show(pb) && <span className="bc-boxm-num is-pad" style={{ left: x + w / 2, top: padding.top + padding.height - pb / 2 }}>{num(pb)}</span>}
      {show(pl) && <span className="bc-boxm-num is-pad" style={{ left: padding.left + pl / 2, top: y + h / 2 }}>{num(pl)}</span>}
      {show(pr) && <span className="bc-boxm-num is-pad" style={{ left: padding.left + padding.width - pr / 2, top: y + h / 2 }}>{num(pr)}</span>}

      {/* 中央：定位方式 + 实际尺寸 */}
      <span className="bc-boxm-pos" style={{ left: x + w / 2, top: y + h / 2 }}>
        <b>{bm.posLabel}</b>
        <i>{Math.round(w)} × {Math.round(h)}</i>
      </span>

      {/* v0.4.5：按定位类型给出对应说明（B2 的类型适配） */}
      {bm.posKind === 'sticky' && (
        <span className="bc-boxm-note" style={{ left: x + w / 2, top: y + h + 34 }}>
          粘性吸附：滚动到 {[
            !isAuto('top') && bm.insets.top !== 'auto' ? `top ${insetLbl('top').replace('top ', '')}` : '',
            !isAuto('left') && bm.insets.left !== 'auto' ? `left ${insetLbl('left').replace('left ', '')}` : ''
          ].filter(Boolean).join(' / ') || '未设偏移（不会吸附）'}
        </span>
      )}
      {bm.posKind === 'absolute' && (
        <span className="bc-boxm-note" style={{ left: x + w / 2, top: y + h + 34 }}>
          绝对定位：以最近的「定位祖先」为基准，不受兄弟元素影响
        </span>
      )}
      {bm.posKind === 'fixed' && (
        <span className="bc-boxm-note" style={{ left: x + w / 2, top: y + h + 34 }}>
          固定定位：以浏览器窗口为基准，页面滚动时不动
        </span>
      )}

      {/* relative：从文档流原位到当前位置的距离箭头 */}
      {bm.offsetX !== 0 && (
        <span
          className="bc-boxm-dist is-h"
          style={{ left: Math.min(x, x - bm.offsetX), top: y + h / 2, width: Math.abs(bm.offsetX) }}
        >
          <em>{`left ${bm.offsetX > 0 ? '+' : ''}${Math.round(bm.offsetX)}px`}</em>
        </span>
      )}
      {bm.offsetY !== 0 && (
        <span
          className="bc-boxm-dist is-v"
          style={{ left: x + w / 2, top: Math.min(y, y - bm.offsetY), height: Math.abs(bm.offsetY) }}
        >
          <em>{`top ${bm.offsetY > 0 ? '+' : ''}${Math.round(bm.offsetY)}px`}</em>
        </span>
      )}
    </div>
  );
}

/** Alt 拖动/悬停的所有编辑器覆盖层（高亮框 / 数值气泡 / 墙提示 / 吸附线 / 放入目标） */
export function AltOverlays({ api }: {
  api: {
    altHover: { id: string; edge: string | null; mode: string; rect: { x: number; y: number; w: number; h: number } } | null;
    dragging: boolean;
    altBadge: { x: number; y: number; text: string } | null;
    wallFlash: { x: number; y: number; w: number; h: number } | null;
    wallHints: Array<{ x: number; y: number; w: number; h: number }>;
    dropTarget: { id: string; rect: { x: number; y: number; w: number; h: number } } | null;
    guides: { x: number | null; y: number | null; box: { left: number; top: number; right: number; bottom: number } | null } | null;
    boxModel: AltBoxModelData | null;
  };
}) {
  const { altHover, dragging, altBadge, wallFlash, wallHints, dropTarget, guides, boxModel } = api;
  return (
    <>
      {/* 行内选中元素的合并外框由 Canvas 自己画（要测量），这里只管 Alt 系列 */}
      {/* Alt 悬停高亮：按住 Alt 后，鼠标下的元素亮出可交互边框 + 命中边提示。
          v0.4.4：拖拽过程中也持续显示（rAF 量真实 rect），橙色边界 1:1 实时跟随。 */}
      {altHover && (
        <div
          className={'bc-alt-box mode-' + altHover.mode + (dragging ? ' is-live' : '')}
          style={{ left: altHover.rect.x, top: altHover.rect.y, width: altHover.rect.w, height: altHover.rect.h }}
        >
          {altHover.edge && <span className={'bc-alt-edge e-' + altHover.edge} />}
        </div>
      )}
      {/* Alt 拖动时的 F12 式盒模型：四层盒 + 各边数值 + 定位方式 + relative 偏移箭头 */}
      {boxModel && <AltBoxModel bm={boxModel} />}
      {/* Alt 拖拽实时数值气泡 */}
      {altBadge && (
        <div className="bc-alt-badge" style={{ left: altBadge.x, top: altBadge.y }}>{altBadge.text}</div>
      )}
      {/* 撞到"墙"时的橙色闪烁提示（说明是限制，不是 BUG） */}
      {wallFlash && (
        <div
          className="bc-wall-flash"
          style={{ left: wallFlash.x, top: wallFlash.y, width: wallFlash.w, height: wallFlash.h }}
        />
      )}
      {/* Alt 拖动时常显的"可达边界"提示线（内边距 / 外边距 / 兄弟元素边） */}
      {wallHints.map((b, i) => (
        <div key={'wh' + i} className="bc-wall-hint" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />
      ))}
      {/* 拖到墙外 → 改父子关系：鼠标下的块级元素高亮（松开即放入） */}
      {dropTarget && (
        <div
          className="bc-drop-into"
          style={{ left: dropTarget.rect.x, top: dropTarget.rect.y, width: dropTarget.rect.w, height: dropTarget.rect.h }}
        >
          <span className="bc-drop-into-tag">放入此元素</span>
        </div>
      )}
      {/* Alt 移动时的吸附对齐参考线 */}
      {guides && guides.box && guides.x !== null && (
        <div className="bc-align-guide bc-align-v" style={{ left: guides.x, top: guides.box.top, height: guides.box.bottom - guides.box.top }} />
      )}
      {guides && guides.box && guides.y !== null && (
        <div className="bc-align-guide bc-align-h" style={{ top: guides.y, left: guides.box.left, width: guides.box.right - guides.box.left }} />
      )}
    </>
  );
}
