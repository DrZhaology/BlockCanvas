import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SCHEMA, hasStyleValue, type PropertySchema } from '@lib/propertySchema';
import { getPluginProperties } from '@lib/pluginHost';
import { searchProperties } from '@lib/propSearch';
import { useScene, findNode } from '@store/sceneStore';
import { useClosing } from '@lib/useClosing';
import { collectAvoidRects, placeOverlay } from '@lib/overlayPlacement';
import { Icon } from './Icon';

// ============================================================================
// BlockCanvas · 画布「中键搜索属性」
// ----------------------------------------------------------------------------
// 在画布上对某个元素按**鼠标中键** → 弹出搜索框 → 敲属性名 → 回车定位到右侧面板。
// 支持拼错 / 只敲前几个字母 / 拼音缩写（见 lib/propSearch）。
//
// v0.4.5 第十六批（用户明确要求"逻辑太复杂了，简化"，逐条对应）：
//  ①「输入框的结果只显示三个，每一个按照下面的显示：属性中文名称 属性英文名
//     最后末尾显示有没有添加。原来的属性值搜索和快捷添加不要了。」
//     → MAX_HITS = 3；每行只有「中文名 / 英文名 / 已添加·未添加」三段；
//       **整块删掉**了属性值预测（原 `属性名 + 空格 + 值前缀` 那套）与快捷添加。
//  ②「如果 Enter 搜索列表中的选项，那么就是定位到搜索列表第一个属性，右侧菜单。」
//     → Enter = 定位（走 bc:focus-prop，App 切到「元素」页签并滚到那一行）。
//  ③「搜索的 3 个结果中默认选中第一个，把这个卡片结果变成淡蓝色就行，
//     左边的蓝色样式不要了。键盘按 ↓ 或者 ↑ 调整搜索到的 3 个结果的选中情况。」
//     → 默认 activeIdx = 0；选中态 = **淡蓝卡片底**；去掉了左侧那条蓝色竖线
//       （inset box-shadow）；↑↓ 在 3 条里循环移动。
//  ④「如果搜索结果第一个是没有添加过的，那么按 Enter 就不能定位，
//     按 Ctrl + Enter 添加并且定位。」
//     → Enter 只对"已添加"的属性生效；未添加时给一句提示，不偷偷改样式。
//  ⑤「鼠标操作对应 左键：定位，不能添加：左键 + Enter 添加 + 定位」
//     → 左键单击 = 定位（不添加）；**Ctrl + 左键** = 添加并定位
//       （与 Ctrl+Enter 同义 —— 用户写的"左键+Enter"即指这组修饰键对应关系）。
//
// ⚠ 右侧面板的「＋ 添加属性」**不要**这套机制（用户明确要求只按属性名搜索）。
// ============================================================================

const EXIT_MS = 130;
/** 结果条数：用户要求"只显示三个" */
const MAX_HITS = 3;

export function CanvasPropSearch({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number | null }>({ left: x, top: y, maxHeight: null });
  const [activeIdx, setActiveIdx] = useState(0);
  // 每次改查询都把选中拉回第一条（"默认选中第一个"）
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

  const all = useMemo(() => [...SCHEMA, ...getPluginProperties()], []);
  const hits = useMemo(
    () => (q.trim() === '' ? [] : searchProperties(all, q).slice(0, MAX_HITS)),
    [all, q]
  );
  const safeIdx = Math.min(Math.max(activeIdx, 0), Math.max(0, hits.length - 1));
  const activeItem = hits[safeIdx]?.item;

  // 当前选中元素 —— 用来判断每条属性"已经添加到这个元素了吗"
  const scene = useScene((s) => s.scene);
  const selectedId = scene.selectedId;
  const node = selectedId ? findNode(scene.root, selectedId) : null;
  const isAdded = (item: PropertySchema): boolean => {
    if (!node) return false;
    if ((node.visibleProps ?? []).includes(item.key)) return true;
    return hasStyleValue(node.style as unknown as Record<string, string | undefined>, item);
  };

  // 定位：**走统一的浮层避让**（不出窗口、不压住下方元素面板/工具栏）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const avoid = collectAvoidRects();
    setPos((cur) => {
      const p = placeOverlay({
        anchor: { left: x, top: y, right: x, bottom: y },
        width: el.offsetWidth,
        height: el.offsetHeight,
        avoid
      });
      if (cur.left === p.left && cur.top === p.top && cur.maxHeight === p.maxHeight) return cur;
      return { left: p.left, top: p.top, maxHeight: p.maxHeight };
    });
  }, [x, y, q, msg]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 点击别处关闭 / Esc 关闭。延迟 80ms 再挂监听：否则"打开它的那次中键按下"会立刻把框关掉。
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

  /**
   * 定位 / 添加并定位。
   *   forceAdd = true（Ctrl+Enter / Ctrl+左键）→ 添加到可见列表并定位
   *   forceAdd = false（Enter / 左键）        → 只在"已添加"时定位
   */
  const commit = (item: PropertySchema | undefined, forceAdd: boolean) => {
    if (!item) return;
    const added = isAdded(item);
    if (!added && !forceAdd) {
      setMsg(`「${item.label}」还没添加 —— 按 Ctrl+Enter 可以添加并定位。`);
      return;
    }
    // 派发事件：App 负责切到「元素」页签并把请求写进 lib/propFocus 的缓冲，
    // 这样右侧面板停在图层 / 页面 / 类名页时也不会丢。
    window.dispatchEvent(new CustomEvent('bc:focus-prop', { detail: { key: item.key, add: forceAdd || added } }));
    close();
  };

  if (!mounted) return null;

  return createPortal(
    <div
      ref={ref}
      className={'bc-prop-search' + (closing ? ' is-closing' : '')}
      style={{ left: pos.left, top: pos.top, ...(pos.maxHeight ? { maxHeight: pos.maxHeight } : undefined) }}
    >
      <div className="bc-prop-search-row">
        <span className="bc-prop-search-ico" aria-hidden="true"><Icon name="search" size={14} /></span>
        <input
          ref={inputRef}
          className="bc-prop-search-input"
          value={q}
          placeholder="属性名 → Enter 定位 · Ctrl+Enter 添加"
          onChange={(e) => { setQ(e.target.value); setMsg(null); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (hits.length > 0) {
                const dir = e.key === 'ArrowDown' ? 1 : -1;
                setActiveIdx((i) => {
                  const cur = Math.min(Math.max(i, 0), hits.length - 1);
                  return (cur + dir + hits.length) % hits.length;
                });
              }
              setMsg(null);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              // Ctrl（或 Meta，方便 mac）= 添加并定位；裸 Enter = 只定位（未添加则不动作）
              commit(activeItem, e.ctrlKey || e.metaKey);
            } else if (e.key === 'Escape') { e.preventDefault(); close(); }
          }}
        />
      </div>
      {q.trim() !== '' && (
        <div className="bc-prop-search-list bc-scroll">
          {hits.length === 0 && <div className="bc-prop-search-empty">没有匹配的属性</div>}
          {hits.map((h, i) => {
            const added = isAdded(h.item);
            const active = i === safeIdx;
            return (
              <button
                key={h.item.key}
                className={'bc-prop-search-item' + (active ? ' is-active' : '') + (added ? ' is-added' : ' is-missing')}
                // 「权重第一」只做数据标记（供探针/无障碍读取），界面靠"排在最上面"表达
                data-best={i === 0 ? '1' : undefined}
                data-added={added ? '1' : '0'}
                // 左键 = 定位（未添加只提示，不偷偷改样式）；**Ctrl + 左键 = 添加并定位**
                onClick={(e) => commit(h.item, e.ctrlKey || e.metaKey)}
                onMouseEnter={() => setActiveIdx(i)}
                title={added
                  ? `定位到「${h.item.label}」（Ctrl + 点击 = 重新添加）`
                  : `「${h.item.label}」尚未添加 —— Ctrl + 点击 添加并定位`}
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
      {/* 第一条未添加时，明确告诉用户"Enter 不管用，要按 Ctrl+Enter"（用户规则 ④） */}
      {q.trim() !== '' && !msg && hits.length > 0 && !isAdded(hits[0].item) && (
        <div className="bc-prop-search-hint-ctr">
          「{hits[0].item.label}」还没添加 · 按 <kbd>Ctrl</kbd> + <kbd>Enter</kbd> 添加并定位
        </div>
      )}
      <div className="bc-prop-search-hint">
        中键搜索 · ↑↓ 选择 · Enter 定位 · Ctrl+Enter 添加 · Esc 关闭
      </div>
    </div>,
    document.body
  );
}
