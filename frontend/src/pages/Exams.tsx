import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EXAM_MESSAGES, examErrorMessage, listExams, type ExamListItem } from '../api/exams';
import { fetchQuestionEvents } from '../api/learning';
import { useAuth } from '../hooks/useAuth';
import { examSummary, statesByHash, type QuestionState } from '../lib/learning/readiness';
import { daysUntil, formatDay, KIND_WORDS, relativeDays, subjectOf } from '../lib/exams/format';
import { pluralRu } from '../components/conversation/visuals';
import { useMapJob } from '../components/exams/mapJobs';
import { glue } from '../components/exams/sheetModel';
import { useFrame } from '../components/exams/useFrame';
import '../styles/paper.css';
import '../components/exams/exams.css';

/** «экзамен · 15 октября, через 12 дней», «зачёт · прошёл 15 октября», «экзамен, дата не указана». */
export function examDateLine(item: Pick<ExamListItem, 'kind' | 'exam_date'>, now: Date = new Date()): string {
  const kind = KIND_WORDS[item.kind];
  const day = formatDay(item.exam_date, now);
  if (!day) return `${kind}, дата не указана`;
  const days = daysUntil(item.exam_date, now);
  if (days !== null && days < 0) return `${kind} · прошёл ${day}`;
  return `${kind} · ${day}${days === null ? '' : `, ${relativeDays(days)}`}`;
}

/** «24 из 40 вопросов есть в лекциях · подтверждено 6» (or why there are no numbers yet). */
export function examCoverageLine(item: ExamListItem, confirmed: number | null, mappingNow: boolean): string {
  const total = item.total;
  const questions = `${total} ${pluralRu(total, ['вопрос', 'вопроса', 'вопросов'])}`;
  if (total === 0) return 'вопросов пока нет';
  const mapped = total - item.coverage.unmapped;
  let line: string;
  if (mappingNow || item.mapping_state === 'running') line = `${questions} · идёт сверка с лекциями`;
  else if (mapped === 0) line = `${questions}, со своими лекциями ещё не сверены`;
  else line = `${item.coverage.full} из ${total} ${pluralRu(total, ['вопроса', 'вопросов', 'вопросов'])} есть в лекциях`;
  if (confirmed !== null && confirmed > 0) line += ` · подтверждено ${confirmed}`;
  return line;
}

/**
 * The exam's status pills, as at the foot of the sheet in the reel: «есть 24 · частично 7 · нет 9»
 * (and the questions checked only by words or not checked yet). None while a mapping runs or before
 * the first one: the meta line says so.
 */
export function examPills(item: Pick<ExamListItem, 'total' | 'coverage' | 'mapping_state'>, mappingNow: boolean): Array<{ key: string; word: string; count: number }> {
  const { full, partial, none, unverified, unmapped } = item.coverage;
  if (item.total === 0 || mappingNow || item.mapping_state === 'running' || unmapped === item.total) return [];
  const pills = [
    { key: 'full', word: 'есть', count: full },
    { key: 'partial', word: 'частично', count: partial },
    { key: 'none', word: 'нет', count: none },
  ];
  if (unverified > 0) pills.push({ key: 'unverified', word: 'только по словам', count: unverified });
  if (unmapped > 0) pills.push({ key: 'unmapped', word: 'не сверено', count: unmapped });
  return pills;
}

const ARROW = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** «через 3 дня»: the exam is close (a week or less), the date line is set apart in the card. */
export function examIsNear(item: Pick<ExamListItem, 'exam_date'>, now: Date = new Date()): boolean {
  const days = daysUntil(item.exam_date, now);
  return days !== null && days >= 0 && days <= 7;
}

function ExamRow({ item, states }: { item: ExamListItem; states: Map<string, QuestionState> | null }) {
  const job = useMapJob(item.id);
  const confirmed = states ? examSummary(item.hashes, states).confirmed : null;
  const mappingNow = job.phase === 'running';
  const pills = examPills(item, mappingNow);
  const running = mappingNow || item.mapping_state === 'running';
  // A ticket can be drawn once some question is marked as being in the lectures.
  const canDraw = pills.length > 0 && item.coverage.full + item.coverage.partial + item.coverage.unverified > 0;
  return (
    <li data-near={examIsNear(item) ? '' : undefined}>
      {/* The whole card is the link (its ::after covers the card); the bar, pills and «Тянуть билет» are read after it. */}
      <Link className="ex-row" to={`/exams/${item.id}`}>
        <span className="ex-row-title">{subjectOf(item.title)}</span>
        <span className="ex-row-meta" style={{ display: 'block' }}>
          {glue(`${examDateLine(item)} · ${examCoverageLine(item, confirmed, mappingNow)}`)}
        </span>
      </Link>
      {/* The questions by their marks, as one bar: «есть», «частично», «нет», not checked yet. */}
      {pills.length > 0 ? (
        <span className="ex-bar" aria-hidden="true">
          {pills.map((pill) =>
            pill.count > 0 ? <i key={pill.key} data-k={pill.key} style={{ flexGrow: pill.count }} /> : null,
          )}
        </span>
      ) : running ? (
        <span className="ex-bar" data-running="" aria-hidden="true">
          <i />
        </span>
      ) : null}
      {(pills.length > 0 || canDraw) && (
        <div className="ex-row-foot">
          {pills.length > 0 && (
            <p className="ex-pills">
              {pills.map((pill) => (
                <span key={pill.key} className="ex-pill" data-k={pill.key}>
                  {pill.word} <b>{pill.count}</b>
                </span>
              ))}
            </p>
          )}
          {canDraw && (
            <Link className="sf-primary ex-row-draw" to={`/exams/${item.id}/draw`} aria-label={`Тянуть билет: ${subjectOf(item.title)}`}>
              Тянуть билет
            </Link>
          )}
        </div>
      )}
      <span className="ex-row-go" aria-hidden="true">
        {ARROW}
      </span>
    </li>
  );
}

/**
 * «Экзамены»: the student's exams as cards, nearest date first. Each card says when the exam is, how
 * many of its questions are in the lectures and how many are confirmed by answers, with the status
 * pills of the sheet.
 */
export default function Exams() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const frame = useFrame<HTMLDivElement>();
  const [items, setItems] = useState<ExamListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<Map<string, QuestionState> | null>(null);
  const [showLoading, setShowLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const next = await listExams(userId);
      setItems(next);
      const hashes = next.flatMap((item) => item.hashes);
      if (hashes.length > 0) {
        fetchQuestionEvents(hashes, ['exam_answer'])
          .then((events) => setStates(statesByHash(events)))
          .catch(() => setStates(null)); // the «подтверждено» part is left out, the list still works
      }
    } catch (failure) {
      setError(examErrorMessage(failure, EXAM_MESSAGES.list));
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowLoading(true), 300);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="sf-page" ref={frame.ref} data-frame={frame.size}>
      <header className="ex-head">
        <div>
          <h1 className="ex-h1">Экзамены</h1>
        </div>
        {items && items.length > 0 && (
          <div className="ex-draw">
            <Link className="ex-secondary ex-new" to="/exams/new">
              Новый экзамен
              <span className="ex-new-dot" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            </Link>
          </div>
        )}
      </header>

      {error ? (
        <div className="ex-error" role="alert">
          <h2>Не удалось загрузить экзамены</h2>
          <p>{error} Ваши экзамены сохранены.</p>
          <button type="button" className="sf-link" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : items === null ? (
        showLoading ? (
          <p className="ex-loading" role="status">
            Загружаем экзамены…
          </p>
        ) : null
      ) : items.length === 0 ? (
        <div className="ex-empty">
          <div className="ex-empty-copy">
            <h2>Вставьте список вопросов, который дала кафедра</h2>
            <p>Meldy отметит, какие вопросы есть в ваших лекциях, и посчитает, какую долю билетов они закрывают.</p>
            <button type="button" className="sf-primary" onClick={() => navigate('/exams/new')}>
              Вставить список вопросов
            </button>
            {/* The example exam (/try): its lectures and list are checked already, nothing is saved. */}
            <p>
              Сначала посмотреть, как это работает?{' '}
              <Link className="sf-link" to="/try">
                Попробовать на примере
              </Link>
            </p>
          </div>
          {/* A list with its marks, drawn: no words and no numbers, nothing to mistake for data. */}
          <div className="ex-empty-art" aria-hidden="true">
            <div className="ex-empty-win">
              {[0, 1, 2].map((row) => (
                <span key={row} className="ex-empty-row">
                  <span />
                  <span />
                  <span />
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <ul className="ex-list" aria-label="Ваши экзамены">
          {items.map((item) => (
            <ExamRow key={item.id} item={item} states={states} />
          ))}
        </ul>
      )}
    </div>
  );
}
