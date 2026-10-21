import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { GOAL } from './copyQuick';
import { readGoal, writeGoal, type Goal } from './goal';
import { QUICK_PATH } from './paths';
import './goal.css';

/**
 * «Первые шаги» start with the goal (UX audit of 21.10, P2; mockup m4): «Готовлюсь к экзамену» → «Новый экзамен», «Даю
 * тест ученикам» → «Быстрая контрольная», each in a card with one line of what follows, and the example a quiet link
 * away. The goal chosen in the first-run guide comes first and holds the blue pill; with none, the exam's door does, as
 * the steps did. `lead` false: something else on the page holds the blue pill, both doors are white.
 */
export default function GoalDoors({ id, lead }: { id?: string; lead: boolean }) {
  const { user } = useAuth();
  const chosen = readGoal(user?.id);
  const blue: Goal | null = lead ? chosen ?? 'exam' : null;
  const order: Goal[] = chosen === 'test' ? ['test', 'exam'] : ['exam', 'test'];
  return (
    <div className="gl" id={id}>
      <p className="gl-lede">{GOAL.lede}</p>
      <ul className="gl-list">
        {order.map((goal) => {
          const words = GOAL[goal];
          const primary = blue === goal;
          return (
            <li key={goal} className="gl-goal" data-goal={goal}>
              <h3 className="gl-t">{words.title}</h3>
              <p className="gl-p">{words.text}</p>
              <div className="gl-acts">
                <Link
                  className={primary ? 'sf-primary' : 'sf-secondary td-pill'}
                  data-size="s"
                  to={goal === 'exam' ? '/exams/import' : QUICK_PATH}
                  onClick={() => writeGoal(user?.id, goal)}
                >
                  {words.action}
                  {primary ? null : (
                    <span className="td-dot" aria-hidden="true">
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </span>
                  )}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="gl-try">
        {GOAL.tryFirst}{' '}
        <Link className="sf-link" data-muted="" to="/try">
          {GOAL.tryLink}
        </Link>
      </p>
    </div>
  );
}
