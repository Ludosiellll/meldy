import { describe, expect, it } from 'vitest';
import { CARD, layoutMap, overlaps, packQuestionRows, type Box, type MapLayout } from './layout';
import { buildKnowledgeBase, buildMapView, type KnowledgeInput, type RawExam, type RawMaterial } from './model';
import { sampleInput } from './sampleCourse';
import { fitText, textWidth, wrapLines } from './textMetrics';

const NOW = new Date('2026-10-04T10:00:00Z');
const knowledge = buildKnowledgeBase(sampleInput(NOW));

function boxesOf(layout: MapLayout): Array<Box & { id: string }> {
  return [
    ...layout.cards.map((card) => ({ ...card, id: `card:${card.id}` })),
    ...layout.words.map((word) => ({ ...word, id: `word:${word.key}` })),
    ...layout.groups.map((group) => ({ ...group, id: `group:${group.id}` })),
  ];
}

function overlapping(layout: MapLayout): string[] {
  const boxes = boxesOf(layout);
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) if (overlaps(boxes[i], boxes[j])) found.push(`${boxes[i].id} × ${boxes[j].id}`);
  }
  return found;
}

/** A large made-up course: 60 lectures in 3 exams, 400 concepts shared at random but reproducibly. */
function stressInput(): KnowledgeInput {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const words = Array.from({ length: 400 }, (_, index) => `Понятие ${['альфа', 'бета', 'гамма', 'дельта', 'эпсилон'][index % 5]} ${index + 1}`);
  const materials: RawMaterial[] = Array.from({ length: 60 }, (_, index) => {
    const terms = new Set<string>();
    // Every concept appears somewhere; many appear in several lectures.
    for (let k = index; k < words.length; k += 60) terms.add(words[k]);
    while (terms.size < 14) terms.add(words[Math.floor(random() * (random() < 0.4 ? 60 : 400))]);
    return {
      id: `lecture-${index + 1}`,
      title: `Лекция ${index + 1}: ${['Введение в предмет и основные определения', 'Модели', 'Методы оценки параметров', 'Практика'][index % 4]}`,
      subject: index < 40 ? 'Экономика' : 'Статистика',
      created_at: new Date(Date.UTC(2026, 8, 1, index)).toISOString(),
      summary_json: { terms: [...terms].map((term) => ({ term, definition: `Определение: ${term}.` })) },
    };
  });
  const exams: RawExam[] = [0, 1, 2].map((exam) => ({
    id: `exam-${exam}`,
    title: `Экзамен ${exam + 1}`,
    kind: 'exam',
    exam_date: `2026-10-${10 + exam}`,
    created_at: '2026-09-01T00:00:00Z',
    materials: materials.slice(exam * 20, exam * 20 + 20).map((material) => ({ id: material.id })),
  }));
  return { materials, mistakes: [], exams, questions: [], states: new Map(), dueByMaterial: new Map(), now: NOW };
}

describe('layout of the map', () => {
  it('is deterministic: the same map gives the same geometry', () => {
    const view = buildMapView(knowledge, { examId: 'exam-macro', subject: null, showAll: false });
    const first = layoutMap(view, { aspect: 2.4 });
    const second = layoutMap(buildMapView(buildKnowledgeBase(sampleInput(NOW)), { examId: 'exam-macro', subject: null, showAll: false }), { aspect: 2.4 });
    expect(second.cards).toEqual(first.cards);
    expect(second.words).toEqual(first.words);
    expect(second.edges.map((edge) => edge.d)).toEqual(first.edges.map((edge) => edge.d));
    expect([second.width, second.height]).toEqual([first.width, first.height]);
  });

  it('never lets a word cover a card, another word or an exam name', () => {
    for (const options of [
      { examId: 'exam-macro', subject: null, showAll: false },
      { examId: 'exam-macro', subject: null, showAll: true },
      { examId: null, subject: null, showAll: true },
      { examId: 'exam-metrics', subject: null, showAll: false },
    ]) {
      const view = buildMapView(knowledge, options);
      for (const aspect of [0.7, 1.6, 2.4]) {
        const layout = layoutMap(view, { aspect });
        expect(overlapping(layout)).toEqual([]);
        expect(layout.words).toHaveLength(view.concepts.length);
        expect(layout.edges).toHaveLength(view.edges.length);
      }
    }
  });

  it('lays the cards out in reading order, the cards of a row of one height, and fits a wide sheet in two rows', () => {
    const layout = layoutMap(buildMapView(knowledge, { examId: 'exam-macro', subject: null, showAll: false }), { aspect: 2.5 });
    const rows = new Map<number, typeof layout.cards>();
    for (const card of layout.cards) rows.set(card.y, [...(rows.get(card.y) ?? []), card]);
    expect(rows.size).toBe(2);
    for (const row of rows.values()) expect(new Set(row.map((card) => card.h)).size).toBe(1);
    const order = [...layout.cards].sort((a, b) => a.y - b.y || a.x - b.x).map((card) => card.id);
    expect(order).toEqual(['macro-1', 'macro-2', 'macro-3', 'macro-4', 'macro-5', 'macro-6', 'macro-7', 'macro-8', 'macro-9']);
    // Wide enough for the 1440 sheet at about 100 %.
    expect(Math.min(1304 / layout.width, 524 / layout.height)).toBeGreaterThan(0.9);
  });

  it('places a shared concept between its lectures', () => {
    const layout = layoutMap(buildMapView(knowledge, { examId: 'exam-macro', subject: null, showAll: false }), { aspect: 2.5 });
    const word = layout.words.find((item) => item.text === 'Кривая Филлипса')!;
    const six = layout.cardById.get('macro-6')!;
    const seven = layout.cardById.get('macro-7')!;
    const middle = word.x + word.w / 2;
    expect(middle).toBeGreaterThan(six.x);
    expect(middle).toBeLessThan(seven.x + seven.w);
  });

  it('handles 60 lectures and 400 concepts without overlaps, quickly enough to memoise', () => {
    const big = buildKnowledgeBase(stressInput());
    const view = buildMapView(big, { examId: null, subject: null, showAll: true });
    expect(view.lectures).toHaveLength(60);
    expect(view.concepts).toHaveLength(400);
    const started = performance.now();
    const layout = layoutMap(view, { aspect: 2.2 });
    const elapsed = performance.now() - started;
    expect(overlapping(layout)).toEqual([]);
    expect(elapsed).toBeLessThan(3000);
  });
});

describe('cards', () => {
  it('packs question numbers into two rows at most and counts the rest', () => {
    const items = Array.from({ length: 14 }, (_, index) => ({ id: `q${index + 1}`, number: String(index + 10) }));
    const packed = packQuestionRows(items);
    expect(packed.rows.length).toBe(2);
    expect(packed.rows.flat().length + packed.rest).toBe(14);
    expect(packed.rest).toBeGreaterThan(0);
    expect(packQuestionRows(items.slice(0, 2))).toEqual({ rows: [['q1', 'q2']], rest: 0 });
    expect(packQuestionRows([])).toEqual({ rows: [], rest: 0 });
  });
});

describe('text metrics', () => {
  it('wraps a title at spaces and after hyphens, never wider than the line', () => {
    const lines = wrapLines('Денежно-кредитная политика и трансмиссионный механизм', 188, 'serif600', CARD.titleSize);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 'serif600', CARD.titleSize)).toBeLessThanOrEqual(188);
    expect(lines.join(' ').replace(/- /g, '-')).toBe('Денежно-кредитная политика и трансмиссионный механизм');
  });

  it('cuts a word longer than the line', () => {
    const lines = wrapLines('Аааааааааааааааааааааааааааааааааааааа', 100, 'serif600', 16);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 'serif600', 16)).toBeLessThanOrEqual(100);
  });

  it('shortens a label with «…» only when it does not fit', () => {
    expect(fitText('Инфляция', 200, 'serif500', 15)).toBe('Инфляция');
    const cut = fitText('Естественный уровень безработицы в долгосрочном периоде', 160, 'serif500', 15);
    expect(cut.endsWith('…')).toBe(true);
    expect(textWidth(cut, 'serif500', 15)).toBeLessThanOrEqual(160);
  });
});
