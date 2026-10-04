import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  ASKED_SCROLL_MS,
  CAP_SKIPPED_SENTENCE,
  HowGraded,
  OLD_RULE_NOTE,
  ProtocolGrade,
  ProtocolSheet,
  ReviewCard,
  SAVED_GRADE_NOTE,
  keywordNote,
  lectureMentions,
  livePoints,
  stampFor,
  storedGrade,
  storedPoints,
  type ProtocolFollowup,
  type ProtocolPoint,
} from './OralProtocol';
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
    // «фрагмент 12» stays together on a narrow sheet: a non-breaking space before the number.
    expect(p1.textContent).toContain('раскрыт · фрагмент\u00a012');
    expect(p1.textContent).toContain('Вы:«подбор весов, которые минимизируют функцию потерь»');
    // The quote names its lecture even for a covered point: an exam has many lectures (QA s35).
    expect(p1.textContent).toContain('Лекция «Нейронные сети», фрагмент 12:');
    expect(p1.textContent).not.toContain('Лекция, фрагмент 12:');
    // The same anchor words are underlined in the answer and in the lecture.
    expect(p1.querySelectorAll('.or-q2 [data-mark="under"]').length).toBeGreaterThanOrEqual(2);

    const p3 = container.querySelector('[data-point="p3"]')!;
    expect(p3.querySelector('svg[data-mark="cup"]')).not.toBeNull();
    expect(p3.textContent).toContain('Назван метод, про градиент по весам не сказано.');
    // The lecture is named once on the sheet; the next quotes from it say «Лекция, фрагмент N»
    // (redesign critique 4, round 2).
    expect(p3.querySelector('.sf-slip .or-slip-cap')?.textContent?.replace(/\s/g, ' ')).toBe('Лекция, фрагмент 14');

    const p4 = container.querySelector('[data-point="p4"]')!;
    expect(p4.querySelector('svg[data-mark="dash"]')).not.toBeNull();
    expect(p4.querySelector('.or-ppt-st')?.textContent).toBe('главный пункт · не назван; на вопрос экзаменатора — «не знаю»');
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

  it('names the right lecture for each covered point when the rubric drew on two lectures', () => {
    const twoLectures = {
      ...DEMO_RUBRIC,
      materials: [...DEMO_RUBRIC.materials, { key: 'M2', material_id: 'mat-2', title: 'Оптимизаторы' }],
      points: DEMO_RUBRIC.points.map((point) => (point.id === 'p2' ? { ...point, source_ids: ['M2:S04'] } : point)),
    };
    const allCovered: Evaluation = { ...evaluation, points: evaluation.points.map((point) => ({ ...point, status: 'covered' as const })), errors: [] };
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(twoLectures, allCovered)} followup={null} stamp="passed" seed="a" />,
    );
    const label = (id: string) =>
      Array.from(container.querySelectorAll(`[data-point="${id}"] .or-q2-label`)).map((node) => node.textContent ?? '');
    expect(label('p1')).toContain('Лекция «Нейронные сети», фрагмент 12:');
    expect(label('p2')).toContain('Лекция «Оптимизаторы», фрагмент 4:');
  });

  it('a saved protocol names the lecture of a covered point from its saved label; an untitled one keeps the short form', () => {
    const stored = {
      points: [
        { id: 'p1', title: 'Пункт', essential: true, status: 'covered', student_quote: 'вес', comment: '', source_ids: ['S04'], material_id: 'm1', source_quote: 'подбор весов', source_label: '«Нейронные сети и глубокое обучение», фрагмент 4', live: true },
        { id: 'p2', title: 'Второй', essential: false, status: 'covered', student_quote: 'шаг', comment: '', source_ids: ['S05'], material_id: null, source_quote: 'шаг обучения', source_label: '', live: true },
      ],
      errors: [],
    } as unknown as StoredProtocol;
    const { container } = render(<ProtocolSheet heading="h" points={storedPoints(stored, {})} followup={null} stamp="none" seed="s" />);
    const labels = Array.from(container.querySelectorAll('[data-point="p1"] .or-q2-label')).map((node) => node.textContent?.replace(/\u00a0/g, ' '));
    expect(labels).toEqual(['Вы:', 'Лекция «Нейронные сети и глубокое обучение», фрагмент 4:']);
    expect(container.querySelector('[data-point="p2"]')?.textContent).toContain('Лекция, фрагмент 5:');
  });

  it('draws «Засчитано» in the same pencil oval for the same attempt and another one for another attempt', () => {
    stubReducedMotion(false);
    const points = livePoints(DEMO_RUBRIC, evaluation);
    const first = render(<ProtocolSheet heading="h" points={points} followup={null} stamp="passed" seed="attempt-1" />);
    const oval = () => first.container.querySelector('svg[data-mark="oval"] path')!.getAttribute('d');
    const d1 = oval();
    first.rerender(<ProtocolSheet heading="h" points={points} followup={null} stamp="passed" seed="attempt-1" />);
    expect(oval()).toBe(d1);
    first.rerender(<ProtocolSheet heading="h" points={points} followup={null} stamp="passed" seed="attempt-2" />);
    expect(oval()).not.toBe(d1);
    expect(screen.getByText('Засчитано')).toBeInTheDocument();
    expect(first.container.textContent).not.toMatch(/Зачтено/);
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

  it('stamps a 5 and a 4 «Засчитано» in the oval, a 3 and a 2 «В готовность не засчитано» without one (Jury_Check item 11)', () => {
    expect([5, 4, 3, 2, null].map(stampFor)).toEqual(['passed', 'passed', 'not_passed', 'not_passed', 'none']);
    for (const grade of [5, 4, 3, 2]) {
      const { container, unmount } = render(
        <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation)} followup={null} stamp={stampFor(grade)} seed="a" />,
      );
      const stamp = container.querySelector('.or-stamp') as HTMLElement;
      if (grade >= 4) {
        expect(stamp.textContent).toBe('Засчитано');
        expect(stamp.querySelector('svg[data-mark="oval"]')).not.toBeNull();
      } else {
        expect(stamp.textContent).toBe('В готовность не засчитано');
        expect(container.querySelector('svg[data-mark="oval"]')).toBeNull();
      }
      expect(container.textContent).not.toMatch(/[Зз]ачтено/);
      unmount();
    }
  });

  it('marks every main point «главный пункт» at the start of its status line, and only those', () => {
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation, new Set(['p1', 'p2', 'p3', 'p5']))} followup={followup} stamp="not_passed" seed="a" />,
    );
    const lines = Object.fromEntries(
      DEMO_RUBRIC.points.map((point) => [point.id, container.querySelector(`[data-point="${point.id}"] .or-ppt-st`)?.textContent ?? '']),
    );
    expect(lines.p1).toBe('главный пункт · раскрыт · фрагмент\u00a012');
    expect(lines.p3).toBe('главный пункт · упомянут · фрагмент\u00a014');
    expect(lines.p4).toBe('главный пункт · не назван; на вопрос экзаменатора — «не знаю»');
    // p5 is not a main point.
    expect(lines.p5).toBe('ошибка');
    for (const point of DEMO_RUBRIC.points) expect(lines[point.id].startsWith('главный пункт · ')).toBe(point.essential);
  });

  it('says when the follow-up was judged by key words, and never prints an empty quote', () => {
    const points = livePoints(DEMO_RUBRIC, evaluation);
    const answer = 'Будут колебания, и сеть может не сойтись';
    const byKeywords = render(
      <ProtocolSheet heading="h" points={points} followup={{ ...followup, answer, status: 'partial', judgedBy: 'keywords' }} stamp="passed" seed="a" />,
    );
    expect(byKeywords.container.querySelector('[data-point="p4"] .or-ppt-st')?.textContent).toBe(
      `главный пункт · не назван; на вопрос экзаменатора — «${answer}», по ключевым словам засчитан частично`,
    );
    expect(byKeywords.container.querySelector('.or-extra')?.textContent).toBe(
      `Дополнительный вопрос: «${followup.question}» — ответ: «${answer}», по ключевым словам засчитан частично.`,
    );
    byKeywords.unmount();

    const byCheck = render(<ProtocolSheet heading="h" points={points} followup={{ ...followup, answer, status: 'partial', judgedBy: 'check' }} stamp="passed" seed="a" />);
    expect(byCheck.container.querySelector('[data-point="p4"] .or-ppt-st')?.textContent).toBe(`главный пункт · не назван; на вопрос экзаменатора — «${answer}»`);
    expect(byCheck.container.querySelector('.or-extra')?.textContent).toBe(`Дополнительный вопрос: «${followup.question}» — ответ: «${answer}», засчитан частично.`);
    byCheck.unmount();

    const silent = render(<ProtocolSheet heading="h" points={points} followup={{ ...followup, answer: '', status: 'missing' }} stamp="passed" seed="a" />);
    expect(silent.container.querySelector('[data-point="p4"] .or-ppt-st')?.textContent).toBe('главный пункт · не назван; на вопрос экзаменатора ответа не прозвучало');
    expect(silent.container.querySelector('.or-extra')?.textContent).toBe(`Дополнительный вопрос: «${followup.question}» — ответа не прозвучало.`);
    expect(silent.container.textContent).not.toContain('«»');
  });

  it('labels the browser’s own marks as preliminary when the evaluation failed', () => {
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, null, new Set(['p1', 'p2']))} followup={null} stamp="none" seed="a" preliminary />,
    );
    expect(screen.getByText('Предварительно: по ключевым словам')).toBeInTheDocument();
    // Named by key words only: the provisional pencil dot, never a tick before the check (Jury_Check item 7).
    expect(container.querySelectorAll('svg[data-mark="dot"]')).toHaveLength(2);
    expect(container.querySelector('svg[data-mark="tick"], svg[data-mark="dtick"]')).toBeNull();
    expect(container.textContent).not.toContain('Засчитано');
    expect(container.querySelector('[data-point="p1"] .or-ppt-st')?.textContent).toBe('главный пункт · по ключевым словам назван');
    expect(container.querySelector('[data-point="p5"] .or-ppt-st')?.textContent).toBe('по ключевым словам не назван');
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
    render(<ProtocolGrade result={result} previous="Прошлый ответ, 1 окт.: «удовлетворительно»." />);
    // The memo's stage example: «не знаю» on the follow-up about a missing main point is a 3.
    expect(screen.getByText('Оценка 3 · удовлетворительно')).toBeInTheDocument();
    // The long word is set smaller, on the digit's line.
    expect(document.querySelector('.or-grade-word')).toHaveAttribute('data-long');
    expect(screen.getByText('Раскрыто 3 пункта из 5, один упомянут, один не назван.')).toBeInTheDocument();
    expect(screen.queryByText(/\/ 9 = 67 из 100 → 3/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Как считается' }));
    expect(screen.getByText('(2 + 2 + 1 + 0 + 1) / 9 = 67 из 100 → 3')).toBeInTheDocument();
    expect(screen.getByText('Здесь оценку ограничил пункт 4: на вопрос экзаменатора о нём не было верного ответа.')).toBeInTheDocument();
    expect(screen.getByText('Оценка тренировочная: по пунктам эталона из ваших лекций, а не по требованиям преподавателя.')).toBeInTheDocument();
    // The previous answer is its own line under «Как считается», a grade in words (redesign critique 4, round 2).
    const row = screen.getByRole('button', { name: 'Как считается' }).closest('.or-how-row') as HTMLElement;
    expect(row.textContent).toBe('Как считается');
    expect(screen.getByText('Прошлый ответ, 1 окт.: «удовлетворительно».')).toHaveClass('or-prev-line');
    expect(document.body.textContent).not.toMatch(/3 из 5/);
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

  it('shows a grade that today’s formula gives exactly like a fresh protocol', () => {
    const capped = storedGrade({ ...stored, score: 67, grade: 3 });
    expect(capped.note).toBeNull();
    expect(capped.result).toMatchObject({ score: 67, grade: 3, passed: false, cap: 'essential_unrecovered', capPoint: { id: 'p4', number: 4 } });
    expect(capped.result.terms).toHaveLength(5);
    expect(storedPoints(stored, { p1: [['вес']] })[0]).toMatchObject({ fragments: 'фрагмент 12', anchors: [['вес']] });
  });

  it('shows a 4 given under the old rule with «не знаю» by the old rule, its formula and a note', () => {
    const old = storedGrade(stored);
    expect(old.result).toMatchObject({ score: 67, grade: 4, word: 'хорошо', passed: true, cap: null, capSkipped: null, capPoint: null });
    expect(old.note).toBe(OLD_RULE_NOTE);
    // Nothing heard after «Не расслышал ответ» is the same case.
    const silent = storedGrade({ ...stored, followup: { ...stored.followup!, student_quote: '' } });
    expect(silent.note).toBe(OLD_RULE_NOTE);
    // Another answer to the question may have been judged by key words that day: a neutral note.
    const said = storedGrade({ ...stored, followup: { ...stored.followup!, student_quote: 'колебания' } });
    expect(said.result.grade).toBe(4);
    expect(said.note).toBe(SAVED_GRADE_NOTE);
    render(<ProtocolGrade result={old.result} note={old.note} />);
    expect(screen.getByText('Оценка 4 · хорошо')).toBeInTheDocument();
    expect(document.querySelector('.or-grade-word')).not.toHaveAttribute('data-long');
    expect(screen.getByText(OLD_RULE_NOTE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Как считается' }));
    expect(screen.getByText('(2 + 2 + 1 + 0 + 1) / 9 = 67 из 100 → 4')).toBeInTheDocument();
    expect(screen.queryByText(CAP_SKIPPED_SENTENCE)).toBeNull();
  });

  it('shows a saved grade that matches neither reading as it was saved, without a formula line', () => {
    const neither = storedGrade({ ...stored, score: 90, grade: 5 });
    expect(neither.result).toMatchObject({ score: 90, grade: 5, word: 'отлично', passed: true, terms: [], cap: null });
    expect(neither.note).toBe(SAVED_GRADE_NOTE);
    render(<ProtocolGrade result={neither.result} note={neither.note} />);
    expect(screen.getByText('Оценка 5 · отлично')).toBeInTheDocument();
    expect(screen.getByText(SAVED_GRADE_NOTE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Как считается' }));
    expect(document.querySelector('.or-how-formula')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\(\)\s*\//);
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

describe('<ProtocolSheet>: round 2 of the stage critique', () => {
  it('says above the fold which point the examiner asked about and why', () => {
    stubReducedMotion(false);
    const { container, rerender } = render(
      <ProtocolSheet heading="Вопрос 12 · ответ 4 октября, 1:13" points={livePoints(DEMO_RUBRIC, evaluation)} followup={followup} stamp="passed" seed="attempt-1" />,
    );
    const note = container.querySelector('.or-asked') as HTMLElement;
    // The wording is kept; it is a button now (Jury_Check item 9).
    expect(note.textContent).toBe('Пункт 4 не назван — о нём спросил экзаменатор.');
    expect(within(note).getByRole('button', { name: 'Пункт 4 не назван — о нём спросил экзаменатор.' })).toHaveClass('or-asked-link');
    // Right under the header, before the first point.
    expect(note.compareDocumentPosition(container.querySelector('.or-ppts') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(
      <ProtocolSheet
        heading="Вопрос 12 · ответ 4 октября, 1:13"
        points={livePoints(DEMO_RUBRIC, evaluation)}
        followup={{ ...followup, pointId: 'p5' }}
        stamp="passed"
        seed="attempt-1"
      />,
    );
    expect(container.querySelector('.or-asked')?.textContent).toBe('В пункте 5 ошибка — о ней спросил экзаменатор.');

    rerender(<ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation)} followup={null} stamp="passed" seed="attempt-1" />);
    expect(container.querySelector('.or-asked')).toBeNull();
  });

  it('names a lecture on its first quote only', () => {
    stubReducedMotion(false);
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation)} followup={followup} stamp="passed" seed="attempt-1" />,
    );
    const labels = Array.from(container.querySelectorAll('.or-q2-label, .or-slip-cap'))
      .map((item) => item.textContent?.replace(/\s/g, ' ') ?? '')
      .filter((text) => text.startsWith('Лекция'));
    expect(labels[0]).toBe('Лекция «Нейронные сети», фрагмент 12:');
    expect(labels.slice(1).every((text) => !text.includes('«'))).toBe(true);
    expect(labels.slice(1)).toContain('Лекция, фрагмент 14');
  });

  it('draws the point marks in lecture order and the oval after the last one', () => {
    stubReducedMotion(false);
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation)} followup={followup} stamp="passed" seed="attempt-1" animate />,
    );
    const delays = Array.from(container.querySelectorAll('.or-ppt > .or-pt-m svg'))
      .map((svg) => svg.querySelector('mask path, path.sf-mark-fade') as SVGElement | null)
      .map((path) => parseInt(path?.style.animationDelay ?? '', 10));
    expect(delays).toHaveLength(5);
    expect(delays[0]).toBe(0);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    const oval = container.querySelector('.or-stamp svg mask path') as SVGElement;
    // 5 points: the last mark starts at 240 ms and takes 250 ms; the oval starts at 490 ms.
    expect(parseInt(oval.style.animationDelay, 10)).toBe(4 * 60 + 250);
    expect(Math.max(...delays)).toBeLessThan(parseInt(oval.style.animationDelay, 10));
  });

  it('marks the rows named by key words with the provisional dot on a preliminary sheet', () => {
    stubReducedMotion(false);
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, null, new Set(['p1', 'p2']))} followup={null} stamp="none" seed="attempt-1" preliminary />,
    );
    expect(container.querySelectorAll('svg[data-mark="dot"]')).toHaveLength(2);
    expect(container.querySelector('svg[data-mark="tick"], svg[data-mark="dtick"]')).toBeNull();
  });
});

describe('«Как считается», formula v2', () => {
  const stage = [
    { id: 'p1', essential: true, status: 'covered' as const },
    { id: 'p2', essential: true, status: 'covered' as const },
    { id: 'p3', essential: true, status: 'partial' as const },
    { id: 'p4', essential: true, status: 'missing' as const },
    { id: 'p5', essential: false, status: 'covered' as const },
  ];
  const RULE = 'Если экзаменатор спросил о главном пункте, который не назван или назван неверно, а ответа на его вопрос нет или он неверный, — не выше 3.';

  it('states the weights, the credits and all three caps', () => {
    const { container } = render(<HowGraded result={gradeAnswer(stage, null)} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Главный пункт весит 2, остальные — 1.');
    expect(text).toContain('Ответ на вопрос экзаменатора поднимает свой пункт до 0,5, частичный ответ — до 0,25.');
    expect(text).toContain('Ошибка в главном пункте — не выше 4, две ошибки — не выше 3.');
    expect(text).toContain(RULE);
    expect(text).toContain('В готовность засчитываются ответы на 4 и 5.');
    expect(container.querySelector('.or-how-cap')).toBeNull();
  });

  it('names the point that capped the grade', () => {
    const { container } = render(<HowGraded result={gradeAnswer(stage, { point_id: 'p4', status: 'missing' })} />);
    expect(container.querySelector('.or-how-formula')?.textContent).toBe('(2 + 2 + 1 + 0 + 1) / 9 = 67 из 100 → 3');
    expect(container.querySelector('.or-how-cap')?.textContent).toBe('Здесь оценку ограничил пункт 4: на вопрос экзаменатора о нём не было верного ответа.');
  });

  it('says the cap was not applied to a follow-up judged only by key words', () => {
    const { container } = render(<HowGraded result={gradeAnswer(stage, { point_id: 'p4', status: 'missing', judgedBy: 'keywords' })} />);
    expect(container.querySelector('.or-how-formula')?.textContent).toBe('(2 + 2 + 1 + 0 + 1) / 9 = 67 из 100 → 4');
    expect(container.querySelector('.or-how-cap')?.textContent).toBe(CAP_SKIPPED_SENTENCE);
    expect(CAP_SKIPPED_SENTENCE).toBe('Ответ на вопрос экзаменатора проверен только по ключевым словам, поэтому этот потолок здесь не применён.');
  });

  it('names the other two caps when they set the grade', () => {
    const wrong = gradeAnswer(
      [
        { id: 'p1', essential: true, status: 'wrong' },
        { id: 'p2', essential: true, status: 'covered' },
        { id: 'p3', essential: true, status: 'covered' },
        { id: 'p4', essential: true, status: 'covered' },
        { id: 'p5', essential: false, status: 'covered' },
      ],
      { point_id: 'p1', status: 'covered' },
    );
    const first = render(<HowGraded result={wrong} />);
    expect(first.container.querySelector('.or-how-cap')?.textContent).toBe('Здесь оценку ограничила ошибка в главном пункте.');
    first.unmount();
    const two = gradeAnswer(
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, index) => ({ id, essential: true, status: index < 2 ? ('wrong' as const) : ('covered' as const) })),
      null,
    );
    const second = render(<HowGraded result={two} />);
    expect(second.container.querySelector('.or-how-cap')?.textContent).toBe('Здесь оценку ограничили две ошибки.');
  });
});

describe('key words versus the check (Jury_Check item 7)', () => {
  it('words the disagreement in both directions without speaking of marks on screen', () => {
    expect(keywordNote(true, 'partial')).toBe('По ключевым словам пункт назван; проверка по всему ответу: упомянут.');
    expect(keywordNote(true, 'missing')).toBe('По ключевым словам пункт назван; проверка по всему ответу: не назван.');
    expect(keywordNote(true, 'wrong')).toBe('По ключевым словам пункт назван; проверка по всему ответу: ошибка.');
    expect(keywordNote(false, 'covered')).toBe('По ключевым словам пункт не назван; проверка по всему ответу: раскрыт.');
    expect(keywordNote(false, 'partial')).toBe('По ключевым словам пункт не назван; проверка по всему ответу: упомянут.');
    for (const agree of [keywordNote(true, 'covered'), keywordNote(false, 'missing'), keywordNote(false, 'wrong'), keywordNote(true, 'unrated'), keywordNote(false, 'unrated')]) {
      expect(agree).toBeNull();
    }
    for (const status of ['covered', 'partial', 'missing', 'wrong'] as const) {
      for (const live of [true, false]) expect(keywordNote(live, status) ?? '').not.toMatch(/отмет|галоч|экран/);
    }
  });

  it('explains p3 of the QA stub (named by key words, judged «упомянут») with the check’s comment', () => {
    const stub: Evaluation = {
      points: evaluation.points.map((point) =>
        point.id === 'p3' ? { ...point, status: 'partial' as const, comment: 'Названо, но без градиента по каждому весу.' } : point,
      ),
      errors: [],
      verdict: '',
    };
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, stub, new Set(['p1', 'p2', 'p3', 'p5']))} followup={followup} stamp="not_passed" seed="a" />,
    );
    const p3 = container.querySelector('[data-point="p3"]') as HTMLElement;
    expect(p3.querySelector('.or-ppt-why')?.textContent).toBe('По ключевым словам пункт назван; проверка по всему ответу: упомянут.');
    expect(Array.from(p3.querySelectorAll('.or-ppt-cm')).map((node) => node.textContent)).toContain('Названо, но без градиента по каждому весу.');
    // Agreement: no line. p1 named and covered, p4 not named and missing.
    expect(container.querySelector('[data-point="p1"] .or-ppt-why')).toBeNull();
    expect(container.querySelector('[data-point="p4"] .or-ppt-why')).toBeNull();
    // p5 was named by key words and said wrong.
    expect(container.querySelector('[data-point="p5"] .or-ppt-why')?.textContent).toBe('По ключевым словам пункт назван; проверка по всему ответу: ошибка.');
  });

  it('explains a point the key words missed but the check counted, with its comment, also in a saved protocol', () => {
    const stored = {
      points: [
        { id: 'p1', title: 'Пункт', essential: true, status: 'covered', student_quote: 'своими словами', comment: 'Сказано своими словами.', source_ids: ['S04'], material_id: 'm1', source_quote: 'подбор весов', source_label: '«Нейросети», фрагмент 4', live: false },
        { id: 'p2', title: 'Второй', essential: false, status: 'partial', student_quote: 'шаг', comment: '', source_ids: ['S05'], material_id: 'm1', source_quote: 'шаг обучения', source_label: '«Нейросети», фрагмент 5', live: false },
      ],
      errors: [],
    } as unknown as StoredProtocol;
    const { container } = render(<ProtocolSheet heading="h" points={storedPoints(stored, {})} followup={null} stamp="passed" seed="s" />);
    expect(container.querySelector('[data-point="p1"] .or-ppt-why')?.textContent).toBe('По ключевым словам пункт не назван; проверка по всему ответу: раскрыт.');
    expect(container.querySelector('[data-point="p1"] .or-ppt-cm')?.textContent).toBe('Сказано своими словами.');
    expect(container.querySelector('[data-point="p2"] .or-ppt-why')?.textContent).toBe('По ключевым словам пункт не назван; проверка по всему ответу: упомянут.');
  });
});

/** The lecture's label of every point: the last label of its row («Вы:» comes first), or its slip's caption. */
function lectureLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.or-ppt')).map((row) => {
    const labels = row.querySelectorAll('.or-q2-label, .or-slip-cap');
    return labels[labels.length - 1]?.textContent?.replace(/\s/g, ' ') ?? '';
  });
}

describe('lecture labels: «там же» against the quote right above (QA r3 #1)', () => {
  const twoLectures = {
    ...DEMO_RUBRIC,
    materials: [
      { key: 'M1', material_id: 'mat-1', title: 'Нейронные сети и глубокое обучение' },
      { key: 'M2', material_id: 'mat-2', title: 'Инфляция' },
    ],
    // p1 M1, p2 M1, p3 M2, p4 M1, p5 M2 — the points of two lectures alternate (QA s35b).
    points: DEMO_RUBRIC.points.map((point, index) => ({ ...point, source_ids: [`${['M1', 'M1', 'M2', 'M1', 'M2'][index]}:S${[8, 9, 4, 11, 3][index]}`] })),
  };

  it('names the lecture unless the quote right above came from the same one', () => {
    expect(lectureMentions(livePoints(twoLectures, null))).toEqual([true, false, true, true, true]);
  });

  it('labels the covered quotes and the slips the same way', () => {
    const covered: Evaluation = { points: evaluation.points.map((point) => ({ ...point, status: 'covered' as const })), errors: [], verdict: '' };
    const sheet = render(<ProtocolSheet heading="h" points={livePoints(twoLectures, covered)} followup={null} stamp="passed" seed="a" />);
    const labels = () => lectureLabels(sheet.container);
    expect(labels()).toEqual([
      'Лекция «Нейронные сети и глубокое обучение», фрагмент 8:',
      'Лекция, фрагмент 9:',
      'Лекция «Инфляция», фрагмент 4:',
      'Лекция «Нейронные сети и глубокое обучение», фрагмент 11:',
      'Лекция «Инфляция», фрагмент 3:',
    ]);
    sheet.unmount();
    // QA s35b: p3 and p4 are slips (partial, missing), the rest covered.
    const mixed: Evaluation = {
      points: evaluation.points.map((point, index) => ({ ...point, status: (['covered', 'covered', 'partial', 'missing', 'covered'] as const)[index] })),
      errors: [],
      verdict: '',
    };
    const qa = render(<ProtocolSheet heading="h" points={livePoints(twoLectures, mixed)} followup={null} stamp="passed" seed="a" />);
    expect(lectureLabels(qa.container)).toEqual([
      'Лекция «Нейронные сети и глубокое обучение», фрагмент 8:',
      'Лекция, фрагмент 9:',
      'Лекция «Инфляция», фрагмент 4',
      'Лекция «Нейронные сети и глубокое обучение», фрагмент 11',
      'Лекция «Инфляция», фрагмент 3:',
    ]);
  });

  it('starts again after a point without a quote', () => {
    const points = [
      { sourceLabel: '«Нейросети», фрагмент 1', sourceQuote: 'а' },
      { sourceLabel: '«Нейросети», фрагмент 2', sourceQuote: '' },
      { sourceLabel: '«Нейросети», фрагмент 3', sourceQuote: 'в' },
      { sourceLabel: '«Нейросети», фрагмент 4', sourceQuote: 'г' },
      { sourceLabel: 'фрагмент 5', sourceQuote: 'д' },
      { sourceLabel: '«Нейросети», фрагмент 6', sourceQuote: 'е' },
    ] satisfies Array<Pick<ProtocolPoint, 'sourceLabel' | 'sourceQuote'>>;
    // An untitled label never names a lecture, and the next titled quote names its own again.
    expect(lectureMentions(points)).toEqual([true, false, true, false, false, true]);
  });
});

describe('the line about the asked point (Jury_Check item 9)', () => {
  it('scrolls the asked point into view in 400 ms and moves the focus to it', () => {
    stubReducedMotion(false);
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation)} followup={followup} stamp="not_passed" seed="a" />,
    );
    const row = container.querySelector('[data-point="p4"]') as HTMLElement;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: 900, bottom: 1000, left: 0, right: 0, width: 0, height: 100, x: 0, y: 900, toJSON: () => ({}) });
    fireEvent.click(screen.getByRole('button', { name: 'Пункт 4 не назван — о нём спросил экзаменатор.' }));
    expect(document.activeElement).toBe(row);
    expect(row).toHaveAttribute('tabindex', '-1');
    // The page's own smooth scrolling is not used: each step is instant, the last one lands on the row.
    act(() => {
      now = ASKED_SCROLL_MS / 2;
      frames.shift()?.(now);
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: expect.any(Number), behavior: 'instant' });
    const middle = scrollTo.mock.lastCall?.[0].top as number;
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(900 - 16);
    act(() => {
      now = ASKED_SCROLL_MS;
      frames.shift()?.(now);
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 900 - 16, behavior: 'instant' });
    expect(frames).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('jumps without the animation under reduced motion', () => {
    stubReducedMotion(true);
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation)} followup={followup} stamp="not_passed" seed="a" />,
    );
    const row = container.querySelector('[data-point="p4"]') as HTMLElement;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: 640, bottom: 700, left: 0, right: 0, width: 0, height: 60, x: 0, y: 640, toJSON: () => ({}) });
    fireEvent.click(screen.getByRole('button', { name: 'Пункт 4 не назван — о нём спросил экзаменатор.' }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 640 - 16, behavior: 'instant' });
    expect(raf).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row);
    vi.restoreAllMocks();
  });
});
