import { describe, expect, it } from 'vitest';
import topicsSource from './topics.ts?raw';
import type { PlanItem, UnitState } from '../../types/container';
import {
  buildTopics,
  closedFoldLine,
  closedSince,
  countWords,
  howLines,
  learnLeftLine,
  nearLine,
  oralStateLine,
  outLines,
  parseLearnLeft,
  readyNow,
  tally,
  topicChange,
  topicRowLine,
  topicsLeftLine,
  withResults,
  type LearnLeftExam,
  type LearnLeftQuestion,
} from './topics';

const S = 'subject-1';
/** The words with plain spaces (the app glues numbers to their words with a no-break space). */
const plain = (value: string) => value.replace(/\u00a0/g, ' ');
const DAY = 86_400_000;

function unit(step: 'none' | 'started' | 'done', at = Date.UTC(2026, 9, 19, 10)): UnitState {
  return {
    seen: step === 'none' ? 0 : 1,
    wrong: 0,
    firstDay: step === 'none' ? null : '2026-10-18',
    lastDay: step === 'none' ? null : '2026-10-19',
    seriesAt: step === 'started' ? at : null,
    seriesDay: step === 'started' ? '2026-10-19' : null,
    twoDaysAt: step === 'done' ? at : null,
    namedAt: step === 'done' ? at : null,
    checks: 0,
    peekDay: null,
    wasTwoDays: false,
    cleanOkAt: null,
  };
}

/** `counts[i]` questions in topic i + 1, in file order; `steps` by position. */
function items(counts: Array<number | null>, steps: Record<number, 'started' | 'done'> = {}): PlanItem[] {
  const out: PlanItem[] = [];
  let pos = 0;
  counts.forEach((count, index) => {
    const n = count ?? 0;
    for (let i = 0; i < n; i += 1) {
      pos += 1;
      out.push({ id: `t${pos}`, s: S, f: 't', tp: count === null ? null : index + 1, o: pos, u: unit(steps[pos] ?? 'none') });
    }
  });
  return out;
}

function loose(n: number): PlanItem[] {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, s: S, f: 't' as const, tp: null, o: i + 1, u: unit('none') }));
}

function oralQ(position: number, extra: Partial<LearnLeftQuestion> = {}): LearnLeftQuestion {
  return {
    id: `q${position}`, position, label: String(position), section: null, lecture: null, kind: 'lines', state: 0, named: 0, of: 3,
    learnedAt: null, readyAt: null, missed: false, ...extra,
  };
}

function exam(questions: LearnLeftQuestion[], extra: Partial<LearnLeftExam> = {}): LearnLeftExam {
  return { examId: 'exam-1', title: 'Базы данных', mappingState: 'done', lectures: [], sectionTitles: [], toWrite: 0, units: 0, questions, ...extra };
}

/** Account B's «Базы данных»: 20 questions, three lectures, 8 and 16 in none. */
function databases(): LearnLeftExam {
  const lecture = (p: number) => (p <= 6 ? 0 : [7, 9, 10, 11, 12, 19].includes(p) ? 1 : 2);
  return exam(
    Array.from({ length: 20 }, (_, i) => {
      const p = i + 1;
      if (p === 8 || p === 16) return oralQ(p, { kind: 'none', of: 0 });
      return oralQ(p, { lecture: lecture(p), state: p <= 6 ? 3 : p === 10 ? 2 : p === 13 ? 1 : 0, learnedAt: p <= 6 ? Date.UTC(2026, 9, 19) : null });
    }),
    {
      lectures: [
        { id: 'l1', title: 'Реляционная модель данных: ключи и связи' },
        { id: 'l2', title: 'Язык SQL: выборка данных и оператор SELECT' },
        { id: 'l3', title: 'Нормализация отношений и свойства транзакций ACID' },
      ],
    },
  );
}

describe('test topics', () => {
  it('B\'s autumn session: 12 topics of 20 by the file\'s titles, in file order', () => {
    const titles = Array.from({ length: 12 }, (_, i) => `Тема 1.${i + 1}. Раздел ${i + 1}`);
    const list = buildTopics({ subjectId: S, items: items(Array(12).fill(20)), titles });
    expect(list.kind).toBe('test');
    expect(list.sources).toEqual(['file']);
    expect(list.topics.map((t) => t.questions.length)).toEqual(Array(12).fill(20));
    expect(list.topics[1].title).toBe('Тема 1.2. Раздел 2');
    expect(list.topics[1].testTopic).toBe(2);
    expect(tally(list.topics)).toMatchObject({ total: 12, left: 12, begun: false });
  });

  it('a topic of 87 splits into 4 parts of up to 25, equal as can be; 30 stays whole, 31 splits', () => {
    const list = buildTopics({ subjectId: S, items: items([87, 30, 31]), titles: ['Проверка картинок 44.17', 'Тридцать', 'Тридцать один'] });
    const sizes = list.topics.map((t) => t.questions.length);
    expect(sizes).toEqual([22, 22, 22, 21, 30, 16, 15]);
    expect(list.topics.map((t) => t.title).slice(0, 4)).toEqual([
      'Проверка картинок 44.17, часть 1 из 4',
      'Проверка картинок 44.17, часть 2 из 4',
      'Проверка картинок 44.17, часть 3 из 4',
      'Проверка картинок 44.17, часть 4 из 4',
    ]);
    expect(list.topics[3].part).toEqual({ n: 4, of: 4 });
    expect(new Set(list.topics.map((t) => t.key)).size).toBe(list.topics.length);
  });

  it('no topics: blocks of 20 in file order', () => {
    const list = buildTopics({ subjectId: S, items: loose(45), titles: [] });
    expect(list.sources).toEqual(['blocks']);
    expect(list.topics.map((t) => t.title)).toEqual(['Вопросы 1–20', 'Вопросы 21–40', 'Вопросы 41–45']);
    expect(list.topics.every((t) => t.testTopic === null)).toBe(true);
  });

  it('one topic that is the whole subject and too big: blocks; a small one stays a topic', () => {
    expect(buildTopics({ subjectId: S, items: items([40]), titles: ['Информатика'] }).topics.map((t) => t.questions.length)).toEqual([20, 20]);
    const small = buildTopics({ subjectId: S, items: items([14]), titles: ['Информатика'] });
    expect(small.topics.map((t) => t.title)).toEqual(['Информатика']);
  });

  it('questions without a topic beside topics go in blocks named by their numbers', () => {
    const list = buildTopics({ subjectId: S, items: items([3, null]).concat(loose(0)), titles: ['Первая'] });
    expect(list.topics.map((t) => t.title)).toEqual(['Первая']);
    const mixed: PlanItem[] = [...items([3]), { id: 'x9', s: S, f: 't', tp: null, o: 9, u: unit('none') }];
    expect(buildTopics({ subjectId: S, items: mixed, titles: ['Первая'] }).topics.map((t) => plain(t.title))).toEqual(['Первая', 'Вопрос 9']);
  });

  it('partial progress: learned, started, not yet; a due check stays learned', () => {
    const list = buildTopics({ subjectId: S, items: items([20], { 1: 'done', 2: 'done', 3: 'started' }), titles: ['Тема'] });
    const [topic] = list.topics;
    expect(topic.questions.slice(0, 4).map((q) => q.step)).toEqual(['done', 'done', 'started', 'none']);
    expect(plain(topicRowLine(topic))).toBe('Осталось 18 вопросов из 20');
    // Long after its two days (its check is due): still learned.
    const old = buildTopics({ subjectId: S, items: [{ id: 'a', s: S, f: 't', tp: 1, o: 1, u: unit('done', Date.now() - 90 * DAY) }], titles: ['Тема'] });
    expect(tally(old.topics).closed).toHaveLength(1);
  });

  it('a topic not begun says so', () => {
    const [topic] = buildTopics({ subjectId: S, items: items([20]), titles: ['Тема'] }).topics;
    expect(plain(topicRowLine(topic))).toBe('20 вопросов, ещё не начинали');
  });

  it('leaves out other subjects and oral items', () => {
    const own = items([5]);
    const other: PlanItem[] = [{ id: 'z', s: 'other', f: 't', tp: 1, o: 1, u: unit('none') }, { id: 'o', s: S, f: 'o', tp: 1, o: 2 }];
    expect(buildTopics({ subjectId: S, items: [...own, ...other], titles: ['Тема'] }).topics[0].questions).toHaveLength(5);
  });
});

describe('oral topics', () => {
  it('B\'s «Базы данных» by lecture: three topics, 8 and 16 not counted', () => {
    const list = buildTopics({ oral: databases() });
    expect(list.kind).toBe('oral');
    expect(list.sources).toEqual(['lectures']);
    expect(list.topics.map((t) => t.title)).toEqual([
      'Реляционная модель данных: ключи и связи',
      'Язык SQL: выборка данных и оператор SELECT',
      'Нормализация отношений и свойства транзакций ACID',
    ]);
    expect(list.topics.map((t) => t.questions.map((q) => q.n).join(','))).toEqual(['1,2,3,4,5,6', '7,9,10,11,12,19', '13,14,15,17,18,20']);
    expect(list.out.map((q) => q.n)).toEqual(['8', '16']);
    expect(outLines(list.out).map((l) => ({ ...l, text: plain(l.text) }))).toEqual([{ reason: 'none', text: 'Вопросы 8 и 16 не считаем, их нет в лекциях.' }]);
    const t = tally(list.topics);
    expect(t).toMatchObject({ total: 3, left: 2, begun: true });
    expect(t.closed[0].title).toBe('Реляционная модель данных: ключи и связи');
    expect(list.topics[1].questions.find((q) => q.n === '10')?.step).toBe('started');
  });

  it('the department\'s sections come first', () => {
    const list = buildTopics({ oral: exam([oralQ(1, { section: 1, lecture: 0 }), oralQ(2, { section: 2, lecture: 0 }), oralQ(3, { section: 1 })], {
      sectionTitles: ['Модели', 'Запросы'], lectures: [{ id: 'l', title: 'Лекция' }] }) });
    expect(list.sources).toEqual(['sections']);
    expect(list.topics.map((t) => `${t.title}:${t.questions.length}`)).toEqual(['Модели:2', 'Запросы:1']);
  });

  it('lectures that give many tiny topics give way to blocks of 10', () => {
    const lectures = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, title: `Лекция ${i}` }));
    const qs = Array.from({ length: 20 }, (_, i) => oralQ(i + 1, { lecture: i % 10 }));
    const list = buildTopics({ oral: exam(qs, { lectures }) });
    expect(list.sources).toEqual(['oral_blocks']);
    expect(list.topics.map((t) => t.title)).toEqual(['Вопросы 1–10', 'Вопросы 11–20']);
  });

  it('an oral topic over 12 splits into parts of up to 10', () => {
    const qs = Array.from({ length: 25 }, (_, i) => oralQ(i + 1, { section: 1 }));
    const list = buildTopics({ oral: exam(qs, { sectionTitles: ['Один раздел'] }) });
    expect(list.topics.map((t) => t.questions.length)).toEqual([9, 8, 8]);
    expect(list.topics[0].title).toBe('Один раздел, часть 1 из 3');
  });

  it('no lectures: no topics, the card asks for lectures', () => {
    const list = buildTopics({ oral: exam([oralQ(1, { kind: 'unmapped' }), oralQ(2, { kind: 'unmapped' })]) });
    expect(list.topics).toEqual([]);
    expect(list.noLectures).toBe(true);
  });

  it('questions in the plan without points count; their state says so', () => {
    const list = buildTopics({ oral: exam([oralQ(1, { kind: 'unwritten', of: 0 }), oralQ(2, { lecture: 0 })], { lectures: [{ id: 'l', title: 'Лекция' }] }) });
    expect(list.unwritten).toBe(1);
    expect(list.topics.flatMap((t) => t.questions)).toHaveLength(2);
    const q = list.topics.flatMap((t) => t.questions).find((x) => x.id === 'q1')!;
    expect(plain(oralStateLine(q, 0))).toBe('Пунктов ответа пока нет.');
  });

  it('an oral question\'s words follow its state', () => {
    const at = Date.UTC(2026, 9, 21, 12);
    const one = (extra: Partial<LearnLeftQuestion>) => buildTopics({ oral: exam([oralQ(1, { section: 1, ...extra })], { sectionTitles: ['Р'] }) }).topics[0].questions[0];
    expect(plain(oralStateLine(one({}), at))).toBe('Ещё не отвечали.');
    expect(plain(oralStateLine(one({ missed: true }), at))).toBe('В прошлый раз ответ был неполным.');
    expect(plain(oralStateLine(one({ state: 1, named: 2, of: 4 }), at))).toBe('В ответе 2 главных пункта из 4.');
    expect(plain(oralStateLine(one({ state: 2, named: 3, of: 3, readyAt: at + 1000 }), at))).toBe('Ответ полный. Ответьте ещё раз в другой день, и вопрос выучен.');
    expect(plain(oralStateLine(one({ state: 2, named: 3, of: 3, readyAt: at - 1000 }), at))).toBe('Ответ полный. Ответьте ещё раз сегодня, и вопрос выучен.');
  });

  it('ready now: every main point named on another day and its moment has come', () => {
    const at = Date.UTC(2026, 9, 21, 12);
    const e = exam([oralQ(1, { state: 2, readyAt: at - 1 }), oralQ(2, { state: 2, readyAt: at + 1 }), oralQ(3, { state: 1, readyAt: null })]);
    expect(readyNow(e, at)).toEqual(['q1']);
  });

  it('every reason a question is not counted', () => {
    const out = buildTopics({ oral: exam([oralQ(1, { kind: 'unmapped' }), oralQ(2, { kind: 'unverified' }), oralQ(3, { kind: 'gap' }),
      oralQ(4, { kind: 'none' }), oralQ(5, { kind: 'none' }), oralQ(6, { kind: 'none' }), oralQ(7, { kind: 'none' }), oralQ(8, { kind: 'none' })]) }).out;
    expect(outLines(out).map((l) => plain(l.text))).toEqual([
      '5 вопросов не считаем, их нет в лекциях.',
      'Вопрос 1 не считаем, его ещё не сверили с лекциями.',
      'Вопрос 2 не считаем, его сверили с лекциями только по словам.',
      'Вопрос 3 не считаем, для него не получилось составить пункты ответа.',
    ]);
  });
});

describe('a mixed subject', () => {
  it('an oral section of a test topic\'s title joins it; the others follow with «устно»', () => {
    const oral = exam([oralQ(1, { section: 1 }), oralQ(2, { section: 2 })], { sectionTitles: ['тема 1.2  операторы и выражения', 'Устный раздел'] });
    const list = buildTopics({ subjectId: S, items: items([2, 2]), titles: ['Тема 1.1. Типы', 'Тема 1.2. Операторы и выражения'], oral });
    expect(list.kind).toBe('mixed');
    expect(list.topics.map((t) => `${t.title}:${t.questions.length}:${t.oralTag}`)).toEqual([
      'Тема 1.1. Типы:2:false',
      'Тема 1.2. Операторы и выражения:3:false',
      'Устный раздел:1:true',
    ]);
  });

  it('merges by the same words, case and punctuation aside', () => {
    const oral = exam([oralQ(1, { section: 1 })], { sectionTitles: ['ОПЕРАТОРЫ И ВЫРАЖЕНИЯ'] });
    const list = buildTopics({ subjectId: S, items: items([2]), titles: ['Операторы и выражения.'], oral });
    expect(list.topics).toHaveLength(1);
    expect(list.topics[0].questions.map((q) => q.kind)).toEqual(['t', 't', 'o']);
  });
});

describe('the session\'s change', () => {
  it('a topic closed by the session, the nearest one, and one an error opened again', () => {
    const titles = ['Первая', 'Вторая', 'Третья'];
    const before = buildTopics({ subjectId: S, items: items([2, 4, 2], { 1: 'done', 3: 'done', 4: 'done', 7: 'done', 8: 'done' }), titles }).topics;
    // The session learned question 2 (closing «Первая») and missed 8 (opening «Третья» again).
    const after = withResults(before, new Set(['t2']), new Set(['t8']));
    const change = topicChange(before, after);
    expect(change.closed.map((t) => t.title)).toEqual(['Первая']);
    expect(change.reopened.map((t) => t.title)).toEqual(['Третья']);
    expect(change.near?.title).toBe('Третья');
    expect(plain(nearLine(change.near!))).toBe('В теме «Третья» остался 1 вопрос.');
  });

  it('read after a session (the bot): closed topics with a question of the session learned since it began', () => {
    const start = Date.UTC(2026, 9, 21, 9);
    const topics = buildTopics({ subjectId: S, items: items([2, 2], { 1: 'done', 2: 'done', 3: 'done', 4: 'done' }), titles: ['Первая', 'Вторая'] }).topics;
    // The fixture learned every question at 19 October 10:00: before this session.
    expect(closedSince(topics, new Set(['t1', 't3']), start)).toEqual([]);
    expect(closedSince(topics, new Set(['t1', 't3']), Date.UTC(2026, 9, 19, 9)).map((t) => t.title)).toEqual(['Первая', 'Вторая']);
    expect(closedSince(topics, new Set(['t3']), Date.UTC(2026, 9, 19, 9)).map((t) => t.title)).toEqual(['Вторая']);
  });
});

describe('words', () => {
  it('counts in plain words', () => {
    expect(plain(countWords(2, 3, true))).toBe('темы из 3');
    expect(plain(countWords(12, 12, false))).toBe('тем');
    expect(plain(topicsLeftLine(9, 12))).toBe('Осталось 9 тем из 12.');
    expect(plain(topicsLeftLine(1, 12))).toBe('Осталась 1 тема из 12.');
    expect(plain(learnLeftLine(9, 12))).toBe('Осталось выучить 9 тем из 12');
    expect(plain(learnLeftLine(1, 3))).toBe('Осталось выучить 1 тему из 3');
    expect(plain(learnLeftLine(2, 3))).toBe('Осталось выучить 2 темы из 3');
    expect(plain(closedFoldLine(1))).toBe('Выучена 1 тема');
    expect(plain(closedFoldLine(3))).toBe('Выучены 3 темы');
    expect(plain(closedFoldLine(5))).toBe('Выучено 5 тем');
    expect(howLines({ kind: 'test', sources: ['file'] })).toContain('Темы взяты из файла с вопросами.');
  });

  it('use none of the words the app dropped', () => {
    const source = topicsSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const strings = (source.match(/'[^'\n]*'|`[^`\n]*`/gu) ?? []).filter((literal: string) => /[а-яё]/iu.test(literal));
    const text = strings.join('\n');
    for (const word of [/шпаргал/i, /стер/i, /строк/i, /подтем/i, /!/, /в сч[её]т/i, /подтвержд/i, /засчит/i, /повторени/i, /прогресс-бар/i]) {
      expect(text).not.toMatch(word);
    }
  });
});

describe('the wire', () => {
  it('parses learn_left and leaves out what it cannot read', () => {
    const exams = parseLearnLeft({
      v: 1,
      exams: [
        {
          exam_id: 'e1', title: 'Базы данных', mapping_state: 'done', lectures: [['l1', 'Лекция'], [7, 'x']], section_titles: ['Р', 3],
          to_write: 2, units: 2,
          q: [['q1', 1, '1.', null, 0, 'lines', 3, 1, 1, 1790935200, null, 0], ['q2', 2, '', 2, null, 'weird', 7, 0, 0, null, 1790935201, 1], 'bad'],
        },
        { title: 'нет id' },
      ],
    });
    expect(exams).toHaveLength(1);
    expect(exams[0].lectures).toEqual([{ id: 'l1', title: 'Лекция' }]);
    expect(exams[0].sectionTitles).toEqual(['Р', '']);
    expect(exams[0].questions[0]).toMatchObject({ id: 'q1', label: '1.', lecture: 0, kind: 'lines', state: 3, learnedAt: 1790935200000 });
    expect(exams[0].questions[1]).toMatchObject({ kind: 'gap', state: 0, section: 2, readyAt: 1790935201000, missed: true });
  });
});
