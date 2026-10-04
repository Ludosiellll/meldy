import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Readiness } from '../../lib/learning/readiness';
import { quad, sample, seedFrom, tapered } from '../marks';
import { cardNote, cardNoteWords, count, inLectures, questionWords, CONCEPTS, LECTURES, NBSP, SHARED } from './copy';
import { QUESTIONS_LABEL, QUESTIONS_LABEL_WIDTH, WORD, type Box, type CardBox, type EdgeGeo, type MapLayout, type WordBox } from './layout';
import { conceptNode, lectureNode, neighbourhood, type MapConcept, type MapLecture, type MapView, type NodeId, type QuestionView } from './model';
import { NumberMark, WaveUnder } from './NumberMark';

export interface LitState {
  /** Fully lit: the focused node and its neighbours (or the matches of a search or a legend filter). */
  nodes: Set<NodeId>;
  /** Half lit: where a lecture's shared concepts lead. */
  far: Set<NodeId>;
  edges: Set<string>;
  farEdges: Set<string>;
}

export interface ViewState {
  scale: number;
  x: number;
  y: number;
}

/** Room around the map inside the sheet: the zoom controls sit at the top, the footnote at the bottom. */
const FIT_PAD = { top: 56, side: 20, bottom: 20, footer: 44 };
export const MAX_SCALE = 2.6;
const MIN_SCALE = 0.4;
const DRAG_START = 5;

/** The whole map in the sheet, never larger than 110 %. jsdom (no layout) gets 100 % at the origin. */
export function fitView(layout: Pick<MapLayout, 'width' | 'height'>, width: number, height: number, footer: boolean): ViewState {
  if (width <= 0 || height <= 0 || layout.width <= 0 || layout.height <= 0) return { scale: 1, x: 0, y: 0 };
  const bottom = footer ? FIT_PAD.footer : FIT_PAD.bottom;
  const availableW = Math.max(40, width - 2 * FIT_PAD.side);
  const availableH = Math.max(40, height - FIT_PAD.top - bottom);
  const scale = Math.min(1.1, availableW / layout.width, availableH / layout.height);
  return {
    scale,
    x: (width - layout.width * scale) / 2,
    y: FIT_PAD.top + (availableH - layout.height * scale) / 2,
  };
}

/**
 * Ctrl + wheel and a trackpad pinch (browsers report it as a wheel event with ctrlKey): the zoom
 * follows deltaY smoothly, while a ~100 px mouse-wheel notch is capped at a single ~22 % step.
 */
export function wheelZoomFactor(event: Pick<WheelEvent, 'deltaMode' | 'deltaY'>): number {
  const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 800 : event.deltaY;
  return Math.exp(-Math.max(-20, Math.min(20, pixels)) * 0.01);
}

export function percentText(scale: number): string {
  return `${Math.round(scale * 100)}${NBSP}%`;
}

type NodeState = 'lit' | 'far' | 'dim' | 'rest';

function stateOf(lit: LitState | null, node: NodeId): NodeState {
  if (!lit) return 'rest';
  if (lit.nodes.has(node)) return 'lit';
  if (lit.far.has(node)) return 'far';
  return 'dim';
}

interface NodeHandlers {
  onSelect: (node: NodeId) => void;
  onHover: (node: NodeId | null) => void;
  onFocusNode: (node: NodeId | null, element: HTMLElement) => void;
  onBlurNode: (node: NodeId) => void;
  register: (node: NodeId, element: HTMLButtonElement | null) => void;
}

// ---------------------------------------------------------------------------------------------
// A lecture card

interface CardProps {
  lecture: MapLecture;
  box: CardBox;
  questionById: Map<string, QuestionView>;
  state: NodeState;
  selected: boolean;
  readinessFocus: Readiness | null;
  handlers: NodeHandlers;
}

const MapCard = memo(function MapCard({ lecture, box, questionById, state, selected, readinessFocus, handlers }: CardProps) {
  const node = lectureNode(lecture.id);
  const note = box.hasNote ? cardNote(lecture) : null;
  const shown = box.questions.rows.flat().map((id) => questionById.get(id)).filter((question): question is QuestionView => Boolean(question));
  const words = [
    lecture.questions.length
      ? `${lecture.questions.length === 1 ? 'Вопрос экзамена' : 'Вопросы экзамена'}: ${lecture.questions.map(questionWords).join(', ')}`
      : '',
    cardNoteWords(lecture),
  ]
    .filter(Boolean)
    .join('. ');
  const register = useCallback((element: HTMLButtonElement | null) => handlers.register(node, element), [handlers, node]);
  return (
    <button
      ref={register}
      type="button"
      className="km-card sf-index-card"
      data-node={node}
      data-state={state}
      data-lifted={selected ? '' : undefined}
      aria-pressed={selected}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onClick={() => handlers.onSelect(node)}
      onMouseEnter={() => handlers.onHover(node)}
      onMouseLeave={() => handlers.onHover(null)}
      onFocus={(event) => handlers.onFocusNode(node, event.currentTarget)}
      onBlur={() => handlers.onBlurNode(node)}
    >
      <span className="km-card-n" aria-hidden="true">
        {lecture.number}
      </span>
      <span className="km-card-t" style={{ WebkitLineClamp: box.lines.length }}>
        <span className="km-sr">Лекция {lecture.number}:</span> {lecture.title}
      </span>
      {shown.length > 0 ? (
        <span className="km-card-q" aria-hidden="true">
          {box.questions.rows.map((row, rowIndex) => (
            <span className="km-card-qrow" key={rowIndex}>
              <span className="km-card-ql" style={{ width: QUESTIONS_LABEL_WIDTH }}>
                {rowIndex === 0 ? QUESTIONS_LABEL : ''}
              </span>
              {row.map((id, index) => {
                const question = questionById.get(id);
                if (!question) return null;
                const isLastRow = rowIndex === box.questions.rows.length - 1;
                return (
                  <span key={id} className="km-card-qn" data-off={readinessFocus && question.readiness !== readinessFocus ? '' : undefined}>
                    <NumberMark number={question.number} readiness={question.readiness} seed={seedFrom('km-q', question.examId, question.position)} />
                    {isLastRow && index === row.length - 1 && box.questions.rest > 0 ? (
                      <span className="km-card-more">ещё{NBSP}{box.questions.rest}</span>
                    ) : null}
                  </span>
                );
              })}
            </span>
          ))}
        </span>
      ) : null}
      {note ? (
        <span className="km-card-note" data-quiet={note.quiet ? '' : undefined} aria-hidden="true">
          {note.text}
        </span>
      ) : null}
      {words ? <span className="km-sr">. {words}.</span> : null}
    </button>
  );
});

// ---------------------------------------------------------------------------------------------
// A concept word: a pill; the chosen one is the dark pill, as the current tab is (knowledge.css).

interface WordProps {
  concept: MapConcept;
  box: WordBox;
  state: NodeState;
  selected: boolean;
  handlers: NodeHandlers;
}

const MapWord = memo(function MapWord({ concept, box, state, selected, handlers }: WordProps) {
  const node = conceptNode(concept.key);
  const register = useCallback((element: HTMLButtonElement | null) => handlers.register(node, element), [handlers, node]);
  return (
    <button
      ref={register}
      type="button"
      className="km-word"
      data-node={node}
      data-state={state}
      data-inside={box.inside ? '' : undefined}
      data-hub={concept.lectureIds.length >= 3 ? '' : undefined}
      data-weak={concept.weak ? '' : undefined}
      aria-pressed={selected}
      title={box.text !== concept.label ? concept.label : undefined}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onClick={() => handlers.onSelect(node)}
      onMouseEnter={() => handlers.onHover(node)}
      onMouseLeave={() => handlers.onHover(null)}
      onFocus={(event) => handlers.onFocusNode(node, event.currentTarget)}
      onBlur={() => handlers.onBlurNode(node)}
    >
      <span className="km-sr">Понятие:</span> <span className="km-word-t">{box.text}</span>
      <span className="km-sr">
        , {concept.lectureIds.length > 1 ? inLectures(concept.lectureIds.length) : 'в одной лекции'}
        {concept.weak ? ', есть открытая ошибка' : ''}
      </span>
      {concept.weak ? <WaveUnder width={box.w - 2 * WORD.padX} seed={seedFrom('km-weak', concept.key)} /> : null}
    </button>
  );
});

// ---------------------------------------------------------------------------------------------
// Edges

/** A lit edge: the pencil drawn over the thin grey line (Meldy pointing at the connection). */
const PencilEdge = memo(function PencilEdge({ edge, far }: { edge: EdgeGeo; far: boolean }) {
  const d = useMemo(() => {
    const length = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y);
    const points = sample(quad([edge.from.x, edge.from.y], [edge.control.x, edge.control.y], [edge.to.x, edge.to.y], Math.max(4, Math.round(length / 24))), edge.seed, {
      step: 9,
      amp: 0.55,
    });
    return tapered(points, far ? 1.5 : 2.2, 0.6);
  }, [edge, far]);
  return <path d={d} className={far ? 'km-edge-far' : 'km-edge-lit'} />;
});

// ---------------------------------------------------------------------------------------------
// The canvas

interface CanvasProps {
  view: MapView;
  layout: MapLayout;
  selected: NodeId | null;
  lit: LitState | null;
  readinessFocus: Readiness | null;
  /** Height of the sheet (px). */
  height: number;
  label: string;
  hintId: string;
  footer?: ReactNode;
  /** Controls on the sheet's top left («Понятия: общие · все»). */
  topLeft?: ReactNode;
  /** The detail panel, laid on the sheet's right side (computers). */
  overlay?: ReactNode;
  /** Width the overlay covers: the chosen node is moved out from under it. */
  reserveRight?: number;
  /** The sheet's width as measured (the page lays the map out for its shape). */
  onWidth?: (width: number) => void;
  /** A click on the empty paper (not a drag): the page closes the panel. */
  onBackground?: () => void;
  onSelect: (node: NodeId) => void;
  onHover: (node: NodeId | null) => void;
  onFocusNode: (node: NodeId | null) => void;
  registerNode: (node: NodeId, element: HTMLButtonElement | null) => void;
}

interface Gesture {
  mode: 'idle' | 'press' | 'pan' | 'pinch';
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startDistance: number;
  startScale: number;
  anchorX: number;
  anchorY: number;
}

const IDLE: Gesture = { mode: 'idle', startX: 0, startY: 0, lastX: 0, lastY: 0, startDistance: 0, startScale: 1, anchorX: 0, anchorY: 0 };

export default function KnowledgeCanvas(props: CanvasProps) {
  const { view, layout, selected, lit, readinessFocus } = props;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pinned, setPinned] = useState<ViewState | null>(null);
  const [dragging, setDragging] = useState(false);
  const fit = useMemo(() => fitView(layout, size.w, size.h, Boolean(props.footer)), [layout, size.w, size.h, props.footer]);
  const current = pinned ?? fit;
  const viewRef = useRef<ViewState>(current);
  viewRef.current = current;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture>({ ...IDLE });
  const suppressClick = useRef(false);
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => undefined);
  const onWidthRef = useRef(props.onWidth);
  onWidthRef.current = props.onWidth;
  const wheelCleanup = useRef<(() => void) | null>(null);

  // A new map (another exam, all concepts) starts fitted to the sheet.
  useEffect(() => {
    setPinned(null);
  }, [layout]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => {
      const w = element.clientWidth;
      const h = element.clientHeight;
      setSize((previous) => (previous.w === w && previous.h === h ? previous : { w, h }));
      onWidthRef.current?.(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const minScale = Math.min(MIN_SCALE, fit.scale * 0.8);

  const moveTo = useCallback((next: ViewState) => {
    viewRef.current = next;
    setPinned(next);
  }, []);

  const zoomAt = useCallback(
    (nextScale: number, anchorX: number, anchorY: number) => {
      const now = viewRef.current;
      const bounded = Math.min(MAX_SCALE, Math.max(Math.min(MIN_SCALE, fitRef.current.scale * 0.8), nextScale));
      const ratio = bounded / now.scale;
      moveTo({ scale: bounded, x: anchorX - (anchorX - now.x) * ratio, y: anchorY - (anchorY - now.y) * ratio });
    },
    [moveTo],
  );

  const local = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const zoomFromControl = (factor: number) => {
    const element = viewportRef.current;
    const w = element?.clientWidth ?? 0;
    const h = element?.clientHeight ?? 0;
    zoomAt(viewRef.current.scale * factor, w / 2, h / 2);
  };

  // Ctrl + wheel and a trackpad pinch zoom the map; a plain wheel scrolls the page.
  useLayoutEffect(() => {
    wheelHandler.current = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const point = local(event.clientX, event.clientY);
      zoomAt(viewRef.current.scale * wheelZoomFactor(event), point.x, point.y);
    };
  });

  // React registers wheel listeners as passive, so preventDefault there is ignored: a native non-passive
  // listener keeps the browser from zooming the whole page while the map zooms.
  const attachViewport = useCallback((element: HTMLDivElement | null) => {
    wheelCleanup.current?.();
    wheelCleanup.current = null;
    viewportRef.current = element;
    if (!element) return;
    const listener = (event: WheelEvent) => wheelHandler.current(event);
    element.addEventListener('wheel', listener, { passive: false });
    wheelCleanup.current = () => element.removeEventListener('wheel', listener);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = local(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 1) {
      gesture.current = { ...IDLE, mode: 'press', startX: point.x, startY: point.y, lastX: point.x, lastY: point.y };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const now = viewRef.current;
      gesture.current = {
        ...IDLE,
        mode: 'pinch',
        startDistance: Math.hypot(a.x - b.x, a.y - b.y),
        startScale: now.scale,
        anchorX: (centre.x - now.x) / now.scale,
        anchorY: (centre.y - now.y) / now.scale,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that is already gone cannot be captured.
      }
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = local(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, point);
    const g = gesture.current;
    if (g.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const scale = Math.min(MAX_SCALE, Math.max(minScale, g.startScale * (distance / Math.max(1, g.startDistance))));
      moveTo({ scale, x: centre.x - g.anchorX * scale, y: centre.y - g.anchorY * scale });
      suppressClick.current = true;
      return;
    }
    if (g.mode === 'press' && Math.hypot(point.x - g.startX, point.y - g.startY) > DRAG_START) {
      g.mode = 'pan';
      setDragging(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // see above
      }
    }
    if (g.mode === 'pan') {
      const now = viewRef.current;
      moveTo({ ...now, x: now.x + point.x - g.lastX, y: now.y + point.y - g.lastY });
      g.lastX = point.x;
      g.lastY = point.y;
      suppressClick.current = true;
    }
  };

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = { ...IDLE };
      setDragging(false);
      // A drag that ended over a card must not open it.
      if (suppressClick.current) window.setTimeout(() => (suppressClick.current = false), 0);
    } else if (pointers.current.size === 1) {
      const [rest] = [...pointers.current.values()];
      gesture.current = { ...IDLE, mode: 'pan', startX: rest.x, startY: rest.y, lastX: rest.x, lastY: rest.y };
    }
  };

  // Focusing a node with Tab scrolls the clipped viewport; turn that into a pan of the map.
  const onScroll = () => {
    const element = viewportRef.current;
    if (!element || (element.scrollLeft === 0 && element.scrollTop === 0)) return;
    const { scrollLeft, scrollTop } = element;
    element.scrollLeft = 0;
    element.scrollTop = 0;
    const now = viewRef.current;
    moveTo({ ...now, x: now.x - scrollLeft, y: now.y - scrollTop });
  };

  // A focused node outside the visible part of the sheet is brought into view (the zoom stays).
  const revealNode = useCallback(
    (element: HTMLElement) => {
      const viewport = viewportRef.current;
      if (!viewport || viewport.clientWidth === 0) return;
      const now = viewRef.current;
      const left = now.x + element.offsetLeft * now.scale;
      const top = now.y + element.offsetTop * now.scale;
      const right = left + element.offsetWidth * now.scale;
      const bottom = top + element.offsetHeight * now.scale;
      const margin = 24;
      let dx = 0;
      let dy = 0;
      if (left < margin) dx = margin - left;
      else if (right > viewport.clientWidth - margin) dx = viewport.clientWidth - margin - right;
      if (top < FIT_PAD.top) dy = FIT_PAD.top - top;
      else if (bottom > viewport.clientHeight - margin) dy = viewport.clientHeight - margin - bottom;
      if (dx || dy) moveTo({ ...now, x: now.x + dx, y: now.y + dy });
    },
    [moveTo],
  );

  // When the panel opens, the chosen node and its neighbours are moved out from under it (the zoom
  // stays): the whole neighbourhood when it fits beside the panel, else centred on the chosen node.
  const reserveRight = props.reserveRight ?? 0;
  useEffect(() => {
    if (!selected || reserveRight <= 0) return;
    const viewport = viewportRef.current;
    if (!viewport || viewport.clientWidth === 0) return;
    const boxOf = (node: NodeId): Box | undefined => (node.startsWith('l:') ? layout.cardById.get(node.slice(2)) : layout.wordByKey.get(node.slice(2)));
    const own = boxOf(selected);
    if (!own) return;
    const near = [...neighbourhood(view, selected).nodes].map(boxOf).filter((box): box is Box => Boolean(box));
    const now = viewRef.current;
    const area = { left: 20, right: viewport.clientWidth - reserveRight - 20, top: FIT_PAD.top, bottom: viewport.clientHeight - 20 };
    const screen = (boxes: Box[]) => ({
      left: now.x + Math.min(...boxes.map((box) => box.x)) * now.scale,
      right: now.x + Math.max(...boxes.map((box) => box.x + box.w)) * now.scale,
      top: now.y + Math.min(...boxes.map((box) => box.y)) * now.scale,
      bottom: now.y + Math.max(...boxes.map((box) => box.y + box.h)) * now.scale,
    });
    const shift = (from: number, to: number, low: number, high: number) => {
      if (to - from > high - low) return (low + high) / 2 - (from + to) / 2;
      if (from < low) return low - from;
      if (to > high) return high - to;
      return 0;
    };
    const all = screen(near);
    const mine = screen([own]);
    const fits = all.right - all.left <= area.right - area.left;
    const target = fits ? all : mine;
    const dx = shift(target.left, target.right, area.left, area.right);
    const dy = shift(target.top, target.bottom, area.top, area.bottom);
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moveTo({ ...now, x: now.x + dx, y: now.y + dy });
    // Only when the chosen node changes: panning the map by hand afterwards is the user's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, reserveRight]);

  const { onSelect, onHover, onFocusNode, registerNode } = props;
  const handlers = useMemo<NodeHandlers>(
    () => ({
      onSelect: (node) => {
        if (suppressClick.current) return;
        onSelect(node);
      },
      onHover,
      onFocusNode: (node, element) => {
        onFocusNode(node);
        revealNode(element);
      },
      onBlurNode: () => onFocusNode(null),
      register: registerNode,
    }),
    [onSelect, onHover, onFocusNode, registerNode, revealNode],
  );

  const baseEdges = useMemo(() => layout.edges.map((edge) => <path key={edge.id} d={edge.d} className="km-edge" />), [layout]);
  const litEdges = useMemo(() => {
    if (!lit) return [];
    const out: Array<{ edge: EdgeGeo; far: boolean }> = [];
    for (const id of lit.farEdges) {
      const edge = layout.edgeById.get(id);
      if (edge) out.push({ edge, far: true });
    }
    for (const id of lit.edges) {
      const edge = layout.edgeById.get(id);
      if (edge) out.push({ edge, far: false });
    }
    return out;
  }, [lit, layout]);

  // Cards and words in reading order (top to bottom, left to right): Tab follows the map.
  const ordered = useMemo(() => {
    const items: Array<{ kind: 'card'; lecture: MapLecture; box: CardBox } | { kind: 'word'; concept: MapConcept; box: WordBox }> = [];
    for (const lecture of view.lectures) {
      const box = layout.cardById.get(lecture.id);
      if (box) items.push({ kind: 'card', lecture, box });
    }
    for (const concept of view.concepts) {
      const box = layout.wordByKey.get(concept.key);
      if (box) items.push({ kind: 'word', concept, box });
    }
    return items.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  }, [view, layout]);

  const percent = percentText(current.scale);

  return (
    <div className="km-sheet sf-sheet" style={{ height: props.height }}>
      <div
        ref={attachViewport}
        className="km-viewport touch-pan-y"
        role="group"
        aria-roledescription="карта"
        aria-label={props.label}
        aria-describedby={props.hintId}
        data-dragging={dragging ? '' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.stopPropagation();
            event.preventDefault();
          }
        }}
        onClick={(event) => {
          if (!(event.target as Element).closest('[data-node]')) props.onBackground?.();
        }}
        onScroll={onScroll}
      >
        <div
          className="km-layer"
          data-focus={lit ? '' : undefined}
          style={{ width: layout.width, height: layout.height, transform: `translate(${current.x}px, ${current.y}px) scale(${current.scale})` }}
        >
          <svg className="km-edges" width={layout.width} height={layout.height} aria-hidden="true" focusable="false">
            <g className="km-edges-base">{baseEdges}</g>
            <g className="km-edges-lit">
              {litEdges.map(({ edge, far }) => (
                <PencilEdge key={edge.id} edge={edge} far={far} />
              ))}
            </g>
          </svg>
          {layout.groups.map((group) => (
            <span key={group.id} className="km-group" style={{ left: group.x, top: group.y, width: group.w, height: group.h }} aria-hidden="true">
              {group.text}
            </span>
          ))}
          {ordered.map((item) =>
            item.kind === 'card' ? (
              <MapCard
                key={`l:${item.lecture.id}`}
                lecture={item.lecture}
                box={item.box}
                questionById={view.questionById}
                state={stateOf(lit, lectureNode(item.lecture.id))}
                selected={selected === lectureNode(item.lecture.id)}
                readinessFocus={readinessFocus}
                handlers={handlers}
              />
            ) : (
              <MapWord
                key={`c:${item.concept.key}`}
                concept={item.concept}
                box={item.box}
                state={stateOf(lit, conceptNode(item.concept.key))}
                selected={selected === conceptNode(item.concept.key)}
                handlers={handlers}
              />
            ),
          )}
        </div>
      </div>
      {props.topLeft}
      <div className="km-zoom" role="group" aria-label="Масштаб карты">
        <button type="button" className="sf-link km-fit" data-muted="" onClick={() => setPinned(null)}>
          По размеру
        </button>
        <button type="button" className="km-zoom-btn" aria-label="Отдалить" onClick={() => zoomFromControl(1 / 1.2)}>
          <span aria-hidden="true">−</span>
        </button>
        <span className="km-zoom-v">{percent}</span>
        <button type="button" className="km-zoom-btn" aria-label="Приблизить" onClick={() => zoomFromControl(1.2)}>
          <span aria-hidden="true">+</span>
        </button>
      </div>
      {props.footer ? <div className="km-foot">{props.footer}</div> : null}
      {props.overlay ? <div className="km-overlay">{props.overlay}</div> : null}
    </div>
  );
}

/** Height of the sheet: the map at its fitted scale plus the room for the controls, within [min, max]. */
export function sheetHeight(layout: Pick<MapLayout, 'width' | 'height'>, width: number, max: number, footer: boolean, min = 360): number {
  // Before the sheet is measured: a sensible height, never the unbounded phone maximum.
  if (width <= 0 || layout.width <= 0) return Math.min(max, 600);
  const scale = Math.min(1.1, Math.max(40, width - 2 * FIT_PAD.side) / layout.width);
  const natural = layout.height * scale + FIT_PAD.top + (footer ? FIT_PAD.footer : FIT_PAD.bottom);
  return Math.round(Math.min(max, Math.max(min, natural)));
}

/** «Карта связей: 9 лекций и 14 общих понятий» — the map's accessible name. */
export function mapLabel(view: MapView): string {
  const shared = view.concepts.filter((concept) => concept.lectureIds.length > 1).length;
  const lectures = count(view.lectures.length, LECTURES);
  const words = view.concepts.length === shared ? count(shared, SHARED) : count(view.concepts.length, CONCEPTS);
  return `Карта связей: ${lectures} и ${words}`;
}
