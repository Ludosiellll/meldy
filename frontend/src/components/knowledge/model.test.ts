import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeBase,
  buildMapView,
  conceptKey,
  conceptNode,
  containsStems,
  defaultExamId,
  extractTerms,
  highlightNodes,
  lectureNode,
  neighbourhood,
  searchNodes,
  stemsOf,
  subjectsOf,
  tokensOf,
  type KnowledgeInput,
} from './model';
import { sampleInput } from './sampleCourse';

const NOW = new Date('2026-10-04T10:00:00Z');

function base(input: KnowledgeInput = sampleInput(NOW)) {
  return buildKnowledgeBase({ ...input, now: NOW });
}

describe('terms of a summary', () => {
  it('reads summary_json.terms with their fragments, and drops empty or repeated terms', () => {
    const terms = extractTerms({
      terms: [
        { term: 'Инфляция', definition: 'Рост общего уровня цен.', source_ids: ['S03', 'bad', 'S03'] },
        { term: 'инфляция', definition: 'Повтор того же термина.' },
        { term: 'Пусто', definition: '' },
      ],
    });
    expect(terms).toEqual([{ term: 'Инфляция', definition: 'Рост общего уровня цен.', sourceIds: ['S03'] }]);
  });

  it('falls back to the «Термины» section of older Markdown summaries (also stored as a JSON string)', () => {
    const markdown = '## Конспект\n\nТекст.\n\n## Термины\n\n1. **Ставка процента** — цена кредита.\n- **Ликвидность**: способность актива быстро стать деньгами.';
    expect(extractTerms(JSON.stringify({ content: markdown })).map((term) => term.term)).toEqual(['Ставка процента', 'Ликвидность']);
    expect(extractTerms(markdown).map((term) => term.term)).toEqual(['Ставка процента', 'Ликвидность']);
  });
});

describe('words', () => {
  it('gives inflected forms of a term one key, so two lectures share the concept', () => {
    expect(conceptKey('Денежный мультипликатор')).toBe(conceptKey('денежного мультипликатора'));
    expect(conceptKey('Инфляция спроса')).toBe(conceptKey('ИНФЛЯЦИЯ  спроса'));
    expect(conceptKey('ВВП')).toBe(conceptKey('ввп'));
    expect(conceptKey('ВВП')).not.toBe(conceptKey('ВВП страны'));
    expect(conceptKey('2024')).toBe('');
    expect(conceptKey('—')).toBe('');
  });

  it('finds a term in a text by stems, but a short stem only as a whole word', () => {
    expect(containsStems(tokensOf('Ключевая ставка ЦБ и её влияние на инфляцию.'), stemsOf('Инфляция'))).toBe(true);
    expect(containsStems(tokensOf('Денежный мультипликатор и денежная база'), stemsOf('Денежная база'))).toBe(true);
    expect(containsStems(tokensOf('База денежная'), stemsOf('Денежная база'))).toBe(false);
    expect(containsStems(tokensOf('Поток и токен'), stemsOf('Ток'))).toBe(false);
    expect(containsStems(tokensOf('Сила тока и ток'), stemsOf('Ток'))).toBe(true);
    expect(containsStems(tokensOf('Реальный ВВП растёт'), stemsOf('ВВП'))).toBe(true);
  });
});

describe('the whole picture', () => {
  it('cleans file names into titles and orders exams by date', () => {
    const knowledge = base();
    expect(knowledge.lectureById.get('macro-1')?.title).toBe('Предмет макроэкономики и ВВП');
    expect(knowledge.exams.map((exam) => exam.id)).toEqual(['exam-macro', 'exam-metrics']);
  });

  it('opens on the nearest exam that has lectures; without one, on all lectures', () => {
    const input = sampleInput(NOW);
    expect(defaultExamId(base(input))).toBe('exam-macro');
    const past = { ...input, exams: input.exams.map((exam) => ({ ...exam, exam_date: '2026-09-01' })) };
    expect(defaultExamId(base(past))).toBeNull();
    const undated = { ...input, exams: input.exams.map((exam, index) => ({ ...exam, exam_date: null, materials: index === 0 ? [] : exam.materials })) };
    expect(defaultExamId(base(undated))).toBe('exam-metrics');
  });

  it('lists subjects with «без предмета» last', () => {
    expect(subjectsOf(base())).toEqual([
      { subject: 'Макроэкономика', count: 9 },
      { subject: 'Эконометрика', count: 4 },
      { subject: '', count: 2 },
    ]);
  });
});

describe('one map', () => {
  it('shows the exam’s lectures in order with the concepts two or more of them share', () => {
    const view = buildMapView(base(), { examId: 'exam-macro', subject: null, showAll: false });
    expect(view.lectures.map((lecture) => lecture.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const inflation = view.conceptByKey.get(conceptKey('Инфляция'))!;
    expect(inflation.lectureIds).toEqual(['macro-1', 'macro-5', 'macro-6']);
    expect(inflation.shared).toBe(true);
    // Only shared concepts, plus single-lecture ones with open mistakes.
    expect(view.concepts.every((concept) => concept.shared || concept.weak)).toBe(true);
    expect(view.concepts.find((concept) => concept.label === 'Гиперинфляция')).toBeUndefined();
    expect(view.counts.shared).toBe(14);
    // Every edge joins a drawn concept to a lecture where it appears.
    for (const edge of view.edges) expect(view.conceptByKey.get(edge.conceptKey)!.lectureIds).toContain(edge.lectureId);
  });

  it('adds the concepts of a single lecture on request', () => {
    const view = buildMapView(base(), { examId: 'exam-macro', subject: null, showAll: true });
    expect(view.concepts.find((concept) => concept.label === 'Гиперинфляция')?.lectureIds).toEqual(['macro-6']);
    expect(view.concepts.length).toBe(view.counts.concepts);
  });

  it('puts exam questions on the lectures the mapping cites, with readiness from the journal', () => {
    const view = buildMapView(base(), { examId: 'exam-macro', subject: null, showAll: false });
    const money = view.lectureById.get('macro-3')!;
    expect(money.questions.map((question) => `${question.number}:${question.readiness}`)).toEqual(['6', '7', '8', '9'].map((n) => `${n}:${{ 6: 'untested', 7: 'confirmed', 8: 'not_passed', 9: 'untested' }[n]}`));
    // Question 8 is cited by two lectures and counted once.
    expect(view.lectureById.get('macro-4')!.questions.map((question) => question.number)).toContain('8');
    expect(view.counts.readiness).toEqual({ confirmed: 5, once: 3, not_passed: 3, untested: 11 });
    expect(view.unplaced.map((question) => question.number)).toEqual(['23', '24']);
    expect(money.dueCards).toBe(5);
    expect(money.openMistakes.map((mistake) => mistake.id)).toEqual(['m-1']);
  });

  it('marks concepts that open mistakes mention, and finds the exam questions with their words', () => {
    const view = buildMapView(base(), { examId: 'exam-macro', subject: null, showAll: false });
    const phillips = view.conceptByKey.get(conceptKey('Кривая Филлипса'))!;
    expect(phillips.weak).toBe(true);
    expect(phillips.openMistakes.map((mistake) => mistake.id)).toEqual(['m-3']);
    expect(phillips.questionIds.map((id) => view.questionById.get(id)!.number)).toEqual(['17']);
    // The resolved mistake about ВВП does not make «ВВП» weak.
    expect(view.conceptByKey.get(conceptKey('ВВП'))!.weak).toBe(false);
  });

  it('groups all lectures by exam, then the others, and filters them by subject', () => {
    const knowledge = base();
    const all = buildMapView(knowledge, { examId: null, subject: null, showAll: false });
    expect(all.groups.map((group) => [group.label, group.lectureIds.length])).toEqual([
      ['Макроэкономика', 9],
      ['Эконометрика', 4],
      ['Другие материалы', 2],
    ]);
    expect(all.exam).toBeNull();
    expect(all.lectures.every((lecture) => lecture.questions.length === 0)).toBe(true);
    const metrics = buildMapView(knowledge, { examId: null, subject: 'Эконометрика', showAll: false });
    expect(metrics.lectures.map((lecture) => lecture.id)).toEqual(['metrics-1', 'metrics-2', 'metrics-3', 'metrics-4']);
    expect(metrics.concepts.map((concept) => concept.label).sort()).toEqual(['Коэффициент детерминации', 'Метод наименьших квадратов', 'Остатки']);
  });
});

describe('neighbourhoods, search and legend filters', () => {
  const view = buildMapView(base(), { examId: 'exam-macro', subject: null, showAll: false });

  it('lights a lecture, its concepts, and where those concepts lead', () => {
    const near = neighbourhood(view, lectureNode('macro-7'));
    expect(near.nodes).toEqual(new Set([lectureNode('macro-7'), conceptNode(conceptKey('Безработица')), conceptNode(conceptKey('Кривая Филлипса'))]));
    expect(near.far).toEqual(new Set([lectureNode('macro-1'), lectureNode('macro-6')]));
  });

  it('lights a concept and its lectures', () => {
    const near = neighbourhood(view, conceptNode(conceptKey('Инфляция')));
    expect([...near.nodes].sort()).toEqual([conceptNode(conceptKey('Инфляция')), lectureNode('macro-1'), lectureNode('macro-5'), lectureNode('macro-6')].sort());
    expect(near.edges.size).toBe(3);
  });

  it('finds lectures and drawn concepts by name (ё = е, any case)', () => {
    expect(searchNodes(view, 'ДЕНЕЖН')).toEqual(new Set([lectureNode('macro-3'), lectureNode('macro-5'), conceptNode(conceptKey('Денежная база')), conceptNode(conceptKey('Денежный мультипликатор'))]));
    expect(searchNodes(view, '  ').size).toBe(0);
  });

  it('lights the lectures a legend filter is about', () => {
    expect(highlightNodes(view, { kind: 'readiness', value: 'not_passed' })).toEqual(new Set([lectureNode('macro-3'), lectureNode('macro-4'), lectureNode('macro-6'), lectureNode('macro-8')]));
    expect(highlightNodes(view, { kind: 'due' })).toEqual(new Set([lectureNode('macro-2'), lectureNode('macro-3'), lectureNode('macro-6')]));
    const mistakes = highlightNodes(view, { kind: 'mistakes' });
    expect(mistakes.has(lectureNode('macro-7'))).toBe(true);
    expect(mistakes.has(conceptNode(conceptKey('Кривая Филлипса')))).toBe(true);
  });
});
