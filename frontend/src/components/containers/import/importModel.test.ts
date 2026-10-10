import { describe, expect, it } from 'vitest';
import twoSubjects from '../../../../../contracts/container/parse_bank_two_subjects.json';
import openList from '../../../../../contracts/container/parse_bank_open.json';
import type { BankItem, BankParseResult } from '../../../types/container';
import {
  deriveSubjects,
  draftPlanInput,
  isSingleOralList,
  itemInputs,
  needsOrder,
  newImportId,
  NO_EDITS,
  queueOf,
  shortForms,
  spotCheck,
  totalsOf,
  type ImportEdits,
  type ImportFile,
} from './importModel';
import { subjectFromFileName } from './subjectName';

const TWO = twoSubjects as unknown as BankParseResult;
const OPEN = openList as unknown as BankParseResult;

function file(result: BankParseResult, extra: Partial<ImportFile> = {}): ImportFile {
  return { id: 'f1', name: 'Сети.docx', importId: 'imp-test', source: 'file', format: 'auto', keyText: '', result, ...extra };
}

function item(position: number, patch: Partial<BankItem> = {}): BankItem {
  return {
    position,
    label: String(position),
    subject: 1,
    topic: 1,
    kind: 'single',
    text: `Вопрос ${position}?`,
    options: ['один', 'два', 'три', 'четыре'],
    correct: [1],
    order: [],
    pairs: [],
    answer: null,
    evidence: 'bold',
    flags: [],
    code: false,
    where: '',
    marks: { bold: [0, 1, 0, 0] },
    ...patch,
  };
}

function bank(items: BankItem[], patch: Partial<BankParseResult> = {}): BankParseResult {
  const topics = Array.from(new Set(items.map((entry) => entry.topic).filter((topic): topic is number => topic !== null))).map((index) => ({
    index,
    title: `Тема ${index}`,
    subject: items.find((entry) => entry.topic === index)?.subject ?? 1,
    items: items.filter((entry) => entry.topic === index).length,
  }));
  return {
    method: 'rules',
    layout: 'numbered_paragraphs',
    layouts_seen: {},
    confidence: 1,
    key_source: { bold: items.length },
    format_signal: 'bold',
    format_signals: { bold: { one: items.length, many: 0, all: 0 }, underline: { one: 3, many: 0, all: 0 } },
    mark_share: 0.6,
    marker: null,
    markers: [],
    subjects: [{ index: 1, title: null, evidence: 'none', items: items.length }],
    topics,
    skipped: [],
    warnings: [],
    items,
    stats: { items: items.length, with_key: items.length, no_key: 0, ambiguous: 0, to_check: 0, duplicates: 0, kinds: {}, options: {}, gaps: [], key_lists: 0 },
    ...patch,
  };
}

describe('deriveSubjects: the contract samples', () => {
  it('reads two subjects from headings, numbers topics per subject and maps every item to ItemInput', () => {
    const subjects = deriveSubjects([file(TWO)]);
    expect(subjects.map((subject) => [subject.title, subject.titleFrom, subject.test.length, subject.oral.length])).toEqual([
      ['Основы программирования', 'heading', 12, 0],
      ['История Беларуси', 'heading', 6, 0],
    ]);
    expect(subjects[0].topics).toEqual(['Тема 1. Директивы и пространства имён', 'Тема 2. Делегаты и события', 'Тема 3. Строки']);
    // The second subject's topics 4 and 5 of the file are its topics 1 and 2.
    expect(subjects[1].topics).toEqual(['Раздел 1. Древняя Русь', 'Раздел 2. ВКЛ']);
    expect(subjects[1].test.map((entry) => entry.topic)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(subjects[0].keySource).toBe('bold');

    const inputs = itemInputs(subjects[0], 'imp-a1');
    expect(inputs).toHaveLength(12);
    expect(inputs[0]).toEqual({
      ref: 'imp-a1:1',
      stem: 'Какие символы открывают однострочный комментарий в C#?',
      options: ['//', '#', '--', '%'],
      correct: [0],
      kind: 'single',
      file_no: '1',
      topic: 1,
      key_source: 'bold',
      code: false,
      keep_order: false,
      flags: [],
    });
    expect(inputs.every((input) => /^[A-Za-z0-9_:.-]{1,80}$/.test(input.ref))).toBe(true);
    const multiple = subjects.flatMap((subject) => itemInputs(subject, 'x')).filter((input) => input.kind === 'multiple');
    expect(multiple).toHaveLength(1);
    expect(multiple[0].correct.length).toBeGreaterThan(1);
    expect(queueOf(subjects)).toEqual([]);
    expect(isSingleOralList(subjects)).toBe(false);
  });

  it('an open list is one oral subject: today’s oral exam (decision 21)', () => {
    const subjects = deriveSubjects([file(OPEN)]);
    expect(subjects).toHaveLength(1);
    expect(subjects[0].test).toEqual([]);
    expect(subjects[0].oral).toHaveLength(7);
    expect(subjects[0].oralSections).toEqual(['Раздел 1. Язык C#', 'Раздел 2. События и делегаты']);
    expect(subjects[0].oral.map((question) => question.section)).toEqual([1, 1, 1, 1, 2, 2, 2]);
    expect(isSingleOralList(subjects)).toBe(true);
    expect(totalsOf(subjects)).toMatchObject({ subjects: 1, found: 7, test: 0, oral: 7 });
  });
});

describe('deriveSubjects: decisions 5, 6 and 7', () => {
  it('splits more than 150 open questions of one subject into parts of 150 (decision 5, design table N7)', () => {
    const items = Array.from({ length: 320 }, (_, index) =>
      item(index + 1, { kind: 'open', options: [], correct: [], evidence: '', marks: {}, topic: index < 200 ? 1 : 2 }),
    );
    const subjects = deriveSubjects([file(bank(items, { subjects: [{ index: 1, title: 'Гражданское право', evidence: 'heading', items: 320 }] }))]);
    expect(subjects.map((subject) => [subject.title, subject.oral.length, subject.oralRange])).toEqual([
      ['Гражданское право, часть 1', 150, [1, 150]],
      ['Гражданское право, часть 2', 150, [151, 300]],
      ['Гражданское право, часть 3', 20, [301, 320]],
    ]);
    expect(subjects[1].oralSections).toEqual(['Тема 1', 'Тема 2']);
    expect(isSingleOralList(subjects)).toBe(false);
    // A part can be renamed and removed on its own.
    const edits: ImportEdits = { ...NO_EDITS, subjects: { 'f1:1#2': { title: 'Право, билеты 151–300' }, 'f1:1#3': { removed: true } } };
    const edited = deriveSubjects([file(bank(items, { subjects: [{ index: 1, title: 'Гражданское право', evidence: 'heading', items: 320 }] }))], edits);
    expect(edited[1].title).toBe('Право, билеты 151–300');
    expect(edited[2].removed).toBe(true);
    expect(totalsOf(edited).oral).toBe(300);
  });

  it('keeps the questions with variants with part 1 of a long mixed subject', () => {
    const items = [
      ...Array.from({ length: 10 }, (_, index) => item(index + 1)),
      ...Array.from({ length: 160 }, (_, index) => item(index + 11, { kind: 'open', options: [], correct: [], evidence: '', marks: {} })),
    ];
    const subjects = deriveSubjects([file(bank(items, { subjects: [{ index: 1, title: 'Сети', evidence: 'heading', items: 170 }] }))]);
    expect(subjects.map((subject) => [subject.title, subject.test.length, subject.oral.length])).toEqual([
      ['Сети, часть 1', 10, 150],
      ['Сети, часть 2', 0, 10],
    ]);
  });

  it('maps kinds: truefalse → single, a short answer → short, order and match are not saved (decision 6)', () => {
    const items = [
      item(1, { kind: 'truefalse', options: ['Верно', 'Неверно'], correct: [0], evidence: 'gift' }),
      item(2, { kind: 'open', options: [], correct: [], answer: 'Invoke; invoke()', evidence: 'gift', marks: {} }),
      item(3, { kind: 'open', options: [], correct: [], text: 'Впишите ключевое слово: ___ string', answer: 'using', evidence: 'answer_line', marks: {} }),
      item(4, { kind: 'order', options: ['а', 'б', 'в'], correct: [], order: [2, 0, 1] }),
      item(5, { kind: 'match', options: [], correct: [], pairs: [['А', '1']] }),
      item(6, { kind: 'open', options: [], correct: [], text: 'Расскажите о сделках.', answer: 'Сделка — это действие, направленное на установление, изменение или прекращение прав и обязанностей.', evidence: 'answer_line', marks: {} }),
    ];
    const [subject] = deriveSubjects([file(bank(items))]);
    expect(subject.test.map((entry) => [entry.position, entry.kind])).toEqual([
      [1, 'single'],
      [2, 'short'],
      [3, 'short'],
    ]);
    expect(subject.skippedKinds).toBe(2);
    expect(subject.oral.map((question) => question.position)).toEqual([6]);
    expect(subject.answerDropped).toBe(1);
    const inputs = itemInputs(subject, 'imp');
    expect(inputs[0]).toMatchObject({ kind: 'single', options: ['Верно', 'Неверно'], correct: [0], key_source: 'gift' });
    expect(inputs[1]).toMatchObject({ kind: 'short', options: [], correct: [], answers: ['Invoke', 'invoke()'], key_source: 'gift' });
    expect(inputs[2]).toMatchObject({ kind: 'short', answers: ['using'], key_source: 'answer_line' });
    expect(totalsOf([subject]).skippedKinds).toBe(2);
  });

  it('saves an image question without its key until the author says it reads without the image (decision 7)', () => {
    const items = [item(1, { flags: ['has_image'] }), item(2)];
    const [subject] = deriveSubjects([file(bank(items))]);
    expect(subject.imageLost).toBe(1);
    expect(subject.test[0].problems[0]).toBe('image');
    const [lost] = itemInputs(subject, 'imp');
    expect(lost).toMatchObject({ correct: [], key_source: 'none' });
    expect(lost.flags).toContain('has_image');
    expect(totalsOf([subject]).imageLost.map((entry) => entry.label)).toEqual(['1']);

    const fixed = deriveSubjects([file(bank(items))], { ...NO_EDITS, items: { 'f1:1': { imageOk: true } } });
    const [kept] = itemInputs(fixed[0], 'imp');
    expect(kept).toMatchObject({ correct: [1], key_source: 'bold' });
    expect(kept.flags).not.toContain('has_image');
    expect(fixed[0].test[0].problems).toEqual([]);
  });
});

describe('deriveSubjects: keys and problems', () => {
  it('a checkbox in the file is a marker; «Все перечисленные» keeps the order', () => {
    const items = [
      item(1, { evidence: 'checkbox', options: ['кошка', 'собака', 'Все перечисленные'], correct: [2] }),
      item(2, { options: ['да', 'нет', 'Ни один из перечисленных'] }),
    ];
    const [subject] = deriveSubjects([file(bank(items))]);
    const inputs = itemInputs(subject, 'imp');
    expect(inputs[0]).toMatchObject({ key_source: 'marker', keep_order: true });
    expect(inputs[1].keep_order).toBe(true);
    expect(needsOrder(['а', 'б'])).toBe(false);
  });

  it('two marked options of a single question wait for the author; «Верны оба» makes it multiple', () => {
    const items = [item(1, { correct: [1, 3], flags: ['several_marked'] })];
    const [subject] = deriveSubjects([file(bank(items))]);
    expect(subject.test[0].problems).toEqual(['several']);
    expect(subject.test[0].marked).toEqual([1, 3]);
    expect(itemInputs(subject, 'imp')[0]).toMatchObject({ kind: 'single', correct: [], key_source: 'none', flags: ['several_marked'] });

    const both = deriveSubjects([file(bank(items))], { ...NO_EDITS, items: { 'f1:1': { kind: 'multiple', correct: [1, 3] } } });
    expect(itemInputs(both[0], 'imp')[0]).toMatchObject({ kind: 'multiple', correct: [1, 3], key_source: 'manual', flags: [] });
    const one = deriveSubjects([file(bank(items))], { ...NO_EDITS, items: { 'f1:1': { correct: [3], kind: 'single' } } });
    expect(itemInputs(one[0], 'imp')[0]).toMatchObject({ kind: 'single', correct: [3], key_source: 'manual' });
  });

  it('drops an empty option when saving and moves the key with it; one option blocks until kept oral', () => {
    const items = [
      item(1, { options: ['да', '', 'нет'], correct: [2], flags: ['empty_option'] }),
      item(2, { options: ['только один'], correct: [0], flags: ['few_options'] }),
    ];
    const [subject] = deriveSubjects([file(bank(items))]);
    expect(subject.test[0].options).toEqual(['да', 'нет']);
    expect(subject.test[0].correct).toEqual([1]);
    expect(subject.test[0].problems).toEqual(['empty_option']);
    expect(subject.blocked.map((entry) => entry.position)).toEqual([2]);
    expect(subject.blocked[0].problems).toEqual(['few_options']);
    expect(itemInputs(subject, 'imp')).toHaveLength(1);

    const oral = deriveSubjects([file(bank(items))], { ...NO_EDITS, items: { 'f1:2': { oral: true }, 'f1:1': { drop: [1] } } });
    expect(oral[0].blocked).toEqual([]);
    expect(oral[0].oral.map((question) => question.position)).toEqual([2]);
    expect(oral[0].test[0].problems).toEqual([]);
  });

  it('switches the key to another mark of the file without reading it again', () => {
    const items = [item(1, { marks: { bold: [0, 1, 0, 0], underline: [0, 0, 0.9, 0] } })];
    const edits: ImportEdits = { ...NO_EDITS, files: { f1: { signal: 'underline' } } };
    const [subject] = deriveSubjects([file(bank(items))], edits);
    expect(itemInputs(subject, 'imp')[0]).toMatchObject({ correct: [2], key_source: 'underline' });
    const first = deriveSubjects([file(bank(items))], { ...NO_EDITS, files: { f1: { signal: 'first_option' } } });
    expect(itemInputs(first[0], 'imp')[0]).toMatchObject({ correct: [0], key_source: 'first_option' });
  });

  it('a file without keys asks one question instead of a queue of a hundred (decision 34)', () => {
    const items = Array.from({ length: 30 }, (_, index) => item(index + 1, { correct: [], evidence: '', flags: ['no_key'] }));
    const subjects = deriveSubjects([file(bank(items, { stats: { ...bank(items).stats, with_key: 0, no_key: 30 } }))]);
    expect(subjects[0].allNoKey).toBe(true);
    expect(queueOf(subjects)).toEqual([]);
    const later = deriveSubjects([file(bank(items))].map((entry) => entry), { ...NO_EDITS, files: { f1: { noKeyLater: true } } });
    expect(later[0].allNoKey).toBe(false);
    expect(queueOf(later)).toHaveLength(30);
    expect(queueOf(later)[0].problem).toBe('no_key');
  });

  it('orders the queue by subject and position and shows the most serious problem first', () => {
    const items = [
      item(2, { flags: ['duplicate'] }),
      item(1, { flags: ['has_image', 'duplicate'] }),
      item(3, { correct: [], flags: ['no_key'] }),
    ];
    const queue = queueOf(deriveSubjects([file(bank(items))]));
    expect(queue.map((entry) => [entry.uid, entry.problem])).toEqual([
      ['f1:1', 'image'],
      ['f1:2', 'duplicate'],
      ['f1:3', 'no_key'],
    ]);
  });

  it('merges more than 99 topics into the 99th (spec §3)', () => {
    const items = Array.from({ length: 120 }, (_, index) => item(index + 1, { topic: index + 1 }));
    const [subject] = deriveSubjects([file(bank(items))]);
    expect(subject.topicsTotal).toBe(120);
    expect(subject.topics).toHaveLength(99);
    expect(Math.max(...itemInputs(subject, 'imp').map((input) => input.topic ?? 0))).toBe(99);
    expect(itemInputs(subject, 'imp')[119].topic).toBe(99);
  });

  it('names a subject by its file, then «Предмет N»; merges subjects split by a numbering restart', () => {
    const items = [item(1), item(2, { subject: 2, topic: 2 })];
    const restart = bank(items, {
      subjects: [
        { index: 1, title: null, evidence: 'restart', items: 1 },
        { index: 2, title: null, evidence: 'restart', items: 1 },
      ],
      warnings: [{ code: 'subjects_restart', message: '' }],
    });
    const split = deriveSubjects([file(restart)]);
    expect(split.map((subject) => [subject.title, subject.titleFrom, subject.restart])).toEqual([
      ['Предмет 1', 'number', true],
      ['Предмет 2', 'number', true],
    ]);
    const merged = deriveSubjects([file(restart)], { ...NO_EDITS, files: { f1: { merged: true } } });
    expect(merged).toHaveLength(1);
    expect(merged[0].test).toHaveLength(2);
    expect(merged[0].title).toBe('Сети');
    const single = deriveSubjects([file(bank([item(1)]), { name: 'Банк_тестов_по_БД_2026.docx' })]);
    expect(single[0]).toMatchObject({ title: 'БД', titleFrom: 'file' });
  });
});

describe('helpers', () => {
  it('cleans file names into subject names', () => {
    expect(subjectFromFileName('Банк_тестов_по_БД_2026.docx')).toBe('БД');
    expect(subjectFromFileName('Сети.docx')).toBe('Сети');
    expect(subjectFromFileName('Вопросы_по_истории_Беларуси-v2.txt')).toBe('Истории Беларуси');
    expect(subjectFromFileName('Микроэкономика.pdf')).toBe('Микроэкономика');
    expect(subjectFromFileName('тесты_2026.docx')).toBeNull();
    expect(subjectFromFileName('ОС_итог.xlsx')).toBe('ОС');
  });

  it('reads short answers only when they are short or marked as such', () => {
    expect(shortForms(item(1, { kind: 'open', options: [], answer: 'Invoke', evidence: '' }))).toEqual(['Invoke']);
    expect(shortForms(item(1, { kind: 'open', options: [], answer: null }))).toBeNull();
    expect(shortForms(item(1, { kind: 'single', answer: 'x' }))).toBeNull();
    expect(shortForms(item(1, { kind: 'open', options: [], answer: '.', evidence: 'gift' }))).toBeNull();
  });

  it('builds the plan input of the draft from keyed questions only', () => {
    const items = [item(1), item(2, { correct: [], flags: ['no_key'] }), item(3, { code: true }), item(4, { kind: 'multiple', correct: [0, 1] })];
    const subjects = deriveSubjects([file(bank(items))]);
    const input = draftPlanInput(subjects, { now: 1, tz: 'Europe/Minsk', today: '2026-10-10', minutes: 45, date: '2026-10-28', perSubject: false });
    expect(input.budgetMin).toBe(45);
    expect(input.subjects).toEqual([{ id: 'f1:1', title: 'Сети', date: '2026-10-28' }]);
    expect(input.items.map((entry) => [entry.id, entry.slow ?? 0])).toEqual([
      ['f1:1', 0],
      ['f1:3', 1],
      ['f1:4', 1],
    ]);
    expect(input).not.toHaveProperty('examQuestions');
  });

  it('a joining oral exam is subject 1 of the draft with its questions in the plan; the exam’s size rides along', () => {
    const subjects = deriveSubjects([file(bank([item(1), item(2)]))]);
    const oral = Array.from({ length: 3 }, (_, i) => ({ id: `o${i}`, s: 'anything', f: 'o' as const, tp: null, o: i + 1, l: [], m: { sc: null, rating: 0 as const, ac: null, prepared: false } }));
    const input = draftPlanInput(subjects, {
      now: 1, tz: 'Europe/Minsk', today: '2026-10-10', minutes: 30, date: '2026-10-28', perSubject: false,
      extra: { id: 'old:db', title: 'Базы данных', date: '2026-10-21', items: oral }, examQuestions: 22,
    });
    expect(input.subjects).toEqual([{ id: 'old:db', title: 'Базы данных', date: '2026-10-21' }, { id: 'f1:1', title: 'Сети', date: '2026-10-28' }]);
    expect(input.items.map((entry) => [entry.id, entry.s, entry.f])).toEqual([
      ['o0', 'old:db', 'o'], ['o1', 'old:db', 'o'], ['o2', 'old:db', 'o'], ['f1:1', 'f1:1', 't'], ['f1:2', 'f1:1', 't'],
    ]);
    expect(input.examQuestions).toBe(22);
  });

  it('spot-checks three keyed questions spread over the subjects', () => {
    const subjects = deriveSubjects([file(TWO)]);
    const picks = spotCheck(subjects);
    expect(picks).toHaveLength(3);
    expect(new Set(picks.map((pick) => pick.item.uid)).size).toBe(3);
  });

  it('makes refs the database accepts', () => {
    expect(newImportId(1_760_000_000_000, () => 0.5)).toMatch(/^imp-[a-z0-9]+-[a-z0-9]{6}$/);
  });
});
