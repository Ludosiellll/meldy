/**
 * Test fixtures: the demo ticket of the oral spec («Как обучается нейронная сеть?») with the anchors
 * of the shared vectors (frontend/src/test/fixtures/oral_match_vectors.json). Not used by app code.
 */
import vectors from '../../../test/fixtures/oral_match_vectors.json';
import type { Rubric, RubricResponse } from '../oralApi';

const anchors = vectors.points[0].anchors as Record<string, string[][]>;

export const DEMO_QUESTION = 'Как обучается нейронная сеть?';
/** The spec's demo answer: p1, p2, p3 and p5 named, p4 an explicit miss. */
export const DEMO_ANSWER = vectors.points[0].transcript;

export const DEMO_RUBRIC: Rubric = {
  v: 1,
  question: DEMO_QUESTION,
  coverage: 'full',
  coverage_note: '',
  fragments_considered: 12,
  fragments_total: 30,
  materials: [{ key: 'M1', material_id: 'mat-1', title: 'Нейронные сети' }],
  points: [
    {
      id: 'p1',
      title: 'Обучение — подбор весов, минимизирующих функцию потерь',
      essential: true,
      source_quote: 'Обучение сети заключается в подборе весов, минимизирующих функцию потерь',
      source_ids: ['M1:S12'],
      anchors: anchors.p1,
      followup: { question: 'А что именно сеть минимизирует при обучении?', expected: 'Функцию потерь.' },
    },
    {
      id: 'p2',
      title: 'Прямой проход: данные идут через слои к предсказанию',
      essential: true,
      source_quote: 'при прямом проходе данные проходят через слои, и сеть выдаёт предсказание',
      source_ids: ['M1:S13'],
      anchors: anchors.p2,
      followup: { question: 'Что сеть выдаёт после прямого прохода?', expected: 'Предсказание.' },
    },
    {
      id: 'p3',
      title: 'Обратное распространение считает градиент по каждому весу',
      essential: true,
      source_quote: 'обратное распространение ошибки вычисляет градиент функции потерь по каждому весу',
      source_ids: ['M1:S14'],
      anchors: anchors.p3,
      followup: { question: 'Зачем нужен градиент по каждому весу?', expected: 'Чтобы знать, куда менять вес.' },
    },
    {
      id: 'p4',
      title: 'Скорость обучения: большая ускоряет, но может вызвать осцилляции',
      essential: true,
      source_quote: 'большая ускоряет обучение, но может вызвать осцилляции',
      source_ids: ['M1:S15'],
      anchors: anchors.p4,
      followup: { question: 'А что будет, если взять слишком большую скорость обучения?', expected: 'Обучение ускорится, но веса начнут колебаться.' },
    },
    {
      id: 'p5',
      title: 'Adam подбирает шаг для каждого параметра',
      essential: false,
      source_quote: 'Оптимизатор Adam подбирает шаг обучения для каждого параметра отдельно',
      source_ids: ['M1:S16'],
      anchors: anchors.p5,
      followup: { question: 'Чем Adam отличается от обычного градиентного спуска?', expected: 'Свой шаг для каждого параметра.' },
    },
  ],
  nearest: [],
};

export function demoRubricResponse(overrides: Partial<RubricResponse> = {}): RubricResponse {
  return {
    rubric_id: '07000000-0000-4000-8000-000000000001',
    cached: true,
    saved: true,
    question_hash: 'c'.repeat(32),
    question: DEMO_QUESTION,
    rubric: DEMO_RUBRIC,
    ...overrides,
  };
}
