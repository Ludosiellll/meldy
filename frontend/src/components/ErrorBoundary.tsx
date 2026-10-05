import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { captureError } from '../lib/telemetry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    captureError(error, { name: 'react_render', componentStack: errorInfo.componentStack });
  }

  public render() {
    if (this.state.hasError) {
      // Meldy 2026-10-04: a white card on the canvas, the blue pill back home (.ac-error in styles/legacy.css).
      return (
        <div className="ac-error" role="alert">
          <div className="ac-error-card">
            <span className="ac-error-mark" aria-hidden="true">
              <AlertTriangle />
            </span>
            <h1 className="ac-error-h">Что-то пошло не так</h1>
            <p className="ac-error-p">
              Произошла непредвиденная ошибка при отображении этой страницы.
              Пожалуйста, обновите страницу или вернитесь на главную.
            </p>
            <button
              type="button"
              onClick={() => window.location.href = '/'}
              className="sf-primary"
            >
              Вернуться на главную
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
