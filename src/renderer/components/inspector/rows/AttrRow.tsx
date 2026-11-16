// BlockCanvas · HTML 原生属性行（class / id / href / src / alt …）

import { useState } from 'react';
import { useScene } from '@store/sceneStore';
import type { SceneElement } from '@lib/types';
import { HelpButton } from '../../HelpButton';

export function AttrRow(props: {
  keyName: string;
  label: string;
  elementId: string;
  element: SceneElement;
  help?: { title: string; content: string };
}) {
  const { keyName, label, elementId, element, help } = props;
  const updateAttr = useScene((s) => s.updateAttr);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const root = useScene((s) => s.scene.root);

  const currentValue = (element.attrs?.[keyName] as string) ?? '';

  const helpBtn = help ? <HelpButton title={help.title} content={help.content} /> : null;

  // 用 setState 控制本地编辑值（避免每输入一个字符都 setState 触发渲染）
  const [localValue, setLocalValue] = useState(currentValue);
  // 4-F：类名 / ID 输入后的即时提示（同名数量 / ID 重复），blur 时计算
  const [hint, setHint] = useState<{ text: string; danger?: boolean } | null>(null);

  // 选本地图片 button（仅 keyName === 'src'）
  const isImgSrc = keyName === 'src';
  const onPickImage = async () => {
    const res = await window.bc.pickImageSrc();
    if (!res.ok) return;
    updateAttr(elementId, keyName, res.path ?? '');
    setLocalValue(res.path ?? '');
  };

  // 类名 / ID 专用：提交后给出即时反馈（不影响提交本身）
  const checkNameHint = (value: string) => {
    const v = value.trim();
    if (!v) { setHint(null); return; }
    if (keyName === 'className') {
      const cls = v;
      let count = 0;
      const walk = (n: SceneElement): void => {
        if (n.id !== elementId && (n.attrs?.className ?? '').trim() === cls) count++;
        for (const c of n.children) walk(c);
      };
      walk(root);
      setHint(
        count > 0
          ? { text: `已有 ${count} 个元素使用这个类名：改任意一个的样式，它们会一起变（编辑即统一）` }
          : null
      );
    } else if (keyName === 'id') {
      let dup = false;
      let owner = '';
      const walk = (n: SceneElement): void => {
        if (n.id !== elementId && (n.attrs?.id ?? '').trim() === v) { dup = true; owner = n.type; }
        for (const c of n.children) walk(c);
      };
      walk(root);
      setHint(
        dup
          ? { text: `注意：这个 ID 已被另一个 <${owner}> 使用，浏览器里 ID 必须唯一`, danger: true }
          : null
      );
    }
  };

  return (
    <div className="prop-row">
      <div className="prop-row-header">
        <span>{label}{helpBtn}</span>
      </div>
      <div className="prop-row-body attr-row-body" style={{ display: 'flex' }}>
        <input
          type="text"
          value={localValue}
          placeholder={'例如 ' + (keyName === 'className' ? 'btn primary' : keyName === 'href' ? 'https://...' : '')}
          onFocus={() => beginStyleEdit()}
          onChange={(e) => {
            setLocalValue(e.target.value);
          }}
          onBlur={() => {
            updateAttr(elementId, keyName, localValue);
            checkNameHint(localValue);
            endStyleEdit();
          }}
        />
        {isImgSrc && (
          <button
            className="btn-mini"
            onClick={onPickImage}
            title="选择本地图片文件"
          >选文件…</button>
        )}
      </div>
      {hint && (
        <div
          className={'attr-hint' + (hint.danger ? ' danger' : '')}
          onClick={() => setHint(null)}
          title="点击关闭"
        >{hint.text}</div>
      )}
    </div>
  );
}
