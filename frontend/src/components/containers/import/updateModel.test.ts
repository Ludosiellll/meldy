import { describe, expect, it } from 'vitest';
import itemsJson from '../../../../../contracts/container/items_page.json';
import summaryJson from '../../../../../contracts/container/summary.json';
import type { BankItem, BankParseResult, ContainerSummary, TestItem } from '../../../types/container';
import { deriveSubjects, NO_EDITS, type ImportEdits, type ImportFile } from './importModel';
import { bestSource, planUpdate, sameText, updateItemInputs, updateSources } from './updateModel';

/** The subject «Основы программирования» of the contract samples: 12 saved questions in 3 topics. */
const SUMMARY = summaryJson as unknown as ContainerSummary;
const SUBJECT = SUMMARY.subjects[0];
const SAVED = (itemsJson as unknown as TestItem[]).filter((entry) => entry.subject_id === SUBJECT.id);

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

/** A saved question as the file has it again (its number, topic, text, options and key). */
function again(saved: TestItem, patch: Partial<BankItem> = {}): BankItem {
  return item(saved.position, {
    label: saved.file_no,
    topic: saved.topic,
    text: saved.stem,
    options: [...saved.options],
    correct: [...saved.correct],
    marks: { bold: saved.options.map((_, index) => (saved.correct.includes(index) ? 1 : 0)) },
    ...patch,
  });
}

const TOPICS = [
  { index: 1, title: 'Тема 1. Директивы и пространства имён', subject: 1, items: 0 },
  { index: 2, title: 'Тема 2. Делегаты и события', subject: 1, items: 0 },
  { index: 3, title: 'тема 3.  строки', subject: 1, items: 0 },
  { index: 4, title: 'Тема 4. Коллекции', subject: 1, items: 0 },
];

function bank(items: BankItem[], subjects: BankParseResult['subjects'] = [{ index: 1, title: null, evidence: 'none', items: items.length }]): BankParseResult {
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
    subjects,
    topics: TOPICS,
    skipped: [],
    warnings: [],
    items,
    stats: { items: items.length, with_key: items.length, no_key: 0, ambiguous: 0, to_check: 0, duplicates: 0, kinds: {}, options: {}, gaps: [], key_lists: 0 },
  };
}

function sourcesOf(result: BankParseResult, edits: ImportEdits = NO_EDITS) {
  const file: ImportFile = { id: 'f1', name: 'Программирование.docx', importId: 'imp-next', source: 'file', format: 'auto', keyText: '', result };
  return updateSources(deriveSubjects([file], edits));
}

/** The newer file: the saved 1–11 (№ 3 with its options in another order and in capitals, № 7 with another key), no № 12, and two new ones. */
function newerFile(): BankParseResult {
  const third = SAVED[2]; // «using» is the key
  return bank([
    ...SAVED.slice(0, 11).map((saved, index) => {
      if (index === 2) {
        const options = [...third.options].reverse();
        return again(saved, { text: `  ${third.stem.toUpperCase()} `, options, correct: [options.indexOf('using')], marks: { bold: options.map((option) => (option === 'using' ? 1 : 0)) } });
      }
      if (index === 6) return again(saved, { correct: [0], marks: { bold: [1, 0, 0, 0] } });
      return again(saved);
    }),
    item(13, { topic: 3, text: 'Какой метод возвращает длину строки?', options: ['Length', 'Size', 'Count', 'Capacity'], correct: [0], marks: { bold: [1, 0, 0, 0] } }),
    item(14, { topic: 4, text: 'Какая коллекция хранит пары «ключ — значение»?', options: ['List<T>', 'Dictionary<TKey, TValue>', 'Queue<T>', 'Stack<T>'], correct: [1] }),
  ]);
}

describe('«Обновить из файла»: what a newer file brings to a subject (Concept 1 §3.4)', () => {
  it('adds only the new questions; the same ones stay, a different key is listed and never changed', () => {
    const [source] = sourcesOf(newerFile());
    const plan = planUpdate(source, SAVED, SUBJECT);
    expect(plan.add.map((entry) => entry.label)).toEqual(['13', '14']);
    expect(plan.same).toBe(11);
    expect(plan.keyDiffers.map(({ item: entry, saved }) => [entry.label, saved.file_no, saved.correct])).toEqual([['7', '7', [1]]]);
    expect(plan.notInFile).toBe(1);
    expect(plan.blocked).toEqual([]);
  });

  it('puts a new question in the subject’s topic of the same name, or a new topic after the subject’s own', () => {
    const [source] = sourcesOf(newerFile());
    const plan = planUpdate(source, SAVED, SUBJECT);
    expect(plan.topics).toEqual([...SUBJECT.topic_titles, 'Тема 4. Коллекции']);
    const inputs = updateItemInputs(plan, 'imp-next');
    expect(inputs.map((input) => [input.ref, input.file_no, input.topic, input.correct])).toEqual([
      ['imp-next:13', '13', 3, [0]],
      ['imp-next:14', '14', 4, [1]],
    ]);
  });

  it('leaves the topics as they are when the new questions fit the subject’s own', () => {
    const [source] = sourcesOf(bank([...SAVED.map((saved) => again(saved)), item(13, { topic: 2, text: 'Новый вопрос о делегатах?' })]));
    const plan = planUpdate(source, SAVED, SUBJECT);
    expect(plan.add).toHaveLength(1);
    expect(plan.topics).toBeNull();
    expect(plan.topicOf[plan.add[0].uid]).toBe(2);
    expect(plan.keyDiffers).toEqual([]);
    expect(plan.notInFile).toBe(0);
  });

  it('merges topics past the 99th into it, as the first import does', () => {
    const subject = { topic_titles: Array.from({ length: 98 }, (_, index) => `Тема ${index + 1}`) };
    const [source] = sourcesOf(bank([item(1, { topic: 3, text: 'Первый?' }), item(2, { topic: 4, text: 'Второй?' })]));
    // «тема 3.  строки» and «Тема 4. Коллекции» are new to this subject: the 99th is added, the next one joins it.
    const plan = planUpdate(source, [], subject);
    expect(plan.topics).toHaveLength(99);
    expect(plan.topics?.[98]).toBe('тема 3.  строки');
    expect(plan.add.map((entry) => plan.topicOf[entry.uid])).toEqual([99, 99]);
  });

  it('a file without the key says nothing about the saved key; a key where the subject has none is listed', () => {
    const noKey = SAVED.map((saved) => again(saved, { correct: [], marks: {}, evidence: 'none' }));
    const [blank] = sourcesOf(bank(noKey));
    expect(planUpdate(blank, SAVED, SUBJECT).keyDiffers).toEqual([]);
    const savedNoKey = SAVED.map((saved, index) => (index === 0 ? { ...saved, correct: [], key_source: 'none' as const } : saved));
    const [full] = sourcesOf(bank(SAVED.map((saved) => again(saved))));
    expect(planUpdate(full, savedNoKey, SUBJECT).keyDiffers.map(({ saved }) => saved.file_no)).toEqual(['1']);
  });

  it('a short answer is the same by its text; its key is its accepted forms', () => {
    const saved: TestItem = { ...SAVED[0], id: 'short-1', kind: 'short', stem: 'Впишите: ключевое слово для константы ___', options: [], correct: [], answers: ['const'] };
    const forms = (answer: string) => item(1, { kind: 'open', text: 'Впишите: ключевое слово для константы ___', options: [], correct: [], answer, evidence: 'answer_line', marks: {} });
    const [same] = sourcesOf(bank([forms('const')]));
    expect(planUpdate(same, [saved], SUBJECT)).toMatchObject({ same: 1, add: [], keyDiffers: [] });
    const [other] = sourcesOf(bank([forms('readonly')]));
    expect(planUpdate(other, [saved], SUBJECT).keyDiffers).toHaveLength(1);
  });

  it('keeps a new question that cannot be saved as it is apart, for the queue', () => {
    const [source] = sourcesOf(bank([item(1, { text: 'Один вариант?', options: ['да'], correct: [0], marks: { bold: [1] } })]));
    const plan = planUpdate(source, SAVED, SUBJECT);
    expect(plan.add).toEqual([]);
    expect(plan.blocked.map((entry) => entry.label)).toEqual(['1']);
  });

  it('in a file of several subjects picks the one with this subject’s questions, then the one of the same name', () => {
    const several = bank(
      [
        ...SAVED.slice(0, 3).map((saved) => again(saved, { subject: 2 })),
        item(20, { subject: 1, text: 'Чужой вопрос?' }),
      ],
      [
        { index: 1, title: 'История Беларуси', evidence: 'heading', items: 1 },
        { index: 2, title: 'Программирование', evidence: 'heading', items: 3 },
      ],
    );
    const sources = sourcesOf(several);
    expect(sources.map((source) => source.title)).toEqual(['История Беларуси', 'Программирование']);
    expect(bestSource(sources, SAVED, SUBJECT.title)?.title).toBe('Программирование');
    expect(bestSource(sources, [], 'история беларуси')?.title).toBe('История Беларуси');
  });

  it('compares text without case, «ё», spaces, quotes or the closing punctuation', () => {
    expect(sameText('  Что  вернёт «выражение»?  ')).toBe(sameText('что вернет выражение'));
    expect(sameText('A B.')).toBe('a b');
  });
});
