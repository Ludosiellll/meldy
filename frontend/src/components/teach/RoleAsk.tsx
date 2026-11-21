import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { saveRole, useRoleUnasked } from '../../lib/role';
import { ROLE_ASK, TEACH_PATH } from './copyTeach';
import './teach.css';

/**
 * «Вы преподаёте?» — asked once, on «Сегодня», of an account whose profile holds no answer. «Да» opens the teacher's
 * first screen and makes it the account's home; «Нет» takes the card away for good. Either can be changed in the
 * account menu («Я преподаватель»).
 */
export default function RoleAsk() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const unasked = useRoleUnasked(user?.id);
  if (!user || !unasked) return null;
  return (
    <section className="tc-ask" aria-labelledby="tc-ask-t">
      <div className="tc-ask-words">
        <h2 className="tc-ask-t" id="tc-ask-t">
          {ROLE_ASK.title}
        </h2>
        <p className="tc-ask-x">{ROLE_ASK.text}</p>
      </div>
      <div className="tc-ask-b">
        <button
          type="button"
          data-yes=""
          onClick={() => {
            void saveRole(user.id, 'teacher');
            navigate(TEACH_PATH);
          }}
        >
          {ROLE_ASK.yes}
        </button>
        <button type="button" onClick={() => void saveRole(user.id, 'student')}>
          {ROLE_ASK.no}
        </button>
      </div>
    </section>
  );
}
