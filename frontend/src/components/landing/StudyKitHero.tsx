import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  cancelFrame,
  cubicBezier,
  easeInOut,
  frame,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { Check, FileText, Headphones, Layers, ListChecks, Network, Pause, Play, RotateCcw, type LucideIcon } from 'lucide-react';
import {
  COMPOSED_AT,
  DISSOLVE,
  FALLBACK_PARAS,
  FALLBACK_SWEEP,
  FLIGHTS,
  LANDING,
  LIFT,
  PULSES,
  PULSE_DURATION,
  STAGES,
  STEP_TARGETS,
  T,
  progress,
  stageAt,
  sweepTime,
  type Flight,
  type PhraseId,
} from './studyKitTimeline';
import './StudyKitHero.css';

/* ------------------------------------------------------------------ */
/* Static demo content                                                 */
/* ------------------------------------------------------------------ */

type Fragment = string | { phrase: PhraseId; text: string } | { extra: string };

const PARAGRAPHS: Fragment[][] = [
  ['Без повторения за сутки забывается большая часть лекции — это показывает ', { phrase: 'kz', text: 'кривая забывания' }, '.'],
  ['Удержать материал помогает ', { phrase: 'av', text: 'активное вспоминание' }, ': закройте текст и ответьте своими словами.'],
  ['Затем ', { phrase: 'ip', text: 'интервальное повторение' }, ' возвращает к теме, когда она начинает забываться.'],
  ['А ', { phrase: 'pr', text: 'перечитывание' }, ' даёт лишь ощущение, что тема знакома', { extra: ' — память от него крепнет слабо' }, '.'],
];

const CHIP_TEXT: Record<PhraseId, string> = {
  kz: 'кривая забывания',
  av: 'активное вспоминание',
  ip: 'интервальное повторение',
  pr: 'перечитывание',
};

const SUMMARY_ROWS = [
  { flight: 'sum-kz', term: 'Кривая забывания', text: 'спад в первые сутки', source: 'абз. 1' },
  { flight: 'sum-av', term: 'Активное вспоминание', text: 'ответ до подсказки', source: 'абз. 2' },
  { flight: 'sum-ip', term: 'Интервальное повторение', text: 'повторы всё реже', source: 'абз. 3' },
];

const MAP_NODES = [
  { id: 'mem', cls: 'sfk-node--mem is-core', label: 'Память', at: T.mapNodes.mem },
  { id: 'ip', cls: 'sfk-node--ip', label: 'Повторение', at: T.mapNodes.ip },
  { id: 'kz', cls: 'sfk-node--kz', label: 'Забывание', at: T.mapNodes.kz },
  { id: 'av', cls: 'sfk-node--av', label: 'Вспоминание', at: T.mapNodes.av },
] as const;

const MAP_EDGES: Array<[string, string]> = [['mem', 'kz'], ['mem', 'av'], ['mem', 'ip'], ['ip', 'kz']];

const SUBTITLE_WORDS = 'Повторы выравнивают кривую забывания.'.split(' ');

/** Composed-state lines: page fragment -> where it ended up in the kit. */
const CONNECTORS: Array<{ from: PhraseId; to: string; box: string }> = [
  { from: 'kz', to: 'sum-kz', box: 'summary' },
  { from: 'av', to: 'sum-av', box: 'summary' },
  { from: 'ip', to: 'sum-ip', box: 'summary' },
  { from: 'pr', to: 'quiz-explain', box: 'quiz' },
];

const WAVE_BARS = [
  { speed: 7.1, phase: 0 },
  { speed: 9.3, phase: 1.3 },
  { speed: 6.2, phase: 2.4 },
  { speed: 8.4, phase: 0.7 },
  { speed: 7.7, phase: 1.9 },
];

const easeOutSoft = cubicBezier(0.22, 0.61, 0.36, 1);

/* ------------------------------------------------------------------ */
/* Environment hooks                                                   */
/* ------------------------------------------------------------------ */

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function readReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_QUERY).matches;
}

/** Live `prefers-reduced-motion` that is read synchronously on first render. */
export function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(readReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED_QUERY);
    const update = () => setReduce(query.matches);
    update();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    query.addListener?.(update);
    return () => query.removeListener?.(update);
  }, []);
  return reduce;
}

function usePageVisible() {
  const [visible, setVisible] = useState(() => (typeof document === 'undefined' ? true : !document.hidden));
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  return visible;
}

/* ------------------------------------------------------------------ */
/* Geometry: everything that moves between page and kit is measured   */
/* with offset* (layout boxes, unaffected by running transforms).     */
/* ------------------------------------------------------------------ */

interface Box { x: number; y: number; w: number; h: number }

interface Geometry {
  ready: boolean;
  links: boolean;
  scene: { w: number; h: number };
  paper: Box | null;
  sweep: Partial<Record<PhraseId, number>>;
  paras: number[];
  src: Partial<Record<PhraseId, Box>>;
  dst: Record<string, Box>;
  boxes: Record<string, Box>;
  chips: Record<string, { w: number; h: number }>;
  graph: { w: number; h: number; nodes: Record<string, { x: number; y: number }> };
}

const EMPTY_GEOMETRY: Geometry = {
  ready: false,
  links: false,
  scene: { w: 0, h: 0 },
  paper: null,
  sweep: {},
  paras: [],
  src: {},
  dst: {},
  boxes: {},
  chips: {},
  graph: { w: 200, h: 86, nodes: {} },
};

function boxWithin(el: HTMLElement, root: HTMLElement): Box {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    if (parent && parent !== root) {
      x += parent.clientLeft;
      y += parent.clientTop;
    }
    node = parent;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/** Hidden elements (e.g. the 4th paragraph on phones) have no layout box. */
const isShown = (box?: Box): box is Box => !!box && box.w > 0 && box.h > 0;

function useSceneGeometry(sceneRef: RefObject<HTMLDivElement>) {
  const [geometry, setGeometry] = useState<Geometry>(EMPTY_GEOMETRY);

  const measure = useCallback(() => {
    const root = sceneRef.current;
    if (!root || root.offsetWidth === 0) return;
    const pick = (selector: string) => root.querySelector<HTMLElement>(selector);
    const all = (selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector));

    const body = pick('[data-sfk-body]');
    const paperEl = pick('[data-sfk-paper]');
    const bodyBox = body ? boxWithin(body, root) : null;
    const fraction = (box: Box) => (bodyBox && bodyBox.h > 0 ? Math.min(0.98, Math.max(0, (box.y + box.h / 2 - bodyBox.y) / bodyBox.h)) : 0);

    const src: Geometry['src'] = {};
    const sweep: Geometry['sweep'] = {};
    all('[data-sfk-src]').forEach(el => {
      const id = el.dataset.sfkSrc as PhraseId;
      const box = boxWithin(el, root);
      src[id] = box;
      if (isShown(box)) sweep[id] = fraction(box);
    });

    const paras = all('[data-sfk-pnum]').map((el, index) => {
      const box = boxWithin(el, root);
      return isShown(box) ? fraction(box) : FALLBACK_PARAS[index];
    });

    const dst: Geometry['dst'] = {};
    all('[data-sfk-dst]').forEach(el => { dst[el.dataset.sfkDst as string] = boxWithin(el, root); });

    const boxes: Geometry['boxes'] = {};
    all('[data-sfk-box]').forEach(el => { boxes[el.dataset.sfkBox as string] = boxWithin(el, root); });

    const chips: Geometry['chips'] = {};
    all('[data-sfk-chip]').forEach(el => { chips[el.dataset.sfkChip as string] = { w: el.offsetWidth, h: el.offsetHeight }; });

    const graphEl = pick('[data-sfk-graph]');
    const graph: Geometry['graph'] = { w: graphEl?.offsetWidth || 200, h: graphEl?.offsetHeight || 86, nodes: {} };
    graphEl?.querySelectorAll<HTMLElement>('[data-sfk-node]').forEach(el => {
      graph.nodes[el.dataset.sfkNode as string] = { x: el.offsetLeft, y: el.offsetTop };
    });

    const links = getComputedStyle(root).getPropertyValue('--sfk-links').trim() !== '0';

    setGeometry({
      ready: true,
      links,
      scene: { w: root.offsetWidth, h: root.offsetHeight },
      paper: paperEl ? boxWithin(paperEl, root) : null,
      sweep,
      paras,
      src,
      dst,
      boxes,
      chips,
      graph,
    });
  }, [sceneRef]);

  useLayoutEffect(() => {
    measure();
    const root = sceneRef.current;
    if (!root) return;
    let raf = 0;
    const schedule = () => {
      if (typeof requestAnimationFrame !== 'function') { measure(); return; }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(root);
    root.querySelectorAll('[data-sfk-observe]').forEach(el => observer?.observe(el));
    window.addEventListener('resize', schedule);
    document.fonts?.ready.then(schedule).catch(() => undefined);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    };
  }, [measure, sceneRef]);

  return geometry;
}

/* ------------------------------------------------------------------ */
/* Small motion helpers: values derived from the single clock          */
/* ------------------------------------------------------------------ */

type Clock = MotionValue<number>;

function useEased(time: Clock, a: number, b: number, ease: (v: number) => number = easeOutSoft) {
  return useTransform(time, t => ease(progress(t, a, b)));
}

function useReveal(time: Clock, a: number, b: number, dx = 0, dy = 6) {
  const p = useEased(time, a, b);
  const x = useTransform(p, v => (1 - v) * dx);
  const y = useTransform(p, v => (1 - v) * dy);
  return { opacity: p, x, y };
}

/** 0 -> 1 -> 0 bump over `duration`, used to re-pulse a source highlight. */
function bump(t: number, at: number, duration: number) {
  const p = progress(t, at, at + duration);
  return p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p);
}

/* ------------------------------------------------------------------ */
/* Root component                                                      */
/* ------------------------------------------------------------------ */

export default function StudyKitHero() {
  const reduce = usePrefersReducedMotion();
  const rootRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  // Start only once half of the visual is on screen (not while only the paper is visible).
  const inView = useInView(rootRef, { amount: 0.5 });
  const pageVisible = usePageVisible();
  const [playing, setPlaying] = useState(true);
  const time = useMotionValue(reduce ? COMPOSED_AT : 0);
  const [stage, setStage] = useState(() => stageAt(time.get()));
  const [composed, setComposed] = useState(() => time.get() >= COMPOSED_AT - 0.01);
  const geometry = useSceneGeometry(sceneRef);
  const autoplay = playing && inView && pageVisible && !reduce;

  const shown = useRef({ stage, composed });
  useMotionValueEvent(time, 'change', t => {
    const nextStage = stageAt(t);
    const isComposed = t >= COMPOSED_AT - 0.01;
    if (nextStage !== shown.current.stage) { shown.current.stage = nextStage; setStage(nextStage); }
    if (isComposed !== shown.current.composed) { shown.current.composed = isComposed; setComposed(isComposed); }
  });

  useEffect(() => {
    if (reduce) time.set(COMPOSED_AT);
  }, [reduce, time]);

  // One clock for the whole scene. It only ticks while the hero is visible,
  // the tab is visible, the viewer has not paused it and motion is allowed.
  // It plays once and stops on the composed state.
  useEffect(() => {
    if (!autoplay) return;
    const tick = ({ delta }: { delta: number }) => {
      const next = time.get() + Math.min(delta, 64) / 1000;
      if (next >= COMPOSED_AT) {
        time.set(COMPOSED_AT);
        setPlaying(false);
        return;
      }
      time.set(next);
    };
    frame.update(tick, true);
    return () => cancelFrame(tick);
  }, [autoplay, time]);

  const replay = () => {
    time.set(0);
    setPlaying(true);
  };

  const togglePlay = () => {
    if (!playing && time.get() >= COMPOSED_AT - 0.01) { replay(); return; }
    setPlaying(value => !value);
  };

  // Jumping to a step is an instant change, so it also works with reduced motion.
  const jumpTo = (index: number) => {
    time.set(STEP_TARGETS[index]);
    setPlaying(false);
  };

  const isPlaying = playing && !reduce;
  const playLabel = isPlaying ? 'Приостановить анимацию' : composed ? 'Запустить анимацию' : 'Продолжить анимацию';

  return (
    <figure
      ref={rootRef}
      className="sfk"
      data-stage={stage}
      data-composed={composed ? 'true' : 'false'}
      data-autoplay={autoplay ? 'true' : 'false'}
      aria-labelledby="sfk-caption"
    >
      <figcaption id="sfk-caption" className="sfk-sr">
        Пример: страница лекции «Как работает память» превращается в учебный набор — конспект со ссылками на абзацы, карточки, тест, карту понятий и разговор двух ведущих.
      </figcaption>
      <div className="sfk-stage" aria-hidden="true">
        <Scene time={time} geometry={geometry} sceneRef={sceneRef} />
      </div>
      <div className="sfk-controls">
        <div className="sfk-progress">
          <div className="sfk-steps" role="group" aria-label="Этапы анимации">
            {STAGES.map((item, index) => (
              <StepButton key={item.label} index={index} time={time} active={stage === index} onSelect={jumpTo} />
            ))}
          </div>
          <p className="sfk-status" aria-hidden="true">{stage + 1}/{STAGES.length} · {STAGES[stage].label}</p>
        </div>
        {!reduce && (
          <div className="sfk-buttons">
            <button type="button" className="sfk-btn" aria-label={playLabel} onClick={togglePlay}>
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button type="button" className="sfk-btn" aria-label="Показать анимацию сначала" onClick={replay}>
              <RotateCcw size={15} />
            </button>
          </div>
        )}
      </div>
    </figure>
  );
}

function StepButton({ index, time, active, onSelect }: { index: number; time: Clock; active: boolean; onSelect: (index: number) => void }) {
  const item = STAGES[index];
  const fill = useTransform(time, t => progress(t, item.start, item.end));
  return (
    <button
      type="button"
      className={`sfk-step${active ? ' is-active' : ''}`}
      aria-current={active ? 'step' : undefined}
      onClick={() => onSelect(index)}
    >
      <span className="sfk-step-track" aria-hidden="true">
        <motion.span className="sfk-step-fill" style={{ scaleX: fill }} />
      </span>
      <span className="sfk-step-label">{item.label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const Scene = memo(function Scene({ time, geometry, sceneRef }: { time: Clock; geometry: Geometry; sceneRef: RefObject<HTMLDivElement> }) {
  return (
    <div ref={sceneRef} className="sfk-scene">
      <Paper time={time} geometry={geometry} />
      <div className="sfk-kit">
        <SummaryArtifact time={time} />
        <CardsArtifact time={time} />
        <QuizArtifact time={time} />
        <MapArtifact time={time} geometry={geometry} />
        <TalkArtifact time={time} />
      </div>
      <Connectors time={time} geometry={geometry} />
      <div className="sfk-chips">
        {FLIGHTS.map(flight => <Chip key={flight.id} flight={flight} time={time} geometry={geometry} />)}
      </div>
    </div>
  );
});

function Paper({ time, geometry }: { time: Clock; geometry: Geometry }) {
  const sweep = useTransform(time, t => `${progress(t, T.sweep[0], T.sweep[1]) * 100}%`);
  const sweepOpacity = useTransform(time, t => Math.min(progress(t, T.sweep[0], T.sweep[0] + 0.12), 1 - progress(t, T.sweep[1], T.sweep[1] + T.sweepFade)));

  return (
    <div className="sfk-paper" data-sfk-paper data-sfk-observe>
      <div className="sfk-paper-meta"><span>Лекция 4 · Психология обучения</span><span>стр. 12</span></div>
      <div className="sfk-paper-title">Как работает память</div>
      <div className="sfk-paper-body" data-sfk-body>
        {PARAGRAPHS.map((fragments, index) => (
          <p key={index}>
            <ParagraphNumber index={index} time={time} fraction={geometry.paras[index] ?? FALLBACK_PARAS[index]} />
            {fragments.map((fragment, i) => {
              if (typeof fragment === 'string') return <span key={i}>{fragment}</span>;
              if ('extra' in fragment) return <span key={i} className="sfk-extra">{fragment.extra}</span>;
              return <Highlight key={i} id={fragment.phrase} text={fragment.text} time={time} geometry={geometry} />;
            })}
          </p>
        ))}
        <div className="sfk-sweep-track" aria-hidden="true">
          <motion.div className="sfk-sweep" style={{ y: sweep, opacity: sweepOpacity }}>
            <span className="sfk-sweep-bar" />
          </motion.div>
        </div>
      </div>
      <div className="sfk-paper-foot"><span>Источник</span><span>Как работает память.pdf</span></div>
    </div>
  );
}

/** Paragraph number turns accent once the reading bar has passed it. */
function ParagraphNumber({ index, time, fraction }: { index: number; time: Clock; fraction: number }) {
  const at = sweepTime(fraction);
  const read = useEased(time, at, at + 0.15);
  return (
    <span className="sfk-pnum" data-sfk-pnum>
      {index + 1}
      <motion.span className="sfk-pnum-on" style={{ opacity: read }}>{index + 1}</motion.span>
    </span>
  );
}

function Highlight({ id, text, time, geometry }: { id: PhraseId; text: string; time: Clock; geometry: Geometry }) {
  const start = sweepTime(geometry.sweep[id] ?? FALLBACK_SWEEP[id]);
  const grow = useEased(time, start, start + T.highlightGrow);
  const pulses = PULSES[id];
  const pulse = useTransform(time, t => pulses.reduce((max, at) => Math.max(max, bump(t, at, PULSE_DURATION)), 0));
  return (
    <span className="sfk-hl" data-sfk-src={id}>
      <motion.span className="sfk-hl-bg" style={{ scaleX: grow }} />
      {pulses.length > 0 && <motion.span className="sfk-hl-pulse" style={{ opacity: pulse }} />}
      <span className="sfk-hl-text">{text}</span>
    </span>
  );
}

function Artifact({ time, window: [a, b], icon: Icon, label, meta, metaAt, className = '', box, children }: {
  time: Clock;
  window: readonly [number, number];
  icon: LucideIcon;
  label: string;
  meta?: ReactNode;
  /** Counters appear once the content they count has landed. */
  metaAt?: number;
  className?: string;
  box?: string;
  children: ReactNode;
}) {
  const p = useEased(time, a, b);
  const y = useTransform(p, v => (1 - v) * 10);
  const scale = useTransform(p, v => 0.98 + 0.02 * v);
  const metaIn = useEased(time, metaAt ?? a, (metaAt ?? a) + 0.25);
  // The slot (quiet outline + label) shows where the artifact will land before it exists.
  return (
    <div className={`sfk-slot ${className}`} data-label={label}>
      <motion.div className="sfk-card" data-sfk-box={box} data-sfk-observe style={{ opacity: p, y, scale }}>
        <div className="sfk-card-head">
          <Icon size={12} strokeWidth={2.2} />
          <span>{label}</span>
          {meta && <motion.div className="sfk-card-meta" style={metaAt === undefined ? undefined : { opacity: metaIn }}>{meta}</motion.div>}
        </div>
        {children}
      </motion.div>
    </div>
  );
}

/* --- a. Конспект --------------------------------------------------- */

function SummaryArtifact({ time }: { time: Clock }) {
  return (
    <Artifact time={time} window={T.summaryCard} icon={FileText} label="Конспект" meta="3 тезиса" metaAt={T.summaryMeta} box="summary" className="sfk-summary">
      <div className="sfk-rows">
        {SUMMARY_ROWS.map(row => <SummaryRow key={row.flight} time={time} {...row} />)}
      </div>
    </Artifact>
  );
}

function SummaryRow({ time, flight, term, text, source }: { time: Clock; flight: string; term: string; text: string; source: string }) {
  const land = LANDING[flight];
  const termIn = useEased(time, land - 0.05, land + 0.2);
  const rest = useReveal(time, land + 0.08, land + 0.42, -6, 0);
  const tag = useEased(time, land + 0.15, land + 0.45);
  return (
    <div className="sfk-row">
      <div className="sfk-row-line">
        <motion.span className="sfk-dot" style={{ scale: termIn, opacity: termIn }} />
        <motion.span className="sfk-term" data-sfk-dst={flight} style={{ opacity: termIn }}>{term}</motion.span>
      </div>
      <div className="sfk-row-more">
        <motion.span className="sfk-row-text" style={rest}>{text}</motion.span>
        <motion.span className="sfk-ref" style={{ opacity: tag }}>{source}</motion.span>
      </div>
    </div>
  );
}

/* --- b. Карточки --------------------------------------------------- */

function CardsArtifact({ time }: { time: Clock }) {
  const stackIn = useEased(time, T.stackIn[0], T.stackIn[1]);
  const stackScale = useTransform(stackIn, v => 0.9 + 0.1 * v);
  const fan = useEased(time, T.fan[0], T.fan[1]);
  const flip = useTransform(time, t => easeInOut(progress(t, T.flip[0], T.flip[1])) * 180);
  const back = {
    rotate: useTransform(fan, v => v * -7),
    x: useTransform(fan, v => v * -12),
    y: useTransform(fan, v => v * 3),
  };
  const middle = {
    rotate: useTransform(fan, v => v * 5),
    x: useTransform(fan, v => v * 11),
    y: useTransform(fan, v => v * 1.5),
  };
  const due = useEased(time, T.flip[1] - 0.12, T.flip[1] + 0.02);
  return (
    <Artifact time={time} window={T.cardsCard} icon={Layers} label="Карточки" meta="3 карточки" metaAt={T.cardsMeta} className="sfk-cards">
      <motion.div className="sfk-stack" data-sfk-dst="card" style={{ opacity: stackIn, scale: stackScale }}>
        <motion.div className="sfk-flash" style={back} />
        <motion.div className="sfk-flash" style={middle} />
        <div className="sfk-flash sfk-flash-top">
          <motion.div className="sfk-flip" style={{ rotateY: flip }}>
            <div className="sfk-face sfk-face-front">
              <small>Вопрос</small>
              <strong>Что такое активное вспоминание?</strong>
            </div>
            <div className="sfk-face sfk-face-back">
              <small>Что такое активное вспоминание?</small>
              <strong>Вспомнить самому, не глядя в текст</strong>
              <motion.span style={{ opacity: due }}>Повтор через 3 дня</motion.span>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </Artifact>
  );
}

/* --- c. Тест ------------------------------------------------------- */

function QuizArtifact({ time }: { time: Clock }) {
  const question = useReveal(time, T.quizQuestion[0], T.quizQuestion[1], 0, 4);
  const [a, b, c] = T.quizOptions;
  const optionA = useReveal(time, a, a + 0.2, -6, 0);
  const optionB = useReveal(time, b, b + 0.2, -6, 0);
  const optionC = useReveal(time, c, c + 0.2, -6, 0);
  const check = useEased(time, T.quizCheck[0], T.quizCheck[1]);
  const checkScale = useTransform(check, v => 0.4 + 0.6 * v);
  const explain = useReveal(time, T.quizExplain[0], T.quizExplain[1], -8, 0);
  return (
    <Artifact time={time} window={T.quizCard} icon={ListChecks} label="Тест" meta="1 из 5" metaAt={T.quizMeta} box="quiz" className="sfk-quiz">
      <motion.p className="sfk-q" style={question}>
        <span className="sfk-long">Как понять, что тема усвоена?</span>
        <span className="sfk-short">Как проверить себя?</span>
      </motion.p>
      <ul className="sfk-opts">
        <motion.li className="sfk-opt" style={optionA}><b>A</b><span><span className="sfk-long">Перечитать конспект</span><span className="sfk-short">Перечитать</span></span></motion.li>
        <motion.li className="sfk-opt is-correct" style={optionB}>
          <motion.i className="sfk-opt-tint" style={{ opacity: check }} />
          <b>B</b><span><span className="sfk-long">Ответить по памяти</span><span className="sfk-short">Вспомнить</span></span>
          <motion.i className="sfk-opt-check" style={{ opacity: check, scale: checkScale }}><Check size={11} strokeWidth={3} /></motion.i>
        </motion.li>
        <motion.li className="sfk-opt sfk-opt--c" style={optionC}><b>C</b><span>Выделить маркером</span></motion.li>
      </ul>
      <motion.p className="sfk-explain" style={explain}>
        <span data-sfk-dst="quiz-explain">Перечитывание</span> не проверяет память.
      </motion.p>
    </Artifact>
  );
}

/* --- d. Карта ------------------------------------------------------ */

function MapArtifact({ time, geometry }: { time: Clock; geometry: Geometry }) {
  const { w, h, nodes } = geometry.graph;
  return (
    <Artifact time={time} window={T.mapCard} icon={Network} label="Карта" meta="4 понятия" metaAt={T.mapMeta} className="sfk-map">
      <div className="sfk-graph" data-sfk-graph>
        <svg className="sfk-edges" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          {MAP_EDGES.map(([from, to], index) => (
            <MapEdge key={`${from}-${to}`} time={time} index={index} from={nodes[from]} to={nodes[to]} />
          ))}
        </svg>
        {MAP_NODES.map(node => (
          <MapNode key={node.id} time={time} id={node.id} cls={node.cls} label={node.label} at={node.at} />
        ))}
      </div>
    </Artifact>
  );
}

function MapEdge({ time, index, from, to }: { time: Clock; index: number; from?: { x: number; y: number }; to?: { x: number; y: number } }) {
  const start = T.edgesStart + index * T.edgeStagger;
  const length = useEased(time, start, start + T.edgeDuration, easeInOut);
  const visible = useTransform(length, v => (v > 0.001 ? 1 : 0));
  if (!from || !to) return null;
  return <motion.path className="sfk-edge" d={`M${from.x} ${from.y}L${to.x} ${to.y}`} style={{ pathLength: length, opacity: visible }} />;
}

function MapNode({ time, id, cls, label, at }: { time: Clock; id: string; cls: string; label: string; at: number }) {
  const p = useEased(time, at, at + 0.3);
  const scale = useTransform(p, v => 0.6 + 0.4 * v);
  return (
    <motion.span className={`sfk-node ${cls}`} data-sfk-node={id} style={{ x: '-50%', y: '-50%', scale, opacity: p }}>
      {label}
    </motion.span>
  );
}

/* --- e. Разговор --------------------------------------------------- */

function TalkArtifact({ time }: { time: Clock }) {
  const max = useReveal(time, T.speakers[0], T.speakers[0] + 0.3, 0, 4);
  const sofia = useReveal(time, T.speakers[1], T.speakers[1] + 0.3, 0, 4);
  const decay = useEased(time, T.curveDecay[0], T.curveDecay[1], easeInOut);
  const repeat = useEased(time, T.curveRepeat[0], T.curveRepeat[1], easeInOut);
  const decayVisible = useTransform(decay, v => (v > 0.001 ? 1 : 0));
  const repeatVisible = useTransform(repeat, v => (v > 0.001 ? 1 : 0));
  const legend = useEased(time, T.legend[0], T.legend[1]);
  const who = useEased(time, T.subtitle[0] - 0.1, T.subtitle[0] + 0.15);
  const speakers = (
    <span className="sfk-speakers">
      <motion.span className="sfk-speaker" style={max}><i>М</i>Макс</motion.span>
      <motion.span className="sfk-speaker is-active" style={sofia}>
        <i>С</i>Софья
        <span className="sfk-wave">{WAVE_BARS.map((bar, index) => <WaveBar key={index} time={time} speed={bar.speed} phase={bar.phase} />)}</span>
      </motion.span>
    </span>
  );
  return (
    <Artifact time={time} window={T.talkCard} icon={Headphones} label="Разговор" meta={speakers} className="sfk-talk">
      <p className="sfk-subtitle" data-sfk-subtitle>
        <motion.span className="sfk-who" style={{ opacity: who }}>Софья:</motion.span>{' '}
        {SUBTITLE_WORDS.map((word, index) => <SubtitleWord key={index} time={time} index={index} word={word} />)}
      </p>
      <div className="sfk-chart">
        <svg viewBox="0 0 200 46" className="sfk-curve" aria-hidden="true">
          <path className="sfk-axis" d="M4 2V42H198" />
          <motion.path className="sfk-decay" d="M4 6C24 28 66 38 196 41" style={{ pathLength: decay, opacity: decayVisible }} />
          <motion.path
            className="sfk-repeat"
            d="M4 6C10 18 20 22 40 24L40 8C54 18 70 20 92 21L92 8C108 15 124 17 144 18L144 8C160 13 178 14 196 15"
            style={{ pathLength: repeat, opacity: repeatVisible }}
          />
        </svg>
        <motion.span className="sfk-legend" style={{ opacity: legend }}>
          <span><i className="is-decay" />без повторов</span>
          <span><i className="is-repeat" />с повторами</span>
        </motion.span>
      </div>
    </Artifact>
  );
}

/** Caption words light up in sync with the speech, like live subtitles. */
function SubtitleWord({ time, index, word }: { time: Clock; index: number; word: string }) {
  const [a, b] = T.subtitle;
  const step = (b - a) / SUBTITLE_WORDS.length;
  const start = a + index * step;
  const lit = useEased(time, start, start + 0.22);
  const opacity = useTransform(lit, v => 0.18 + 0.82 * v);
  return <motion.span style={{ opacity }}>{word}{index < SUBTITLE_WORDS.length - 1 ? ' ' : ''}</motion.span>;
}

function WaveBar({ time, speed, phase }: { time: Clock; speed: number; phase: number }) {
  const scaleY = useTransform(time, t => {
    if (t < T.wave) return 0.3;
    const ramp = Math.min(1, (t - T.wave) / 0.3);
    // The bars settle into a still "speaking" shape on the composed state.
    const settle = 1 - progress(t, COMPOSED_AT - 0.4, COMPOSED_AT);
    const live = Math.abs(Math.sin((t - T.wave) * speed + phase));
    const rest = Math.abs(Math.sin(phase * 2.1 + speed));
    return 0.3 + ramp * (0.1 + 0.6 * (live * settle + rest * (1 - settle)));
  });
  return <motion.span style={{ scaleY }} />;
}

/* --- Composed-state connectors and flying chips -------------------- */

function Connectors({ time, geometry }: { time: Clock; geometry: Geometry }) {
  const { w, h } = geometry.scene;
  const paper = geometry.paper;
  const lines = geometry.links && paper
    ? CONNECTORS.map((link, index) => {
      const from = geometry.src[link.from];
      const to = geometry.dst[link.to];
      const box = geometry.boxes[link.box];
      if (!isShown(from) || !isShown(to) || !box) return null;
      const x0 = paper.x + paper.w;
      const y0 = from.y + from.h / 2;
      const x1 = box.x;
      const y1 = to.y + to.h / 2;
      const k = (x1 - x0) * 0.55;
      return { key: `${link.from}-${link.to}`, index, x0, y0, x1, y1, d: `M${x0} ${y0}C${x0 + k} ${y0} ${x1 - k} ${y1} ${x1} ${y1}` };
    })
    : [];
  return (
    <svg className="sfk-links" width={w || 1} height={h || 1} viewBox={`0 0 ${w || 1} ${h || 1}`} aria-hidden="true">
      {lines.map(line => line && <ConnectorLine key={line.key} time={time} index={line.index} d={line.d} x0={line.x0} y0={line.y0} x1={line.x1} y1={line.y1} />)}
    </svg>
  );
}

function ConnectorLine({ time, index, d, x0, y0, x1, y1 }: { time: Clock; index: number; d: string; x0: number; y0: number; x1: number; y1: number }) {
  const start = T.connectors[0] + index * 0.05;
  const draw = useEased(time, start, T.connectors[1], easeInOut);
  const visible = useTransform(draw, v => (v > 0.001 ? 1 : 0));
  const dots = useEased(time, start + 0.15, T.connectors[1]);
  return (
    <g>
      <motion.path className="sfk-link" d={d} style={{ pathLength: draw, opacity: visible }} />
      <motion.circle className="sfk-link-dot" cx={x0} cy={y0} r={2.2} style={{ opacity: dots }} />
      <motion.circle className="sfk-link-dot" cx={x1} cy={y1} r={2.2} style={{ opacity: dots }} />
    </g>
  );
}

/** Chip padding + border: lines the chip text up with the phrase it came from. */
const CHIP_INSET = 8;

function Chip({ flight, time, geometry }: { flight: Flight; time: Clock; geometry: Geometry }) {
  const src = geometry.src[flight.from];
  const dst = geometry.dst[flight.to];
  const size = geometry.chips[flight.id] ?? { w: 0, h: 0 };
  const ready = geometry.ready && isShown(src) && isShown(dst) && size.w > 0;
  const land = LANDING[flight.id];
  const sx = src ? src.x - CHIP_INSET : 0;
  const sy = src ? src.y + src.h / 2 - size.h / 2 : 0;
  const dx = dst ? (flight.align === 'start' ? dst.x - CHIP_INSET : dst.x + dst.w / 2 - size.w / 2) : 0;
  const dy = dst ? dst.y + dst.h / 2 - size.h / 2 : 0;
  // x leads and y follows, with only a slight arc, so chips do not sweep over
  // the page title or across finished cards.
  const arc = Math.min(12, Math.hypot(dx - sx, dy - sy) * 0.05);
  const fly = (t: number) => progress(t, flight.start + LIFT, land);
  const lift = (t: number) => easeOutSoft(progress(t, flight.start, flight.start + LIFT));

  const x = useTransform(time, t => sx + (dx - sx) * easeOutSoft(fly(t)));
  const y = useTransform(time, t => {
    const p = fly(t);
    return sy + (dy - sy) * easeInOut(p) - arc * Math.sin(Math.PI * p) - 4 * lift(t) * (1 - p);
  });
  const scale = useTransform(time, t => 1 + 0.06 * lift(t) - 0.06 * easeInOut(fly(t)) - 0.1 * progress(t, land, land + DISSOLVE));
  const opacity = useTransform(time, t => (ready ? Math.min(progress(t, flight.start, flight.start + LIFT * 0.7), 1 - progress(t, land, land + DISSOLVE)) : 0));

  return (
    <motion.span className="sfk-chip" data-sfk-chip={flight.id} style={{ x, y, scale, opacity }}>
      {CHIP_TEXT[flight.from]}
    </motion.span>
  );
}
