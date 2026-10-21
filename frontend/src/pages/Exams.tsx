import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { EXAM_MESSAGES, examErrorMessage, listExams, type ExamListItem } from '../api/exams';
import { fetchQuestionEvents } from '../api/learning';
import { useAuth } from '../hooks/useAuth';
import { examSummary, statesByHash, type QuestionState } from '../lib/learning/readiness';
import { daysUntil, formatDay, KIND_WORDS, relativeDays, subjectOf } from '../lib/exams/format';
import { pluralRu } from '../components/conversation/visuals';
import { useMapJob } from '../components/exams/mapJobs';
import { glue } from '../components/exams/sheetModel';
import { useFrame } from '../components/exams/useFrame';
import { usePhone } from '../lib/usePhone';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { detectInAppBrowser } from '../lib/inAppBrowser';
import { localDateKey } from '../utils/streak';
import type { OverviewContainer } from '../types/container';
import { containerDays, useContainerLayer } from './containerLayer';
import { containerDateLine, containerFigure, containerFigureLine, containerQuestions, containerSizeLine } from './containerFigure';
import { NEW_TEST, TEST_HOME } from '../components/test/copyTest';
import { isOwnTest } from '../components/containers/model';
import TestsView, { TestDoors, ViewSwitch } from '../components/quick/TestsView';
import { TESTS_VIEW } from '../components/quick/copyQuick';

export { containerDays };
import '../styles/paper.css';
import '../components/exams/exams.css';
import './containerScreens.css';
import '../components/test/entry.css';

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
 * A phone's card (10_Project/Phone_Declutter_2026-10-08): one meta line — the day, the kind only when it is not an
 * exam («21 октября, через 13 дней», «зачёт · 4 октября, завтра», «экзамен, дата не указана»).
 */
export function examPhoneDateLine(item: Pick<ExamListItem, 'kind' | 'exam_date'>, now: Date = new Date()): string {
  const line = examDateLine(item, now);
  const prefix = `${KIND_WORDS.exam} · `;
  return item.kind === 'exam' && line.startsWith(prefix) && !line.includes('прошёл') ? line.slice(prefix.length) : line;
}

/**
 * A phone's line under the bar, in place of the status pills: «В лекциях: есть 15 · частично 3 · нет 2 · подтверждено 6»
 * (the counts name what they count, in the bar's order); before the first mapping and while one runs, what the meta
 * line says on a computer («20 вопросов · идёт сверка с лекциями»).
 */
export function examPhoneCountsLine(item: ExamListItem, confirmed: number | null, mappingNow: boolean): string {
  const pills = examPills(item, mappingNow);
  if (pills.length === 0) return examCoverageLine(item, confirmed, mappingNow);
  const line = `В лекциях: ${pills.map((pill) => `${pill.word} ${pill.count}`).join(' · ')}`;
  return confirmed !== null && confirmed > 0 ? `${line} · подтверждено ${confirmed}` : line;
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

function ExamRow({ item, states, phone }: { item: ExamListItem; states: Map<string, QuestionState> | null; phone: boolean }) {
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
          {glue(phone ? examPhoneDateLine(item) : `${examDateLine(item)} · ${examCoverageLine(item, confirmed, mappingNow)}`)}
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
      {/* A phone: the counts as one line of text under the bar, not three pills (10_Project/Phone_Declutter_2026-10-08). */}
      {phone ? <p className="ex-row-counts">{glue(examPhoneCountsLine(item, confirmed, mappingNow))}</p> : null}
      {(pills.length > 0 || canDraw) && (
        <div className="ex-row-foot">
          {pills.length > 0 && !phone && (
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

// ---------------------------------------------------------------------------------------------
// Exam containers in the list (spec decisions 2, 46, 48; Concept 1 §3.1 with the design critique's words)

/** The «видели» part of a container's bar: the green of «в счёте», lighter (design critique I13). */
const SEEN_BAR = 'color-mix(in srgb, var(--ex-ok-fg) 40%, transparent)';

export { containerDateLine, containerFigure, containerFigureLine, containerQuestions, containerSizeLine };

/** A week or less to the nearest date ahead: the date line in ink, as for an oral exam. */
export function containerIsNear(container: Pick<OverviewContainer, 'exam_date' | 'subjects'>, now: Date = new Date()): boolean {
  const { day, past } = containerDays(container, localDateKey(now));
  if (!day || past) return false;
  const days = daysUntil(day, now);
  return days !== null && days >= 0 && days <= 7;
}

export type ListRow = { kind: 'exam'; item: ExamListItem } | { kind: 'container'; container: OverviewContainer };

/**
 * The list in today's order (api/exams.ts listExams): dates ahead nearest first, then the newest without a date, then
 * the past, latest first — containers and plain exams together. Without containers the plain list keeps its own order.
 */
export function listRows(plain: ExamListItem[], containers: OverviewContainer[], today: string = localDateKey()): ListRow[] {
  const rows: ListRow[] = plain.map((item) => ({ kind: 'exam', item }));
  if (containers.length === 0) return rows;
  const keyed = [
    ...rows,
    ...containers.map((container): ListRow => ({ kind: 'container', container })),
  ].map((row, index) => {
    const date = row.kind === 'exam' ? row.item.exam_date : containerDays(row.container, today).day;
    const created = row.kind === 'exam' ? row.item.created_at : row.container.created_at;
    const group = !date ? 1 : date >= today ? 0 : 2;
    return { row, date: date ?? '', created, group, index };
  });
  keyed.sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group;
    if (a.group === 0 && a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.group === 2 && a.date !== b.date) return a.date > b.date ? -1 : 1;
    if (a.created !== b.created) return a.created > b.created ? -1 : 1;
    return a.index - b.index;
  });
  return keyed.map((entry) => entry.row);
}

/**
 * A container's row: the student's name for the exam, one meta line, the bar and, on a phone, its figure under it. The
 * author's own test (release 47.3) says «Тест · 12 вопросов», without a date or a figure: it is given, not studied.
 */
function ContainerRow({ container, questions, phone }: { container: OverviewContainer; questions: number; phone: boolean }) {
  if (isOwnTest(container)) {
    return (
      <li data-container="" data-kind="test">
        <Link className="ex-row" to={`/exams/c/${encodeURIComponent(container.id)}`}>
          <span className="ex-row-title">{container.title}</span>
          <span className="ex-row-meta" style={{ display: 'block' }}>
            {glue(TEST_HOME.listMeta(questions))}
          </span>
        </Link>
        <span className="ex-row-go" aria-hidden="true">
          {ARROW}
        </span>
      </li>
    );
  }
  const figure = containerFigure(container);
  const date = containerDateLine(container);
  // A computer: the figure joins the meta and stays whole («верно в два разных дня: 143 из 960»), so a long line breaks
  // after «·», never inside it.
  const meta = phone
    ? `${date} · ${containerSizeLine(container, questions, false)}`
    : `${date} · ${containerSizeLine(container, questions, true)}${figure ? ` · ${containerFigureLine(figure).replace(/^В/, 'в').replace(/ /g, '\u00a0')}` : ''}`;
  return (
    <li data-near={containerIsNear(container) ? '' : undefined} data-container="">
      {/* The whole card is the link; no pill: the exam's page holds its one action (Concept 1 §3.1). */}
      <Link className="ex-row" to={`/exams/c/${encodeURIComponent(container.id)}`}>
        <span className="ex-row-title">{container.title}</span>
        <span className="ex-row-meta" style={{ display: 'block' }}>
          {glue(meta)}
        </span>
      </Link>
      {/* «верно в два разных дня» · «видели» · not seen yet; the text carries the numbers. */}
      {figure ? (
        <span className="ex-bar" aria-hidden="true">
          {figure.twoDays > 0 ? <i data-k="full" style={{ flexGrow: figure.twoDays }} /> : null}
          {figure.seen > figure.twoDays ? <i data-k="seen" style={{ flexGrow: figure.seen - figure.twoDays, background: SEEN_BAR }} /> : null}
          {figure.keyed > figure.seen ? <i data-k="unmapped" style={{ flexGrow: figure.keyed - figure.seen }} /> : null}
        </span>
      ) : null}
      {phone && figure ? <p className="ex-row-counts">{glue(containerFigureLine(figure))}</p> : null}
      <span className="ex-row-go" aria-hidden="true">
        {ARROW}
      </span>
    </li>
  );
}

/** The questions of every exam the list knows, by exam id: an oral part's count joins its container's row. */
function oralTotalsOf(items: ExamListItem[] | null): Map<string, number> {
  return new Map((items ?? []).map((item) => [item.id, item.total]));
}

/** iPhone: a file from Telegram has to be saved to «Файлы» before a page can pick it (design critique I14). */
function onIPhone(): boolean {
  try {
    return detectInAppBrowser(navigator.userAgent).os === 'ios';
  } catch {
    return false;
  }
}

/** The dark circle with a plus of «Новый экзамен» / «Новый тест» (prototype .pill.white). */
function NewDot() {
  return (
    <span className="ex-new-dot" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </span>
  );
}

/**
 * No exam yet, with the exam container in the database (Concept 1 §3.1, the design critique's words): one door,
 * /exams/import, for any file or a list typed in; the example one quiet link away. «Новый экзамен» at the top is left
 * out here: one way in (rule 10).
 */
function EmptyExams({ phone }: { phone: boolean }) {
  return (
    <div className="ex-empty">
      <div className="ex-empty-copy">
        <h2>Загрузите вопросы к экзамену</h2>
        <p>
          {phone
            ? 'Один общий файл или по файлу на предмет.'
            : 'Один общий файл или по файлу на предмет. С вариантами ответов Meldy возьмёт ключ из файла, а устные ответы проверит по вашим лекциям.'}
        </p>
        <Link className="sf-primary" to="/exams/import">
          Выбрать файлы
        </Link>
        <p>
          <Link className="sf-link" to="/exams/import">
            Вставить список текстом
          </Link>
        </p>
        {/* «Новый тест» (spec 2026-10-18 §47.2): no file at all, the questions are written in the builder. */}
        <p>
          {NEW_TEST.emptyLead}{' '}
          <Link className="sf-link" to="/tests/new">
            {NEW_TEST.entry}
          </Link>
        </p>
        {/* The example exam (/try): its lectures and list are checked already, nothing is saved. */}
        <p>
          Сначала посмотреть, как это работает?{' '}
          <Link className="sf-link" to="/try">
            Попробовать на примере
          </Link>
        </p>
        {onIPhone() ? <p>{glue('Файл из Telegram сначала сохраните в «Файлы».')}</p> : null}
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
  );
}

const NO_CONTAINERS: OverviewContainer[] = [];

/**
 * «Экзамены»: the student's exams as cards, nearest date first. Each card says when the exam is, how
 * many of its questions are in the lectures and how many are confirmed by answers, with the status
 * pills of the sheet.
 *
 * Exam containers (spec decision 2) are rows of the same list, by date; an oral exam that lives inside a container is
 * not a row of its own (attached_exam_ids), and its questions' answers are not read here. Whenever the containers
 * cannot be read the page is exactly today's (containerLayer.tsx); without network their rows come from the device's
 * copy.
 */
export default function Exams() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const location = useLocation();
  const frame = useFrame<HTMLDivElement>();
  const phone = usePhone();
  const { layer, probe } = useContainerLayer();
  // «Экзамен «…» удалён.» / «Вы вышли из «…».» after the exam's page or its settings (release 47.3): said once, with the
  // focus, then taken out of the history entry so a reload does not say it again.
  const [notice] = useState<string | null>(() => {
    const state = location.state as { notice?: unknown } | null;
    return state && typeof state.notice === 'string' ? state.notice : null;
  });
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!notice) return;
    noticeRef.current?.focus({ preventScroll: true });
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);
  const [items, setItems] = useState<ExamListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<Map<string, QuestionState> | null>(null);
  const [showLoading, setShowLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      setItems(await listExams(userId));
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

  const settled = layer.mode !== 'loading';
  const on = layer.mode === 'on' ? layer : null;
  const containers = on ? on.overview.containers : NO_CONTAINERS;
  const attached = useMemo(() => new Set(on ? on.overview.attached_exam_ids : []), [on]);
  // The plain exams: every exam but those inside a container, once the layer has answered (none of them flashes).
  const plain = useMemo(() => (items && settled ? items.filter((item) => !attached.has(item.id)) : null), [items, settled, attached]);
  // «Экзамены | Тесты» (UX audit of 21.10, P2): the author's own tests are on «Тесты», the rest here.
  const ownTests = useMemo(() => containers.filter(isOwnTest), [containers]);
  const examContainers = useMemo(() => containers.filter((container) => !isOwnTest(container)), [containers]);
  const rows = useMemo(() => (plain ? listRows(plain, examContainers) : null), [plain, examContainers]);
  const oralTotals = useMemo(() => oralTotalsOf(items), [items]);

  // «подтверждено»: the answers to the questions of the plain exams only (never the hashes of an exam in a container).
  useEffect(() => {
    if (!plain) return undefined;
    const hashes = plain.flatMap((item) => item.hashes);
    if (hashes.length === 0) return undefined;
    let live = true;
    fetchQuestionEvents(hashes, ['exam_answer'])
      .then((events) => {
        if (live) setStates(statesByHash(events));
      })
      .catch(() => {
        if (live) setStates(null); // the «подтверждено» part is left out, the list still works
      });
    return () => {
      live = false;
    };
  }, [plain]);

  const containerRows = examContainers.length > 0 ? listRows([], examContainers) : [];
  // Without network the containers come from the device's copy at once (spec decision 31, usability check m5): the
  // other exams' read waits for its retries (about 7 s), the page does not.
  const fromDevice = Boolean(on?.offline) && containerRows.length > 0;
  const list = (shown: ListRow[]) => (
    <ul className="ex-list" aria-label="Ваши экзамены">
      {shown.map((row) =>
        row.kind === 'exam' ? (
          <ExamRow key={row.item.id} item={row.item} states={states} phone={phone} />
        ) : (
          <ContainerRow key={`c:${row.container.id}`} container={row.container} questions={containerQuestions(row.container, oralTotals)} phone={phone} />
        ),
      )}
    </ul>
  );
  const anyRow = (rows !== null && rows.length > 0) || ((error !== null || fromDevice) && containerRows.length > 0);
  // The switch is there with the exam container (tests are containers); without ?view= an account of tests only
  // opens on its tests.
  const [search, setSearch] = useSearchParams();
  const asked = search.get('view');
  // Only where the exam container is used, or the page is empty: an account of old exams alone keeps today's page.
  const switchOn = Boolean(on) && (containers.length > 0 || (rows !== null && rows.length === 0));
  const view: 'exams' | 'tests' = switchOn && (asked === 'tests' || (asked !== 'exams' && rows !== null && rows.length === 0 && ownTests.length > 0)) ? 'tests' : 'exams';
  const chooseView = (next: 'exams' | 'tests') => {
    const params = new URLSearchParams(search);
    params.set('view', next);
    setSearch(params, { replace: true });
  };
  useDocumentTitle(view === 'tests' ? TESTS_VIEW.title : 'Экзамены');

  return (
    <div className="sf-page ex-list-page" ref={frame.ref} data-frame={frame.size}>
      {probe}
      <header className="ex-head">
        <div>
          {switchOn ? <ViewSwitch view={view} exams={rows?.length ?? null} tests={ownTests.length} onChange={chooseView} /> : null}
          <h1 className="ex-h1">{view === 'tests' ? TESTS_VIEW.title : 'Экзамены'}</h1>
          {view === 'tests' ? <p className="ex-meta tv-lede">{TESTS_VIEW.lede}</p> : null}
        </div>
        {view === 'tests' ? <TestDoors /> : null}
        {view === 'exams' && anyRow && (
          <div className="ex-draw" data-pair={containers.length > 0 ? '' : undefined}>
            {/* One door (spec decision 21). Without containers the old address stays (App.tsx sends it on to
                /exams/import), so such an account's page is today's to the byte. */}
            {containers.length > 0 ? (
              // Beside «Новый тест» each door says in one quiet line what it makes (release 47, M11).
              <div className="tb-door">
                <Link className="ex-secondary ex-new" to="/exams/import" aria-describedby="ex-door-exam">
                  Новый экзамен
                  <NewDot />
                </Link>
                <p id="ex-door-exam" className="tb-door-note">
                  {NEW_TEST.examNote}
                </p>
              </div>
            ) : (
              <Link className="ex-secondary ex-new" to="/exams/new">
                Новый экзамен
                <NewDot />
              </Link>
            )}
            {/* «Новый тест» (spec 2026-10-18 §47.2): questions written in the builder. A white pill too, so the
                page keeps one blue one; for the same reason as above only beside the containers' door. */}
            {containers.length > 0 ? (
              <div className="tb-door">
                <Link className="ex-secondary ex-new" to="/tests/new" aria-describedby="ex-door-test">
                  {NEW_TEST.entry}
                  <NewDot />
                </Link>
                <p id="ex-door-test" className="tb-door-note">
                  {NEW_TEST.entryNote}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </header>
      {notice ? (
        <p ref={noticeRef} className="ex-notice" role="status" tabIndex={-1}>
          {notice}
        </p>
      ) : null}

      {view === 'tests' ? (
        <TestsView tests={ownTests} />
      ) : error && containerRows.length > 0 ? (
        <>
          {/* The containers' rows stay (from the device's copy without network); the rest is one quiet line. */}
          {list(containerRows)}
          <p className="exc-rest" role="status">
            Остальные экзамены не загрузились.{' '}
            <button type="button" className="sf-link" onClick={() => void load()}>
              Повторить
            </button>
          </p>
        </>
      ) : error ? (
        <div className="ex-error" role="alert">
          <h2>Не удалось загрузить экзамены</h2>
          <p>{error} Ваши экзамены сохранены.</p>
          <button type="button" className="sf-link" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : rows === null ? (
        fromDevice ? (
          list(containerRows)
        ) : showLoading ? (
          <p className="ex-loading" role="status">
            Загружаем экзамены…
          </p>
        ) : null
      ) : rows.length === 0 ? (
        on ? (
          <EmptyExams phone={phone} />
        ) : (
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
        )
      ) : (
        list(rows)
      )}
    </div>
  );
}
