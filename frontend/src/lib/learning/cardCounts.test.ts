import { describe, expect, it } from 'vitest';
import { dueLine, dueToday, laterTodayWords, originPhrase, originSplit, sessionTotalWords, waitingNowWords } from './cardCounts';

describe('card counts (decision 4)', () => {
  it('tells the cards of a lecture from the cards of ticket answers', () => {
    const split = originSplit([{ origin: 'analysis' }, { origin: null }, {}, { origin: 'oral_followup' }]);
    expect(split).toEqual({ total: 4, lecture: 3, answers: 1 });
    expect(originPhrase({ total: 10, lecture: 6, answers: 4 }, 'one')).toBe('6 из лекции, 4 из ответов на билеты');
    expect(originPhrase({ total: 26, lecture: 18, answers: 8 }, 'many')).toBe('18 из лекций, 8 из ответов на билеты');
    expect(originPhrase({ total: 2, lecture: 0, answers: 2 }, 'one')).toBe('2 из ответов на билеты');
    // Nothing to tell apart: no words at all.
    expect(originPhrase({ total: 6, lecture: 6, answers: 0 }, 'one')).toBe('');
  });

  it('counts the cards due now and the ones that come later today', () => {
    const now = new Date(2026, 9, 8, 15, 0, 0);
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0).toISOString();
    const cards = [
      { next_review: at(6, 9) },
      { next_review: at(8, 14) },
      { next_review: at(8, 15) },
      { next_review: at(8, 21) },
      { next_review: at(8, 23) },
      { next_review: at(9, 0) },
      { next_review: null },
      { next_review: 'garbage' },
    ];
    expect(dueToday(cards, now)).toEqual({ now: 3, later: 2 });
  });

  it('says when the due cards wait: «24 ждут сейчас · ещё 2 — позже сегодня»', () => {
    expect(dueLine(24, 2)).toBe('24 карточки ждут сейчас · ещё 2 — позже сегодня');
    expect(dueLine(1, 0)).toBe('1 карточка ждёт сейчас');
    expect(dueLine(5, 0)).toBe('5 карточек ждут сейчас');
    expect(dueLine(0, 2)).toBe('сейчас повторять нечего · 2 карточки — позже сегодня');
    expect(dueLine(0, 0)).toBe('сейчас повторять нечего');
    expect(waitingNowWords(21)).toBe('карточка ждёт сейчас');
    expect(laterTodayWords(0, true)).toBe('');
    expect(laterTodayWords(1, false)).toBe('1 карточка — позже сегодня');
  });

  it('names the day’s total in a session only when it is more than the session holds', () => {
    expect(sessionTotalWords(20, 24)).toBe('всего на сегодня 24');
    expect(sessionTotalWords(20, 20)).toBe('');
    expect(sessionTotalWords(12, 12)).toBe('');
    expect(sessionTotalWords(20, null)).toBe('');
  });
});
