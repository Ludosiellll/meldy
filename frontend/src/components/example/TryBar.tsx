import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { FROM_TRY, withReturn } from '../../lib/returnTo';

/**
 * The call to sign up (the orchestrator's decision 5, PUB-24): «Начать со своего списка» where there is room,
 * «Создать аккаунт» where space is short; «Войти» is always there for a guest, phones included.
 */
export const START_OWN_LABEL = 'Начать со своего списка';
export const CREATE_ACCOUNT_LABEL = 'Создать аккаунт';
/** A signed-in student goes straight to a new exam. */
export const CREATE_EXAM_LABEL = 'Создать свой экзамен';
/**
 * The way back from the lecture's result (/try/lecture), while its file comes and after: the page is often opened from
 * the landing, before the list of questions, so it says where it leads.
 */
export const TRY_LECTURE_WHERE = 'Вернуться к примеру';

/** Own exam: a guest signs up and lands on a new exam (the list of questions comes first); a student goes there. */
export function ownExamHref(signedIn: boolean): string {
  return signedIn ? '/exams/new' : withReturn('/register', '/exams/new');
}

/** True while the window is at least this wide (`min-width` px); without matchMedia, by the window's width. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const read = () => {
    if (typeof window === 'undefined') return true;
    return typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : (window.innerWidth || 1280) >= px;
  };
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const update = () => setWide(list.matches);
    update();
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', update);
      return () => list.removeEventListener('change', update);
    }
    list.addListener?.(update);
    return () => list.removeListener?.(update);
  }, [query]);
  return wide;
}

/** The long sign-up label fits the top line from this width (a phone gets the short one). */
const LONG_LABEL_FROM = 640;

interface TryBarProps {
  /** Where the visitor is: «Пример экзамена», or the way back to the example's sheet. */
  where?: string;
  /** The where-line is a link back to this address (the draw and the answer screens). */
  back?: string;
  /** Leaving the answer screen asks first while an answer is being given (the room passes it). */
  onLeave?: (to: string) => void;
}

/**
 * The top line of «Попробовать на примере» (/try): the room's line (.sf-room-bar) with the wordmark, where
 * the visitor is, and — for a guest — «Войти» and the call to start with their own list; a signed-in
 * student gets the way to their own exams instead. The same line on the sheet, the draw and the answer.
 */
export default function TryBar({ where, back, onLeave }: TryBarProps) {
  const { user } = useAuth();
  const roomy = useMinWidth(LONG_LABEL_FROM);
  const go = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onLeave) return;
    event.preventDefault();
    onLeave(to);
  };
  const start = ownExamHref(false);
  return (
    <header className="sf-room-bar tx-bar">
      <div className="tx-bar-left">
        <Link className="tx-logo" to="/" aria-label="Meldy, на главную" onClick={go('/')}>
          Meldy
        </Link>
        {where ? (
          back ? (
            <Link className="tx-where tx-back" to={back} onClick={go(back)}>
              {where}
            </Link>
          ) : (
            <span className="tx-where">{where}</span>
          )
        ) : null}
      </div>
      <nav className="tx-bar-right" aria-label={user ? 'Аккаунт' : 'Вход и регистрация'}>
        {user ? (
          <Link className="tx-pill" to="/exams" onClick={go('/exams')}>
            Мои экзамены
          </Link>
        ) : (
          <>
            <Link className="tx-pill tx-login" to="/login" onClick={go('/login')}>
              Войти
            </Link>
            <Link className="tx-pill" data-blue="" to={start} state={FROM_TRY} onClick={go(start)}>
              {roomy ? START_OWN_LABEL : CREATE_ACCOUNT_LABEL}
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
