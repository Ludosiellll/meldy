import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { COVER_BUCKET, coverUrl, pictureFromFile, picturePath, uploadPicture } from '../../api/itemPictures';
import { createQuiz, listQuizzes, updateQuiz } from '../../api/quizzes';
import { fetchTestDoc } from '../../api/testDocs';
import { normalizeDoc } from '../../lib/studio/doc';
import { useContainerData } from '../../lib/containers/hooks';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import { track } from '../../lib/telemetry';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import {
  ATTEMPT_OPTIONS,
  dateWords,
  defaultMinutes,
  defaultSettings,
  MAX_ITEMS,
  PASS_OPTIONS,
  settingsProblems,
  TIME_OPTIONS,
  type SettingsProblem,
} from '../../lib/quizzes/quizModel';
import { useFrame } from '../../components/exams/useFrame';
import { bringIntoView } from '../../components/test/bringIntoView';
import PaperSelect, { type PaperSelectOption } from '../../components/ui/PaperSelect';
import { errorText, GONE, nb } from '../../components/containers/copyImport';
import { TO_EXAMS } from '../../components/containers/copy';
import { QA_ERRORS, QA_LIST, QA_SETUP } from '../../components/quiz/copyAuthor';
import {
  allQuestions,
  changedSettings,
  countChoices,
  countFor,
  hasExplanations,
  isoFromLocal,
  keyedBySubject,
  localInput,
  nextHour,
  pageQuestionCount,
  poolOf,
  settingsOf,
  weekOn,
  whoOf,
  withWho,
  WHO_CHOICES,
  type QuizWho,
} from '../../components/quiz/setupModel';
import { LOCKED_SETTINGS, QUIZ_ACCENTS, type QuizGrading, type QuizProtection, type QuizReview, type QuizRow, type QuizSettings } from '../../types/quiz';
import { DEFAULT_LIMIT, LIMIT_OPTIONS } from '../../lib/quizzes/guard';
import type { SummarySubject, Uuid } from '../../types/container';
import '../../components/exams/exams.css';
import '../../components/containers/import/import.css';
import '../../components/quiz/quizAuthor.css';

/**
 * /exams/c/:id/quizzes/new and /exams/c/:id/quizzes/:quizId/edit — the settings of a «Контрольная» (spec 2026-10-16
 * §2.1): what questions (the ticked subjects' keyed ones: the pool), how many, the set, the order, the timer; when it
 * is open, the attempts, what counts, going back, the pass mark, what the participant sees after, the offer to train the
 * exam after, who may write (without an account, signed in, or the exam's members only); the look of the quiz's page —
 * a cover (uploaded at once into the exam's folder of the public bucket quiz-covers) and one of six colours (release 47).
 *
 * A new quiz starts from defaultSettings (every subject with keyed questions, 20, about a minute a question, one
 * attempt, open a week, guests welcome); the count and the timer follow the subjects until the author picks them.
 * `?all=1` (the constructor's «Отправить по ссылке») starts with all the questions, one set, in order, named as the test;
 * it shows only what matters first (the name, the time, «Открыта до», who may write, the look) and folds the rest under
 * «Ещё настройки». An exam of one subject has no «Вопросы из». A date field says its date in words beside it; when a
 * question of the set has an explanation, a line under «После сдачи» says when the takers see it. «Создать» →
 * quiz_create → the stats page with the link. An edit sends only the keys it changed; once somebody has started, the
 * locked ones (LOCKED_SETTINGS) are disabled with a line why. What the server would refuse is said as lines beside the
 * button (settingsProblems).
 *
 * «Защита от списывания» (20261020120000_quiz_protection): three levels as a list of choices, each with a line of what it
 * does and what a web page cannot catch; the strict level adds «Завершить попытку после N уходов» (3 by default). Locked
 * after the start with the timer.
 *
 * `?all=1&design=1` (the studio's «Отправить по ссылке», release 47.2) makes a quiz «как в студии»: one quiet line says
 * the questions, their order and the look are the studio page's («Открыть студию» goes back there), and the settings the
 * page decides are not shown — which subjects, how many questions, the set, the order of the questions, the cover and
 * the colour. The page is read once to count its keyed questions: the count and the timer follow it, and a page with
 * none says so before «Создать». An edit of such a quiz shows the same switch, locked once somebody has started.
 */

type Problem = SettingsProblem | 'when' | 'page';
type OpensMode = 'now' | 'at';
type ClosesMode = 'at' | 'never';

/** A subject only of oral questions has none for a quiz (its questions live in its own editor). */
const oralOnly = (subject: SummarySubject) => subject.keyed + subject.no_key === 0 && Boolean(subject.oral);

/** A value of a list that allows «нет»: PaperSelect takes numbers, so null is 0. */
const nz = (value: number | null) => value ?? 0;
const zn = (value: number) => (value === 0 ? null : value);

function withCurrent(options: readonly (number | null)[], current: number | null): Array<number | null> {
  return options.includes(current) ? [...options] : [...options, current].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
}

export default function QuizSetupPage() {
  const params = useParams();
  const containerId = (params.id ?? '') as Uuid;
  const quizId = (params.quizId ?? null) as Uuid | null;
  const editing = quizId !== null;
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const allAsked = !editing && search.get('all') === '1';
  // ?all=1&design=1: the studio's page as it is (release 47.2).
  const designAsked = allAsked && search.get('design') === '1';
  // ?all=1: five settings in view, the rest folded under «Ещё настройки».
  const compact = allAsked;
  const [moreOpen, setMoreOpen] = useState(false);
  const frame = useFrame<HTMLDivElement>();
  // A computer: «Ещё настройки» stands on top of the right column and the folded settings open under both cards,
  // below the window's edge at 734 px — the window moves the least to show where they begin (bringIntoView).
  const moreRef = useRef<HTMLDivElement>(null);
  const revealMore = useRef(false);
  const toggleMore = () => {
    revealMore.current = !moreOpen && frame.side;
    setMoreOpen(!moreOpen);
  };
  useEffect(() => {
    if (!moreOpen || !revealMore.current) return;
    revealMore.current = false;
    const block = moreRef.current;
    const heading = block?.querySelector('.qa-part-h');
    if (block && heading) bringIntoView(block, heading);
  }, [moreOpen]);
  const formId = useId();
  const data = useContainerData(containerId);
  const summary = data.data?.summary ?? null;
  const owner = summary?.role === 'owner';
  // A test's quiz (containers.kind 'test', release 47.3): its words name the test, not an exam.
  const ofTest = summary?.kind === 'test';
  const pageTitle = editing ? QA_SETUP.editTitle : QA_SETUP.newTitle;
  useDocumentTitle(summary ? `${pageTitle} · ${summary.title}` : pageTitle);
  useEffect(() => {
    if (summary) rememberContainerTitle(summary.id, summary.title);
  }, [summary]);

  const listPath = `/exams/c/${containerId}/quizzes`;
  const statsPath = quizId ? `${listPath}/${quizId}` : listPath;

  // ── the pool: keyed questions of the exam's subjects (oral-only subjects have none) ──
  const items = data.data?.items;
  const counts = useMemo(() => keyedBySubject(items ? items.values() : []), [items]);
  const subjects = useMemo(
    () => (summary?.subjects ?? []).filter((subject) => !oralOnly(subject) || (counts.get(subject.id) ?? 0) > 0),
    [summary, counts],
  );
  const subjectOrder = useMemo(() => new Map(subjects.map((subject, index) => [subject.id, index])), [subjects]);

  // ── the quiz being edited ──
  const [quiz, setQuiz] = useState<QuizRow | null>(null);
  const [quizError, setQuizError] = useState<{ text: string; missing: boolean } | null>(null);
  const loadQuiz = useCallback(() => {
    if (!quizId) return;
    setQuizError(null);
    listQuizzes(containerId).then(
      (rows) => {
        const row = rows.find((entry) => entry.id === quizId) ?? null;
        if (row) setQuiz(row);
        else setQuizError({ text: QA_SETUP.notFound, missing: true });
      },
      (failure: unknown) => setQuizError({ text: errorText(failure, undefined, QA_SETUP.loadFailed), missing: false }),
    );
  }, [containerId, quizId]);
  useEffect(() => {
    if (editing && owner) loadQuiz();
  }, [editing, owner, loadQuiz]);
  const locked = Boolean(editing && quiz?.started);
  const lockedKey = (key: keyof QuizSettings) => locked && (LOCKED_SETTINGS as readonly string[]).includes(key);
  const studioPath = `/exams/c/${containerId}/studio`;

  // ── the form ──
  const [form, setForm] = useState<QuizSettings | null>(null);
  const [original, setOriginal] = useState<QuizSettings | null>(null);
  const [opensMode, setOpensMode] = useState<OpensMode>('now');
  const [closesMode, setClosesMode] = useState<ClosesMode>('at');
  // A new quiz's count and timer follow the subjects until the author picks them (an edit keeps what was saved).
  const [touched, setTouched] = useState({ count: editing, time: editing });
  useEffect(() => {
    if (form || !owner || !data.data) return;
    let start: QuizSettings | null = null;
    if (editing) {
      if (quiz) {
        start = settingsOf(quiz);
        setOriginal(start);
      }
    } else {
      const ids = subjects.filter((subject) => (counts.get(subject.id) ?? 0) > 0).map((subject) => subject.id);
      start = defaultSettings(ids, poolOf(ids, counts), new Date());
      if (allAsked) {
        start = allQuestions(start, poolOf(ids, counts), data.data.summary.title);
        // «все» stays «все» when a subject is ticked off or on (countFor); the timer still follows the count.
        setTouched({ count: true, time: false });
      }
      if (designAsked) start = { ...start, design: true };
    }
    if (!start) return;
    setForm(start);
    setOpensMode(start.opens_at ? 'at' : 'now');
    setClosesMode(start.closes_at ? 'at' : 'never');
  }, [form, owner, data.data, editing, quiz, subjects, counts, allAsked, designAsked]);

  const pool = form ? poolOf(form.subject_ids, counts) : 0;
  const designOn = form?.design === true;
  // The studio's page of a quiz «как в студии»: how many keyed questions it holds and its title (null — not read).
  const [page, setPage] = useState<{ count: number; title: string } | null>(null);
  const pageCount = page?.count ?? null;
  useEffect(() => {
    if (!designOn || !items) return undefined;
    let live = true;
    fetchTestDoc(containerId).then(
      (stored) => {
        if (!live) return;
        const doc = stored ? normalizeDoc(stored.doc).doc : null;
        setPage({ count: doc ? pageQuestionCount(doc.blocks, items) : 0, title: doc?.title ?? '' });
      },
      () => {
        // Unread, the server still counts at «Создать» (MC013 no_questions).
        if (live) setPage(null);
      },
    );
    return () => {
      live = false;
    };
  }, [designOn, containerId, items]);
  // A new quiz: the count is the page's (back to all of the subjects' when the switch goes off), the timer follows it
  // until the author picks one, and the name the exam gave becomes the page's own.
  const wasDesign = useRef(false);
  useEffect(() => {
    if (editing || !allAsked) return;
    // Off again: only after it was on (the form's start already has all of the subjects').
    const turnedOff = !designOn && wasDesign.current;
    wasDesign.current = designOn;
    if (!designOn && !turnedOff) return;
    const count = designOn ? (pageCount !== null && pageCount >= 1 ? Math.min(pageCount, MAX_ITEMS) : null) : Math.max(1, Math.min(pool, MAX_ITEMS));
    if (count === null) return;
    const examName = (data.data?.summary.title ?? '').trim().slice(0, 120).trim();
    const pageName = designOn ? (page?.title ?? '').trim().slice(0, 120).trim() : '';
    setForm((current) =>
      current
        ? {
            ...current,
            title: pageName && current.title.trim() === examName ? pageName : current.title,
            item_count: count,
            time_limit_min: touched.time ? current.time_limit_min : defaultMinutes(count),
          }
        : current,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, designOn, editing]);
  const set = <K extends keyof QuizSettings>(key: K, value: QuizSettings[K]) => setForm((current) => (current ? { ...current, [key]: value } : current));

  const toggleSubject = (subjectId: string) =>
    setForm((current) => {
      if (!current) return current;
      const ids = current.subject_ids.includes(subjectId)
        ? current.subject_ids.filter((id) => id !== subjectId)
        : [...current.subject_ids, subjectId].sort((a, b) => (subjectOrder.get(a) ?? 0) - (subjectOrder.get(b) ?? 0));
      const before = poolOf(current.subject_ids, counts);
      const after = poolOf(ids, counts);
      const count = touched.count ? countFor(current.item_count, before, after) : Math.max(1, Math.min(20, after, MAX_ITEMS));
      const minutes = touched.time ? current.time_limit_min : defaultMinutes(count);
      return { ...current, subject_ids: ids, item_count: count, time_limit_min: minutes };
    });
  const chooseCount = (count: number) => {
    setTouched((current) => ({ ...current, count: true }));
    setForm((current) => (current ? { ...current, item_count: count, time_limit_min: touched.time ? current.time_limit_min : defaultMinutes(count) } : current));
  };
  const chooseTime = (minutes: number | null) => {
    setTouched((current) => ({ ...current, time: true }));
    set('time_limit_min', minutes);
  };
  const chooseOpens = (mode: OpensMode) => {
    setOpensMode(mode);
    set('opens_at', mode === 'now' ? null : form?.opens_at ?? nextHour(new Date()));
  };
  const chooseCloses = (mode: ClosesMode) => {
    setClosesMode(mode);
    set('closes_at', mode === 'never' ? null : form?.closes_at ?? weekOn(new Date()));
  };

  // ── the cover: uploaded as soon as it is chosen, named by its sha256 in the exam's folder ──
  const coverRef = useRef<HTMLInputElement>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverNote, setCoverNote] = useState<string | null>(null);
  const uploadCover = async (file: Blob) => {
    setCoverNote(null);
    setCoverBusy(true);
    try {
      const made = await pictureFromFile(file);
      if (made === 'type') return setCoverNote(QA_SETUP.coverType);
      if (made === 'size') return setCoverNote(QA_SETUP.coverSize);
      if (made === 'heic') return setCoverNote(QA_SETUP.coverHeic);
      // quiz-covers takes PNG, JPEG, GIF and WebP (a BMP the browser cannot redraw stays BMP).
      const path = made.picture.type === 'image/bmp' ? null : picturePath(containerId, made.id, made.picture.type);
      if (!path) return setCoverNote(QA_SETUP.coverType);
      if ((await uploadPicture(path, made.picture, COVER_BUCKET)) === 'refused') return setCoverNote(QA_SETUP.coverRefused);
      set('cover_path', path);
    } catch {
      setCoverNote(QA_SETUP.coverFailed);
    } finally {
      setCoverBusy(false);
    }
  };

  let problems: Problem[] = form ? settingsProblems(form, pool) : [];
  // After the first attempt the questions are fixed: the pool on this device has no say any more. «Как в студии»: the
  // page has the say (its keyed questions), not the subjects.
  if (locked || designOn) problems = problems.filter((problem) => problem !== 'subjects' && problem !== 'count');
  if (designOn && !locked && pageCount === 0) problems.push('page');
  if (form && ((opensMode === 'at' && !form.opens_at) || (closesMode === 'at' && !form.closes_at))) problems.push('when');
  const closesPast = Boolean(form && closesMode === 'at' && form.closes_at && Date.parse(form.closes_at) < Date.now());

  // ── «Создать» / «Сохранить» ──
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const submit = async () => {
    if (!form || saving || coverBusy || problems.length > 0) return;
    const settings: QuizSettings = {
      ...form,
      title: form.title.trim(),
      opens_at: opensMode === 'now' ? null : form.opens_at,
      closes_at: closesMode === 'never' ? null : form.closes_at,
    };
    setSaving(true);
    setSaveError(null);
    try {
      if (!editing) {
        const row = await createQuiz(containerId, settings);
        track('quiz.created', { items: settings.item_count, minutes: settings.time_limit_min ?? 0, attempts: settings.attempts ?? 0 });
        navigate(`${listPath}/${row.id}`, { replace: true, state: { quizNote: 'created' } });
        return;
      }
      if (!original || !quizId) return;
      const patch = changedSettings(original, settings);
      if (locked) for (const key of LOCKED_SETTINGS) delete patch[key];
      const changed = Object.keys(patch).length > 0;
      if (changed) await updateQuiz(quizId, patch);
      navigate(statsPath, { replace: true, state: { quizNote: changed ? 'saved' : null } });
    } catch (failure) {
      const code = (failure as { code?: unknown } | null)?.code;
      setSaveError(settings.design && code === 'MC013' ? QA_SETUP.problems.page : errorText(failure, QA_ERRORS));
      setSaving(false);
    }
  };

  // ───────────────────────────── render ─────────────────────────────

  const header = (
    <header className="ex-head qa-head">
      <div style={{ minWidth: 0 }}>
        {summary ? (
          <p className="ex-crumb">
            <Link to={`/exams/c/${containerId}`}>{summary.title}</Link>
            {' · '}
            <Link to={listPath}>{QA_LIST.title}</Link>
          </p>
        ) : null}
        <h1 className="ex-h1">{pageTitle}</h1>
        {/* «Контрольная» said once where the word first appears (UX audit 21.10). */}
        {!editing && summary ? <p className="ex-meta qa-new-lede">{nb(QA_SETUP.newLede(ofTest))}</p> : null}
      </div>
    </header>
  );
  const shell = (children: ReactNode) => (
    <div className="sf-page qa-page" ref={frame.ref} data-frame={frame.size}>
      {header}
      {children}
    </div>
  );

  if (!summary) {
    if (data.loading) {
      return shell(
        <p className="qa-wait" role="status">
          {QA_SETUP.loading}
        </p>,
      );
    }
    return shell(
      data.gone ? (
        <p className="ex-note">
          {GONE.title}. {GONE.text}{' '}
          <Link className="sf-link" to="/exams">
            {TO_EXAMS}
          </Link>
        </p>
      ) : (
        <p className="ex-note" role="alert">
          {data.error && /[а-яё]/i.test(data.error) ? data.error : QA_SETUP.loadFailed}{' '}
          <button type="button" className="sf-link" onClick={data.reload}>
            {QA_SETUP.retry}
          </button>
        </p>
      ),
    );
  }
  if (!owner) {
    return shell(
      <>
        <p className="qa-lede">{ofTest ? QA_LIST.authorOnlyTest : QA_LIST.authorOnly}</p>
        <p>
          <Link className="sf-link" to={`/exams/c/${containerId}`}>
            {ofTest ? QA_LIST.toTest : QA_LIST.toExam}
          </Link>
        </p>
      </>,
    );
  }
  if (quizError) {
    return shell(
      <p className="ex-note" role="alert">
        {quizError.text}{' '}
        {quizError.missing ? (
          <Link className="sf-link" to={listPath}>
            {QA_SETUP.toList}
          </Link>
        ) : (
          <button type="button" className="sf-link" onClick={loadQuiz}>
            {QA_SETUP.retry}
          </button>
        )}
      </p>,
    );
  }
  if (!form) {
    return shell(
      <p className="qa-wait" role="status">
        {QA_SETUP.loading}
      </p>,
    );
  }

  const anyPool = subjects.some((subject) => (counts.get(subject.id) ?? 0) > 0);
  const timeOptions: PaperSelectOption<number>[] = withCurrent(TIME_OPTIONS, form.time_limit_min).map((value) => ({
    value: nz(value),
    label: value === null ? QA_SETUP.timeNone : QA_SETUP.timeOption(value),
  }));
  const countOptions: PaperSelectOption<number>[] = countChoices(pool, form.item_count).map((choice) => ({
    value: choice.value,
    label: choice.all ? QA_SETUP.countAll(choice.value) : QA_SETUP.countOption(choice.value),
  }));
  const attemptOptions: PaperSelectOption<number>[] = withCurrent(ATTEMPT_OPTIONS, form.attempts)
    .sort((a, b) => (a ?? Infinity) - (b ?? Infinity))
    .map((value) => ({ value: nz(value), label: value === null ? QA_SETUP.attemptsNone : QA_SETUP.attemptsOption(value) }));
  const passOptions: PaperSelectOption<number>[] = withCurrent(PASS_OPTIONS, form.pass_percent)
    .sort((a, b) => (a ?? -1) - (b ?? -1))
    .map((value) => ({ value: nz(value), label: value === null ? QA_SETUP.passNone : QA_SETUP.passOption(value) }));
  const reviews: QuizReview[] = ['score', 'mistakes', 'answers', 'mistakes_then_answers'];
  const gradings: QuizGrading[] = ['best', 'last'];
  const who = whoOf(form);

  const explained = hasExplanations(items ? items.values() : [], form.subject_ids);
  const oneSubject = subjects.length === 1;
  const reviewHints = [who === 'guests' && form.review === 'answers' ? QA_SETUP.reviewGuests : null, explained ? QA_SETUP.reviewExplain(form.review) : null];
  const opensWords = opensMode === 'at' ? dateWords(form.opens_at) : '';
  const closesWords = closesMode === 'at' ? dateWords(form.closes_at) : '';

  const select = <T extends string | number>(p: {
    label: string;
    value: T;
    options: ReadonlyArray<PaperSelectOption<T>>;
    onChange: (value: T) => void;
    disabled?: boolean;
    hint?: string | null | ReadonlyArray<string | null>;
    after?: ReactNode;
  }) => {
    const hints = (Array.isArray(p.hint) ? p.hint : [p.hint]).filter((hint): hint is string => Boolean(hint));
    return (
      <div className="im-field qa-field">
        <span className="im-label">{p.label}</span>
        <span className="qa-when">
          <PaperSelect ariaLabel={p.label} value={p.value} options={p.options} onChange={p.onChange} disabled={p.disabled || saving} />
          {p.after}
        </span>
        {hints.map((hint) => (
          <p key={hint} className="im-hint" data-muted="">
            {nb(hint)}
          </p>
        ))}
      </div>
    );
  };

  // ── the fields, each once: the usual form puts them in three cards; ?all=1 shows five and folds the rest ──
  const nameField = (
    <div className="im-field qa-field">
      <label className="im-label" htmlFor={`${formId}-name`}>
        {QA_SETUP.name}
      </label>
      <input
        id={`${formId}-name`}
        className="im-input"
        value={form.title}
        maxLength={120}
        disabled={saving}
        aria-invalid={problems.includes('title') ? true : undefined}
        onChange={(event) => set('title', event.target.value)}
      />
    </div>
  );
  // «Как в студии»: the page's questions in its order — the switch, the quiet line and the way back to the studio.
  const designField =
    designAsked || original?.design ? (
      <div className="im-field qa-field qa-design">
        <label className="qa-toggle">
          <input
            type="checkbox"
            checked={designOn}
            disabled={saving || lockedKey('design')}
            aria-describedby={`${formId}-design`}
            onChange={(event) => set('design', event.target.checked)}
          />
          <span className="qa-toggle-t">{QA_SETUP.design}</span>
        </label>
        <p id={`${formId}-design`} className="im-hint" data-muted="">
          {designOn ? QA_SETUP.designLine : QA_SETUP.designOff}{' '}
          <Link className="sf-link" to={studioPath}>
            {QA_SETUP.toStudio}
          </Link>
        </p>
      </div>
    ) : null;
  // One subject: nothing to choose, so no «Вопросы из» (the count's hint says how many there are).
  const subjectsField = !oneSubject && !designOn ? (
    <fieldset className="qa-subjects" disabled={lockedKey('subject_ids') || saving}>
      <legend className="im-label">{QA_SETUP.subjects}</legend>
      {anyPool ? (
        <ul className="qa-checks">
          {subjects.map((subject) => {
            const n = counts.get(subject.id) ?? 0;
            return (
              <li key={subject.id}>
                <label className="qa-check" data-off={n === 0 ? '' : undefined}>
                  <input
                    type="checkbox"
                    checked={form.subject_ids.includes(subject.id)}
                    disabled={n === 0 && !form.subject_ids.includes(subject.id)}
                    onChange={() => toggleSubject(subject.id)}
                  />
                  <span className="qa-check-t">
                    <span className="qa-check-title">{subject.title}</span>
                    <span className="qa-check-meta">{nb(QA_SETUP.subjectMeta(n))}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
      {anyPool ? (
        <p className="im-hint" data-muted="">
          {nb(QA_SETUP.pool(pool))}
        </p>
      ) : null}
    </fieldset>
  ) : null;
  const noPoolLine = !anyPool && !designOn ? (
    <p className="im-hint">
      {QA_SETUP.noPool}{' '}
      <Link className="sf-link" to={`/exams/c/${containerId}/keys`}>
        {QA_SETUP.toKeys}
      </Link>
    </p>
  ) : null;
  const countField = designOn
    ? null
    : select({
        label: QA_SETUP.count,
        value: form.item_count,
        options: countOptions,
        onChange: chooseCount,
        disabled: lockedKey('item_count') || pool === 0,
        hint: oneSubject && anyPool ? QA_SETUP.poolOne(pool) : null,
      });
  const setField = designOn
    ? null
    : select({
        label: QA_SETUP.set,
        value: form.same_set ? 'same' : 'own',
        options: [
          { value: 'own', label: QA_SETUP.setOwn },
          { value: 'same', label: QA_SETUP.setSame },
        ],
        onChange: (value) => set('same_set', value === 'same'),
        disabled: lockedKey('same_set'),
        hint: form.same_set ? null : QA_SETUP.setOwnHint,
      });
  const orderField = designOn
    ? null
    : select({
        label: QA_SETUP.order,
        value: form.shuffle_items ? 'shuffle' : 'file',
        options: [
          { value: 'shuffle', label: QA_SETUP.orderShuffle },
          { value: 'file', label: QA_SETUP.orderFile },
        ],
        onChange: (value) => set('shuffle_items', value === 'shuffle'),
        disabled: lockedKey('shuffle_items'),
      });
  const optionsField = select({
    label: QA_SETUP.options,
    value: form.shuffle_options ? 'shuffle' : 'file',
    options: [
      { value: 'shuffle', label: QA_SETUP.optionsShuffle },
      { value: 'file', label: QA_SETUP.optionsFile },
    ],
    onChange: (value) => set('shuffle_options', value === 'shuffle'),
    disabled: lockedKey('shuffle_options'),
    hint: form.shuffle_options ? QA_SETUP.optionsHint : null,
  });
  const timeField = select({ label: QA_SETUP.time, value: nz(form.time_limit_min), options: timeOptions, onChange: (value) => chooseTime(zn(value)), disabled: lockedKey('time_limit_min') });
  const dateField = (p: { label: string; value: string | null; words: string; id: string; onChange: (value: string | null) => void }) => (
    <>
      <input
        type="datetime-local"
        className="im-input im-date qa-date"
        aria-label={p.label}
        aria-describedby={p.words ? p.id : undefined}
        value={localInput(p.value)}
        disabled={saving}
        onChange={(event) => p.onChange(isoFromLocal(event.target.value))}
      />
      {p.words ? (
        <span id={p.id} className="qa-date-words">
          {p.words}
        </span>
      ) : null}
    </>
  );
  const opensField = select({
    label: QA_SETUP.opens,
    value: opensMode,
    options: [
      { value: 'now', label: QA_SETUP.opensNow },
      { value: 'at', label: QA_SETUP.opensAt },
    ],
    onChange: chooseOpens,
    after:
      opensMode === 'at'
        ? dateField({
            label: QA_SETUP.opensField,
            value: form.opens_at,
            words: opensWords ? QA_SETUP.opensWords(opensWords) : '',
            id: `${formId}-opens-words`,
            onChange: (value) => set('opens_at', value),
          })
        : null,
  });
  const closesField = select({
    label: QA_SETUP.closes,
    value: closesMode,
    options: [
      { value: 'at', label: QA_SETUP.closesAt },
      { value: 'never', label: QA_SETUP.closesNever },
    ],
    onChange: chooseCloses,
    hint: closesPast ? QA_SETUP.closesPast : null,
    after:
      closesMode === 'at'
        ? dateField({
            label: QA_SETUP.closesField,
            value: form.closes_at,
            words: closesWords ? QA_SETUP.closesWords(closesWords) : '',
            id: `${formId}-closes-words`,
            onChange: (value) => set('closes_at', value),
          })
        : null,
  });
  const attemptsField = select({ label: QA_SETUP.attempts, value: nz(form.attempts), options: attemptOptions, onChange: (value) => set('attempts', zn(value)) });
  const gradingField =
    form.attempts !== 1
      ? select({
          label: QA_SETUP.grading,
          value: form.grading,
          options: gradings.map((value) => ({ value, label: QA_SETUP.gradingOption(value) })),
          onChange: (value) => set('grading', value),
        })
      : null;
  const backField = select({
    label: QA_SETUP.back,
    value: form.allow_back ? 'yes' : 'no',
    options: [
      { value: 'yes', label: QA_SETUP.backYes },
      { value: 'no', label: QA_SETUP.backNo },
    ],
    onChange: (value) => set('allow_back', value === 'yes'),
  });
  const passField = select({ label: QA_SETUP.pass, value: nz(form.pass_percent), options: passOptions, onChange: (value) => set('pass_percent', zn(value)) });
  const reviewField = select({
    label: QA_SETUP.review,
    value: form.review,
    options: reviews.map((value) => ({ value, label: QA_SETUP.reviewOption(value) })),
    onChange: (value) => set('review', value),
    hint: reviewHints,
  });
  const practiceField = (
    <div className="im-field qa-field">
      <label className="qa-toggle">
        <input
          type="checkbox"
          checked={form.offer_practice}
          disabled={saving}
          aria-describedby={`${formId}-practice ${formId}-practice-seen`}
          onChange={(event) => set('offer_practice', event.target.checked)}
        />
        <span className="qa-toggle-t">{QA_SETUP.practice}</span>
      </label>
      <p id={`${formId}-practice`} className="im-hint" data-muted="">
        {ofTest ? QA_SETUP.practiceNoteTest : QA_SETUP.practiceNote}
      </p>
      <p id={`${formId}-practice-seen`} className="im-hint" data-muted="">
        {ofTest ? QA_SETUP.practiceSeenTest : QA_SETUP.practiceSeen}
      </p>
    </div>
  );
  // «Защита от списывания»: the level, each with its line; the strict level's limit.
  const protection: QuizProtection = form.protection ?? 'off';
  const protectionLimit = form.protection_limit ?? DEFAULT_LIMIT;
  const protectionLevels: QuizProtection[] = ['off', 'normal', 'strict'];
  const protectionField = (
    <fieldset className="qa-subjects qa-guard" disabled={saving || lockedKey('protection')}>
      <legend className="im-label">{QA_SETUP.protection}</legend>
      <ul className="qa-checks">
        {protectionLevels.map((level) => (
          <li key={level}>
            <label className="qa-check">
              <input
                type="radio"
                name={`${formId}-protection`}
                value={level}
                checked={protection === level}
                onChange={() => set('protection', level)}
              />
              <span className="qa-check-t">
                <span className="qa-check-title">{QA_SETUP.protectionOption(level)}</span>
                <span className="qa-check-meta">{nb(QA_SETUP.protectionHint(level, protectionLimit))}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {protection !== 'off' ? (
        <>
          <p className="im-hint" data-muted="">
            {nb(QA_SETUP.protectionLimits)}
          </p>
          <details className="qa-details">
            <summary className="sf-link">{QA_SETUP.protectionMore}</summary>
            {QA_SETUP.protectionDetails.map((line) => (
              <p key={line} className="im-hint" data-muted="">
                {nb(line)}
              </p>
            ))}
          </details>
        </>
      ) : null}
    </fieldset>
  );
  const protectionLimitField =
    protection === 'strict'
      ? select({
          label: QA_SETUP.protectionLimit,
          value: protectionLimit,
          options: withCurrent(LIMIT_OPTIONS, protectionLimit)
            .filter((value): value is number => value !== null)
            .sort((a, b) => a - b)
            .map((value) => ({ value, label: QA_SETUP.protectionLimitOption(value) })),
          onChange: (value) => set('protection_limit', value),
          disabled: lockedKey('protection_limit'),
        })
      : null;
  const whoField = select<QuizWho>({
    label: QA_SETUP.who,
    value: who,
    options: WHO_CHOICES.map((value) => ({ value, label: QA_SETUP.whoOption(value, ofTest) })),
    onChange: (value) => setForm((current) => (current ? withWho(current, value) : current)),
    hint: QA_SETUP.whoHint(who, ofTest),
  });

  const part = (key: 'q' | 'w' | 'l' | 'm', title: string, children: ReactNode) => (
    <section className={`qa-part qa-part-${key}`} aria-labelledby={`${formId}-${key}`}>
      <h2 id={`${formId}-${key}`} className="qa-part-h">
        {title}
      </h2>
      {children}
    </section>
  );

  // «Как в студии»: the cover and the colour are the page's.
  const lookPart = designOn
    ? null
    : part(
        'l',
        QA_SETUP.partLook,
        <>
          <div className="im-field qa-field" role="group" aria-labelledby={`${formId}-cover`}>
            <span id={`${formId}-cover`} className="im-label">
              {QA_SETUP.cover}
            </span>
            {form.cover_path ? <img className="qa-cover" src={coverUrl(form.cover_path)} alt={QA_SETUP.coverAlt} /> : null}
            <span className="qa-cover-acts">
              <button type="button" className="sf-secondary" disabled={saving || coverBusy} aria-busy={coverBusy || undefined} onClick={() => coverRef.current?.click()}>
                {form.cover_path ? QA_SETUP.coverReplace : QA_SETUP.coverUpload}
              </button>
              {form.cover_path ? (
                <button
                  type="button"
                  className="sf-link"
                  data-muted=""
                  disabled={saving || coverBusy}
                  onClick={() => {
                    setCoverNote(null);
                    set('cover_path', null);
                  }}
                >
                  {QA_SETUP.coverRemove}
                </button>
              ) : null}
            </span>
            <input
              ref={coverRef}
              type="file"
              accept="image/*"
              hidden
              aria-label={QA_SETUP.coverUpload}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void uploadCover(file);
              }}
            />
            <p className="im-hint" data-muted={coverNote && !coverBusy ? undefined : ''} role={coverNote && !coverBusy ? 'alert' : undefined}>
              {nb(coverBusy ? QA_SETUP.coverUploading : coverNote ?? QA_SETUP.coverHint)}
            </p>
          </div>
          <fieldset className="qa-accents" disabled={saving}>
            <legend className="im-label">{QA_SETUP.accent}</legend>
            <span className="qa-swatches">
              {QUIZ_ACCENTS.map((accent) => (
                <label key={accent} className="qa-swatch" data-accent={accent}>
                  <input type="radio" name={`${formId}-accent`} value={accent} checked={form.accent === accent} onChange={() => set('accent', accent)} />
                  <span className="qa-swatch-dot" aria-hidden="true" />
                  <span className="qa-swatch-name">{QA_SETUP.accentName(accent)}</span>
                </label>
              ))}
            </span>
            <p className="im-hint" data-muted="">
              {QA_SETUP.accentHint}
            </p>
          </fieldset>
        </>,
      );

  const side = frame.side ? '' : undefined;
  const moreButton = (
    <button type="button" className="qa-more" aria-expanded={moreOpen} aria-controls={`${formId}-more`} onClick={toggleMore}>
      <span className="qa-more-t">{QA_SETUP.more}</span>
      <span className="qa-more-n">{designOn ? QA_SETUP.moreNoteDesign : QA_SETUP.moreNote}</span>
      <svg className="qa-more-i" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
  const body = compact ? (
    <>
      <div className="qa-parts" data-side={side} data-compact="">
        {part(
          'm',
          QA_SETUP.partMain,
          <>
            {nameField}
            {designField}
            {timeField}
            {closesField}
            {whoField}
            {/* In view, not folded (owner 21.10: the right answers at the end, «как функцию … на выбор»). */}
            {reviewField}
          </>,
        )}
        {/* A computer: on top of the right column, above «Оформление» — in view at 734 px, not behind the bar; a phone:
            under «Оформление», the folded settings right under it. The order of the page is the order of the eye. */}
        {frame.side ? moreButton : null}
        {lookPart}
        {frame.side ? null : moreButton}
      </div>
      <div id={`${formId}-more`} ref={moreRef} className="qa-parts qa-more-parts" data-side={side} hidden={!moreOpen}>
        {part(
          'q',
          QA_SETUP.partQuestions,
          <>
            {subjectsField}
            {noPoolLine}
            {countField}
            {setField}
            {orderField}
            {optionsField}
          </>,
        )}
        {part(
          'w',
          QA_SETUP.partWhen,
          <>
            {opensField}
            {attemptsField}
            {gradingField}
            {backField}
            {passField}
            {practiceField}
            {protectionField}
            {protectionLimitField}
          </>,
        )}
      </div>
    </>
  ) : (
    <div className="qa-parts" data-side={side}>
      {part(
        'q',
        QA_SETUP.partQuestions,
        <>
          {nameField}
          {designField}
          {subjectsField}
          {noPoolLine}
          {countField}
          {setField}
          {orderField}
          {optionsField}
          {timeField}
        </>,
      )}
      {part(
        'w',
        QA_SETUP.partWhen,
        <>
          {opensField}
          {closesField}
          {attemptsField}
          {gradingField}
          {backField}
          {passField}
          {reviewField}
          {practiceField}
          {whoField}
          {protectionField}
          {protectionLimitField}
        </>,
      )}
      {lookPart}
    </div>
  );

  return (
    <div className="sf-page qa-page" ref={frame.ref} data-frame={frame.size}>
      {header}
      {locked ? <p className="qa-locked">{designOn ? QA_SETUP.lockedDesign : QA_SETUP.locked}</p> : null}
      {body}
      <div className="ex-cta qa-cta" data-row={frame.side ? '' : undefined}>
        {problems.length > 0 || saveError ? (
          <div className="qa-cta-why" role={saveError ? 'alert' : 'status'}>
            {saveError ? <p>{saveError}</p> : null}
            {problems.map((problem) => (
              <p key={problem}>{QA_SETUP.problems[problem]}</p>
            ))}
          </div>
        ) : null}
        <div className="qa-cta-acts">
          <Link className="sf-link" data-muted="" to={statsPath}>
            {QA_SETUP.cancel}
          </Link>
          <button type="button" className="sf-primary" disabled={saving || coverBusy || problems.length > 0} onClick={() => void submit()}>
            {editing ? (saving ? QA_SETUP.saving : QA_SETUP.save) : saving ? QA_SETUP.creating : QA_SETUP.create}
          </button>
        </div>
      </div>
    </div>
  );
}
