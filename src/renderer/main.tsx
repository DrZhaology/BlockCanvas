import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from '@comp/ErrorBoundary';
import { startAnimGovernor } from '@lib/animGovernor';
import { warmHomeBackground } from '@lib/preloadHomeBg';
import { installHost } from '../adapter/index';
import { installOverlayScrollbars } from '@lib/overlayScroll';
import './styles/01-foundation.css';
import './styles/02-tabbar.css';
import './styles/03-toolbar.css';
import './styles/04-workspace-canvas.css';
import './styles/05-inspector-core.css';
import './styles/06-element-panel.css';
import './styles/07-panels-bottom.css';
import './styles/08-inspector-props.css';
import './styles/09-class-template-ext.css';
import './styles/10-settings-projects.css';
import './styles/11-editors.css';
import './styles/12-toolbar-v041.css';
import './styles/13-polish-v040.css';
import './styles/14-v04x-append.css';
import './styles/15-v042-ui.css'; // v0.4.2：细滚动条 / 工具栏左右滚动 / 二级工具组 / 模板板块展开
import './styles/16-v042b-ui.css'; // 第二批：更新中心重写 / 工具栏预览 / 表格编辑页 / 布局溢出
import './styles/17-v043-table.css'; // v0.4.3：体检徽标不再被裁切 / 表格体检开关 / 向导说明
import './styles/18-v044-table-ui.css'; // v0.4.4：表格编辑器所见即所得（实时渲染 / 双击改字 / 预览拖动）
import './styles/19-v043-ui.css'; // v0.4.3：全局按钮基线 / 面板去嵌套 / 渐变色标行修复
import './styles/20-v044-ui.css'; // v0.4.4：更新中心（下载进度/发行说明/板块标题）/ 表格面板数值单位 / 工具栏＋插入按钮
import './styles/21-v044b-ui.css'; // v0.4.4b：表格自动命名提示 + Ctrl+C 复制反馈 + 编辑器与画布一致的微调
import './styles/22-v044c-ui.css'; // v0.4.4c：工具栏「任务」按钮 / 帮助中心（README+Markdown）/ 更新任务总览
import './styles/23-v044d-ui.css'; // v0.4.4d：UI 统一（动效/选择器）+ 画布 Alt 缩放移动 + 文字快捷调整 + 渐变扩散
import './styles/24-v044h-ui.css'; // v0.4.4h：Alt 墙提示 + 拖到墙外改父子关系 + 中键属性搜索两态 + 删除项目三步防护
import './styles/25-v044-storage-ui.css'; // v0.4.4：设置→存储占用明细（分类互斥可加和 + 分类清理）
import './styles/26-empty-home.css'; // v0.4.4：空页面（关掉全部标签后的首页）+ 全局轻提示 toast
import './styles/27-v045-ui.css'; // v0.4.5：只读快照预览 / 色标卡片 / 外轮廓 / 面板密度
import './styles/28-v045-zindex.css'; // v0.4.5：全程序 z-index 标尺落地 + 变量菜单 + 属性搜索高亮
import './styles/29-v045-perf.css'; // v0.4.5：动画性能（精简/关闭档、不可见暂停）+ 加载页深色底
import './styles/30-v046-viewport.css'; // v0.4.6：画布「首屏线」（fixed 的参照底面）
import './styles/31-v046-sticky.css'; // v0.4.6：sticky 生效状态角标 + 吸附线
import './styles/32-v046-codec.css'; // v0.4.6：视频编码不支持时的占位块 + 属性面板警告卡
import './styles/33-v046-shell.css'; // v0.4.6：窄屏外壳（左右面板抽屉化 + 触摸目标）
// v0.4.5：语义主题变量（深色插件化的地基）。
// 必须**最后**加载：旧的 foundation 里已经定义过 --danger-tint 等同名变量，
// 这里要覆盖它们，才能让"只写一次语义变量、深色自动切换"成立。
// 详见 docs/v0.4.5-待实施-多页与深色插件化.md
import './styles/00-theme-tokens.css';
import './animations.css'; // 统一动画体系：token + 全部 keyframes（分片里只写引用）
import './styles/34-v046-visual.css'; // v0.4.6：连续曲率圆角 + 圆角尺度 + 自绘窗口标题栏 + 窗口描边
import './styles/35-v046-cards.css'; // v0.4.6：画布元素进退场动画 + 属性卡片统一（不生效/临时只靠颜色区分）
import './styles/36-v046-portrait.css'; // v0.4.6：竖屏底部两条操作栏（顶部清空）
import './styles/37-v046-ctx.css'; // v0.4.6 第 43 批：竖屏情境栏（第三层）+ 底部栏体外观
import './styles/38-v046-ptoolbar.css'; // v0.4.6 第 43 批：竖屏第二条操作栏的九个按钮与二级菜单
import './styles/39-v046-pinch.css'; // v0.4.6 第 43 批：竖屏双指缩放（禁掉浏览器自带捏合）

// v0.4.5：动画性能总督（不可见即暂停 / 掉帧自动精简 / 尊重系统"减少动态效果"）。
// 必须在渲染之前启动：它要往 <html> 上写 data-bc-anim，避免首帧先按完整动效画一遍。
startAnimGovernor();

/**
 * v0.4.6（R6-11 / R6-13）：**宿主选择**。
 *
 * Electron 里 `window.bc` 由 preload 注入，这里什么都不做（行为零变化）；
 * 浏览器里没有 preload → 由 adapter 装上一份浏览器实现（IndexedDB + 下载）。
 * 必须放在 render 之前：App 一挂载就会调 window.bc.getSession()。
 *
 * 版本号由构建期注入（electron.vite.config 里的 define）—— 浏览器版没有
 * package.json 可读，只能编译进来。
 */
installHost(__BC_VERSION__, __BC_STAGE__);

// v0.4.5：**趁加载页还盖着**就把首页背景（图片/视频）预热起来。
// 否则"进首页 → 才开始下载背景图"会有明显的空白延迟（用户反馈过）。
// 放在 render 之前：它只是发请求，不阻塞首帧。
warmHomeBackground();

// v0.4.6：自绘滚动条（脱离文档流，不占布局宽度）。
// 必须在首帧之前装：原生滚动条一旦先画出来再藏掉，会先"抽"一次。
installOverlayScrollbars();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary label="BlockCanvas">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
