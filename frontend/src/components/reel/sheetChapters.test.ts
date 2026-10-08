/**
 * The sheet of the film against its own clock: the rubs at the words that name the points, the three
 * days of answers, and the one beat where a line comes back (nothing else moves in it).
 */
import { describe, expect, it } from 'vitest';
import { inkAt, statesAt } from '../film/ink';
import { DAYS, NOTES, RUB_LAG, TICKET, namedAt, wordAt } from './content';
import { POINT_LINES } from './paper/Blocks';
import { SCHEDULE as S } from './paper/schedule';

const tokens = (turn: number) => TICKET.turns[turn].text.split(' ');

describe('the answer and the sheet share one clock', () => {
  it('names the first point at the word that completes its key words, and rubs its line 60 ms after that word', () => {
    expect(tokens(0)[7]).toBe('количество');
    expect(namedAt(0)).toBe(wordAt(0, 7));
    expect(S.rub).toBe(wordAt(0, 7) + RUB_LAG);
    expect(S.rub - wordAt(0, 7)).toBeLessThanOrEqual(150);
  });

  it('marks the point named after the examiner’s question at its word, within 150 ms', () => {
    expect(tokens(2)[3]).toBe('повысить');
    expect(S.lateMiss - wordAt(2, 3)).toBeGreaterThanOrEqual(0);
    expect(S.lateMiss - wordAt(2, 3)).toBeLessThanOrEqual(150);
  });

  it('lets the answers finish before the sheet marks the points they did not name', () => {
    const answerEnd = TICKET.turns[2].at + tokens(2).length * TICKET.turns[2].wordMs;
    expect(S.missB).toBeGreaterThan(answerEnd);
    expect(S.missD).toBeGreaterThan(answerEnd);
    expect(S.count.at).toBeGreaterThan(answerEnd);
  });

  it('writes the three answers’ dates in order, one at a time', () => {
    expect(S.dates.map((date) => date.text)).toEqual([DAYS.first, DAYS.second, DAYS.third]);
    expect(S.dates.map((date) => date.at)).toEqual([...S.dates.map((date) => date.at)].sort((a, b) => a - b));
    expect(S.dates[0].until).toBe(S.dates[1].at);
    expect(S.dates[1].until).toBe(S.dates[2].at);
  });
});

describe('the cheat sheet over three days', () => {
  it('rubs only the point named in the first answer; the others are missed, with their notes', () => {
    expect(statesAt(POINT_LINES, 31000)).toEqual(['rubbed', 'fresh', 'missed', 'fresh']);
    expect(statesAt(POINT_LINES, 32500)).toEqual(['rubbed', 'missed', 'missed', 'missed']);
    expect(inkAt(POINT_LINES[1], 32500).note).toBe(NOTES.notNamed);
    expect(inkAt(POINT_LINES[2], 30500).note).toBe(NOTES.afterQuestion);
    expect(inkAt(POINT_LINES[3], 32500).note).toBe(NOTES.notNamed);
  });

  it('erases exactly one line on the second answer', () => {
    expect(statesAt(POINT_LINES, 38000)).toEqual(['erased', 'missed', 'missed', 'missed']);
    const erasing = inkAt(POINT_LINES[0], 37000);
    expect(erasing.move).toBe('erase');
    expect(erasing.p).toBeGreaterThan(0);
    expect(erasing.p).toBeLessThan(1);
  });

  it('brings the erased line back in ink on the third answer, with its note, and changes nothing else', () => {
    const back = inkAt(POINT_LINES[0], 40500);
    expect(back.state).toBe('returned');
    expect(back.note).toBe(NOTES.returned);
    expect(statesAt(POINT_LINES, 40500)).toEqual(['returned', 'missed', 'missed', 'missed']);
    // The beat: from the third answer to the end of the return, the other lines stay still.
    for (let t = S.returnAt; t <= S.returnAt + 1600; t += 100) {
      for (const index of [1, 2, 3]) expect(inkAt(POINT_LINES[index], t).move).toBeNull();
    }
  });
});
