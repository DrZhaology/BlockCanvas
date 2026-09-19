import { useMemo, useState } from 'react';
import { useScene } from '@store/sceneStore';
import {
  DEFAULT_TOKENS, TOKEN_GROUPS, cssVarName, tokenRef,
  isValidTokenName, uniqueTokenName, groupTokens,
  type TokenEntry, type TokenGroup
} from '@lib/designTokens';
import { ColorField } from './ColorPicker';
import { HelpButton } from './HelpButton';

// BlockCanvas · 设计变量（Token）面板
//
// 「主色」只定义一次 → 元素里写 var(--bc-primary) → 改这一处，全站一起变。
// 导出时这些变量会写进 <style> 最前面的 :root{...}，脱离本软件同样生效。

const NEW_TOKEN_TEMPLATE: Record<TokenGroup, Omit<TokenEntry, 'name'>> = {
  '颜色': { value: '#1e88e5', group: '颜色', kind: 'color' },
  '圆角': { value: '12px', group: '圆角', kind: 'size' },
  '间距': { value: '16px', group: '间距', kind: 'size' },
  '文字': { value: '16px', group: '文字', kind: 'size' },
  '阴影': { value: '0 4px 16px rgba(0, 0, 0, 0.08)', group: '阴影', kind: 'shadow' }
};

export function TokenPanel() {
  const tokens = useScene((s) => s.scene.tokens);
  const setTokens = useScene((s) => s.setTokens);
  const root = useScene((s) => s.scene.root);

  const [editingName, setEditingName] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState<TokenGroup>('颜色');

  const list: TokenEntry[] = useMemo(
    () => (tokens && tokens.length > 0 ? tokens : []),
    [tokens]
  );
  const grouped = useMemo(() => groupTokens(list), [list]);

  /** 统计每个变量被多少条样式引用（只在元素 style 与伪类里找 var(--bc-x)） */
  const usage = useMemo(() => {
    const map = new Map<string, number>();
    const scanValue = (v: unknown) => {
      if (typeof v !== 'string') return;
      const re = /var\(\s*--bc-([^)\s]+)\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(v))) {
        const n = m[1];
        map.set(n, (map.get(n) ?? 0) + 1);
      }
    };
    const walk = (n: { style?: Record<string, unknown>; pseudoStyles?: Record<string, Record<string, unknown>>; children?: unknown[] }) => {
      if (n.style) for (const v of Object.values(n.style)) scanValue(v);
      if (n.pseudoStyles) {
        for (const st of Object.values(n.pseudoStyles)) {
          for (const v of Object.values(st)) scanValue(v);
        }
      }
      for (const c of (n.children ?? [])) walk(c as typeof n);
    };
    walk(root as unknown as Parameters<typeof walk>[0]);
    return map;
  }, [root]);

  const commit = (next: TokenEntry[]) => setTokens(next);

  const changeValue = (name: string, value: string) => {
    commit(list.map((t) => (t.name === name ? { ...t, value } : t)));
  };

  const rename = (oldName: string, nextName: string) => {
    const clean = nextName.trim();
    if (!clean || clean === oldName) { setEditingName(null); return; }
    if (!isValidTokenName(clean)) {
      alert('变量名只能用小写字母开头，且只包含小写字母、数字和连字符（例如 primary、bg-soft）。');
      return;
    }
    if (list.some((t) => t.name === clean)) {
      alert(`已经有一个叫「${clean}」的变量了，换一个名字。`);
      return;
    }
    // 改名要连带把已写进样式里的 var(--bc-old) 一起换掉，否则引用会断
    const oldRef = tokenRef(oldName);
    const newRef = tokenRef(clean);
    const replaceIn = (obj: Record<string, string>): [Record<string, string>, boolean] => {
      const out: Record<string, string> = { ...obj };
      let changed = false;
      for (const [k, v] of Object.entries(out)) {
        if (typeof v === 'string' && v.includes(oldRef)) {
          out[k] = v.split(oldRef).join(newRef);
          changed = true;
        }
      }
      return [out, changed];
    };
    const st = useScene.getState();
    st.beginStyleEdit();
    commit(list.map((t) => (t.name === oldName ? { ...t, name: clean } : t)));
    const walkPatch = (n: any): void => {
      if (n.style) {
        const [next, changed] = replaceIn(n.style);
        if (changed) st.updateStyle(n.id, next as any);
      }
      if (n.pseudoStyles) {
        for (const [pseudo, styleObj] of Object.entries<any>(n.pseudoStyles)) {
          const [next, changed] = replaceIn(styleObj ?? {});
          if (changed) st.updatePseudoStyle(n.id, pseudo, next);
        }
      }
      for (const c of n.children ?? []) walkPatch(c);
    };
    walkPatch(useScene.getState().scene.root);
    st.endStyleEdit();
    setEditingName(null);
  };

  const remove = (name: string) => {
    const used = usage.get(name) ?? 0;
    const msg = used > 0
      ? `还有 ${used} 处样式在引用 var(--bc-${name})。\n删除后这些地方会失去颜色/数值（浏览器按无效值处理）。\n\n确定删除吗？`
      : `确定删除变量 --bc-${name} 吗？`;
    if (!confirm(msg)) return;
    commit(list.filter((t) => t.name !== name));
  };

  const addToken = () => {
    const base = newName.trim() || newGroup === '颜色' ? newName.trim() || 'brand' : 'size';
    const name = uniqueTokenName(base, list);
    const tpl = NEW_TOKEN_TEMPLATE[newGroup];
    commit([...list, { name, ...tpl }]);
    setNewName('');
    setAddOpen(false);
  };

  // v0.4.5：展开「这个变量被哪些元素引用」，点击可在画布上定位闪烁
  const [expandedUsage, setExpandedUsage] = useState<string | null>(null);
  const usageNodes = useMemo(() => {
    const map = new Map<string, Array<{ id: string; type: string; text?: string }>>();
    const scan = (id: string, type: string, text: string | undefined, v: unknown) => {
      if (typeof v !== 'string') return;
      for (const t of list) {
        if (v.includes(tokenRef(t.name))) {
          const arr = map.get(t.name) ?? [];
          if (!arr.some((x) => x.id === id)) arr.push({ id, type, text: text?.slice(0, 20) });
          map.set(t.name, arr);
        }
      }
    };
    const walk = (n: any) => {
      if (n.id && n.id !== 'root') {
        if (n.style) for (const v of Object.values(n.style as Record<string, unknown>)) scan(n.id, n.type, n.text, v);
        if (n.pseudoStyles) {
          for (const st of Object.values(n.pseudoStyles as Record<string, Record<string, unknown>>)) {
            for (const v of Object.values(st)) scan(n.id, n.type, n.text, v);
          }
        }
      }
      for (const c of (n.children ?? [])) walk(c);
    };
    walk(root);
    return map;
  }, [root, list]);

  const resetDefaults = () => {
    if (!confirm('把变量列表恢复成默认的一套（主色 / 文字色 / 圆角 / 间距 / 阴影）？\n当前自定义的会被覆盖。')) return;
    commit(DEFAULT_TOKENS.map((t) => ({ ...t })));
  };

  const clearAll = () => {
    if (!confirm('清空全部变量？已经写了 var(--bc-*) 的样式会失效。')) return;
    commit([]);
  };

  return (
    <div className="panel-body token-panel">
      <div className="token-head">
        <div>
          <div className="token-head-title">
            设计变量
            <HelpButton
              title="设计变量是什么？"
              content={
                '【一句话】把「主色、圆角、间距」这类会反复用到的值定义成一个名字，之后所有元素都引用这个名字。\n\n' +
                '【为什么值得用】\n' +
                '· 改一处，全站跟着变：把 --bc-primary 从蓝改成绿，所有用了主色的按钮、标题、链接一起变。\n' +
                '· 导出的网页同样带着 :root 定义，不是"只在软件里有效"。\n\n' +
                '【怎么用】\n' +
                '· 在下面改变量的值 —— 画布会立刻跟着变。\n' +
                '· 在任意颜色输入框里点「变量」页签的色块，就会写入 var(--bc-primary) 而不是写死颜色。\n' +
                '· 变量名只能用小写字母 / 数字 / 连字符，改名时已引用的地方会自动跟着改。'
              }
            />
          </div>
          <div className="token-head-sub">
            {list.length === 0 ? '还没有定义任何变量' : `${list.length} 个变量 · 引用 ${[...usage.values()].reduce((a, b) => a + b, 0)} 处`}
          </div>
        </div>
        <div className="token-head-actions">
          <button className="btn-mini" onClick={() => setAddOpen((v) => !v)}>+ 新建</button>
          <button className="btn-mini" onClick={resetDefaults} title="恢复默认变量集">默认集</button>
          {list.length > 0 && <button className="btn-mini" onClick={clearAll} title="清空全部变量">清空</button>}
        </div>
      </div>

      {addOpen && (
        <div className="token-add-row">
          <input
            className="token-name-input"
            value={newName}
            placeholder="变量名（如 brand）"
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addToken(); if (e.key === 'Escape') setAddOpen(false); }}
          />
          <select className="token-group-select" value={newGroup} onChange={(e) => setNewGroup(e.target.value as TokenGroup)}>
            {TOKEN_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <button className="btn-mini" onClick={addToken}>添加</button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="token-empty">
          <div className="token-empty-icon">🎨</div>
          <p>把常用的颜色、圆角、间距定义成变量，改一处就能让整站跟着变。</p>
          <button className="btn-secondary" onClick={resetDefaults}>用默认的一套开始</button>
        </div>
      ) : (
        grouped.map(({ group, items }) => (
          <div className="token-group" key={group}>
            <div className="token-group-title">{group}</div>
            {items.map((t) => {
              const used = usage.get(t.name) ?? 0;
              const nodes = usageNodes.get(t.name) ?? [];
              return (
                <div className="token-row" key={t.name}>
                  <div className="token-row-main">
                    {t.kind === 'color'
                      ? <span className="token-preview-swatch" style={{ background: t.value }} title={t.value} />
                      : <span className="token-preview-glyph" title={t.kind === 'shadow' ? '阴影值' : '尺寸值'}>{t.kind === 'shadow' ? '◲' : '↔'}</span>}
                    {editingName === t.name ? (
                      <input
                        className="token-name-input"
                        defaultValue={t.name}
                        autoFocus
                        onBlur={(e) => rename(t.name, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setEditingName(null);
                        }}
                      />
                    ) : (
                      <button
                        className="token-name"
                        onClick={() => setEditingName(t.name)}
                        title="点一下可以改名（已引用的地方会自动跟着改）"
                      >{t.name}</button>
                    )}
                    <code className="token-var">{cssVarName(t.name)}</code>
                    <button
                      className={'token-usage' + (used > 0 ? '' : ' none')}
                      disabled={used === 0}
                      onClick={() => setExpandedUsage((v) => (v === t.name ? null : t.name))}
                      title={used > 0 ? `有 ${used} 处样式引用了这个变量 —— 点开列表，可跳到画布定位` : '还没有任何样式引用这个变量'}
                    >引用 {used} {expandedUsage === t.name ? '▴' : '▾'}</button>
                  </div>
                  <div className="token-row-ctrl">
                    {t.kind === 'color' ? (
                      <ColorField
                        value={t.value}
                        fallback="#1e88e5"
                        inputClassName="token-value-input"
                        noTokens
                        onChange={(v) => changeValue(t.name, v)}
                        onModalClose={(v) => changeValue(t.name, v)}
                      />
                    ) : (
                      <input
                        className="token-value-input"
                        value={t.value}
                        onChange={(e) => changeValue(t.name, e.target.value)}
                        placeholder={t.kind === 'shadow' ? '0 4px 16px rgba(0,0,0,.1)' : '16px'}
                      />
                    )}
                    <button
                      className="token-copy"
                      onClick={() => { void navigator.clipboard?.writeText(tokenRef(t.name)); }}
                      title={`复制 var(${cssVarName(t.name)}) —— 粘贴到任意样式值里即可使用这个变量`}
                    >⎘ 复制</button>
                    <button className="token-del" onClick={() => remove(t.name)} title="删除这个变量（有引用时会先提示）">×</button>
                  </div>
                  {expandedUsage === t.name && (
                    <div className="token-usage-list">
                      {nodes.length === 0 && <span className="token-usage-empty">（引用列表已变化，未找到引用元素）</span>}
                      {nodes.map((u) => (
                        <button
                          key={u.id}
                          className="token-usage-item"
                          onClick={() => window.dispatchEvent(new CustomEvent('bc:reveal-element', { detail: u.id }))}
                          title="点击：滚动到画布中该元素并闪烁定位"
                        >
                          <span className="token-usage-tag">&lt;{u.type}&gt;</span>
                          {u.text ? <span className="token-usage-text">{u.text}</span> : <span className="token-usage-text muted">（无文字）</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
