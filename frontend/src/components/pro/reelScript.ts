/**
 * The PRO reel, «что будет, если купить PRO» (owner, 2026-10-04: «сделай анимацию в стиле того
 * видео … которая покажет что будет если купить про подписку и вставь это в окно покупки»). Film
 * style (decision 2026-10-04_video-film-style) on the reel engine: one clock, every scene a pure
 * function of time on a 1920 × 1080 stage, so a moment always looks the same. Four beats:
 *   1. «Сессия. Сто вопросов к экзамену.» over a long list out of focus;
 *   2. the free day: the limit meter in the top line runs down as lectures and answers are checked,
 *      to zero — «Дневной лимит исчерпан»;
 *   3. «С PRO —»: the meter fills to the PRO day, ticket after ticket is checked, a long list of
 *      questions gets its marks, a conversation plays — and the meter has plenty left;
 *   4. «Готовьтесь, сколько нужно.», the wordmark, and its dot — the frame the loop starts from.
 * Every number on the stage comes from lib/plans.ts (the day's units, the price of each action).
 */
import { AI_COSTS, FREE_DAILY_UNITS, PRO_DAILY_UNITS, type AICostKind } from '../../lib/plans';
import type { AuthScript } from '../authReel/script';
import { plural } from './planCopy';

// ---------------------------------------------------------------------------------------------
// The scenes (reel time, ms). Each one enters 300 ms before the previous one is gone.

export type ProSceneId = 'intro' | 'free' | 'pro' | 'end';

export const PRO_TOTAL = 15950;

const SCENES: ReadonlyArray<{ id: ProSceneId; from: number; to: number }> = [
  { id: 'intro', from: 0, to: 2400 },
  { id: 'free', from: 2100, to: 7200 },
  { id: 'pro', from: 6900, to: 12750 },
  { id: 'end', from: 12450, to: PRO_TOTAL },
];

export const sceneOf = (id: ProSceneId) => SCENES.find((scene) => scene.id === id)!;

// ---------------------------------------------------------------------------------------------
// The money of the reel: chips that leave an action and land in the meter.

export interface Spend {
  kind: AICostKind;
  cost: number;
  /** Scene time the chip leaves its action. */
  at: number;
  /** Scene time it reaches the meter: the number changes then. */
  lands: number;
}

export const CHIP_WORD: Partial<Record<AICostKind, string>> = {
  lecture: 'Лекция',
  answer: 'Ответ',
  examMapping: 'Сверка',
  conversation: 'Разговор',
};

/** «Лекция −20» (a real minus). */
export const chipText = (spend: Pick<Spend, 'kind' | 'cost'>) => `${CHIP_WORD[spend.kind] ?? ''} −${spend.cost}`;

/** How long a chip flies from its action to the meter (ms). */
export const FLIGHT = 480;

/** The free day: lecture files first, then ticket answers, until the next answer no longer fits. */
export function freeDayKinds(budget: number = FREE_DAILY_UNITS): AICostKind[] {
  const kinds: AICostKind[] = [];
  let left = budget;
  // Room for a run of answers after the lectures: the day ends on the answers.
  const answersRoom = AI_COSTS.answer * 5;
  while (kinds.length < 4 && left - AI_COSTS.lecture >= answersRoom) {
    kinds.push('lecture');
    left -= AI_COSTS.lecture;
  }
  while (kinds.length < 12 && left >= AI_COSTS.answer) {
    kinds.push('answer');
    left -= AI_COSTS.answer;
  }
  return kinds;
}

/** The free day (scene time). */
export const FREE_TIMES = {
  /** Lecture files drop in one after another; each one's chip leaves when it has landed. */
  files: 400,
  fileEvery: 250,
  fileChip: 330,
  /** The ticket card comes up. */
  ticket: 1350,
  /** «Проверить ответ» is pressed, again and again. */
  presses: 1950,
  pressEvery: 230,
  pressChip: 60,
  /** «Дневной лимит исчерпан». */
  limit: 3500,
  /** The screen leaves. */
  leave: 4650,
} as const;

export const FILE_AT = (index: number) => FREE_TIMES.files + index * FREE_TIMES.fileEvery;
export const PRESS_AT = (index: number) => FREE_TIMES.presses + index * FREE_TIMES.pressEvery;

export const FREE_SPENDS: readonly Spend[] = (() => {
  let lecture = 0;
  let answer = 0;
  return freeDayKinds().map((kind) => {
    const at = kind === 'lecture' ? FILE_AT(lecture++) + FREE_TIMES.fileChip : PRESS_AT(answer++) + FREE_TIMES.pressChip;
    return { kind, cost: AI_COSTS[kind], at, lands: at + FLIGHT };
  });
})();

export const FREE_LECTURES = FREE_SPENDS.filter((spend) => spend.kind === 'lecture').length;
export const FREE_ANSWERS = FREE_SPENDS.filter((spend) => spend.kind === 'answer').length;

/** What the free day leaves on the meter at the end (0 with today's prices). */
export const FREE_LEFT = FREE_DAILY_UNITS - FREE_SPENDS.reduce((sum, spend) => sum + spend.cost, 0);

/** The free day runs out here: the answer button greys, then «Дневной лимит исчерпан». */
export const FREE_EMPTY_AT = FREE_SPENDS.length ? FREE_SPENDS[FREE_SPENDS.length - 1].lands : 0;

/** The questions of the session (the opening line says «Сто вопросов»). */
export const SESSION_QUESTIONS = 100;
/**
 * The list check is charged AI_COSTS.examMapping for every started block of this many new questions
 * (lib/plans.ts says so in words; backend/plans.py has it as EXAM_MAPPING_QUESTIONS_PER_CHARGE).
 */
export const QUESTIONS_PER_LIST_CHARGE = 40;
export const LIST_CHECK_COST = Math.ceil(SESSION_QUESTIONS / QUESTIONS_PER_LIST_CHARGE) * AI_COSTS.examMapping;

/** The PRO day (scene time of the PRO beat): the meter fills, then three things happen. */
export const PRO_TIMES = {
  /** The statement «С PRO —» leaves and the screen comes into focus. */
  focus: 1000,
  /** The meter fills from 0 to the PRO day. */
  fill: 1100,
  fillFor: 650,
  /**
   * Tickets: one checked every `ticketEvery` from `tickets`; its chip leaves `ticketChip` later. The
   * 200 ms before the first one hold the full meter still (the reduced-motion frame).
   */
  tickets: 1950,
  ticketEvery: 260,
  ticketChip: 100,
  /** Whip pan to the question list, its marks, the list's chip. */
  toList: 3000,
  listMarks: 3200,
  listChip: 3850,
  /** Whip pan to the conversation; its chip; its line. */
  toTalk: 4050,
  talkChip: 4350,
  talkLine: 4450,
  /** The screen leaves. */
  leave: 5350,
} as const;

/** How long a whip pan takes (ms). */
export const PAN = 420;

export const PRO_TICKETS = 4;

export const STAMP_AT = (index: number) => PRO_TIMES.tickets + index * PRO_TIMES.ticketEvery;

export const PRO_SPENDS: readonly Spend[] = [
  ...Array.from({ length: PRO_TICKETS }, (_, index) => {
    const at = STAMP_AT(index) + PRO_TIMES.ticketChip;
    return { kind: 'answer' as const, cost: AI_COSTS.answer, at, lands: at + FLIGHT };
  }),
  { kind: 'examMapping', cost: LIST_CHECK_COST, at: PRO_TIMES.listChip, lands: PRO_TIMES.listChip + FLIGHT },
  { kind: 'conversation', cost: AI_COSTS.conversation, at: PRO_TIMES.talkChip, lands: PRO_TIMES.talkChip + FLIGHT },
];

/** What the PRO day has left after all that. */
export const PRO_LEFT = PRO_DAILY_UNITS - PRO_SPENDS.reduce((sum, spend) => sum + spend.cost, 0);

/** Units spent by scene time `l` (a chip counts once it has landed). */
export function spentBy(spends: readonly Spend[], l: number): number {
  return spends.reduce((sum, spend) => (l >= spend.lands ? sum + spend.cost : sum), 0);
}

/** The meter's number at scene time `l` of the free day. */
export function freeMeterAt(l: number): number {
  return Math.max(0, FREE_DAILY_UNITS - spentBy(FREE_SPENDS, l));
}

/** How full the PRO meter is at scene time `l` (0 → 1, easing out). */
export function proFill(l: number): number {
  const p = Math.min(1, Math.max(0, (l - PRO_TIMES.fill) / PRO_TIMES.fillFor));
  return 1 - Math.pow(1 - p, 3);
}

/** The meter's number at scene time `l` of the PRO beat: it starts empty, fills, then is spent. */
export function proMeterAt(l: number): number {
  return Math.max(0, Math.round(PRO_DAILY_UNITS * proFill(l)) - spentBy(PRO_SPENDS, l));
}

// ---------------------------------------------------------------------------------------------
// The script: scenes, the still frame, the corner mark, and the words for screen readers.

const seconds = Math.round(PRO_TOTAL / 1000);
const units = (n: number) => `${n} ${plural(n, ['единица', 'единицы', 'единиц'])}`;

export const PRO_REEL: AuthScript = {
  total: PRO_TOTAL,
  scenes: SCENES,
  // The PRO beat: the meter just filled to the PRO day, the tickets waiting; nothing in flight.
  poster: sceneOf('pro').from + PRO_TIMES.tickets - 150,
  // The small «Meldy» in the corner, until the big wordmark of the last beat.
  corner: [600, sceneOf('end').from + 1500],
  caption: `Ролик: что будет с PRO, ${seconds} ${plural(seconds, ['секунда', 'секунды', 'секунд'])}, без звука.`,
  transcript: [
    'Сессия. Сто вопросов к экзамену.',
    `Бесплатно — ${units(FREE_DAILY_UNITS)} ИИ в день. Лекция: минус ${AI_COSTS.lecture}, ответ: минус ${AI_COSTS.answer}. Счётчик доходит до ${FREE_LEFT}: «Дневной лимит исчерпан».`,
    `С PRO — ${units(PRO_DAILY_UNITS)} в день: билет за билетом проверяется, список из ${SESSION_QUESTIONS} вопросов сверяется с лекциями, играет разговор, а на счётчике ещё ${PRO_LEFT}.`,
    'Готовьтесь, сколько нужно. Meldy.',
  ],
};
