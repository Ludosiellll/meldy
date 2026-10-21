/**
 * The phone's words in «Встань на ответ» (docs/live/MODE_STAND.md §8) and the small facts the screens show. Plain
 * words: one short sentence per thought, numbers first, no exclamation marks, no own terms. Comments stay in English.
 */
import type { StandLast, StandMe, StandState } from '../../../../lib/live/move/protocol';
import type { UnlockId } from '../../../../lib/live/types';
import { NBSP, nb, plural } from '../../player/copy';

export const TITLE = 'Встань на ответ';

/** Zone index = option index: the letters and the floor colours of the projector's arena (lib/live/three/internal/arena.ts). */
export const LETTERS = ['А', 'Б', 'В', 'Г'] as const;
export const ZONE_COLOURS = ['#ff6f61', '#4d8dff', '#ffc531', '#36c47c'] as const;

export const points = (n: number) => `${nb(n)}${NBSP}${plural(n, 'очко', 'очка', 'очков')}`;
/** «4 место из 24». */
export const placeLine = (place: number, of: number) => `${place}${NBSP}место из ${of}`;
/** «3 верных подряд» (only from 2). */
export const streakLine = (n: number) => `${n}${NBSP}${plural(n, 'верный', 'верных', 'верных')} подряд`;
export const playersLine = (n: number) => `${plural(n, 'Играет', 'Играют', 'Играют')} ${n}`;

/** Where the own character stands: a live zone, a closed one (fewer options than zones), or none. */
export function zoneLine(zone: number, options: number): string {
  if (zone < 0) return 'Бегите к ответу';
  if (zone >= options) return 'Здесь нет ответа';
  return `Вы на ${LETTERS[zone]}`;
}

export type Tone = 'ok' | 'bad' | 'ghost' | 'seen';

export interface Outcome {
  tone: Tone;
  title: string;
  /** «+620», or null. */
  big: string | null;
  lines: string[];
}

/**
 * The reveal's sheet from the room's `me.last` (§4.3): right, wrong (the fall), a ghost on the right answer, a late
 * joiner. A ghost's wrong answer is no new fall (`fell` false): it stays a ghost.
 */
export function outcomeOf(last: StandLast, streak: number): Outcome {
  if (last.late) return { tone: 'seen', title: 'Вы зашли позже', big: null, lines: ['Этот вопрос не считаем.'] };
  if (last.ok && last.revived) return { tone: 'ghost', title: 'Призрак на верном ответе', big: `+${nb(last.pts)}`, lines: ['Скоро вернётесь.'] };
  if (last.ok) return { tone: 'ok', title: 'Верно', big: `+${nb(last.pts)}`, lines: streak >= 2 ? [streakLine(streak)] : [] };
  const what = last.choice === null ? 'Вы не встали на ответ' : 'Мимо';
  if (last.fell) return { tone: 'bad', title: what, big: null, lines: ['Теперь вы призрак.', 'Встаньте на верный ответ, и вы вернётесь.'] };
  return { tone: 'bad', title: what, big: null, lines: ['Вы пока призрак.', 'Встаньте на верный ответ, и вы вернётесь.'] };
}

/** The own result of the question in this state, once the room has sent it (`me` can come a moment after `state`). */
export function lastFor(state: StandState | null, me: StandMe | null): StandLast | null {
  if (!state || state.phase !== 'reveal' || !state.res || !me?.last) return null;
  return me.last.qi === state.res.qi ? me.last : null;
}

/** A wardrobe part this game opened (`final.unlocked_now`): what it is and why, in this mode's words. */
export const OPENED: Record<UnlockId, { title: string; why: string }> = {
  crown: { title: 'Вы открыли корону', why: 'За место в тройке.' },
  grad: { title: 'Вы открыли шапочку выпускника', why: 'За 10 игр.' },
  horns: { title: 'Вы открыли рожки', why: 'Вы 3 раза вернулись из призраков.' },
  graphite: { title: 'Вы открыли графитовый цвет', why: 'За 5 верных ответов подряд.' },
  snow: { title: 'Вы открыли белый цвет', why: 'За 5 побед над Дедлайном.' },
};

/** Seconds left on the big timer: from the room's clock, never the device's; the full time until the question opens. */
export function secondsLeft(closes: number | null, nowRoom: number | null, timeS: number): number {
  if (closes === null || nowRoom === null) return timeS;
  return Math.max(0, Math.min(timeS, Math.ceil((closes - nowRoom) / 1000)));
}
