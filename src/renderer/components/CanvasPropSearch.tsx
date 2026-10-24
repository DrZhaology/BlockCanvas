import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SCHEMA, hasStyleValue, type PropertySchema } from '@lib/propertySchema';
import { getPluginProperties } from '@lib/pluginHost';
import { searchProperties } from '@lib/propSearch';
import { useScene, findNode } from '@store/sceneStore';
import { useClosing } from '@lib/useClosing';
import { Icon } from './Icon';

// ============================================================================
// BlockCanvas · 画布「中键搜索属性」（v0.4.4g 起 / v0.4.4h 升级）
// ----------------------------------------------------------------------------
// 在画布上对某个元素按**鼠标中键** → 弹出一个搜索框 → 敲属性名 → Enter：
//   直接跳到右侧属性面板的「CSS 样式属性」，定位到匹配度最高的那一行并橙色高亮。
// 支持拼错 / 只敲前几个字母 / 拼音缩写（见 lib/propSearch）。
//
// v0.4.4h：
//   · 点击别处也能关闭（不只是 Esc），并补上退场动画；
//   · 结果分两态 —— **已添加（有值）= 蓝色，Enter 直接定位**；**未添加 = 白色**，
//     按 Enter 只提示"没有添加"，不会偷偷帮你加；
//   · 权重第一项恰好是"未添加"时，下方显示小字提示，**Ctrl+Enter** 快捷添加并定位。
// 设计意图：鼠标中键 + 键盘，一步直达，不用在长长的属性列表里翻。
// ============================================================================

const EXIT_MS = 130;

export function CanvasPropSearch({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // v0.4.5（用户反馈）：↑↓ 切换候选项以前完全没用 —— 这里补上"当前高亮项"。
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => { setActiveIdx(0); }, [q]);

  // 退场动画：先播动画再真正卸载（关掉时不再"啪一下没了"）
  const [open, setOpen] = useState(true);
  const { mounted, closing } = useClosing(open, EXIT_MS);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!mounted) onCloseRef.current();
  }, [mounted]);
  const close = () => setOpen(false);

  const all = [...SCHEMA, ...getPluginProperties()];
  const hits = searchProperties(all, q).slice(0, 6);

  // 当前选中元素 —— 用来判断每条属性"已经添加到这个元素了吗"
  const scene = useScene((s) => s.scene);
  const selectedId = scene.selectedId;
  const node = selectedId ? findNode(scene.root, selectedId) : null;
  const isAdded = (item: PropertySchema): boolean => {
    if (!node) return false;
    if ((node.visibleProps ?? []).includes(item.key)) return true;
    return hasStyleValue(node.style as unknown as Record<string, string | undefined>, item);
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.min(Math.max(6, x), Math.max(6, window.innerWidth - w - 6)),
      top: Math.min(Math.max(6, y), Math.max(6, window.innerHeight - h - 6))
    });
  }, [x, y, q, msg]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 点击别处关闭 / Esc 关闭。
  // 延迟 80ms 再挂监听：否则"打开它的那次中键按下"会立刻把框关掉。
  useEffect(() => {
    let off: (() => void) | null = null;
    const t = window.setTimeout(() => {
      const onDown = (e: PointerEvent) => {
        if (!ref.current?.contains(e.target as Node)) close();
      };
      window.addEventListener('pointerdown', onDown, true);
      off = () => window.removeEventListener('pointerdown', onDown, true);
    }, 80);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      off?.();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 定位到某条属性；forceAdd = true 时（Ctrl+Enter）即使没添加过也先添加再定位 */
  const commit = (item: PropertySchema | undefined, forceAdd: boolean) => {
    if (!item) return;
    if (!isAdded(item) && !forceAdd) {
      setMsg(`「${item.label}」还没添加，按 Ctrl+Enter 添加并定位。`);
      return;
    }
    // 派发事件：App 负责切到「属性 · 元素」并把请求写进 lib/propFocus 的缓冲，
    // 这样右侧面板停在图层 / 页面 / 类名页时也不会丢（见 Inspector 顶层与 ElementPropsBody）。
    const req = { key: item.key, add: forceAdd || isAdded(item) };
    window.dispatchEvent(new CustomEvent('bc:focus-prop', { detail: req }));
    close();
  };

  if (!mounted) return null;

  const best = hits[0]?.item;
  const bestMissing = !!best && !isAdded(best);

  return createPortal(
    <div ref={ref} className={'bc-prop-search' + (closing ? ' is-closing' : '')} style={{ left: pos.left, top: pos.top }}>
      <div className="bc-prop-search-row">
        <span className="bc-prop-search-ico" aria-hidden="true"><Icon name="search" size={14} /></span>
        <input
          ref={inputRef}
          className="bc-prop-search-input"
          value={q}
          placeholder="敲属性名 → Enter 定位"
          onChange={(e) => { setQ(e.target.value); setMsg(null); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (hits.length === 0) return;
              setActiveIdx((i) => {
                const cur = Math.min(Math.max(i, 0), hits.length - 1);
                return e.key === 'ArrowDown' ? (cur + 1) % hits.length : (cur - 1 + hits.length) % hits.length;
              });
              setMsg(null);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              // v0.4.5：不再要求 Ctrl —— 没添加过就**直接添加并定位**，
              // 用户反馈"鼠标点击/回车不能定位或添加，非得按 Ctrl"。
              const target = hits[Math.min(Math.max(activeIdx, 0), Math.max(0, hits.length - 1))]?.item;
              if (target) commit(target, !isAdded(target));
            } else if (e.key === 'Escape') { e.preventDefault(); close(); }
          }}
        />
      </div>
      {q.trim() !== '' && (
        <div className="bc-prop-search-list bc-scroll">
          {hits.length === 0 && <div className="bc-prop-search-empty">没有匹配的属性</div>}
          {hits.map((h, i) => {
            const added = isAdded(h.item);
            const active = i === Math.min(activeIdx, hits.length - 1);
              return (
              <button
                key={h.item.key}
                className={'bc-prop-search-item' + (active ? ' is-active' : '') + (i === 0 ? ' is-best' : '') + (added ? ' is-added' : ' is-missing')}
                // v0.4.5：单击 = 定位；没添加过的一并添加（不再需要 Ctrl+左键）
                onClick={() => commit(h.item, !added)}
                onMouseEnter={() => setActiveIdx(i)}
                title={added ? `定位到「${h.item.label}」` : `添加「${h.item.label}」并定位`}
              >
                <span className="bc-prop-search-label">{h.item.label}</span>
                <span className="bc-prop-search-key">{h.item.key}</span>
                <span className="bc-prop-search-badge">{added ? '已添加' : '未添加'}</span>
              </button>
            );
          })}
        </div>
      )}
      {msg && <div className="bc-prop-search-msg">{msg}</div>}
      {q.trim() !== '' && bestMissing && !msg && (
        <div className="bc-prop-search-hint-ctr">
          最匹配的「{best!.label}」尚未添加 · 按住 <kbd>Ctrl</kbd> 再按 <kbd>Enter</kbd> 可快捷添加并定位
        </div>
      )}
      <div className="bc-prop-search-hint">中键搜索 · ↑↓ 选择 · Enter 定位/添加 · Esc / 点别处关闭</div>
    </div>,
    document.body
  );
}
