import { Link } from 'react-router-dom';
import { EXAMPLE_EXAM, EXAMPLE_LECTURES, EXAMPLE_QUESTIONS, lectureOf, type ExampleQuestion } from '../../data/example';
import { glue, plural } from '../../lib/oral/format';
import { track } from '../../lib/telemetry';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { splitFragmentHeading } from '../../utils/fragmentText';
import TryBar from './TryBar';
import TrySteps from './TrySteps';
import { tryLecturePart, tryTicketPart } from './tryParts';

/** The page's one heading: what to do here. */
export const PICK_TITLE = 'Выберите вопрос к экзамену';

/**
 * What the example is and what will happen (the owner, 21.10: «не понятно что к чему»), in short sentences, one thought
 * each (the owner's plain-words rule, 21.10).
 */
export const PICK_LEAD =
  'Это пример курса по микроэкономике. Лекции и вопросы к экзамену уже загружены. Вы ответите на один вопрос, а Meldy проверит ответ по лекциям.';

/** The visitor does not need to know the subject. */
export const PICK_SAMPLE_LINE = 'Тему знать не нужно. У каждого вопроса есть готовый ответ.';

/** A question the lectures cover only in part, and one they do not cover at all: said under its text. */
export const PARTIAL_NOTE = 'В лекциях есть только часть ответа.';
export const NONE_NOTE = 'Этого вопроса нет в лекциях. Проверить ответ не получится.';

/** The way to what Meldy made of the first lecture (/try/lecture): a verb and what it shows. */
export const LECTURE_RESULT_LINK = `Посмотреть конспект и тест по лекции «${lectureOf('M1').title}»`;

/** The address of a question's answer screen (step 2). */
export function answerHref(question: Pick<ExampleQuestion, 'id'>): string {
  return `/try/ticket?q=${encodeURIComponent(question.id)}`;
}

/**
 * Step 1 of «Попробовать на примере» (/try): the department's list of the example exam, one tap to answer a question.
 * A question in no lecture stays in the list, said as such, and cannot be chosen (there is nothing to check an answer
 * against). Under the list, the three lectures the answers are checked against, and the way to what Meldy made of one.
 * Nothing here talks to a server; the answer screen is a file of its own, fetched when a question is pointed at.
 */
export default function ExamplePick() {
  useDocumentTitle('Пример экзамена');
  const fetchRoom = () => {
    void tryTicketPart.load().catch(() => undefined);
  };
  return (
    <>
      <TryBar />
      <main className="sf-page tx-page tx-pick">
        <TrySteps current={1} />
        <header className="tx-head">
          <h1 className="tx-h1">{PICK_TITLE}</h1>
          <p className="tx-lead">{glue(PICK_LEAD)}</p>
          <p className="tx-lead tx-lead-ink">{glue(PICK_SAMPLE_LINE)}</p>
        </header>

        <section className="tx-card tx-qlist" aria-labelledby="tx-qlist-h">
          <h2 id="tx-qlist-h" className="tx-card-h">
            {EXAMPLE_EXAM.sheetTitle}
          </h2>
          <ol className="tx-qs">
            {EXAMPLE_QUESTIONS.map((question) => {
              const open = question.coverage !== 'none' && question.points.length > 0;
              // Said whole to a screen reader: «Вопрос 8. … В лекциях есть только часть ответа.»
              const name = [`Вопрос ${question.number}.`, question.text, question.coverage === 'partial' ? PARTIAL_NOTE : null].filter(Boolean).join(' ');
              const text = (
                <span className="tx-q-text">
                  <span className="tx-q-t">{glue(question.text)}</span>
                  {question.coverage === 'partial' ? <span className="tx-q-note">{PARTIAL_NOTE}</span> : null}
                  {!open ? <span className="tx-q-note">{NONE_NOTE}</span> : null}
                </span>
              );
              return (
                <li key={question.id} className="tx-q-row">
                  {open ? (
                    <Link
                      className="tx-q"
                      to={answerHref(question)}
                      onPointerEnter={fetchRoom}
                      onFocus={fetchRoom}
                      onTouchStart={fetchRoom}
                      onClick={() => track('try_question_picked')}
                      aria-label={name}
                    >
                      <span className="tx-q-n" aria-hidden="true">
                        {question.number}
                      </span>
                      {text}
                      <span className="tx-q-go" aria-hidden="true" />
                    </Link>
                  ) : (
                    <div className="tx-q" data-off="">
                      <span className="tx-q-n" aria-hidden="true">
                        {question.number}
                      </span>
                      <span className="sr-only">{`Вопрос ${question.number}. `}</span>
                      {text}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <ExampleLectures />
      </main>
    </>
  );
}

/** The three lectures as they were «uploaded»: every lecture quote of the check is cut from them word for word. */
function ExampleLectures() {
  const fetchLecture = () => {
    void tryLecturePart.load().catch(() => undefined);
  };
  return (
    <section className="tx-lectures" aria-labelledby="tx-lectures-h">
      <div className="tx-lectures-head">
        <h2 id="tx-lectures-h" className="tx-h2">
          Лекции курса
        </h2>
        <p className="tx-sub">{glue('Meldy проверяет ответы по этим текстам. Нажмите на лекцию, чтобы прочитать её.')}</p>
        <p className="tx-lecture-go">
          <Link className="sf-link" to="/try/lecture" onPointerEnter={fetchLecture} onFocus={fetchLecture} onTouchStart={fetchLecture}>
            {/* One run of text: the arrow follows the last word on its line, held to it. */}
            <span>
              {glue(LECTURE_RESULT_LINK)}
              <span aria-hidden="true">{' →'}</span>
            </span>
          </Link>
        </p>
      </div>
      <div className="tx-lecture-list">
        {EXAMPLE_LECTURES.map((lecture) => (
          <details key={lecture.key} className="tx-lecture">
            <summary>
              <span className="tx-lecture-t">{lecture.title}</span>
              <span className="tx-lecture-m">{`${lecture.fragments.length} ${plural(lecture.fragments.length, 'часть', 'части', 'частей')}`}</span>
            </summary>
            <ol className="tx-frags">
              {lecture.fragments.map((fragment, index) => {
                const parts = splitFragmentHeading(fragment.text);
                return (
                  <li key={fragment.id} className="tx-frag">
                    <p className="tx-frag-cap">{`часть ${index + 1}`}</p>
                    {parts.heading ? <p className="tx-frag-h">{parts.heading}</p> : null}
                    <p className="tx-frag-t">{parts.body}</p>
                  </li>
                );
              })}
            </ol>
          </details>
        ))}
      </div>
    </section>
  );
}
