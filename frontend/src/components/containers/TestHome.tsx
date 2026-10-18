import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ContainerData } from '../../lib/containers/hooks';
import { listQuizzes } from '../../api/quizzes';
import { quizStateWords } from '../../lib/quizzes/quizModel';
import { usePhone } from '../../lib/usePhone';
import type { QuizListRow } from '../../types/quiz';
import PageHead from './PageHead';
import { useExamActions } from './actions';
import { Chevron } from './ui';
import { useWide } from './useWide';
import { glue, TO_EXAMS } from './copy';
import { nb } from './copyImport';
import { TEST_HOME } from '../test/copyTest';
import './testHome.css';

/**
 * The test's own page (release 47.3; owner 18.10: «перегружена» — a row of eight pills and the plan's lines that mean
 * nothing for a test): /exams/c/:id for the author of a test (containers.kind 'test'). The name, «Тест · N вопросов ·
 * K контрольных», the one blue pill «Открыть студию» and «Отправить по ссылке» (a new контрольная of all the questions,
 * as the studio sends it; shut, with the reason, while no question has its key), the «⋯» with «Настройки», «Вопросы и
 * ключи», «Пригласить группу» and «Удалить» (in place, as on the exam's page); then the test's контрольные as rows —
 * name, state, «сдали N» — each to its results, or one line when there are none. No plan card, no figure, no «В счёт
 * идёт…». A member of a test studies it on the exam's page (ContainerPage).
 */
export default function TestHome({ containerId, data, reload }: { containerId: string; data: ContainerData; reload: () => void }) {
  const { summary } = data;
  const phone = usePhone();
  const wide = useWide();
  const ids = useId();
  const { actions, dialogs } = useExamActions({ summary, planInput: data.planInput ?? null, reload, test: true });

  const [rows, setRows] = useState<QuizListRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    listQuizzes(containerId).then(
      (list) => setRows(list),
      () => setFailed(true),
    );
  }, [containerId]);
  useEffect(() => {
    load();
  }, [load]);

  const total = summary.subjects.reduce((sum, subject) => sum + subject.keyed + subject.no_key, 0);
  const keyed = summary.subjects.reduce((sum, subject) => sum + subject.keyed, 0);
  const meta = TEST_HOME.meta(total, rows ? rows.length : null);
  const whyId = `${ids}-why`;
  const why = keyed > 0 ? null : total > 0 ? TEST_HOME.sendWhyKey : TEST_HOME.sendWhyEmpty;
  const studio = (
    <Link className="sf-primary th-studio" to={`/exams/c/${containerId}/studio`}>
      {TEST_HOME.studio}
    </Link>
  );
  const send = why ? (
    <button type="button" className="th-send" disabled aria-describedby={whyId}>
      {TEST_HOME.send}
    </button>
  ) : (
    <Link className="th-send" to={`/exams/c/${containerId}/quizzes/new?all=1&design=1`}>
      {TEST_HOME.send}
    </Link>
  );
  const lead = (
    <>
      {wide ? studio : null}
      {send}
    </>
  );

  const headingId = `${ids}-quizzes`;
  let list;
  if (failed) {
    list = (
      <p className="th-line" role="alert">
        {TEST_HOME.quizzesFailed}{' '}
        <button type="button" className="sf-link" onClick={load}>
          {TEST_HOME.retry}
        </button>
      </p>
    );
  } else if (rows === null) {
    list = (
      <p className="th-line th-wait" role="status">
        {TEST_HOME.quizzesLoading}
      </p>
    );
  } else if (rows.length === 0) {
    list = <p className="th-empty">{nb(TEST_HOME.quizzesEmpty)}</p>;
  } else {
    list = (
      <ul className="ct-rows th-rows" aria-labelledby={headingId}>
        {rows.map((row) => (
          <li key={row.id}>
            <Link className="ct-row" to={`/exams/c/${containerId}/quizzes/${row.id}`} data-state={row.state}>
              <span>
                <span className="ct-row-t">{row.title}</span>
                <span className="ct-row-m">
                  <span className="th-state" data-state={row.state}>
                    {nb(quizStateWords(row))}
                  </span>
                  {glue(` · ${TEST_HOME.finished(row.finished)}`)}
                </span>
              </span>
              <Chevron />
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="sf-page ct-page th-page" data-view="test">
      <PageHead
        title={summary.title}
        meta={meta}
        crumb={{ to: '/exams', label: TO_EXAMS }}
        actions={actions}
        menuLabel={TEST_HOME.menuLabel}
        phone={phone}
        pills={0}
        lead={lead}
      />
      {why ? (
        <p id={whyId} className="th-why">
          {nb(why)}
        </p>
      ) : null}
      <section className="th-quizzes" aria-labelledby={headingId}>
        <h2 id={headingId} className="th-h2">
          {TEST_HOME.quizzes}
        </h2>
        {list}
      </section>
      {!wide ? <div className="ct-cta">{studio}</div> : null}
      {dialogs}
    </div>
  );
}
