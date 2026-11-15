import { useRef, useState } from 'react';
import { DEVICE_LIST, requestDevice, useEffectiveDevice, widthLabel, widthToDevice } from '@lib/device';
import { setAltMode, useAltMode } from '@lib/altMode';
import { resetCanvasView, stepCanvasZoom } from '@lib/canvasView';
import type { ToolbarItem } from '@store/toolbarStore';
import { AnchoredPanel } from '../AnchoredPanel';
import { Icon, resolveIconName } from '../Icon';
import type { ToolbarOp } from '../Toolbar';

// BlockCanvas · v0.4.6 竖屏第二条操作栏（固定 9 个按钮）
// ----------------------------------------------------------------------------
// 为什么单独一个组件而不是继续在 Toolbar 里做「按 id 挑按钮」：
//   用户明确说竖屏这套**排列不可配置**（"固定一套按钮"），而且层级只有两级
//   （操作 / 设备 / 更多 三个二级菜单）。继续复用桌面那套
//   「sorted → mainItems/rightItems/moreItems → renderArea」反而要写一堆
//   `portrait ? … : …` 分支去扭曲桌面逻辑，桌面端随时可能被带崩（历史教训）。
//   于是：桌面端原样留在 Toolbar.tsx，竖屏走这里，两边只共用 OPS 表（opMap）。
//
// 顺序（用户逐字指定，从左到右）：
//   操作 / 设备 / 更多 / 预览 / 轮廓 / 体检 / 导出 HTML / 全部项目 / 导出元素模板
//
// 三个二级菜单都是**贴着按钮上方**弹出的：AnchoredPanel 会按真实空间自动向上翻，
// 而第二条栏本来就在屏幕最下方（第一条栏之上），下方根本放不下 → 必然朝上。

type MenuKey = 'ops' | 'device' | 'more';

export function PortraitToolbar(props: {
  /** Toolbar.tsx 里的内建操作表（含 disabled / label / icon），竖屏菜单直接复用，避免两套文案 */
  opMap: Map<string, ToolbarOp>;
  /** 全部注册项（内建 + 块 + 插件）：插件按钮一律收进「更多」 */
  items: ToolbarItem[];
  canvasWidth: string;
  onCanvasWidthChange: (v: string) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
  /** 已带体检闸门（Toolbar 的 doExport） */
  onExport: () => void;
  onPreview: () => void;
  onExportTemplate: () => void;
  outlines: boolean;
  onToggleOutlines: () => void;
  issueCount: number;
  onOpenHealth: () => void;
}) {
  const {
    opMap, items, canvasWidth, onCanvasWidthChange, zoom, onZoomChange,
    onExport, onPreview, onExportTemplate, outlines, onToggleOutlines,
    issueCount, onOpenHealth
  } = props;

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const opsRef = useRef<HTMLButtonElement>(null);
  const deviceRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  const alt = useAltMode();
  const pct = Math.round(zoom * 100);
  // 设备图标 = **当前画布状态**（固定宽度按宽度落回设备；自适应时按画布实际渲染宽度回落）。
  // ⚠ 文字永远是「设备」—— 以前写成「自适应」，用户明确纠正过：
  //   按钮显示的是"我现在是什么设备"，"自适应"只是菜单里的一个选项。
  const liveDevice = useEffectiveDevice(canvasWidth);
  const deviceDef = DEVICE_LIST.find((d) => d.id === liveDevice) ?? DEVICE_LIST[0];
  const fixedDevice = widthToDevice(canvasWidth);

  // 插件按钮：既不是内建 op、也不是块级项（设备/缩放/体检）的就是插件注册的
  const plugins = items.filter((it) => !it.block && !opMap.has(it.id));

  const toggle = (k: MenuKey) => setOpenMenu((cur) => (cur === k ? null : k));

  /** 内建操作在菜单里的样子：图标 + 动态文字 + 和桌面完全一致的 disabled 判定 */
  const opItem = (id: string) => {
    const op = opMap.get(id);
    if (!op) return null;
    return (
      <button
        key={id}
        type="button"
        className="tb-more-item"
        title={op.title}
        disabled={op.disabled ? op.disabled() : false}
        onClick={() => { op.onClick(); setOpenMenu(null); }}
      >
        <span className="tb-icon"><Icon name={op.icon} size={15} /></span>{op.label()}
      </button>
    );
  };

  return (
    <div className="pt-toolbar">
      {/* 1 · 操作：复制 / 粘贴 / 副本 / 删除（用户："操作（把删除和副本塞里面）"） */}
      <button
        ref={opsRef}
        type="button"
        className={'pt-tbtn' + (openMenu === 'ops' ? ' is-open' : '')}
        data-key="ops"
        title="操作：复制 / 粘贴 / 副本 / 删除"
        onClick={() => toggle('ops')}
      >
        <span className="pt-tbtn-ico"><Icon name="sliders" size={16} /></span>
        <span className="pt-tbtn-label">操作</span>
      </button>
      <AnchoredPanel
        open={openMenu === 'ops'}
        anchorRef={opsRef}
        onClose={() => setOpenMenu(null)}
        className="pt-tbtn-menu"
        align="left"
      >
        {opItem('copy')}
        {opItem('paste')}
        <div className="pt-menu-sep" />
        {opItem('duplicate')}
        {opItem('delete')}
      </AnchoredPanel>

      {/* 2 · 设备：图标=当前设备，文字永远「设备」，「自适应」是菜单第一项 */}
      <button
        ref={deviceRef}
        type="button"
        className={'pt-tbtn' + (openMenu === 'device' ? ' is-open' : '')}
        data-key="device"
        title={`设备断点：当前 ${widthLabel(canvasWidth)}（切换会同时改变画布宽度与编辑断点）`}
        onClick={() => toggle('device')}
      >
        <span className="pt-tbtn-ico"><Icon name={deviceDef.iconName} size={16} /></span>
        <span className="pt-tbtn-label">设备</span>
      </button>
      <AnchoredPanel
        open={openMenu === 'device'}
        anchorRef={deviceRef}
        onClose={() => setOpenMenu(null)}
        className="pt-tbtn-menu"
        align="left"
      >
        <button
          type="button"
          className={'tb-more-item' + (canvasWidth === 'auto' ? ' is-on active' : '')}
          onClick={() => { onCanvasWidthChange('auto'); setOpenMenu(null); }}
        >
          <span className="tb-icon"><Icon name="responsive" size={15} /></span>自适应
          {canvasWidth === 'auto' && <span className="pt-menu-check">✓</span>}
        </button>
        {DEVICE_LIST.map((d) => (
          <button
            key={d.id}
            type="button"
            className={'tb-more-item' + (canvasWidth !== 'auto' && fixedDevice === d.id ? ' is-on active' : '')}
            title={d.hint}
            onClick={() => { requestDevice(d.id); setOpenMenu(null); }}
          >
            <span className="tb-icon"><Icon name={d.iconName} size={15} /></span>{d.label}
            {canvasWidth !== 'auto' && fixedDevice === d.id && <span className="pt-menu-check">✓</span>}
          </button>
        ))}
      </AnchoredPanel>

      {/* 3 · 更多：Alt 开关 / 撤销 / 重做 / 剪切 / 取消选中 / 缩放 / 全部插件按钮 */}
      <button
        ref={moreRef}
        type="button"
        className={'pt-tbtn' + (openMenu === 'more' ? ' is-open' : '')}
        data-key="more"
        title="更多：Alt 模式、撤销重做、剪切、取消选中、缩放、插件命令"
        onClick={() => toggle('more')}
      >
        {/* ⚠ 用「⋯」而不是三条横线：最底那条栏里已经有一颗"三"的入口按钮，
            两个都画成三条线会分不清（用户原话：「最右侧的类似"三"的按钮」）。 */}
        <span className="pt-tbtn-ico pt-tbtn-dots" aria-hidden="true">⋯</span>
        <span className="pt-tbtn-label">更多</span>
      </button>
      <AnchoredPanel
        open={openMenu === 'more'}
        anchorRef={moreRef}
        onClose={() => setOpenMenu(null)}
        className="pt-tbtn-menu"
        align="left"
      >
        {/* 开关项：开着时 accent + ✓，文字带「（已开启）」，一眼能看出状态 */}
        <button
          type="button"
          className={'tb-more-item pt-menu-switch' + (alt ? ' is-on' : '')}
          title={alt ? 'Alt 模式已开启：画布按电脑端方式操作' : '开启 Alt 模式（等同于一直按住 Alt）'}
          aria-pressed={alt}
          onClick={() => setAltMode(!alt)}
        >
          <span className="tb-icon"><Icon name="option" size={15} /></span>
          {alt ? 'Alt 模式（已开启）' : 'Alt 模式'}
          {alt && <span className="pt-menu-check">✓</span>}
        </button>
        <div className="pt-menu-sep" />
        {opItem('undo')}
        {opItem('redo')}
        {opItem('cut')}
        {opItem('clear-selection')}
        <div className="pt-menu-sep" />
        {/* 放大 / 缩小：双指能替代大部分场景，但"想精确回到 100% / 再放大一点"
            用手指捏很难稳（用户实测反馈）。所以按固定档位给两颗按钮，
            到顶 / 到底自动置灰。档位定义见 lib/canvasView.ts 的 ZOOM_STEPS。 */}
        <button
          type="button"
          className="tb-more-item"
          title={`放大一档（当前 ${pct}%）`}
          disabled={pct >= 400}
          onClick={() => stepCanvasZoom(zoom, 1, onZoomChange)}
        >
          <span className="tb-icon"><Icon name="zoomIn" size={15} /></span>放大
        </button>
        <button
          type="button"
          className="tb-more-item"
          title={`缩小一档（当前 ${pct}%）`}
          disabled={pct <= 10}
          onClick={() => stepCanvasZoom(zoom, -1, onZoomChange)}
        >
          <span className="tb-icon"><Icon name="zoomOut" size={15} /></span>缩小
        </button>
        {/* 缩放：只显示百分比，点一下还原 100%（触摸屏没有 Ctrl+滚轮，也不适合拖）。
            还原时顺带把画布"回正"（滚回左上、清掉手势残留位移）——
            用户：「还原大小的时候同时回正画布，现在画布不会全部在屏幕区域，有些在屏幕外面。」 */}
        <button
          type="button"
          className="tb-more-item"
          title="缩放：点一下还原 100%（同时把画布回正）"
          onClick={() => { resetCanvasView(onZoomChange); setOpenMenu(null); }}
        >
          <span className="tb-icon"><Icon name="zoomIn" size={15} /></span>缩放
          <span className="pt-menu-val">{pct}%</span>
        </button>
        {plugins.length > 0 && <div className="pt-menu-sep" />}
        {plugins.map((it) => {
          // 插件 icon 是字符串：能对上图标名就画 SVG，否则当 emoji/短字符原样渲染
          const ico = resolveIconName(it.icon);
          const text = typeof it.label === 'function' ? it.label() : (it.label ?? it.id);
          return (
            <button
              key={it.id}
              type="button"
              className="tb-more-item"
              title={it.title}
              disabled={it.disabled ? it.disabled() : false}
              onClick={() => { it.onClick?.(); setOpenMenu(null); }}
            >
              {ico
                ? <span className="tb-icon"><Icon name={ico} size={15} /></span>
                : it.icon ? <span className="tb-icon">{it.icon}</span> : null}
              {text}
            </button>
          );
        })}
      </AnchoredPanel>

      {/* 4 · 预览（竖屏走程序内全屏 iframe，逻辑在 Toolbar 的 previewNow 里） */}
      <button type="button" className="pt-tbtn" data-key="preview" title="预览（Ctrl+P）" onClick={onPreview}>
        <span className="pt-tbtn-ico"><Icon name="play" size={16} /></span>
        <span className="pt-tbtn-label">预览</span>
      </button>

      {/* 5 · 轮廓（开关态） */}
      <button
        type="button"
        className={'pt-tbtn' + (outlines ? ' is-on' : '')}
        data-key="outline"
        aria-pressed={outlines}
        title="显示元素轮廓：给画布所有元素加暗蓝虚线框，方便看清 div 占位与嵌套（不导出）"
        onClick={onToggleOutlines}
      >
        <span className="pt-tbtn-ico"><Icon name="outline" size={16} /></span>
        <span className="pt-tbtn-label">轮廓</span>
      </button>

      {/* 6 · 体检（带问题数角标） */}
      <button
        type="button"
        className={'pt-tbtn' + (issueCount > 0 ? ' has-issue' : '')}
        data-key="health"
        title="导出前体检：未命名元素、重复 ID、伪类失效、同名样式不统一……按严重度列出并支持一键修复"
        onClick={onOpenHealth}
      >
        <span className="pt-tbtn-ico"><Icon name="warning" size={16} /></span>
        <span className="pt-tbtn-label">体检</span>
        {issueCount > 0 && <span className="pt-tbtn-badge">{issueCount}</span>}
      </button>

      {/* 7 · 导出 HTML */}
      <button type="button" className="pt-tbtn is-primary" data-key="export-html" title="导出 HTML 网页文件 (Ctrl+E)" onClick={onExport}>
        <span className="pt-tbtn-ico"><Icon name="download" size={16} /></span>
        <span className="pt-tbtn-label">导出 HTML</span>
      </button>

      {/* 8 · 全部项目 */}
      <button
        type="button"
        className="pt-tbtn"
        data-key="projects"
        title="浏览全部本地项目库与专属快照备份"
        onClick={() => window.dispatchEvent(new CustomEvent('bc:open-projects'))}
      >
        <span className="pt-tbtn-ico"><Icon name="folderOpen" size={16} /></span>
        <span className="pt-tbtn-label">全部项目</span>
      </button>

      {/* 9 · 导出元素模板（没选中元素时禁用，判定直接复用 opMap 里的那份） */}
      <button
        type="button"
        className="pt-tbtn"
        data-key="export-template"
        title="把选中元素（含子级）导出为模板 JSON 文件"
        onClick={onExportTemplate}
        disabled={opMap.get('export-template')?.disabled?.() ?? false}
      >
        <span className="pt-tbtn-ico"><Icon name="bookmark" size={16} /></span>
        <span className="pt-tbtn-label">导出元素模板</span>
      </button>
    </div>
  );
}
