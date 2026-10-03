import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProtocolGrade, ProtocolSheet, ReviewCard, livePoints, storedGrade, storedPoints, type ProtocolFollowup } from './OralProtocol';
import { gradeAnswer } from '../../lib/oral/oralGrade';
import { DEMO_RUBRIC } from '../../lib/oral/testing/fixtures';
import type { Evaluation } from '../../lib/oral/oralApi';
import type { StoredProtocol } from '../../lib/oral/ticketData';

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const evaluation: Evaluation = {
  points: [
    { id: 'p1', status: 'covered', student_quote: 'подбор весов, которые минимизируют функцию потерь', comment: '' },
    { id: 'p2', status: 'covered', student_quote: 'прямой проход через слои', comment: '' },
    { id: 'p3', status: 'partial', student_quote: 'обратное распространение', comment: 'Назван метод, про градиент по весам не сказано.' },
    { id: 'p4', status: 'missing', student_quote: '', comment: 'Скорость обучения не прозвучала.' },
    { id: 'p5', status: 'wrong', student_quote: 'Adam один шаг на все', comment: '' },
  ],
  errors: [{ point_id: 'p5', student_quote: 'Adam один шаг на все', correction: 'Adam подбирает шаг для каждого параметра.' }],
  verdict: 'Повторите скорость обучения.',
};

const followup: ProtocolFollowup = {
  pointId: 'p4',
  question: 'А что будет, если взять слишком большую скорость обучения?',
  answer: 'не знаю',
  status: 'missing',
};

describe('<ProtocolSheet>', () => {
  it('shows every point with its title, status, «Вы» and the lecture', () => {
    stubReducedMotion(false);
    const { container } = render(
      <ProtocolSheet heading="Билет 12, вопрос 1 · ответ 3 октября, 14:12" points={livePoints(DEMO_RUBRIC, evaluation)} followup={followup} stamp="passed" seed="attempt-1" />,
    );
    for (const point of DEMO_RUBRIC.points) expect(screen.getByText(point.title)).toBeInTheDocument();
    const p1 = container.querySelector('[data-point="p1"]')!;
    expect(p1.querySelector('svg[data-mark="tick"]')).not.toBeNull();
    expect(p1.textContent).toContain('раскрыт · фрагмент 12');
    expect(p1.textContent).toContain('Вы:«подбор весов, которые минимизируют функцию потерь»');
    expect(p1.textContent).toContain('Лекция, фрагмент 12:');
    // The same anchor words are underlined in the answer and in the lecture.
    expect(p1.querySelectorAll('.or-q2 [data-mark="under"]').length).toBeGreaterThanOrEqual(2);

    const p3 = container.querySelector('[data-point="p3"]')!;
    expect(p3.querySelector('svg[data-mark="cup"]')).not.toBeNull();
    expect(p3.textContent).toContain('Назван метод, про градиент по весам не сказано.');
    expect(p3.querySelector('.sf-slip')?.textContent).toContain('Лекция «Нейронные сети», фрагмент 14');

    const p4 = container.querySelector('[data-point="p4"]')!;
    expect(p4.querySelector('svg[data-mark="dash"]')).not.toBeNull();
    expect(p4.textContent).toContain('не назван; на вопрос экзаменатора — «не знаю»');
    expect(p4.textContent).toContain('в ответе не прозвучало');

    const p5 = container.querySelector('[data-point="p5"]')!;
    expect(p5.querySelector('svg[data-mark="cross"]')).not.toBeNull();
    expect(p5.textContent).toContain('Поправка: Adam подбирает шаг для каждого параметра.');

    expect(container.querySelector('.or-extra')?.textContent).toBe(
      'Дополнительный вопрос: «А что будет, если взять слишком большую скорость обучения?» — ответ: не знаю.',
    );
    // No general comment of the model on the sheet (redesign spec 2.2 #12).
    expect(container.textContent).not.toContain('Повторите скорость обучения.');
  });

  it('draws «Зачтено» in the same pencil oval for the same attempt and another one for another attempt', () => {
    stubReducedMotion(false);
    const points = livePoints(DEMO_RUBRIC, evaluation);
    const first = render(<ProtocolSheet heading="h" points={points} followup={null} stamp="passed" seed="attempt-1" />);
    const oval = () => first.container.querySelector('svg[data-mark="oval"] path')!.getAttribute('d');
    const d1 = oval();
    first.rerender(<ProtocolSheet heading="h" points={points} followup={null} stamp="passed" seed="attempt-1" />);
    expect(oval()).toBe(d1);
    first.rerender(<ProtocolSheet heading="h" points={points} followup={null} stamp="passed" seed="attempt-2" />);
    expect(oval()).not.toBe(d1);
    expect(screen.getByText('Зачтено')).toBeInTheDocument();
  });

  it('draws the oval in for a fresh answer and keeps it still under reduced motion', () => {
    stubReducedMotion(false);
    const points = livePoints(DEMO_RUBRIC, evaluation);
    const { container, unmount } = render(<ProtocolSheet heading="h" points={points} followup={null} stamp="passed" seed="a" animate />);
    expect(container.querySelector('svg[data-mark="oval"]')).toHaveAttribute('data-drawn', 'live');
    unmount();
    stubReducedMotion(true);
    const still = render(<ProtocolSheet heading="h" points={points} followup={null} stamp="passed" seed="a" animate />);
    expect(still.container.querySelector('svg[data-mark="oval"]')).toHaveAttribute('data-drawn', 'still');
  });

  it('says «Пока не зачтено» without an oval for a 2 or a 3', () => {
    const { container } = render(<ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation)} followup={null} stamp="not_passed" seed="a" />);
    expect(screen.getByText('Пока не зачтено')).toBeInTheDocument();
    expect(container.querySelector('svg[data-mark="oval"]')).toBeNull();
  });

  it('says when the follow-up was judged by key words, and never prints an empty quote', () => {
    const points = livePoints(DEMO_RUBRIC, evaluation);
    const answer = 'Будут колебания, и сеть может не сойтись';
    const byKeywords = render(
      <ProtocolSheet heading="h" points={points} followup={{ ...followup, answer, status: 'partial', judgedBy: 'keywords' }} stamp="passed" seed="a" />,
    );
    expect(byKeywords.container.querySelector('[data-point="p4"] .or-ppt-st')?.textContent).toBe(
      `не назван; на вопрос экзаменатора — «${answer}», по ключевым словам засчитан частично`,
    );
    expect(byKeywords.container.querySelector('.or-extra')?.textContent).toBe(
      `Дополнительный вопрос: «${followup.question}» — ответ: «${answer}», по ключевым словам засчитан частично.`,
    );
    byKeywords.unmount();

    const byCheck = render(<ProtocolSheet heading="h" points={points} followup={{ ...followup, answer, status: 'partial', judgedBy: 'check' }} stamp="passed" seed="a" />);
    expect(byCheck.container.querySelector('[data-point="p4"] .or-ppt-st')?.textContent).toBe(`не назван; на вопрос экзаменатора — «${answer}»`);
    expect(byCheck.container.querySelector('.or-extra')?.textContent).toBe(`Дополнительный вопрос: «${followup.question}» — ответ: «${answer}», засчитан частично.`);
    byCheck.unmount();

    const silent = render(<ProtocolSheet heading="h" points={points} followup={{ ...followup, answer: '', status: 'missing' }} stamp="passed" seed="a" />);
    expect(silent.container.querySelector('[data-point="p4"] .or-ppt-st')?.textContent).toBe('не назван; на вопрос экзаменатора ответа не прозвучало');
    expect(silent.container.querySelector('.or-extra')?.textContent).toBe(`Дополнительный вопрос: «${followup.question}» — ответа не прозвучало.`);
    expect(silent.container.textContent).not.toContain('«»');
  });

  it('labels the browser’s own marks as preliminary when the evaluation failed', () => {
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, null, new Set(['p1', 'p2']))} followup={null} stamp="none" seed="a" preliminary />,
    );
    expect(screen.getByText('Предварительно: по ключевым словам')).toBeInTheDocument();
    expect(container.querySelectorAll('svg[data-mark="tick"]')).toHaveLength(2);
    expect(container.textContent).not.toContain('Зачтено');
  });
});

describe('<ProtocolGrade>', () => {
  it('shows the grade, the counts in a sentence and the formula on request', () => {
    const result = gradeAnswer(
      [
        { id: 'p1', essential: true, status: 'covered' },
        { id: 'p2', essential: true, status: 'covered' },
        { id: 'p3', essential: true, status: 'partial' },
        { id: 'p4', essential: true, status: 'missing' },
        { id: 'p5', essential: false, status: 'covered' },
      ],
      { point_id: 'p4', status: 'missing' },
    );
    render(<ProtocolGrade result={result} previous="В прошлый раз (1 окт.): 3 из 5" />);
    expect(screen.getByText('Оценка 4 · хорошо')).toBeInTheDocument();
    expect(screen.getByText('Раскрыто 3 пункта из 5, один упомянут, один не назван.')).toBeInTheDocument();
    expect(screen.queryByText(/\/ 9 = 67 из 100 → 4/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Как считается' }));
    expect(screen.getByText('(2 + 2 + 1 + 0 + 1) / 9 = 67 из 100 → 4')).toBeInTheDocument();
    expect(screen.getByText('Оценка тренировочная: по пунктам эталона из ваших лекций, а не по требованиям преподавателя.')).toBeInTheDocument();
    expect(screen.getByText('В прошлый раз (1 окт.): 3 из 5')).toBeInTheDocument();
  });
});

describe('a saved protocol', () => {
  const stored: StoredProtocol = {
    sessionId: 'sess-1',
    examId: 'exam-1',
    examQuestionId: 'q-1',
    rubricId: 'rub-1',
    question: 'Как обучается нейронная сеть?',
    questionHash: 'c'.repeat(32),
    subject: 'Нейросети',
    score: 67,
    grade: 4,
    input: 'speech',
    completedAt: '2026-10-07T11:02:00Z',
    points: DEMO_RUBRIC.points.map((point, index) => ({
      id: point.id,
      title: point.title,
      essential: point.essential,
      status: (['covered', 'covered', 'partial', 'missing', 'covered'] as const)[index],
      credit: null,
      student_quote: '',
      comment: '',
      source_ids: [`S1${index + 2}`],
      material_id: 'mat-1',
      source_quote: point.source_quote,
      source_label: `«Нейронные сети», фрагмент 1${index + 2}`,
      live: index !== 3,
    })),
    followup: { point_id: 'p4', question: 'А что будет?', expected: 'Колебания.', status: 'missing', student_quote: 'не знаю', chosen_by: 'check' },
    errors: [],
    verdict: '',
  };

  it('recomputes the same grade and keeps the stored one when the formula changed', () => {
    expect(storedGrade(stored)).toMatchObject({ score: 67, grade: 4, passed: true });
    expect(storedGrade({ ...stored, score: 90, grade: 5 })).toMatchObject({ score: 90, grade: 5, terms: [] });
    expect(storedPoints(stored, { p1: [['вес']] })[0]).toMatchObject({ fragments: 'фрагмент 12', anchors: [['вес']] });
  });
});

describe('<ReviewCard>', () => {
  it('puts the follow-up on an index card with a pencil «завтра»', () => {
    const { container } = render(<ReviewCard question="А что будет, если взять слишком большую скорость обучения?" />);
    expect(screen.getByText('А что будет, если взять слишком большую скорость обучения?')).toBeInTheDocument();
    expect(container.querySelector('svg.or-rcard-zav path')).not.toBeNull();
    expect(screen.getByText('Вернётся в повторении завтра.')).toBeInTheDocument();
  });
});
