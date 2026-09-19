import { useState, useEffect, useRef } from 'react';
import { useScene, findNode, getEffectiveStyle } from '@store/sceneStore';
import { FontPickerModal } from './FontPickerModal';

// BlockCanvas · 字体族选择器（v0.4.5 重构）
// - 预设下拉：常用中英文字体组合一键应用
// - 「字体库」：全屏面板（本机全部字体 + 常见目录含商用标注 + 多字体回退链）
// - 自定义值：直接在文本框里手改**完整的 font-family 值**（旧的「主字体输入 +
//   备选衬体下拉」两段式控件概念绕、还容易改丢值，已删除 —— 统一为"看得见的那一串"）。

export const FONT_PRESETS: Array<{ label: string; value: string }> = [
  { label: '系统默认 (system-ui 无衬线)', value: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { label: '微软雅黑 / 现代黑体 (清晰锐利)', value: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { label: '苹方 / 极简黑体 (通透圆润)', value: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif' },
  { label: '宋体 / 衬线明体 (古典优雅)', value: 'SimSun, "Songti SC", "Noto Serif SC", serif' },
  { label: '楷体 / 艺术手写 (传统韵味)', value: 'KaiTi, "Kaiti SC", STKaiti, serif' },
  { label: '代码等宽 / Consolas (工整严密)', value: 'Consolas, "Courier New", Monaco, monospace' },
  { label: '经典英文字体 / Arial (国际标准)', value: 'Arial, Helvetica, sans-serif' },
  { label: '科技几何 / Trebuchet MS (商务标题)', value: '"Trebuchet MS", "Lucida Grande", sans-serif' },
  { label: '报刊衬线 / Times New Roman', value: '"Times New Roman", Times, serif' }
];

interface Props {
  elementId: string;
  pseudo?: string | null;
}

export function FontFamilyInput(props: Props) {
  const { elementId, pseudo } = props;
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);
  const updatePseudoStyle = useScene((s) => s.updatePseudoStyle);
  const activeBreakpoint = useScene((s) => s.activeBreakpoint);

  const isPseudo = Boolean(pseudo);
  const node = findNode(scene.root, elementId);
  const effStyle = node ? (getEffectiveStyle(node, activeBreakpoint) as any) : {};
  const currentValue = isPseudo
    ? ((node?.pseudoStyles?.[pseudo!]?.fontFamily as string) ?? '')
    : ((effStyle?.fontFamily as string) ?? '');

  const [textVal, setTextVal] = useState(currentValue);
  const [pickerOpen, setPickerOpen] = useState(false);
  const editingRef = useRef(false);

  // 外部变化（撤销/重做/切元素/字体库应用）时同步显示；编辑中不打断
  useEffect(() => {
    if (editingRef.current) return;
    setTextVal(currentValue);
  }, [currentValue]);

  const commit = (v: string) => {
    if (isPseudo) {
      updatePseudoStyle(elementId, pseudo!, { fontFamily: v || undefined as any });
    } else {
      updateStyle(elementId, { fontFamily: v } as any);
    }
  };

  const matchedPreset = FONT_PRESETS.find((p) => p.value === textVal);
  const selectValue = matchedPreset ? matchedPreset.value : (textVal ? '__custom__' : '');

  return (
    <div className="font-family-box">
      <div className="font-row">
        <select
          className="font-preset-select"
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__custom__') { setPickerOpen(true); return; }
            setTextVal(v);
            commit(v);
          }}
          title="选择常用中英文字体组合"
        >
          <option value="">— 默认继承页面字体 —</option>
          {FONT_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
          {selectValue === '__custom__' && <option value="__custom__">自定义：{textVal.slice(0, 24)}…</option>}
        </select>
        <button
          className="btn-mini font-lib-btn"
          onClick={() => setPickerOpen(true)}
          title="打开字体库：浏览本机全部字体与常见字体目录（含商用标注），拖动调整多字体回退链"
        >Aa 字体库…</button>
      </div>

      {/* 当前是自定义值时：直接显示完整 font-family 值，可手改 —— 改的就是"看得见的那一串" */}
      {!matchedPreset && (
        <input
          type="text"
          className="font-custom-input"
          value={textVal}
          placeholder={'例如："霞鹜文楷", "Noto Sans SC", sans-serif'}
          spellCheck={false}
          title="完整的 font-family 值：逗号分隔多个字体，排前面的优先。也可点「字体库…」可视化编辑"
          onFocus={() => { editingRef.current = true; beginStyleEdit(); }}
          onChange={(e) => {
            setTextVal(e.target.value);
            updateStyleTransient(elementId, { fontFamily: e.target.value } as any);
          }}
          onBlur={() => {
            editingRef.current = false;
            commit(textVal.trim());
            endStyleEdit();
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      )}

      <FontPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        initial={textVal}
        onApply={(v) => {
          setTextVal(v);
          commit(v);
        }}
      />
    </div>
  );
}
