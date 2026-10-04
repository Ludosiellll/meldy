import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useFrame } from '../components/exams/useFrame';
import { Mark, seedFrom } from '../components/marks';
import KnowledgeCanvas, { mapLabel, sheetHeight, type LitState } from '../components/knowledge/KnowledgeCanvas';
import KnowledgeLegend from '../components/knowledge/KnowledgeLegend';
import KnowledgeList from '../components/knowledge/KnowledgeList';
import { KnowledgePanel, MapGuide } from '../components/knowledge/KnowledgePanel';
import { count, examLine, CONCEPTS, LECTURES, NBSP, SHARED } from '../components/knowledge/copy';
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
  type Highlight,
  type MapView,
  type NodeId,
} from '../components/knowledge/model';
import { useKnowledgeData } from '../components/knowledge/useKnowledgeData';
import '../styles/paper.css';
import '../components/knowledge/knowledge.css';

/**
 * «Карта знаний»: the student's lectures as index cards in rows, in their order, and between the rows
 * the concepts their glossaries share, for one exam at a time (the nearest by default) or for all
 * lectures (grouped by exam, with a subject filter). The exam's questions sit on the cards of the
 * lectures they were found in, with the exam sheet's readiness marks; open mistakes and due cards are
 * noted on the cards. Hover or focus lights a node's neighbourhood, a click opens it on a sheet beside
 * the map. A list says the same in words (the phone's first view and the screen reader's). Read-only.
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
  const { user } = useAuth();
  const { status, input, missing, retry } = useKnowledgeData(user?.id);
  const frame = useFrame<HTMLDivElement>();
  const [params] = useSearchParams();
  const initialExam = params.get('exam');
  const [examChoice, setExamChoice] = useState<string | null | undefined>(initialExam === 'all' ? null : initialExam || undefined);
  const [subject, setSubject] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState<Mode>(() => (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 640 ? 'list' : 'map'));
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [hover, setHover] = useState<NodeId | null>(null);
  const [focused, setFocused] = useState<NodeId | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [query, setQuery] = useState('');
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
  const phone = frame.size === 's';
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

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      setQuery('');
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
              Добавить лекцию
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ the map
  const exam = view.exam;
  const lede = exam
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
  // On the sheet's top left on computers; on a phone the sheet is too narrow, so it stands above it.
  const conceptsToggle = showToggle ? (
    <div className={phone ? 'km-show km-show-desk' : 'km-show'}>
      <span className="km-show-label">Понятия:</span>
      <ul className="sf-tabs" aria-label="Какие понятия показать">
        <li>
          <button type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>
            общие<span className="sf-tabs-n">{view.counts.shared}</span>
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

  const noHits = Boolean(query.trim()) && searchHits !== null && searchHits.size === 0 && mode === 'map';
  const panel = selected ? (
    <KnowledgePanel ref={panelHeading} view={view} node={selected} now={now} sheet={!side} onSelect={select} onClose={close} />
  ) : null;

  return (
    <div className="sf-page" ref={frame.ref} data-frame={frame.size}>
      <header className="sf-head km-head">
        <div className="min-w-0">
          <h1 className="sf-h1">Карта знаний</h1>
          {lede ? <p className="sf-lede">{lede}</p> : null}
        </div>
        {exam ? (
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

      <div className="km-row2 km-scroll">
        <KnowledgeLegend view={view} highlight={highlight} onToggle={toggleHighlight} />
      </div>
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
              ? 'Карта листается вместе со страницей. Масштаб — двумя пальцами или кнопками «+» и «−». Нажмите на карточку или понятие, чтобы открыть подробности.'
              : 'Карту можно сдвинуть мышью или пальцем. Масштаб — Ctrl и колесо мыши, щипок или кнопки «+» и «−». Tab переходит по карточкам и понятиям, Enter открывает подробности, Esc закрывает их.'}
          </p>
          <MapGuide view={view} onSelect={select} />
        </>
      ) : (
        <div className="km-body" data-side={side && panel ? '' : undefined}>
          <div className="km-main">
            {showToggle ? (
              <p className="km-quiet" style={{ marginBottom: 6 }}>
                {showAll ? `Показаны все понятия: ${count(view.counts.concepts, CONCEPTS)}. ` : `Показаны общие понятия. `}
                <button type="button" className="sf-link" onClick={() => setShowAll((value) => !value)}>
                  {showAll ? 'Только общие' : `Все понятия (${view.counts.concepts})`}
                </button>
              </p>
            ) : null}
            <KnowledgeList view={view} selected={selected} query={query} onSelect={select} registerNode={registerNode} />
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
