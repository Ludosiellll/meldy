import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isPictureWord } from '../../types/container';
import type { QuizResult, QuizResultItem } from '../../types/quiz';
import { containerErrorText } from '../../api/containers';
import { joinPractice } from '../../api/quizzes';
import { dateTimeText, percentOf, quizOrder } from '../../lib/quizzes/quizModel';
import { withReturn } from '../../lib/returnTo';
import { CodeBlock } from '../containers/QuestionCard';
import ItemPictures, { storedPictures } from '../containers/ItemPictures';
import { RoomBar } from '../containers/RoomParts';
import { OPTION_LETTERS } from '../containers/copy';
import { stemParts } from '../containers/stemCode';
import { useWide } from '../containers/useWide';
import { RESULT } from './copyTake';
import '../containers/room.css';
import './quizTake.css';

/**
 * The result of an attempt (spec 2026-10-16 §2.2 «Результат»): «15 из 20 · 75 %», the pass mark when the author set
 * one, then as much as the author's setting shows now — nothing more («score»), the questions answered wrong with the
 * person's answer («mistakes»), or those with the right answers too («answers»; there «Показать все вопросы» opens the
 * rest of the attempt). The server lists every counted question in the attempt's order with `right`, so a question
 * keeps its number. Before the quiz closes, «mistakes then answers» says when the right answers open. The options stand
 * in the attempt's order with the attempt's letters (quizOrder from the attempt id, shuffle_options and keep_order), so
 * «я выбрал В» reads the same here. Pictures come from the private bucket (storage paths, ItemPictures).
 *
 * Release 47 (spec 2026-10-18 §47.3, §47.5): the author's explanation under a question when the server sends one (only
 * with the right answers); and when the author offers it, «Тренироваться дальше» — a signed-in taker joins the exam
 * (quiz_practice_join, the note about what the author sees comes first), a member opens it, a guest makes an account
 * and comes back to /k/<код>?practice=1, where the page takes the device's attempts and joins.
 */

function OptionWords({ text, paths }: { text: string; paths: string[] | undefined }) {
  const sources = storedPictures(paths);
  if (sources.length === 0) return <>{text}</>;
  return (
    <>
      <ItemPictures sources={sources} kind="option" />
      {isPictureWord(text) ? <span className="sr-only">{text}</span> : <span className="ct-opt-words">{text}</span>}
    </>
  );
}

function ReviewItem({ item, no, showKey, order }: { item: QuizResultItem; no: number; showKey: boolean; order: readonly number[] }) {
  const stem = stemParts(item.stem, item.code);
  const stemPictures = storedPictures(item.images?.stem);
  const pictureStem = stemPictures.length > 0 && isPictureWord(item.stem);
  const chosen = Array.isArray(item.chosen) ? item.chosen : [];
  const key = showKey && Array.isArray(item.key) ? item.key : [];
  const typed = typeof item.text === 'string' ? item.text.trim() : '';
  const unanswered = item.kind === 'short' ? typed === '' : chosen.length === 0;
  const options = Array.isArray(item.options) ? item.options : [];
  const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';
  return (
    <li className="qt-ritem">
      <p className="ct-ctx">{unanswered ? `${RESULT.itemNo(no)} · ${RESULT.unanswered}` : RESULT.itemNo(no)}</p>
      {stem.before && !pictureStem ? <h3 className="qt-rstem">{stem.before}</h3> : <h3 className="sr-only">{item.stem.split('\n')[0]}</h3>}
      <ItemPictures sources={stemPictures} kind="stem" />
      {stem.code ? <CodeBlock code={stem.code} /> : null}
      {stem.after ? <p className="ct-stem-after">{stem.after}</p> : null}
      {item.kind === 'short' ? (
        <div className="qt-rshort">
          <p data-state={unanswered ? undefined : item.right ? 'file' : showKey ? 'wrong' : 'mine'}>{unanswered ? RESULT.shortNone : RESULT.shortMine(typed)}</p>
          {showKey && !item.right && Array.isArray(item.forms) && item.forms.length > 0 ? <p data-state="file">{RESULT.shortRight(item.forms)}</p> : null}
        </div>
      ) : (
        <ul className="ct-opts qt-opts" aria-label="Варианты ответа">
          {order.map((index, place) => {
            const text = options[index] ?? '';
            const mine = chosen.includes(index);
            const right = key.includes(index);
            const state = right ? 'file' : mine ? (showKey ? 'wrong' : 'mine') : undefined;
            const tag = mine && right ? RESULT.tagMineRight : right ? RESULT.tagRight : mine ? RESULT.tagMine : null;
            return (
              <li key={index} className="ct-opt qt-opt" data-state={state}>
                <span className="ct-opt-l">{OPTION_LETTERS[place] ?? String(place + 1)}</span>
                <span className="ct-opt-t">
                  <OptionWords text={text} paths={item.images?.options?.[index]} />
                  {tag ? <span className="ct-opt-tag">{tag}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {explanation ? (
        <div className="qt-explain">
          <p className="qt-explain-h">{RESULT.explanation}</p>
          <p className="qt-explain-t">{explanation}</p>
        </div>
      ) : null}
    </li>
  );
}

/**
 * «Тренироваться дальше»: the blue pill when the result has no «Ещё попытка» (one blue pill a screen), else the white
 * one. A refusal (MC018: not offered, removed by the author, no places) is said right here.
 */
function PracticeOffer({ result, guest, primary }: { result: QuizResult; guest: boolean; primary: boolean }) {
  const navigate = useNavigate();
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const practice = result.practice;
  if (!practice) return null;
  const pill = primary ? 'sf-primary qt-practice-go' : 'sf-secondary qt-practice-go';
  const join = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // A member gets the exam's id too: the same call opens it.
      const joined = await joinPractice(result.code);
      navigate(`/exams/c/${joined.container_id}`);
    } catch (failure) {
      setError(containerErrorText(failure));
      setBusy(false);
    }
  };
  return (
    <section className="qt-practice" aria-labelledby={titleId}>
      <h2 id={titleId} className="qt-practice-h">
        {RESULT.practiceTitle}
      </h2>
      {guest ? (
        <>
          <p className="qt-practice-note">{RESULT.practiceNote(practice.exam_title)}</p>
          <Link className={pill} to={withReturn('/register', `/k/${result.code}?practice=1`)}>
            {RESULT.practiceGuest}
          </Link>
        </>
      ) : practice.member ? (
        <>
          <p className="qt-practice-note">{RESULT.practiceMember(practice.exam_title)}</p>
          <button type="button" className="sf-link" aria-busy={busy || undefined} disabled={busy} onClick={() => void join()}>
            {RESULT.practiceOpen}
          </button>
        </>
      ) : (
        <>
          <p className="qt-practice-note">{RESULT.practiceNote(practice.exam_title)}</p>
          <button type="button" className={pill} aria-busy={busy || undefined} disabled={busy} onClick={() => void join()}>
            {RESULT.practiceJoin}
          </button>
        </>
      )}
      {error ? (
        <p role="alert" className="qt-practice-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export interface QuizResultProps {
  result: QuizResult;
  /** «Ещё попытка»: back to the page's start (shown only when the result allows another try). */
  onRetry: () => void;
  /** «Закрыть»: back to the page's start. */
  onClose: () => void;
  /** Written without an account (release 47): «тренироваться» goes through making one. */
  guest?: boolean;
}

export default function QuizResultView({ result, onRetry, onClose, guest = false }: QuizResultProps) {
  const wide = useWide();
  const headRef = useRef<HTMLHeadingElement | null>(null);
  const reviewId = useId();
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    headRef.current?.focus({ preventScroll: true });
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }
  }, [result.attempt_id]);

  const percent = typeof result.percent === 'number' ? Math.round(result.percent) : percentOf(result.correct, result.total) ?? 0;
  const threshold = typeof result.pass_percent === 'number' ? result.pass_percent : null;
  const passed = threshold === null ? null : typeof result.passed === 'boolean' ? result.passed : percent >= threshold;
  const finished = result.finished_at ? dateTimeText(result.finished_at) : '';
  const items = Array.isArray(result.items) ? result.items : [];
  const showKey = result.review_now === 'answers';
  const numbered = items.map((item, index) => ({ item, no: index + 1 }));
  const wrong = result.review_now === 'score' ? [] : numbered.filter(({ item }) => !item.right);
  // All the questions only where the right answers are shown anyway: a right answer of «mistakes» would give the key away.
  const canShowAll = showKey && numbered.length > wrong.length;
  const listed = canShowAll && showAll ? numbered : wrong;
  const reason = result.finish_reason === 'time' ? RESULT.byTime : result.finish_reason === 'closed' ? RESULT.byClose : null;

  return (
    <>
      <RoomBar long={RESULT.barLong} short={RESULT.barShort} exitLabel={RESULT.close} onExit={onClose} />
      <main className="sf-page ct-study ct-end qt-result">
        <p className="ct-end-small">{RESULT.attemptLine(result.n, finished)}</p>
        <h1 className="ct-end-h qt-result-h" ref={headRef} tabIndex={-1}>
          {result.quiz_title}
        </h1>
        <p className="qt-score">
          <span className="qt-nb">{RESULT.score(result.correct, result.total)}</span>
          {' · '}
          <span className="qt-nb">{RESULT.percent(percent)}</span>
        </p>
        {threshold !== null && passed !== null ? (
          <p className="qt-pass" data-passed={passed ? '' : undefined}>
            {RESULT.pass(threshold, passed)}
          </p>
        ) : null}
        {reason ? <p className="ct-end-p">{reason}</p> : null}
        {result.answers_after && !showKey ? <p className="ct-end-p">{RESULT.answersAfter(dateTimeText(result.answers_after))}</p> : null}
        {result.review_now !== 'score' ? (
          <section className="qt-review" aria-labelledby={reviewId}>
            <h2 id={reviewId} className="qt-review-h">
              {showKey ? RESULT.answersTitle : RESULT.mistakesTitle}
            </h2>
            {wrong.length === 0 ? <p className="ct-end-p">{RESULT.noMistakes}</p> : null}
            {listed.length > 0 ? (
              <ol className="qt-rlist">
                {listed.map(({ item, no }) => (
                  <ReviewItem key={item.id} item={item} no={no} showKey={showKey} order={quizOrder(item, result.attempt_id, result.shuffle_options === true)} />
                ))}
              </ol>
            ) : null}
            {canShowAll ? (
              <p className="qt-review-more">
                <button type="button" className="sf-link" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
                  {showAll ? RESULT.showWrong : RESULT.showAll(numbered.length)}
                </button>
              </p>
            ) : null}
          </section>
        ) : null}
        {result.practice ? <PracticeOffer result={result} guest={guest} primary={!result.can_retry} /> : null}
        {result.can_retry ? (
          <div className="ct-bar">
            <div className="ct-bar-row" style={wide ? undefined : { width: '100%' }}>
              <button type="button" className="sf-primary" onClick={onRetry}>
                {RESULT.retry(result.attempts_left)}
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
