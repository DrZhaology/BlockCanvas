import { useState, useEffect, useRef } from 'react';
import { SCHEMA } from '@lib/propertySchema';
import type { PropertySchema, PropertyCategory } from '@lib/propertySchema';
import type { ElementType } from '@lib/types';

// BlockCanvas · "+ 添加属性"下拉
// - 按类别分组展示；顶部搜索框支持中英文（中文名 / 英文 key / 类别 / 4 边 key）
// - 搜索时扁平化展示，每个条目右侧标注类别
// - 已添加项不在下拉里出现；Escape / 点外部关闭

interface Props {
  type: ElementType;
  visibleKeys: string[];      // 已显示的属性 key 列表（含 width/height 默认）
  onAdd: (key: string) => void;
}

const CATEGORY_ORDER: PropertyCategory[] = [
  '盒模型', '颜色', '字体', '边框', '阴影', '定位', 'Flex 布局', '其他'
];

export function AddPropertyMenu(props: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // 打开菜单：清空搜索并聚焦搜索框
  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const q = search.trim().toLowerCase();

  const matches = (s: PropertySchema): boolean => {
    if (!q) return true;
    const camelDash = s.key.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase());
    const sideKeys = (s.sides ?? []).map((sd) => sd.key).join(' ');
    const hay =
      `${s.label} ${s.key} ${camelDash} ${sideKeys} ${s.category}`.toLowerCase();
    return hay.includes(q);
  };

  // 候选 = 该元素还没显示的属性（不随搜索词变化，决定按钮是否可点）
  const baseCandidates = SCHEMA.filter((s) => {
    if (!isApplicableForType(s, props.type)) return false;
    if (props.visibleKeys.includes(s.key)) return false;
    return true;
  });
  // 当前搜索词过滤后的展示列表（空搜索词 = 全部）
  const candidates = q ? baseCandidates.filter(matches) : baseCandidates;

  // 按类别分组（无搜索时）
  const grouped: Record<PropertyCategory, PropertySchema[]> = {
    '盒模型': [], '颜色': [], '字体': [], '边框': [], '阴影': [], '定位': [], 'Flex 布局': [], '其他': []
  };
  for (const c of candidates) grouped[c.category].push(c);

  const addAndClose = (key: string) => {
    props.onAdd(key);
    setSearch(''); // 清掉搜索词，避免残留导致下次按钮误判为无候选
    setOpen(false);
  };

  return (
    <div className="add-prop-wrap">
      <button
        className="add-prop-trigger"
        onClick={() => setOpen(!open)}
        disabled={baseCandidates.length === 0 && !open}
        title="添加 CSS 属性"
      >
        + 添加属性 {open ? '▴' : '▾'}
      </button>
      {open && (
        <>
          <div className="add-prop-backdrop" onClick={() => setOpen(false)} />
          <div className="add-prop-menu">
            <div className="add-prop-search">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索属性：中文 / English（如：圆角、margin）"
              />
              {search && (
                <button className="add-prop-search-clear" onClick={() => { setSearch(''); searchRef.current?.focus(); }}>×</button>
              )}
            </div>
            <div className="add-prop-scroll">
              {candidates.length === 0 && (
                <div className="add-prop-empty">没有匹配的属性</div>
              )}
              {q ? (
                // 搜索态：扁平列表 + 右侧类别小标
                candidates.map((s) => (
                  <button
                    key={s.key}
                    className="add-prop-item"
                    onClick={() => addAndClose(s.key)}
                    title={s.help ? s.help.title : s.label}
                  >
                    <span className="add-prop-item-label">{s.label}</span>
                    <span className="add-prop-item-cat">{s.category}</span>
                  </button>
                ))
              ) : (
                // 分组态
                CATEGORY_ORDER.map((cat) => {
                  if (grouped[cat].length === 0) return null;
                  return (
                    <div key={cat} className="add-prop-group">
                      <div className="add-prop-group-title">{cat}</div>
                      {grouped[cat].map((s) => (
                        <button
                          key={s.key}
                          className="add-prop-item"
                          onClick={() => addAndClose(s.key)}
                          title={s.help ? s.help.title : s.label}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function isApplicableForType(s: PropertySchema, type: ElementType): boolean {
  if (!s.excludeTypes) return true;
  return !s.excludeTypes.includes(type);
}