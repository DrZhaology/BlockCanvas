// ============================================================================
// BlockCanvas · 切换定位方式时的「外边距」确认（v0.4.6 · 用户定的死规矩）
// ----------------------------------------------------------------------------
// 用户原话：
//   「改 position 的时候，定一条死规矩，必须清除 margin，不然特别麻烦……一定要做一下提示。
//     全屏的模态提示。说明为什么要清除 margin，说明这样方便定位调整，不会被 margin 限制。
//     有三个选项，先不设置定位，保留外边距并切换定位，清除外边距并切换定位。
//     颜色要鲜明，最后的第三个按钮用绿色，提醒用户这个建议点击。
//     后面我发现有些地方做了，但是有些时候改的时候不会有提示，比如卡片 position 直接改，
//     这次做统一。」
//
// 为什么必须问：定位元素靠 left/top 之类排位置，老 margin 会把它"顶住"——
// 常见表现就是"改了定位却拖不动 / 位置差一截"，用户找不到原因。
//
// 三个选项的语义：
//   cancel  —— 先不设置定位（取消整件事）
//   keep    —— 保留外边距并切换（高级用户：知道自己在干嘛）
//   clear   —— 清除外边距并切换（推荐：一键把干扰项清零）
//
// 全程序**只走这一条通道**：快捷助手、幽灵卡片、CSS 属性行的 position 下拉，
// 全部先 askPositionSwitch() 再写样式。不要再各自写一套内联确认条。
// ============================================================================
import { useEffect, useState } from 'react';

export type PosChoice = 'cancel' | 'keep' | 'clear';

interface Ask {
  next: string;
  margins: string;
  elementTag: string;
}

let pending: Ask | null = null;
let resolveFn: ((c: PosChoice) => void) | null = null;
const listeners = new Set<(a: Ask | null) => void>();

function emit() {
  for (const l of listeners) l(pending);
}

/**
 * 问一次"要不要清 margin"。
 * 返回 Promise<'cancel' | 'keep' | 'clear'>；没有 Host 时（理论上不会）返回 'keep' 保底。
 */
export function askPositionSwitch(a: Ask): Promise<PosChoice> {
  pending = a;
  emit();
  return new Promise<PosChoice>((resolve) => {
    resolveFn = resolve;
    if (listeners.size === 0) { pending = null; emit(); resolve('keep'); }
  });
}

/** 读一个元素当前"不干净的" margin 摘要（供调用方拼文案） */
export function marginSummaryOf(style: Record<string, string | undefined>): { dirty: boolean; text: string } {
  const keys = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
  const vals = keys.map((k) => style[k] ?? '');
  const norm = (v: string) => (v === '' ? '0px' : v);
  const text = vals.map((v, i) => `${['上', '右', '下', '左'][i]} ${norm(v)}`).join(' · ');
  const dirty = vals.some((v) => !!v && v !== '0' && v !== '0px' && v !== 'auto')
    || new Set(vals.map(norm)).size > 1;
  return { dirty, text };
}

/** 挂在 App 里的宿主；只在有请求时渲染，且整屏遮罩（不可点遮罩关闭，防误触） */
export function PositionSwitchHost() {
  const [ask, setAsk] = useState<Ask | null>(pending);

  useEffect(() => {
    const l = (a: Ask | null) => setAsk(a);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); choose('cancel'); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  const choose = (c: PosChoice) => {
    const fn = resolveFn;
    resolveFn = null;
    pending = null;
    emit();
    fn?.(c);
  };

  if (!ask) return null;

  return (
    <div className="bc-posswitch-scrim" role="dialog" aria-modal="true" aria-label="切换定位方式">
      <div className="bc-posswitch-card">
        <div className="bc-posswitch-title">
          切换到「{ask.next}」定位前，先处理一下外边距
        </div>
        <div className="bc-posswitch-body">
          <p>
            这个 <code>&lt;{ask.elementTag}&gt;</code> 现在有外边距：<strong>{ask.margins}</strong>。
          </p>
          <p>
            定位元素是用 <code>left / top</code> 这类偏移来排位置的，外边距会把它「顶住」——
            最常见的表现是<strong>改了定位却拖不动、或者位置差一截</strong>，而且很难看出原因。
          </p>
          <p className="bc-posswitch-tip">
            建议：清掉外边距再切换。位置完全由定位偏移决定，拖起来最跟手；需要留白时再用 padding 加。
          </p>
        </div>
        <div className="bc-posswitch-actions">
          <button className="bc-posswitch-btn is-ghost" onClick={() => choose('cancel')}>先不设置定位</button>
          <button className="bc-posswitch-btn" onClick={() => choose('keep')}>保留外边距并切换</button>
          <button className="bc-posswitch-btn is-recommend" onClick={() => choose('clear')}>清除外边距并切换</button>
        </div>
      </div>
    </div>
  );
}
