import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { animate, useMotionValue, useMotionValueEvent } from 'framer-motion';
import { SPRING, clamp } from './paperTimeline';
import { HAND_DATES, type HandPhrase } from './handDates';
import { CARD_QUESTION, SCHEDULE } from './lecture';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import './ScheduleCard.css';

/** Pencil speed for the dates: «завтра» takes about as long as on the hero card. */
const WRITE = { unitsPerSecond: 2300, lift: 0.022, delay: 0.12 } as const;
const ERASE_MS = 140;

/**
 * Where the card sits for each stop: the square root of the day it comes back (1, 7, 23 and
 * 68 days from now), so the gaps visibly grow without the first stops crowding together.
 */
export function stopFractions(schedule: ReadonlyArray<{ days: number }> = SCHEDULE) {
  let day = 0;
  const roots = schedule.map(s => {
    day += s.days;
    return Math.sqrt(day);
  });
  const first = roots[0];
  const last = roots[roots.length - 1];
  return roots.map(r => (last === first ? 0 : (r - first) / (last - first)));
}

export function strokeTimings(phrase: HandPhrase) {
  let t = WRITE.delay;
  return phrase.lens.map(len => {
    const d = len / WRITE.unitsPerSecond;
    const w = { delay: t, duration: d };
    t += d + WRITE.lift;
    return w;
  });
}

function HandDate({ phrase, px, state }: { phrase: HandPhrase; px: number; state: 'write' | 'still' | 'erase' }) {
  const s = px / 100;
  const pad = 3;
  const timings = strokeTimings(phrase);
  return (
    <svg
      className={`lp-date is-${state}`}
      width={(phrase.bbox.x2 - phrase.bbox.x) * s + pad * 2}
      height={(phrase.bbox.y2 - phrase.bbox.y) * s + pad * 2}
      aria-hidden="true"
      focusable="false"
    >
      <g transform={`translate(${pad - phrase.bbox.x * s} ${pad - phrase.bbox.y * s}) scale(${s})`}>
        {phrase.paths.map((d, i) => (
          <path
            key={i}
            d={d}
            pathLength={1}
            strokeWidth={1.6 / s}
            style={state === 'write' ? ({ animationDelay: `${timings[i].delay.toFixed(3)}s`, animationDuration: `${timings[i].duration.toFixed(3)}s` } as CSSProperties) : undefined}
          />
        ))}
      </g>
    </svg>
  );
}

interface DateLayer { key: number; stop: number; state: 'write' | 'still' | 'erase' }

/**
 * «Подход»: the hero's card on a hairline timeline. «Знаю» sends it to its next return
 * (завтра → через 6 дней → через 2 недели → через полтора месяца) and the pencil date in its
 * corner is rewritten; «Не помню» brings it back to «завтра». Nothing moves on its own.
 */
export default function ScheduleCard() {
  const reduced = usePrefersReducedMotion();
  const [stop, setStop] = useState(0);
  const [dates, setDates] = useState<DateLayer[]>([{ key: 0, stop: 0, state: 'still' }]);
  const [announce, setAnnounce] = useState('');
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const span = useRef(0);
  const keyRef = useRef(1);
  const timers = useRef<number[]>([]);
  const x = useMotionValue(0);
  const fractions = useRef(stopFractions());
  const stopRef = useRef(0);
  useEffect(() => () => timers.current.forEach(id => window.clearTimeout(id)), []);

  /* The card leans a little into its motion and lifts off the line while it travels. */
  const paint = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    const v = x.getVelocity();
    const lean = clamp(v / 900, -1, 1);
    card.style.transform = `translateX(${x.get().toFixed(2)}px) rotate(${(1.4 * lean).toFixed(3)}deg)`;
    card.style.setProperty('--lp-travel', Math.abs(lean).toFixed(3));
  }, [x]);
  useMotionValueEvent(x, 'change', paint);
  useMotionValueEvent(x, 'animationComplete', paint);

  const place = useCallback((index: number, how: 'jump' | 'spring') => {
    const target = fractions.current[index] * span.current;
    if (how === 'jump' || reduced) {
      x.jump(target);
      paint();
    } else {
      animate(x, target, { type: 'spring', stiffness: SPRING.method[0], damping: SPRING.method[1] });
    }
  }, [paint, reduced, x]);

  useLayoutEffect(() => {
    const track = trackRef.current;
    const card = cardRef.current;
    if (!track || !card) return;
    const read = () => {
      span.current = Math.max(0, track.clientWidth - card.offsetWidth);
      place(stopRef.current, 'jump');
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(track);
    return () => observer.disconnect();
  }, [place]);

  const go = (next: number) => {
    if (next === stopRef.current) return;
    stopRef.current = next;
    setStop(next);
    place(next, 'spring');
    setAnnounce(`Карточка вернётся ${SCHEDULE[next].label}.`);
    if (reduced) {
      setDates([{ key: keyRef.current++, stop: next, state: 'still' }]);
      return;
    }
    setDates(prev => [
      ...prev.filter(d => d.state !== 'erase').map(d => ({ ...d, state: 'erase' as const })),
      { key: keyRef.current++, stop: next, state: 'write' },
    ]);
    const id = window.setTimeout(() => setDates(prev => prev.filter(d => d.state !== 'erase')), ERASE_MS + 30);
    timers.current.push(id);
  };

  const last = SCHEDULE.length - 1;
  const atEnd = stop === last;
  const ticks = fractions.current;

  return (
    <figure className="lp-sched" aria-label="Когда карточка вернётся на повторение">
      <div className="lp-sched-track" ref={trackRef}>
        <div className="lp-sched-card" ref={cardRef}>
          <span className="lp-sched-q">{CARD_QUESTION}</span>
          <span className="lp-sched-date">
            {dates.map(d => <HandDate key={d.key} phrase={HAND_DATES[d.stop]} px={20} state={d.state} />)}
          </span>
          <span className="sr-only">{`Вернётся ${SCHEDULE[stop].label}`}</span>
        </div>
        <span className="lp-sched-line" aria-hidden="true">
          {ticks.map((f, i) => (
            <span key={i} className={i <= stop ? 'lp-sched-tick is-past' : 'lp-sched-tick'} style={{ left: `calc(var(--lp-card-w) / 2 + (100% - var(--lp-card-w)) * ${f.toFixed(4)})` }} />
          ))}
        </span>
      </div>
      <div className="lp-sched-actions">
        <button type="button" className="lp-sched-btn is-known" aria-disabled={atEnd || undefined} onClick={() => { if (!atEnd) go(stop + 1); }}>
          Знаю
        </button>
        <button type="button" className="lp-sched-btn" onClick={() => go(0)}>
          Не помню
        </button>
      </div>
      <p className="sr-only" aria-live="polite">{announce}</p>
    </figure>
  );
}
