import { useEffect, useRef, useState } from 'react';
import logoUrl from '@renderer/assets/logo.svg';
import { readPersisted, writePersisted } from '@lib/usePersisted';

// ============================================================================
// BlockCanvas · 空页面（v0.4.4）
// ----------------------------------------------------------------------------
// 关掉所有项目标签后进入这里 —— 类似浏览器的新标签页：
// 一个干净的"首页"，中央是大按钮（打开 / 新建），右上角可以自定义这页的背景。
// 以前最后一个是"未命名项目 1"关不掉，只能永远挂着空标签；现在允许真正的空状态。
//
// 背景自定义持久化在 localStorage（bc-empty-home-bg，存一段 CSS background 值），
// 不进工程文件 —— 这是"软件外观偏好"，不是项目数据。
// ============================================================================

const BG_KEY = 'bc-empty-home-bg';

/** 预设背景（写的是完整 CSS background 值） */
const BG_PRESETS: { label: string; value: string }[] = [
  { label: '默认 · 晴空', value: 'linear-gradient(160deg, #eaf3ff 0%, #f4f9ff 55%, #ffffff 100%)' },
  { label: '晨雾', value: 'linear-gradient(160deg, #eef4f6 0%, #f7fbfc 55%, #ffffff 100%)' },
  { label: '暖阳', value: 'linear-gradient(160deg, #fdf3e7 0%, #fff8ee 55%, #ffffff 100%)' },
  { label: '薄荷', value: 'linear-gradient(160deg, #e9f8ef 0%, #f4fdf8 55%, #ffffff 100%)' },
  { label: '薰衣草', value: 'linear-gradient(160deg, #f1ecfb 0%, #f9f6ff 55%, #ffffff 100%)' },
  { label: '极简白', value: '#ffffff' },
  { label: '浅灰', value: '#f3f5f8' },
  { label: '米色', value: '#faf6ef' }
];

export function EmptyHome(props: {
  onOpen: () => void;
  onNew: () => void;
  onProjects: () => void;
}) {
  const [bg, setBg] = useState<string>(() => readPersisted<string>(BG_KEY, BG_PRESETS[0].value));
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPanelOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [panelOpen]);

  const applyBg = (v: string) => {
    setBg(v);
    writePersisted(BG_KEY, v);
  };

  return (
    <div className="empty-home" style={bg ? { background: bg } : undefined}>
      {/* 右上角：页面设置（背景自定义） */}
      <div className="empty-home-settings" ref={panelRef}>
        <button
          className="empty-home-gear"
          onClick={() => setPanelOpen((v) => !v)}
          title="自定义此页面的背景"
        >
          ⚙ 页面设置
        </button>
        {panelOpen && (
          <div className="empty-home-bgpanel">
            <div className="empty-home-bgpanel-title">这一页的背景</div>
            <div className="empty-home-bggrid">
              {BG_PRESETS.map((p) => (
                <button
                  key={p.value}
                  className={'empty-home-bgswatch' + (bg === p.value ? ' is-active' : '')}
                  style={{ background: p.value }}
                  title={p.label}
                  onClick={() => applyBg(p.value)}
                />
              ))}
              <label
                className={'empty-home-bgswatch empty-home-bgcustom' + (BG_PRESETS.every((p) => p.value !== bg) ? ' is-active' : '')}
                title="自定义颜色"
              >
                +<input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(bg) ? bg : '#f4f7fb'}
                  onChange={(e) => applyBg(e.target.value)}
                />
              </label>
            </div>
            <div className="empty-home-bgpanel-hint">只影响这个首页，不影响项目导出效果。</div>
          </div>
        )}
      </div>

      {/* 中央：Logo + 大按钮 */}
      <div className="empty-home-center">
        <img className="empty-home-logo" src={logoUrl} alt="BlockCanvas" draggable={false} />
        <div className="empty-home-title">BlockCanvas 积木画布</div>
        <div className="empty-home-sub">像搭积木一样做网页 · 打开一个工程，或从空白开始</div>
        <div className="empty-home-actions">
          <button className="empty-home-btn is-primary" onClick={props.onOpen}>
            📂 打开工程文件
          </button>
          <button className="empty-home-btn" onClick={props.onNew}>
            ✨ 新建空白项目
          </button>
          <button className="empty-home-btn is-ghost" onClick={props.onProjects}>
            🗂 全部项目
          </button>
        </div>
        <div className="empty-home-hint">提示：「全部项目」里能看到 data/ 下的所有工程与历史快照</div>
      </div>
    </div>
  );
}
