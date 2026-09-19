import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useClosing } from '@lib/useClosing';
import {
  CATALOG_FONTS, GENERIC_FAMILIES, LICENSE_TIP,
  enumerateLocalFonts, licenseOf, loadCustomFonts, saveCustomFonts,
  buildFamilyValue, quoteFamily,
  type FontLicense
} from '@lib/fontCatalog';

// BlockCanvas · 字体选择库（全屏遮罩 + 中央面板）
//
// 三层数据源：
//  · 本机字体：queryLocalFonts 枚举用户电脑上全部字体（主进程已放行 local-fonts 权限）；
//  · 目录字体：内置常见设备字体清单，按公开资料预先标注「可商用 / 商用需注意」
//    （字体文件不携带版权信息，也不联网核实，只能预置标注）；
//  · 通用族 + 自定义：serif 等通用族无版权问题；自定义可登记 @font-face 引入的字体名。
//
// 交互：左侧实时预览（"BlockCanvas积木画布"）+ 右侧字体列表；点击条目加入/移出字体链，
// 字体链 = font-family 回退链（前一个不支持自动换后一个），左侧可调序、删除、应用。

interface Props {
  open: boolean;
  onClose: () => void;
  /** 应用字体链（空串 = 清除 fontFamily） */
  onApply: (value: string) => void;
  /** 当前元素的 font-family 值（用于初始化字体链） */
  initial?: string;
}

const PREVIEW_TEXT = 'BlockCanvas 积木画布';
const PREVIEW_SUB = 'AaBbCc 0123 前端可视化 · 网页工厂';

function splitInitial(initial?: string): string[] {
  if (!initial) return [];
  return initial
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

export function FontPickerModal(props: Props) {
  const { open, onClose, onApply, initial } = props;
  const { mounted, closing } = useClosing(open, 160);

  // —— 数据源 ——
  const [localFonts, setLocalFonts] = useState<string[] | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const [customList, setCustomList] = useState<CustomFont[]>(() => loadCustomFonts());
  useEffect(() => {
    if (!open) return;
    setLocalLoading(true);
    let alive = true;
    enumerateLocalFonts().then((r) => {
      if (!alive) return;
      setLocalFonts(r);
      setLocalLoading(false);
    });
    return () => { alive = false; };
  }, [open]);

  // —— 字体链 ——
  const [chain, setChain] = useState<string[]>(() => splitInitial(initial));
  useEffect(() => {
    if (open) setChain(splitInitial(initial));
  }, [open, initial]);

  // —— 过滤 ——
  const [kw, setKw] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);

  const toggleChain = (name: string) => {
    setChain((prev) =>
      prev.some((x) => x.toLowerCase() === name.toLowerCase())
        ? prev.filter((x) => x.toLowerCase() !== name.toLowerCase())
        : [...prev, name]
    );
  };
  // —— 字体链拖拽排序（HTML5 DnD，垂直方向，上半=插到前面 / 下半=插到后面） ——
  const [chainDrag, setChainDrag] = useState<string | null>(null);
  const [chainDrop, setChainDrop] = useState<{ name: string; before: boolean } | null>(null);
  const chainDragProps = (name: string) => ({
    draggable: true,
    onDragStart: () => setChainDrag(name),
    onDragEnd: () => { setChainDrag(null); setChainDrop(null); },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (!chainDrag || chainDrag === name) return;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setChainDrop({ name, before: e.clientY < r.top + r.height / 2 });
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (chainDrag && chainDrop && chainDrag !== chainDrop.name) {
        setChain((prev) => {
          const from = prev.findIndex((x) => x === chainDrag);
          if (from < 0) return prev;
          const next = [...prev];
          next.splice(from, 1);
          const to = next.findIndex((x) => x === chainDrop.name);
          if (to < 0) return prev;
          next.splice(chainDrop.before ? to : to + 1, 0, chainDrag);
          return next;
        });
      }
      setChainDrag(null);
      setChainDrop(null);
    }
  });
  const applyNow = () => {
    onApply(chain.length ? buildFamilyValue(chain) : '');
    onClose();
  };

  // —— 自定义字体 ——
  const [addingCustom, setAddingCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const addCustom = () => {
    const name = customName.trim();
    if (!name) return;
    if (customList.some((c) => c.name.toLowerCase() === name.toLowerCase())) return;
    const next = [{ name, license: 'unknown' as FontLicense }, ...customList];
    setCustomList(next);
    saveCustomFonts(next);
    setCustomName('');
  };
  const removeCustom = (name: string) => {
    const next = customList.filter((c) => c.name !== name);
    setCustomList(next);
    saveCustomFonts(next);
    setChain((prev) => prev.filter((x) => x.toLowerCase() !== name.toLowerCase()));
  };

  // —— 列表组装（搜索 + 许可过滤 + 分组去重） ——
  const kwL = kw.trim().toLowerCase();
  const matchKw = (name: string, zh?: string) =>
    !kwL || name.toLowerCase().includes(kwL) || (zh ?? '').toLowerCase().includes(kwL);
  const matchLicense = (l: FontLicense) => !freeOnly || l === 'free' || l === 'generic';

  const localSet = useMemo(() => new Set((localFonts ?? []).map((s) => s.toLowerCase())), [localFonts]);
  const inChain = (name: string) => chain.some((x) => x.toLowerCase() === name.toLowerCase());

  const groups: Array<{ title: string; hint?: string; items: Array<{ name: string; zh?: string; license: FontLicense; removable?: boolean }> }> = [];
  if (localFonts) {
    const items = localFonts
      .filter((n) => matchKw(n) && matchLicense(licenseOf(n)))
      .map((name) => ({ name, zh: undefined as string | undefined, license: licenseOf(name) }));
    groups.push({ title: `本机字体（${localFonts.length}）`, hint: '你电脑上安装的全部字体', items });
  }
  {
    const items = CATALOG_FONTS
      .filter((f) => !(localFonts && localSet.has(f.name.toLowerCase())))
      .filter((f) => matchKw(f.name, f.zh) && matchLicense(f.license))
      .map((f) => ({ name: f.name, zh: f.zh, license: f.license }));
    groups.push({
      title: localFonts ? `更多目录字体（${items.length}）` : `常见字体目录（${items.length}）`,
      hint: localFonts ? '预置清单里、本机未安装的字体（访客设备有则显示，没有则自动降级）' : 'Windows / macOS / Linux 常见设备字体 + 免费商用字体（按公开资料预标注）',
      items
    });
  }
  {
    const items = GENERIC_FAMILIES
      .filter((f) => matchKw(f.name, f.zh) && matchLicense(f.license))
      .map((f) => ({ name: f.name, zh: f.zh, license: f.license }));
    groups.push({ title: '通用字体族', items });
  }
  {
    const items = customList
      .filter((c) => matchKw(c.name, c.zh))
      .map((c) => ({ name: c.name, zh: c.zh, license: c.license, removable: true }));
    if (customList.length > 0 || addingCustom) {
      groups.push({ title: '我的自定义字体', hint: '登记通过 @font-face 引入的字体名', items });
    }
  }

  if (!mounted) return null;

  // ⚠ 必须 Portal 到 body：属性面板的折叠动画（Collapse）等祖先带 transform，
  // 会把 position:fixed 的包含块劫持到面板内部 —— 全屏遮罩就会"显示在菜单里面"。
  // （与调色盘 cp-backdrop 同一套教训。）
  return createPortal(
    <div
      className={'bc-mask fp-mask' + (closing ? ' is-closing' : '')}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => {
        // Esc 只关弹窗，不冒泡到全局快捷键（否则会顺手取消画布选中）
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      }}
    >
      <div className={'bc-pop fp-modal' + (closing ? ' is-closing' : '')} onClick={(e) => e.stopPropagation()}>
        {/* —— 头部 —— */}
        <div className="fp-head">
          <span className="fp-title">字体库</span>
          <span className="fp-sub">点击字体加入右侧字体链：排在前面的优先生效，不支持时自动换下一个</span>
          <button className="fp-close" onClick={onClose} title="关闭">×</button>
        </div>

        {/* —— 工具行 —— */}
        <div className="fp-toolbar">
          <input
            className="fp-search"
            type="text"
            placeholder="搜索字体名（支持中英文）"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
          />
          <button
            className={'fp-filter-chip' + (freeOnly ? ' active' : '')}
            onClick={() => setFreeOnly((v) => !v)}
            title="只看「可商用」与「通用族」字体"
          >✓ 只看可商用</button>
          {localLoading && <span className="fp-loading">正在读取本机字体…</span>}
          {!localLoading && !localFonts && (
            <span className="fp-loading" title="本机字体清单需要系统授权，本次未获取——已展示常见字体目录">未获取本机字体清单（需要系统授权）</span>
          )}
        </div>

        {/* —— 主体：左预览 + 右列表 —— */}
        <div className="fp-body">
          {/* 左：预览 + 字体链 */}
          <div className="fp-preview-pane">
            <div
              className="fp-preview-main"
              style={{ fontFamily: chain.length ? buildFamilyValue([chain[0]]) : undefined }}
            >{PREVIEW_TEXT}</div>
            <div
              className="fp-preview-sub"
              style={{ fontFamily: chain.length ? buildFamilyValue([chain[0]]) : undefined }}
            >{PREVIEW_SUB}</div>

            <div className="fp-chain-title">字体链（font-family 回退顺序 · 拖动调整优先级）</div>
            {chain.length === 0 && (
              <div className="fp-chain-empty">还没有选择字体。点右侧任意字体加入，排在前面的优先。</div>
            )}
            <div className="fp-chain">
              {chain.map((name, i) => (
                <div
                  key={name + i}
                  className={
                    'fp-chain-item' +
                    (chainDrag === name ? ' is-dragging' : '') +
                    (chainDrop?.name === name ? (chainDrop.before ? ' is-drop-before' : ' is-drop-after') : '')
                  }
                  {...chainDragProps(name)}
                  title="按住拖动调整优先级（排前面优先生效）"
                >
                  <span className="fp-chain-grip">⠿</span>
                  <span className="fp-chain-order">{i === 0 ? '主字体' : `备选 ${i}`}</span>
                  <span className="fp-chain-name">{name}</span>
                  <span className="fp-chain-lic" data-lic={licenseOf(name)}>
                    {licenseOf(name) === 'unknown' ? '？' : licenseOf(name) === 'free' ? '✓' : licenseOf(name) === 'generic' ? 'ℹ' : '⚠'}
                  </span>
                  <button className="fp-chain-btn fp-chain-del" title="移出字体链" onClick={() => setChain((p) => p.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>

            <div className="fp-preview-foot">
              <div className="fp-hint">
                想用网络字体或字体文件？在右侧面板「页面」页签的高级 CSS 里写
                <code>@font-face</code> 声明，然后在这里把字体名登记为自定义字体即可选用。
              </div>
              <button className="btn-primary fp-apply" onClick={applyNow} disabled={chain.length === 0}>
                应用到元素
              </button>
            </div>
          </div>

          {/* 右：字体列表 */}
          <div className="fp-list">
            {groups.map((g) => (
              <div key={g.title} className="fp-group">
                <div className="fp-group-title" title={g.hint}>
                  {g.title}
                  {g.hint && <span className="fp-group-hint">{g.hint}</span>}
                </div>
                {g.items.length === 0 && <div className="fp-group-empty">（无匹配项）</div>}
                {g.items.map((it) => {
                  const selected = inChain(it.name);
                  return (
                    <button
                      key={g.title + it.name}
                      className={'fp-item' + (selected ? ' selected' : '')}
                      onClick={() => toggleChain(it.name)}
                      title={`${it.name}\n${it.zh ? it.zh + '\n' : ''}${LICENSE_TIP[it.license]}${selected ? '\n（已在字体链中，再次点击移除）' : ''}`}
                    >
                      <span className="fp-item-preview" style={{ fontFamily: `${quoteFamily(it.name)}, sans-serif` }}>
                        {PREVIEW_TEXT} Aa
                      </span>
                      <span className="fp-item-meta">
                        <span className="fp-item-name">{it.name}</span>
                        {it.zh && <span className="fp-item-zh">{it.zh}</span>}
                      </span>
                      <span className={'fp-badge lic-' + it.license}>
                        {it.license === 'free' ? '✓ 可商用' : it.license === 'restricted' ? '⚠ 需注意' : it.license === 'generic' ? 'ℹ 通用' : '？未收录'}
                      </span>
                      {it.removable && (
                        <span
                          className="fp-item-del"
                          role="button"
                          title="从自定义字体中删除"
                          onClick={(e) => { e.stopPropagation(); removeCustom(it.name); }}
                        >×</span>
                      )}
                      {selected && <span className="fp-item-check">✓</span>}
                    </button>
                  );
                })}
              </div>
            ))}

            {/* —— 添加自定义字体 —— */}
            <div className="fp-custom-add">
              {addingCustom ? (
                <div className="fp-custom-form">
                  <input
                    autoFocus
                    type="text"
                    className="fp-custom-input"
                    placeholder="字体名（需与 @font-face 声明或系统内名称一致）"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addCustom();
                      if (e.key === 'Escape') setAddingCustom(false);
                    }}
                  />
                  <button className="btn-mini" onClick={addCustom}>登记</button>
                  <button className="btn-mini" onClick={() => setAddingCustom(false)}>取消</button>
                </div>
              ) : (
                <button className="fp-custom-btn" onClick={() => setAddingCustom(true)}>＋ 登记自定义字体（@font-face / 手动输入）</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

type CustomFont = ReturnType<typeof loadCustomFonts>[number];
