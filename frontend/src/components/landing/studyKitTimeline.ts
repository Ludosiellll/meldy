// Deterministic timeline for the landing hero "Страница собирается в набор для учёбы".
// Every animated value in the hero is a pure function of one clock (seconds),
// so pause, replay, jumping to a step and the reduced-motion composed state
// are all just "set the clock".
//
// The scene plays once (about 8 s) and stays on the composed state: there is no
// loop teardown next to the headline. The paper is fully visible at t = 0, so a
// paused or not-yet-started hero is never an empty box.

export type PhraseId = 'kz' | 'av' | 'ip' | 'pr';

export interface Stage {
  label: string;
  start: number;
  end: number;
}

export const STAGES: readonly Stage[] = [
  { label: 'Материал', start: 0, end: 1.8 },
  { label: 'Конспект', start: 1.8, end: 3.2 },
  { label: 'Карточки', start: 3.2, end: 4.5 },
  { label: 'Тест', start: 4.5, end: 5.8 },
  { label: 'Карта и разговор', start: 5.8, end: 8.2 },
];

/** Everything is on screen and settled; the clock stops here. */
export const COMPOSED_AT = 8.2;

export function stageAt(t: number): number {
  for (let i = STAGES.length - 1; i >= 0; i -= 1) {
    if (t >= STAGES[i].start) return i;
  }
  return 0;
}

/** Flight phases for a chip: lift off the page, fly, dissolve into the artifact. */
export const LIFT = 0.12;
export const FLY = 0.6;
export const DISSOLVE = 0.2;

export interface Flight {
  id: string;
  from: PhraseId;
  to: string;
  start: number;
  /** Where the chip lands: left edge of the target text, or its centre. */
  align: 'start' | 'center';
}

export const FLIGHTS: readonly Flight[] = [
  { id: 'sum-kz', from: 'kz', to: 'sum-kz', start: 1.82, align: 'start' },
  { id: 'sum-av', from: 'av', to: 'sum-av', start: 1.92, align: 'start' },
  { id: 'sum-ip', from: 'ip', to: 'sum-ip', start: 2.02, align: 'start' },
  { id: 'card-av', from: 'av', to: 'card', start: 3.2, align: 'center' },
  { id: 'quiz-pr', from: 'pr', to: 'quiz-explain', start: 4.52, align: 'start' },
];

export function landingTime(flight: Pick<Flight, 'start'>): number {
  return flight.start + LIFT + FLY;
}

export const LANDING: Record<string, number> = Object.fromEntries(FLIGHTS.map(flight => [flight.id, landingTime(flight)]));

const SUMMARY_DONE = LANDING['sum-ip'];
const CARD_DONE = LANDING['card-av'];
const QUIZ_DONE = LANDING['quiz-pr'];

export const T = {
  // 1. Материал: a reading bar runs down the paragraph-number column.
  sweep: [0.25, 1.5],
  sweepFade: 0.2,
  highlightGrow: 0.3,

  // 2. Конспект
  summaryCard: [1.8, 2.1],
  summaryMeta: SUMMARY_DONE,

  // 3. Карточки: the stack appears as the chip lands, fans out, the top card flips.
  cardsCard: [3.2, 3.45],
  stackIn: [CARD_DONE - 0.06, CARD_DONE + 0.08],
  fan: [CARD_DONE + 0.06, CARD_DONE + 0.24],
  flip: [CARD_DONE + 0.18, CARD_DONE + 0.5],
  cardsMeta: CARD_DONE,

  // 4. Тест: options, check on the correct one, explanation where the chip lands.
  quizCard: [4.5, 4.75],
  quizQuestion: [4.6, 4.85],
  quizOptions: [4.78, 4.88, 4.98],
  quizCheck: [5.04, 5.24],
  quizExplain: [QUIZ_DONE - 0.04, QUIZ_DONE + 0.26],
  quizMeta: QUIZ_DONE,

  // 5. Карта и разговор (the old 11.8-15.4 s window, remapped linearly).
  mapCard: [5.9, 6.17],
  mapNodes: { mem: 6.23, ip: 6.5, kz: 6.6, av: 6.7 },
  mapMeta: 6.7,
  edgesStart: 6.77,
  edgeDuration: 0.34,
  edgeStagger: 0.08,

  talkCard: [6.73, 7.0],
  speakers: [6.9, 7.0],
  wave: 7.13,
  subtitle: [7.27, 7.93],
  curveDecay: [7.47, 7.8],
  curveRepeat: [7.67, 8.1],
  legend: [7.75, 8.05],

  connectors: [7.77, 8.17],
} as const;

/** Source highlights re-pulse when the map node or the chart that uses them appears. */
export const PULSES: Record<PhraseId, readonly number[]> = {
  kz: [T.mapNodes.kz, T.curveDecay[0]],
  av: [T.mapNodes.av],
  ip: [T.mapNodes.ip],
  pr: [],
};
export const PULSE_DURATION = 0.6;

/** Clock value used when a step is selected: the settled state of that stage. */
export const STEP_TARGETS = [
  1.78,
  SUMMARY_DONE + 0.45,
  Math.max(CARD_DONE + 0.45, T.flip[1] + 0.03),
  QUIZ_DONE + 0.45,
  COMPOSED_AT,
];

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function progress(t: number, a: number, b: number): number {
  return clamp01((t - a) / (b - a));
}

/** Fallback sweep positions (fraction of the page body) before layout is measured. */
export const FALLBACK_SWEEP: Record<PhraseId, number> = { kz: 0.2, av: 0.42, ip: 0.64, pr: 0.86 };
export const FALLBACK_PARAS = [0.05, 0.3, 0.55, 0.78];

/** When the reading bar reaches a point at `fraction` of the page body. */
export function sweepTime(fraction: number): number {
  return T.sweep[0] + fraction * (T.sweep[1] - T.sweep[0]);
}
