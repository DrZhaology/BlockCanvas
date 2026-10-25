import { useEffect, useState } from 'react';
import { useScene, findNode, getEffectiveStyle } from '@store/sceneStore';
import { NumberUnitInput } from './NumberUnitInput';
import { Icon } from './Icon';
import type { ElementType } from '@lib/types';

// ============================================================================
// BlockCanvas · 定位「幽灵卡片」（v0.4.5 第十六批 · 用户澄清后的真实需求）
// ----------------------------------------------------------------------------
// 用户原话：
//   「幽灵卡片完全没有做……而幽灵卡片就是临时的作用，
//     比如中间选中元素输入 position，Enter 就可以直接定位到这个元素右侧的
//     position 的幽灵卡片，只是用来临时数据修改，避免去快捷助手里面改。」
//
// 所以它不是"快捷助手隐藏属性时的占位说明"（那是上一轮我做错方向的东西，已删），
// 而是一张**临时**的定位编辑卡：
//   · 只有通过中键搜索「position / 定位」并回车时才出现；
//   · 出现后自动定位到它（滚动 + 高亮），改完关掉就消失；
//   · 与「快捷助手 → 定位助手」不冲突：后者是长期面板，这张是"临时改一下就走"。
//
// 为什么需要它：position 相关的属性分散在"快捷助手"里，而快捷助手默认是收起的；
// 中键搜 position 却点不进去（用户反馈"对于定位 position 元素没有用"）。
// 这里给一条直达通道：搜 → 回车 → 就地改。
// ============================================================================

type PosKind = 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';

const POS_OPTIONS: Array<[PosKind, string]> = [
  ['static', '默认流 (static)'],
  ['relative', '相对 (relative)'],
  ['absolute', '绝对 (absolute)'],
  ['fixed', '固定 (fixed)'],
  ['sticky', '粘性 (sticky)']
];

export function PositionGhostCard({
  elementId,
  onClose
}: {
  elementId: string;
  /** 保留参数：将来按元素类型细分定位可选项（媒体元素等），目前不影响逻辑 */
  elementType?: ElementType;
  onClose: () => void;
}) {
  const scene = useScene((s) => s.scene);
  const updateStyle = useScene((s) => s.updateStyle);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const node = findNode(scene.root, elementId);
  const [anchorX, setAnchorX] = useState<'left' | 'right'>('left');
  const [anchorY, setAnchorY] = useState<'top' | 'bottom'>('top');
  const [askClear, setAskClear] = useState<PosKind | null>(null);

  const eff = (node ? getEffectiveStyle(node, activeBreakpoint) : {}) as Record<string, string | undefined>;
  const pos = (eff.position ?? 'static') as PosKind;
  const relLike = pos === 'relative' || pos === 'sticky';

  // 跟随元素现有写法（手改过 left/right 时界面要跟着走）
  useEffect(() => {
    if (relLike) return;
    const hasL = !!eff.left && eff.left !== 'auto';
    const hasR = !!eff.right && eff.right !== 'auto';
    if (hasR && !hasL) setAnchorX('right');
    else if (hasL && !hasR) setAnchorX('left');
    const hasT = !!eff.top && eff.top !== 'auto';
    const hasB = !!eff.bottom && eff.bottom !== 'auto';
    if (hasB && !hasT) setAnchorY('bottom');
    else if (hasT && !hasB) setAnchorY('top');
  }, [relLike, eff.left, eff.right, eff.top, eff.bottom]);

  if (!node) return null;

  const marginKeys = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
  const marginVals = marginKeys.map((k) => eff[k] ?? '');
  const marginSummary = marginVals.map((v, i) => `${['上', '右', '下', '左'][i]} ${v || '0'}`).join(' · ');
  const marginDirty = marginVals.some((v) => !!v && v !== '0' && v !== '0px' && v !== 'auto');

  /** 写入定位方式：同一根轴**只留一边**，另一边置 auto（用户反复要求） */
  const applyPosition = (next: PosKind, clearMargin: boolean) => {
    const patch: Record<string, string | undefined> = { position: next };
    if (next === 'static') {
      patch.left = 'auto'; patch.right = 'auto'; patch.top = 'auto'; patch.bottom = 'auto';
    } else if (next === 'relative' || next === 'sticky') {
      patch.right = 'auto'; patch.bottom = 'auto';
      if (!eff.left || eff.left === 'auto') patch.left = '0px';
      if (!eff.top || eff.top === 'auto') patch.top = '0px';
    } else {
      patch[anchorX === 'left' ? 'right' : 'left'] = 'auto';
      patch[anchorY === 'top' ? 'bottom' : 'top'] = 'auto';
      if (!eff[anchorX] || eff[anchorX] === 'auto') patch[anchorX] = '0px';
      if (!eff[anchorY] || eff[anchorY] === 'auto') patch[anchorY] = '0px';
    }
    if (clearMargin) {
      patch.marginTop = '0px'; patch.marginRight = '0px';
      patch.marginBottom = '0px'; patch.marginLeft = '0px';
    }
    beginStyleEdit();
    updateStyle(elementId, patch as never);
    endStyleEdit();
    setAskClear(null);
  };

  const changePosition = (next: PosKind) => {
    if (next === pos) return;
    if (marginDirty && next !== 'static') { setAskClear(next); return; }
    applyPosition(next, false);
  };

  return (
    <div className="pos-ghost" data-bc-pos-ghost="1">
      <div className="pos-ghost-head">
        <span className="pos-ghost-title"><Icon name="target" size={13} /> 定位（临时）</span>
        <button className="pos-ghost-x" onClick={onClose} title="关闭这张临时卡片"><Icon name="close" size={12} /></button>
      </div>

      <div className="pos-ghost-body">
        <div className="pos-ghost-modes">
          {POS_OPTIONS.map(([k, label]) => (
            <button
              key={k}
              className={'pos-ghost-mode' + (pos === k ? ' is-on' : '')}
              onClick={() => changePosition(k)}
            >{label}</button>
          ))}
        </div>

        {askClear && (
          <div className="pos-confirm">
            <div className="pos-confirm-text">
              这个元素已有<strong>非零</strong>外边距（{marginSummary}），
              会把定位偏移「顶住」（表现为改了定位却拖不动）。
            </div>
            <div className="pos-confirm-actions">
              <button className="pos-confirm-btn is-primary" onClick={() => applyPosition(askClear, true)}>清掉 margin</button>
              <button className="pos-confirm-btn" onClick={() => applyPosition(askClear, false)}>保留</button>
              <button className="pos-confirm-btn is-ghost" onClick={() => setAskClear(null)}>取消</button>
            </div>
          </div>
        )}

        {pos !== 'static' && (
          <div className="pos-edges">
            <div className="pos-axis">
              <span className="pos-axis-label">横向</span>
              <div className="pos-axis-seg">
                {(['left', 'right'] as const).map((k) => (
                  <button
                    key={k}
                    className={'pos-axis-btn' + (anchorX === k ? ' is-on' : '')}
                    disabled={relLike}
                    onClick={() => {
                      setAnchorX(k);
                      beginStyleEdit();
                      updateStyle(elementId, { [k]: eff[k] ?? '0px', [k === 'left' ? 'right' : 'left']: 'auto' } as never);
                      endStyleEdit();
                    }}
                  >{k === 'left' ? '左' : '右'}</button>
                ))}
              </div>
              <NumberUnitInput elementId={elementId} schemaKey={relLike ? 'left' : anchorX} unit="px" />
            </div>
            <div className="pos-axis">
              <span className="pos-axis-label">纵向</span>
              <div className="pos-axis-seg">
                {(['top', 'bottom'] as const).map((k) => (
                  <button
                    key={k}
                    className={'pos-axis-btn' + (anchorY === k ? ' is-on' : '')}
                    disabled={relLike}
                    onClick={() => {
                      setAnchorY(k);
                      beginStyleEdit();
                      updateStyle(elementId, { [k]: eff[k] ?? '0px', [k === 'top' ? 'bottom' : 'top']: 'auto' } as never);
                      endStyleEdit();
                    }}
                  >{k === 'top' ? '上' : '下'}</button>
                ))}
              </div>
              <NumberUnitInput elementId={elementId} schemaKey={relLike ? 'top' : anchorY} unit="px" />
            </div>
          </div>
        )}

        <div className="pos-ghost-hint">
          {pos === 'static' && '默认流式：元素按文档顺序排，偏移不起作用。'}
          {relLike && '相对定位：原文档流位置不动，只按 left / top 位移（可以是负数）。'}
          {(pos === 'absolute' || pos === 'fixed') && '只锚定两边（另一边自动 auto）；偏移小于 0 会被当成 0。'}
          {pos === 'sticky' && ' 需要配合 top / bottom 才生效。'}
          <br />
          这张卡片是**临时**的：按 Esc 或点右上角 × 关掉；想长期显示请用快捷助手。
        </div>
      </div>
    </div>
  );
}