import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from '@comp/ErrorBoundary';
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
import './animations.css'; // 统一动画体系：token + 全部 keyframes（分片里只写引用）

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary label="BlockCanvas">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
