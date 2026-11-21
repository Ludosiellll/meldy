import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useFrame } from '../components/exams/useFrame';
import { useContainerLayer } from './containerLayer';
import { isOwnTest } from '../components/containers/model';
import TestsView from '../components/quick/TestsView';
import { TEACH } from '../components/teach/copyTeach';
import { saveRole } from '../lib/role';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import '../styles/paper.css';
import '../components/exams/exams.css';
import '../components/teach/teach.css';

function Arrow() {
  return (
    <span className="tc-dot" aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </span>
  );
}

/**
 * /teach — the teacher's first screen (advice at the final of 20.11; owner, 21.11): the three things a teacher comes
 * for, each one press away and said in a staff room's words, then what they have already made — their tests with the
 * контрольные and results (the same cards as «Тесты») and the exams they gave a group. Nothing here is new machinery:
 * every action opens a page the app already has. «Сегодня», the student's plan, is one link below.
 */
export default function Teach() {
  useDocumentTitle(TEACH.title);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { layer, probe } = useContainerLayer();
  const frame = useFrame<HTMLDivElement>();
  const containers = layer.mode === 'on' ? layer.overview.containers : [];
  const tests = containers.filter(isOwnTest);
  const exams = containers.filter((container) => container.role === 'owner' && !isOwnTest(container));

  const toStudent = () => {
    if (!user) return;
    void saveRole(user.id, 'student');
    navigate('/dashboard');
  };

  return (
    <div className="sf-page tc-page" ref={frame.ref} data-frame={frame.size}>
      {/* The exam containers' reads: they draw nothing (containerLayer.tsx). */}
      {probe}
      <h1 className="sf-h1 tc-h1">{TEACH.h1}</h1>

      <ul className="tc-actions">
        {TEACH.actions.map((action, index) => (
          <li key={action.id}>
            <Link className="tc-card" to={action.to} data-first={index === 0 ? '' : undefined}>
              <span className="tc-name">{action.name}</span>
              <span className="tc-text">{action.text}</span>
              <span className="tc-go">
                {action.go}
                <Arrow />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {tests.length > 0 ? (
        <section className="tc-block" aria-labelledby="tc-tests-h">
          <h2 className="tc-h2" id="tc-tests-h">
            {TEACH.testsTitle}
          </h2>
          <TestsView tests={tests} />
        </section>
      ) : null}

      {exams.length > 0 ? (
        <section className="tc-block" aria-labelledby="tc-exams-h">
          <h2 className="tc-h2" id="tc-exams-h">
            {TEACH.examsTitle}
          </h2>
          <ul className="tc-rows">
            {exams.map((exam) => (
              <li key={exam.id}>
                <Link className="tc-row" to={`/exams/c/${encodeURIComponent(exam.id)}`}>
                  <span className="tc-row-t">{exam.title}</span>
                  <span className="tc-row-m">{TEACH.examMeta(exam.items)}</span>
                  <span className="tc-row-go">{TEACH.open}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="tc-foot">
        {TEACH.student}{' '}
        <button type="button" className="sf-link" onClick={toStudent}>
          {TEACH.studentGo}
        </button>
      </p>
    </div>
  );
}
