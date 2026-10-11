import { describe, expect, it } from 'vitest';
import type { LearningEvent } from '../../api/learning';
import {
  DUE_DAYS,
  LINE_LEFT,
  LINE_READABLE,
  blockKind,
  buildSheet,
  erasableAt,
  erasableNow,
  changeSummary,
  cleanMissing,
  countsWith,
  lastAnswerSession,
  lineStatus,
  localDayOf,
  normalizeTitle,
  quietReason,
  sheetChanges,
  sheetHashes,
  HISTORY_MAX_FRAMES,
  sheetHistory,
  sheetsAround,
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
    const at = Date.parse(local('2026-10-03T19:40:00'));
    const status = lineStatus([point(new Date(at).toISOString(), true)], NOW);
    expect(status.state).toBe('rubbed');
    expect(LINE_READABLE.has('rubbed')).toBe(false);
    // The later of +20 hours by the server clock (4 Oct 15:40 where no clock changes that night) and the
    // local midnight after 3 Oct.
    expect(status.erasableFrom).toBe(new Date(Math.max(at + 20 * 3_600_000, Date.parse(local('2026-10-04T00:00:00')))).toISOString());
  });

  it('after a peek today the moment it will erase is not before the next midnight', () => {
    const named = point(local('2026-10-04T10:00:00'), true);
    // Named yesterday morning: it may be erased from 4 Oct 06:00 on, but it was uncovered today.
    const status = lineStatus([named, peek(local('2026-10-05T09:00:00'))], NOW);
    expect(status.state).toBe('rubbed');
    expect(status.peekedToday).toBe(true);
    expect(status.erasableFrom).toBe(local('2026-10-06T00:00:00'));
    // The same line without the peek may be erased now.
    expect(Date.parse(lineStatus([named], NOW).erasableFrom as string)).toBeLessThanOrEqual(NOW);
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
    // 20 hours by the server clock (the local clock may jump an hour in between).
    const from = Date.parse(local('2026-10-03T12:00:00'));
    const first = point(new Date(from).toISOString(), true);
    const exact = point(new Date(from + 20 * 3_600_000).toISOString(), true);
    const early = point(new Date(from + 20 * 3_600_000 - 1).toISOString(), true);
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

  it('a naming before the check is due is no check: the line waits its stage again from that naming', () => {
    // Erased on 2 Sep; due on 7 Sep. Named on 4 Sep: still erased, the same stage, due 5 days after 4 Sep.
    const early = [...erasedOn('01'), point(local('2026-09-04T10:00:00'), true)];
    const status = lineStatus(early, Date.parse(local('2026-09-05T10:00:00')));
    expect(status).toMatchObject({ state: 'erased', checks: 0 });
    expect(status.dueAt).toBe(new Date(Date.parse(local('2026-09-04T10:00:00')) + 5 * 86_400_000).toISOString());
    // Named when due (9 Sep, 10:00): the check passes, the next one is 12 days later.
    const checked = lineStatus([...early, point(local('2026-09-09T10:00:00'), true)], Date.parse(local('2026-09-10T10:00:00')));
    expect(checked).toMatchObject({ state: 'erased', checks: 1 });
    expect(checked.dueAt).toBe(new Date(Date.parse(local('2026-09-09T10:00:00')) + 12 * 86_400_000).toISOString());
  });

  it('five days in a row are no three checks: the next check is 5 days after the last naming', () => {
    const days = ['01', '02', '03', '04', '05'].map((day) => point(local(`2026-09-${day}T10:00:00`), true));
    const status = lineStatus(days, Date.parse(local('2026-09-06T10:00:00')));
    expect(status).toMatchObject({ state: 'erased', checks: 0 });
    expect(status.dueAt).toBe(new Date(Date.parse(local('2026-09-05T10:00:00')) + 5 * 86_400_000).toISOString());
  });

  it('in the last days before the exam a line not named for 4 days passes its check when named', () => {
    // Erased on 4 Oct; the exam is on 10 Oct: on 8 Oct, 4 days after the last naming, it is due.
    const events = [point(local('2026-10-03T10:00:00'), true), point(local('2026-10-04T10:00:00'), true), point(local('2026-10-08T11:00:00'), true)];
    expect(lineStatus(events, Date.parse(local('2026-10-08T12:00:00')), { examDate: '2026-10-10' })).toMatchObject({ state: 'erased', checks: 1 });
    // Without the exam that close it was not due yet: no check.
    expect(lineStatus(events, Date.parse(local('2026-10-08T12:00:00')), { examDate: '2026-10-30' })).toMatchObject({ state: 'erased', checks: 0 });
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
  it('one answer names a point once, even when two points of a rebuilt rubric have the same words', () => {
    const twin = 'Цена растёт при росте спроса';
    const qs = [question(1, { rubric: rubric('r1', [[twin, true], ['Другое', false], [twin, false]]) })];
    // An old rubric's answer: its two points with these words, one named, one missed — at the same minute.
    const old = [
      point(local('2026-10-04T10:00:00'), true, { session: 's', rubric: 'r0', point: 'p2', title: twin }),
      point(local('2026-10-04T10:00:00'), false, { session: 's', rubric: 'r0', point: 'p5', title: twin }),
    ];
    const lines = buildSheet(qs, old, NOW).blocks[0].lines;
    expect(lines[0].status.history).toHaveLength(1);
    expect(lines[2].status.history).toHaveLength(1);
    // With the same point ids, each line keeps its own.
    const same = [
      point(local('2026-10-04T10:00:00'), true, { session: 't', rubric: 'r0', point: 'p1', title: twin }),
      point(local('2026-10-04T10:00:00'), false, { session: 't', rubric: 'r0', point: 'p3', title: twin }),
    ];
    const own = buildSheet(qs, same, NOW).blocks[0].lines;
    expect([own[0].status.state, own[2].status.state]).toEqual(['rubbed', 'missed']);
  });

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

  it('says what the lectures lack without repeating «не хватает»', () => {
    expect(cleanMissing('В лекции нет примеров')).toBe('примеров');
    expect(cleanMissing('не хватает примеров')).toBe('примеров');
    expect(cleanMissing('Нет классификации видов инфляции')).toBe('классификации видов инфляции');
    expect(cleanMissing('ВВП по доходам')).toBe('ВВП по доходам');
    expect(cleanMissing('нет')).toBe('');
    expect(buildSheet([question(1, { rubric: rubric('r', TWO, { coverage: 'partial', coverage_note: 'Не хватает: примеров' }) })], [], NOW).blocks[0].missing).toBe('примеров');
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

  it('a question whose essential line is due waits for its check: not learned (no tick beside «пора проверить»)', () => {
    const events = [point(local('2026-09-20T10:00:00'), true), point(local('2026-09-21T10:00:00'), true)];
    const sheet = buildSheet([question(1, { rubric: rubric('r1', TWO) })], events, NOW);
    expect(sheet.blocks[0].lines[0].status.state).toBe('due');
    expect(sheet.blocks[0].learned).toBe(false);
    expect(sheet.counts.learned).toBe(0);
  });

  it('two points of one rubric with the same words keep their own history, by the point id', () => {
    const twins: Array<[string, boolean]> = [
      ['Спрос и предложение', true],
      ['Спрос и предложение.', false],
    ];
    const events = [
      point(local('2026-10-04T10:00:00'), true, { point: 'p1', title: 'Спрос и предложение', session: 'a' }),
      point(local('2026-10-04T10:00:00'), false, { point: 'p2', title: 'Спрос и предложение.', session: 'a' }),
    ];
    const lines = buildSheet([question(1, { rubric: rubric('r1', twins) })], events, NOW).blocks[0].lines;
    expect(lines.map((line) => line.status.state)).toEqual(['rubbed', 'missed']);
    // From another rubric (rebuilt) the words alone still carry the history over.
    const rebuilt = [point(local('2026-10-04T10:00:00'), true, { rubric: 'old', point: 'p5', title: 'Спрос и предложение' })];
    expect(buildSheet([question(1, { rubric: rubric('r1', twins) })], rebuilt, NOW).blocks[0].lines.map((line) => line.status.state)).toEqual(['rubbed', 'rubbed']);
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
    // Points that failed the quote check twice: nothing to write — a gap, as in a group link's copy.
    expect(blockKind(question(1, { coverage: 'full', unwritable: true }))).toBe('gap');
    expect(blockKind(question(1, { coverage: 'full', unwritable: true, rebuilt: true }))).toBe('gap');
  });

  it('counts a question that cannot be written among the questions without points, not among the unwritten', () => {
    const sheet = buildSheet([question(1, { rubric: rubric('r1', TWO) }), question(2, { question_hash: 'b'.repeat(32), unwritable: true })], [], NOW);
    expect(sheet.counts).toMatchObject({ gaps: 1, unwritten: 0, withoutLines: 1 });
    // The block a copy of a group link shows for the same question (components/exams/sheet/copy.blockNote:
    // POINTS_NOT_WRITTEN): a gap of a question the lectures have.
    expect(sheet.blocks[1]).toMatchObject({ kind: 'gap', coverage: 'full' });
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
    expect(changes.map(({ before: _was, ...change }) => change)).toEqual([
      { key: 'r1:p1', questionId: 'q-1', from: 'rubbed', to: 'erased' },
      { key: 'r1:p2', questionId: 'q-1', from: 'rubbed', to: 'missed' },
    ]);
    // Each change carries the line as it was: the replay draws it so (its notes, its history then).
    expect(changes[1].before).toMatchObject({ state: 'rubbed' });
    expect(changes[1].before?.history).toHaveLength(1);
    // The rubbed line not named this time is back in ink: it «вернулась».
    expect(changeSummary(changes)).toEqual({ erased: 1, rubbed: 0, checked: 0, returned: 1, stayed: 0 });
  });

  it('the counter of a show steps from the sheet before the answer to the one after it, a line at a time (countsWith)', () => {
    // Jury QA of /try, 2026-10-11: the lines were struck at 1.5 s and the counter moved only at 2.8 s, after the show.
    const after = buildSheet(questions, events, NOW);
    const before = sheetWithout(questions, events, 's2', NOW);
    const changes = sheetChanges(before, after);
    const essential = new Set(after.blocks.flatMap((block) => block.lines.filter((line) => line.essential).map((line) => line.key)));
    const lineCounts = ({ total, left, essentialTotal, essentialLeft, rubbed, erased, due, readable }: typeof before.counts) =>
      ({ total, left, essentialTotal, essentialLeft, rubbed, erased, due, readable });
    // Nothing drawn yet: the sheet before the answer, whole.
    expect(countsWith(before.counts, changes, new Set(), essential)).toEqual(before.counts);
    // The first line struck (rubbed → erased, a main line): one line and one main line fewer left.
    const one = countsWith(before.counts, changes, new Set([changes[0].key]), essential);
    expect(lineCounts(one)).toEqual({
      ...lineCounts(before.counts),
      left: before.counts.left - 1,
      essentialLeft: before.counts.essentialLeft - 1,
      rubbed: before.counts.rubbed - 1,
      erased: before.counts.erased + 1,
    });
    // Every line drawn: the lines' counts are the sheet's after the answer; a question's own (learned) waits for the end.
    const all = countsWith(before.counts, changes, new Set(changes.map((change) => change.key)), essential);
    expect(lineCounts(all)).toEqual(lineCounts(after.counts));
    expect(all.learned).toBe(before.counts.learned);
  });

  it('counts each change in the words of the sheet', () => {
    const change = (from: string, to: string) => ({ key: `r:${from}-${to}`, questionId: 'q', from, to }) as Parameters<typeof changeSummary>[0][number];
    // A due line named again passed its check: counted apart from the newly erased ones.
    expect(changeSummary([change('due', 'erased'), change('rubbed', 'erased')])).toEqual({ erased: 1, rubbed: 0, checked: 1, returned: 0, stayed: 0 });
    // Erased by the answer and due by now («Показать последний ответ» days later): erased.
    expect(changeSummary([change('rubbed', 'due')])).toEqual({ erased: 1, rubbed: 0, checked: 0, returned: 0, stayed: 0 });
    // A fresh line not named stays on the sheet (with the wave); an erased one not named comes back.
    expect(changeSummary([change('fresh', 'missed'), change('erased', 'returned'), change('fresh', 'rubbed')])).toEqual({
      erased: 0,
      rubbed: 1,
      checked: 0,
      returned: 1,
      stayed: 1,
    });
  });

  it('says why an answer changed nothing, from its own lines', () => {
    // Named again the same day: the moment it will erase, and why it is too soon.
    const early = [point(local('2026-10-05T09:00:00'), true, { session: 'a' }), point(local('2026-10-05T11:00:00'), true, { session: 'b' })];
    const sheet = buildSheet([question(1, { rubric: rubric('r1', [[TITLE, true]]) })], early, NOW);
    expect(quietReason(sheet, new Set(['b']))).toEqual({ kind: 'wait', from: sheet.blocks[0].lines[0].status.erasableFrom, count: 1, why: 'day' });
    // Named again the next morning, less than 20 hours after the first naming.
    const night = [point(local('2026-10-04T18:00:00'), true, { session: 'a' }), point(local('2026-10-05T09:00:00'), true, { session: 'b' })];
    const nextMorning = buildSheet([question(1, { rubric: rubric('r1', [[TITLE, true]]) })], night, NOW);
    expect(quietReason(nextMorning, new Set(['b']))).toEqual({ kind: 'wait', from: local('2026-10-05T14:00:00'), count: 1, why: 'hours' });
    // Named after a peek the same day.
    const peeked = [point(local('2026-10-04T09:00:00'), true, { session: 'a' }), peek(local('2026-10-05T08:00:00')), point(local('2026-10-05T11:00:00'), true, { session: 'b' })];
    expect(quietReason(buildSheet([question(1, { rubric: rubric('r1', [[TITLE, true]]) })], peeked, NOW), new Set(['b']))).toEqual({ kind: 'peek' });
    // Named again when already erased (a check on another day moves its next one).
    const erased = [
      point(local('2026-10-01T09:00:00'), true, { session: 'a' }),
      point(local('2026-10-02T10:00:00'), true, { session: 'b' }),
      point(local('2026-10-04T10:00:00'), true, { session: 'c' }),
    ];
    expect(quietReason(buildSheet([question(1, { rubric: rubric('r1', [[TITLE, true]]) })], erased, NOW), new Set(['c']))).toEqual({ kind: 'erased' });
    // Nothing named: no reason of its own.
    const missed = [point(local('2026-10-04T10:00:00'), false, { session: 'a' }), point(local('2026-10-05T10:00:00'), false, { session: 'b' })];
    expect(quietReason(buildSheet([question(1, { rubric: rubric('r1', [[TITLE, true]]) })], missed, NOW), new Set(['b']))).toBeNull();
  });

  it('after a change, counts only the named lines the answer left as they were', () => {
    // p1 named yesterday evening and again this morning (too soon); p2 named for the first time.
    const events = [
      point(local('2026-10-04T18:00:00'), true, { session: 'a', point: 'p1' }),
      point(local('2026-10-05T08:00:00'), true, { session: 'b', point: 'p1' }),
      point(local('2026-10-05T08:00:00'), true, { session: 'b', point: 'p2', title: 'Кривая спроса идёт вниз' }),
    ];
    const qs = [question(1, { rubric: rubric('r1', [[TITLE, true], ['Кривая спроса идёт вниз', false]]) })];
    const after = buildSheet(qs, events, NOW);
    const before = sheetWithout(qs, events, 'b', NOW);
    const changes = sheetChanges(before, after);
    expect(changes.map((change) => [change.from, change.to])).toEqual([['fresh', 'rubbed']]);
    const p1 = after.blocks[0].lines[0];
    expect(quietReason(after, new Set(['b']), new Set(changes.map((change) => change.key)))).toEqual({ kind: 'wait', from: p1.status.erasableFrom, count: 1, why: 'hours' });
    // Without the changes every named line of the answer counts.
    expect(quietReason(after, new Set(['b']))).toMatchObject({ kind: 'wait', count: 2 });
  });

  it('names the latest of the waiting lines’ moments: at the earliest one only some of them would erase', () => {
    // p1 named at 18:00, p2 first named at 22:00; both named again the next morning, too soon.
    const p2Title = 'Кривая спроса идёт вниз';
    const at = (text: string, named: boolean, session: string, pointId: string) =>
      point(local(text), named, { session, point: pointId, ...(pointId === 'p2' ? { title: p2Title } : {}) });
    const events = [
      at('2026-10-04T18:00:00', true, 'a', 'p1'),
      at('2026-10-04T18:00:00', false, 'a', 'p2'),
      at('2026-10-04T22:00:00', true, 'b', 'p1'),
      at('2026-10-04T22:00:00', true, 'b', 'p2'),
      at('2026-10-05T09:00:00', true, 'c', 'p1'),
      at('2026-10-05T09:00:00', true, 'c', 'p2'),
    ];
    const qs = [question(1, { rubric: rubric('r1', [[TITLE, true], [p2Title, false]]) })];
    const after = buildSheet(qs, events, NOW);
    expect(after.blocks[0].lines.map((line) => line.status.erasableFrom)).toEqual([local('2026-10-05T14:00:00'), local('2026-10-05T18:00:00')]);
    expect(quietReason(after, new Set(['c']))).toEqual({ kind: 'wait', from: local('2026-10-05T18:00:00'), count: 2, why: 'hours' });
  });

  it('says «the same day» and «20 hours» together when the waiting lines wait for different reasons', () => {
    const p2Title = 'Кривая спроса идёт вниз';
    const events = [
      point(local('2026-10-04T18:00:00'), true, { session: 'a', point: 'p1' }),
      point(local('2026-10-05T08:00:00'), true, { session: 'a2', point: 'p2', title: p2Title }),
      point(local('2026-10-05T09:00:00'), true, { session: 'c', point: 'p1' }),
      point(local('2026-10-05T09:00:00'), true, { session: 'c', point: 'p2', title: p2Title }),
    ];
    const qs = [question(1, { rubric: rubric('r1', [[TITLE, true], [p2Title, false]]) })];
    expect(quietReason(buildSheet(qs, events, NOW), new Set(['c']))).toMatchObject({ kind: 'wait', count: 2, why: 'both' });
  });

  it('a naming blocked by a peek is said together with the lines named too soon', () => {
    // p1 named at 18:00 and again this morning, too soon; p2 named 23 hours ago — it would erase, but
    // it was uncovered this morning.
    const p2Title = 'Кривая спроса идёт вниз';
    const events = [
      point(local('2026-10-04T18:00:00'), true, { session: 'a', point: 'p1' }),
      point(local('2026-10-04T10:00:00'), true, { session: 'a0', point: 'p2', title: p2Title }),
      peek(local('2026-10-05T08:00:00'), { point: 'p2', title: p2Title }),
      point(local('2026-10-05T09:00:00'), true, { session: 'c', point: 'p1' }),
      point(local('2026-10-05T09:00:00'), true, { session: 'c', point: 'p2', title: p2Title }),
    ];
    const qs = [question(1, { rubric: rubric('r1', [[TITLE, true], [p2Title, false]]) })];
    expect(quietReason(buildSheet(qs, events, NOW), new Set(['c']))).toEqual({ kind: 'wait', from: local('2026-10-05T14:00:00'), count: 1, why: 'hours', peek: true });
  });

  it('replays an answer as of its own moment: a passed check stays a passed check weeks later', () => {
    // Erased on 25 Sep, due on 30 Sep, named on 4 Oct: the check passed. By 20 Oct it is due again.
    const checkEvents = [
      point(local('2026-09-24T10:00:00'), true, { session: 'a' }),
      point(local('2026-09-25T10:00:00'), true, { session: 'b' }),
      point(local('2026-10-04T10:00:00'), true, { session: 'c' }),
    ];
    const qs = [question(1, { rubric: rubric('r1', [[TITLE, true]]) })];
    const later = Date.parse(local('2026-10-20T10:00:00'));
    expect(buildSheet(qs, checkEvents, later).blocks[0].lines[0].status.state).toBe('due');
    const around = sheetsAround(qs, checkEvents, new Set(['c']));
    expect(around?.at).toBe(Date.parse(local('2026-10-04T10:00:00')));
    const changes = sheetChanges(around!.before, around!.after);
    expect(changes.map(({ from, to }) => [from, to])).toEqual([['due', 'erased']]);
    expect(changeSummary(changes)).toMatchObject({ checked: 1 });
    // Later answers and peeks are not part of it; a session without events has nothing to replay.
    expect(sheetsAround(qs, [...checkEvents, peek(local('2026-10-05T08:00:00'))], new Set(['c']))?.after.blocks[0].lines[0].status.peekedToday).toBe(false);
    expect(sheetsAround(qs, checkEvents, new Set(['nope']))).toBeNull();
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

  it('a long history is shown by at most 50 days spread over it, from the first answer to today', () => {
    const long = [point(local('2025-09-01T10:00:00'), true, { session: 'old' }), ...events];
    const frames = sheetHistory(questions, long, NOW);
    expect(frames.length).toBeLessThanOrEqual(HISTORY_MAX_FRAMES);
    expect(frames[0].day).toBe('2025-09-01');
    expect(frames[frames.length - 1]).toMatchObject({ day: '2026-10-05', left: buildSheet(questions, long, NOW).counts.left });
    expect(frames.map((frame) => frame.day)).toEqual([...frames.map((frame) => frame.day)].sort());
  });

  it('starts at the first answer of a line on the sheet, and never ends before the newest answer', () => {
    // An answer to a point the sheet no longer has does not start the history.
    const other = point(local('2026-09-01T10:00:00'), true, { session: 'x', point: 'p9', title: 'Пункт, которого на листе нет' });
    expect(sheetHistory(questions, [other, ...events], NOW)[0].day).toBe('2026-10-03');
    // The device clock 30 s behind the server: the answer just saved is still in the last frame.
    const fresh = point(new Date(NOW + 30_000).toISOString(), true, { session: 's3', point: 'p2', title: TWO[1][0] });
    const frames = sheetHistory(questions, [...events, fresh], NOW);
    expect(frames[frames.length - 1].left).toBe(buildSheet(questions, [...events, fresh], NOW + 30_000).counts.left);
  });
});

describe('normalizeTitle', () => {
  it('compares point words like the journal stores them', () => {
    expect(normalizeTitle('Закон  спроса: чем выше цена!')).toBe('закон спроса чем выше цена');
    expect(normalizeTitle('Ёмкость рынка')).toBe('емкость рынка');
    expect(normalizeTitle(undefined)).toBe('');
  });

  it('keeps the signs that carry the meaning: «P > MC» and «P < MC» are two points', () => {
    expect(normalizeTitle('При P > MC фирма расширяет выпуск')).not.toBe(normalizeTitle('При P < MC фирма расширяет выпуск'));
    expect(normalizeTitle('При P>MC фирма')).toBe(normalizeTitle('При P > MC фирма'));
    expect(normalizeTitle('Цена ↑ → спрос ↓')).toBe('цена ↑ → спрос ↓');
  });
});

describe('erasableNow: what an answer can erase now («Сегодня-lite»)', () => {
  const HASHES = { b: 'b'.repeat(32), c: 'c'.repeat(32), d: 'd'.repeat(32) };
  const ELASTIC = 'Эластичность спроса по цене';
  const SURPLUS = 'Излишек потребителя';
  const UTILITY = 'Предельная полезность убывает';
  const sheetOf = (events: LearningEvent[], now = NOW) =>
    buildSheet(
      [
        question(1, { rubric: rubric('r1', TWO) }),
        question(2, { question_hash: HASHES.b, rubric: rubric('r2', [[ELASTIC, true]]) }),
        question(3, { question_hash: HASHES.c, rubric: rubric('r3', [[SURPLUS, true]]) }),
        question(4, { question_hash: HASHES.d, rubric: rubric('r4', [[UTILITY, true]]) }),
        // Not in the lectures: no lines, nothing to erase.
        question(5, { coverage: 'none' }),
      ],
      events,
      now,
    );
  const events = () => [
    // 1: named yesterday morning — the other day and 20 hours have come: an answer now erases it.
    point(local('2026-10-04T10:00:00'), true),
    // 2: named an hour ago — it can be erased from tomorrow, 20 hours on.
    point(local('2026-10-05T11:00:00'), true, { hash: HASHES.b, rubric: 'r2', title: ELASTIC }),
    // 3: erased on 20–21 Sep, due since 26 Sep: naming it now is its check.
    point(local('2026-09-20T10:00:00'), true, { hash: HASHES.c, rubric: 'r3', title: SURPLUS }),
    point(local('2026-09-21T10:00:00'), true, { hash: HASHES.c, rubric: 'r3', title: SURPLUS }),
    // 4: not named: a naming would only rub it.
    point(local('2026-10-04T10:00:00'), false, { hash: HASHES.d, rubric: 'r4', title: UTILITY }),
  ];

  it('counts the questions with a rubbed line whose moment has come or a line due for its check, by the sheet’s own states', () => {
    const sheet = sheetOf(events());
    expect(sheet.blocks.map((block) => block.lines.map((line) => line.status.state))).toEqual([
      ['rubbed', 'fresh'],
      ['rubbed'],
      ['due'],
      ['missed'],
      [],
    ]);
    const now = erasableNow(sheet, NOW);
    expect(now.questions).toEqual(['q-1', 'q-3']);
    // The next moment for the rest: question 2, 20 hours after its naming.
    expect(now.next).toBe(new Date(Date.parse(local('2026-10-05T11:00:00')) + 20 * 3_600_000).toISOString());
  });

  it('says when the next lines can be erased when none can now, and nothing when no line waits', () => {
    const early = sheetOf(events().filter((event) => event.payload.question_hash === HASHES.b));
    expect(erasableNow(early, NOW)).toEqual({
      questions: [],
      next: new Date(Date.parse(local('2026-10-05T11:00:00')) + 20 * 3_600_000).toISOString(),
    });
    // That moment comes: the question can be erased.
    expect(erasableNow(early, Date.parse(local('2026-10-06T07:00:00'))).questions).toEqual(['q-2']);
    // Nothing named, or only missed lines: nothing to erase and nothing to wait for.
    expect(erasableNow(sheetOf([]), NOW)).toEqual({ questions: [], next: null });
    expect(erasableNow(sheetOf(events().filter((event) => event.payload.question_hash === HASHES.d)), NOW)).toEqual({ questions: [], next: null });
  });

  it('erasableAt: a due line uncovered today waits for the midnight, an erased one for its check, a readable one for nothing', () => {
    const erased = [point(local('2026-10-01T10:00:00'), true), point(local('2026-10-02T10:00:00'), true)];
    // Erased on 2 Oct: due 5 days after the last naming, on 7 Oct.
    const waiting = lineStatus(erased, NOW);
    expect(waiting.state).toBe('erased');
    expect(erasableAt(waiting, NOW)).toBe(Date.parse(local('2026-10-07T10:00:00')));
    // Due since then: an answer now is its check.
    const due = Date.parse(local('2026-10-08T12:00:00'));
    expect(lineStatus(erased, due).state).toBe('due');
    expect(erasableAt(lineStatus(erased, due), due)).toBe(Date.parse(local('2026-10-07T10:00:00')));
    // Uncovered today («Подсмотреть»): a naming today does not count — from the next midnight.
    const peeked = lineStatus([...erased, peek(local('2026-10-08T09:00:00'))], due);
    expect(peeked).toMatchObject({ state: 'due', peekedToday: true });
    expect(erasableAt(peeked, due)).toBe(Date.parse(local('2026-10-09T00:00:00')));
    // A rubbed line peeked today: its own erasableFrom already waits for the midnight.
    const rubbed = lineStatus([point(local('2026-10-04T10:00:00'), true), peek(local('2026-10-05T09:00:00'))], NOW);
    expect(erasableAt(rubbed, NOW)).toBe(Date.parse(local('2026-10-06T00:00:00')));
    for (const status of [lineStatus([], NOW), lineStatus([point(local('2026-10-04T10:00:00'), false)], NOW)]) expect(erasableAt(status, NOW)).toBeNull();
  });
});
