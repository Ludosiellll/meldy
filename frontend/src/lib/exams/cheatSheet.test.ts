import { describe, expect, it } from 'vitest';
import type { LearningEvent } from '../../api/learning';
import {
  LINE_LEFT,
  NOTE_NONE,
  NOTE_PARTIAL,
  NOTE_UNMAPPED,
  blockKind,
  buildSheet,
  changeSummary,
  headingFromText,
  lineStatus,
  pointItemKeys,
  sheetChanges,
  snapshotOf,
  type SheetQuestion,
} from './cheatSheet';

const RUBRIC = '7a2c3b54-4d2e-4f0a-9c55-3d7a1f1c2b00';
let sequence = 0;

function point(
  at: string,
  named: boolean | null,
  opts: { localDate?: string; status?: string; followup?: string; key?: string; id?: string } = {},
): LearningEvent {
  sequence += 1;
  return {
    id: opts.id ?? `point-${String(sequence).padStart(4, '0')}`,
    created_at: at,
    local_date: opts.localDate ?? at.slice(0, 10),
    material_id: null,
    kind: 'oral_point',
    item_key: opts.key ?? `oral:${RUBRIC}:p1`,
    correct: named,
    score: null,
    confidence: null,
    source_ids: [],
    session_id: `session-${sequence}`,
    payload: {
      v: 1,
      rubric_id: RUBRIC,
      point_id: 'p1',
      status: opts.status ?? (named === null ? 'unrated' : named ? 'covered' : 'missing'),
      ...(opts.followup ? { followup_status: opts.followup } : {}),
    },
  };
}

const NOW = Date.parse('2026-10-10T12:00:00Z');

describe('lineStatus: the rule «подтверждено» applied to one point', () => {
  it('a line nobody answered is as written', () => {
    expect(lineStatus([], NOW)).toMatchObject({ state: 'fresh', history: [], erasableFrom: null });
  });

  it('one naming makes it pale and says when a naming will erase it', () => {
    const status = lineStatus([point('2026-10-03T10:00:00Z', true)], NOW);
    expect(status.state).toBe('once');
    // The later of +20 hours (2026-10-04 06:00 UTC) and the local midnight after 2026-10-03.
    const midnight = new Date(2026, 9, 4).getTime();
    expect(Date.parse(status.erasableFrom!)).toBe(Math.max(Date.parse('2026-10-04T06:00:00Z'), midnight));
  });

  it('two namings on two days at least 20 hours apart erase it (10:00 and 8:00 the next day)', () => {
    const status = lineStatus([point('2026-10-03T10:00:00Z', true), point('2026-10-04T08:00:00Z', true)], NOW);
    expect(status).toMatchObject({ state: 'erased', erasedOn: '2026-10-04', erasedAt: '2026-10-04T08:00:00Z', lastNamedAt: '2026-10-04T08:00:00Z' });
  });

  it('23:59 and 0:01 are two days but two minutes: not erased', () => {
    const status = lineStatus(
      [point('2026-10-03T20:59:00Z', true, { localDate: '2026-10-03' }), point('2026-10-03T21:01:00Z', true, { localDate: '2026-10-04' })],
      NOW,
    );
    expect(status.state).toBe('once');
  });

  it('1:00 and 21:00 of one day are 20 hours but one day: not erased', () => {
    const status = lineStatus(
      [point('2026-10-02T22:00:00Z', true, { localDate: '2026-10-03' }), point('2026-10-03T18:00:00Z', true, { localDate: '2026-10-03' })],
      NOW,
    );
    expect(status.state).toBe('once');
  });

  it('a miss starts the series over: named, missed, named the next day is pale again', () => {
    const status = lineStatus(
      [point('2026-10-03T10:00:00Z', true), point('2026-10-03T12:00:00Z', false), point('2026-10-04T10:00:00Z', true)],
      NOW,
    );
    expect(status.state).toBe('once');
  });

  it('a miss of a line that was never erased is «не прозвучал»', () => {
    const status = lineStatus([point('2026-10-03T10:00:00Z', true), point('2026-10-05T10:00:00Z', false)], NOW);
    expect(status).toMatchObject({ state: 'missed', wasErasedOn: null });
    expect(lineStatus([point('2026-10-05T10:00:00Z', false)], NOW).state).toBe('missed');
  });

  it('an erased line that is missed later comes back and remembers when it had been erased', () => {
    const status = lineStatus(
      [point('2026-10-03T10:00:00Z', true), point('2026-10-04T10:00:00Z', true), point('2026-10-08T10:00:00Z', false)],
      NOW,
    );
    expect(status).toMatchObject({ state: 'returned', wasErasedOn: '2026-10-04' });
  });

  it('a returned line named again is pale, and erased again only by a new pair of days', () => {
    const base = [point('2026-10-01T10:00:00Z', true), point('2026-10-02T10:00:00Z', true), point('2026-10-05T10:00:00Z', false)];
    expect(lineStatus([...base, point('2026-10-06T10:00:00Z', true)], NOW).state).toBe('once');
    expect(lineStatus([...base, point('2026-10-06T10:00:00Z', true), point('2026-10-07T09:00:00Z', true)], NOW)).toMatchObject({
      state: 'erased',
      erasedOn: '2026-10-07',
    });
  });

  it('14 days after the last naming an erased line shows through: «пора проверить»', () => {
    const events = [point('2026-09-20T10:00:00Z', true), point('2026-09-21T10:00:00Z', true)];
    expect(lineStatus(events, Date.parse('2026-10-05T09:59:00Z')).state).toBe('erased');
    expect(lineStatus(events, Date.parse('2026-10-05T10:00:00Z')).state).toBe('due');
  });

  it('a naming of an erased line keeps it erased and moves «пора проверить» forward', () => {
    const events = [point('2026-09-20T10:00:00Z', true), point('2026-09-21T10:00:00Z', true), point('2026-10-04T10:00:00Z', true)];
    expect(lineStatus(events, NOW)).toMatchObject({ state: 'erased', erasedOn: '2026-09-21', lastNamedAt: '2026-10-04T10:00:00Z' });
  });

  it('an answer without a grade neither starts nor breaks anything', () => {
    expect(lineStatus([point('2026-10-03T10:00:00Z', null)], NOW).state).toBe('fresh');
    const status = lineStatus(
      [point('2026-10-03T10:00:00Z', true), point('2026-10-03T18:00:00Z', null), point('2026-10-04T10:00:00Z', true)],
      NOW,
    );
    expect(status.state).toBe('erased');
    expect(status.history).toHaveLength(2);
  });

  it('partial and wrong are misses; the words keep the status', () => {
    const partial = lineStatus([point('2026-10-03T10:00:00Z', false, { status: 'partial' })], NOW);
    expect(partial.state).toBe('missed');
    expect(partial.history[0]).toMatchObject({ named: false, status: 'partial' });
    const wrong = lineStatus([point('2026-10-03T10:00:00Z', true), point('2026-10-04T10:00:00Z', false, { status: 'wrong' })], NOW);
    expect(wrong.state).toBe('missed');
    expect(wrong.history[1].status).toBe('wrong');
  });

  it('a point named after the examiner asked about it counts as named and says so', () => {
    const status = lineStatus([point('2026-10-03T10:00:00Z', true, { status: 'missing', followup: 'covered' })], NOW);
    expect(status.state).toBe('once');
    expect(status.history[0]).toMatchObject({ named: true, status: 'missing', afterQuestion: true });
  });

  it('orders by server time, then by id, whatever order the events come in', () => {
    const a = point('2026-10-03T10:00:00Z', true, { id: 'b' });
    const b = point('2026-10-03T10:00:00Z', false, { id: 'a' });
    // Same moment: id 'a' (the miss) first, then 'b' (the naming) — the line is pale.
    expect(lineStatus([a, b], NOW).state).toBe('once');
    expect(lineStatus([b, a], NOW).state).toBe('once');
  });

  it('ignores events of other kinds', () => {
    const other = { ...point('2026-10-03T10:00:00Z', true), kind: 'exam_answer' as const };
    expect(lineStatus([other], NOW).state).toBe('fresh');
  });

  it('keeps fresh, once, missed and returned on the sheet', () => {
    expect([...LINE_LEFT].sort()).toEqual(['fresh', 'missed', 'once', 'returned']);
  });
});

function question(position: number, extra: Partial<SheetQuestion> = {}): SheetQuestion {
  return {
    question_id: `q-${position}`,
    position,
    label: String(position),
    section: null,
    text: `Вопрос номер ${position}. Подробности.`,
    question_hash: String(position).padStart(32, '0'),
    coverage: 'full',
    missing_note: '',
    rubric: null,
    ...extra,
  };
}

function rubric(id: string, points: number, extra: Partial<NonNullable<SheetQuestion['rubric']>> = {}): NonNullable<SheetQuestion['rubric']> {
  return {
    rubric_id: id,
    built_at: null,
    coverage: 'full',
    coverage_note: '',
    topic: '',
    points: Array.from({ length: points }, (_, i) => ({
      id: `p${i + 1}`,
      title: `Пункт ${i + 1} полностью`,
      short: i === 0 ? `строка ${i + 1}` : '',
      essential: i < 2,
      source_quote: 'цитата',
      source_label: 'Лекция, фрагмент 1',
      material_id: null,
    })),
    ...extra,
  };
}

describe('buildSheet', () => {
  it('orders blocks as the department does and picks each block kind', () => {
    const sheet = buildSheet(
      [
        question(3, { coverage: 'none' }),
        question(1, { rubric: rubric('r1', 3, { topic: 'Спрос' }) }),
        question(2, { coverage: null }),
        question(4),
        question(5, { rubric: rubric('r5', 4, { coverage: 'none', points: [] }) }),
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
    ]);
    expect(sheet.blocks.map((block) => block.note)).toEqual([null, NOTE_UNMAPPED, NOTE_NONE, null, NOTE_NONE]);
    expect(sheet.counts).toMatchObject({ total: 3, left: 3, gaps: 2, unwritten: 1, unmapped: 1, questions: 5, learned: 0 });
  });

  it('writes the short line, else the title; the heading is the topic, else the wording to its first stop', () => {
    const sheet = buildSheet([question(1, { rubric: rubric('r1', 2) })], [], NOW);
    expect(sheet.blocks[0].lines.map((line) => line.text)).toEqual(['строка 1', 'Пункт 2 полностью']);
    expect(sheet.blocks[0].heading).toBe('Вопрос номер 1');
    expect(sheet.blocks[0].lines[0]).toMatchObject({ key: 'r1:p1', pointId: 'p1', essential: true, title: 'Пункт 1 полностью' });
  });

  it('says what a partial question lacks: the mapping note, else the rubric note, else «не всё»', () => {
    const lack = buildSheet([question(1, { coverage: 'partial', missing_note: 'товаров Гиффена', rubric: rubric('r', 3) })], [], NOW);
    expect(lack.blocks[0].note).toBe('в лекциях нет: товаров Гиффена');
    const fromRubric = buildSheet([question(1, { rubric: rubric('r', 3, { coverage: 'partial', coverage_note: 'условия закрытия' }) })], [], NOW);
    expect(fromRubric.blocks[0].note).toBe('в лекциях нет: условия закрытия');
    const bare = buildSheet([question(1, { coverage: 'partial', rubric: rubric('r', 3) })], [], NOW);
    expect(bare.blocks[0].note).toBe(NOTE_PARTIAL);
  });

  it('counts states and marks a question learned when every line is erased', () => {
    const events = [
      point('2026-10-03T10:00:00Z', true, { key: 'oral:r1:p1' }),
      point('2026-10-04T10:00:00Z', true, { key: 'oral:r1:p1' }),
      point('2026-10-03T10:00:00Z', true, { key: 'oral:r1:p2' }),
      point('2026-10-04T10:00:00Z', true, { key: 'oral:r1:p2' }),
      point('2026-10-03T10:00:00Z', true, { key: 'oral:r2:p1' }),
      point('2026-10-03T10:00:00Z', false, { key: 'oral:r2:p2' }),
      // Another rubric of the same question (lectures changed): not this sheet's line.
      point('2026-10-03T10:00:00Z', true, { key: 'oral:old:p3' }),
    ];
    const sheet = buildSheet([question(1, { rubric: rubric('r1', 2) }), question(2, { rubric: rubric('r2', 3) })], events, NOW);
    expect(sheet.blocks[0].learned).toBe(true);
    expect(sheet.blocks[1].learned).toBe(false);
    expect(sheet.blocks[1].lines.map((line) => line.status.state)).toEqual(['once', 'missed', 'fresh']);
    expect(sheet.counts).toMatchObject({ total: 5, left: 3, erased: 2, once: 1, due: 0, learned: 1 });
  });

  it('lists the journal keys of every written line and nothing for gaps', () => {
    const keys = pointItemKeys([
      question(1, { rubric: rubric('r1', 2) }),
      question(2, { rubric: rubric('r2', 3, { coverage: 'none', points: [] }) }),
      question(3),
    ]);
    expect(keys).toEqual(['oral:r1:p1', 'oral:r1:p2']);
  });

  it('knows the block kind of a question on its own', () => {
    expect(blockKind(question(1, { coverage: 'unverified' }))).toBe('unwritten');
    expect(blockKind(question(1, { coverage: 'none', rubric: rubric('r', 3) }))).toBe('gap');
  });
});

describe('what changed since the last look', () => {
  const twoLines = (events: LearningEvent[]) => buildSheet([question(1, { rubric: rubric('r1', 2) })], events, NOW);

  it('has nothing to replay without a snapshot or when nothing moved', () => {
    const sheet = twoLines([]);
    expect(sheetChanges(null, sheet)).toEqual([]);
    expect(sheetChanges(snapshotOf(sheet), sheet)).toEqual([]);
  });

  it('lists the lines that faded, were erased or came back, in the sheet order', () => {
    const before = snapshotOf(twoLines([point('2026-10-03T10:00:00Z', true, { key: 'oral:r1:p2' })]));
    const after = twoLines([
      point('2026-10-03T10:00:00Z', true, { key: 'oral:r1:p1' }),
      point('2026-10-03T10:00:00Z', true, { key: 'oral:r1:p2' }),
      point('2026-10-04T10:00:00Z', true, { key: 'oral:r1:p2' }),
    ]);
    const changes = sheetChanges(before, after);
    expect(changes).toEqual([
      { key: 'r1:p1', questionId: 'q-1', from: 'fresh', to: 'once' },
      { key: 'r1:p2', questionId: 'q-1', from: 'once', to: 'erased' },
    ]);
    expect(changeSummary(changes)).toEqual({ erased: 1, faded: 1, returned: 0, due: 0, back: 0 });
  });

  it('does not replay a line the snapshot never saw', () => {
    const sheet = twoLines([point('2026-10-03T10:00:00Z', true, { key: 'oral:r1:p1' })]);
    expect(sheetChanges({ 'old:p1': 'fresh' }, sheet)).toEqual([]);
  });
});

describe('headingFromText', () => {
  it('takes the wording up to its first full stop', () => {
    expect(headingFromText('Рыночное равновесие. Дефицит и излишек.')).toBe('Рыночное равновесие');
    expect(headingFromText('Что такое спрос?')).toBe('Что такое спрос');
  });

  it('cuts a long first sentence at a word with an ellipsis', () => {
    const long = 'Правило максимизации прибыли фирмы в условиях совершенной конкуренции и условие её закрытия в краткосрочном периоде';
    const heading = headingFromText(long);
    expect(heading.length).toBeLessThanOrEqual(80);
    expect(heading.endsWith('…')).toBe(true);
    expect(heading).not.toMatch(/\s…$/);
  });

  it('keeps an abbreviation-free short wording as is and handles empty text', () => {
    expect(headingFromText('  Спрос  и  предложение ')).toBe('Спрос и предложение');
    expect(headingFromText('')).toBe('');
  });
});
