import { describe, expect, it } from 'vitest';
import type { LearningEvent } from '../../api/learning';
import {
  DUE_DAYS,
  LINE_LEFT,
  LINE_READABLE,
  blockKind,
  buildSheet,
  changeSummary,
  lastAnswerSession,
  lineStatus,
  localDayOf,
  normalizeTitle,
  sheetChanges,
  sheetHashes,
  sheetHistory,
  sheetWithout,
  type SheetQuestion,
  type SheetRubric,
} from './cheatSheet';

const HASH = 'a'.repeat(32);
const TITLE = 'Закон спроса: чем выше цена, тем меньше величина спроса';
let sequence = 0;

interface PointOpts {
  localDate?: string;
  status?: string;
  followup?: string;
  id?: string;
  session?: string;
  rubric?: string;
  point?: string;
  title?: string | null;
  hash?: string | null;
}

function point(at: string, named: boolean | null, opts: PointOpts = {}): LearningEvent {
  sequence += 1;
  const rubric = opts.rubric ?? 'r1';
  const pointId = opts.point ?? 'p1';
  return {
    id: opts.id ?? `point-${String(sequence).padStart(4, '0')}`,
    created_at: at,
    local_date: opts.localDate ?? localDayOf(Date.parse(at)),
    material_id: null,
    kind: 'oral_point',
    item_key: `oral:${rubric}:${pointId}`,
    correct: named,
    score: null,
    confidence: null,
    source_ids: [],
    session_id: opts.session ?? `session-${sequence}`,
    payload: {
      v: 1,
      rubric_id: rubric,
      point_id: pointId,
      ...(opts.hash === null ? {} : { question_hash: opts.hash ?? HASH }),
      ...(opts.title === null ? {} : { title: opts.title ?? TITLE }),
      status: opts.status ?? (named === null ? 'unrated' : named ? 'covered' : 'missing'),
      ...(opts.followup ? { followup_status: opts.followup } : {}),
    },
  };
}

function peek(at: string, opts: { localDate?: string; rubric?: string; point?: string; title?: string } = {}): LearningEvent {
  sequence += 1;
  const rubric = opts.rubric ?? 'r1';
  const pointId = opts.point ?? 'p1';
  return {
    id: `peek-${String(sequence).padStart(4, '0')}`,
    created_at: at,
    local_date: opts.localDate ?? localDayOf(Date.parse(at)),
    material_id: null,
    kind: 'sheet_peek',
    item_key: `peek:${rubric}:${pointId}`,
    correct: null,
    score: null,
    confidence: null,
    source_ids: [],
    session_id: null,
    payload: { v: 1, rubric_id: rubric, point_id: pointId, question_hash: HASH, title: opts.title ?? TITLE },
  };
}

// Times are written in local time (no zone), so local days are predictable in any test time zone.
const local = (text: string) => new Date(text).toISOString();
const NOW = Date.parse(local('2026-10-05T12:00:00'));

describe('lineStatus: each answer is a pass of the eraser', () => {
  it('a line nobody answered is as written and readable', () => {
    const status = lineStatus([], NOW);
    expect(status).toMatchObject({ state: 'fresh', history: [], peekedToday: false });
    expect(LINE_READABLE.has(status.state)).toBe(true);
  });

  it('one naming rubs it half-way and says when a naming will erase it', () => {
    const status = lineStatus([point(local('2026-10-03T19:40:00'), true)], NOW);
    expect(status.state).toBe('rubbed');
    expect(LINE_READABLE.has('rubbed')).toBe(false);
    // The later of +20 hours (4 Oct 15:40) and the local midnight after 3 Oct.
    expect(status.erasableFrom).toBe(local('2026-10-04T15:40:00'));
  });

  it('two namings on two days at least 20 hours apart erase it', () => {
    const status = lineStatus([point(local('2026-10-03T10:00:00'), true), point(local('2026-10-04T08:00:00'), true)], NOW);
    expect(status).toMatchObject({ state: 'erased', erasedOn: '2026-10-04', lastNamedAt: local('2026-10-04T08:00:00'), checks: 0 });
  });

  it('23:59 and 0:01 are two days but two minutes; 1:00 and 21:00 one day — not erased', () => {
    expect(lineStatus([point(local('2026-10-03T23:59:00'), true), point(local('2026-10-04T00:01:00'), true)], NOW).state).toBe('rubbed');
    expect(lineStatus([point(local('2026-10-03T01:00:00'), true), point(local('2026-10-03T21:00:00'), true)], NOW).state).toBe('rubbed');
  });

  it('erases at exactly 20 hours and not a millisecond earlier', () => {
    const first = point(local('2026-10-03T12:00:00'), true);
    const exact = point(new Date(Date.parse(local('2026-10-04T08:00:00'))).toISOString(), true);
    const early = point(new Date(Date.parse(local('2026-10-04T08:00:00')) - 1).toISOString(), true);
    expect(lineStatus([first, exact], NOW).state).toBe('erased');
    expect(lineStatus([first, early], NOW).state).toBe('rubbed');
  });

  it('a miss starts the series over', () => {
    const status = lineStatus(
      [point(local('2026-10-03T10:00:00'), true), point(local('2026-10-03T12:00:00'), false), point(local('2026-10-04T10:00:00'), true)],
      NOW,
    );
    expect(status.state).toBe('rubbed');
  });

  it('a miss of a line never erased leaves it readable with its words', () => {
    const partial = lineStatus([point(local('2026-10-04T10:00:00'), false, { status: 'partial' })], NOW);
    expect(partial.state).toBe('missed');
    expect(partial.history[0]).toMatchObject({ outcome: 'missed', word: 'mentioned' });
    expect(lineStatus([point(local('2026-10-04T10:00:00'), false, { status: 'wrong' })], NOW).history[0].word).toBe('wrong');
    expect(lineStatus([point(local('2026-10-04T10:00:00'), false)], NOW).history[0].word).toBe('missing');
  });

  it('a point named only after the examiner asked is not recalled alone: it does not erase', () => {
    const status = lineStatus(
      [point(local('2026-10-03T10:00:00'), true), point(local('2026-10-04T10:00:00'), true, { status: 'missing', followup: 'covered' })],
      NOW,
    );
    expect(status.state).toBe('missed');
    expect(status.history[1]).toMatchObject({ outcome: 'missed', word: 'after_question' });
  });

  it('an erased line missed later comes back and remembers when it had been erased', () => {
    const status = lineStatus(
      [point(local('2026-09-21T10:00:00'), true), point(local('2026-09-22T10:00:00'), true), point(local('2026-09-28T10:00:00'), false)],
      NOW,
    );
    expect(status).toMatchObject({ state: 'returned', wasErasedOn: '2026-09-22' });
    expect(LINE_READABLE.has('returned')).toBe(true);
  });

  it('a returned line named again is rubbed, and erased again only by a new pair of days', () => {
    const base = [point(local('2026-09-21T10:00:00'), true), point(local('2026-09-22T10:00:00'), true), point(local('2026-09-28T10:00:00'), false)];
    expect(lineStatus([...base, point(local('2026-10-03T10:00:00'), true)], NOW).state).toBe('rubbed');
    expect(lineStatus([...base, point(local('2026-10-03T10:00:00'), true), point(local('2026-10-04T09:00:00'), true)], NOW)).toMatchObject({
      state: 'erased',
      erasedOn: '2026-10-04',
    });
  });

  it('an unrated answer neither starts nor breaks anything', () => {
    expect(lineStatus([point(local('2026-10-03T10:00:00'), null)], NOW).state).toBe('fresh');
    const status = lineStatus(
      [point(local('2026-10-03T10:00:00'), true), point(local('2026-10-03T18:00:00'), null), point(local('2026-10-04T10:00:00'), true)],
      NOW,
    );
    expect(status.state).toBe('erased');
    expect(status.history).toHaveLength(2);
  });

  it('orders by server time, then by id, whatever order the events come in', () => {
    const named = point(local('2026-10-03T10:00:00'), true, { id: 'b' });
    const missed = point(local('2026-10-03T10:00:00'), false, { id: 'a' });
    expect(lineStatus([named, missed], NOW).state).toBe('rubbed');
    expect(lineStatus([missed, named], NOW).state).toBe('rubbed');
  });
});

describe('lineStatus: «подсмотреть»', () => {
  it('a naming the same day after uncovering the line does not count', () => {
    const events = [
      point(local('2026-10-03T10:00:00'), true),
      peek(local('2026-10-04T09:00:00')),
      point(local('2026-10-04T10:00:00'), true),
    ];
    const status = lineStatus(events, NOW);
    expect(status.state).toBe('rubbed');
    expect(status.history.map((event) => event.word)).toEqual(['named', 'after_peek']);
  });

  it('a peek on another day, or after the naming, changes nothing', () => {
    expect(
      lineStatus([point(local('2026-10-03T10:00:00'), true), peek(local('2026-10-03T20:00:00')), point(local('2026-10-04T10:00:00'), true)], NOW).state,
    ).toBe('erased');
    expect(
      lineStatus([point(local('2026-10-03T10:00:00'), true), point(local('2026-10-04T10:00:00'), true), peek(local('2026-10-04T11:00:00'))], NOW).state,
    ).toBe('erased');
  });

  it('a miss after a peek still counts', () => {
    expect(lineStatus([peek(local('2026-10-04T09:00:00')), point(local('2026-10-04T10:00:00'), false)], NOW).state).toBe('missed');
  });

  it('knows the line was uncovered today', () => {
    expect(lineStatus([peek(local('2026-10-05T08:00:00'))], NOW).peekedToday).toBe(true);
    expect(lineStatus([peek(local('2026-10-04T08:00:00'))], NOW).peekedToday).toBe(false);
  });
});

describe('lineStatus: when an erased line is checked again', () => {
  const erasedOn = (day: string) => [
    point(local(`2026-09-${day}T10:00:00`), true),
    point(local(`2026-09-${String(Number(day) + 1).padStart(2, '0')}T10:00:00`), true),
  ];

  it('5 days after the last naming it shows through', () => {
    const events = erasedOn('20');
    const named = Date.parse(local('2026-09-21T10:00:00'));
    expect(lineStatus(events, named + DUE_DAYS[0] * 86_400_000 - 1)).toMatchObject({ state: 'erased' });
    const due = lineStatus(events, named + DUE_DAYS[0] * 86_400_000);
    expect(due.state).toBe('due');
    expect(due.dueAt).toBe(new Date(named + 5 * 86_400_000).toISOString());
    expect(LINE_LEFT.has('due')).toBe(false);
  });

  it('each passed check on another day moves the next one further: 12, then 25 days', () => {
    const events = [...erasedOn('01'), point(local('2026-09-07T10:00:00'), true)];
    const status = lineStatus(events, Date.parse(local('2026-09-08T10:00:00')));
    expect(status).toMatchObject({ state: 'erased', checks: 1 });
    expect(status.dueAt).toBe(new Date(Date.parse(local('2026-09-07T10:00:00')) + 12 * 86_400_000).toISOString());
    const twice = lineStatus([...events, point(local('2026-09-20T10:00:00'), true)], Date.parse(local('2026-09-21T10:00:00')));
    expect(twice.checks).toBe(2);
    expect(twice.dueAt).toBe(new Date(Date.parse(local('2026-09-20T10:00:00')) + 25 * 86_400_000).toISOString());
  });

  it('a second naming the same day is not a check', () => {
    const status = lineStatus([...erasedOn('01'), point(local('2026-09-02T18:00:00'), true)], Date.parse(local('2026-09-03T10:00:00')));
    expect(status.checks).toBe(0);
  });

  it('in the last days before the exam a line not named for 4 days is due', () => {
    // Named last on 4 Oct 10:00; on 8 Oct 12:00 that is 4 days and 2 hours ago — under the 5 days.
    const events = [point(local('2026-10-03T10:00:00'), true), point(local('2026-10-04T10:00:00'), true)];
    const eve = Date.parse(local('2026-10-08T12:00:00'));
    expect(lineStatus(events, eve, { examDate: '2026-10-20' }).state).toBe('erased');
    expect(lineStatus(events, eve, { examDate: '2026-10-09' }).state).toBe('due');
    expect(lineStatus(events, eve, { examDate: '2026-10-10' }).state).toBe('due');
    expect(lineStatus(events, eve, { examDate: '2026-10-11' }).state).toBe('erased');
    expect(lineStatus(events, eve, { examDate: '2026-10-07' }).state).toBe('erased');
  });

  it('a due line missed comes back', () => {
    const events = [...erasedOn('01'), point(local('2026-10-01T10:00:00'), false)];
    expect(lineStatus(events, NOW).state).toBe('returned');
  });
});

function rubric(id: string, titles: Array<[string, boolean]>, extra: Partial<SheetRubric> = {}): SheetRubric {
  return {
    rubric_id: id,
    built_at: null,
    coverage: 'full',
    coverage_note: '',
    materials: [{ key: 'M1', material_id: 'm1', title: 'Спрос и предложение' }],
    points: titles.map(([title, essential], i) => ({
      id: `p${i + 1}`,
      title,
      short: i === 0 ? 'закон: цена ↑ → спрос ↓' : '',
      essential,
      source_quote: 'цитата',
      source_ids: ['M1:S02'],
    })),
    ...extra,
  };
}

function question(position: number, extra: Partial<SheetQuestion> = {}): SheetQuestion {
  return {
    question_id: `q-${position}`,
    position,
    label: String(position),
    section: null,
    text: `Вопрос номер ${position}. Подробности.`,
    question_hash: HASH,
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    rubric: null,
    ...extra,
  };
}

const TWO: Array<[string, boolean]> = [
  [TITLE, true],
  ['Кривая спроса имеет отрицательный наклон', false],
];

describe('buildSheet', () => {
  it('orders blocks as the department does and picks each block kind', () => {
    const sheet = buildSheet(
      [
        question(3, { coverage: 'none', question_hash: 'c'.repeat(32) }),
        question(1, { rubric: rubric('r1', TWO) }),
        question(2, { coverage: null }),
        question(4),
        question(5, { rubric: rubric('r5', [], { coverage: 'none' }) }),
        question(6, { coverage: 'unverified' }),
        question(7, { rebuilt: true }),
      ],
      [],
      NOW,
    );
    expect(sheet.blocks.map((block) => [block.number, block.kind])).toEqual([
      ['1', 'lines'],
      ['2', 'unmapped'],
      ['3', 'gap'],
      ['4', 'unwritten'],
      ['5', 'gap'],
      ['6', 'unverified'],
      ['7', 'rebuilt'],
    ]);
    expect(sheet.counts).toMatchObject({ total: 2, left: 2, essentialTotal: 1, essentialLeft: 1, readable: 2, withoutLines: 6, gaps: 2, unwritten: 1, unmapped: 1, unverified: 1, rebuilt: 1, questions: 7 });
  });

  it('writes the short line, else the title; prints the wording', () => {
    const block = buildSheet([question(1, { rubric: rubric('r1', TWO) })], [], NOW).blocks[0];
    expect(block.lines.map((line) => line.text)).toEqual(['закон: цена ↑ → спрос ↓', 'Кривая спроса имеет отрицательный наклон']);
    expect(block.text).toBe('Вопрос номер 1. Подробности.');
    expect(block.lines[0]).toMatchObject({ key: 'r1:p1', pointId: 'p1', essential: true, title: TITLE, sourceIds: ['M1:S02'] });
  });

  it('says what a partial question lacks: the mapping note, else the rubric note', () => {
    expect(buildSheet([question(1, { coverage: 'partial', missing_note: 'товаров Гиффена', rubric: rubric('r', TWO) })], [], NOW).blocks[0]).toMatchObject({
      partial: true,
      missing: 'товаров Гиффена',
    });
    expect(buildSheet([question(1, { rubric: rubric('r', TWO, { coverage: 'partial', coverage_note: 'условия закрытия' }) })], [], NOW).blocks[0].missing).toBe(
      'условия закрытия',
    );
    expect(buildSheet([question(1, { rubric: rubric('r', TWO) })], [], NOW).blocks[0]).toMatchObject({ partial: false, missing: '' });
  });

  it('a question is learned when its essential lines are erased, whatever the minor ones', () => {
    const events = [point(local('2026-10-03T10:00:00'), true), point(local('2026-10-04T10:00:00'), true)];
    const sheet = buildSheet([question(1, { rubric: rubric('r1', TWO) })], events, NOW);
    expect(sheet.blocks[0].lines.map((line) => line.status.state)).toEqual(['erased', 'fresh']);
    expect(sheet.blocks[0].learned).toBe(true);
    expect(sheet.counts).toMatchObject({ left: 1, essentialLeft: 0, erased: 1, learned: 1 });
  });

  it('takes an event by the point words: another rubric with the same point counts, other words do not', () => {
    const events = [
      // Re-mapping rebuilt the rubric: the same point under another id and number.
      point(local('2026-10-03T10:00:00'), true, { rubric: 'old', point: 'p3' }),
      point(local('2026-10-04T10:00:00'), true, { rubric: 'r1', point: 'p1' }),
      // Rebuilt under the same id with other points: not this line's history.
      point(local('2026-10-05T10:00:00'), false, { rubric: 'r1', point: 'p2', title: 'Совсем другой пункт' }),
      // Another question with the same words: not this one.
      point(local('2026-10-05T11:00:00'), false, { hash: 'b'.repeat(32) }),
    ];
    const lines = buildSheet([question(1, { rubric: rubric('r1', TWO) })], events, NOW).blocks[0].lines;
    expect(lines.map((line) => line.status.state)).toEqual(['erased', 'fresh']);
  });

  it('falls back to the journal key for an event without words', () => {
    const events = [point(local('2026-10-03T10:00:00'), false, { title: null, hash: null, point: 'p2' })];
    const lines = buildSheet([question(1, { rubric: rubric('r1', TWO) })], events, NOW).blocks[0].lines;
    expect(lines.map((line) => line.status.state)).toEqual(['fresh', 'missed']);
  });

  it('counts a line shared by two questions with the same wording once', () => {
    const shared = rubric('r1', TWO);
    const sheet = buildSheet([question(1, { rubric: shared }), question(2, { rubric: shared })], [], NOW);
    expect(sheet.counts.total).toBe(2);
  });

  it('lists the question hashes it needs events for', () => {
    expect(sheetHashes([question(1, { rubric: rubric('r1', TWO) }), question(2, { question_hash: 'b'.repeat(32) })])).toEqual([HASH]);
  });

  it('knows the block kind of a question on its own', () => {
    expect(blockKind(question(1, { coverage: 'none', rubric: rubric('r', TWO) }))).toBe('gap');
    expect(blockKind(question(1, { coverage: 'partial' }))).toBe('unwritten');
  });

  it('builds 300 questions of 6 lines quickly', () => {
    const six: Array<[string, boolean]> = Array.from({ length: 6 }, (_, i) => [`Пункт номер ${i + 1} про спрос`, i < 3]);
    const questions = Array.from({ length: 300 }, (_, i) =>
      question(i + 1, { question_hash: String(i).padStart(32, '0'), rubric: rubric(`r${i}`, six) }),
    );
    const started = performance.now();
    const sheet = buildSheet(questions, [], NOW);
    expect(sheet.counts.total).toBe(1800);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe('after an answer, and the history', () => {
  const questions = [question(1, { rubric: rubric('r1', TWO) })];
  const events = [
    point(local('2026-10-03T10:00:00'), true, { session: 's1' }),
    point(local('2026-10-03T10:00:00'), true, { session: 's1', point: 'p2', title: TWO[1][0] }),
    point(local('2026-10-04T10:00:00'), true, { session: 's2' }),
    point(local('2026-10-04T10:00:00'), false, { session: 's2', point: 'p2', title: TWO[1][0] }),
  ];

  it('finds the last answer and replays what it changed', () => {
    const after = buildSheet(questions, events, NOW);
    expect(lastAnswerSession(after)).toBe('s2');
    const before = sheetWithout(questions, events, 's2', NOW);
    const changes = sheetChanges(before, after);
    expect(changes).toEqual([
      { key: 'r1:p1', questionId: 'q-1', from: 'rubbed', to: 'erased' },
      { key: 'r1:p2', questionId: 'q-1', from: 'rubbed', to: 'missed' },
    ]);
    expect(changeSummary(changes)).toEqual({ erased: 1, rubbed: 0, returned: 0, due: 0, missed: 1, checked: 0 });
    // A due line named again passed its check: counted apart from the newly erased ones.
    expect(changeSummary([{ key: 'r:p1', questionId: 'q', from: 'due', to: 'erased' }, { key: 'r:p2', questionId: 'q', from: 'rubbed', to: 'erased' }])).toEqual({
      erased: 1,
      rubbed: 0,
      returned: 0,
      due: 0,
      missed: 0,
      checked: 1,
    });
  });

  it('has nothing to replay without answers', () => {
    expect(lastAnswerSession(buildSheet(questions, [], NOW))).toBeNull();
  });

  it('replays the sheet day by day from the first answer to today', () => {
    const frames = sheetHistory(questions, events, NOW);
    expect(frames.map((frame) => frame.day)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
    expect(frames[0]).toMatchObject({ left: 2, total: 2 });
    expect(frames[1]).toMatchObject({ left: 1, total: 2 });
    expect(sheetHistory(questions, [], NOW)).toEqual([]);
  });
});

describe('normalizeTitle', () => {
  it('compares point words like the journal stores them', () => {
    expect(normalizeTitle('Закон  спроса: чем выше цена!')).toBe('закон спроса чем выше цена');
    expect(normalizeTitle('Ёмкость рынка')).toBe('емкость рынка');
    expect(normalizeTitle(undefined)).toBe('');
  });
});
