import { describe, expect, it } from 'vitest';
import {
  answerForms,
  closesAfter,
  QUICK_DEFAULTS,
  quickInputs,
  quickPreset,
  quickQuestions,
  quickQuizSettings,
  readyOf,
  tapOption,
} from './quickModel';
import { bankItem, bankResult, CHEMISTRY } from './testkit';

/* «Быстрая контрольная» without React: the parse of pasted text as the teacher's questions, taps, saving, settings. */

describe('quickQuestions', () => {
  it('turns the parse into the questions of the контрольная: keyed, short, and the one without its answer', () => {
    const list = quickQuestions(CHEMISTRY);
    expect(list.map((q) => [q.number, q.kind, q.state, q.correct, q.answers])).toEqual([
      [1, 'single', 'ok', [1], []],
      [2, 'single', 'ok', [1], []],
      [3, 'short', 'ok', [], ['2']],
      [4, 'single', 'no_key', [], []],
    ]);
    expect(list[0].options).toEqual(['фенолфталеин', 'лакмус', 'метилоранж']);
    expect(readyOf(list)).toHaveLength(3);
  });

  it('a question with neither variants nor an answer cannot be saved, and says so', () => {
    const [question] = quickQuestions(bankResult([bankItem({ text: 'Расскажите о кислотах.' })]));
    expect(question.state).toBe('blocked');
    expect(question.kind).toBe('none');
    expect(quickInputs([question])).toEqual([]);
  });

  it('one variant only is not a question with variants', () => {
    const [question] = quickQuestions(bankResult([bankItem({ text: 'Вопрос?', options: ['да'], correct: [0] })]));
    expect(question.state).toBe('blocked');
  });

  it('a question asked twice keeps two keys', () => {
    const twice = bankItem({ text: 'Сколько будет 2 + 2?', options: ['3', '4'], correct: [1] });
    const list = quickQuestions(bankResult([twice, twice]));
    expect(new Set(list.map((q) => q.key)).size).toBe(2);
  });

  it('nothing parsed yet: no questions', () => {
    expect(quickQuestions(null)).toEqual([]);
  });
});

describe('tapOption', () => {
  it('a tap marks the right variant of a question without its answer, and the tap outlives the next parse', () => {
    const list = quickQuestions(CHEMISTRY);
    const taps = tapOption({}, list[3], 0);
    const again = quickQuestions(bankResult([...CHEMISTRY.items]), taps);
    expect(again[3]).toMatchObject({ state: 'ok', correct: [0], tapped: true });
    expect(readyOf(again)).toHaveLength(4);
  });

  it('a tap on another variant of a one-answer question moves the answer there', () => {
    const list = quickQuestions(CHEMISTRY);
    const moved = quickQuestions(CHEMISTRY, tapOption({}, list[0], 2));
    expect(moved[0].correct).toEqual([2]);
    expect(moved[0].kind).toBe('single');
  });

  it('a question of several answers adds and takes away variants', () => {
    const several = bankResult([bankItem({ text: 'Чётные числа?', options: ['2', '3', '4'], correct: [0, 2], kind: 'multiple' })]);
    const [question] = quickQuestions(several);
    expect(question.kind).toBe('multiple');
    const less = quickQuestions(several, tapOption({}, question, 2));
    expect(less[0].correct).toEqual([0]);
    const more = quickQuestions(several, tapOption({}, less[0], 1));
    expect(more[0].correct).toEqual([0, 1]);
  });

  it('a tap on a short answer changes nothing', () => {
    const list = quickQuestions(CHEMISTRY);
    expect(tapOption({}, list[2], 0)).toEqual({});
  });

  it('a changed question loses its tap (the tap is kept by the question’s words)', () => {
    const list = quickQuestions(CHEMISTRY);
    const taps = tapOption({}, list[3], 0);
    const edited = bankResult([bankItem({ text: 'Какая кислота есть в желудке человека?', options: ['соляная', 'уксусная', 'лимонная'] })]);
    expect(quickQuestions(edited, taps)[0].state).toBe('no_key');
  });
});

describe('quickInputs', () => {
  it('saves every question that can be saved, keyed or not, with refs in order', () => {
    const list = quickQuestions(CHEMISTRY, tapOption({}, quickQuestions(CHEMISTRY)[0], 0));
    const inputs = quickInputs(list, 'imp-x');
    expect(inputs.map((input) => input.ref)).toEqual(['imp-x:1', 'imp-x:2', 'imp-x:3', 'imp-x:4']);
    expect(inputs[0]).toMatchObject({ stem: 'Какой индикатор краснеет в кислой среде?', correct: [0], kind: 'single', key_source: 'manual' });
    expect(inputs[1]).toMatchObject({ correct: [1], key_source: 'answer_line' });
    expect(inputs[2]).toEqual({ ref: 'imp-x:3', stem: 'Сколько атомов водорода в молекуле воды?', options: [], correct: [], answers: ['2'], kind: 'short', key_source: 'answer_line' });
    expect(inputs[3]).toMatchObject({ correct: [], key_source: 'none' });
    expect(inputs[3].flags).toContain('no_key');
    expect(inputs[0].flags).not.toContain('no_key');
  });
});

describe('answerForms', () => {
  it('splits an answer line by «;» and refuses forms the database would not take', () => {
    expect(answerForms('2; два')).toEqual(['2', 'два']);
    expect(answerForms('  Париж ')).toEqual(['Париж']);
    expect(answerForms(null)).toEqual([]);
    expect(answerForms('а'.repeat(201))).toEqual([]);
    expect(answerForms(Array.from({ length: 11 }, (_, n) => String(n)).join(';'))).toEqual([]);
  });
});

describe('the settings', () => {
  const now = new Date(2026, 9, 21, 10, 30);

  it('by default: without signing in, no timer, open seven days to 23:59, one attempt, every question in order', () => {
    const settings = quickQuizSettings('Кислоты, 9 Б', 'subject-1', 3, QUICK_DEFAULTS, now);
    expect(settings).toMatchObject({
      title: 'Кислоты, 9 Б',
      subject_ids: ['subject-1'],
      item_count: 3,
      same_set: true,
      shuffle_items: false,
      time_limit_min: null,
      opens_at: null,
      attempts: 1,
      guests: true,
      members_only: false,
    });
    const closes = new Date(settings.closes_at as string);
    expect([closes.getDate(), closes.getMonth(), closes.getHours(), closes.getMinutes()]).toEqual([28, 9, 23, 59]);
  });

  it('the pills change what they say', () => {
    const settings = quickQuizSettings('Т', 's', 5, { who: 'link', minutes: 20, days: null, attempts: null }, now);
    expect(settings).toMatchObject({ guests: false, time_limit_min: 20, closes_at: null, attempts: null });
  });

  it('«Ещё настройки» hands the full form only what the pills decide', () => {
    expect(quickPreset({ who: 'guests', minutes: 15, days: 1, attempts: 2 }, now)).toEqual({
      time_limit_min: 15,
      closes_at: closesAfter(1, now),
      attempts: 2,
      guests: true,
      members_only: false,
    });
  });
});
