import { describe, expect, it } from 'vitest';
import type { BankItem, BankParseResult } from '../../../types/container';
import { deriveSubjects, type ImportFile } from './importModel';
import { topicCandidates, withTopics } from './aiTopics';

function item(position: number, patch: Partial<BankItem> = {}): BankItem {
  return {
    position,
    label: String(position),
    subject: 1,
    topic: null,
    kind: 'single',
    text: `Вопрос  ${position}?`,
    options: ['один', 'два', 'три'],
    correct: [0],
    order: [],
    pairs: [],
    answer: null,
    evidence: 'bold',
    flags: [],
    code: false,
    where: '',
    marks: { bold: [1, 0, 0] },
    ...patch,
  } as BankItem;
}

function result(items: BankItem[], topics: BankParseResult['topics'] = []): BankParseResult {
  return {
    confidence: 1,
    key_source: { bold: items.length },
    format_signal: 'bold',
    format_signals: {},
    mark_share: 1,
    marker: null,
    markers: [],
    subjects: [{ index: 1, title: 'История', evidence: 'heading', items: items.length }],
    topics,
    skipped: [],
    warnings: [],
    items,
    stats: { items: items.length },
  } as unknown as BankParseResult;
}

const file = (parsed: BankParseResult): ImportFile =>
  ({ id: 'f1', name: 'История.docx', importId: 'imp-1', source: 'docx', format: 'auto', keyText: '', keyFileName: null, result: parsed }) as unknown as ImportFile;

const numbers = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

describe('«Разложить по темам»', () => {
  it('offers a subject without topics its questions in the file’s order; not a short one, not one with topics', () => {
    const [subject] = deriveSubjects([file(result(numbers(15).map((n) => item(n))))]);
    const list = topicCandidates(subject);
    expect(list).toHaveLength(15);
    expect(list?.[0]).toEqual({ position: 1, text: 'Вопрос 1?' });
    const [short] = deriveSubjects([file(result(numbers(11).map((n) => item(n))))]);
    expect(topicCandidates(short)).toBeNull();
    const titled = result(numbers(15).map((n) => item(n, { topic: 1 })), [{ index: 1, title: 'Раздел 1', subject: 1, items: 15 }]);
    expect(topicCandidates(deriveSubjects([file(titled)])[0])).toBeNull();
  });

  it('puts the model’s topics into the result as headings: the subject then has them, in order, with their counts', () => {
    const parsed = result(numbers(15).map((n) => item(n)));
    const positions = numbers(15);
    const next = withTopics(parsed, positions, [{ title: 'Древняя Русь', from: 1 }, { title: 'Смутное время', from: 8 }]);
    expect(next.topics).toEqual([
      { index: 1, title: 'Древняя Русь', subject: 1, items: 7 },
      { index: 2, title: 'Смутное время', subject: 1, items: 8 },
    ]);
    expect(next.items.map((entry) => entry.topic)).toEqual([1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect(next.items.map((entry) => entry.text)).toEqual(parsed.items.map((entry) => entry.text));
    const [subject] = deriveSubjects([file(next)]);
    expect(subject.topics).toEqual(['Древняя Русь', 'Смутное время']);
    expect(subject.topicCounts).toEqual([{ title: 'Древняя Русь', items: 7 }, { title: 'Смутное время', items: 8 }]);
    expect(topicCandidates(subject)).toBeNull();
  });

  it('counts by the place in the file: a list that skips a question still puts it into the topic around it', () => {
    const parsed = result(numbers(15).map((n) => item(n)));
    const positions = numbers(15).filter((n) => n !== 8); // question 8 was not sent
    const next = withTopics(parsed, positions, [{ title: 'Первая', from: 1 }, { title: 'Вторая', from: 8 }]); // from 8 = position 9
    expect(next.items.find((entry) => entry.position === 8)?.topic).toBe(1);
    expect(next.items.find((entry) => entry.position === 9)?.topic).toBe(2);
  });

  it('leaves the result as it was when the parts do not fit the list', () => {
    const parsed = result(numbers(15).map((n) => item(n)));
    expect(withTopics(parsed, numbers(15), [{ title: 'Одна', from: 1 }])).toBe(parsed);
    expect(withTopics(parsed, numbers(15), [{ title: 'Первая', from: 1 }, { title: 'Вторая', from: 40 }])).toBe(parsed);
    expect(withTopics(parsed, numbers(15), [{ title: 'Первая', from: 9 }, { title: 'Вторая', from: 3 }])).toBe(parsed);
    expect(withTopics(parsed, [101, 102], [{ title: 'Первая', from: 1 }, { title: 'Вторая', from: 2 }])).toBe(parsed);
  });
});
