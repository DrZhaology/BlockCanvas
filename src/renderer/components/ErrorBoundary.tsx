import { Component, type ReactNode } from 'react';

// 错误边界：捕获渲染期错误并显示可读报错，而不是整个应用白屏。
// 用法：<ErrorBoundary label="属性面板"><Inspector /></ErrorBoundary>
interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[BlockCanvas] 渲染错误：', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error.message || String(this.state.error);
      return (
        <div className="error-boundary">
          <div className="error-boundary-title">{(this.props.label ?? '界面') + ' 出错了'}</div>
          <div className="error-boundary-msg">{msg}</div>
          <div className="error-boundary-actions">
            <button onClick={() => this.setState({ error: null })}>重试</button>
            <button onClick={() => window.location.reload()}>重新加载</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}