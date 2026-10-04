import { Component, ErrorInfo, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * The legacy screens hidden from the main menu (Career, Chat, CoStudy, Courses, Messages, Missions,
 * MoodTracker, ProfessorExam, SocialHub, TeacherDashboard, AssignmentView). Their markup is the old
 * Tailwind one; styles/legacy.css maps it onto the Meldy language under [data-legacy], and only here
 * is that attribute set, so the mapping never reaches the redesigned screens.
 */
const LEGACY_SCREENS = /^\/(career|chat|courses|messages|play|mood|exam|network|teacher|co-study|assignment)(\/|$)/;

export function isLegacyScreen(pathname: string): boolean {
  return LEGACY_SCREENS.test(pathname);
}

/** Wraps a legacy screen in a box-less scope (display: contents); every other screen renders as is. */
function LegacyScope({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  if (!isLegacyScreen(pathname)) return <>{children}</>;
  return (
    <div className="lg-scope" data-legacy="">
      {children}
    </div>
  );
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

    return <LegacyScope>{this.props.children}</LegacyScope>;
  }
}
