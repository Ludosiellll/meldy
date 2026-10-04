import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface TryBarProps {
  /** Where the visitor is: «Пример экзамена», or the way back to the example's sheet. */
  where?: string;
  /** The where-line is a link back to this address (the draw and the answer screens). */
  back?: string;
  /** Leaving the answer screen asks first while an answer is being given (the room passes it). */
  onLeave?: (to: string) => void;
}

/**
 * The top line of «Попробовать на примере» (/try): the room's translucent line (.sf-room-bar) with
 * the wordmark, where the visitor is, and — for a guest — «Войти» and «Создать аккаунт»; a signed-in
 * student gets the way to their own exams instead. The same line on the sheet, the draw and the answer.
 */
export default function TryBar({ where, back, onLeave }: TryBarProps) {
  const { user } = useAuth();
  const go = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onLeave) return;
    event.preventDefault();
    onLeave(to);
  };
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
            <Link className="tx-pill" to="/login" onClick={go('/login')}>
              Войти
            </Link>
            <Link className="tx-pill" data-blue="" to="/register" onClick={go('/register')}>
              Создать аккаунт
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
