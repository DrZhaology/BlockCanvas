import { useState, useEffect, useRef } from 'react';
import { SCHEMA, checkApplicability } from '@lib/propertySchema';
import type { PropertySchema, PropertyCategory } from '@lib/propertySchema';
import type { ElementType } from '@lib/types';
import { getPluginProperties } from '@lib/pluginHost';

// BlockCanvas · "+ 添加属性"下拉
// - 按类别分组展示；顶部搜索框支持中英文（中文名 / 英文 key / 类别 / 4 边 key）
// - 动态检测适用性：对当前不适用的属性置灰显示并标注原因（如行内元素不能设外边距等）
// - 统一对齐：左侧统一 [父]/[子] 标识占位与属性名，右侧展示类别与不生效提示

interface Props {
  type: ElementType;
  elementStyle?: Record<string, string | undefined>;
  visibleKeys: string[];      // 已显示的属性 key 列表
  onAdd: (key: string) => void;
}

const CATEGORY_ORDER: PropertyCategory[] = [
  '盒模型', '颜色', '字体与排版', '边框与阴影', '列表', '多媒体', '定位', 'Flex & Grid 布局', '其他'
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
    const hay = `${s.label} ${s.key} ${camelDash} ${sideKeys} ${s.category} ${s.placeholder ?? ''}`.toLowerCase();
    return hay.includes(q);
  };

  // 候选 = 该元素还没显示的属性（含插件扩展属性）
  const allSchema = [...SCHEMA, ...getPluginProperties()];
  const baseCandidates = allSchema.filter((s) => !props.visibleKeys.includes(s.key));
  // 搜索过滤后的展示列表
  const candidates = q ? baseCandidates.filter(matches) : baseCandidates;

  // 按类别分组
  const grouped: Record<PropertyCategory, PropertySchema[]> = {
    '盒模型': [], '颜色': [], '字体与排版': [], '边框与阴影': [], '列表': [], '多媒体': [], '定位': [], 'Flex & Grid 布局': [], '其他': []
  };
  for (const c of candidates) {
    if (grouped[c.category]) grouped[c.category].push(c);
    else (grouped['其他'] = grouped['其他'] || []).push(c);
  }

  const addAndClose = (key: string) => {
    props.onAdd(key);
    setSearch('');
    setOpen(false);
  };

  const renderItem = (s: PropertySchema) => {
    const app = checkApplicability(s, props.type, props.elementStyle);
    return (
      <button
        key={s.key}
        className={"add-prop-item" + (!app.applicable ? " is-disabled" : "")}
        onClick={() => { if (app.applicable) addAndClose(s.key); }}
        disabled={!app.applicable}
        title={!app.applicable ? `暂不可用: ${app.disabledReason}` : s.help ? `${s.label}\n${s.help.content}` : s.label}
      >
        <div className="add-prop-item-left">
          {s.scope ? (
            <span className="prop-scope" title={s.scope === '父' ? '作用在父容器上，管子元素排布' : '作用在自身/子元素上'}>{s.scope}</span>
          ) : (
            <span className="prop-scope-space" />
          )}
          <span className="add-prop-item-label">{s.label}</span>
        </div>
        <div className="add-prop-item-right">
          {!app.applicable && <span className="add-prop-disabled-tag" title={app.disabledReason}>不生效</span>}
          {q && <span className="add-prop-item-cat">{s.category}</span>}
        </div>
      </button>
    );
  };

  return (
    <div className="add-prop-wrap">
      <button
        className="add-prop-trigger"
        onClick={() => setOpen(!open)}
        disabled={baseCandidates.length === 0 && !open}
        title="添加 CSS 样式属性"
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
                placeholder="搜索属性：中文 / CSS 名（如：过渡、圆角、border、wrap）"
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
                candidates.map((s) => renderItem(s))
              ) : (
                CATEGORY_ORDER.map((cat) => {
                  if (!grouped[cat] || grouped[cat].length === 0) return null;
                  return (
                    <div key={cat} className="add-prop-group">
                      <div className="add-prop-group-title">{cat}</div>
                      {grouped[cat].map((s) => renderItem(s))}
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
