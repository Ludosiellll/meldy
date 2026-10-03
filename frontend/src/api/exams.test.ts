import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Op = [string, unknown[]];
type Entry = { table: string; ops: Op[] };

const db = vi.hoisted(() => {
  const state = {
    calls: [] as Entry[],
    respond: (_entry: Entry): { data: unknown; error: unknown } => ({ data: null, error: null }),
  };
  const from = (table: string) => {
    const entry: Entry = { table, ops: [] };
    state.calls.push(entry);
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'order', 'limit', 'single', 'maybeSingle']) {
      builder[method] = (...args: unknown[]) => {
        entry.ops.push([method, args]);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(() => state.respond(entry))
        .then(resolve, reject);
    return builder;
  };
  return Object.assign(state, { from });
});

vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => db.from(table) } }));

import {
  COVERAGE_RESET,
  countSourceFragments,
  createExam,
  deleteExam,
  ExamApiError,
  importTextOnlyMaterial,
  isMappingLocked,
  listExams,
  loadExamBundle,
  markQuestionManual,
  normalizeCoverageItem,
  parseQuestionList,
  prefetchRubric,
  saveExamEdits,
  type ExamDraft,
  type ExamQuestion,
  type ExamRow,
} from './exams';

const op = (entry: Entry, name: string) => entry.ops.find(([method]) => method === name)?.[1];
const ops = (entry: Entry, name: string) => entry.ops.filter(([method]) => method === name).map(([, args]) => args);
const calls = (table: string, method?: string) =>
  db.calls.filter((entry) => entry.table === table && (!method || entry.ops.some(([name]) => name === method)));

function draft(overrides: Partial<ExamDraft> = {}): ExamDraft {
  return {
    title: '  Макроэкономика  ',
    kind: 'exam',
    examDate: '2027-01-24',
    sourceKind: 'paste',
    sourceText: '1. Предмет\n2. Метод',
    layoutMode: 'random',
    perTicket: 2,
    sectionTitles: [],
    questions: [
      { key: 'p1', id: null, label: '1', section: null, text: 'Предмет и метод макроэкономики.' },
      { key: 'p2', id: null, label: '2', section: null, text: 'Система национальных счетов.' },
      { key: 'p3', id: null, label: '3', section: null, text: 'Инфляция: виды и причины.' },
      { key: 'p4', id: null, label: '4', section: null, text: 'Рынок труда и безработица.' },
    ],
    tickets: [],
    materialIds: ['m-1', 'm-2'],
    ...overrides,
  };
}

function question(id: string, position: number, overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  return {
    id,
    exam_id: 'exam-1',
    position,
    label: String(position),
    section: null,
    text: `Вопрос номер ${position}`,
    question_hash: 'a'.repeat(32),
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: 'Есть определение',
    missing_note: '',
    evidence: [{ material_id: 'm-1', material_title: 'Лекция', source_id: 'S01', excerpt: 'Текст' }],
    nearest: [],
    materials_fingerprint: 'fp',
    mapping_version: 1,
    mapped_at: '2026-10-01T09:40:00Z',
    created_at: '2026-10-01T09:00:00Z',
    ...overrides,
  };
}

const exam: ExamRow = {
  id: 'exam-1',
  title: 'Макроэкономика',
  kind: 'exam',
  exam_date: null,
  source_kind: 'paste',
  source_text: '',
  ticket_layout: { mode: 'fixed', per_ticket: 2, tickets: [] },
  mapping_state: 'done',
  mapping_started_at: null,
  mapped_at: '2026-10-01T09:40:00Z',
  mapped_material_ids: ['m-1'],
  created_at: '2026-10-01T09:00:00Z',
};

beforeEach(() => {
  db.calls.length = 0;
  db.respond = () => ({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createExam', () => {
  it('inserts the exam, then questions without question_hash, then lectures, then tickets as question ids', async () => {
    db.respond = (entry) => {
      if (entry.table === 'exams' && op(entry, 'insert')) return { data: { id: 'exam-9' }, error: null };
      if (entry.table === 'exam_questions') {
        const rows = op(entry, 'insert')![0] as Array<{ position: number }>;
        return { data: rows.map((row) => ({ id: `q-${row.position}`, position: row.position })), error: null };
      }
      if (entry.table === 'exams' && op(entry, 'update')) return { data: [{ id: 'exam-9' }], error: null };
      return { data: null, error: null };
    };

    const result = await createExam(
      'user-1',
      draft({
        layoutMode: 'fixed',
        tickets: [
          { number: 1, keys: ['p1', 'p3'] },
          { number: 2, keys: ['p2', 'p4'] },
        ],
      }),
    );

    expect(result).toEqual({ examId: 'exam-9', questionIds: ['q-1', 'q-2', 'q-3', 'q-4'] });
    expect(db.calls.map((entry) => entry.table)).toEqual(['exams', 'exam_questions', 'exam_materials', 'exams']);

    const examInsert = op(db.calls[0], 'insert')![0] as Record<string, unknown>;
    expect(examInsert).toMatchObject({ user_id: 'user-1', title: 'Макроэкономика', kind: 'exam', exam_date: '2027-01-24' });
    expect(examInsert.ticket_layout).toEqual({ mode: 'fixed', per_ticket: 2, tickets: [] });

    const rows = op(db.calls[1], 'insert')![0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ exam_id: 'exam-9', user_id: 'user-1', position: 1, label: '1', section: null, text: 'Предмет и метод макроэкономики.' });
    for (const row of rows) expect(row).not.toHaveProperty('question_hash');

    expect(op(db.calls[2], 'insert')![0]).toEqual([
      { exam_id: 'exam-9', material_id: 'm-1', user_id: 'user-1' },
      { exam_id: 'exam-9', material_id: 'm-2', user_id: 'user-1' },
    ]);

    const layout = (op(db.calls[3], 'update')![0] as { ticket_layout: unknown }).ticket_layout;
    expect(layout).toEqual({
      mode: 'fixed',
      per_ticket: 2,
      tickets: [
        { number: 1, question_ids: ['q-1', 'q-3'] },
        { number: 2, question_ids: ['q-2', 'q-4'] },
      ],
    });
  });

  it('removes the half-created exam when the questions are not saved', async () => {
    db.respond = (entry) => {
      if (entry.table === 'exams' && op(entry, 'insert')) return { data: { id: 'exam-9' }, error: null };
      if (entry.table === 'exam_questions') return { data: null, error: { code: '23514', message: 'check violation' } };
      return { data: null, error: null };
    };

    await expect(createExam('user-1', draft())).rejects.toMatchObject({ name: 'ExamApiError', message: 'Экзамен не сохранён. Проверьте связь и повторите.' });
    const deletion = calls('exams', 'delete');
    expect(deletion).toHaveLength(1);
    expect(op(deletion[0], 'eq')).toEqual(['id', 'exam-9']);
  });

  it('refuses an empty title or a question shorter than three characters before any write', async () => {
    await expect(createExam('user-1', draft({ title: '   ' }))).rejects.toThrow('Назовите экзамен.');
    await expect(
      createExam('user-1', draft({ questions: [{ key: 'a', id: null, label: '', section: null, text: ' x ' }] })),
    ).rejects.toThrow(/слишком короткий вопрос/);
    expect(db.calls).toHaveLength(0);
  });
});

type Row = Record<string, unknown>;
type Reply = { data: unknown; error: unknown };

/**
 * A small stateful stand-in for the tables the exam writes touch: selects, inserts, upserts with
 * ON CONFLICT DO NOTHING, updates and deletes really change the rows, so a save that fails halfway
 * leaves the database as Supabase would. `override` answers one matching request instead.
 */
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const overrides: Array<(entry: Entry) => Reply | undefined> = [];
  let counter = 0;
  const has = (entry: Entry, name: string) => entry.ops.some(([method]) => method === name);
  const arg = (entry: Entry, name: string) => entry.ops.find(([method]) => method === name)?.[1] ?? [];
  const matches = (entry: Entry) => (row: Row) =>
    entry.ops.every(([method, args]) => {
      if (method === 'eq') return row[args[0] as string] === args[1];
      if (method === 'in') return (args[1] as unknown[]).includes(row[args[0] as string]);
      return true;
    });
  const respond = (entry: Entry): Reply => {
    for (let i = 0; i < overrides.length; i += 1) {
      const reply = overrides[i](entry);
      if (reply) {
        overrides.splice(i, 1);
        return reply;
      }
    }
    return apply(entry);
  };
  /** What the database does with the request, without overrides. */
  const apply = (entry: Entry): Reply => {
    const table = (tables[entry.table] ??= []);
    if (has(entry, 'insert') || has(entry, 'upsert')) {
      const upsert = has(entry, 'upsert');
      const payload = (upsert ? arg(entry, 'upsert')[0] : arg(entry, 'insert')[0]) as Row | Row[];
      const options = (upsert ? arg(entry, 'upsert')[1] ?? {} : {}) as { onConflict?: string; ignoreDuplicates?: boolean };
      const keys = entry.table === 'exam_materials' ? ['exam_id', 'material_id'] : ['id'];
      const inserted: Row[] = [];
      for (const row of Array.isArray(payload) ? payload : [payload]) {
        const stored: Row = { id: `${entry.table}-${++counter}`, ...row };
        const duplicate = table.some((existing) => keys.every((key) => existing[key] === stored[key]));
        if (duplicate && upsert && options.ignoreDuplicates && options.onConflict === keys.join(',')) continue;
        if (duplicate) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        table.push(stored);
        inserted.push({ ...stored });
      }
      return { data: has(entry, 'select') ? inserted : null, error: null };
    }
    const hits = table.filter(matches(entry));
    if (has(entry, 'update')) {
      hits.forEach((row) => Object.assign(row, arg(entry, 'update')[0] as Row));
      return { data: has(entry, 'select') ? hits.map((row) => ({ ...row })) : null, error: null };
    }
    if (has(entry, 'delete')) {
      tables[entry.table] = table.filter((row) => !hits.includes(row));
      return { data: has(entry, 'select') ? hits.map((row) => ({ ...row })) : null, error: null };
    }
    const rows = hits.map((row) => ({ ...row }));
    if (has(entry, 'order')) rows.sort((a, b) => Number(a.position) - Number(b.position));
    if (has(entry, 'maybeSingle') || has(entry, 'single')) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  };
  return { tables, respond, apply, override: (answer: (entry: Entry) => Reply | undefined) => overrides.push(answer) };
}

const storedQuestion = (id: string, position: number, text: string, extra: Row = {}): Row => ({
  ...question(id, position),
  text,
  ...extra,
});
const isWrite = (table: string, method: string) => (entry: Entry) => entry.table === table && entry.ops.some(([name]) => name === method);
const textsOf = (rows: Row[]) => [...rows].sort((a, b) => Number(a.position) - Number(b.position)).map((row) => row.text);

describe('saveExamEdits', () => {
  it('deletes, resets coverage of changed text, renumbers, inserts and keeps the rest of a known ticket', async () => {
    const editedExam: ExamRow = {
      ...exam,
      ticket_layout: { mode: 'fixed', per_ticket: 2, tickets: [{ number: 1, question_ids: ['q1', 'q2'] }, { number: 2, question_ids: ['q3', 'q4'] }] },
    };
    const fake = fakeDb({
      exams: [{ ...editedExam }],
      exam_questions: [1, 2, 3, 4].map((n) => storedQuestion(`q${n}`, n, `Вопрос номер ${n}`)),
      exam_materials: [
        { exam_id: 'exam-1', material_id: 'm-1' },
        { exam_id: 'exam-1', material_id: 'm-2' },
      ],
    });
    db.respond = fake.respond;

    const result = await saveExamEdits({
      exam: editedExam,
      replaceSource: false,
      draft: draft({
        layoutMode: 'fixed',
        // q2 deleted; q3 text edited; a new question appended.
        questions: [
          { key: 'q1', id: 'q1', label: '1', section: null, text: 'Вопрос номер 1' },
          { key: 'q3', id: 'q3', label: '3', section: null, text: 'Вопрос номер 3, исправленный' },
          { key: 'q4', id: 'q4', label: '4', section: null, text: 'Вопрос номер 4' },
          { key: 'n1', id: null, label: '', section: null, text: 'Совсем новый вопрос' },
        ],
        tickets: [
          { number: 1, keys: ['q1', 'q2'] },
          { number: 2, keys: ['q3', 'q4'] },
        ],
        materialIds: ['m-1', 'm-3'],
      }),
    });

    const deletion = calls('exam_questions', 'delete')[0];
    expect(op(deletion, 'in')).toEqual(['id', ['q2']]);

    const updates = calls('exam_questions', 'update').map((entry) => ({ id: op(entry, 'eq')![1], values: op(entry, 'update')![0] }));
    // q1 keeps position 1 and its text: nothing to write.
    expect(updates.find((item) => item.id === 'q1')).toBeUndefined();
    const q3 = updates.find((item) => item.id === 'q3')!.values as Record<string, unknown>;
    expect(q3).toMatchObject({ position: 2, text: 'Вопрос номер 3, исправленный', ...COVERAGE_RESET });
    const q4 = updates.find((item) => item.id === 'q4')!.values as Record<string, unknown>;
    expect(q4).toEqual({ position: 3 });

    const inserted = op(calls('exam_questions', 'insert')[0], 'insert')![0] as Array<Record<string, unknown>>;
    expect(inserted).toEqual([{ exam_id: 'exam-1', position: 4, label: '', section: null, text: 'Совсем новый вопрос' }]);
    const newId = fake.tables.exam_questions.find((row) => row.text === 'Совсем новый вопрос')!.id;

    const detach = calls('exam_materials', 'delete')[0];
    expect(ops(detach, 'in')).toEqual([['material_id', ['m-2']]]);
    const attach = calls('exam_materials', 'upsert')[0];
    expect(op(attach, 'upsert')).toEqual([[{ exam_id: 'exam-1', material_id: 'm-3' }], { onConflict: 'exam_id,material_id', ignoreDuplicates: true }]);

    const layout = (op(calls('exams', 'update')[0], 'update')![0] as { ticket_layout: unknown }).ticket_layout;
    // Ticket 1 loses the deleted q2 and keeps q1; ticket 2 is untouched.
    expect(layout).toEqual({
      mode: 'fixed',
      per_ticket: 2,
      tickets: [
        { number: 1, question_ids: ['q1'] },
        { number: 2, question_ids: ['q3', 'q4'] },
      ],
    });
    expect(result.needsMapping.sort()).toEqual([newId, 'q3'].sort());
    expect(result.materialsChanged).toBe(true);
    expect(result.questionIds).toEqual(['q1', 'q3', 'q4', newId]);
    expect(textsOf(fake.tables.exam_questions)).toEqual(['Вопрос номер 1', 'Вопрос номер 3, исправленный', 'Вопрос номер 4', 'Совсем новый вопрос']);
  });

  describe('saving again after a save that failed halfway', () => {
    const seed = () => ({
      exams: [{ ...exam }],
      exam_questions: [
        storedQuestion('q1', 1, 'Предмет и метод макроэкономики.'),
        storedQuestion('q2', 2, 'Система национальных счетов.'),
        storedQuestion('q3', 3, 'Инфляция: виды и причины.'),
      ],
      exam_materials: [
        { exam_id: 'exam-1', material_id: 'm-1' },
        { exam_id: 'exam-1', material_id: 'm-2' },
      ],
    });
    // q2 deleted, q3 reworded, «Рынок труда» added; lecture m-2 detached, m-3 attached.
    const input = () => ({
      exam,
      replaceSource: false,
      draft: draft({
        questions: [
          { key: 'q1', id: 'q1', label: '1', section: null, text: 'Предмет и метод макроэкономики.' },
          { key: 'q3', id: 'q3', label: '3', section: null, text: 'Инфляция: виды, причины и последствия.' },
          { key: 'n-1', id: null, label: '', section: null, text: 'Рынок труда и безработица.' },
        ],
        materialIds: ['m-1', 'm-3'],
      }),
    });

    it.each([
      ['at the exam row', isWrite('exams', 'update')],
      ['at attaching a lecture', isWrite('exam_materials', 'upsert')],
      ['after the new question was written', isWrite('exam_questions', 'insert')],
    ])('fails %s, then repeats nothing: no question twice, no false refusal', async (_, failing) => {
      const fake = fakeDb(seed());
      db.respond = fake.respond;
      fake.override((entry) => {
        if (!failing(entry)) return undefined;
        // The write reaches the database, the answer is lost on the way back.
        const reply = fake.apply(entry);
        return reply.error ? reply : { data: null, error: { code: '08006', message: 'connection failure' } };
      });

      await expect(saveExamEdits(input())).rejects.toThrow('Экзамен не сохранён. Проверьте связь и повторите.');
      const result = await saveExamEdits(input());

      expect(textsOf(fake.tables.exam_questions)).toEqual([
        'Предмет и метод макроэкономики.',
        'Инфляция: виды, причины и последствия.',
        'Рынок труда и безработица.',
      ]);
      expect(fake.tables.exam_questions.map((row) => row.position)).toEqual(expect.arrayContaining([1, 2, 3]));
      expect(fake.tables.exam_materials.map((row) => row.material_id).sort()).toEqual(['m-1', 'm-3']);
      const added = fake.tables.exam_questions.find((row) => row.text === 'Рынок труда и безработица.')!;
      expect(result.questionIds).toEqual(['q1', 'q3', added.id]);
      expect(result.needsMapping.sort()).toEqual([added.id as string, 'q3'].sort());
      expect(calls('exams', 'update').length).toBeGreaterThanOrEqual(1);
    });

    it('takes a question deleted meanwhile as deleted, and a row the database kept as a refusal', async () => {
      const keepOnly = () => ({
        exam,
        replaceSource: false,
        draft: draft({ questions: [{ key: 'q1', id: 'q1', label: '1', section: null, text: 'Предмет и метод макроэкономики.' }], materialIds: ['m-1', 'm-2'] }),
      });
      const gone = fakeDb(seed());
      db.respond = gone.respond;
      // Another tab deletes q2 and q3 between the read and the delete of this save.
      gone.override((entry) => {
        if (!isWrite('exam_questions', 'delete')(entry)) return undefined;
        gone.tables.exam_questions = gone.tables.exam_questions.filter((row) => row.id === 'q1');
        return { data: [], error: null };
      });
      await expect(saveExamEdits(keepOnly())).resolves.toMatchObject({ questionIds: ['q1'] });

      db.calls.length = 0;
      const kept = fakeDb(seed());
      db.respond = kept.respond;
      kept.override((entry) => (isWrite('exam_questions', 'delete')(entry) ? { data: [], error: null } : undefined));
      await expect(saveExamEdits(keepOnly())).rejects.toThrow('Изменения не сохранены: экзамен недоступен этому аккаунту.');
    });
  });

  it('reports a refused write instead of claiming success', async () => {
    const fake = fakeDb({ exams: [{ ...exam }], exam_questions: [storedQuestion('q1', 1, 'Вопрос номер 1')], exam_materials: [] });
    db.respond = fake.respond;
    fake.override((entry) => (isWrite('exam_questions', 'update')(entry) ? { data: [], error: null } : undefined));
    await expect(
      saveExamEdits({
        exam,
        replaceSource: false,
        draft: draft({ layoutMode: 'random', questions: [{ key: 'q1', id: 'q1', label: '1', section: null, text: 'Другой текст вопроса' }], materialIds: [] }),
      }),
    ).rejects.toThrow('Изменения не сохранены: экзамен недоступен этому аккаунту.');
  });
});

describe('single writes', () => {
  it('marks a question by hand without evidence', async () => {
    db.respond = () => ({ data: [{ id: 'q1' }], error: null });
    await markQuestionManual('q1');
    const entry = calls('exam_questions', 'update')[0];
    expect(op(entry, 'update')![0]).toEqual({
      coverage: 'full',
      coverage_method: 'manual',
      coverage_reason: 'Отмечено вами',
      missing_note: '',
      evidence: [],
      nearest: [],
    });
    expect(op(entry, 'eq')).toEqual(['id', 'q1']);
  });

  it('deletes an exam and fails loudly when nothing was deleted', async () => {
    db.respond = () => ({ data: [{ id: 'exam-1' }], error: null });
    await deleteExam('exam-1');
    db.respond = () => ({ data: [], error: null });
    await expect(deleteExam('exam-1')).rejects.toBeInstanceOf(ExamApiError);
  });
});

describe('loadExamBundle', () => {
  it('hands the questions over before it reads the lecture titles', async () => {
    db.respond = (entry) => {
      if (entry.table === 'exams') return { data: { ...exam }, error: null };
      if (entry.table === 'exam_questions') return { data: [question('q1', 1), question('q2', 2)], error: null };
      if (entry.table === 'exam_materials') return { data: [{ material_id: 'm-1' }], error: null };
      if (entry.table === 'materials') return { data: [{ id: 'm-1', title: 'Денежный рынок' }], error: null };
      return { data: null, error: null };
    };
    const seen: Array<{ ids: string[]; titlesRead: boolean }> = [];
    const bundle = await loadExamBundle('exam-1', {
      onQuestions: (questions) => seen.push({ ids: questions.map((item) => item.id), titlesRead: calls('materials').length > 0 }),
    });
    expect(seen).toEqual([{ ids: ['q1', 'q2'], titlesRead: false }]);
    expect(bundle?.materials).toEqual([{ id: 'm-1', title: 'Денежный рынок' }]);
    expect(calls('materials')).toHaveLength(1);
  });
});

describe('listExams', () => {
  it('counts coverage per exam and puts upcoming exams first', async () => {
    db.respond = (entry) => {
      if (entry.table === 'exams') {
        return {
          data: [
            { id: 'e-old', title: 'Старый', kind: 'credit', exam_date: '2020-01-10', created_at: '2019-12-01T00:00:00Z' },
            { id: 'e-none', title: 'Без даты', kind: 'exam', exam_date: null, created_at: '2026-09-01T00:00:00Z' },
            { id: 'e-next', title: 'Скоро', kind: 'exam', exam_date: '2999-01-10', created_at: '2026-08-01T00:00:00Z' },
          ],
          error: null,
        };
      }
      return {
        data: [
          { exam_id: 'e-next', question_hash: 'a'.repeat(32), coverage: 'full' },
          { exam_id: 'e-next', question_hash: 'b'.repeat(32), coverage: 'none' },
          { exam_id: 'e-next', question_hash: 'c'.repeat(32), coverage: null },
        ],
        error: null,
      };
    };
    const items = await listExams('user-1');
    expect(items.map((item) => item.id)).toEqual(['e-next', 'e-none', 'e-old']);
    expect(items[0]).toMatchObject({ total: 3, coverage: { full: 1, partial: 0, none: 1, unverified: 0, unmapped: 1 } });
    expect(items[0].hashes).toHaveLength(3);
    expect(items[1].total).toBe(0);
  });

  it('throws a plain error when the list cannot be read', async () => {
    db.respond = () => ({ data: null, error: { code: '500', message: 'boom' } });
    await expect(listExams('user-1')).rejects.toThrow('Не удалось загрузить экзамены. Проверьте связь и повторите.');
  });
});

describe('backend helpers', () => {
  it('posts a pasted list to /api/exams/parse and keeps the server detail of a 400', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body as FormData;
      expect(body.get('text')).toBe('1. Вопрос');
      return new Response(JSON.stringify({ detail: 'Не нашли ни одного вопроса. Проверьте текст.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(parseQuestionList({ text: '1. Вопрос' })).rejects.toThrow('Не нашли ни одного вопроса. Проверьте текст.');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/exams/parse');
  });

  it('turns a dropped connection into a plain message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    await expect(parseQuestionList({ text: 'x' })).rejects.toThrow('Нет связи с сервером. Проверьте интернет и повторите.');
  });

  it('normalises a parse result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      method: 'regex',
      questions: [{ position: 1, label: '1', text: ' Предмет. ', section: 1, flags: ['short'] }],
      sections: [{ index: 1, title: 'Раздел 1' }],
      tickets: [{ number: 1, positions: [1] }],
      warnings: [{ code: 'few_found', message: 'Нашли мало вопросов' }],
      source_text: 'x',
    }), { status: 200 })));
    const parsed = await parseQuestionList({ text: 'x' });
    expect(parsed.questions[0]).toEqual({ position: 1, label: '1', text: 'Предмет.', section: 1, flags: ['short'] });
    expect(parsed.tickets).toEqual([{ number: 1, positions: [1] }]);
  });

  it('imports a lecture as text only: extract, then a material without summary, cards or test', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ text: 'Текст лекции.\n\nВторой абзац.', length: 29, title_guess: 'Лекция 3. Денежный рынок', warnings: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    db.respond = () => ({ data: { id: 'm-new', created_at: '2026-10-03T10:00:00Z' }, error: null });

    const material = await importTextOnlyMaterial('user-1', new File(['%PDF'], 'lecture3.pdf', { type: 'application/pdf' }));

    expect(fetchMock.mock.calls[0][0]).toBe('/api/extract');
    const insert = op(calls('materials', 'insert')[0], 'insert')![0] as Record<string, unknown>;
    expect(insert).toMatchObject({
      user_id: 'user-1',
      title: 'Лекция 3. Денежный рынок',
      subject: '',
      original_text: 'Текст лекции.\n\nВторой абзац.',
      summary_json: { text_only: true },
      flashcards_json: { flashcards: [] },
      quiz_json: { quiz: [] },
    });
    expect(material).toMatchObject({ id: 'm-new', textOnly: true, fragments: 2 });
  });

  it('refuses a scan (no text) without inserting a material', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ detail: 'В файле не найден текст: похоже на скан.' }), { status: 422 }),
    ));
    await expect(importTextOnlyMaterial('user-1', new File(['x'], 'scan.pdf'))).rejects.toThrow('В файле не найден текст: похоже на скан.');
    expect(calls('materials')).toHaveLength(0);
  });

  it('prefetches an answer key with a fire-and-forget POST', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    prefetchRubric('exam-1', 'q-7');
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/oral/rubric');
    expect(JSON.parse(String(init?.body))).toEqual({ exam_id: 'exam-1', question_id: 'q-7', force: false });
  });

  it('swallows a failed prefetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    expect(() => prefetchRubric('exam-1', 'q-7')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('pure helpers', () => {
  it('counts fragments like build_source_chunks without a cap', () => {
    expect(countSourceFragments('')).toBe(0);
    expect(countSourceFragments('Первый абзац.\n\n   \n\nВторой абзац.\n \nТретий.')).toBe(3);
    const long = Array.from({ length: 400 }, () => 'слово').join(' '); // 2399 characters
    expect(countSourceFragments(long)).toBe(3);
    expect(countSourceFragments(Array.from({ length: 200 }, (_, i) => `Абзац ${i}.`).join('\n\n'))).toBe(200);
  });

  it('treats a running mapping as locked only for five minutes', () => {
    const now = Date.parse('2026-10-03T10:00:00Z');
    expect(isMappingLocked({ mapping_state: 'running', mapping_started_at: '2026-10-03T09:58:00Z' }, now)).toBe(true);
    expect(isMappingLocked({ mapping_state: 'running', mapping_started_at: '2026-10-03T09:54:00Z' }, now)).toBe(false);
    expect(isMappingLocked({ mapping_state: 'done', mapping_started_at: '2026-10-03T09:59:00Z' }, now)).toBe(false);
  });

  it('drops unusable coverage items', () => {
    expect(normalizeCoverageItem({ question_id: 'q', coverage: 'maybe' })).toBeNull();
    expect(normalizeCoverageItem({ question_id: 'q', coverage: 'none', method: 'lexical', nearest: [{ excerpt: 'ставка', matched: ['ставка', 3] }] })).toMatchObject({
      coverage: 'none',
      method: 'lexical',
      reused: false,
      nearest: [{ excerpt: 'ставка', matched: ['ставка'] }],
    });
  });
});
