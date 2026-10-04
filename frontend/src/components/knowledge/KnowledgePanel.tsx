import { forwardRef, useId } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { mistakeOriginWords } from './mistakes';
import { count, inLectures, readinessPhrase, CARDS_DUE } from './copy';
import { conceptNode, lectureNode, type MapConcept, type MapLecture, type MapView, type NodeId, type QuestionView, type RawMistake } from './model';
import { NumberMark } from './NumberMark';
import { seedFrom } from '../marks';
import { formatDay } from '../../lib/exams/format';
import { fragmentsPhrase } from '../exams/sheetModel';

/**
 * The detail of what was chosen on the map, on a sheet of paper: a lecture (its exam questions with
 * their marks, its concepts, its open mistakes) or a concept (the lectures where it appears with
 * their definitions, the exam questions that mention it, its mistakes). Links lead to the lecture,
 * to review and to the exam sheet; nothing here changes data.
 */

interface PanelProps {
  view: MapView;
  node: NodeId;
  now: Date;
  /** A bottom sheet on narrow screens. */
  sheet: boolean;
  onSelect: (node: NodeId) => void;
  onClose: () => void;
}

function dateKey(iso: string): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function QuestionRow({ question, lectureId, now }: { question: QuestionView; lectureId: string | null; now: Date }) {
  const cited = lectureId ? question.lectures.find((item) => item.lectureId === lectureId) : null;
  return (
    <li className="km-q">
      <span className="km-q-n">
        <NumberMark number={question.number} readiness={question.readiness} seed={seedFrom('km-q', question.examId, question.position)} />
      </span>
      <span className="km-q-body">
        <span className="km-q-text">{question.text}</span>
        <span className="km-q-note">
          {cited ? (
            <>
              {question.coverage === 'partial' ? 'частично' : 'есть в лекции'}
              {fragmentsPhrase(cited.sourceIds) ? (
                <>
                  {', '}
                  <Link className="km-ref" to={`/library/${lectureId}`}>
                    {fragmentsPhrase(cited.sourceIds)}
                  </Link>
                </>
              ) : null}
              {' · '}
            </>
          ) : null}
          {readinessPhrase(question, now)}
        </span>
      </span>
    </li>
  );
}

function MistakeList({ mistakes }: { mistakes: RawMistake[] }) {
  return (
    <ul className="km-mistakes">
      {mistakes.slice(0, 6).map((mistake) => (
        <li key={mistake.id}>
          <span className="km-mistake-q">{(mistake.question || mistake.topic || 'Ошибка без текста').trim()}</span>
          <span className="km-mistake-o">{mistakeOriginWords(mistake.origin)}</span>
        </li>
      ))}
      {mistakes.length > 6 ? <li className="km-more">и ещё {mistakes.length - 6}</li> : null}
    </ul>
  );
}

function LecturePanel({ view, lecture, now, onSelect }: { view: MapView; lecture: MapLecture; now: Date; onSelect: (node: NodeId) => void }) {
  const concepts = lecture.conceptKeys.map((key) => view.conceptByKey.get(key)).filter((concept): concept is MapConcept => Boolean(concept));
  const shared = concepts.filter((concept) => concept.lectureIds.length > 1).sort((a, b) => b.lectureIds.length - a.lectureIds.length || a.label.localeCompare(b.label, 'ru'));
  const single = concepts.filter((concept) => concept.lectureIds.length <= 1);
  const day = dateKey(lecture.createdAt);
  const meta = [lecture.subject, day ? `загружена ${formatDay(day, now)}` : ''].filter(Boolean).join(' · ');
  const drawn = new Set(view.concepts.map((concept) => concept.key));
  return (
    <>
      {meta ? <p className="km-panel-meta">{meta}</p> : null}
      <div className="km-panel-acts">
        <Link className="sf-link" to={`/library/${lecture.id}`}>
          Открыть лекцию
        </Link>
        {lecture.dueCards > 0 ? (
          <Link className="sf-link" to={`/review?material=${encodeURIComponent(lecture.id)}`}>
            Повторить {count(lecture.dueCards, ['карточку', 'карточки', 'карточек'])}
          </Link>
        ) : null}
        {view.exam ? (
          <Link className="sf-link" to={`/exams/${view.exam.id}`}>
            Лист экзамена
          </Link>
        ) : null}
      </div>

      {view.exam ? (
        <div className="km-panel-blk">
          <h3>Вопросы экзамена в этой лекции</h3>
          {lecture.questions.length ? (
            <ol className="km-qs">
              {lecture.questions.map((question) => (
                <QuestionRow key={question.id} question={question} lectureId={lecture.id} now={now} />
              ))}
            </ol>
          ) : (
            <p className="km-quiet">Разметка не нашла в этой лекции ни одного вопроса экзамена.</p>
          )}
        </div>
      ) : null}

      <div className="km-panel-blk">
        <h3>Понятия лекции</h3>
        {concepts.length === 0 ? (
          <p className="km-quiet">
            {lecture.textOnly
              ? 'Лекция загружена только текстом: конспекта и списка терминов нет. Разберите её, и понятия появятся на карте.'
              : 'В конспекте этой лекции нет списка терминов.'}
          </p>
        ) : null}
        {shared.length > 0 ? (
          <ul className="km-links">
            {shared.map((concept) => (
              <li key={concept.key}>
                {drawn.has(concept.key) ? (
                  <button type="button" className="km-word-link" onClick={() => onSelect(conceptNode(concept.key))}>
                    {concept.label}
                  </button>
                ) : (
                  <span className="km-word-plain">{concept.label}</span>
                )}
                <span className="km-quiet-inline">
                  {' '}
                  — ещё {inLectures(concept.lectureIds.length - 1)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {single.length > 0 ? (
          <p className="km-run">
            {shared.length > 0 ? <span className="km-quiet-inline">Только здесь: </span> : null}
            {single.map((concept, index) => (
              <span key={concept.key}>
                {drawn.has(concept.key) ? (
                  <button type="button" className="km-word-link" onClick={() => onSelect(conceptNode(concept.key))}>
                    {concept.label}
                  </button>
                ) : (
                  concept.label
                )}
                {index < single.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>
        ) : null}
      </div>

      {lecture.openMistakes.length > 0 ? (
        <div className="km-panel-blk">
          <h3>Открытые ошибки</h3>
          <MistakeList mistakes={lecture.openMistakes} />
          <Link className="sf-link" data-muted="" to="/mistakes">
            Дневник ошибок
          </Link>
        </div>
      ) : null}
    </>
  );
}

function ConceptPanel({ view, concept, now, onSelect }: { view: MapView; concept: MapConcept; now: Date; onSelect: (node: NodeId) => void }) {
  const elsewhere = concept.allLectureIds.length - concept.lectureIds.length;
  const meta = [
    concept.lectureIds.length > 1 ? `Встречается ${inLectures(concept.lectureIds.length)}` : 'Встречается в одной лекции',
    elsewhere > 0 ? `ещё ${inLectures(elsewhere)} вне этой карты` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const questions = concept.questionIds.map((id) => view.questionById.get(id)).filter((question): question is QuestionView => Boolean(question));
  return (
    <>
      <p className="km-panel-meta">{meta}</p>
      <div className="km-panel-blk">
        <h3>Где встречается</h3>
        <ul className="km-defs">
          {concept.definitions.map((item) => {
            const lecture = view.lectureById.get(item.lectureId);
            if (!lecture) return null;
            const fragments = fragmentsPhrase(item.sourceIds);
            return (
              <li key={item.lectureId}>
                <p className="km-def-head">
                  <button type="button" className="km-word-link km-def-lecture" onClick={() => onSelect(lectureNode(lecture.id))}>
                    {lecture.title}
                  </button>
                  {fragments ? (
                    <>
                      {', '}
                      <Link className="km-ref" to={`/library/${lecture.id}`}>
                        {fragments}
                      </Link>
                    </>
                  ) : null}
                </p>
                <p className="km-def-text">{item.text}</p>
                <p className="km-def-acts">
                  <Link className="sf-link" data-muted="" to={`/library/${lecture.id}`}>
                    Открыть лекцию
                  </Link>
                  {lecture.dueCards > 0 ? (
                    <Link className="sf-link" data-muted="" to={`/review?material=${encodeURIComponent(lecture.id)}`}>
                      {count(lecture.dueCards, CARDS_DUE)}
                    </Link>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      {view.exam ? (
        <div className="km-panel-blk">
          <h3>Вопросы экзамена с этими словами</h3>
          {questions.length ? (
            <ol className="km-qs">
              {questions.map((question) => (
                <QuestionRow key={question.id} question={question} lectureId={null} now={now} />
              ))}
            </ol>
          ) : (
            <p className="km-quiet">В формулировках вопросов этих слов нет.</p>
          )}
          <p className="km-fine">Совпадение по словам: вопрос может быть и о другом.</p>
        </div>
      ) : null}

      {concept.openMistakes.length > 0 ? (
        <div className="km-panel-blk">
          <h3>Открытые ошибки</h3>
          <MistakeList mistakes={concept.openMistakes} />
          <Link className="sf-link" data-muted="" to="/mistakes">
            Дневник ошибок
          </Link>
        </div>
      ) : null}

      {view.exam ? (
        <div className="km-panel-acts">
          <Link className="sf-link" to={`/exams/${view.exam.id}`}>
            Лист экзамена
          </Link>
        </div>
      ) : null}
    </>
  );
}

export const KnowledgePanel = forwardRef<HTMLHeadingElement, PanelProps>(function KnowledgePanel({ view, node, now, sheet, onSelect, onClose }, headingRef) {
  const headingId = useId();
  const lecture = node.startsWith('l:') ? view.lectureById.get(node.slice(2)) ?? null : null;
  const concept = node.startsWith('c:') ? view.conceptByKey.get(node.slice(2)) ?? null : null;
  if (!lecture && !concept) return null;
  const kind = lecture ? `Лекция ${lecture.number}${view.groups.length > 1 ? ` · ${view.groups.find((group) => group.id === lecture.groupId)?.label ?? ''}` : ''}` : 'Понятие';
  return (
    <section className="km-panel sf-sheet" data-sheet={sheet ? '' : undefined} aria-labelledby={headingId}>
      <div className="km-panel-top">
        <p className="km-panel-kind">{kind}</p>
        <button type="button" className="km-close" aria-label="Закрыть подробности" onClick={onClose}>
          <X aria-hidden="true" strokeWidth={1.75} />
        </button>
      </div>
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="km-panel-title">
        {lecture ? lecture.title : concept!.label}
      </h2>
      {lecture ? <LecturePanel view={view} lecture={lecture} now={now} onSelect={onSelect} /> : null}
      {concept ? <ConceptPanel view={view} concept={concept} now={now} onSelect={onSelect} /> : null}
    </section>
  );
});

/** Under the map: how to read it, and where to look first. */
export function MapGuide({ view, onSelect }: { view: MapView; onSelect: (node: NodeId) => void }) {
  const drawn = new Set(view.concepts.map((concept) => concept.key));
  const top = view.concepts
    .filter((concept) => concept.lectureIds.length > 1)
    .slice()
    .sort((a, b) => b.lectureIds.length - a.lectureIds.length || a.label.localeCompare(b.label, 'ru'))
    .slice(0, 5);
  const attention = view.lectures
    .map((lecture) => ({
      lecture,
      failed: lecture.questions.filter((question) => question.readiness === 'not_passed'),
      mistakes: lecture.openMistakes.length,
    }))
    .filter((item) => item.failed.length > 0 || item.mistakes > 0)
    .sort((a, b) => b.failed.length + b.mistakes - (a.failed.length + a.mistakes))
    .slice(0, 4);
  return (
    <div className="km-guide">
      <section>
        <h2>Как читать карту</h2>
        <p>
          Карточки — {view.exam ? 'лекции экзамена' : 'ваши лекции'} по порядку, слева направо. Между ними — понятия из конспектов, которые
          встречаются в нескольких лекциях; линия ведёт к каждой такой лекции.
        </p>
        {view.exam ? (
          <p>Номера на карточке — вопросы экзамена, которые разметка нашла в этой лекции. Пометка на номере — ваши ответы, как на листе экзамена.</p>
        ) : null}
        <p className="km-fine">Понятия взяты из списков терминов в конспектах; одно понятие в разных лекциях узнаётся по основам слов.</p>
      </section>
      {top.length > 0 ? (
        <section>
          <h2>Чаще всего встречаются</h2>
          <ul className="km-guide-list">
            {top.map((concept) => (
              <li key={concept.key}>
                {drawn.has(concept.key) ? (
                  <button type="button" className="km-word-link" onClick={() => onSelect(conceptNode(concept.key))}>
                    {concept.label}
                  </button>
                ) : (
                  concept.label
                )}
                <span className="km-quiet-inline"> — {inLectures(concept.lectureIds.length)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {attention.length > 0 ? (
        <section>
          <h2>Стоит вернуться</h2>
          <ul className="km-guide-list">
            {attention.map(({ lecture, failed, mistakes }) => (
              <li key={lecture.id}>
                <button type="button" className="km-word-link" onClick={() => onSelect(lectureNode(lecture.id))}>
                  {lecture.title}
                </button>
                <span className="km-quiet-inline">
                  {' — '}
                  {[
                    failed.length ? `не засчитано: ${failed.map((question) => question.number).join(', ')}` : '',
                    mistakes ? count(mistakes, ['открытая ошибка', 'открытые ошибки', 'открытых ошибок']) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {view.lectures.length > 0 && view.concepts.length === 0 ? (
        <section>
          <h2>Понятий пока нет</h2>
          <p>
            {view.counts.concepts === 0
              ? 'В конспектах этих лекций нет списков терминов: лекции загружены только текстом. Разберите лекцию, и её понятия появятся на карте.'
              : 'Общих понятий у этих лекций пока нет. У каждой есть свои — их видно в подробностях лекции или по кнопке «все» на карте.'}
          </p>
        </section>
      ) : null}
    </div>
  );
}
