import { useState, useEffect } from 'react';
import { useScene } from '@store/sceneStore';
import { useToolbar, dockOf, getSortedItems, type ToolbarItem, type ToolbarDock } from '@store/toolbarStore';
import { HelpButton } from './HelpButton';
import { Icon, type IconName } from './Icon';
import { Collapse } from './Collapse';
import { TIPS, TIPS_KEY, setTipsEnabled } from './CanvasOverlays';
import type { DataPathsInfo, StorageStatsInfo } from '../global';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// BlockCanvas · Windows 11 Fluent 风格全功能偏好设置中枢
// - 整合：个性化/外观、编辑器/画布、存储与自动备份、工具栏管理、扩展与插件管理 (完全内嵌)、关于信息

export type SettingsSection =
  | 'personalization'
  | 'editor'
  | 'storage'
  | 'toolbar'
  | 'extensions'
  | 'about';

interface Props {
  onBack: () => void;
  onOpenWebManager?: () => void;
  initialSection?: SettingsSection;
  layout: 'left' | 'bottom';
  onLayoutChange: (l: 'left' | 'bottom') => void;
  canvasWidth: string;
  onCanvasWidthChange: (w: string) => void;
  /** 打开软件内更新中心页（v0.4.1：更新不再走弹窗） */
  onOpenUpdateCenter?: () => void;
}

export function Settings(props: Props) {
  const { onBack, onOpenWebManager, layout, onLayoutChange, canvasWidth, onCanvasWidthChange, initialSection, onOpenUpdateCenter } = props;
  const [section, setSection] = useState<SettingsSection>(initialSection || 'personalization');
  const [paths, setPaths] = useState<DataPathsInfo | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStatsInfo | null>(null);
  const [cleaningCache, setCleaningCache] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    window.bc.getLocalVersion().then(setAppVersion).catch(() => {});
  }, []);

  const refreshStorageStats = async () => {
    try {
      const stats = await window.bc.getStorageStats();
      setStorageStats(stats);
    } catch {}
  };

  useEffect(() => {
    if (initialSection) setSection(initialSection);
    refreshStorageStats();
  }, [initialSection]);

  const handleClearCache = async () => {
    setCleaningCache(true);
    try {
      const res = await window.bc.clearAppCache();
      if (res.ok) {
        alert(`✨ 运行缓存清理成功！\n\n本次已安全释放 ${formatBytes(res.freedBytes)} 临时空间。`);
        refreshStorageStats();
      }
    } catch (e: any) {
      alert('清理失败: ' + (e.message || '未知错误'));
    } finally {
      setCleaningCache(false);
    }
  };

  const handleClearOrphanBackups = async () => {
    if (!confirm('确定要清理所有已删除项目遗留的孤立历史快照吗？')) return;
    try {
      const res = await window.bc.clearOrphanBackups();
      if (res.ok) {
        alert(`✨ 已成功清理 ${res.cleanedCount} 处孤立历史快照，释放 ${formatBytes(res.freedBytes)} 空间！`);
        refreshStorageStats();
      }
    } catch (e: any) {
      alert('清理失败: ' + (e.message || '未知错误'));
    }
  };

  // 场景与全局设置
  const scene = useScene((s) => s.scene);
  const setQuickCss = useScene((s) => s.setQuickCss);
  const beginStyleEdit = useScene((s) => s.beginStyleEdit);
  const endStyleEdit = useScene((s) => s.endStyleEdit);
  const autoInherit = useScene((s) => s.autoInherit);
  const setAutoInherit = useScene((s) => s.setAutoInherit);

  // 轮廓开关
  const [outlines, setOutlines] = useState<boolean>(() => {
    try { return localStorage.getItem('bc-outlines') === '1'; } catch { return false; }
  });
  const toggleOutlines = (v: boolean) => {
    setOutlines(v);
    document.body.classList.toggle('bc-outlines-on', v);
    try { localStorage.setItem('bc-outlines', v ? '1' : '0'); } catch {}
  };

  // 元素面板模式
  const [elemLabelMode, setElemLabelMode] = useState<'both' | 'zh' | 'tag'>(() => {
    try { return (localStorage.getItem('bc-elem-label-mode') as any) || 'both'; } catch { return 'both'; }
  });
  const changeElemLabelMode = (m: 'both' | 'zh' | 'tag') => {
    setElemLabelMode(m);
    try { localStorage.setItem('bc-elem-label-mode', m); } catch {}
  };

  // 画布左上角技巧提示开关（画布浮层通过 bc:canvas-tips-changed 事件实时响应）
  const [canvasTips, setCanvasTips] = useState<boolean>(() => {
    try { return localStorage.getItem(TIPS_KEY) !== '0'; } catch { return true; }
  });
  const toggleCanvasTips = (v: boolean) => {
    setCanvasTips(v);
    setTipsEnabled(v);
  };

  // 深色模式状态
  const [darkMode, setDarkMode] = useState<'auto' | 'dark' | 'light'>(() => {
    try {
      const m = localStorage.getItem('bc-dm:mode');
      return m === 'dark' || m === 'light' ? m : 'auto';
    } catch { return 'auto'; }
  });
  const changeDarkMode = (m: 'auto' | 'dark' | 'light') => {
    setDarkMode(m);
    try { localStorage.setItem('bc-dm:mode', m); } catch {}
    window.dispatchEvent(new CustomEvent('bc:plugins-changed'));
  };

  // 自动备份自定义配置
  const [backupInterval, setBackupInterval] = useState<number>(60000);
  const [maxSnapshots, setMaxSnapshots] = useState<number>(15);
  const [autoCleanCache, setAutoCleanCache] = useState<boolean>(false);
  const [autoCleanOrphans, setAutoCleanOrphans] = useState<boolean>(true);

  useEffect(() => {
    window.bc.getAppConfig().then((cfg) => {
      if (typeof cfg.autoBackupInterval === 'number') setBackupInterval(cfg.autoBackupInterval);
      if (typeof cfg.maxSnapshots === 'number') setMaxSnapshots(cfg.maxSnapshots);
      setAutoCleanCache(!!cfg.autoCleanCacheOnStartup);
      setAutoCleanOrphans(cfg.autoCleanOrphansOnStartup !== false);
    });
    window.bc.getDataPaths().then((p) => setPaths(p));
  }, []);

  const changeBackupInterval = (ms: number) => {
    setBackupInterval(ms);
    window.bc.setAppConfig({ autoBackupInterval: ms });
  };

  const changeMaxSnapshots = (num: number) => {
    setMaxSnapshots(num);
    window.bc.setAppConfig({ maxSnapshots: num });
  };

  const toggleAutoCleanCache = (v: boolean) => {
    setAutoCleanCache(v);
    window.bc.setAppConfig({ autoCleanCacheOnStartup: v });
  };

  const toggleAutoCleanOrphans = (v: boolean) => {
    setAutoCleanOrphans(v);
    window.bc.setAppConfig({ autoCleanOrphansOnStartup: v });
  };

  // 工具栏管理（独立组件 ToolbarManagerSection，见文件末尾）
  const resetToolbar = useToolbar((s) => s.reset);

  // 「快捷助手属性是否显示到下方 CSS 列表」—— v0.4.4 起为全局统一开关
  // （与属性面板内的小开关是同一个，localStorage + 事件双向同步）
  const [helperInCss, setHelperInCss] = useState<boolean>(() => {
    try { return localStorage.getItem('bc-helper-in-css-global') !== '0'; } catch { return true; }
  });
  useEffect(() => {
    const sync = () => {
      try { setHelperInCss(localStorage.getItem('bc-helper-in-css-global') !== '0'); } catch { /* ignore */ }
    };
    window.addEventListener('bc:helper-in-css-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('bc:helper-in-css-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const changeHelperInCss = (v: boolean) => {
    setHelperInCss(v);
    try { localStorage.setItem('bc-helper-in-css-global', v ? '1' : '0'); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('bc:helper-in-css-changed'));
  };

  const qc = scene.quickCss ?? {};

  const NAV_ITEMS: Array<{ id: SettingsSection; label: string; icon: string; desc: string; svg: IconName }> = [
    { id: 'personalization', label: '个性化与外观', icon: '🎨', svg: 'palette', desc: '深浅主题、白边重置、同类高亮' },
    { id: 'editor', label: '编辑器与画布', icon: '🛠️', svg: 'sliders', desc: '布局模式、画布默认宽度、继承机制' },
    { id: 'storage', label: '存储与自动备份', icon: '💾', svg: 'database', desc: '备份周期、快照数量、便携 data/ 目录' },
    { id: 'toolbar', label: '工具栏管理', icon: '🔧', svg: 'tool', desc: '每个按钮的停靠区与顺序自由编排' },
    { id: 'extensions', label: '扩展与插件中心', icon: '🧩', svg: 'puzzle', desc: '管理、启停、导入插件与模板资源包' },
    { id: 'about', label: '关于与系统', icon: 'ℹ️', svg: 'info', desc: '版本号、开源协议与技术栈' }
  ];

  return (
    <div className="fluent-settings-page">
      {/* 左侧 Fluent 导航栏 */}
      <div className="fluent-sidebar">
        <div className="fluent-sidebar-top">
          <button className="fluent-back-btn" onClick={onBack} title="返回画布编辑器">
            ← 返回编辑器
          </button>
          <div className="fluent-app-brand">
            <span className="fluent-brand-logo">⚡</span>
            <span className="fluent-brand-text">BlockCanvas 设置</span>
          </div>
        </div>

        <div className="fluent-nav-list">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={"fluent-nav-item" + (section === item.id ? " active" : "")}
              onClick={() => setSection(item.id)}
            >
              <span className="fluent-nav-icon">{item.icon}</span>
              <div className="fluent-nav-meta">
                <span className="fluent-nav-title">{item.label}</span>
                <span className="fluent-nav-desc">{item.desc}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧主设置内容区 */}
      <div className="fluent-content">
        <div className="fluent-content-header">
          <div className="fluent-breadcrumb">
            <span>设置</span>
            <span className="fluent-slash">/</span>
            <span className="fluent-current">{NAV_ITEMS.find((n) => n.id === section)?.label}</span>
          </div>
          <h2 className="fluent-page-title">{NAV_ITEMS.find((n) => n.id === section)?.label}</h2>
        </div>

        {/* v0.4.4：分区切换不再瞬变 —— key 变化重挂载 + 轻量入场动画（bcSwapIn） */}
        <div className="fluent-cards-container" key={section}>
          {/* ——— 1. 个性化与外观 ——— */}
          {section === 'personalization' && (
            <>
              <div className="fluent-group-title">主题与界面色彩</div>
              <div className="fluent-card">
                <div className="fluent-card-icon"><Icon name="moon" /></div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">深浅颜色模式 (Theme Mode)</div>
                  <div className="fluent-card-desc">自动跟随 Windows 操作系统明暗，或手动指定浅色/深色主题。</div>
                </div>
                <div className="fluent-card-ctrl">
                  <select
                    className="fluent-select"
                    value={darkMode}
                    onChange={(e) => changeDarkMode(e.target.value as any)}
                  >
                    <option value="auto">自动跟随系统 (推荐)</option>
                    <option value="dark">常驻深色模式 (Dark)</option>
                    <option value="light">常驻浅色模式 (Light)</option>
                  </select>
                </div>
              </div>

              <div className="fluent-card">
                <div className="fluent-card-icon"><Icon name="outline" /></div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">画布同类元素彩色轮廓描边 (Outlines)</div>
                  <div className="fluent-card-desc">为相同类名与选择器的元素赋予专属配色描边，直观一眼看清区块归属。</div>
                </div>
                <div className="fluent-card-ctrl">
                  <label className="fluent-switch">
                    <input
                      type="checkbox"
                      checked={outlines}
                      onChange={(e) => toggleOutlines(e.target.checked)}
                    />
                    <span className="fluent-slider" />
                  </label>
                </div>
              </div>

              <div className="fluent-card">
                <div className="fluent-card-icon"><Icon name="sparkle" /></div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">画布左上角技巧提示 (Tips)</div>
                  <div className="fluent-card-desc">
                    在画布左上角每 30 秒轮播一条编辑器使用小技巧（共 <b>{TIPS.length}</b> 条）。
                    在画布上点一下提示条可立即换下一条，点它右侧的 × 也能快速关闭。熟悉软件后可以在这里永久关掉，让画布更干净。
                  </div>
                </div>
                <div className="fluent-card-ctrl">
                  <label className="fluent-switch">
                    <input
                      type="checkbox"
                      checked={canvasTips}
                      onChange={(e) => toggleCanvasTips(e.target.checked)}
                    />
                    <span className="fluent-slider" />
                  </label>
                </div>
              </div>

              <div className="fluent-group-title">网页导出基础重置</div>
              <div className="fluent-card">
                <div className="fluent-card-icon">📄</div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">去掉浏览器默认白边 (body margin reset)</div>
                  <div className="fluent-card-desc">浏览器默认给页面四周留有 8px 白边。开启后画布与导出将贴边展示。</div>
                </div>
                <div className="fluent-card-ctrl">
                  <label className="fluent-switch">
                    <input
                      type="checkbox"
                      checked={qc.resetMargin === '1'}
                      onChange={(e) => {
                        beginStyleEdit();
                        setQuickCss({ resetMargin: e.target.checked ? '1' : '' });
                        endStyleEdit();
                      }}
                    />
                    <span className="fluent-slider" />
                  </label>
                </div>
              </div>

              <div className="fluent-card">
                <div className="fluent-card-icon">🔤</div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">重置标题/段落默认外边距 (CSS Reset)</div>
                  <div className="fluent-card-desc">将 h1~h6、段落、列表自带的浏览器原始间距清零，还原真实网站排版。</div>
                </div>
                <div className="fluent-card-ctrl">
                  <label className="fluent-switch">
                    <input
                      type="checkbox"
                      checked={qc.resetHeadingMargin === '1'}
                      onChange={(e) => {
                        beginStyleEdit();
                        setQuickCss({ resetHeadingMargin: e.target.checked ? '1' : '' });
                        endStyleEdit();
                      }}
                    />
                    <span className="fluent-slider" />
                  </label>
                </div>
              </div>
            </>
          )}

          {/* ——— 2. 编辑器与画布 ——— */}
          {section === 'editor' && (
            <>
              <div className="fluent-group-title">工作区排版布局</div>
              <div className="fluent-card">
                <div className="fluent-card-icon">🖥️</div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">工作区布局方式 (Workspace Layout)</div>
                  <div className="fluent-card-desc">选择元素面板与画布的相对摆放位置（底部横向背包 / 左侧传统列栏）。</div>
                </div>
                <div className="fluent-card-ctrl">
                  <select
                    className="fluent-select"
                    value={layout}
                    onChange={(e) => onLayoutChange(e.target.value as any)}
                  >
                    <option value="bottom">底部横栏模式 (默认 · 画布最大化)</option>
                    <option value="left">左侧坚排模式 (传统侧边栏)</option>
                  </select>
                </div>
              </div>

              <div className="fluent-card">
                <div className="fluent-card-icon">📏</div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">画布默认基准宽度 (Canvas Width)</div>
                  <div className="fluent-card-desc">自适应铺满当前窗口，或指定固定断点（桌面 1440px / 平板 768px / 手机 375px）。</div>
                </div>
                <div className="fluent-card-ctrl">
                  <select
                    className="fluent-select"
                    value={canvasWidth}
                    onChange={(e) => onCanvasWidthChange(e.target.value)}
                  >
                    <option value="auto">自适应窗口 (随编辑区伸缩)</option>
                    <option value="1440px">桌面电脑 (1440px)</option>
                    <option value="768px">平板设备 (768px)</option>
                    <option value="375px">移动手机 (375px)</option>
                  </select>
                </div>
              </div>

              <div className="fluent-group-title">插入与构建习惯</div>
              <div className="fluent-card">
                <div className="fluent-card-icon">🧰</div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">快捷助手属性显示到下方 CSS 列表（全局）</div>
                  <div className="fluent-card-desc">
                    开启后，快捷助手（布局 / 文字渐变）生成的属性会同步出现在右侧面板下方的「CSS 样式属性」列表里。
                    <b>这是全局开关，对所有元素生效</b>（不是每个元素单独记录）；关闭只是不显示，样式依然生效。
                  </div>
                </div>
                <div className="fluent-card-ctrl">
                  <label className="fluent-switch">
                    <input
                      type="checkbox"
                      checked={helperInCss}
                      onChange={(e) => changeHelperInCss(e.target.checked)}
                    />
                    <span className="fluent-slider" />
                  </label>
                </div>
              </div>

              <div className="fluent-card">
                <div className="fluent-card-icon"><Icon name="bolt" /></div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">同级样式智能继承 (Auto Inherit)</div>
                  <div className="fluent-card-desc">在已有子元素的容器内插入新元素时，自动套用同级已有的选择器与样式。</div>
                </div>
                <div className="fluent-card-ctrl">
                  <label className="fluent-switch">
                    <input
                      type="checkbox"
                      checked={autoInherit}
                      onChange={(e) => setAutoInherit(e.target.checked)}
                    />
                    <span className="fluent-slider" />
                  </label>
                </div>
              </div>

              <div className="fluent-card">
                <div className="fluent-card-icon">🏷️</div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">元素按钮标签展示模式</div>
                  <div className="fluent-card-desc">控制元素面板中按钮的文字表现形式。</div>
                </div>
                <div className="fluent-card-ctrl">
                  <select
                    className="fluent-select"
                    value={elemLabelMode}
                    onChange={(e) => changeElemLabelMode(e.target.value as any)}
                  >
                    <option value="both">中文名称 + HTML 代码标签 (推荐)</option>
                    <option value="zh">仅中文友好名称</option>
                    <option value="tag">仅英文 HTML 代码标签 (&lt;div&gt;)</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* ——— 3. 存储与自动备份 + 更新 ——— */}
          {section === 'storage' && (
            <>
              {/* 分组 1：运行缓存与自动清洁 */}
              <div className="fluent-group-title">
                <span>运行缓存与自动清洁</span>
                <HelpButton
                  title="什么是运行缓存？"
                  content={'【运行缓存与自动清洁说明】：\n\n· 运行缓存：Chromium 渲染引擎、V8 脚本编译及 GPU 生成的临时文件。清理缓存完全不会影响你的项目工程和设计数据！\n· 自动清洁：开启后，每次打开软件会自动清除临时缓存与孤立快照，保持软件轻盈敏捷。'}
                />
              </div>

              {/* 卡片 1：一键清理运行缓存 */}
              <div className="fluent-card">
                <div className="fluent-card-icon"><Icon name="broom" /></div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">运行临时缓存 (Chromium Cache)</div>
                  <div className="fluent-card-desc">
                    当前检测占用: <b style={{ color: 'var(--accent)', fontFamily: 'Consolas' }}>{storageStats ? formatBytes(storageStats.cacheSize) : '扫描中…'}</b>（安全清理，不影响项目工程）
                  </div>
                </div>
                <div className="fluent-card-ctrl" style={{ display: 'flex', gap: 6, flexShrink: 0, alignSelf: 'center' }}>
                  <button className="btn-secondary btn-mini" onClick={refreshStorageStats} title="重新扫描大小">
                    ⟳ 刷新
                  </button>
                  <button
                    className="btn-primary btn-mini"
                    disabled={cleaningCache}
                    onClick={handleClearCache}
                  >
                    {cleaningCache ? '清理中…' : '一键立即清理'}
                  </button>
                </div>
              </div>

              {/* 卡片 2：启动时自动清理缓存 */}
              <div className="fluent-card">
                <div className="fluent-card-icon"><Icon name="bolt" /></div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">启动时自动清理临时缓存 (Auto Clean Cache)</div>
                  <div className="fluent-card-desc">开启后每次启动程序会自动清空渲染与编译缓存，保持轻盈无冗余。</div>
                </div>
                <div className="fluent-card-ctrl">
                  <label className="fluent-switch">
                    <input
                      type="checkbox"
                      checked={autoCleanCache}
                      onChange={(e) => toggleAutoCleanCache(e.target.checked)}
                    />
                    <span className="fluent-slider" />
                  </label>
                </div>
              </div>

              {/* 卡片 3：启动时自动清理孤立快照 */}
              <div className="fluent-card">
                <div className="fluent-card-icon">🗑️</div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">启动时自动清理孤立残留快照 (Auto Clean Orphans)</div>
                  <div className="fluent-card-desc">
                    {storageStats && storageStats.orphanBackupsCount > 0 ? (
                      <span style={{ color: '#d97706' }}>检测到 <b>{storageStats.orphanBackupsCount}</b> 处已删除项目残留快照。开启后启动时自动粉碎。</span>
                    ) : (
                      '自动扫描已在外部删除的项目遗留历史快照并自动清理，保持备份目录整洁。'
                    )}
                  </div>
                </div>
                <div className="fluent-card-ctrl" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {storageStats && storageStats.orphanBackupsCount > 0 && (
                    <button className="btn-mini btn-danger" onClick={handleClearOrphanBackups}>
                      立即清理
                    </button>
                  )}
                  <label className="fluent-switch">
                    <input
                      type="checkbox"
                      checked={autoCleanOrphans}
                      onChange={(e) => toggleAutoCleanOrphans(e.target.checked)}
                    />
                    <span className="fluent-slider" />
                  </label>
                </div>
              </div>

              {/* 分组 2：纯便携 data/ 目录占用 */}
              <div className="fluent-group-title">
                <span>纯便携数据目录占用 (data/)</span>
              </div>

              <div className="fluent-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="fluent-card-icon">📁</div>
                    <div>
                      <div className="fluent-card-title">便携数据根目录</div>
                      <div className="fluent-card-desc" style={{ fontFamily: 'Consolas', fontSize: 11 }}>
                        {paths?.dataRoot || '正在获取…'} · 总占用: <b style={{ color: 'var(--text)' }}>{storageStats ? formatBytes(storageStats.totalSize) : '…'}</b>
                      </div>
                    </div>
                  </div>
                  <div className="fluent-card-ctrl">
                    <button className="btn-secondary btn-mini" onClick={() => window.bc.openDataPath('data')}>
                      打开 data 目录
                    </button>
                  </div>
                </div>

                <div className="fluent-storage-grid">
                  <div className="fluent-storage-item">
                    <span className="fluent-storage-label">临时与编译缓存</span>
                    <span className="fluent-storage-val" style={{ color: 'var(--accent)' }}>
                      {storageStats ? formatBytes(storageStats.cacheSize) : '…'}
                    </span>
                  </div>
                  <div className="fluent-storage-item">
                    <span className="fluent-storage-label">历史快照与备份</span>
                    <span className="fluent-storage-val">
                      {storageStats ? formatBytes(storageStats.backupsSize) : '…'}
                    </span>
                  </div>
                  <div className="fluent-storage-item">
                    <span className="fluent-storage-label">项目工程文件 (.bcproj)</span>
                    <span className="fluent-storage-val">
                      {storageStats ? formatBytes(storageStats.projectsSize) : '…'}
                    </span>
                  </div>
                  <div className="fluent-storage-item">
                    <span className="fluent-storage-label">扩展与插件包</span>
                    <span className="fluent-storage-val">
                      {storageStats ? formatBytes(storageStats.extensionsSize) : '…'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 分组 3：自动备份策略 */}
              <div className="fluent-group-title">
                <span>自动备份与快照策略</span>
              </div>

              <div className="fluent-card">
                <div className="fluent-card-icon"><Icon name="clock" /></div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">自动备份时间间隔 (Auto Backup Interval)</div>
                  <div className="fluent-card-desc">系统在后台自动为你创建备份快照的频率周期。</div>
                </div>
                <div className="fluent-card-ctrl">
                  <select
                    className="fluent-select"
                    value={backupInterval}
                    onChange={(e) => changeBackupInterval(Number(e.target.value))}
                  >
                    <option value={30000}>每 30 秒 (高频防丢)</option>
                    <option value={60000}>每 1 分钟 (默认推荐)</option>
                    <option value={180000}>每 3 分钟</option>
                    <option value={300000}>每 5 分钟</option>
                    <option value={600000}>每 10 分钟</option>
                    <option value={0}>关闭自动备份</option>
                  </select>
                </div>
              </div>

              <div className="fluent-card">
                <div className="fluent-card-icon">📦</div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">历史快照最大保留数量 (Max Snapshots)</div>
                  <div className="fluent-card-desc">每个项目专属保留的历史版本上限，超出后自动轮转覆盖最旧版本。</div>
                </div>
                <div className="fluent-card-ctrl">
                  <select
                    className="fluent-select"
                    value={maxSnapshots}
                    onChange={(e) => changeMaxSnapshots(Number(e.target.value))}
                  >
                    <option value={5}>最多 5 份</option>
                    <option value={10}>最多 10 份</option>
                    <option value={15}>最多 15 份 (默认)</option>
                    <option value={30}>最多 30 份</option>
                    <option value={50}>最多 50 份 (大量历史)</option>
                  </select>
                </div>
              </div>

              <div className="fluent-card">
                <div className="fluent-card-icon">🌐</div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">本地全部项目与备份中心</div>
                  <div className="fluent-card-desc">查看全部 .bcproj 项目工程，或按项目载入历史快照。</div>
                </div>
                <div className="fluent-card-ctrl">
                  <button className="btn-primary btn-mini" onClick={onOpenWebManager}>
                    打开项目与备份列表
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ——— 3b. 自动更新（紧接存储区块内） ——— */}
          {section === 'storage' && (
            <>
              <div className="fluent-group-title" style={{ marginTop: 16 }}>自动更新</div>
              <div className="fluent-card">
                <div className="fluent-card-icon">🔄</div>
                <div className="fluent-card-info">
                  <div className="fluent-card-title">更新中心</div>
                  <div className="fluent-card-desc">
                    连接 GitHub Releases（含预发布版）检查最新版本；下载走 gh-proxy 镜像加速，
                    自动替换程序文件并完整保留 data/ 数据。
                    <br /><span style={{ color: '#c62828', fontWeight: 600 }}>注意：请确保后台关闭 Watt Toolkit（原 Clash Verge），否则镜像无法使用。</span>
                  </div>
                </div>
                <div className="fluent-card-ctrl">
                  <button className="btn-primary btn-mini" onClick={() => onOpenUpdateCenter?.()}>
                    打开更新中心
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ——— 4. 工具栏管理（v0.4.3 重写：真实样式预览 + 拖拽排序 + 独立开关） ——— */}
          {section === 'toolbar' && <ToolbarManagerSection
            resetToolbar={resetToolbar}
          />}

          {/* ——— 5. 扩展与插件 (完全内嵌) ——— */}
          {section === 'extensions' && (
            <EmbeddedExtensionsSection onOpenDir={() => window.bc.openExtensionsDir()} />
          )}

          {/* ——— 6. 关于与系统 ——— */}
          {section === 'about' && (
            <>
              <div className="fluent-group-title">软件信息</div>
              <div className="fluent-about-box">
                <div className="fluent-about-hero">
                  <span className="fluent-hero-logo">⚡</span>
                  <div className="fluent-hero-text">
                    <div className="fluent-hero-title">BlockCanvas 积木画布</div>
                    <div className="fluent-hero-ver">版本 {appVersion || '…'}</div>
                  </div>
                </div>

                <p className="fluent-about-p">
                  专为零基础用户打造的现代化可视化网页工厂。底层基于纯净 CSS 选择器引擎与响应式流式布局架构，产物为手写级极简 HTML + CSS 代码。
                </p>

                <div className="fluent-tech-tags">
                  <span className="fluent-tech-tag">纯便携 data/ 架构</span>
                  <span className="fluent-tech-tag">Electron 33</span>
                  <span className="fluent-tech-tag">React 18</span>
                  <span className="fluent-tech-tag">TypeScript</span>
                  <span className="fluent-tech-tag">Zustand</span>
                  <span className="fluent-tech-tag">MIT License</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ 内嵌扩展与插件管理组件 ============
function EmbeddedExtensionsSection(props: { onOpenDir: () => void }) {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [makeForm, setMakeForm] = useState({ name: '', id: '', version: '1.0.0', author: '', description: '' });

  const rescan = () => {
    setScan(null);
    window.bc.scanExtensions().then(setScan);
  };
  useEffect(() => { rescan(); }, []);

  const toggleExpand = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const run = async (label: string, fn: () => Promise<{ ok: boolean; error?: string; canceled?: boolean; path?: string }>) => {
    try {
      const r = await fn();
      if (r.ok) {
        if (r.path) alert(label + '成功：' + r.path);
      } else if (!r.canceled) {
        alert(label + '失败：' + (r.error ?? '未知错误'));
      }
      rescan();
      return r.ok;
    } catch (e) {
      alert(label + '异常：' + (e as Error).message);
      return false;
    }
  };

  const pluginsChanged = () => window.dispatchEvent(new CustomEvent('bc:plugins-changed'));

  const onToggleEnabled = async (kind: 'plugins' | 'resources', id: string, enabled: boolean) => {
    const ok = await run(enabled ? '启用' : '禁用', () => window.bc.setExtensionEnabled(kind, id, enabled));
    if (kind === 'plugins' && ok) pluginsChanged();
  };

  const onDelete = async (kind: 'plugins' | 'resources', id: string) => {
    if (confirm(`确定要删除扩展「${id}」吗？`)) {
      const ok = await run('删除', () => window.bc.deleteExtension(kind, id));
      if (kind === 'plugins' && ok) pluginsChanged();
    }
  };

  const onCreatePackage = async () => {
    if (!makeForm.name.trim()) { alert('请填写资源包名称'); return; }
    const r = await window.bc.createResourcePackage({ ...makeForm, id: makeForm.id || undefined });
    if (r.ok) {
      alert('已生成资源包结构：\n' + (r.path ?? ''));
      setCreating(false);
      setMakeForm({ name: '', id: '', version: '1.0.0', author: '', description: '' });
      rescan();
    } else {
      alert('生成失败：' + (r.error ?? '未知错误'));
    }
  };

  return (
    <>
      <div className="fluent-group-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>扩展管理动作</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-secondary btn-mini" onClick={props.onOpenDir}><Icon name="external" size={14} /> 打开扩展文件夹</button>
          <button className="btn-secondary btn-mini" onClick={rescan}><Icon name="refresh" size={14} /> 重新扫描</button>
        </div>
      </div>

      <div className="fluent-card fluent-ext-toolbar-card">
        <div className="fluent-ext-btn-grid">
          <button className="fluent-ext-action-btn" onClick={() => run('导入模板包', () => window.bc.importExtensionFolder('resources'))}>
            <span className="action-icon"><Icon name="importFolder" /></span>
            <div className="action-texts">
              <span className="action-title">导入模板包文件夹</span>
              <span className="action-sub">包含 manifest.json 的目录</span>
            </div>
          </button>

          <button className="fluent-ext-action-btn" onClick={() => run('导入模板包 ZIP', () => window.bc.importExtensionZip('resources'))}>
            <span className="action-icon"><Icon name="importZip" /></span>
            <div className="action-texts">
              <span className="action-title">导入模板包 ZIP</span>
              <span className="action-sub">解包导入模板资源</span>
            </div>
          </button>

          <button className="fluent-ext-action-btn" onClick={() => run('导入插件', () => window.bc.importExtensionFolder('plugins'))}>
            <span className="action-icon"><Icon name="plug" /></span>
            <div className="action-texts">
              <span className="action-title">导入插件文件夹</span>
              <span className="action-sub">包含入口代码的插件目录</span>
            </div>
          </button>

          <button className="fluent-ext-action-btn" onClick={() => run('导入插件 ZIP', () => window.bc.importExtensionZip('plugins'))}>
            <span className="action-icon"><Icon name="importZip" /></span>
            <div className="action-texts">
              <span className="action-title">导入插件 ZIP</span>
              <span className="action-sub">自动安装并加载插件</span>
            </div>
          </button>

          <button className="fluent-ext-action-btn" onClick={() => setCreating(!creating)}>
            <span className="action-icon"><Icon name="plus" /></span>
            <div className="action-texts">
              <span className="action-title">{creating ? '取消骨架生成' : '新建模板包结构'}</span>
              <span className="action-sub">在 data/extensions 快速生成骨架</span>
            </div>
          </button>
        </div>

        {creating && (
          <div className="ext-make-box" style={{ padding: '12px 0 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input
                className="fluent-select"
                placeholder="资源包名称 (如：酷炫卡片包)"
                value={makeForm.name}
                onChange={(e) => setMakeForm({ ...makeForm, name: e.target.value })}
              />
              <input
                className="fluent-select"
                placeholder="目录 ID (留空自动按拼音/英文)"
                value={makeForm.id}
                onChange={(e) => setMakeForm({ ...makeForm, id: e.target.value })}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button className="btn-primary btn-mini" onClick={onCreatePackage}>立即在 data/extensions/ 创建结构</button>
            </div>
          </div>
        )}
      </div>

      {/* 资源包列表 */}
      <div className="fluent-group-title">模板资源包 ({scan?.resources.length || 0})</div>
      {scan?.resources.map((r) => (
        <div key={r.id} className={"fluent-ext-card" + (!r.enabled ? " is-disabled" : "")}>
          <div className="fluent-ext-main">
            <span className="fluent-ext-icon">📁</span>
            <div className="fluent-ext-text">
              <div className="fluent-ext-name-row">
                <span className="fluent-ext-name">{r.name}</span>
                <span className="fluent-ext-tag">{r.id}</span>
                <span className="fluent-ext-ver">v{r.version || '1.0'}</span>
              </div>
              <div className="fluent-ext-desc">{r.description || '暂无描述'} · 包含 {r.templates.length} 个模板</div>
            </div>
            <div className="fluent-ext-actions">
              <button className="btn-secondary btn-mini" onClick={() => toggleExpand(r.id)}>
                {expanded[r.id] ? '收起模板 ▴' : `查看 ${r.templates.length} 个模板 ▾`}
              </button>
              <label className="fluent-switch" title={r.enabled ? '已启用（点击禁用）' : '已禁用（点击启用）'}>
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => onToggleEnabled('resources', r.id, e.target.checked)}
                />
                <span className="fluent-slider" />
              </label>
              <button className="btn-mini wm-del-btn" onClick={() => onDelete('resources', r.id)} title="从扩展库删除">
                删除
              </button>
            </div>
          </div>

          {expanded[r.id] && (
            <Collapse open={!!expanded[r.id]}>
              <div className="fluent-ext-sublist">
                {r.templates.map((t) => (
                  <div key={t.id} className="fluent-ext-subitem">
                    <span className="fluent-ext-subname">📄 {t.name}</span>
                    <span className="fluent-ext-subdesc">{t.description || ''}</span>
                  </div>
                ))}
              </div>
            </Collapse>
          )}
        </div>
      ))}

      {/* 插件列表 */}
      <div className="fluent-group-title">功能插件 ({scan?.plugins.length || 0})</div>
      {scan?.plugins.map((p) => (
        <div key={p.id} className={"fluent-ext-card" + (!p.enabled ? " is-disabled" : "")}>
          <div className="fluent-ext-main">
            <span className="fluent-ext-icon"><Icon name="plug" /></span>
            <div className="fluent-ext-text">
              <div className="fluent-ext-name-row">
                <span className="fluent-ext-name">{p.name}</span>
                <span className="fluent-ext-tag">{p.id}</span>
                <span className="fluent-ext-ver">v{p.version || '1.0'}</span>
              </div>
              <div className="fluent-ext-desc">{p.description || '暂无描述'}</div>
            </div>
            <div className="fluent-ext-actions">
              <label className="fluent-switch" title={p.enabled ? '已启用（点击禁用）' : '已禁用（点击启用）'}>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => onToggleEnabled('plugins', p.id, e.target.checked)}
                />
                <span className="fluent-slider" />
              </label>
              <button className="btn-mini wm-del-btn" onClick={() => onDelete('plugins', p.id)} title="从扩展库删除">
                删除
              </button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

// ============ 工具栏管理（v0.4.4 · 全按钮自由池） ============
// 预览 = 一条真实样式的工具栏（主区 + 右侧区），chips 可直接拖拽排序；
// 列表 = 每个按钮一行（拖拽手柄 + 名称 + 停靠三段开关：主区 / 右侧 / 更多）。
// 「更多」= 不直接显示，点工具栏右端「⋯」可用 —— 任何按钮（含编辑操作、设备切换、
// 缩放、体检、设置）都能收进去。数据与主程序共用 toolbarStore，改完立即生效。

type TbDrag = { id: string } | null;

const DOCK_LABEL: Record<ToolbarDock, string> = { main: '主区', right: '右侧', more: '更多' };
const DOCK_HINT: Record<ToolbarDock, string> = {
  main: '显示在工具栏主区（可滚动）',
  right: '固定在工具栏右端',
  more: '收进「⋯更多」，不占工具栏位置'
};

function ToolbarManagerSection(props: { resetToolbar: () => void }) {
  const { resetToolbar } = props;
  const items = useToolbar((s) => s.items);
  const docks = useToolbar((s) => s.docks);
  const userOrder = useToolbar((s) => s.order);
  const setOrder = useToolbar((s) => s.setOrder);
  const setDock = useToolbar((s) => s.setDock);

  // 全局顺序（用户排序优先，其余按注册 order 兜底）
  const ordered = getSortedItems(items, userOrder);
  const mainRows = ordered.filter((it) => dockOf(it, docks) === 'main');
  const rightRows = ordered.filter((it) => dockOf(it, docks) === 'right');

  // —— 拖拽状态（列表行与预览 chips 共用同一套逻辑）——
  const [drag, setDrag] = useState<TbDrag>(null);
  const [dropAt, setDropAt] = useState<{ id: string; before: boolean } | null>(null);

  const commitReorder = (targetId: string, before: boolean) => {
    if (!drag || drag.id === targetId) return;
    const seq = ordered.map((it) => it.id);
    const from = seq.indexOf(drag.id);
    if (from < 0) return;
    seq.splice(from, 1);
    const to = seq.indexOf(targetId);
    if (to < 0) return;
    seq.splice(before ? to : to + 1, 0, drag.id);
    setOrder(seq);
  };

  const endDrag = () => { setDrag(null); setDropAt(null); };

  const rowDragProps = (id: string) => ({
    draggable: true,
    onDragStart: () => setDrag({ id }),
    onDragEnd: endDrag,
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (!drag || drag.id === id) return;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      setDropAt({ id, before });
    },
    onDragLeave: (e: React.DragEvent) => {
      if (dropAt?.id === id) setDropAt(null);
      e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dropAt) commitReorder(dropAt.id, dropAt.before);
      endDrag();
    }
  });

  const chipClass = (id: string) =>
    'tbman-chip' + (drag?.id === id ? ' is-dragging' : '') + (dropAt?.id === id && dropAt.before ? ' is-drop-before' : '');

  const rowCls = (id: string) =>
    'tbman-row' + (drag?.id === id ? ' is-dragging' : '') +
    (dropAt?.id === id ? (dropAt.before ? ' is-drop-before' : ' is-drop-after') : '');

  const nameOf = (it: ToolbarItem) => (typeof it.label === 'function' ? it.label() : (it.label ?? it.id));

  const renderRow = (it: ToolbarItem) => {
    const cur = dockOf(it, docks);
    return (
      <div
        key={it.id}
        className={rowCls(it.id)}
        {...rowDragProps(it.id)}
        title="按住拖动可调整按钮的顺序（跨停靠区有效）"
      >
        <span className="tbman-grip">⠿</span>
        <span className="tbman-name">{nameOf(it)}</span>
        {it.id.startsWith('plg.') && <span className="tbman-tag">插件</span>}
        <div className="tbman-dock" role="group" aria-label="停靠区">
          {(['main', 'right', 'more'] as ToolbarDock[]).map((d) => (
            <button
              key={d}
              className={'tbman-dock-btn' + (cur === d ? ' active' : '')}
              onClick={() => setDock(it.id, d)}
              title={DOCK_HINT[d]}
            >{DOCK_LABEL[d]}</button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="fluent-group-title">工具栏预览（可直接拖动调整顺序）</div>
      <div className="fluent-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="tbman-preview">
          {mainRows.length === 0 && <span className="tbman-empty">主区没有按钮 —— 到下方把停靠切到「主区」</span>}
          {mainRows.map((it) => (
            <span key={it.id} className={chipClass(it.id)} {...rowDragProps(it.id)}>
              <span className="tbman-chip-grip">⠿</span>
              {nameOf(it)}
            </span>
          ))}
          <span className="tbman-preview-sep" />
          {rightRows.map((it) => (
            <span key={it.id} className={chipClass(it.id) + ' is-right'} {...rowDragProps(it.id)}>
              <span className="tbman-chip-grip">⠿</span>
              {nameOf(it)}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            左段 = 主区（放不下自动滚动），右段 = 固定在右端；停靠切「更多」的按钮收进工具栏右端「⋯」。
          </span>
          <button
            className="btn-mini"
            onClick={() => { resetToolbar(); }}
            title="清除排序与停靠记忆，恢复出厂布局"
          >恢复默认布局</button>
        </div>
      </div>

      <div className="tbman-group-title">
        <span>全部按钮</span>
        <small>{ordered.length} 个 · 含插件注册的按钮</small>
      </div>
      <div className="fluent-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="tbman-list">
          {ordered.length === 0 && <span className="tbman-empty">尚未注册（回到编辑器后自动出现）</span>}
          {ordered.map(renderRow)}
        </div>
      </div>
    </>
  );
}