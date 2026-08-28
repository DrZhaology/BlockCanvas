import { useState, useEffect, useRef } from 'react';
import { useScene, findNode } from '@store/sceneStore';

// BlockCanvas · 字体族选择器（预设字体 + 主字体 + 备选字体族）
// - 新手友好：内置系统无衬线、微软雅黑、苹方、宋体、楷体、Consolas 代码等宽等中文常用预设
// - 专业可配：支持自定义主字体 + 备选字体族（sans-serif / serif / monospace / cursive）
// - 支持输入任意自定义字体族字符串

export const FONT_PRESETS: Array<{ label: string; value: string; fallback: string }> = [
  { label: '系统默认 (system-ui 无衬线)', value: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', fallback: 'sans-serif' },
  { label: '微软雅黑 / 现代黑体 (清晰锐利)', value: '"Microsoft YaHei", "PingFang SC", sans-serif', fallback: 'sans-serif' },
  { label: '苹方 / 极简黑体 (通透圆润)', value: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif', fallback: 'sans-serif' },
  { label: '宋体 / 衬线明体 (古典优雅)', value: 'SimSun, "Songti SC", "Noto Serif SC", serif', fallback: 'serif' },
  { label: '楷体 / 艺术手写 (传统韵味)', value: 'KaiTi, "Kaiti SC", STKaiti, serif', fallback: 'serif' },
  { label: '代码等宽 / Consolas (工整严密)', value: 'Consolas, "Courier New", Monaco, monospace', fallback: 'monospace' },
  { label: '经典英文字体 / Arial (国际标准)', value: 'Arial, Helvetica, sans-serif', fallback: 'sans-serif' },
  { label: '科技几何 / Trebuchet MS (商务标题)', value: '"Trebuchet MS", "Lucida Grande", sans-serif', fallback: 'sans-serif' },
  { label: '报刊衬线 / Times New Roman', value: '"Times New Roman", Times, serif', fallback: 'serif' }
];

export const FALLBACK_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '无衬线 (sans-serif)', value: 'sans-serif' },
  { label: '衬线体 (serif)', value: 'serif' },
  { label: '等宽代码 (monospace)', value: 'monospace' },
  { label: '手写艺术 (cursive)', value: 'cursive' },
  { label: '系统原生 (system-ui)', value: 'system-ui' }
];

interface Props {
  elementId: string;
}

export function FontFamilyInput(props: Props) {
  const { elementId } = props;
  const scene = useScene((s) => s.scene);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const updateStyleTransient = useScene((s) => s.updateStyleTransient);
  const updateStyle = useScene((s) => s.updateStyle);

  const node = findNode(scene.root, elementId);
  const currentValue = (node?.style?.fontFamily as string) ?? '';

  const [textVal, setTextVal] = useState(currentValue);
  const [customMode, setCustomMode] = useState(false);
  const [primaryFont, setPrimaryFont] = useState('');
  const [fallbackFont, setFallbackFont] = useState('sans-serif');
  const editingRef = useRef(false);

  useEffect(() => {
    if (editingRef.current) return;
    setTextVal(currentValue);
    const matched = FONT_PRESETS.find((p) => p.value === currentValue);
    if (!matched && currentValue) {
      setCustomMode(true);
      const parts = currentValue.split(',').map((s) => s.trim());
      if (parts.length > 1) {
        setPrimaryFont(parts.slice(0, -1).join(', '));
        setFallbackFont(parts[parts.length - 1] || 'sans-serif');
      } else {
        setPrimaryFont(currentValue);
      }
    } else {
      setCustomMode(false);
    }
  }, [currentValue]);

  const commit = (v: string) => {
    updateStyle(elementId, { fontFamily: v } as any);
  };

  const onSelectPreset = (val: string) => {
    if (val === '__custom__') {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    setTextVal(val);
    commit(val);
  };

  const onCustomChange = (prim: string, fb: string) => {
    setPrimaryFont(prim);
    setFallbackFont(fb);
    const primTrim = prim.trim();
    if (!primTrim) {
      setTextVal('');
      updateStyleTransient(elementId, { fontFamily: '' } as any);
      return;
    }
    const combined = primTrim.includes(fb) ? primTrim : `${primTrim}, ${fb}`;
    setTextVal(combined);
    updateStyleTransient(elementId, { fontFamily: combined } as any);
  };

  const matchedPreset = FONT_PRESETS.find((p) => p.value === textVal);
  const selectValue = customMode || (!matchedPreset && textVal) ? '__custom__' : (matchedPreset ? matchedPreset.value : '');

  return (
    <div className="font-family-box">
      <select
        className="font-preset-select"
        value={selectValue}
        onChange={(e) => onSelectPreset(e.target.value)}
        title="选择常用中英文字体组合"
      >
        <option value="">— 默认继承页面字体 —</option>
        {FONT_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
        <option value="__custom__">⚙️ 自定义字体 + 备选字体族…</option>
      </select>

      {customMode && (
        <div className="font-custom-row">
          <input
            type="text"
            className="font-custom-input"
            value={primaryFont}
            placeholder="主字体，例：'Helvetica Neue' 或 霞鹜文楷"
            onFocus={() => { editingRef.current = true; beginStyleEdit(); }}
            onChange={(e) => onCustomChange(e.target.value, fallbackFont)}
            onBlur={() => {
              editingRef.current = false;
              const primTrim = primaryFont.trim();
              const combined = primTrim ? (primTrim.includes(fallbackFont) ? primTrim : `${primTrim}, ${fallbackFont}`) : '';
              commit(combined);
              endStyleEdit();
            }}
          />
          <select
            className="font-fallback-select"
            value={fallbackFont}
            onChange={(e) => {
              const fb = e.target.value;
              onCustomChange(primaryFont, fb);
              const primTrim = primaryFont.trim();
              if (primTrim) commit(primTrim.includes(fb) ? primTrim : `${primTrim}, ${fb}`);
            }}
            title="备选字体族：若用户电脑没有安装主字体，浏览器将自动降级使用该备选字体"
          >
            {FALLBACK_OPTIONS.map((fb) => (
              <option key={fb.value} value={fb.value}>{fb.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
