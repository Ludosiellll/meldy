import { describe, expect, it } from 'vitest';
import type { BankItem, BankParseResult } from '../../../types/container';
import {
  deriveSubjects,
  draftPlanInput,
  itemInputs,
  NO_EDITS,
  queueOf,
  SUBJECTS_CAP,
  totalsOf,
  type ImportEdits,
  type ImportFile,
} from './importModel';
import { subjectFromFileName, variantFromFileName } from './subjectName';
import { planUpdate, updateItemInputs, updateSources } from './updateModel';

/**
 * Variants of one subject in several files (owner, 2026-11-04): «КПиЯП_Вариант_1.docx» … «_12.docx» and «ТПО_Вариант_1»
 * … «_12» are two subjects, not twenty-four (or forty-eight). Synthetic questions: no file of the owner's is here.
 */

const OPTIONS = ['один', 'два', 'три', 'четыре', 'пять'];

function q(position: number, text: string, correct: number, patch: Partial<BankItem> = {}): BankItem {
  return {
    position,
    label: String(position),
    subject: 1,
    topic: null,
    kind: 'single',
    text,
    options: [...OPTIONS],
    correct: [correct],
    order: [],
    pairs: [],
    answer: null,
    evidence: 'bold',
    flags: [],
    code: false,
    where: '',
    marks: { bold: OPTIONS.map((_, index) => (index === correct ? 1 : 0)) },
    ...patch,
  };
}

function result(items: BankItem[], heading: string | null, variant: number | null, patch: Partial<BankParseResult> = {}): BankParseResult {
  return {
    method: 'rules',
    layout: 'numbered_paragraphs',
    layouts_seen: {},
    confidence: 1,
    key_source: { bold: items.length },
    format_signal: 'bold',
    format_signals: { bold: { one: items.length, many: 0, all: 0 } },
    mark_share: 0.6,
    marker: null,
    markers: [],
    subjects: [{ index: 1, title: heading, evidence: heading ? 'heading' : 'none', items: items.length }],
    topics: [],
    skipped: [],
    warnings: [],
    items,
    variant,
    stats: { items: items.length, with_key: items.length, no_key: 0, ambiguous: 0, to_check: 0, duplicates: 0, kinds: {}, options: {}, gaps: [], key_lists: 0 },
    ...patch,
  };
}

let seq = 0;
function file(name: string, parse: BankParseResult, extra: Partial<ImportFile> = {}): ImportFile {
  seq += 1;
  return { id: `f${seq}`, name, importId: `imp-${seq}`, source: 'file', format: 'auto', keyText: '', result: parse, ...extra };
}

const PROG = 'Конструирование программ';
// Variant 1 and 2 share «Что такое класс?» with the same key; variants 2 and 3 share «Что такое цикл?» with different keys.
const v1 = () => result([q(1, 'Что такое класс?', 2), q(2, 'Что такое объект?', 0), q(3, 'Что такое поле?', 1)], PROG, 1);
const v2 = () => result([q(1, 'Что такое метод?', 3), q(2, 'Что такое класс?', 2), q(3, 'Что такое цикл?', 4)], PROG, 2);
const v3 = () => result([q(1, 'Что такое цикл?', 1), q(2, 'Что такое массив?', 0), q(3, 'Что такое строка?', 3)], PROG, 3);

describe('variants of one subject in several files', () => {
  it('are one subject named by the heading: variants in order, each a topic «Вариант N», repeats kept once', () => {
    const files = [file('КПиЯП_Вариант_3.docx', v3()), file('КПиЯП_Вариант_1.docx', v1()), file('КПиЯП_Вариант_2.docx', v2())];
    const subjects = deriveSubjects(files);
    expect(subjects).toHaveLength(1);
    const [subject] = subjects;
    expect([subject.title, subject.titleFrom]).toEqual([PROG, 'heading']);
    expect(subject.files.map((entry) => [entry.name, entry.variant])).toEqual([
      ['КПиЯП_Вариант_1.docx', 1],
      ['КПиЯП_Вариант_2.docx', 2],
      ['КПиЯП_Вариант_3.docx', 3],
    ]);
    expect([subject.fileId, subject.fileName]).toEqual([files[1].id, 'КПиЯП_Вариант_1.docx']);
    expect(subject.variants).toEqual({ key: subject.key, files: 3, split: false });
    expect(subject.topics).toEqual(['Вариант 1', 'Вариант 2', 'Вариант 3']);
    // 9 questions, «Что такое класс?» once (the same key), «Что такое цикл?» once (different keys): 7
    expect(subject.test.map((item) => [item.variant, item.text])).toEqual([
      [1, 'Что такое класс?'],
      [1, 'Что такое объект?'],
      [1, 'Что такое поле?'],
      [2, 'Что такое метод?'],
      [2, 'Что такое цикл?'],
      [3, 'Что такое массив?'],
      [3, 'Что такое строка?'],
    ]);
    expect(subject.variantRepeats).toBe(2);
    expect(subject.test.map((item) => item.topic)).toEqual([1, 1, 1, 2, 2, 3, 3]);
    expect(subject.topicCounts).toEqual([
      { title: 'Вариант 1', items: 3 },
      { title: 'Вариант 2', items: 2 },
      { title: 'Вариант 3', items: 2 },
    ]);
    expect(totalsOf(subjects)).toMatchObject({ subjects: 1, test: 7, found: 7 });
  });

  it('the same question with different keys waits for the student, saved without a key; the pick settles it', () => {
    const files = [file('КПиЯП_Вариант_2.docx', v2()), file('КПиЯП_Вариант_3.docx', v3())];
    const [subject] = deriveSubjects(files);
    const cycle = subject.test.find((item) => item.text === 'Что такое цикл?')!;
    expect(cycle.uid).toBe(`${files[0].id}:3`);
    expect(cycle.variantKeys).toEqual([
      { variants: [2], key: [4] },
      { variants: [3], key: [1] },
    ]);
    expect(cycle.problems).toEqual(['key_conflict']);
    expect([cycle.correct, cycle.rawCorrect, cycle.marked, cycle.keySource]).toEqual([[], [], [1, 4], 'none']);
    expect(cycle.flags).toEqual(expect.arrayContaining(['no_key', 'key_conflict']));
    expect(queueOf([subject]).map((entry) => [entry.uid, entry.problem])).toEqual([[cycle.uid, 'key_conflict']]);
    expect([subject.test.length, subject.keyed, subject.noKey]).toEqual([5, 4, 1]);

    const edits: ImportEdits = { ...NO_EDITS, items: { [cycle.uid]: { correct: [1], kind: 'single' } } };
    const [fixed] = deriveSubjects(files, edits);
    const settled = fixed.test.find((item) => item.text === 'Что такое цикл?')!;
    expect([settled.correct, settled.problems, settled.keySource, settled.variantKeys]).toEqual([[1], [], 'manual', undefined]);
    expect(queueOf([fixed])).toEqual([]);
  });

  it('a variant that shuffles the options has the same key when the same option is marked', () => {
    const shuffled = result([q(1, 'Что такое класс?', 1, { options: ['три', 'два', 'один', 'четыре', 'пять'] })], PROG, 2);
    shuffled.items[0].correct = [0];
    shuffled.items[0].marks = { bold: [1, 0, 0, 0, 0] };
    const [subject] = deriveSubjects([file('КПиЯП_Вариант_1.docx', v1()), file('КПиЯП_Вариант_2.docx', shuffled)]);
    expect(subject.test.filter((item) => item.text === 'Что такое класс?')).toHaveLength(1);
    expect(subject.variantRepeats).toBe(1);
    expect(queueOf([subject])).toEqual([]);
  });

  it('a variant with a key fills in for one without: no question waits, none is saved without its key', () => {
    const bare = result([q(1, 'Что такое класс?', 0, { correct: [], marks: {}, evidence: '', flags: ['no_key'] })], PROG, 1);
    const [subject] = deriveSubjects([file('КПиЯП_Вариант_1.docx', bare), file('КПиЯП_Вариант_2.docx', v2())]);
    const klass = subject.test.filter((item) => item.text === 'Что такое класс?');
    expect(klass).toHaveLength(1);
    expect([klass[0].variant, klass[0].correct]).toEqual([2, [2]]);
    expect(subject.variantRepeats).toBe(1);
  });

  it('a question the student removed takes its repeats in the other variants along', () => {
    const files = [file('КПиЯП_Вариант_1.docx', v1()), file('КПиЯП_Вариант_2.docx', v2())];
    const [before] = deriveSubjects(files);
    const klass = before.test.find((item) => item.text === 'Что такое класс?')!;
    const [after] = deriveSubjects(files, { ...NO_EDITS, items: { [klass.uid]: { removed: true } } });
    expect(after.test.some((item) => item.text === 'Что такое класс?')).toBe(false);
    expect(after.removedItems).toBe(1);
  });

  it('twins inside one file stay as they are (the second waits as a repeat)', () => {
    const twins = result([q(1, 'Что такое класс?', 2), q(2, 'Что такое класс?', 2, { flags: ['duplicate'] })], PROG, 1);
    const [subject] = deriveSubjects([file('КПиЯП_Вариант_1.docx', twins), file('КПиЯП_Вариант_2.docx', v2())]);
    expect(subject.test.filter((item) => item.text === 'Что такое класс?').map((item) => item.problems)).toEqual([[], ['duplicate']]);
    expect(subject.variantRepeats).toBe(1);
  });

  it('without a heading the name is the file name without the variant; the files say where it came from', () => {
    const files = [file('ТПО_Вариант_1.docx', result([q(1, 'А?', 0)], null, null)), file('ТПО_Вариант_2.docx', result([q(1, 'Б?', 1)], null, null))];
    const [subject, ...rest] = deriveSubjects(files);
    expect(rest).toEqual([]);
    expect([subject.title, subject.titleFrom, subject.files.map((entry) => entry.variant)]).toEqual(['ТПО', 'file', [1, 2]]);
  });

  it('two subjects of variants side by side: КПиЯП and ТПО', () => {
    const tpo = (variant: number) => result([q(1, `Вопрос ТПО ${variant}?`, 0), q(2, 'Что такое баг?', 3)], 'Тестирование программ', variant);
    const files = [
      file('КПиЯП_Вариант_1.docx', v1()),
      file('ТПО_Вариант_1.docx', tpo(1)),
      file('КПиЯП_Вариант_2.docx', v2()),
      file('ТПО_Вариант_2.docx', tpo(2)),
    ];
    const subjects = deriveSubjects(files);
    expect(subjects.map((subject) => [subject.title, subject.files.length, subject.test.length, subject.variantRepeats])).toEqual([
      [PROG, 2, 5, 1],
      ['Тестирование программ', 2, 3, 1],
    ]);
  });

  it('24 files of two subjects are two subjects, under the cap of 20', () => {
    const files = Array.from({ length: 24 }, (_, index) => {
      const variant = (index % 12) + 1;
      const heading = index < 12 ? PROG : 'Тестирование программ';
      return file(`${index < 12 ? 'КПиЯП' : 'ТПО'}_Вариант_${variant}.docx`, result([q(1, `${heading} ${variant}?`, 0)], heading, variant));
    });
    const subjects = deriveSubjects(files);
    expect(subjects).toHaveLength(2);
    expect(subjects.length).toBeLessThanOrEqual(SUBJECTS_CAP);
    expect(subjects[0].topics).toHaveLength(12);
    expect(subjects[0].topics[11]).toBe('Вариант 12');
  });

  it('files with topics of their own merge them by name instead of splitting by variant', () => {
    const withTopics = (variant: number, items: BankItem[]) =>
      result(items, PROG, variant, {
        topics: [
          { index: 1, title: 'Тема 1. Классы', subject: 1, items: 1 },
          { index: 2, title: variant === 1 ? 'Тема 2. Циклы' : 'Тема 2. Массивы', subject: 1, items: 1 },
        ],
      });
    const files = [
      file('КПиЯП_Вариант_1.docx', withTopics(1, [q(1, 'А?', 0, { topic: 1 }), q(2, 'Б?', 0, { topic: 2 })])),
      file('КПиЯП_Вариант_2.docx', withTopics(2, [q(1, 'В?', 0, { topic: 1 }), q(2, 'Г?', 0, { topic: 2 })])),
    ];
    const [subject] = deriveSubjects(files);
    expect(subject.topics).toEqual(['Тема 1. Классы', 'Тема 2. Циклы', 'Тема 2. Массивы']);
    expect(subject.test.map((item) => [item.text, item.topicTitle])).toEqual([
      ['А?', 'Тема 1. Классы'],
      ['Б?', 'Тема 2. Циклы'],
      ['В?', 'Тема 1. Классы'],
      ['Г?', 'Тема 2. Массивы'],
    ]);
  });

  it('«Разделить по файлам» keeps one subject per file, as before; «Объединить варианты» joins them again', () => {
    const files = [file('КПиЯП_Вариант_1.docx', v1()), file('КПиЯП_Вариант_2.docx', v2())];
    const [merged] = deriveSubjects(files);
    const split = deriveSubjects(files, { ...NO_EDITS, split: { [merged.key]: true } });
    expect(split.map((subject) => [subject.key, subject.title, subject.test.length, subject.variants])).toEqual([
      [`${files[0].id}:1`, PROG, 3, { key: merged.key, files: 2, split: true }],
      [`${files[1].id}:1`, PROG, 3, { key: merged.key, files: 2, split: true }],
    ]);
    expect(deriveSubjects(files, { ...NO_EDITS, split: { [merged.key]: false } })).toHaveLength(1);
  });

  it('a single file, files without variants and variants of other names stay as before', () => {
    const one = file('КПиЯП_Вариант_1.docx', v1());
    const [single] = deriveSubjects([one]);
    expect([single.title, single.variants, single.files.length, single.key, single.variantRepeats]).toEqual([PROG, null, 1, `${one.id}:1`, 0]);

    const plain = [file('Сети.docx', result([q(1, 'А?', 0)], 'Сети', null)), file('Сети, часть 2.docx', result([q(1, 'Б?', 0)], 'Сети', null))];
    expect(deriveSubjects(plain).map((subject) => subject.title)).toEqual(['Сети', 'Сети']);

    const other = [file('КПиЯП_Вариант_1.docx', v1()), file('ТПО_Вариант_1.docx', result([q(1, 'А?', 0)], 'Тестирование программ', 1))];
    expect(deriveSubjects(other).map((subject) => subject.title)).toEqual([PROG, 'Тестирование программ']);

    // «Вариант_1.docx» … without a heading has no name to share: each stays «Вариант N» (owner, 2026-10-14)
    const nameless = [file('Вариант_1.docx', result([q(1, 'А?', 0)], null, null)), file('Вариант_2.docx', result([q(1, 'Б?', 0)], null, null))];
    expect(deriveSubjects(nameless).map((subject) => subject.title)).toEqual(['Вариант 1', 'Вариант 2']);
  });

  it('the subject keeps its key, name and date edits; renaming it renames the group', () => {
    const files = [file('КПиЯП_Вариант_1.docx', v1()), file('КПиЯП_Вариант_2.docx', v2())];
    const [merged] = deriveSubjects(files);
    const [renamed] = deriveSubjects(files, { ...NO_EDITS, subjects: { [merged.key]: { title: 'КПиЯП', date: '2026-12-20' } } });
    expect([renamed.key, renamed.title, renamed.titleFrom, renamed.date]).toEqual([merged.key, 'КПиЯП', 'user', '2026-12-20']);
    // adding a third variant keeps the key (it is the name's, not the files')
    const [three] = deriveSubjects([...files, file('КПиЯП_Вариант_3.docx', v3())]);
    expect(three.key).toBe(merged.key);
  });

  it('refs carry each question’s own file’s import id; the plan orders the subject’s questions without repeats', () => {
    const files = [file('КПиЯП_Вариант_1.docx', v1()), file('КПиЯП_Вариант_2.docx', v2())];
    const [subject] = deriveSubjects(files);
    const ids = Object.fromEntries(files.map((entry) => [entry.id, entry.importId]));
    const refs = itemInputs(subject, (fileId) => ids[fileId]).map((input) => input.ref);
    expect(refs).toEqual([`${files[0].importId}:1`, `${files[0].importId}:2`, `${files[0].importId}:3`, `${files[1].importId}:1`, `${files[1].importId}:3`]);
    expect(new Set(refs).size).toBe(refs.length);
    const plan = draftPlanInput([subject], { now: 0, tz: 'Europe/Minsk', today: '2026-11-04', minutes: 60, date: null, perSubject: false });
    expect(plan.items.map((entry) => entry.o)).toEqual([1, 2, 3, 4, 5]);
  });

  it('«Обновить из файла» with new variants adds their questions after the subject’s own, in the variants’ order', () => {
    const files = [file('КПиЯП_Вариант_1.docx', v1()), file('КПиЯП_Вариант_2.docx', v2())];
    const subjects = deriveSubjects(files);
    const sources = updateSources(subjects);
    expect(sources).toHaveLength(1);
    expect(sources[0].fileIds).toEqual(files.map((entry) => entry.id));
    const plan = planUpdate(sources[0], [], { topic_titles: ['Вариант 1'] });
    expect(plan.add.map((item) => [item.variant, item.label])).toEqual([[1, '1'], [1, '2'], [1, '3'], [2, '1'], [2, '3']]);
    expect(plan.topics).toEqual(['Вариант 1', 'Вариант 2']);
    const ids = Object.fromEntries(files.map((entry) => [entry.id, entry.importId]));
    expect(updateItemInputs(plan, (fileId) => ids[fileId]).map((input) => input.ref)[3]).toBe(`${files[1].importId}:1`);
  });
});

describe('the variant in a file name', () => {
  it('reads «_Вариант_3», «вариант №3», «Вар 3», «variant 3» and leaves the subject’s name', () => {
    expect(variantFromFileName('КПиЯП_Вариант_1.docx')).toEqual({ variant: 1, base: 'КПиЯП' });
    expect(variantFromFileName('ТПО_Вариант_12.docx')).toEqual({ variant: 12, base: 'ТПО' });
    expect(variantFromFileName('Тест по ТПО вариант №3.docx')).toEqual({ variant: 3, base: 'ТПО' });
    expect(variantFromFileName('Вар 3 Сети.docx')).toEqual({ variant: 3, base: 'Сети' });
    expect(variantFromFileName('networks variant 3.docx')).toEqual({ variant: 3, base: 'Networks' });
    expect(variantFromFileName('БД-вар.2.docx')).toEqual({ variant: 2, base: 'БД' });
    expect(variantFromFileName('Вариант_1.docx')).toEqual({ variant: 1, base: null });
    expect(variantFromFileName('Тест.docx')).toEqual({ variant: null, base: 'Тест' });
    expect(variantFromFileName('Варианты ответов.docx').variant).toBeNull();
    // today's names of single files are unchanged
    expect(subjectFromFileName('КПиЯП_Вариант_1.docx')).toBe('КПиЯП Вариант 1');
  });
});
