import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EXAM_MESSAGES, examErrorMessage, listExams, type ExamListItem } from '../api/exams';
import { fetchQuestionEvents } from '../api/learning';
import { useAuth } from '../hooks/useAuth';
import { examSummary, statesByHash, type QuestionState } from '../lib/learning/readiness';
import { daysUntil, formatDay, KIND_WORDS, relativeDays } from '../lib/exams/format';
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
  if (mappingNow || item.mapping_state === 'running') line = `${questions} · идёт разметка`;
  else if (mapped === 0) line = `${questions}, разметки ещё нет`;
  else line = `${item.coverage.full} из ${total} ${pluralRu(total, ['вопроса', 'вопросов', 'вопросов'])} есть в лекциях`;
  if (confirmed !== null && confirmed > 0) line += ` · подтверждено ${confirmed}`;
  return line;
}

function ExamRow({ item, states }: { item: ExamListItem; states: Map<string, QuestionState> | null }) {
  const job = useMapJob(item.id);
  const confirmed = states ? examSummary(item.hashes, states).confirmed : null;
  return (
    <li>
      <Link className="ex-row" to={`/exams/${item.id}`}>
        <span className="ex-row-title">{item.title}</span>
        <span className="ex-row-meta" style={{ display: 'block' }}>
          {glue(`${examDateLine(item)} · ${examCoverageLine(item, confirmed, job.phase === 'running')}`)}
        </span>
      </Link>
    </li>
  );
}

/**
 * «Экзамены»: the student's exams as a plain document list, nearest date first. Each row says when
 * the exam is, how many of its questions are in the lectures and how many are confirmed by answers.
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
            <Link className="ex-secondary" to="/exams/new">
              Новый экзамен
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
          <h2>Вставьте список вопросов, который дала кафедра</h2>
          <p>Meldy отметит, какие вопросы есть в ваших лекциях, и посчитает, какую долю билетов они закрывают.</p>
          <button type="button" className="sf-primary" onClick={() => navigate('/exams/new')}>
            Вставить список вопросов
          </button>
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
