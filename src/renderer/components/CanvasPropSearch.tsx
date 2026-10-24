import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SCHEMA, hasStyleValue, presetValue, NUMBER_PRESETS, type PropertySchema } from '@lib/propertySchema';
import { getPluginProperties } from '@lib/pluginHost';
import { searchProperties } from '@lib/propSearch';
import { useScene, findNode } from '@store/sceneStore';
import { useClosing } from '@lib/useClosing';
import { collectAvoidRects, placeOverlay } from '@lib/overlayPlacement';
import { Icon } from './Icon';

// ============================================================================
// BlockCanvas · 画布「中键搜索属性」（v0.4.4g 起 / v0.4.5 第八批重做）
// ----------------------------------------------------------------------------
// 在画布上对某个元素按**鼠标中键** → 弹出搜索框 → 敲属性名 → Enter 定位到右侧面板对应行。
// 支持拼错 / 只敲前几个字母 / 拼音缩写（见 lib/propSearch）。
//
// v0.4.5 第八批（用户反馈，逐条对应）：
//  ①「只有一种蓝色的显示，蓝色的选项就对应选中的选项」
//     → 以前 `.is-best`（权重第一）/ `.is-added`（已添加）/ `.is-active`（当前项）
//       三种状态都在刷蓝底，看起来"第一个蓝、最后一个也蓝、选中的又是另一段蓝"。
//       现在**蓝底只由 `.is-active` 提供**（也就是当前指向的那一项）；
//       "已添加 / 未添加"只体现为右侧小徽章与文字色（绿色系/灰色系），不抢底色。
//  ②「Enter（或左键）是定位，Ctrl+Enter（或 Ctrl+左键）才能添加 —— 这个机制删除了」
//     → 恢复成明确的两档：
//         Enter / 单击        = **只定位**（没添加过就给提示，不偷偷改样式）
//         Ctrl+Enter / Ctrl+单击 = **添加并定位**
//       （v0.4.5 上一版把"没添加就直接加"混进了普通 Enter，用户觉得"机制被删了"。）
//  ③「加入输入属性值预测的功能」
//     → 敲「属性名 + 空格 + 值的前几个字符」即进入**值预测**模式：
//         例：`display fl` → 预测 flex；`width 2` → 预测 240 / 200 之类；
//         例：`align it` → 预测 align-items 的 center / flex-start…。
//       直接点/回车预测值 = 一次性写入「属性名 + 属性值」并定位。
//
// ⚠ 右侧面板的「＋ 添加属性」**不要**这套值搜索机制（用户明确要求只按属性名搜索）。
// ============================================================================

const EXIT_MS = 130;
const MAX_HITS = 6;
const MAX_VALS = 14;

/** 某个属性有哪些"可预测的值"（schema 下拉选项 + 内置常用值预设，去重保序） */
export function predictableValues(item: PropertySchema): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    const s = String(v ?? '').trim();
    if (!s || seen.has(s.toLowerCase())) return;
    seen.add(s.toLowerCase());
    out.push(s);
  };
  for (const o of item.options ?? []) push(o);
  for (const v of NUMBER_PRESETS[item.key] ?? []) push(v);
  return out;
}

/** 值前缀匹配打分：精确 > 前缀 > 包含 */
function scoreValue(v: string, q: string): number {
  if (!q) return 1;
  const n = v.toLowerCase();
  const s = q.toLowerCase();
  if (n === s) return 300;
  if (n.startsWith(s)) return 200;
  if (n.includes(s)) return 120;
  return 0;
}

export function CanvasPropSearch({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number | null }>({ left: x, top: y, maxHeight: null });
  const [activeIdx, setActiveIdx] = useState(0);
  const [activeVal, setActiveVal] = useState(0);
  useEffect(() => { setActiveIdx(0); setActiveVal(0); }, [q]);

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

  // —— 查询解析：`display fl` = 属性名 + 值前缀 ——
  const parts = q.trim().split(/\s+/).filter(Boolean);
  const valueMode = parts.length > 1;
  const propQuery = valueMode ? parts[0] : q;
  const valQuery = valueMode ? parts.slice(1).join(' ') : '';

  const hits = useMemo(
    () => (propQuery.trim() === '' ? [] : searchProperties(all, propQuery).slice(0, MAX_HITS)),
    [all, propQuery]
  );

  const safeIdx = Math.min(Math.max(activeIdx, 0), Math.max(0, hits.length - 1));
  // 值预测针对"当前这一项"：普通模式下就是键盘高亮那条；值模式下固定取权重第一（属性名已敲全）
  const focusItem = valueMode ? hits[0]?.item : hits[safeIdx]?.item;
  const values = useMemo(() => {
    if (!focusItem) return [] as string[];
    return predictableValues(focusItem)
      .map((v) => ({ v, s: scoreValue(v, valQuery) }))
      .filter((it) => it.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_VALS)
      .map((it) => it.v);
  }, [focusItem, valQuery]);

  // 当前选中元素 —— 用来判断每条属性"已经添加到这个元素了吗"
  const scene = useScene((s) => s.scene);
  const selectedId = scene.selectedId;
  const node = selectedId ? findNode(scene.root, selectedId) : null;
  const isAdded = (item: PropertySchema): boolean => {
    if (!node) return false;
    if ((node.visibleProps ?? []).includes(item.key)) return true;
    return hasStyleValue(node.style as unknown as Record<string, string | undefined>, item);
  };

  // 定位：**走统一的浮层避让**（不出窗口、不压住下方元素面板/工具栏），
  // 以前只做了窗口夹取，所以"有些部分会被下方工具栏拦住"。
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
  }, [x, y, q, msg, values.length]);

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

  /** 定位到某条属性；forceAdd（Ctrl）= 顺便把它加进可见列表 */
  const commit = (item: PropertySchema | undefined, forceAdd: boolean) => {
    if (!item) return;
    const added = isAdded(item);
    if (!added && !forceAdd) {
      setMsg(`「${item.label}」还没添加 —— 按 Ctrl+Enter 或按住 Ctrl 点击即可添加并定位。`);
      return;
    }
    // 派发事件：App 负责切到「属性 · 元素」并把请求写进 lib/propFocus 的缓冲，
    // 这样右侧面板停在图层 / 页面 / 类名页时也不会丢（见 Inspector 顶层与 ElementPropsBody）。
    window.dispatchEvent(new CustomEvent('bc:focus-prop', { detail: { key: item.key, add: forceAdd || added } }));
    close();
  };

  /** 值预测命中：一次写入「属性名 + 属性值」并定位（等价于 Ctrl+Enter 添加 + 立即填值） */
  const commitValue = (item: PropertySchema | undefined, raw: string) => {
    if (!item) return;
    const value = presetValue(item, raw);
    window.dispatchEvent(new CustomEvent('bc:focus-prop', {
      detail: { key: item.key, add: true, value }
    }));
    close();
  };

  if (!mounted) return null;

  const best = hits[0]?.item;
  const bestMissing = !!best && !isAdded(best);
  const activeItem = hits[safeIdx]?.item;

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
          placeholder="属性名 → Enter 定位；敲「属性名 值前缀」可预测值"
          onChange={(e) => { setQ(e.target.value); setMsg(null); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const dir = e.key === 'ArrowDown' ? 1 : -1;
              if (valueMode && values.length > 0) {
                setActiveVal((i) => (i + dir + values.length) % values.length);
              } else if (hits.length > 0) {
                setActiveIdx((i) => {
                  const cur = Math.min(Math.max(i, 0), hits.length - 1);
                  return (cur + dir + hits.length) % hits.length;
                });
              }
              setMsg(null);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              // Ctrl（或 Meta，方便 mac）= 添加并定位；裸 Enter = 只定位
              const forceAdd = e.ctrlKey || e.metaKey;
              if (valueMode && values.length > 0) {
                // 值预测模式：写入「属性 + 值」
                const v = values[Math.min(Math.max(activeVal, 0), values.length - 1)];
                commitValue(hits[0]?.item, v);
              } else {
                commit(activeItem, forceAdd);
              }
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
                // 「权重第一」不再用蓝色表示（蓝色只留给当前激活项），改成一个数据标记，
                // 供探针 / 无障碍读取；界面上靠"排在最上面"表达。
                data-best={i === 0 ? '1' : undefined}
                // 单击 = 定位（没添加过只提示）；**Ctrl + 单击 = 添加并定位**
                onClick={(e) => commit(h.item, e.ctrlKey || e.metaKey)}
                onMouseEnter={() => setActiveIdx(i)}
                title={added
                  ? `定位到「${h.item.label}」（Ctrl + 点击 = 重新添加）`
                  : `「${h.item.label}」尚未添加 —— Ctrl + 点击 添加并定位`}
              >
                <span className="bc-prop-search-label">{h.item.label}</span>
                <span className="bc-prop-search-key">{h.item.key}</span>
                <span className="bc-prop-search-badge">{added ? '已添加 · Enter 定位' : '未添加 · Ctrl+Enter 添加'}</span>
              </button>
            );
          })}

          {/* —— 属性值预测（v0.4.5 新增）—— */}
          {focusItem && values.length > 0 && (
            <div className="bc-prop-vals">
              <div className="bc-prop-vals-label">
                {valueMode
                  ? <>值预测 · {focusItem.label} —— ↑↓ 选择，Enter 写入</>
                  : <>{focusItem.label} 的常用值（点一下直接套用，或敲空格后输入值的前几个字符）</>}
              </div>
              {values.map((v, i) => {
                const active = valueMode && i === Math.min(Math.max(activeVal, 0), values.length - 1);
                return (
                  <button
                    key={focusItem.key + '=' + v}
                    className={'bc-prop-val' + (active ? ' is-active' : '')}
                    onMouseEnter={() => setActiveVal(i)}
                    onClick={() => commitValue(focusItem, v)}
                    title={`写入 ${focusItem.key}: ${presetValue(focusItem, v)}`}
                  >{v}</button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {msg && <div className="bc-prop-search-msg">{msg}</div>}
      {q.trim() !== '' && bestMissing && !msg && !valueMode && (
        <div className="bc-prop-search-hint-ctr">
          最匹配的「{best!.label}」尚未添加 · 按住 <kbd>Ctrl</kbd> 再按 <kbd>Enter</kbd> 添加并定位
        </div>
      )}
      <div className="bc-prop-search-hint">
        中键搜索 · ↑↓ 选择 · Enter 定位 · Ctrl+Enter 添加 · 「属性 值」预测 · Esc 关闭
      </div>
    </div>,
    document.body
  );
}