import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useFrame } from '../components/exams/useFrame';
import { Mark, seedFrom } from '../components/marks';
import KnowledgeCanvas, { mapLabel, sheetHeight, type LitState } from '../components/knowledge/KnowledgeCanvas';
import KnowledgeLegend from '../components/knowledge/KnowledgeLegend';
import KnowledgeList from '../components/knowledge/KnowledgeList';
import { KnowledgePanel, MapGuide } from '../components/knowledge/KnowledgePanel';
import { count, examLine, examShort, CONCEPTS, LECTURES, NBSP, SHARED } from '../components/knowledge/copy';
import { cardsAcross, layoutMap } from '../components/knowledge/layout';
import {
  buildKnowledgeBase,
  buildMapView,
  defaultExamId,
  examsWithLectures,
  highlightKey,
  highlightNodes,
  neighbourhood,
  searchNodes,
  subjectsOf,
  MAX_WEAK_SINGLE,
  type Highlight,
  type MapView,
  type NodeId,
} from '../components/knowledge/model';
import { useKnowledgeData } from '../components/knowledge/useKnowledgeData';
import SectionCrumb from '../components/SectionCrumb';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { isPhone, usePhone } from '../lib/usePhone';
import { ty } from '../components/landing/typo';
import '../styles/paper.css';
import '../components/knowledge/knowledge.css';

/**
 * What «Понятия» shows besides «все» (LIB-24): the concepts shared by lectures, and next to them the
 * concepts of one lecture with an open mistake (buildMapView adds those). The words name both, so
 * «общие 0» never stands over a map that shows five concepts.
 */
export function conceptsShown(view: Pick<MapView, 'counts' | 'conceptByKey'>): { shared: number; weak: number } {
  let weak = 0;
  for (const concept of view.conceptByKey.values()) if (!concept.shared && concept.weak) weak += 1;
  return { shared: view.counts.shared, weak: Math.min(weak, MAX_WEAK_SINGLE) };
}

/** The first choice of «Понятия»: «общие», «с ошибками» or «общие и с ошибками». */
export function sharedChoiceLabel(shown: { shared: number; weak: number }): string {
  if (shown.weak === 0) return 'общие';
  return shown.shared === 0 ? 'с ошибками' : 'общие и с ошибками';
}

/** The line over the list in that choice. */
export function sharedChoiceLine(shown: { shared: number; weak: number }): string {
  if (shown.shared === 0 && shown.weak === 0) return 'Общих понятий нет.';
  if (shown.shared === 0) return 'Общих понятий нет — показаны понятия с открытыми ошибками.';
  if (shown.weak === 0) return 'Показаны общие понятия.';
  return 'Показаны общие понятия и понятия с открытыми ошибками.';
}

/**
 * «Карта знаний»: the student's lectures as index cards in rows, in their order, and between the rows
 * the concepts their glossaries share, for one exam at a time (the nearest by default) or for all
 * lectures (grouped by exam, with a subject filter). The exam's questions sit on the cards of the
 * lectures they were found in, with the exam sheet's readiness marks; open mistakes and due cards are
 * noted on the cards. Hover or focus lights a node's neighbourhood, a click opens it on a sheet beside
 * the map. A list says the same in words (the phone's first view and the screen reader's). Read-only.
 *
 * On a phone (10_Project/Phone_Declutter_2026-10-08) the meta is one line, the exam sheet is reached from
 * «Экзамены» (no «Лист экзамена» here), the exam, «Карта · Список» and the search share one row (the search
 * is a button that opens its field), and the legend folds under «Обозначения». «A phone» is the window, as the
 * stylesheets say it (lib/usePhone: up to 639 px); the page's own width (useFrame) decides only what is about the
 * room the page has — the panel beside the map or over it.
 */

type Mode = 'map' | 'list';

/** True once `active` has lasted 300 ms (spec 4.6: the first 300 ms of loading show nothing). */
function useShownAfter(active: boolean, ms = 300): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return active && shown;
}

const MAX_UNPLACED = 14;
/** The panel laid on the sheet (computers). */
const OVERLAY_WIDTH = 380;

/** The window's height, kept up to date (the sheet is as tall as the window allows). */
function useWindowHeight(): number {
  const read = () => (typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 900);
  const [height, setHeight] = useState(read);
  useEffect(() => {
    const update = () => setHeight(read());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return height;
}

function nodeInView(view: MapView, node: NodeId): boolean {
  if (node.startsWith('l:')) return view.lectureById.has(node.slice(2));
  return view.conceptByKey.has(node.slice(2));
}

function nodeDrawn(view: MapView, node: NodeId): boolean {
  if (node.startsWith('l:')) return view.lectureById.has(node.slice(2));
  const key = node.slice(2);
  return view.concepts.some((concept) => concept.key === key);
}

export default function KnowledgeMap() {
  useDocumentTitle('Карта знаний');
  const { user } = useAuth();
  const { status, input, missing, retry } = useKnowledgeData(user?.id);
  const frame = useFrame<HTMLDivElement>();
  const [params] = useSearchParams();
  const initialExam = params.get('exam');
  const [examChoice, setExamChoice] = useState<string | null | undefined>(initialExam === 'all' ? null : initialExam || undefined);
  const [subject, setSubject] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState<Mode>(() => (isPhone() ? 'list' : 'map'));
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [hover, setHover] = useState<NodeId | null>(null);
  const [focused, setFocused] = useState<NodeId | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [query, setQuery] = useState('');
  /** A phone's search field, opened by its button. */
  const [searchOpen, setSearchOpen] = useState(false);
  const searchField = useRef<HTMLInputElement | null>(null);
  const searchButton = useRef<HTMLButtonElement | null>(null);
  const searchId = useId();
  const nodeRefs = useRef(new Map<NodeId, HTMLButtonElement>());
  const panelHeading = useRef<HTMLHeadingElement | null>(null);
  const openedFrom = useRef<NodeId | null>(null);
  const hintId = useId();
  const showLoading = useShownAfter(status === 'loading');
  const windowHeight = useWindowHeight();
  const [sheetWidth, setSheetWidth] = useState(0);
  const now = useMemo(() => new Date(), [input]);

  const base = useMemo(() => (input ? buildKnowledgeBase({ ...input, now }) : null), [input, now]);
  const exams = useMemo(() => (base ? examsWithLectures(base) : []), [base]);
  const knownChoice = examChoice !== undefined && (examChoice === null || exams.some((exam) => exam.id === examChoice));
  const examId = base ? (knownChoice ? (examChoice as string | null) : defaultExamId(base)) : null;
  const subjects = useMemo(() => (base ? subjectsOf(base) : []), [base]);
  const subjectFilter = examId === null && subjects.length > 1 ? subject : null;
  const view = useMemo(() => (base ? buildMapView(base, { examId, subject: subjectFilter, showAll }) : null), [base, examId, subjectFilter, showAll]);
  const side = frame.side;
  // A phone by the window (a 640–655 px window with a scrollbar has a page under 640 px: it keeps the computer's map).
  const phone = usePhone();
  // On a computer the sheet is as tall as the window allows and the map is laid out for its shape.
  // On a phone the cards stand one under another at full size and the sheet is as tall as the map:
  // the page scrolls through it with one finger (no pinching needed to read it).
  const maxSheet = phone ? 100_000 : Math.min(760, Math.max(440, windowHeight - 300));
  const aspect = phone ? 0.5 : sheetWidth > 0 ? Math.round((sheetWidth / maxSheet) * 10) / 10 : 2.2;
  const maxPerRow = phone && sheetWidth > 0 ? cardsAcross(sheetWidth) : undefined;
  const layout = useMemo(() => (view && mode === 'map' ? layoutMap(view, { aspect, maxPerRow }) : null), [view, mode, aspect, maxPerRow]);

  // A choice that is not on this map any more (another exam, «только общие») closes.
  useEffect(() => {
    if (!view) return;
    setSelected((current) => (current && !nodeInView(view, current) ? null : current));
    setHover(null);
    setFocused(null);
  }, [view]);

  const registerNode = useCallback((node: NodeId, element: HTMLButtonElement | null) => {
    if (element) nodeRefs.current.set(node, element);
    else nodeRefs.current.delete(node);
  }, []);

  const select = useCallback((node: NodeId) => {
    openedFrom.current = node;
    setSelected(node);
    setHover(null);
  }, []);

  // The panel takes the focus when it opens, so the keyboard continues there; Esc brings it back.
  useEffect(() => {
    if (!selected) return;
    const heading = panelHeading.current;
    if (heading && document.activeElement !== heading) heading.focus({ preventScroll: side });
  }, [selected, side]);

  const close = useCallback(() => {
    const from = openedFrom.current;
    setSelected(null);
    openedFrom.current = null;
    window.setTimeout(() => {
      const target = from ? nodeRefs.current.get(from) ?? nodeRefs.current.get(`list:${from}`) : null;
      target?.focus({ preventScroll: true });
    }, 0);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select')) return;
      event.preventDefault();
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, close]);

  // A bottom sheet keeps the page under it still.
  const sheetOpen = Boolean(selected) && !side;
  useEffect(() => {
    if (!sheetOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sheetOpen]);

  const searchHits = useMemo(() => (view && query.trim() ? searchNodes(view, query) : null), [view, query]);
  const lit = useMemo<LitState | null>(() => {
    if (!view) return null;
    const active = [hover, focused, selected].find((node): node is NodeId => Boolean(node && nodeDrawn(view, node)));
    if (active) {
      const near = neighbourhood(view, active);
      return { nodes: near.nodes, far: near.far, edges: near.edges, farEdges: near.farEdges };
    }
    if (searchHits && searchHits.size > 0) return { nodes: searchHits, far: new Set(), edges: new Set(), farEdges: new Set() };
    if (highlight) return { nodes: highlightNodes(view, highlight), far: new Set(), edges: new Set(), farEdges: new Set() };
    return null;
  }, [view, hover, focused, selected, searchHits, highlight]);

  const toggleHighlight = useCallback((next: Highlight) => {
    setHighlight((current) => (highlightKey(current) === highlightKey(next) ? null : next));
  }, []);

  const chooseExam = (id: string | null) => {
    setExamChoice(id);
    setSelected(null);
    setHighlight(null);
  };

  // A phone's search: the button opens the field and gives it the focus in the same tap (so the keyboard comes up);
  // pressed again, or Esc in an empty field, it closes the field, clears the search and takes the focus back.
  const openSearch = () => {
    flushSync(() => setSearchOpen(true));
    searchField.current?.focus();
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    window.setTimeout(() => searchButton.current?.focus(), 0);
  };
  // Words already typed keep their field in sight (a window that turned from a computer's into a phone's).
  const searchShown = searchOpen || query !== '';

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      setQuery('');
    } else if (event.key === 'Escape' && phone && searchShown) {
      event.preventDefault();
      closeSearch();
    } else if (event.key === 'Enter' && searchHits && searchHits.size > 0) {
      event.preventDefault();
      select([...searchHits][0]);
    }
  };

  // ------------------------------------------------------------------ states
  if (status === 'loading' && !input) {
    return (
      <div className="sf-page" ref={frame.ref} data-frame={frame.size}>
        <div className="sf-head" role="status" aria-label="Загружаем карту знаний">
          {showLoading ? <p className="text-[17px] leading-[26px] text-[var(--sf-muted)]">Загружаем карту…</p> : null}
        </div>
      </div>
    );
  }

  if (status === 'error' || !base || !view) {
    return (
      <div className="sf-page" ref={frame.ref} data-frame={frame.size}>
        <div className="km-state">
          <div className="km-state-card">
            <h1 className="km-state-h">Не удалось загрузить карту</h1>
            <p className="km-state-text">Лекции на месте — повторите через минуту.</p>
            <button type="button" className="sf-secondary km-state-act" onClick={retry}>
              Повторить
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (base.lectures.length === 0) {
    return (
      <div className="sf-page" ref={frame.ref} data-frame={frame.size}>
        <div className="sc-up">
          <SectionCrumb to="/analytics" label="Прогресс" />
        </div>
        <div className="km-state">
          <div className="km-state-card" data-center="">
            <div className="km-state-art" aria-hidden="true">
              <i />
              <i />
              <i />
              <b />
              <b />
            </div>
            <h1 className="km-state-h">Здесь будет карта ваших лекций</h1>
            <p className="km-state-text">
              Загрузите лекции — Meldy найдёт понятия, которые их связывают, и покажет, в какой лекции какие вопросы экзамена.
            </p>
            <Link className="sf-primary km-state-act" to="/analyze">
              Разобрать лекцию
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ the map
  const exam = view.exam;
  // A phone: one line, «21 октября, через 13 дней · 3 лекции» (the exam's name is in the choice below, the shared
  // concepts in the concepts' own line, KnowledgeList).
  const lede = phone
    ? [exam ? examShort(exam, now) : '', count(view.lectures.length, LECTURES), !exam && exams.length ? count(exams.length, ['экзамен', 'экзамена', 'экзаменов']) : '']
        .filter(Boolean)
        .join(' · ')
    : exam
    ? [examLine(exam, now), count(view.lectures.length, LECTURES), view.counts.shared ? count(view.counts.shared, SHARED) : 'общих понятий нет'].join(' · ')
    : [
        count(view.lectures.length, LECTURES),
        exams.length ? count(exams.length, ['экзамен', 'экзамена', 'экзаменов']) : '',
        view.counts.shared ? count(view.counts.shared, SHARED) : '',
      ]
        .filter(Boolean)
        .join(' · ');

  // What could not be read, in the accusative: «Не удалось загрузить экзамены и историю ответов…».
  const missingParts = [
    missing.includes('exams') ? 'экзамены' : '',
    missing.includes('answers') ? 'историю ответов' : '',
    missing.includes('mistakes') ? 'дневник ошибок' : '',
    missing.includes('cards') ? 'карточки к повторению' : '',
  ].filter(Boolean);
  const missingList =
    missingParts.length > 1 ? `${missingParts.slice(0, -1).join(', ')} и ${missingParts[missingParts.length - 1]}` : missingParts[0] ?? '';

  const unplaced = view.unplaced;
  const footer =
    exam && unplaced.length > 0 ? (
      <>
        <span className="km-foot-note">
          <Mark kind="dash" seed={seedFrom('km-none', exam.id)} width={22} height={9} weight={3} />
          <span>
            {`Нет ни в одной лекции: ${unplaced.length === 1 ? 'вопрос' : 'вопросы'} ${unplaced
              .slice(0, MAX_UNPLACED)
              .map((question) => question.number)
              .join(', ')}${unplaced.length > MAX_UNPLACED ? ` и ещё${NBSP}${unplaced.length - MAX_UNPLACED}` : ''}`}
          </span>
        </span>
        <Link className="sf-link" to={`/exams/${exam.id}?filter=cov:none`}>
          Показать на листе
        </Link>
      </>
    ) : null;

  const showToggle = view.counts.concepts > 0 && (view.counts.shared < view.counts.concepts || showAll);
  const shown = conceptsShown(view);
  // On the sheet's top left on computers; on a phone the sheet is too narrow, so it stands above it.
  const conceptsToggle = showToggle ? (
    <div className={phone ? 'km-show km-show-desk' : 'km-show'}>
      <span className="km-show-label">Понятия:</span>
      <ul className="sf-tabs" aria-label="Какие понятия показать">
        <li>
          <button type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>
            {sharedChoiceLabel(shown)}
            <span className="sf-tabs-n">{shown.shared + shown.weak}</span>
          </button>
        </li>
        <li>
          <button type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}>
            все<span className="sf-tabs-n">{view.counts.concepts}</span>
          </button>
        </li>
      </ul>
    </div>
  ) : null;

  // The list's line about the concepts; a phone has it at the head of the concepts, after the lectures (KnowledgeList).
  const conceptsLine = (
    <p className="km-quiet" style={{ marginBottom: 6 }}>
      {showAll ? `Показаны все понятия: ${count(view.counts.concepts, CONCEPTS)}. ` : `${ty(sharedChoiceLine(shown))} `}
      <button type="button" className="sf-link" onClick={() => setShowAll((value) => !value)}>
        {showAll ? `Только ${sharedChoiceLabel(shown)}` : `Все понятия (${view.counts.concepts})`}
      </button>
    </p>
  );

  const noHits = Boolean(query.trim()) && searchHits !== null && searchHits.size === 0 && mode === 'map';
  const panel = selected ? (
    <KnowledgePanel ref={panelHeading} view={view} node={selected} now={now} sheet={!side} onSelect={select} onClose={close} />
  ) : null;

  return (
    <div className="sf-page" ref={frame.ref} data-frame={frame.size}>
      <header className="sf-head km-head">
        <div className="min-w-0">
          <SectionCrumb to="/analytics" label="Прогресс" />
          <h1 className="sf-h1">Карта знаний</h1>
          {/* «через 13 дней» and «21 октября» stay whole at the end of a line. */}
          {lede ? <p className="sf-lede">{ty(lede).replace(/через /g, 'через\u00a0').replace(/(\d) (?=[а-яё])/gi, '$1\u00a0')}</p> : null}
        </div>
        {/* A phone reaches the exam sheet from «Экзамены» (and «Показать на листе» under the map). */}
        {exam && !phone ? (
          <Link className="sf-secondary" to={`/exams/${exam.id}`}>
            Лист экзамена
          </Link>
        ) : null}
      </header>

      {missingList ? (
        <p className="km-note">
          {`Не удалось загрузить ${missingList}; карта показана без этих данных.`}
          <button type="button" className="sf-link" onClick={retry}>
            Повторить
          </button>
        </p>
      ) : null}

      {phone ? (
        // One row: the exam (a choice that fits any name), «Карта · Список», the search button.
        <>
          <div className="km-bar km-bar-one">
            {exams.length > 0 ? (
              <select className="km-pick" aria-label="Экзамен" value={examId ?? ''} onChange={(event) => chooseExam(event.target.value || null)}>
                {exams.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
                <option value="">Все лекции</option>
              </select>
            ) : (
              <span className="km-pick-none" />
            )}
            <ul className="sf-tabs km-view" aria-label="Вид">
              <li>
                <button type="button" aria-pressed={mode === 'map'} onClick={() => setMode('map')}>
                  Карта
                </button>
              </li>
              <li>
                <button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
                  Список
                </button>
              </li>
            </ul>
            <button
              ref={searchButton}
              type="button"
              className="km-find"
              aria-label="Найти лекцию или понятие"
              aria-expanded={searchShown}
              aria-controls={searchShown ? searchId : undefined}
              onClick={() => (searchShown ? closeSearch() : openSearch())}
            >
              <Search aria-hidden="true" strokeWidth={1.9} />
            </button>
          </div>
          {searchShown ? (
            <input
              ref={searchField}
              id={searchId}
              className="sf-input km-search km-search-open"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Найти"
              aria-label="Найти лекцию или понятие"
            />
          ) : null}
        </>
      ) : (
        <div className="km-bar">
          {exams.length > 0 ? (
            <div className="km-scroll">
              <ul className="sf-tabs" aria-label="Экзамен">
                {exams.map((item) => (
                  <li key={item.id}>
                    <button type="button" aria-pressed={examId === item.id} onClick={() => chooseExam(item.id)}>
                      {item.title}
                      <span className="sf-tabs-n">{item.lectureIds.length}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" aria-pressed={examId === null} onClick={() => chooseExam(null)}>
                    Все лекции<span className="sf-tabs-n">{base.lectures.length}</span>
                  </button>
                </li>
              </ul>
            </div>
          ) : (
            <span />
          )}
          <div className="km-tools">
            <input
              className="sf-input km-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Найти лекцию или понятие"
              aria-label="Найти лекцию или понятие"
            />
            <ul className="sf-tabs" aria-label="Вид">
              <li>
                <button type="button" aria-pressed={mode === 'map'} onClick={() => setMode('map')}>
                  Карта
                </button>
              </li>
              <li>
                <button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
                  Списком
                </button>
              </li>
            </ul>
          </div>
        </div>
      )}

      {examId === null && subjects.length > 1 ? (
        <div className="km-subjects km-scroll">
          <span className="km-sub-label">Предмет:</span>
          <ul className="sf-tabs" aria-label="Предмет">
            <li>
              <button type="button" aria-pressed={subject === null} onClick={() => setSubject(null)}>
                Все
              </button>
            </li>
            {subjects.map((item) => (
              <li key={item.subject || '-'}>
                <button type="button" aria-pressed={subject === item.subject} onClick={() => setSubject(item.subject)}>
                  {item.subject || 'Без предмета'}
                  <span className="sf-tabs-n">{item.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {phone ? (
        // The legend folds under «Обозначения»: its row of pills ran past the screen's edge.
        <div className="km-row2">
          <KnowledgeLegend view={view} highlight={highlight} onToggle={toggleHighlight} folded interactive={mode === 'map'} />
        </div>
      ) : (
        <div className="km-row2 km-scroll">
          <KnowledgeLegend view={view} highlight={highlight} onToggle={toggleHighlight} />
        </div>
      )}
      {noHits ? (
        <p className="km-quiet" role="status" style={{ marginBottom: 10 }}>
          Ничего не найдено. Попробуйте другое слово.
        </p>
      ) : null}

      {mode === 'map' && layout ? (
        <>
          {phone ? conceptsToggle : null}
          <KnowledgeCanvas
            view={view}
            layout={layout}
            selected={selected}
            lit={lit}
            readinessFocus={highlight?.kind === 'readiness' ? highlight.value : null}
            height={sheetHeight(layout, sheetWidth, maxSheet, Boolean(footer))}
            label={mapLabel(view)}
            hintId={hintId}
            footer={footer}
            topLeft={phone ? null : conceptsToggle}
            overlay={side ? panel : null}
            reserveRight={side && panel ? OVERLAY_WIDTH + 16 : 0}
            onWidth={setSheetWidth}
            onBackground={selected ? close : undefined}
            onSelect={select}
            onHover={setHover}
            onFocusNode={setFocused}
            registerNode={registerNode}
          />
          <p className="km-hint" id={hintId}>
            {phone
              ? // One line on a phone: the page scrolls with one finger and the zoom buttons are in sight.
                'Нажмите на карточку — откроются подробности.'
              : 'Карту можно сдвинуть мышью или пальцем. Масштаб — Ctrl и колесо мыши, щипок или кнопки «+» и «−». Tab переходит по карточкам и понятиям, Enter открывает подробности, Esc закрывает их.'}
          </p>
          <MapGuide view={view} onSelect={select} />
        </>
      ) : (
        <div className="km-body" data-side={side && panel ? '' : undefined}>
          <div className="km-main">
            {showToggle && !phone ? conceptsLine : null}
            <KnowledgeList
              view={view}
              selected={selected}
              query={query}
              onSelect={select}
              registerNode={registerNode}
              conceptsNote={showToggle && phone ? conceptsLine : undefined}
            />
          </div>
          {side && panel ? <aside className="km-side">{panel}</aside> : null}
        </div>
      )}

      {!side && panel ? (
        <>
          <div className="km-scrim" aria-hidden="true" onClick={close} />
          {panel}
        </>
      ) : null}
    </div>
  );
}
