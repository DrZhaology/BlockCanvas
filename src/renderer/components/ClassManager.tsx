import { useEffect, useMemo, useRef, useState } from 'react';
import { useScene } from '@store/sceneStore';
import { styleToCssText, simplifyStyle } from '@lib/styleClass';
import { classColor, isValidClassToken } from '@lib/classColor';
import type { SceneElement } from '@lib/types';

// BlockCanvas · 「类名」页签 —— 轻量总览（方案A 重构）
//
// 理念：改样式只有一个地方 = 选中元素 → 属性面板（编辑即统一，同名自动一起变）。
// 这里不再有第二套样式编辑器（旧表单/源码模式已删），只回答三件事：
//  1. 有哪些类 / ID、各有多少元素（色点 = 画布轮廓模式的同类同色）
//  2. 哪些元素还没起名 → 快速起名输入框就地解决
//  3. 同名样式不一致（历史遗留）→ 「以此为准统一」一键写回

type GroupKind = 'class' | 'id' | 'rel';

type ClsGroup = {
  name: string;
  kind: GroupKind;
  count: number;
  firstId: string | null;
  sampleCss: string;
  conflicted: boolean;
};

export function ClassManager() {
  const scene = useScene((s) => s.scene);
  const selectElement = useScene((s) => s.selectElement);
  const unifyClassName = useScene((s) => s.unifyClassName);
  const renameClassToken = useScene((s) => s.renameClassToken);
  const removeClassToken = useScene((s) => s.removeClassToken);
  const [tip, setTip] = useState<string | null>(null);
  const tipTimer = useRef(0);
  // 重命名进行中的组（kind:name）
  const [renaming, setRenaming] = useState<string | null>(null);

  const showTip = (msg: string) => {
    setTip(msg);
    window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => setTip(null), 4000);
  };
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);

  const { groups, unnamed } = useMemo(() => {
    // 按**单个 token** 分组：card 与 card big 都计入 .card（修复旧版按整串分组的割裂）
    const gmap = new Map<string, ClsGroup>();
    const unnamedList: { id: string; type: string; hasId: boolean }[] = [];
    const ensure = (kind: GroupKind, name: string): ClsGroup => {
      const key = kind + ':' + name;
      let g = gmap.get(key);
      if (!g) {
        g = { name, kind, count: 0, firstId: null, sampleCss: '', conflicted: false };
        gmap.set(key, g);
      }
      return g;
    };
    const walk = (n: SceneElement): void => {
      if (n.id !== scene.root.id) {
        const cls = (n.attrs?.className ?? '').trim();
        const idv = (n.attrs?.id ?? '').trim();
        const rel = (n.attrs?.relSelector ?? '').trim();
        if (rel) {
          const g = ensure('rel', rel);
          g.count += 1;
          if (!g.firstId) g.firstId = n.id;
        } else if (cls) {
          for (const t of cls.split(/\s+/)) {
            const g = ensure('class', t);
            g.count += 1;
            if (!g.firstId) g.firstId = n.id;
          }
        } else if (idv) {
          const g = ensure('id', idv);
          g.count += 1;
          if (!g.firstId) g.firstId = n.id;
        } else {
          unnamedList.push({ id: n.id, type: n.type, hasId: false });
        }
      }
      for (const c of n.children) walk(c);
    };
    walk(scene.root);
    // 冲突检测：同名下不同 classString 子组的样式文本集合 > 1
    for (const g of gmap.values()) {
      const elems = collectGroupElems(scene.root, g.kind, g.name);
      const texts = new Set(elems.map((e) => styleToCssText(simplifyStyle(e.style))));
      g.conflicted = texts.size > 1;
      if (elems.length > 0) g.sampleCss = styleToCssText(simplifyStyle(elems[0].style));
    }
    return { groups: [...gmap.values()], unnamed: unnamedList.filter((u) => !u.hasId) };
  }, [scene.root]);

  return (
    <div className="cls-mgr">
      <div className="panel-title">类名 · ID 总览</div>
      <div className="hint" style={{ marginBottom: 8 }}>
        改样式不用来这儿：在画布选中任意一个同类元素，右侧属性面板直接改，同名的会一起变。
        这里只做总览：看有哪些名字、快速起名、处理历史遗留的不一致。
      </div>

      {tip && <div className="cls-tip">{tip}</div>}

      {/* 未命名：就地快速起名 */}
      {unnamed.length > 0 && (
        <div className="cls-unnamed">
          <div className="cls-block-head">{unnamed.length} 个元素没有类名（行内样式）——给它起个名，就能一套样式管一批</div>
          {unnamed.slice(0, 8).map((u) => (
            <QuickNameRow key={u.id} id={u.id} type={u.type} onNamed={(name) => showTip(`已命名为 .${name}，可在下方卡片继续管理`)} />
          ))}
          {unnamed.length > 8 && <div className="cls-more">…还有 {unnamed.length - 8} 个</div>}
        </div>
      )}
      {unnamed.length === 0 && groups.length === 0 && (
        <div className="hint">还没有类名 / ID。选中元素后在属性面板顶部「+ 类名」回车即可创建。</div>
      )}
      {unnamed.length === 0 && groups.length > 0 && (
        <div className="cls-block-head" style={{ color: '#2e7d32' }}>✓ 元素都起了名字</div>
      )}

      {/* 名称总览卡 */}
      {groups.map((g) => {
        const color = g.kind === 'class' ? classColor(g.name) : '#546e7a';
        return (
          <div key={g.kind + ':' + g.name} className={'cls-card' + (g.conflicted ? ' conflicted' : '')}>
            <span className="cls-dot" style={{ background: color }} title="轮廓模式下此类元素的描边颜色" />
            <div className="cls-card-main">
              <div className="cls-card-head">
                <span className="cls-card-name">{g.kind === 'rel' ? '⚡ ' + g.name : g.kind === 'id' ? '#' + g.name : '.' + g.name}</span>
                <span className="cls-card-meta">{g.count} 个元素</span>
                {g.conflicted && (
                  <span className="cls-badge" title="同名元素的样式不一致（历史遗留）。点「以此为准统一」用第一个元素的样式覆盖全部">样式不统一</span>
                )}
              </div>
              <MiniPreview cssText={g.sampleCss} />
            </div>
            <div className="cls-card-actions">
              <button className="btn-mini" onClick={() => g.firstId && selectElement(g.firstId)} title="在画布选中该组第一个元素，到右侧属性面板改样式（全部同步）">定位</button>
              {g.conflicted && (
                <button
                  className="btn-mini"
                  onClick={() => {
                    const elems = collectGroupElems(scene.root, g.kind, g.name);
                    if (elems[0]) {
                      unifyClassName(g.name, elems[0].style as Record<string, string>, g.kind === 'id' ? 'id' : 'class');
                      showTip(`已把 ${g.count} 个元素统一为第一个的样式`);
                    }
                  }}
                  title="用第一个元素的样式覆盖该名称下全部元素（一条撤销）"
                >以此为准统一</button>
              )}
              {g.kind === 'class' && (renaming !== g.kind + ':' + g.name ? (
                <button className="btn-mini" onClick={() => setRenaming(g.kind + ':' + g.name)} title="重命名类名：所有含此名的元素一起改">改名</button>
              ) : (
                <RenameBox
                  kind={g.kind}
                  oldName={g.name}
                  onDone={(nn) => {
                    setRenaming(null);
                    if (nn && nn !== g.name) showTip(`已改名为 .${nn}`);
                  }}
                  onSubmit={(nn) => renameClassToken(g.name, nn)}
                />
              ))}
              {g.kind === 'class' && (
                <button
                  className="btn-mini cls-remove-btn"
                  title={`从所有元素移除类名 ${g.name}（元素本身不删）`}
                  onClick={() => { removeClassToken(g.name); showTip(`已移除类名 ${g.name}（${g.count} 个元素）`); }}
                >移除</button>
              )}
              {g.kind === 'rel' && (
                <button
                  className="btn-mini cls-remove-btn"
                  title={`清除关系选择器 ${g.name}`}
                  onClick={() => {
                    const ids = collectGroupElems(scene.root, 'rel', g.name).map((e) => e.id);
                    useScene.getState().setMultiRelSelector(ids, null);
                    showTip(`已清除关系选择器 ${g.name}（${ids.length} 个元素）`);
                  }}
                >清除选择器</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 收集某名称下的全部元素（与 store.unifyClassName 同一匹配规则）
function collectGroupElems(root: SceneElement, kind: GroupKind, name: string): SceneElement[] {
  const out: SceneElement[] = [];
  const walk = (n: SceneElement): void => {
    if (kind === 'class') {
      const cls = (n.attrs?.className ?? '').trim();
      if (cls.split(/\s+/).includes(name)) out.push(n);
    } else if (kind === 'id') {
      if ((n.attrs?.id ?? '').trim() === name) out.push(n);
    } else if (kind === 'rel') {
      if ((n.attrs?.relSelector ?? '').trim() === name) out.push(n);
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

// 未命名行：定位 + 快速起名（回车提交）
function QuickNameRow(props: { id: string; type: string; onNamed: (name: string) => void }) {
  const selectElement = useScene((s) => s.selectElement);
  const updateAttr = useScene((s) => s.updateAttr);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const { id, type, onNamed } = props;
  const [v, setV] = useState('');
  const submit = () => {
    const t = v.trim();
    if (!t) return;
    if (!isValidClassToken(t)) return;
    beginStyleEdit();
    updateAttr(id, 'className', t);
    endStyleEdit();
    setV('');
    onNamed(t);
  };
  return (
    <div className="cls-quick-row">
      <button className="cls-unnamed-item" onClick={() => selectElement(id)} title="点此在画布选中它">&lt;{type}&gt;</button>
      <input
        className="cls-quick-input"
        placeholder="输入类名，回车确认"
        value={v}
        spellCheck={false}
        title="只能用字母 / 数字 / 横线 / 下划线"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        onBlur={submit}
      />
    </div>
  );
}

// 改名输入框：回车/失焦提交，Esc 取消
function RenameBox(props: { kind: GroupKind; oldName: string; onDone: (newName: string | null) => void; onSubmit: (newName: string) => void }) {
  const [v, setV] = useState(props.oldName);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.select(); }, []);
  const submit = () => {
    const t = v.trim();
    if (!t || !isValidClassToken(t) || t === props.oldName) { props.onDone(null); return; }
    props.onSubmit(t);
    props.onDone(t);
  };
  return (
    <input
      ref={inputRef}
      className="cls-rename-input"
      value={v}
      spellCheck={false}
      title="回车确认，Esc 取消；所有含此名的元素一起改名"
      onChange={(e) => setV(e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit();
        else if (e.key === 'Escape') props.onDone(null);
      }}
    />
  );
}

// 迷你实时预览：按组内第一个元素的样式渲染一个小色块 + "A" 字样
function MiniPreview(props: { cssText: string }) {
  const { cssText } = props;
  const decls = parseDecls(cssText);
  if (Object.keys(decls).length === 0) {
    return <div className="cls-mini-empty">（无样式内容）</div>;
  }
  return (
    <div className="cls-card-summary" title={cssText}>
      <span
        className="cls-mini"
        style={{
          background: decls['background-color'] ?? 'transparent',
          color: decls['color'] ?? undefined,
          borderRadius: decls['border-radius'] ?? undefined,
          border: decls['border'] || decls['border-width'] ? '1px solid currentColor' : undefined,
          fontWeight: decls['font-weight'] ?? undefined
        }}
      >Aa</span>
      <span className="cls-mini-text">{cssText || '（无样式内容）'}</span>
    </div>
  );
}

// 极简 CSS 声明解析（仅用于迷你预览展示，不做写入）
function parseDecls(cssText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of cssText.split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).replace(/;$/, '').trim();
    if (k && v) out[k] = v;
  }
  return out;
}
