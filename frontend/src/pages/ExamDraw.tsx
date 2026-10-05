import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { EXAM_MESSAGES, examErrorMessage, loadExamBundle, prefetchRubric, type ExamBundle } from '../api/exams';
import { fetchQuestionEvents } from '../api/learning';
import { statesByHash, type QuestionState } from '../lib/learning/readiness';
import {
  canDrawAnother,
  drawTicket,
  poolLine,
  readRecentTickets,
  rememberTicket,
  type DrawMode,
  type DrawQuestion,
  type DrawResult,
} from '../lib/exams/draw';
import { usePrefersReducedMotion } from '../components/landing/usePrefersReducedMotion';
import DrawStack, { ticketTitle, type DrawnCardQuestion } from '../components/exams/DrawStack';
import { preloadTicketScreen, whenIdle } from '../components/exams/preload';
import DrawModeMenu, { drawModeOf } from '../components/exams/DrawModeMenu';
import { glue, numberOf } from '../components/exams/sheetModel';
import { subjectOf } from '../lib/exams/format';
import { track } from '../lib/telemetry';
import '../styles/paper.css';
import '../components/exams/exams.css';

/** «Отвечать будете на один вопрос: вопроса 36 нет в ваших лекциях.» */
export function skippedNote(answerable: number, missing: string[]): string {
  const head = answerable === 1 ? 'один вопрос' : `${answerable} вопроса`;
  const tail = missing.length === 1 ? `вопроса ${missing[0]}` : `вопросов ${missing.join(', ')}`;
  return `Отвечать будете на ${head}: ${tail} нет в ваших лекциях.`;
}

/** «Как на экзамене» drew a ticket with nothing to check an answer against (Jury_Check item 11). */
export const NO_ANSWERABLE_TICKET = 'В этом билете нет вопросов из ваших лекций — ответ не с чем сверить.';
export const NO_ANSWERABLE_QUESTION = 'Этого вопроса нет в ваших лекциях — ответ не с чем сверить.';

/**
 * The answer screen's address: /exams/:id/ticket?q=…[&n=N][&mode=exam]. &n stays the department's
 * ticket number even when its questions missing from the lectures are left out of q; only «Как на
 * экзамене» sends a mode (the answer screen then turns the point marks off).
 */
export function answerHrefOf(examId: string, questionIds: string[], ticketNumber: number | null, mode: DrawMode): string {
  const q = questionIds.map((id) => encodeURIComponent(id)).join(',');
  const n = ticketNumber !== null ? `&n=${encodeURIComponent(String(ticketNumber))}` : '';
  return `/exams/${examId}/ticket?q=${q}${n}${mode === 'exam' ? '&mode=exam' : ''}`;
}

interface Drawn {
  key: number;
  result: DrawResult;
}

/**
 * «Тянуть билет» (room mode, no menu): a single-object screen (redesign critique 8). The stack stands
 * in the middle; the top card lifts and turns over to the drawn ticket, then the line that says what
 * it was drawn from, «Отвечать» (and «Тянуть ещё» outside «Как на экзамене»: an exam has no second
 * try), and under them the way of drawing with «изменить» (also on phones: stage QA round 2).
 * The answer keys are requested while the card lifts. Nothing is voiced.
 */
export default function ExamDraw() {
  const { id: examId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const mode = drawModeOf(params.get('mode'));
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();

  const [bundle, setBundle] = useState<ExamBundle | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [states, setStates] = useState<Map<string, QuestionState> | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const counter = useRef(0);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const next = await loadExamBundle(examId);
      if (!next) {
        setStatus('missing');
        return;
      }
      const hashes = next.questions.map((question) => question.question_hash).filter((hash): hash is string => Boolean(hash));
      try {
        setStates(statesByHash(await fetchQuestionEvents(hashes, ['exam_answer']), new Date()));
        setHistoryFailed(false);
      } catch {
        setStates(new Map());
        setHistoryFailed(true);
      }
      setBundle(next);
      setStatus('ready');
    } catch (failure) {
      setError(examErrorMessage(failure, EXAM_MESSAGES.load));
      setStatus('error');
    }
  }, [examId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => whenIdle(preloadTicketScreen), []);

  const pool: DrawQuestion[] = useMemo(() => {
    if (!bundle) return [];
    return bundle.questions.map((question) => {
      const state = question.question_hash ? states?.get(question.question_hash) : undefined;
      return {
        id: question.id,
        section: question.section,
        coverage: question.coverage,
        readiness: state?.readiness ?? 'untested',
        attempts: state?.attempts ?? 0,
        stale: state?.stale ?? false,
        awaiting: state?.awaiting ?? false,
      };
    });
  }, [bundle, states]);

  const drawLayout = useMemo(() => {
    const layout = bundle?.exam.ticket_layout ?? { mode: 'random' as const, per_ticket: 2 };
    return {
      mode: layout.mode,
      perTicket: layout.per_ticket,
      tickets: (layout.tickets ?? []).map((ticket) => ({ number: ticket.number, questionIds: ticket.question_ids })),
    };
  }, [bundle]);

  const draw = useCallback(() => {
    if (!bundle) return;
    const result = drawTicket({
      mode,
      layout: drawLayout,
      questions: pool,
      recent: readRecentTickets(bundle.exam.id),
    });
    if (result.ok) {
      rememberTicket(bundle.exam.id, result.ticket.key);
      track('ticket_drawn', { mode, questions: result.ticket.questionIds.length });
      // The answer keys are prepared while the card lifts (a question not in the lectures has none).
      for (const id of result.ticket.questionIds) {
        const question = bundle.questions.find((item) => item.id === id);
        if (question && question.coverage !== 'none') prefetchRubric(bundle.exam.id, id);
      }
    }
    counter.current += 1;
    setDrawn({ key: counter.current, result });
  }, [bundle, mode, pool, drawLayout]);

  // Draw on arrival and whenever the mode changes.
  useEffect(() => {
    if (status === 'ready') draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mode]);

  const title = bundle ? subjectOf(bundle.exam.title) : '';
  const exitHref = `/exams/${examId}`;

  const card: { number: number | null; questions: DrawnCardQuestion[] } | null = useMemo(() => {
    if (!bundle || !drawn || !drawn.result.ok) return null;
    const byId = new Map(bundle.questions.map((question) => [question.id, question]));
    const questions = drawn.result.ticket.questionIds
      .map((id) => byId.get(id))
      .filter((question): question is NonNullable<typeof question> => Boolean(question))
      .map((question) => ({ id: question.id, number: numberOf(question), text: question.text, none: question.coverage === 'none' }));
    return { number: drawn.result.ticket.number, questions };
  }, [bundle, drawn]);

  const answerable = card ? card.questions.filter((question) => !question.none) : [];
  const answerHref =
    card && answerable.length > 0 ? answerHrefOf(examId, answerable.map((question) => question.id), card.number, mode) : null;
  const examMode = mode === 'exam';
  const pooled = useMemo(() => poolLine({ mode, layout: drawLayout, questions: pool }), [mode, drawLayout, pool]);
  // «Тянуть ещё» only when another ticket can come out (one question waiting for its confirmation would
  // only turn over again).
  const another = useMemo(() => canDrawAnother({ mode, layout: drawLayout, questions: pool }), [mode, drawLayout, pool]);

  const drawWord = bundle && bundle.exam.ticket_layout.per_ticket <= 1 && bundle.exam.ticket_layout.mode !== 'fixed' ? 'вопрос' : 'билет';
  const bar = (
    <header className="sf-room-bar">
      <div className="dw-left">
        <Link className="dw-wordmark" to="/dashboard">
          Meldy
        </Link>
        <span className="dw-where">
          <span className="dw-long">{title ? `${title} · Тянуть ${drawWord}` : `Тянуть ${drawWord}`}</span>
          <span className="dw-short">{`Тянуть ${drawWord}`}</span>
        </span>
      </div>
      <Link className="sf-link dw-exit" to={exitHref}>
        Лист экзамена
      </Link>
    </header>
  );

  if (status !== 'ready' || !bundle) {
    return (
      <>
        {bar}
        <main className="sf-page dw-room">
          {status === 'loading' ? (
            <p className="ex-loading" role="status">
              Загружаем билеты…
            </p>
          ) : (
            <div className="ex-error" role="alert">
              <h2>{status === 'missing' ? 'Экзамен не найден' : 'Не удалось загрузить билеты'}</h2>
              <p>{status === 'missing' ? 'Его удалили, или он принадлежит другому аккаунту.' : error}</p>
              {status === 'error' && (
                <button type="button" className="sf-link" onClick={() => void load()}>
                  Повторить
                </button>
              )}
            </div>
          )}
        </main>
      </>
    );
  }

  const failure = drawn && !drawn.result.ok ? drawn.result : null;
  const changeMode = (next: DrawMode) => setParams(next === 'exam' ? {} : { mode: next }, { replace: true });

  return (
    <>
      {bar}
      <main className="sf-page dw-room">
        <div className="dw-center">
        <section aria-label="Билет">
          <DrawStack
            drawKey={drawn?.key ?? 0}
            ticketNumber={card?.number ?? null}
            questions={card?.questions ?? null}
            animate={!reduced}
            examMode={examMode}
          />
        </section>
        <section aria-label="Что дальше">
        {/* What the card was drawn from, in every mode: a drawn question never looks picked by hand. */}
        {card && pooled && <p className="dw-pool">{glue(pooled)}</p>}
        {failure && <p className="dw-msg">{glue(failure.message)}</p>}
        {card && !answerHref && examMode && (
          <p className="dw-msg">{glue(card.questions.length === 1 && card.number === null ? NO_ANSWERABLE_QUESTION : NO_ANSWERABLE_TICKET)}</p>
        )}

        <div className="dw-acts">
          {answerHref ? (
            <>
              <button
                type="button"
                className="sf-primary"
                onMouseEnter={preloadTicketScreen}
                onFocus={preloadTicketScreen}
                onClick={() => navigate(answerHref)}
                aria-describedby={card ? 'dw-ticket-title' : undefined}
              >
                Отвечать
              </button>
              {/* «Как на экзамене»: the ticket is the one drawn, as at the exam itself. */}
              {!examMode && another && (
                <button type="button" className="ex-secondary" onClick={draw}>
                  Тянуть ещё
                </button>
              )}
            </>
          ) : failure ? (
            failure.code === 'no_questions' ? (
              <Link className="sf-link" to={`/exams/${examId}/edit`}>
                Изменить список
              </Link>
            ) : (
              <button type="button" className="sf-primary" onClick={() => setParams({}, { replace: true })}>
                Тянуть как на экзамене
              </button>
            )
          ) : examMode ? (
            // Only when a different ticket can come out: the department's only ticket would just turn over again.
            another && (
              <button type="button" className="sf-primary" onClick={draw}>
                {card && card.questions.length === 1 && card.number === null ? 'Тянуть другой вопрос' : 'Тянуть другой билет'}
              </button>
            )
          ) : (
            <button type="button" className="sf-primary" onClick={draw}>
              Тянуть ещё
            </button>
          )}
        </div>
        <DrawModeMenu className="dw-mode" variant="popover" mode={mode} onChange={changeMode} />
        {card && (
          <p id="dw-ticket-title" className="ex-sr">
            {ticketTitle(card.number, card.questions)}
          </p>
        )}
        {card && answerable.length > 0 && answerable.length < card.questions.length && (
          <p className="dw-note">{skippedNote(answerable.length, card.questions.filter((question) => question.none).map((question) => question.number))}</p>
        )}
        {historyFailed && <p className="dw-note">История ответов не загрузилась: тянем без неё.</p>}
        </section>
        </div>
      </main>
    </>
  );
}
