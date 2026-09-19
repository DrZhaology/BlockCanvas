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
import './animations.css'; // 统一动画体系：token + 全部 keyframes（分片里只写引用）

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary label="BlockCanvas">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
