import { useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { track } from '../../lib/telemetry';
import { useFrame } from '../../components/exams/useFrame';
import { errorText, nb } from '../../components/containers/copyImport';
import { newImportId } from '../../components/containers/import/importModel';
import { QUIZ } from '../../components/quiz/copyQuiz';
import { TEST_TITLE_MAX } from '../../components/test/copyTest';
import QuickChips from '../../components/quick/QuickChips';
import QuickPreview from '../../components/quick/QuickPreview';
import { QUICK } from '../../components/quick/copyQuick';
import {
  QUICK_DEFAULTS,
  quickInputs,
  quickPreset,
  quickQuestions,
  quickQuizSettings,
  readyOf,
  tapOption,
  type QuickQuestion,
  type QuickSettings,
  type QuickTaps,
} from '../../components/quick/quickModel';
import { freshQuickSave, saveQuick, type QuickSave } from '../../components/quick/saveQuick';
import { usePasteParse } from '../../components/quick/usePasteParse';
import { TESTS_PATH, quickLinkPath } from '../../components/quick/paths';
import '../../components/exams/exams.css';
import '../../components/quick/quick.css';

const pad = (n: number) => String(n).padStart(2, '0');

/** The name when none is typed: «Контрольная · 21.10». */
export function defaultQuickName(now: Date = new Date()): string {
  return QUIZ.defaultTitle(`${pad(now.getDate())}.${pad(now.getMonth() + 1)}`);
}

/**
 * /tests/quick — «Быстрая контрольная» (UX audit of 21.10, P1; mockups m2, m3): one screen from pasted questions to a
 * link. The name, a field for the questions as they are in Word or a chat («1.», «а) б) в)», «*» after the right variant
 * or «Ответ: б»; a short answer with «Ответ: 2»), the questions found beside it (below it on a phone) as the
 * контрольная will have them — a question without its answer stands out and takes a tap on the right variant — and the
 * few settings as pills (without signing in, no timer, open 7 days, 1 attempt). «Получить ссылку» saves the test, its
 * questions and the контрольная (saveQuick) and opens the link with its QR code. «Ещё настройки» saves the test and opens
 * the full form with the pills' choices.
 */
export default function QuickTestPage() {
  useDocumentTitle(QUICK.docTitle);
  const navigate = useNavigate();
  const frame = useFrame<HTMLDivElement>();
  const ids = useId();
  const side = frame.side ? 'right' : 'below';

  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [taps, setTaps] = useState<QuickTaps>({});
  const [settings, setSettings] = useState<QuickSettings>(QUICK_DEFAULTS);
  const [busy, setBusy] = useState<'link' | 'more' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useRef<QuickSave>(freshQuickSave());
  const importId = useRef(newImportId());
  const [announce, setAnnounce] = useState('');

  const parse = usePasteParse(text);
  const questions = useMemo(() => quickQuestions(parse.result, taps), [parse.result, taps]);
  const ready = useMemo(() => readyOf(questions), [questions]);
  const saved = useMemo(() => quickInputs(questions, importId.current).length, [questions]);
  const left = questions.length - ready.length;

  /** A change after a failed save: the next save starts afresh (what was saved before stays a test of its own). */
  const changed = () => {
    if (error) setError(null);
    if (save.current.containerId && !save.current.quiz) {
      save.current = freshQuickSave();
      importId.current = newImportId();
    }
  };

  const tap = (question: QuickQuestion, index: number) => {
    changed();
    setTaps((current) => tapOption(current, question, index));
    const letter = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'][index] ?? String(index + 1);
    setAnnounce(QUICK.marked(question.number, letter));
  };

  const why = questions.length === 0 ? QUICK.needText : ready.length === 0 ? QUICK.needKey : null;

  const run = async (what: 'link' | 'more') => {
    if (busy || why) return;
    setBusy(what);
    setError(null);
    const name = (title.trim() || defaultQuickName()).slice(0, TEST_TITLE_MAX);
    const items = quickInputs(questions, importId.current);
    const count = ready.length;
    try {
      const state = await saveQuick(
        { title: name, items, settings: what === 'link' ? (subjectId) => quickQuizSettings(name, subjectId, count, settings) : undefined },
        save.current,
      );
      const containerId = state.containerId as string;
      if (what === 'more') {
        track('quick.more', { items: items.length, keyed: count });
        navigate(`/exams/c/${containerId}/quizzes/new?all=1`, { replace: true, state: { preset: quickPreset(settings), more: true } });
        return;
      }
      track('quick.created', { items: items.length, keyed: count, minutes: settings.minutes ?? 0, guests: settings.who === 'guests' });
      navigate(quickLinkPath(containerId, state.quiz!.id), { replace: true });
    } catch (failure) {
      setError(errorText(failure, undefined, QUICK.saveFailed));
      setBusy(null);
    }
  };

  const field = (
    <section className="qk-card qk-write">
      <label className="qk-label" htmlFor={`${ids}-name`}>
        {QUICK.name}
      </label>
      <input
        id={`${ids}-name`}
        className="qk-input"
        value={title}
        maxLength={TEST_TITLE_MAX}
        placeholder={QUICK.namePlaceholder}
        autoComplete="off"
        disabled={busy !== null}
        onChange={(event) => {
          changed();
          setTitle(event.target.value);
        }}
      />
      <label className="qk-label" htmlFor={`${ids}-text`}>
        {QUICK.text}
      </label>
      <textarea
        id={`${ids}-text`}
        className="qk-text"
        value={text}
        placeholder={QUICK.textPlaceholder}
        spellCheck={false}
        disabled={busy !== null}
        aria-describedby={`${ids}-how`}
        onChange={(event) => {
          changed();
          const value = event.target.value;
          setText(value);
          // A paste is read at once: the questions come while the hand is still on the mouse.
          const kind = (event.nativeEvent as InputEvent | undefined)?.inputType;
          if (kind === 'insertFromPaste' || kind === 'insertFromDrop') parse.now(value);
        }}
      />
      <p className="qk-how" id={`${ids}-how`}>
        {nb(QUICK.howTo(side))}
      </p>
    </section>
  );

  return (
    <div className="sf-page qk-page" ref={frame.ref} data-frame={frame.size}>
      <header className="ex-head qk-head">
        <div>
          <p className="ex-crumb">
            <Link to={TESTS_PATH}>{QUICK.crumb}</Link>
          </p>
          <h1 className="ex-h1">{QUICK.title}</h1>
          <p className="ex-meta qk-lede">
            {QUICK.lede} {QUICK.ledeMore}
          </p>
        </div>
      </header>

      <div className="qk-grid">
        {field}
        <QuickPreview
          questions={questions}
          empty={!text.trim()}
          reading={parse.reading}
          failed={parse.failed}
          skipped={parse.result?.skipped ?? []}
          side={side}
          onTap={tap}
          onRetry={() => parse.now()}
        />
      </div>

      <div className="qk-bar">
        <div className="qk-bar-in">
          <QuickChips value={settings} onChange={setSettings} disabled={busy !== null} />
          <button
            type="button"
            className="sf-link qk-more"
            disabled={busy !== null || why !== null}
            aria-describedby={why ? `${ids}-why` : undefined}
            onClick={() => void run('more')}
          >
            {QUICK.more}
          </button>
          <div className="qk-go">
            <p className="qk-sum" id={`${ids}-why`} aria-live="polite">
              {why
                ? why
                : nb(`${QUICK.inQuiz(ready.length)}${left > 0 ? ` ${QUICK.leftOut(left)}` : ''}`)}
            </p>
            <button
              type="button"
              className="sf-primary qk-submit"
              disabled={busy !== null || why !== null}
              aria-busy={busy === 'link' || undefined}
              aria-describedby={`${ids}-why`}
              data-count={saved}
              onClick={() => void run('link')}
            >
              {busy === 'link' ? QUICK.saving : QUICK.submit}
            </button>
          </div>
        </div>
        {error ? (
          <p className="qk-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
