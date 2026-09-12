import { useEffect } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  category: string;
  items: Array<{ key: string; desc: string }>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    category: '工程与文件',
    items: [
      { key: 'Ctrl + S', desc: '保存当前项目工程 (.bcproj)' },
      { key: 'Ctrl + Shift + S', desc: '项目工程另存为…' },
      { key: 'Ctrl + O', desc: '打开本地工程文件' },
      { key: 'Ctrl + N', desc: '新建空白项目标签页' },
      { key: 'Ctrl + E', desc: '导出为纯净 HTML 网页' },
      { key: 'Ctrl + P', desc: '在默认浏览器中预览' },
      { key: 'Ctrl + ,', desc: '打开 Fluent 偏好设置中心' }
    ]
  },
  {
    category: '元素编辑与排版',
    items: [
      { key: 'Ctrl + D', desc: '原地快速克隆选中元素副本' },
      { key: 'Delete / Backspace', desc: '删除当前选中的元素（支持多选）' },
      { key: 'Ctrl + C / X / V', desc: '复制 / 剪切 / 智能粘贴元素' },
      { key: 'Ctrl + Z / Y', desc: '撤销 / 重做上一步操作' },
      { key: 'Ctrl + A', desc: '选中画布上的所有顶级元素' },
      { key: 'Esc', desc: '取消选中 / 关闭当前浮层' }
    ]
  },
  {
    category: '像素级位置微调',
    items: [
      { key: '↑ / ↓ / ← / →', desc: '按方向微调 1px 外边距或定位坐标' },
      { key: 'Shift + 方向键', desc: '按方向加速微调 10px' },
      { key: '双击文字元素', desc: '原地直接编辑文案（Enter提交/Esc取消）' },
      { key: '画布空白处拖框', desc: 'Windows 桌面式多选元素（支持框选）' }
    ]
  },
  {
    category: '响应式与视图',
    items: [
      { key: '顶栏画布下拉', desc: '随时在 💻桌面 / 📱平板 / 📱手机 三端断点切换' },
      { key: '📱 手机端隐藏', desc: '为当前设备快速注入 display: none 覆盖' },
      { key: '🔄 一键切竖排', desc: '将容器一键转为适合手机单手滑动的纵向排版' },
      { key: '? / Shift + /', desc: '随时呼出本键盘快捷键速查表' }
    ]
  }
];

export function ShortcutsModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="shortcuts-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-modal-header">
          <div className="shortcuts-modal-title">
            <span>⌨️ 键盘快捷键速查表 (Keyboard Shortcuts)</span>
          </div>
          <button className="cp-close" onClick={onClose}>×</button>
        </div>

        <div className="shortcuts-modal-body">
          {SHORTCUT_GROUPS.map((g) => (
            <div key={g.category} className="shortcuts-group">
              <div className="shortcuts-group-title">{g.category}</div>
              <div className="shortcuts-grid">
                {g.items.map((it) => (
                  <div key={it.key} className="shortcut-row">
                    <kbd className="shortcut-kbd">{it.key}</kbd>
                    <span className="shortcut-desc">{it.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="shortcuts-modal-footer">
          <span className="hint">💡 提示：在输入框或文本域打字时，快捷键会自动防误触忽略。</span>
          <button className="btn-primary btn-mini" onClick={onClose}>
            我知道了 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
