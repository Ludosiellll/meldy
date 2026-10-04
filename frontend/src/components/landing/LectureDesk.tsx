import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { MAP, TALK, type BarsVisual, type CompareVisual, type FormulaVisual, type TalkVisual } from './lecture';
import { ty } from './typo';
import './LectureDesk.css';

export const LABELS = { talk: 'Разговор Макса и Софьи', map: 'Карта понятий' };
/** The outgoing visual fades this long; the incoming one starts this much later. */
const VIS_OUT_MS = 90;
const VIS_IN_DELAY_MS = 60;

const numberFormat = new Intl.NumberFormat('ru-RU');

/* ------------------------------------------------------------------ */
/* The visuals Meldy shows next to the lines (the app's visual kinds)   */
/* ------------------------------------------------------------------ */

function CompareView({ visual }: { visual: CompareVisual }) {
  return (
    <div className="lp-vis-compare">
      <p className="lp-vis-title">{visual.title}</p>
      <div className="lp-vis-sides">
        {visual.sides.map((side, i) => (
          <div key={side.label} className={i === 0 ? 'lp-vis-side is-first' : 'lp-vis-side'}>
            <p className="lp-vis-label">{side.label}</p>
            <ul className="lp-vis-points">
              {side.points.map(point => <li key={point}>{point}</li>)}
            </ul>
            <p className="lp-vis-verdict">{side.verdict}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FormulaView({ visual }: { visual: FormulaVisual }) {
  return (
    <div className="lp-vis-formula">
      <p className="lp-vis-title">{visual.title}</p>
      <div className="lp-formula" role="img" aria-label={`E равно ${visual.top} делить на ${visual.bottom}; например, ${visual.example.top} делить на ${visual.example.bottom} равно ${visual.example.result}`}>
        <span className="lp-formula-e">E</span>
        <span className="lp-formula-eq">=</span>
        <span className="lp-frac"><span>{visual.top}</span><span>{visual.bottom}</span></span>
        <span className="lp-formula-eq">=</span>
        <span className="lp-frac"><span>{visual.example.top}</span><span>{visual.example.bottom}</span></span>
        <span className="lp-formula-eq">=</span>
        <span className="lp-formula-r">{visual.example.result}</span>
      </div>
      <dl className="lp-legend">
        {visual.legend.map(([symbol, meaning]) => (
          <div key={symbol} className="lp-legend-row">
            <dt>{symbol}</dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BarsView({ visual }: { visual: BarsVisual }) {
  const max = Math.max(...visual.bars.map(b => b.value)) || 1;
  return (
    <div className="lp-vis-bars">
      <p className="lp-vis-title">{visual.title}</p>
      <div className="lp-bars">
        {visual.bars.map(bar => (
          <div key={bar.label} className="lp-bar-row">
            <span className="lp-bar-label">{bar.label}</span>
            <span className="lp-bar-track">
              <span className="lp-bar" style={{ width: `${((bar.value / max) * 100).toFixed(1)}%` }} />
            </span>
            <span className="lp-bar-value">{numberFormat.format(bar.value)}&nbsp;{visual.unit}</span>
            <span className="lp-bar-note">{bar.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Visual({ visual }: { visual: TalkVisual }) {
  if (visual.type === 'compare') return <CompareView visual={visual} />;
  if (visual.type === 'formula') return <FormulaView visual={visual} />;
  return <BarsView visual={visual} />;
}

/* ------------------------------------------------------------------ */
/* (a) The conversation                                                 */
/* ------------------------------------------------------------------ */

interface Shown { index: number; key: number; leaving: boolean }

function Talk({ reduced }: { reduced: boolean }) {
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState<Shown[]>([{ index: 0, key: 0, leaving: false }]);
  const keyRef = useRef(1);
  const timers = useRef<number[]>([]);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const listRef = useRef<HTMLOListElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => timers.current.forEach(id => window.clearTimeout(id)), []);

  /* Side by side, the screen moves down to sit next to the exchange that is speaking. */
  const follow = useCallback(() => {
    const list = listRef.current;
    const screen = screenRef.current;
    const button = buttons.current[active];
    if (!list || !screen || !button) return;
    const sideBySide = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;
    if (!sideBySide) {
      screen.style.transform = '';
      return;
    }
    const listRect = list.getBoundingClientRect();
    const room = Math.max(0, listRect.height - screen.offsetHeight);
    const offset = Math.min(room, Math.max(0, button.getBoundingClientRect().top - listRect.top));
    screen.style.transform = offset > 0.5 ? `translateY(${offset.toFixed(1)}px)` : '';
  }, [active]);
  useLayoutEffect(follow, [follow]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => follow());
    observer.observe(list);
    return () => observer.disconnect();
  }, [follow]);

  const select = useCallback((index: number, focus = false) => {
    if (focus) buttons.current[index]?.focus();
    if (index === active) return;
    setActive(index);
    if (reduced) {
      setShown([{ index, key: keyRef.current++, leaving: false }]);
      return;
    }
    // Fade-through: the old visual leaves (90 ms, ease-in), the new one arrives after 60 ms.
    setShown(prev => [...prev.filter(s => !s.leaving).map(s => ({ ...s, leaving: true })), { index, key: keyRef.current++, leaving: false }]);
    const id = window.setTimeout(() => setShown(prev => prev.filter(s => !s.leaving)), VIS_OUT_MS + 30);
    timers.current.push(id);
  }, [active, reduced]);

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TALK.length - 1;
    const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? Math.min(last, index + 1)
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? Math.max(0, index - 1)
        : null;
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  };

  return (
    <section className="lp-out lp-out-talk" aria-labelledby="lp-talk-h">
      <h3 className="lp-out-h" id="lp-talk-h">{LABELS.talk}</h3>
      <div className="lp-talk">
        <ol className="lp-talk-list" ref={listRef}>
          {TALK.map((exchange, i) => (
            <li key={i}>
              <button
                type="button"
                ref={el => { buttons.current[i] = el; }}
                className={i === active ? 'lp-ex is-active' : 'lp-ex'}
                aria-pressed={i === active}
                onClick={() => select(i)}
                onKeyDown={event => onKey(event, i)}
              >
                {exchange.lines.map(([who, text]) => (
                  <span key={who} className="lp-line">
                    <span className="lp-who">{who}</span>
                    <span className="lp-said">{text}</span>
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ol>
        <div className="lp-talk-screen" ref={screenRef}>
          {shown.map(s => (
            <div key={s.key} className={s.leaving ? 'lp-vis is-out' : s.key === 0 ? 'lp-vis' : 'lp-vis is-in'} aria-hidden={s.leaving ? true : undefined} style={s.leaving ? undefined : { animationDelay: `${VIS_IN_DELAY_MS}ms` }}>
              <Visual visual={TALK[s.index].visual} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* (b) The concept map: edges end on the node boxes                     */
/* ------------------------------------------------------------------ */

interface Box { cx: number; cy: number; hw: number; hh: number }

/** Where the ray from the box centre toward (tx, ty) leaves the box, plus a gap. */
export function exitPoint(box: Box, tx: number, ty: number, gap = 0) {
  const dx = tx - box.cx;
  const dy = ty - box.cy;
  const len = Math.hypot(dx, dy) || 1;
  const sx = dx === 0 ? Infinity : box.hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : box.hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: box.cx + dx * s + (dx / len) * gap, y: box.cy + dy * s + (dy / len) * gap };
}

export interface MapEdgeGeo { d: string; head: string; label?: { x: number; y: number; text: string } }

/** Straight edges from border to border, with an open chevron at the target. */
export function mapEdges(boxes: Record<string, Box>): MapEdgeGeo[] {
  return MAP.edges.map(edge => {
    const a = boxes[edge.from];
    const b = boxes[edge.to];
    const start = exitPoint(a, b.cx, b.cy, 0);
    const end = exitPoint(b, a.cx, a.cy, 0);
    const len = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const ux = (end.x - start.x) / len;
    const uy = (end.y - start.y) / len;
    const wing = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return { x: end.x - 8 * (ux * Math.cos(r) - uy * Math.sin(r)), y: end.y - 8 * (ux * Math.sin(r) + uy * Math.cos(r)) };
    };
    const w1 = wing(28);
    const w2 = wing(-28);
    return {
      d: `M${start.x.toFixed(1)} ${start.y.toFixed(1)}L${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
      head: `M${w1.x.toFixed(1)} ${w1.y.toFixed(1)}L${end.x.toFixed(1)} ${end.y.toFixed(1)}L${w2.x.toFixed(1)} ${w2.y.toFixed(1)}`,
      label: edge.label ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, text: edge.label } : undefined,
    };
  });
}

function ConceptMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const [geo, setGeo] = useState<{ w: number; h: number; edges: MapEdgeGeo[] } | null>(null);

  const measure = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const origin = map.getBoundingClientRect();
    const boxes: Record<string, Box> = {};
    for (const node of MAP.nodes) {
      const el = nodeRefs.current[node.id];
      if (!el) return;
      const r = el.getBoundingClientRect();
      boxes[node.id] = { cx: r.left - origin.left + r.width / 2, cy: r.top - origin.top + r.height / 2, hw: r.width / 2, hh: r.height / 2 };
    }
    const next = { w: Math.round(origin.width), h: Math.round(origin.height), edges: mapEdges(boxes) };
    setGeo(prev => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);

  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    const map = mapRef.current;
    let alive = true;
    document.fonts?.ready?.then(() => { if (alive) measure(); }).catch(() => {});
    if (!map || typeof ResizeObserver === 'undefined') return () => { alive = false; };
    const observer = new ResizeObserver(() => measure());
    observer.observe(map);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [measure]);

  const description = MAP.edges
    .map(edge => {
      const from = MAP.nodes.find(n => n.id === edge.from)!.label;
      const to = MAP.nodes.find(n => n.id === edge.to)!.label;
      return `${from} → ${to}${edge.label ? ` (${edge.label})` : ''}`;
    })
    .join('; ');

  return (
    <section className="lp-out lp-out-map" aria-labelledby="lp-map-h">
      <h3 className="lp-out-h" id="lp-map-h">{LABELS.map}</h3>
      <div className="lp-map" ref={mapRef} role="img" aria-label={`Карта понятий лекции: ${description}.`}>
        {geo && (
          <svg className="lp-map-edges" width={geo.w} height={geo.h} aria-hidden="true" focusable="false">
            {geo.edges.map((edge, i) => (
              <g key={i}>
                <path className="lp-map-line" d={edge.d} />
                <path className="lp-map-head" d={edge.head} />
              </g>
            ))}
          </svg>
        )}
        <div className="lp-map-field" aria-hidden="true">
          {MAP.nodes.map(node => (
            <span
              key={node.id}
              ref={el => { nodeRefs.current[node.id] = el; }}
              className={node.id === 'e' ? 'lp-map-node is-root' : 'lp-map-node'}
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
            >
              {ty(node.label)}
            </span>
          ))}
        </div>
        {geo?.edges.map((edge, i) => edge.label && (
          <span key={`l${i}`} className="lp-map-label" style={{ left: `${edge.label.x}px`, top: `${edge.label.y}px` }} aria-hidden="true">{edge.label.text}</span>
        ))}
      </div>
    </section>
  );
}

/**
 * Under «Из каждой лекции — ещё и это», after the summary and the quiz: the conversation of the two
 * hosts, with the visual Meldy shows for each exchange, then the concept map. All from the same
 * lecture. The answer to a ticket has its own section («Ответ на билет»), so there is no exam here.
 */
export default function LectureDesk() {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="lp-desk">
      <Talk reduced={reduced} />
      <div className="lp-desk-row">
        <ConceptMap />
      </div>
    </div>
  );
}
