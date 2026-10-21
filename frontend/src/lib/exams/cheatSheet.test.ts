import { describe, expect, it } from 'vitest';
import type { LearningEvent } from '../../api/learning';
import {
  DUE_DAYS,
  blockKind,
  buildSheet,
  cleanMissing,
  lineStatus,
  localDayOf,
  normalizeTitle,
  sheetHashes,
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
  it('a line nobody answered is as written', () => {
    const status = lineStatus([], NOW);
    expect(status).toMatchObject({ state: 'fresh', history: [], peekedToday: false });
  });

  it('one naming rubs it half-way and says when a naming will erase it', () => {
    const at = Date.parse(local('2026-10-03T19:40:00'));
    const status = lineStatus([point(new Date(at).toISOString(), true)], NOW);
    expect(status.state).toBe('rubbed');
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
    expect(sheet.blocks.map((block) => block.lines.length)).toEqual([2, 0, 0, 0, 0, 0, 0]);
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
  });

  it('a question whose essential line is due waits for its check: not learned (no tick beside «пора проверить»)', () => {
    const events = [point(local('2026-09-20T10:00:00'), true), point(local('2026-09-21T10:00:00'), true)];
    const sheet = buildSheet([question(1, { rubric: rubric('r1', TWO) })], events, NOW);
    expect(sheet.blocks[0].lines[0].status.state).toBe('due');
    expect(sheet.blocks[0].learned).toBe(false);
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

  it('a question that cannot be written is a gap of a question the lectures have, not an unwritten one', () => {
    const sheet = buildSheet([question(1, { rubric: rubric('r1', TWO) }), question(2, { question_hash: 'b'.repeat(32), unwritable: true })], [], NOW);
    // As a copy of a group link shows the same question (POINTS_NOT_WRITTEN in the teacher's report).
    expect(sheet.blocks[1]).toMatchObject({ kind: 'gap', coverage: 'full', lines: [] });
  });

  it('builds 300 questions of 6 lines quickly', () => {
    const six: Array<[string, boolean]> = Array.from({ length: 6 }, (_, i) => [`Пункт номер ${i + 1} про спрос`, i < 3]);
    const questions = Array.from({ length: 300 }, (_, i) =>
      question(i + 1, { question_hash: String(i).padStart(32, '0'), rubric: rubric(`r${i}`, six) }),
    );
    const started = performance.now();
    const sheet = buildSheet(questions, [], NOW);
    expect(sheet.blocks.flatMap((block) => block.lines)).toHaveLength(1800);
    expect(performance.now() - started).toBeLessThan(250);
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
