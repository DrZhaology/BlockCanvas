import { useState, useEffect } from 'react';
import { useScene, findNode } from '@store/sceneStore';
import { Icon } from './Icon';
import { ClassManager } from './ClassManager';
import { TokenPanel } from './TokenPanel';
import { peekPendingPropFocus, subscribePropFocus } from '@lib/propFocus';
import { PageCssBody } from './inspector/PageCssBody';
import { ElementPropsBody } from './inspector/ElementPropsBody';
import { MultiClassNameRow, MultiRelSelectorRow } from './inspector/rows/MultiSelectRows';

// BlockCanvas · 属性面板外壳（四个页签）
//
// 「按需添加属性」架构（阶段2 起，一直没变）：
//  · 默认只显示 width / height 两个基础尺寸输入
//  · "+ 添加属性" 下拉选 CSS 属性加入面板；每个属性旁有 "?" 帮助 + "×" 删除
//  · box4 类型展开成 4 边分别输入；color 用 ColorPicker 富组件；文本元素展示文案输入
//  · HTML 原生属性（class/id/src/alt/href 等）单独区
//
// 四个页签的内容分别在：
//   inspector/ElementPropsBody.tsx   元素（断点 / 标识 / 快捷助手 / 伪类 / CSS 属性）
//   inspector/PageCssBody.tsx        页面（body 设置 + 全局样式）
//   ClassManager / TokenPanel        类名总览 / 设计变量
//
// ⚠ Hooks 必须全部在提前 return 之前 —— 否则"未选中 → 选中"切换时 hook 数量变化
//   会让 React 崩溃卸载整棵组件树（白屏，踩过一次）。

type InspTab = 'element' | 'page' | 'class' | 'token';

export function Inspector() {
  const scene = useScene((s) => s.scene);
  const removeMany = useScene((s) => s.removeMany);
  const selectMany = useScene((s) => s.selectMany);

  // 刚添加的属性 key：让对应输入的框自动聚焦 + 蓝色高亮边框，一眼找到
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);
  const [inspectorTab, setInspectorTabRaw] = useState<InspTab>('element');
  // v0.4.4：页签切换不再走 View Transition（旧帧快照会让文字停顿），
  // 改为内容重挂载 + 轻量入场动画（见 .insp-tab-anim 的 bcSwapIn）。
  const setInspectorTab = (t: InspTab) => {
    if (t === inspectorTab) return;
    setInspectorTabRaw(t);
  };
  // 「⚠」面板或菜单「类名管理」→ 切到「类名」页签
  useEffect(() => {
    const openClass = () => setInspectorTabRaw('class');
    window.addEventListener('bc:open-class', openClass);
    return () => window.removeEventListener('bc:open-class', openClass);
  }, []);
  // 切换选中元素时，清除"刚添加"标记（高亮/聚焦不属于新元素）
  const selectedIdForSync = scene.selectedId;
  useEffect(() => {
    setJustAddedKey(null);
    // v0.4.5：选中元素时，无论当前停在「类名 / 页面 / 变量」哪个页签，都跳回「元素」。
    // 用户的心智是"我点了一个元素，就要看这个元素的属性"；停在别处会让人以为没选中。
    if (selectedIdForSync) setInspectorTabRaw('element');
  }, [selectedIdForSync]);

  // 中键属性搜索：右侧面板可能停在「页面 / 类名 / 变量」页签（ElementPropsBody 未挂载），
  // 甚至整个 Inspector 刚被 App 从「图层」切过来。这里统一兜底：收到请求就切到「元素」页签，
  // 真正的定位由 ElementPropsBody 挂载后从缓冲里取走执行（见 lib/propFocus）。
  useEffect(() => {
    const toElement = () => {
      if (peekPendingPropFocus()) setInspectorTabRaw('element');
    };
    toElement(); // 挂载瞬间可能已经有排队请求（从图层页切过来的情况）
    return subscribePropFocus(toElement);
  }, []);

  // 画布/模板刚插入新元素 → 把右侧属性区滚回顶部（顶部就是这个新元素的属性）
  useEffect(() => {
    const onAdded = () => {
      window.setTimeout(() => {
        const scroller = document.querySelector('.right-pane .tab-body') as HTMLElement | null;
        if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
      }, 80);
    };
    window.addEventListener('bc:element-added', onAdded);
    return () => window.removeEventListener('bc:element-added', onAdded);
  }, []);

  const selected = scene.selectedId ? findNode(scene.root, scene.selectedId) : null;

  // 多选 / 未选中 / 根节点 / 正常属性 四种内容，统一放进"元素"页签
  let elementBody: React.ReactNode;
  if (scene.selectedIds.length > 1) {
    const ids = scene.selectedIds;
    elementBody = (
      <>
        <div className="panel-title">已选 {ids.length} 个元素</div>
        <div className="hint" style={{ marginBottom: 8 }}>
          Ctrl+点击画布或图层树，可取消个别元素；在画布空白处拖框可重新框选。
        </div>
        <div className="multi-sel-list">
          {ids.map((id) => {
            const n = findNode(scene.root, id);
            if (!n) return null;
            return (
              <div key={id} className="multi-sel-item">
                <span>&lt;{n.type}&gt;{n.text ? ` · ${n.text.slice(0, 24)}` : ''}</span>
                <button
                  className="btn-mini"
                  title="从多选中移除"
                  onClick={() => useScene.getState().toggleSelect(id)}
                >移除</button>
              </div>
            );
          })}
        </div>
        <MultiClassNameRow ids={ids} />
        <MultiRelSelectorRow ids={ids} />
        <div className="inspector-actions">
          <button className="btn-danger" onClick={() => removeMany(ids)}>删除全部 {ids.length} 个</button>
          <button className="btn-secondary" onClick={() => selectMany([])}>取消选中</button>
        </div>
      </>
    );
  } else if (!selected) {
    elementBody = (
      <div className="inspector-empty">
        <div className="empty-icon"><Icon name="target" size={30} /></div>
        <div className="empty-title">未选中元素</div>
        <div className="empty-desc">
          在画布上直接点击任意元素，或在左侧「图层」中点选，即可在此调整大小、颜色、文字与排版。
        </div>
      </div>
    );
  } else if (selected.id === scene.root.id) {
    elementBody = (
      <div className="inspector-empty">
        <div className="empty-icon"><Icon name="pageReset" size={30} /></div>
        <div className="empty-title">画布根容器</div>
        <div className="empty-desc">
          画布根节点代表整个网页主体。若要修改整页背景色、文字颜色或字体，请切换到上方 <b>「页面」</b> 页签。
        </div>
      </div>
    );
  } else {
    elementBody = <ElementPropsBody selected={selected} justAddedKey={justAddedKey} onJustAdded={setJustAddedKey} />;
  }

  return (
    <div className="panel inspector">
      <div className="inspector-tabs">
        <button
          className={'inspector-tab' + (inspectorTab === 'element' ? ' active' : '')}
          onClick={() => setInspectorTab('element')}
        >元素</button>
        <button
          className={'inspector-tab' + (inspectorTab === 'class' ? ' active' : '')}
          onClick={() => setInspectorTab('class')}
        >类名</button>
        <button
          className={'inspector-tab' + (inspectorTab === 'page' ? ' active' : '')}
          onClick={() => setInspectorTab('page')}
        >页面</button>
        <button
          className={'inspector-tab' + (inspectorTab === 'token' ? ' active' : '')}
          onClick={() => setInspectorTab('token')}
          title="设计变量：把主色 / 圆角 / 间距定义成名字，改一处全站跟着变"
        >变量</button>
      </div>
      <div className="insp-tab-anim" key={inspectorTab}>
        {inspectorTab === 'class'
          ? <ClassManager />
          : inspectorTab === 'token'
            ? <TokenPanel />
            : inspectorTab === 'page'
              ? <PageCssBody />
              : elementBody}
      </div>
    </div>
  );
}
