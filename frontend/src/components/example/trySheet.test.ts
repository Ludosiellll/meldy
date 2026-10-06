import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSheet } from '../../lib/exams/cheatSheet';
import { namedPoints } from '../../lib/oral/rubricMatch';
import { EXAMPLE_QUESTIONS, exampleQuestion, exampleRubric } from '../../data/example';
import {
  EXAMPLE_ANSWER_Q5,
  SEEDED_ANSWERS,
  TRY_SHEET_KEY,
  answerEvents,
  exampleHash,
  readTryStore,
  restartTry,
  saveTryAnswer,
  setTryPeak,
  takeTryPeak,
  tryEvents,
  trySheetQuestions,
  type TryAnswer,
} from './trySheet';

const NOW = new Date(2026, 9, 4, 10, 5).getTime();
const HOUR = 3_600_000;

function guestAnswer(at: number, session = 'try-a'): TryAnswer {
  return { session, questionId: 'q5', at, transcript: EXAMPLE_ANSWER_Q5, statuses: { p1: 'covered' }, followup: null };
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => window.sessionStorage.clear());

function pointsOf(id: string) {
  return exampleRubric(exampleQuestion(id)!)!.points;
}

describe('the example’s cheat sheet', () => {
  it('writes every point of the example with a hand-written line: shorter than its title, at most 56 signs', () => {
    const questions = trySheetQuestions();
    expect(questions).toHaveLength(12);
    expect(questions.filter((question) => question.rubric)).toHaveLength(11);
    for (const question of questions) {
      expect(question.question_hash).toMatch(/^[0-9a-f]{32}$/);
      for (const point of question.rubric?.points ?? []) {
        expect(point.short.length, point.title).toBeGreaterThan(0);
        expect(point.short.length, point.short).toBeLessThanOrEqual(56);
        expect(point.short.length, point.short).toBeLessThan(point.title.length);
      }
    }
    expect(new Set(EXAMPLE_QUESTIONS.map((question) => exampleHash(question.id))).size).toBe(12);
  });

  it('yesterday’s answers name exactly their points by the example’s key words', () => {
    for (const seed of SEEDED_ANSWERS) {
      expect(namedPoints(pointsOf(seed.questionId), seed.transcript).sort()).toEqual([...seed.named].sort());
    }
    // «Вставить ответ примера»: the three main points of question 5 and its sign, not the extreme cases.
    expect(namedPoints(pointsOf('q5'), EXAMPLE_ANSWER_Q5).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('seeds yesterday at this very time a day ago, once per tab, and keeps the guest’s answers', () => {
    const store = readTryStore(NOW);
    expect(store.seededAt).toBe(NOW);
    // Question 1 is on the first screen of every size; 5 is the one the caption asks to answer.
    expect(store.answers.map((answer) => [answer.questionId, NOW - answer.at])).toEqual([
      ['q1', 86_400_000],
      ['q5', 86_400_000],
      ['q9', 86_400_000],
    ]);
    // Read again later in the tab: the same yesterday.
    expect(readTryStore(NOW + HOUR).seededAt).toBe(NOW);
    const answer = guestAnswer(NOW + 60_000);
    saveTryAnswer(answer);
    saveTryAnswer(answer);
    expect(readTryStore(NOW + 120_000).answers.filter((item) => item.session === 'try-a')).toHaveLength(1);
    // A broken store is seeded anew, not thrown at the page.
    window.sessionStorage.setItem(TRY_SHEET_KEY, '{"v":1,"seededAt":"x"');
    expect(readTryStore(NOW).answers).toHaveLength(3);
    // Moments far ahead (a forged 1e20 would throw in toISOString) are dropped.
    window.sessionStorage.setItem(TRY_SHEET_KEY, JSON.stringify({ v: 1, seededAt: NOW, answers: [guestAnswer(1e20)], peeks: [{ questionId: 'q5', pointId: 'p1', at: 1e20 }] }));
    const forged = readTryStore(NOW);
    expect(forged.answers).toHaveLength(0);
    expect(forged.peeks).toHaveLength(0);
  });

  it('a tab kept to another day starts the example again, so «вчера» stays true; a visit across midnight does not', () => {
    readTryStore(NOW);
    saveTryAnswer(guestAnswer(NOW + 60_000));
    // The same evening: the guest's answer is kept.
    expect(readTryStore(NOW + 10 * HOUR).answers).toHaveLength(4);
    // The next morning: a new example, yesterday's answers a day before now.
    const next = NOW + 24 * HOUR;
    const store = readTryStore(next);
    expect(store.seededAt).toBe(next);
    expect(store.answers.map((answer) => answer.session)).toEqual(['try-seed-q1', 'try-seed-q5', 'try-seed-q9']);
    // 23:30 → 0:30 is another day but an hour only: the example goes on.
    window.sessionStorage.clear();
    const late = new Date(2026, 9, 4, 23, 30).getTime();
    readTryStore(late);
    expect(readTryStore(late + HOUR).seededAt).toBe(late);
  });

  it('«Начать пример заново»: yesterday’s answers again; the guest’s answers and the after-answer flag are gone', () => {
    readTryStore(NOW);
    saveTryAnswer(guestAnswer(NOW + 60_000));
    setTryPeak('q5');
    const store = restartTry(NOW + 120_000);
    expect(store.seededAt).toBe(NOW + 120_000);
    expect(store.answers.map((answer) => answer.session)).toEqual(['try-seed-q1', 'try-seed-q5', 'try-seed-q9']);
    expect(store.answers.every((answer) => answer.at === NOW + 120_000 - 24 * HOUR)).toBe(true);
    expect(takeTryPeak()).toBeNull();
  });

  it('rubs the lines of yesterday’s answers and erases the ones named again today', () => {
    const store = readTryStore(NOW);
    const questions = trySheetQuestions();
    const before = buildSheet(questions, tryEvents(store), NOW);
    const q5 = (sheet: typeof before) => sheet.blocks.find((block) => block.questionId === 'q5')!.lines.map((line) => line.status.state);
    expect(q5(before)).toEqual(['rubbed', 'rubbed', 'rubbed', 'missed', 'missed']);
    const today = saveTryAnswer({
      session: 'try-today',
      questionId: 'q5',
      at: NOW,
      transcript: EXAMPLE_ANSWER_Q5,
      statuses: { p1: 'covered', p2: 'covered', p3: 'covered', p4: 'covered', p5: 'missing' },
      followup: null,
    });
    const after = buildSheet(questions, tryEvents(today), NOW + 1000);
    expect(q5(after)).toEqual(['erased', 'erased', 'erased', 'rubbed', 'missed']);
    expect(after.blocks.find((block) => block.questionId === 'q5')!.learned).toBe(true);
    const guest = today.answers.find((answer) => answer.session === 'try-today')!;
    expect(answerEvents(guest).map((event) => event.payload)).toEqual(
      pointsOf('q5').map((point, index) =>
        expect.objectContaining({ question_hash: exampleHash('q5'), point_id: `p${index + 1}`, title: point.title, status: index < 4 ? 'covered' : 'missing' }),
      ),
    );
  });
});
