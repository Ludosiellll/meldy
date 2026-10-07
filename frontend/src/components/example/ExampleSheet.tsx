import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ExamSheet, { type SheetRowView } from '../exams/ExamSheet';
import { Mark } from '../marks';
import { COVERAGE_MARK, COVERAGE_MARK_SIZE, PILL_MARK_SCALE, type SheetCoverage } from '../exams/marks';
import {
  caveatSentence,
  coverageCounts,
  coverageShares,
  footnoteOf,
  glue,
  layoutPhrase,
  lecturesPhrase,
  matchesFilter,
  NBSP,
  noneFigureName,
  noneLabel,
  questionShareText,
  type SheetFilter,
} from '../exams/sheetModel';
import { useFrame } from '../exams/useFrame';
import { pluralRu } from '../conversation/visuals';
import { KIND_LABELS } from '../../lib/exams/format';
import { splitFragmentHeading } from '../../utils/fragmentText';
import { EXAMPLE_EXAM, EXAMPLE_LECTURES, EXAMPLE_QUESTIONS, answerableQuestions, exampleExamQuestion } from '../../data/example';
import { parsePeakFlags, type PeakFlag } from '../exams/peak';
import { loadSheetFont } from '../exams/sheet/sheetFont';
import { useSheetView, type SheetLinks } from '../exams/sheet/useSheetPage';
import ExampleWhy from './ExampleWhy';
import TryBar from './TryBar';
import { EXAMPLE_ANSWER_QUESTION, TRY_VIEW_KEY, findTryAnswer, isSeededSession, takeTryPeak, useTrySheetData } from './trySheet';

/** The honest note of the example (the owner's brief, word for word). */
export const EXAMPLE_NOTE = 'Пример: три лекции и список вопросов уже сверены. В своём экзамене это сделает Meldy по вашим лекциям.';

const WHY_ID = 'tx-why';

type TryView = 'sheet' | 'questions';

/** The example opens on its cheat sheet: it is written from the start (sheet spec 4.3). */
function storedTryView(): TryView {
  try {
    return window.sessionStorage.getItem(TRY_VIEW_KEY) === 'questions' ? 'questions' : 'sheet';
  } catch {
    return 'sheet';
  }
}

function storeTryView(view: TryView) {
  try {
    window.sessionStorage.setItem(TRY_VIEW_KEY, view);
  } catch {
    // This tab only.
  }
}

/** The example's sheet leads to the example's own answer screen and protocols. */
const TRY_LINKS: SheetLinks = {
  answer: (questionId) => `/try/ticket?q=${encodeURIComponent(questionId)}`,
  session: (session) => {
    const answer = findTryAnswer(session);
    return answer ? `/try/ticket?q=${encodeURIComponent(answer.questionId)}&answer=${encodeURIComponent(session)}` : null;
  },
  sessionNote: (session) => (isSeededSession(session) ? 'ответ примера' : null),
  addMaterial: null,
};

/** The sheet's legend as filters, with the rows' own pencil marks (ExamDetail). */
const FILTERS: Array<{ value: SheetFilter; coverage: SheetCoverage; word: string }> = [
  { value: 'cov:full', coverage: 'full', word: 'есть в лекциях' },
  { value: 'cov:partial', coverage: 'partial', word: 'частично' },
  { value: 'cov:none', coverage: 'none', word: 'нет ни в одной' },
];

/**
 * The example's sheet (/try): the same exam sheet as a real exam (components/exams/ExamSheet) with the
 * twelve questions of the example already checked against its lectures, the numbers of Meldy's column
 * computed from those marks by the sheet's own rules, «почему» with the lecture quote behind every
 * mark, the lectures themselves to read, and «Тянуть билет».
 */
export default function ExampleSheet() {
  const navigate = useNavigate();
  const frame = useFrame<HTMLDivElement>();
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<SheetFilter>('all');
  const [view, setView] = useState<TryView>(() => {
    const asked = params.get('view');
    return asked === 'sheet' || asked === 'questions' ? asked : storedTryView();
  });
  const onSheet = view === 'sheet';
  // The guest's answer just given: the sheet plays what it changed, once (the after-answer flag).
  // Taken in an effect, once: a render may run twice (StrictMode) and must not take the flag away.
  // Declared before the sheet's hook: effects run in order, and the sheet reads the flag in its own.
  const peakFlags = useRef<PeakFlag[] | null>(null);
  const peakTaken = useRef(false);
  useEffect(() => {
    if (peakTaken.current) return;
    peakTaken.current = true;
    peakFlags.current = parsePeakFlags(takeTryPeak());
  }, []);
  const sheetData = useTrySheetData();
  const sheetPage = useSheetView(
    {
      examId: EXAMPLE_EXAM.id,
      userId: null,
      examDate: null,
      sectionTitles: [],
      lectureCount: EXAMPLE_LECTURES.length,
      active: onSheet,
      side: frame.side,
      frameBox: frame.box,
      peakFlags,
      shareLine: null,
      mappingRunning: false,
      unmapped: false,
      onQuestion: (id) => setSelectedId((current) => (current === id ? null : id)),
      // A line's details take the column: «почему» of a question closes (it would stand in front of them).
      onLineOpen: () => setSelectedId(null),
      openQuestionId: onSheet ? selectedId : null,
      questionPanelId: WHY_ID,
      links: TRY_LINKS,
    },
    sheetData,
  );
  const closeSheetLine = sheetPage.closeLine;
  const chooseView = (next: TryView) => {
    storeTryView(next);
    if (next === view) return;
    setView(next);
    setSelectedId(null);
    if (next === 'questions') closeSheetLine();
    else setFilter('all');
    // A ?view= that brought the guest here must not win over this choice on reload or Back.
    if (params.has('view')) {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          updated.set('view', next);
          return updated;
        },
        { replace: true },
      );
    }
  };

  const examQuestions = useMemo(() => EXAMPLE_QUESTIONS.map(exampleExamQuestion), []);
  const allRows: SheetRowView[] = useMemo(
    () =>
      examQuestions.map((question) => ({
        question,
        number: String(question.position),
        coverage: question.coverage ?? 'unmapped',
        readiness: 'untested',
        selfRating: null,
        footnote: footnoteOf(question),
        appearance: null,
      })),
    [examQuestions],
  );
  const rows = allRows.filter((row) => matchesFilter(filter, { coverage: row.coverage, readiness: row.readiness, selfRating: null }));
  const counts = coverageCounts(allRows);
  const shares = useMemo(
    () => coverageShares(examQuestions.map((question) => ({ id: question.id, section: null, coverage: question.coverage ?? 'unmapped' })), EXAMPLE_EXAM.layout),
    [examQuestions],
  );
  const selected = EXAMPLE_QUESTIONS.find((question) => question.id === selectedId) ?? null;
  const closeWhy = useCallback(() => setSelectedId(null), []);
  const draw = () => navigate('/try/draw');
  const answer = (questionId: string) => navigate(`/try/ticket?q=${encodeURIComponent(questionId)}`);
  const toggle = (value: SheetFilter) => setFilter((current) => (current === value ? 'all' : value));

  const meta = [KIND_LABELS[EXAMPLE_EXAM.kind], layoutPhrase(counts.total, EXAMPLE_EXAM.layout), lecturesPhrase(EXAMPLE_LECTURES.length)].join(' · ');
  const answerable = answerableQuestions().length;

  const summary = (
    <>
      <div className="ex-summary">
        <div className="ex-pairs" data-compact={frame.side ? undefined : ''} data-count={counts.none > 0 ? 2 : 1}>
          {counts.none > 0 ? (
            <div className="ex-pair ex-gap">
              <button
                type="button"
                className="ex-big ex-gap-n"
                aria-pressed={filter === 'cov:none'}
                aria-label={noneFigureName(counts.none)}
                onClick={() => toggle('cov:none')}
              >
                {counts.none}
              </button>
              <p className="ex-lbl" aria-hidden="true">
                {noneLabel(counts.none)}
              </p>
            </div>
          ) : null}
          <div className="ex-pair ex-share">
            <p className="ex-big ex-figs">
              <span className="ex-figs-now">{questionShareText(counts)}</span>
            </p>
            <p className="ex-lbl">вопросов есть в лекциях</p>
            <p className="ex-sub">{glue(`${counts.full} из ${counts.total} · частично — ${counts.partial}`)}</p>
          </div>
        </div>
        <p className="ex-fine">Билет — один вопрос, поэтому доля билетов та же.</p>
        <p className="ex-caveat">{glue(caveatSentence(shares, counts.total))}</p>
      </div>
      <div className="ex-blk">
        <p className="ex-stmt">Ответы примера не уходят на сервер: их помнит только эта вкладка.</p>
        <p className="ex-fine">
          {glue(`В своём экзамене вопрос подтверждается, когда ответ на него засчитан дважды, в разные дни. Тянуть билет можно из ${answerable} ${pluralRu(answerable, ['вопроса', 'вопросов', 'вопросов'])} примера, которые есть в лекциях.`)}
        </p>
      </div>
    </>
  );

  const whyPanel = (variant: 'column' | 'sheet') =>
    selected ? (
      <ExampleWhy
        key={selected.id}
        question={selected}
        variant={variant}
        frameBox={frame.box}
        headingId={`${WHY_ID}-title`}
        focusHeading={onSheet}
        onClose={closeWhy}
        onAnswer={answer}
      />
    ) : null;

  // While «почему» or a line offers «Ответить на этот вопрос» beside the sheet, that is the one filled
  // pill and «Тянуть билет» steps down to the white one (the real sheet's rule, ExamDetail).
  const whyAnswers = frame.side && selected !== null && selected.coverage !== 'none';
  const drawSteps = whyAnswers || (onSheet && sheetPage.primaryInColumn);
  const drawButton = (
    <button type="button" className={drawSteps ? 'ex-secondary' : 'sf-primary'} onClick={draw}>
      Тянуть билет
    </button>
  );

  const viewTabs = (
    <div className="ex-views" role="tablist" aria-label="Вид листа примера">
      {(['sheet', 'questions'] as const).map((item) => (
        <button
          key={item}
          type="button"
          role="tab"
          id={`tx-view-${item}`}
          aria-selected={view === item}
          aria-controls="tx-view-panel"
          tabIndex={view === item ? 0 : -1}
          onClick={() => chooseView(item)}
          onMouseEnter={item === 'sheet' ? () => void loadSheetFont() : undefined}
          onFocus={item === 'sheet' ? () => void loadSheetFont() : undefined}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const next = item === 'sheet' ? 'questions' : 'sheet';
            chooseView(next);
            window.setTimeout(() => document.getElementById(`tx-view-${next}`)?.focus(), 0);
          }}
        >
          {item === 'sheet' ? 'Шпаргалка' : 'Вопросы'}
        </button>
      ))}
    </div>
  );

  // Yesterday's answers of the example, said plainly above the paper (sheet spec 4.3); the guest who
  // answered or peeked can start the example again (a rehearsal must not use up the show).
  const touched = sheetData.events.some((event) => event.kind === 'sheet_peek' || (event.session_id !== null && !isSeededSession(event.session_id)));
  const sheetCaption = (
    <p className="tx-sheet-cap">
      {glue('Для примера считаем, что вчера в это же время вы ответили на вопросы 1, 5 и 9: что вы назвали — стёрто наполовину, что не назвали — подчёркнуто волной. ')}
      <Link className="sf-ref" to={`/try/ticket?q=${EXAMPLE_ANSWER_QUESTION}`}>
        Ответьте на вопрос 5
      </Link>
      {glue(' — что назовёте снова, сотрётся совсем. Ответ в примере проверяется по ключевым словам.')}
      {touched ? (
        <>
          {' '}
          <button
            type="button"
            className="sf-link tx-restart"
            data-muted=""
            onClick={() => {
              sheetData.restart();
              // The button goes with the guest's answers: the keyboard goes to «Ответьте на вопрос 5».
              window.setTimeout(() => document.querySelector<HTMLElement>('.tx-sheet-cap a')?.focus(), 0);
            }}
          >
            Начать пример заново
          </button>
        </>
      ) : null}
    </p>
  );
  const sheetColumn = selected ? whyPanel('column') : sheetPage.column;

  return (
    <>
      <TryBar />
      <div className="sf-page tx-page" ref={frame.ref} data-frame={frame.size} data-view={view}>
        {onSheet ? sheetPage.status : null}
        <header className="ex-head">
          <div style={{ minWidth: 0 }}>
            <p className="tx-flag">Пример экзамена</p>
            <h1 className="ex-h1">{EXAMPLE_EXAM.title}</h1>
            <p className="ex-meta">{glue(meta)}</p>
          </div>
          {frame.side ? <div className="ex-draw">{drawButton}</div> : null}
        </header>

        {/* The note is about the list checked in advance; the sheet's own caption says what is set up there. */}
        {onSheet ? null : (
          <div className="ex-notes">
            <p className="ex-note tx-note">{EXAMPLE_NOTE}</p>
          </div>
        )}

        {!frame.side ? <div className="ex-viewbar ex-viewbar-top">{viewTabs}</div> : null}

        {!frame.side ? (
          <section className="ex-col" aria-label={onSheet ? 'Шпаргалка: сколько осталось' : 'Сводка'}>
            {onSheet ? sheetPage.top : summary}
          </section>
        ) : null}

        <div className="ex-body">
          <div style={{ minWidth: 0 }}>
            {frame.side ? <div className="ex-viewbar">{viewTabs}</div> : null}
            <div id="tx-view-panel" role="tabpanel" aria-labelledby={`tx-view-${view}`}>
              {onSheet ? (
                <>
                  {sheetCaption}
                  {sheetPage.paper}
                </>
              ) : (
                <>
                  <ul className="ex-filter" aria-label="Показать вопросы">
                    <li>
                      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                        <span className="ex-filter-word">Все</span> <span className="ex-count">{counts.total}</span>
                      </button>
                    </li>
                    {FILTERS.map((item) => {
                      const kind = COVERAGE_MARK[item.coverage];
                      const size = kind ? COVERAGE_MARK_SIZE[kind] : null;
                      const active = filter === item.value;
                      return (
                        <li key={item.value}>
                          <button type="button" data-cov={item.coverage} aria-pressed={active} onClick={() => toggle(item.value)}>
                            {kind && size ? (
                              <span className="ex-filter-mark" aria-hidden="true">
                                <Mark
                                  kind={kind}
                                  seed={301 + item.value.length}
                                  width={Math.round(size.width * PILL_MARK_SCALE)}
                                  height={Math.round(size.height * PILL_MARK_SCALE)}
                                  weight={size.weight}
                                />
                              </span>
                            ) : null}
                            <span className="ex-filter-word">{item.word}</span> <span className="ex-count">{counts[item.coverage as 'full' | 'partial' | 'none']}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="tx-sheet-hint">Нажмите на вопрос, чтобы увидеть, где в лекциях ответ на него.</p>
                  <ExamSheet
                    examId={EXAMPLE_EXAM.id}
                    title={EXAMPLE_EXAM.sheetTitle}
                    rows={rows}
                    sectionTitles={[]}
                    selectedId={selectedId}
                    rateMode={false}
                    frame={frame.size}
                    whyId={WHY_ID}
                    onOpen={(id) => setSelectedId((current) => (current === id ? null : id))}
                    onRate={() => undefined}
                    onRateDone={() => undefined}
                    ratingPending={new Set()}
                    ratingErrors={{}}
                    peak={null}
                    dim={false}
                    emptyText={rows.length === 0 ? 'В этом фильтре вопросов нет.' : null}
                  />
                </>
              )}
            </div>
          </div>
          {frame.side ? (
            <aside className="ex-col" aria-label={onSheet ? 'Колонка шпаргалки' : 'Что это значит для билетов'} id={selected ? WHY_ID : undefined}>
              {onSheet ? sheetColumn : selected ? whyPanel('column') : summary}
            </aside>
          ) : null}
        </div>

        {!frame.side && onSheet && sheetPage.after ? <section className="ex-col ex-col-after">{sheetPage.after}</section> : null}
        {!frame.side && onSheet ? sheetPage.overlay : null}
        {!frame.side && selected ? <div id={WHY_ID}>{whyPanel('sheet')}</div> : null}

        <ExampleLectures />

        {!frame.side ? <div className="ex-cta">{drawButton}</div> : null}
      </div>
    </>
  );
}

/** The three lectures as they were «uploaded»: every quote of the sheet can be found in them. */
function ExampleLectures() {
  return (
    <section className="tx-lectures" aria-labelledby="tx-lectures-h">
      <h2 id="tx-lectures-h" className="tx-h2">
        Лекции примера
      </h2>
      <p className="tx-sub">Все цитаты из лекций взяты из этих текстов слово в слово.</p>
      <div className="tx-lecture-list">
        {EXAMPLE_LECTURES.map((lecture) => (
          <details key={lecture.key} className="tx-lecture">
            <summary>
              <span className="tx-lecture-t">{lecture.title}</span>
              <span className="tx-lecture-m">{`${lecture.fragments.length}${NBSP}${pluralRu(lecture.fragments.length, ['фрагмент', 'фрагмента', 'фрагментов'])}`}</span>
            </summary>
            <ol className="tx-frags">
              {lecture.fragments.map((fragment, index) => {
                const parts = splitFragmentHeading(fragment.text);
                return (
                  <li key={fragment.id} className="tx-frag">
                    <p className="tx-frag-cap">{`фрагмент${NBSP}${index + 1}`}</p>
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
