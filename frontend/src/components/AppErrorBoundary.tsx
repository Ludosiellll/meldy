import { Component, type ErrorInfo, type ReactNode } from 'react';
import { captureError } from '../lib/telemetry';
import './AppErrorBoundary.css';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * The last guard around the whole app (main.tsx, outside every provider): an error no screen caught
 * becomes one calm card on the canvas with «Перезагрузить страницу», and an error report
 * (lib/telemetry, name react_app). The screens inside Layout keep their own boundary
 * (components/ErrorBoundary). Styles: AppErrorBoundary.css, light and dark through the theme tokens.
 */
export class AppErrorBoundary extends Component<Props, State> {
  public state: State = { failed: false };

  public static getDerivedStateFromError(): State {
    return { failed: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught error:', error, info);
    captureError(error, { name: 'react_app', componentStack: info.componentStack });
  }

  public render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-crash">
        <section className="app-crash-card" role="alert" aria-labelledby="app-crash-h">
          <h1 id="app-crash-h" className="app-crash-h">
            Что-то пошло не так
          </h1>
          <p className="app-crash-p">Страница остановилась из-за ошибки. Перезагрузите её, чтобы продолжить.</p>
          <button type="button" className="app-crash-btn" onClick={() => window.location.reload()}>
            Перезагрузить страницу
          </button>
        </section>
      </main>
    );
  }
}

export default AppErrorBoundary;
