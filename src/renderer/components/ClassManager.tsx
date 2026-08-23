import { useEffect, useMemo, useRef, useState } from 'react';
import { useScene } from '@store/sceneStore';
import { styleToCssText, simplifyStyle, cssTextToObject } from '@lib/styleClass';
import type { SceneElement, ElementStyle } from '@lib/types';

// BlockCanvas · 「类名 / ID 管理」（4-F 版2）
// 选择器重构之后：类名 = 一种样子（编辑任意一个同类元素 → 全部自动统一，见 store.updateStyle）。
// 这里承担两类事情：
//  1. 总览所有类名 / ID：每个名称一行（样式摘要 + 元素数 + 「样式不统一」标记）
//  2. 单独调整某个名称的样式：表单模式（推荐，属性行）或源码模式（CSS 文本），
//     保存后 unifyClassName 全量写回 → 所有同名元素一步统一（一条撤销）
//  3. 未命名（行内样式）元素列表：点击可选中定位，方便后续起名

type ClsGroup = {
  name: string;
  kind: 'class' | 'id';
  count: number;
  elems: SceneElement[];
  cssText: string;
  conflicted: boolean;
};

const COMMON_KEYS = [
  'width', 'height', 'backgroundColor', 'color', 'fontSize', 'fontWeight',
  'textAlign', 'lineHeight', 'padding', 'margin', 'borderWidth', 'borderStyle',
  'borderColor', 'borderRadius', 'boxShadow', 'display', 'flexDirection',
  'justifyContent', 'alignItems', 'gap', 'position', 'top', 'right', 'bottom', 'left',
  'opacity', 'cursor', 'minHeight', 'maxWidth', 'boxSizing', 'overflow'
];

export function ClassManager() {
  const scene = useScene((s) => s.scene);
  const selectElement = useScene((s) => s.selectElement);
  const [editing, setEditing] = useState<{ name: string; kind: 'class' | 'id' } | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const tipTimer = useRef(0);

  const { groups, unnamed } = useMemo(() => {
    const gmap = new Map<string, ClsGroup>();
    const unnamedList: { id: string; type: string }[] = [];
    const walk = (n: SceneElement): void => {
      // 根节点是画布容器，不参与类名/ID 管理（否则总会出现一个未命名）
      if (n.id !== scene.root.id) {
        const cls = (n.attrs?.className ?? '').trim();
        const idv = (n.attrs?.id ?? '').trim();
        const keyOf = (kind: 'class' | 'id', name: string) => kind + ':' + name;
        const pushTo = (kind: 'class' | 'id', name: string) => {
          const key = keyOf(kind, name);
          let g = gmap.get(key);
          if (!g) {
            g = { name, kind, count: 0, elems: [], cssText: '', conflicted: false };
            gmap.set(key, g);
          }
          g.elems.push(n);
          return g;
        };
        if (cls) {
          // 一组 = 完整 classString（如 .card.big 视为一体，规则也是拆开的，但管理按组合展示）
          const g = pushTo('class', cls);
          g.count = g.elems.length;
          g.cssText = styleToCssText(simplifyStyle(n.style));
        } else if (idv) {
          const g = pushTo('id', idv);
          g.count = g.elems.length;
          g.cssText = styleToCssText(simplifyStyle(n.style));
        } else {
          unnamedList.push({ id: n.id, type: n.type });
        }
      }
      for (const c of n.children) walk(c);
    };
    walk(scene.root);
    // 冲突标记：同名称下样式文本不一致
    for (const g of gmap.values()) {
      const texts = new Set(g.elems.map((e) => styleToCssText(simplifyStyle(e.style))));
      g.conflicted = texts.size > 1;
    }
    return { groups: [...gmap.values()], unnamed: unnamedList };
  }, [scene.root]);

  const showTip = (msg: string) => {
    setTip(msg);
    window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => setTip(null), 4000);
  };

  useEffect(() => () => window.clearTimeout(tipTimer.current), []);

  return (
    <div className="cls-mgr">
      <div className="panel-title">类名 · ID 管理</div>
      <div className="hint" style={{ marginBottom: 8 }}>
        给元素起的类名/ID 就像「一套衣服」：改任意一个元素的样式，同名的会一起变（编辑即统一）。
        这里能总览全部名称、一键统一或调整。
      </div>

      {tip && <div className="cls-tip">{tip}</div>}

      {editing ? (
        <ClsEditor
          group={groups.find((g) => g.name === editing.name && g.kind === editing.kind) ?? null}
          onBack={() => setEditing(null)}
          onSaved={(n) => showTip(`已应用到 ${n} 个元素`)}
        />
      ) : (
        <>
          {/* 未命名列表 */}
          {unnamed.length > 0 && (
            <div className="cls-unnamed">
              <div className="cls-block-head">
                {unnamed.length} 个元素没有类名 / ID（样式用行内方式，建议起个名字）
              </div>
              {unnamed.slice(0, 10).map((u) => (
                <button
                  key={u.id}
                  className="cls-unnamed-item"
                  onClick={() => selectElement(u.id)}
                  title="点此在画布选中它"
                >&lt;{u.type}&gt; 选中</button>
              ))}
              {unnamed.length > 10 && <div className="cls-more">…还有 {unnamed.length - 10} 个</div>}
            </div>
          )}
          {unnamed.length === 0 && (
            <div className="cls-unnamed">
              <div className="cls-block-head" style={{ color: '#2e7d32' }}>✓ 元素都起了名字，没有行内样式元素</div>
            </div>
          )}

          {/* 名称列表 */}
          {groups.length === 0 && (
            <div className="hint">还没有类名 / ID。在「元素 → HTML 属性 → 类名 / ID」里给元素起名后，会出现在这里。</div>
          )}
          {groups.map((g) => (
            <div key={g.kind + ':' + g.name} className={'cls-card' + (g.conflicted ? ' conflicted' : '')}>
              <div className="cls-card-head">
                <span className="cls-card-name">{g.kind === 'id' ? '#' + g.name : '.' + g.name}</span>
                <span className="cls-card-meta">{g.count} 个元素</span>
                {g.conflicted && (
                  <span className="cls-badge" title="同名元素样式不一致，编辑任意一个或点「调整」统一">样式不统一</span>
                )}
              </div>
              <div className="cls-card-summary" title={g.cssText}>{g.cssText || '（无样式内容）'}</div>
              <div className="cls-card-actions">
                <button className="btn-mini" onClick={() => setEditing({ name: g.name, kind: g.kind })}>调整样式</button>
                <button className="btn-mini" onClick={() => selectElement(g.elems[0]?.id ?? null)} title="选中这类元素（第一个）">选中</button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ============ 单名称样式编辑器（表单 / 源码两种模式） ============
function ClsEditor(props: {
  group: ClsGroup | null;
  onBack: () => void;
  onSaved: (n: number) => void;
}) {
  const { group, onBack, onSaved } = props;
  const unifyClassName = useScene((s) => s.unifyClassName);
  const [mode, setMode] = useState<'form' | 'src'>('form');
  // 表单模式：键值行列表；源码模式：CSS 声明文本
  const [rows, setRows] = useState<{ key: string; value: string }[]>([]);
  const [srcText, setSrcText] = useState('');

  // 进入时用该组第一个元素的样式初始化
  useEffect(() => {
    if (!group || group.elems.length === 0) return;
    const style = group.elems[0].style as Record<string, string | undefined>;
    const initRows = Object.entries(style)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => ({ key: k, value: v ?? '' }));
    setRows(initRows);
    setSrcText(styleToCssText(simplifyStyle(group.elems[0].style)));
  }, [group]);

  if (!group) {
    return (
      <div>
        <div className="hint">该名称不存在了。</div>
        <button className="btn-mini" onClick={onBack}>← 返回列表</button>
      </div>
    );
  }

  const styleFromRows = (): ElementStyle => {
    const out: Record<string, string> = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (k && r.value.trim() !== '') out[k] = r.value.trim();
    }
    return out;
  };

  const save = () => {
    let styleObj: ElementStyle;
    if (mode === 'form') {
      styleObj = styleFromRows();
    } else {
      const parsed = cssTextToObject(srcText);
      styleObj = parsed;
    }
    const n = group.elems.length;
    unifyClassName(group.name, styleObj);
    onSaved(n);
    onBack();
  };

  const setRow = (i: number, patch: Partial<{ key: string; value: string }>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  return (
    <div className="cls-editor">
      <div className="cls-editor-head">
        <button className="btn-mini" onClick={onBack}>← 返回</button>
        <span className="cls-editor-title">
          {group.kind === 'id' ? '#' + group.name : '.' + group.name}
          <span className="cls-editor-meta">{group.count} 个元素</span>
        </span>
        <div className="cls-mode-switch">
          <button
            className={"btn-mini" + (mode === 'form' ? ' active' : '')}
            onClick={() => setMode('form')}
          >表单</button>
          <button
            className={"btn-mini" + (mode === 'src' ? ' active' : '')}
            onClick={() => setMode('src')}
          >源码</button>
        </div>
      </div>

      <div className="hint" style={{ margin: '0 0 8px' }}>
        保存后会把这套样式应用到全部 {group.count} 个元素（一次撤销）。
      </div>

      {mode === 'form' ? (
        <div className="cls-form">
          {rows.map((r, i) => (
            <div className="cls-form-row" key={i}>
              <input
                className="cls-form-key"
                list="cls-key-list"
                placeholder="属性，如 width"
                value={r.key}
                spellCheck={false}
                onChange={(e) => setRow(i, { key: e.target.value })}
              />
              <input
                className="cls-form-val"
                placeholder="值，如 300px"
                value={r.value}
                spellCheck={false}
                onChange={(e) => setRow(i, { value: e.target.value })}
              />
              <button className="cls-form-del" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}>×</button>
            </div>
          ))}
          <datalist id="cls-key-list">
            {COMMON_KEYS.map((k) => <option key={k} value={k} />)}
          </datalist>
          <button className="btn-mini" onClick={() => setRows((prev) => [...prev, { key: '', value: '' }])}>＋ 加属性</button>
        </div>
      ) : (
        <textarea
          className="cls-src"
          placeholder={'width: 300px;\nbackground-color: #d4e7ff;\n'}
          value={srcText}
          spellCheck={false}
          onChange={(e) => setSrcText(e.target.value)}
        />
      )}

      <div className="cls-editor-actions">
        <button className="btn-mini" onClick={onBack}>取消</button>
        <button className="btn-primary btn-mini" onClick={save}>保存并应用</button>
      </div>
    </div>
  );
}