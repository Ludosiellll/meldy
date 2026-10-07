import { describe, expect, it } from 'vitest';
import type { ExamBundle, ExamQuestion, ExamRow } from '../../api/exams';
import type { SheetQuestion } from './cheatSheet';
import {
  buildTeacherReport,
  csvCell,
  CSV_COLUMNS,
  evidenceCaption,
  GRADE_LINE,
  pointsNote,
  reportCsv,
  reportDocumentTitle,
  reportFileBase,
  reportRows,
  uncheckedLine,
  VERDICT_CELLS,
  VERDICT_TITLES,
  verdictOf,
  type ReportSheet,
} from './teacherReport';

// ------------------------------------------------------------------------------------ fixtures

const NOW = new Date(2026, 9, 7, 15, 20);
const MAPPED_AT = new Date(2026, 9, 7, 14, 2).toISOString();
const hash = (n: number) => n.toString(16).padStart(32, 'a');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function question(n: number, coverage: ExamQuestion['coverage'], overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  const covered = coverage === 'full' || coverage === 'partial';
  return {
    id: uuid(n),
    exam_id: 'exam-1',
    position: n,
    label: String(n),
    section: null,
    text: `Вопрос ${n} о денежном рынке`,
    question_hash: hash(n),
    coverage,
    coverage_method: coverage === null ? null : coverage === 'unverified' ? 'lexical' : 'llm',
    coverage_reason: coverage === 'full' ? 'Модель пишет: во фрагменте есть определение' : '',
    missing_note: coverage === 'partial' ? 'Нет примеров из практики' : '',
    evidence: covered ? [{ material_id: 'm1', material_title: 'Денежный рынок', source_id: `M1:S${n}`, excerpt: `Фрагмент лекции о вопросе ${n}.` }] : [],
    nearest: [],
    materials_fingerprint: 'fp',
    mapping_version: 1,
    mapped_at: coverage === null ? null : MAPPED_AT,
    created_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

const LECTURES = [
  { id: 'm2', title: 'Лекция 10. Инфляция' },
  { id: 'm1', title: 'Денежный рынок' },
  { id: 'm3', title: 'Лекция 2. Спрос на деньги' },
];

function bundle(questions: ExamQuestion[], exam: Partial<ExamRow> = {}, materials = LECTURES): ExamBundle {
  return {
    exam: {
      id: 'exam-1',
      title: 'Экзамен: макроэкономика',
      kind: 'exam',
      exam_date: '2027-01-24',
      source_kind: 'paste',
      source_text: '',
      ticket_layout: { mode: 'random', per_ticket: 2 },
      mapping_state: 'done',
      mapping_started_at: null,
      mapped_at: MAPPED_AT,
      mapped_material_ids: materials.map((item) => item.id),
      created_at: '2026-10-01T10:00:00Z',
      ...exam,
    },
    questions,
    materialIds: materials.map((item) => item.id),
    materials,
  };
}

function sheetQuestion(source: ExamQuestion, rubric: SheetQuestion['rubric'], overrides: Partial<SheetQuestion> = {}): SheetQuestion {
  return {
    question_id: source.id,
    position: source.position,
    label: source.label,
    section: source.section,
    text: source.text,
    question_hash: source.question_hash ?? '',
    coverage: source.coverage,
    coverage_method: source.coverage_method,
    coverage_reason: source.coverage_reason,
    missing_note: source.missing_note,
    rubric,
    ...overrides,
  };
}

function rubric(points: Array<{ title: string; essential?: boolean }>, coverage: 'full' | 'partial' | 'none' = 'full'): NonNullable<SheetQuestion['rubric']> {
  return {
    rubric_id: uuid(900),
    built_at: '2026-10-07T11:00:00Z',
    coverage,
    coverage_note: '',
    materials: [{ key: 'M1', material_id: 'm1', title: 'Денежный рынок' }],
    points: points.map((point, index) => ({
      id: `p${index + 1}`,
      title: point.title,
      short: '',
      essential: point.essential === true,
      source_quote: 'цитата',
      source_ids: ['M1:S1'],
    })),
  };
}

const READY_SHEET: ReportSheet = { status: 'ready', questions: [] };

// ------------------------------------------------------------------------------------ verdicts

describe('verdict words', () => {
  it('names every mapping result in plain words, a hand mark apart from a checked one', () => {
    expect(verdictOf(question(1, 'full'))).toBe('full');
    expect(verdictOf(question(1, 'full', { coverage_method: 'manual' }))).toBe('manual');
    expect(verdictOf(question(1, 'partial'))).toBe('partial');
    expect(verdictOf(question(1, 'none'))).toBe('none');
    expect(verdictOf(question(1, 'none', { coverage_method: 'lexical' }))).toBe('none');
    expect(verdictOf(question(1, 'unverified'))).toBe('words');
    expect(verdictOf(question(1, null))).toBe('unmapped');
    expect(VERDICT_TITLES).toEqual({
      full: 'Есть в лекциях',
      partial: 'Есть частично',
      none: 'Нет в лекциях',
      words: 'Проверено только по словам',
      manual: 'Отмечено студентом',
      unmapped: 'Не сверено',
    });
    expect(VERDICT_CELLS.none).toBe('нет');
    expect(Object.values(VERDICT_CELLS).filter((cell) => cell.startsWith('не проверено'))).toHaveLength(3);
  });

  it('never grades: no marks 2–5 and no «засчитано» in any word of the report', () => {
    const words = [...Object.values(VERDICT_TITLES), ...Object.values(VERDICT_CELLS), GRADE_LINE, ...CSV_COLUMNS].join(' ');
    expect(words).not.toMatch(/засчита|оценка|балл|\b[2-5]\b/i);
    expect(GRADE_LINE).toBe('Отметку ставит преподаватель; Meldy проверяет только, назвали ли пункты из своих лекций');
  });

  it('says plainly why a question is not in the lectures, with the number of lectures', () => {
    const report = buildTeacherReport({
      bundle: bundle([
        question(1, 'none', { coverage_reason: 'Ни одного фрагмента с этими словами', coverage_method: 'lexical' }),
        question(2, 'none', { coverage_reason: 'Нет подтверждающего фрагмента' }),
        question(3, 'none', { coverage_reason: 'Во фрагментах лекций нет ответа на этот вопрос' }),
      ]),
      sheet: READY_SHEET,
      now: NOW,
    });
    expect(report.items.map((item) => item.note)).toEqual([
      'Ни в одной из 3 лекций нет фрагмента с этими словами.',
      'Похожие места есть, но нет фрагмента, который подтверждает ответ.',
      'Ни в одной из 3 лекций нет фрагмента об этом.',
    ]);
    expect(report.items.every((item) => item.evidence.length === 0)).toBe(true);
    const one = buildTeacherReport({ bundle: bundle([question(1, 'none')], {}, [LECTURES[1]]), sheet: READY_SHEET, now: NOW });
    expect(one.items[0].note).toBe('В лекции нет фрагмента об этом.');
    const twentyOne = buildTeacherReport({
      bundle: bundle([question(1, 'none')], {}, Array.from({ length: 21 }, (_, index) => ({ id: `m${index}`, title: `Лекция ${index}` }))),
      sheet: READY_SHEET,
      now: NOW,
    });
    expect(twentyOne.items[0].note).toBe('Ни в одной из 21 лекции нет фрагмента об этом.');
  });

  it('keeps the model’s explanation out: a quote is the lecture’s own fragment with its lecture and number', () => {
    const report = buildTeacherReport({
      bundle: bundle([
        question(1, 'full', {
          evidence: [
            { material_id: 'm1', material_title: 'Денежный рынок', source_id: 'M1:S14', excerpt: 'Денежный мультипликатор\nпоказывает, во сколько раз\nденежная масса больше базы.' },
          ],
        }),
      ]),
      sheet: READY_SHEET,
      now: NOW,
    });
    const [item] = report.items;
    expect(item.evidence).toEqual([
      {
        materialId: 'm1',
        lecture: 'Денежный рынок',
        fragment: 14,
        removed: false,
        heading: null,
        body: 'Денежный мультипликатор показывает, во сколько раз денежная масса больше базы.',
        headingFocus: null,
        bodyFocus: null,
      },
    ]);
    expect(JSON.stringify(item)).not.toContain('Модель пишет');
    expect(evidenceCaption(item.evidence[0])).toBe('Лекция «Денежный рынок», фрагмент 14');
  });

  it('prints the whole fragment and knows where the verified quote is in it (evidence focus)', () => {
    const excerpt =
      'Связь M:N распадается на две связи 1:N. 7. Ограничения целостности Ограничения целостности — правила, которым должны удовлетворять данные в любой момент времени. СУБД проверяет их сама.';
    const quote = 'Ограничения целостности — правила, которым должны удовлетворять данные в любой момент времени';
    const start = excerpt.indexOf(quote);
    const report = buildTeacherReport({
      bundle: bundle([
        question(1, 'full', {
          evidence: [{ material_id: 'm1', material_title: 'Реляционная модель', source_id: 'S15', excerpt, focus: [start, start + quote.length] }],
        }),
        question(2, 'full', {
          evidence: [{ material_id: 'm1', material_title: 'Реляционная модель', source_id: 'S16', excerpt: 'Уровень изоляции | Фантомное чтение\nSERIALIZABLE | нет' }],
        }),
      ]),
      sheet: READY_SHEET,
      now: NOW,
    });
    const [first, second] = report.items.map((item) => item.evidence[0]);
    expect(first.body).toBe(excerpt);
    expect(first.bodyFocus && first.body.slice(first.bodyFocus[0], first.bodyFocus[1])).toBe(quote);
    // A table row reads «ячейка — ячейка; …», in print and in the CSV; a row mapped before the place was stored has none.
    expect(second.body).toBe('Уровень изоляции — Фантомное чтение; SERIALIZABLE — нет');
    expect(second.bodyFocus).toBeNull();
    expect(reportRows(report)[2][5]).toBe('Уровень изоляции — Фантомное чтение; SERIALIZABLE — нет');
  });

  it('keeps the lecture’s own heading on its line and labels a lecture taken out of the exam', () => {
    const report = buildTeacherReport({
      bundle: bundle([
        question(1, 'full', {
          evidence: [{ material_id: 'gone', material_title: 'Старая лекция', source_id: 'S3', excerpt: 'Обучение нейронной сети\nОбучение сети заключается в подборе весов по примерам.' }],
        }),
      ]),
      sheet: READY_SHEET,
      now: NOW,
    });
    const [evidence] = report.items[0].evidence;
    expect(evidence.heading).toBe('Обучение нейронной сети');
    expect(evidence.body).toBe('Обучение сети заключается в подборе весов по примерам.');
    expect(evidenceCaption(evidence)).toBe('Лекция «Старая лекция», фрагмент 3 — лекция убрана из экзамена');
    expect(evidenceCaption({ lecture: '', fragment: null, removed: false })).toBe('Лекция «без названия», фрагмент');
    // A title that says «Лекция» itself is not prefixed twice.
    expect(evidenceCaption({ lecture: 'Лекция 3. Инфляция', fragment: 4, removed: false })).toBe('«Лекция 3. Инфляция», фрагмент 4');
    expect(evidenceCaption({ lecture: 'Лекции по праву', fragment: 2, removed: false })).toBe('Лекция «Лекции по праву», фрагмент 2');
  });

  it('a «частично» question says what is missing; other verdicts do not', () => {
    const report = buildTeacherReport({
      bundle: bundle([question(1, 'partial'), question(2, 'full', { missing_note: 'что-то' }), question(3, 'partial', { missing_note: '' })]),
      sheet: READY_SHEET,
      now: NOW,
    });
    expect(report.items.map((item) => item.missing)).toEqual(['примеров из практики', '', '']);
  });

  it('a question without quotes says why where the quote would be', () => {
    const report = buildTeacherReport({
      bundle: bundle([
        question(1, 'unverified', { nearest: [{ material_id: 'm1', material_title: 'Денежный рынок', source_id: 'S2', excerpt: 'Спрос', matched: ['спрос'] }] }),
        question(2, 'full', { coverage_method: 'manual', evidence: [] }),
        question(3, null),
        question(4, 'full', { evidence: [] }),
      ]),
      sheet: READY_SHEET,
      now: NOW,
    });
    expect(report.items.map((item) => item.verdict)).toEqual(['words', 'manual', 'unmapped', 'full']);
    expect(report.items.map((item) => item.note)).toEqual([
      'ИИ не проверил этот вопрос: он сопоставлен с лекциями только по совпадению слов.',
      'Студент сам отметил, что ответ есть в лекциях. Meldy это не проверял.',
      'Вопрос ещё не сверен с лекциями.',
      'Цитата не сохранилась.',
    ]);
    expect(report.items[0].nearest?.source_id).toBe('S2');
    expect(report.items[1].nearest).toBeNull();
  });
});

// ------------------------------------------------------------------------------------ counts and header

describe('the header', () => {
  it('counts есть / частично / нет / not checked by the model, and says what the last group is made of', () => {
    const report = buildTeacherReport({
      bundle: bundle([
        question(1, 'full'),
        question(2, 'full'),
        question(3, 'partial'),
        question(4, 'none'),
        question(5, 'unverified'),
        question(6, 'unverified'),
        question(7, 'full', { coverage_method: 'manual', evidence: [] }),
      ]),
      sheet: READY_SHEET,
      now: NOW,
    });
    expect(report.counts).toEqual({ total: 7, full: 2, partial: 1, none: 1, unchecked: 3, words: 2, manual: 1, unmapped: 0 });
    expect(uncheckedLine(report.counts)).toBe('Не проверено ИИ: 2 — только по словам, 1 — отмечен студентом.');
    expect(uncheckedLine({ ...report.counts, unchecked: 0, words: 0, manual: 0 })).toBeNull();
    expect(uncheckedLine({ total: 5, full: 0, partial: 0, none: 0, unchecked: 5, words: 0, manual: 2, unmapped: 3 })).toBe(
      'Не проверено ИИ: 2 — отмечены студентом, 3 — ещё не сверены.',
    );
  });

  it('names the exam, its kind and day, the mapping date with the year and the moment it was made', () => {
    const report = buildTeacherReport({ bundle: bundle([question(1, 'full')]), sheet: READY_SHEET, now: NOW });
    expect(report.title).toBe('Макроэкономика');
    expect(report.kind).toBe('Экзамен');
    expect(report.examDay).toBe('24 января 2027');
    expect(report.mappedAt).toBe('7 октября 2026, 14:02');
    expect(report.madeAt).toBe('7 октября 2026, 15:20');
    expect(report.madeOn).toBe('2026-10-07');
    const undated = buildTeacherReport({ bundle: bundle([question(1, 'full')], { exam_date: null, kind: 'credit' }), sheet: READY_SHEET, now: NOW });
    expect(undated.examDay).toBe('');
    expect(undated.kind).toBe('Зачёт');
  });

  it('dates a mapping that left no date on the exam by its oldest mark', () => {
    const report = buildTeacherReport({
      bundle: bundle(
        [
          question(1, 'full', { mapped_at: new Date(2026, 9, 6, 9, 40).toISOString() }),
          question(2, 'none', { mapped_at: new Date(2026, 9, 6, 9, 5).toISOString() }),
          question(3, null),
        ],
        { mapped_at: null, mapping_state: 'running', mapped_material_ids: [] },
      ),
      sheet: READY_SHEET,
      now: NOW,
    });
    expect(report.mappedAt).toBe('6 октября 2026, 9:05');
  });

  it('lists the lectures in a natural order with how many questions quote each, and flags changes after the mapping', () => {
    const report = buildTeacherReport({
      bundle: bundle(
        [
          question(1, 'full'),
          question(2, 'partial', {
            evidence: [
              { material_id: 'm1', material_title: 'Денежный рынок', source_id: 'S2', excerpt: 'а' },
              { material_id: 'm1', material_title: 'Денежный рынок', source_id: 'S3', excerpt: 'б' },
              { material_id: 'old', material_title: 'Убранная лекция', source_id: 'S9', excerpt: 'в' },
            ],
          }),
          question(3, 'none'),
        ],
        { mapped_material_ids: ['m1', 'm2', 'old'] },
      ),
      sheet: READY_SHEET,
      now: NOW,
    });
    expect(report.lectures).toEqual([
      { id: 'm1', title: 'Денежный рынок', cited: 2, addedAfter: false, removed: false },
      { id: 'm3', title: 'Лекция 2. Спрос на деньги', cited: 0, addedAfter: true, removed: false },
      { id: 'm2', title: 'Лекция 10. Инфляция', cited: 0, addedAfter: false, removed: false },
      { id: 'old', title: 'Убранная лекция', cited: 1, addedAfter: false, removed: true },
    ]);
    expect(report.notes).toContain('После сверки добавлена 1 лекция, убрана 1 лекция: отчёт показывает сверку с прежним набором лекций.');
    const two = buildTeacherReport({
      bundle: bundle([question(1, 'full')], { mapped_material_ids: ['m1'] }),
      sheet: READY_SHEET,
      now: NOW,
    });
    expect(two.notes).toEqual(['После сверки добавлено 2 лекции: отчёт показывает сверку с прежним набором лекций.']);
  });

  it('prints section headings once, before the first question of each section', () => {
    const report = buildTeacherReport({
      bundle: bundle(
        [question(1, 'full', { section: 1 }), question(2, 'full', { section: 1 }), question(3, 'none', { section: 2 }), question(4, 'none', { section: 3 })],
        { ticket_layout: { mode: 'sections', per_ticket: 3, section_titles: ['Деньги', ' Инфляция '] } },
      ),
      sheet: READY_SHEET,
      now: NOW,
    });
    expect(report.items.map((item) => item.sectionTitle)).toEqual(['Деньги', null, 'Инфляция', 'Раздел 3']);
  });

  it('numbers questions by the department’s labels, else by position', () => {
    const report = buildTeacherReport({
      bundle: bundle([question(1, 'full', { label: '5.' }), question(2, 'full', { label: '12а)' }), question(3, 'full', { label: '' })]),
      sheet: READY_SHEET,
      now: NOW,
    });
    expect(report.items.map((item) => item.number)).toEqual(['5', '12а', '3']);
  });
});

// ------------------------------------------------------------------------------------ states

describe('states', () => {
  it('an exam not mapped yet is an empty state, not a report of «не сверено»', () => {
    const report = buildTeacherReport({ bundle: bundle([question(1, null), question(2, null)], { mapping_state: 'none', mapped_at: null }), sheet: READY_SHEET, now: NOW });
    expect(report.state).toBe('unmapped');
    expect(report.mapping).toBe('none');
    expect(report.notes).toEqual([]);
  });

  it('no lectures and no questions come before everything else', () => {
    expect(buildTeacherReport({ bundle: bundle([question(1, 'full')], {}, []), sheet: READY_SHEET, now: NOW }).state).toBe('no-lectures');
    expect(buildTeacherReport({ bundle: bundle([], {}, []), sheet: READY_SHEET, now: NOW }).state).toBe('no-questions');
  });

  it('an interrupted mapping: the checked questions, the rest marked «не сверено», and a note that says how far it got', () => {
    const report = buildTeacherReport({
      bundle: bundle([question(1, 'full'), question(2, 'none'), question(3, null), question(4, null)], { mapping_state: 'failed' }),
      sheet: READY_SHEET,
      now: NOW,
    });
    expect(report.state).toBe('ready');
    expect(report.mapping).toBe('interrupted');
    expect(report.notes[0]).toBe('Сверка прервалась: проверено 2 из 4 вопросов. Остальные отмечены «не сверено».');
    expect(report.items[2].note).toBe('Сверка прервалась раньше, чем дошла до этого вопроса.');
    expect(report.counts.unmapped).toBe(2);
    // A lock nobody holds any more is an interrupted run too.
    const stale = buildTeacherReport({ bundle: bundle([question(1, 'full'), question(2, null)], { mapping_state: 'running' }), sheet: READY_SHEET, now: NOW });
    expect(stale.mapping).toBe('interrupted');
    // Interrupted before the first question: the empty state says so.
    const none = buildTeacherReport({ bundle: bundle([question(1, null)], { mapping_state: 'failed', mapped_at: null }), sheet: READY_SHEET, now: NOW });
    expect(none.state).toBe('unmapped');
    expect(none.mapping).toBe('interrupted');
  });

  it('a mapping going on now: the report says how far it had got when the report was made', () => {
    const report = buildTeacherReport({
      bundle: bundle([question(1, 'full'), question(2, null), question(3, null)], { mapping_state: 'running' }),
      sheet: READY_SHEET,
      running: true,
      now: NOW,
    });
    expect(report.mapping).toBe('running');
    expect(report.notes[0]).toBe('Сверка ещё шла, когда составлен отчёт: проверено 1 из 3 вопросов.');
    expect(report.items[1].note).toBe('Сверка до этого вопроса ещё не дошла.');
  });

  it('questions added after a finished mapping are counted as not mapped yet', () => {
    const report = buildTeacherReport({ bundle: bundle([question(1, 'full'), question(2, null)], { mapping_state: 'partial' }), sheet: READY_SHEET, now: NOW });
    expect(report.mapping).toBe('done');
    expect(report.notes).toEqual(['1 вопрос ещё не сверен с лекциями: в отчёте он отмечен «не сверено».']);
    const three = buildTeacherReport({
      bundle: bundle([question(1, 'full'), question(2, null), question(3, null), question(4, null)], { mapping_state: 'done' }),
      sheet: READY_SHEET,
      now: NOW,
    });
    expect(three.notes).toEqual(['3 вопроса ещё не сверены с лекциями: в отчёте они отмечены «не сверено».']);
  });
});

// ------------------------------------------------------------------------------------ points

describe('answer points', () => {
  const written = question(1, 'full');
  const partial = question(2, 'partial');
  const gap = question(3, 'full');
  const unwritten = question(4, 'full');
  const rebuilt = question(5, 'partial');
  const none = question(6, 'none');
  const exam = bundle([written, partial, gap, unwritten, rebuilt, none]);

  it('lists written points in order with the main ones marked; says plainly when they are not written yet', () => {
    const report = buildTeacherReport({
      bundle: exam,
      sheet: {
        status: 'ready',
        questions: [
          sheetQuestion(written, rubric([{ title: ' Денежный мультипликатор — отношение массы к базе ', essential: true }, { title: 'Зависит от нормы резервов' }])),
          sheetQuestion(partial, rubric([{ title: 'Определение', essential: true }], 'partial')),
          sheetQuestion(gap, rubric([], 'none')),
          sheetQuestion(unwritten, null),
          sheetQuestion(rebuilt, null, { rebuilt: true }),
          sheetQuestion(none, null),
        ],
      },
      now: NOW,
    });
    expect(report.items.map((item) => item.points)).toEqual([
      { kind: 'written', points: [{ text: 'Денежный мультипликатор — отношение массы к базе', main: true }, { text: 'Зависит от нормы резервов', main: false }] },
      { kind: 'written', points: [{ text: 'Определение', main: true }] },
      { kind: 'none' },
      { kind: 'unwritten' },
      { kind: 'unwritten' },
      { kind: 'none' },
    ]);
    expect(pointsNote({ kind: 'unwritten' })).toBe('Пункты ещё не написаны.');
    expect(pointsNote({ kind: 'none' })).toBe('Пунктов нет: в лекциях не нашлось, из чего их составить.');
    expect(pointsNote({ kind: 'unknown' })).toBe('Пункты не загрузились.');
    expect(pointsNote({ kind: 'loading' })).toBe('Пункты загружаются…');
    expect(pointsNote({ kind: 'written', points: [] })).toBe('');
  });

  it('a cheat sheet that did not load leaves the points unknown and says so once at the top', () => {
    const report = buildTeacherReport({ bundle: exam, sheet: { status: 'error' }, now: NOW });
    expect(report.items.every((item) => item.points.kind === 'unknown')).toBe(true);
    expect(report.notes).toEqual(['Пункты ответов не загрузились, поэтому в отчёте их нет.']);
  });

  it('a cheat sheet still being read: the points are on their way, nothing is claimed about them', () => {
    const report = buildTeacherReport({ bundle: exam, sheet: { status: 'loading' }, now: NOW });
    expect(report.items.every((item) => item.points.kind === 'loading')).toBe(true);
    expect(report.notes).toEqual([]);
  });

  it('a sheet being written says that some points are still coming', () => {
    const report = buildTeacherReport({ bundle: exam, sheet: { status: 'ready', questions: [], writing: true }, now: NOW });
    expect(report.notes).toEqual(['Пункты ответов ещё пишутся: у части вопросов их пока нет.']);
  });
});

// ------------------------------------------------------------------------------------ CSV

describe('CSV', () => {
  it('escapes quotes, line breaks, semicolons, commas and edge spaces; leaves plain text as it is', () => {
    expect(csvCell('Денежный рынок')).toBe('Денежный рынок');
    expect(csvCell('цена; спрос')).toBe('"цена; спрос"');
    expect(csvCell('спрос, предложение')).toBe('"спрос, предложение"');
    expect(csvCell('термин «ВВП» и "кавычки"')).toBe('"термин «ВВП» и ""кавычки"""');
    expect(csvCell('строка 1\nстрока 2')).toBe('"строка 1\nстрока 2"');
    expect(csvCell('строка 1\r\nстрока 2\rстрока 3')).toBe('"строка 1\nстрока 2\nстрока 3"');
    expect(csvCell(' отступ')).toBe('" отступ"');
    expect(csvCell('')).toBe('');
  });

  it('a cell that starts like a formula is shown as text', () => {
    expect(csvCell('=СУММ(A1:A3)')).toBe("'=СУММ(A1:A3)");
    expect(csvCell('- первый пункт')).toBe("'- первый пункт");
    expect(csvCell('+7 999')).toBe("'+7 999");
    expect(csvCell('@user')).toBe("'@user");
    expect(csvCell('=a;b')).toBe('"\'=a;b"');
    expect(csvCell('—тире')).toBe('—тире');
  });

  it('is UTF-8 with a BOM, «;» between cells, CRLF between rows, the agreed columns with the teacher’s two left empty', () => {
    const q = question(1, 'partial', { text: 'Спрос на деньги: виды; мотивы', missing_note: 'спекулятивного спроса' });
    const report = buildTeacherReport({
      bundle: bundle([q]),
      sheet: { status: 'ready', questions: [sheetQuestion(q, rubric([{ title: 'Трансакционный спрос', essential: true }, { title: 'Спрос из предосторожности' }]))] },
      now: NOW,
    });
    const csv = reportCsv(report);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith('\r\n')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('№;вопрос;есть в лекциях;лекция;фрагмент;цитата;чего не хватает;пункты;пометка преподавателя;комментарий');
    expect(lines[1]).toBe(
      '1;"Спрос на деньги: виды; мотивы";частично;Денежный рынок;1;Фрагмент лекции о вопросе 1.;спекулятивного спроса;"1. Трансакционный спрос (главный)\n2. Спрос из предосторожности";;',
    );
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
  });

  it('one row per question in list order, every verdict and the points that are not there', () => {
    const questions = [
      question(1, 'full'),
      question(2, 'none'),
      question(3, 'unverified'),
      question(4, 'full', { coverage_method: 'manual', evidence: [] }),
      question(5, null),
    ];
    const report = buildTeacherReport({ bundle: bundle(questions, { mapping_state: 'failed' }), sheet: { status: 'ready', questions: questions.map((item) => sheetQuestion(item, null)) }, now: NOW });
    const rows = reportRows(report);
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows.slice(1).map((row) => [row[0], row[2], row[7]])).toEqual([
      ['1', 'есть', 'ещё не написаны'],
      ['2', 'нет', 'нет: ответа в лекциях не нашлось'],
      ['3', 'не проверено: только по словам', 'ещё не написаны'],
      ['4', 'не проверено: отмечено студентом', 'ещё не написаны'],
      ['5', 'не проверено: не сверено', 'ещё не написаны'],
    ]);
    expect(rows.slice(2).every((row) => row[3] === '' && row[4] === '' && row[5] === '')).toBe(true);
    expect(rows.every((row) => row.length === CSV_COLUMNS.length)).toBe(true);
    expect(rows.slice(1).every((row) => row[8] === '' && row[9] === '')).toBe(true);
    const failedSheet = buildTeacherReport({ bundle: bundle([question(1, 'full')]), sheet: { status: 'error' }, now: NOW });
    expect(reportRows(failedSheet)[1][7]).toBe('не загрузились');
  });

  it('several quotes: each lecture once, its fragment numbers grouped, every quote captioned', () => {
    const q = question(1, 'full', {
      evidence: [
        { material_id: 'm1', material_title: 'Денежный рынок', source_id: 'S12', excerpt: 'Первый фрагмент.' },
        { material_id: 'm2', material_title: 'Инфляция', source_id: 'S4', excerpt: 'Заголовок раздела\nВторой фрагмент лекции, где есть часть ответа на вопрос.' },
        { material_id: 'm1', material_title: 'Денежный рынок', source_id: 'S14', excerpt: 'Третий фрагмент.' },
      ],
    });
    const row = reportRows(buildTeacherReport({ bundle: bundle([q]), sheet: READY_SHEET, now: NOW }))[1];
    expect(row[3]).toBe('Денежный рынок; Инфляция');
    expect(row[4]).toBe('12, 14; 4');
    expect(row[5]).toBe(
      '[Лекция «Денежный рынок», фрагмент 12]\nПервый фрагмент.\n\n[Лекция «Инфляция», фрагмент 4]\nЗаголовок раздела\nВторой фрагмент лекции, где есть часть ответа на вопрос.\n\n[Лекция «Денежный рынок», фрагмент 14]\nТретий фрагмент.',
    );
  });

  it('builds 150 questions in one pass', () => {
    const questions = Array.from({ length: 150 }, (_, index) => question(index + 1, (['full', 'partial', 'none', 'unverified', null] as const)[index % 5]));
    const report = buildTeacherReport({ bundle: bundle(questions), sheet: READY_SHEET, now: NOW });
    expect(report.items).toHaveLength(150);
    expect(reportCsv(report).split('\r\n')).toHaveLength(152);
  });
});

describe('names', () => {
  it('the file and the page title name the subject, without characters a file system refuses', () => {
    const report = buildTeacherReport({ bundle: bundle([question(1, 'full')], { title: 'Экзамен: Право/История: 1*2?' }), sheet: READY_SHEET, now: NOW });
    expect(reportFileBase(report)).toBe('Отчёт сверки - Право История 1 2 - 2026-10-07');
    expect(reportDocumentTitle(report)).toBe('Отчёт сверки — Право/История: 1*2?');
  });
});
