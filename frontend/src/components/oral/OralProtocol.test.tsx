import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  ASKED_SCROLL_MS,
  HowCounted,
  ProtocolResult,
  ProtocolSheet,
  ReviewCard,
  SCALE_NOTE,
  keywordNote,
  lectureMentions,
  livePoints,
  storedPoints,
  type ProtocolFollowup,
  type ProtocolPoint,
} from './OralProtocol';
import { DEMO_RUBRIC } from '../../lib/oral/testing/fixtures';
import type { Evaluation } from '../../lib/oral/oralApi';
import type { StoredProtocol } from '../../lib/oral/ticketData';
import { danglingControls } from '../../test/a11y';

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
      <ProtocolSheet heading="Билет 12, вопрос 1 · ответ 3 октября, 14:12" points={livePoints(DEMO_RUBRIC, evaluation)} followup={followup} seed="attempt-1" />,
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
    expect(p4.querySelector('.or-ppt-st')?.textContent?.replace(/\u00a0/g, ' ')).toBe('главный пункт · не назван; на вопрос экзаменатора — «не знаю»');
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
      <ProtocolSheet heading="h" points={livePoints(twoLectures, allCovered)} followup={null} seed="a" />,
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
    const { container } = render(<ProtocolSheet heading="h" points={storedPoints(stored, {})} followup={null} seed="s" />);
    const labels = Array.from(container.querySelectorAll('[data-point="p1"] .or-q2-label')).map((node) => node.textContent?.replace(/\u00a0/g, ' '));
    expect(labels).toEqual(['Вы:', 'Лекция «Нейронные сети и глубокое обучение», фрагмент 4:']);
    expect(container.querySelector('[data-point="p2"]')?.textContent).toContain('Лекция, фрагмент 5:');
  });

  it('says under the heading what the answer did to the cheat sheet, where the «Засчитано» stamp was (Ф1)', () => {
    const points = livePoints(DEMO_RUBRIC, evaluation);
    const { container, rerender } = render(
      <ProtocolSheet heading="h" points={points} followup={followup} sheetNote="В теме «Язык SQL» осталось 2 вопроса из 6." seed="a" />,
    );
    const note = container.querySelector('.or-ph .or-ph-sheet') as HTMLElement;
    expect(note.textContent).toBe('В теме «Язык SQL» осталось 2 вопроса из 6.');
    // Right under the date, before the line about the asked point.
    expect(container.querySelector('.or-ph-date')!.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No stamp, no oval, no verdict on the answer.
    expect(container.querySelector('.or-stamp, svg[data-mark="oval"]')).toBeNull();
    expect(container.textContent).not.toMatch(/[Зз]асчитан|[Зз]ачтено|отлично|хорошо|удовлетвор/);
    // Not known (not saved yet, a saved protocol read later): nothing in its place.
    rerender(<ProtocolSheet heading="h" points={points} followup={followup} seed="a" />);
    expect(container.querySelector('.or-ph-sheet')).toBeNull();
    expect(container.querySelector('.or-ph')?.textContent).toBe('h');
  });

  it('marks every main point «главный пункт» at the start of its status line, and only those', () => {
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation, new Set(['p1', 'p2', 'p3', 'p5']))} followup={followup} seed="a" />,
    );
    const lines = Object.fromEntries(
      DEMO_RUBRIC.points.map((point) => [point.id, container.querySelector(`[data-point="${point.id}"] .or-ppt-st`)?.textContent ?? '']),
    );
    expect(lines.p1).toBe('главный пункт · раскрыт · фрагмент\u00a012');
    expect(lines.p3).toBe('главный пункт · упомянут · фрагмент\u00a014');
    expect(lines.p4.replace(/\u00a0/g, ' ')).toBe('главный пункт · не назван; на вопрос экзаменатора — «не знаю»');
    // p5 is not a main point.
    expect(lines.p5).toBe('ошибка');
    for (const point of DEMO_RUBRIC.points) expect(lines[point.id].replace(/\u00a0/g, ' ').startsWith('главный пункт · ')).toBe(point.essential);
  });

  it('says when the follow-up was judged by key words, and never prints an empty quote', () => {
    const points = livePoints(DEMO_RUBRIC, evaluation);
    const answer = 'Будут колебания, и сеть может не сойтись';
    const byKeywords = render(
      <ProtocolSheet heading="h" points={points} followup={{ ...followup, answer, status: 'partial', judgedBy: 'keywords' }} seed="a" />,
    );
    expect(byKeywords.container.querySelector('[data-point="p4"] .or-ppt-st')?.textContent?.replace(/\u00a0/g, ' ')).toBe(
      'главный пункт · не назван; после вопроса экзаменатора по ключевым словам — упомянут',
    );
    expect(byKeywords.container.querySelector('.or-extra')?.textContent).toBe(
      `Дополнительный вопрос: «${followup.question}» — ответ: «${answer}». По ключевым словам пункт упомянут.`,
    );
    byKeywords.unmount();

    const byCheck = render(<ProtocolSheet heading="h" points={points} followup={{ ...followup, answer, status: 'partial', judgedBy: 'check' }} seed="a" />);
    expect(byCheck.container.querySelector('[data-point="p4"] .or-ppt-st')?.textContent?.replace(/\u00a0/g, ' ')).toBe('главный пункт · не назван; после вопроса экзаменатора — упомянут');
    expect(byCheck.container.querySelector('.or-extra')?.textContent).toBe(`Дополнительный вопрос: «${followup.question}» — ответ: «${answer}». Пункт упомянут.`);
    expect(byCheck.container.textContent).not.toMatch(/засчитан/);
    byCheck.unmount();

    const silent = render(<ProtocolSheet heading="h" points={points} followup={{ ...followup, answer: '', status: 'missing' }} seed="a" />);
    expect(silent.container.querySelector('[data-point="p4"] .or-ppt-st')?.textContent?.replace(/\u00a0/g, ' ')).toBe('главный пункт · не назван; на вопрос экзаменатора ответа не прозвучало');
    expect(silent.container.querySelector('.or-extra')?.textContent).toBe(`Дополнительный вопрос: «${followup.question}» — ответа не прозвучало.`);
    expect(silent.container.textContent).not.toContain('«»');
  });

  it('gives the asked point one status: named only after the examiner’s question, with the sheet’s words (EX-30)', () => {
    // The live run of 08.10: point 5 «упомянут» in the answer, not named by key words, named in the reply — the card
    // said «упомянут», «по ключевым словам не назван» and «пункт назван» at once.
    const points = livePoints(DEMO_RUBRIC, evaluation, new Set(['p1', 'p2']));
    const reply = 'Если шаг слишком большой, обучение колеблется и может разойтись.';
    const asked: ProtocolFollowup = { ...followup, pointId: 'p3', answer: reply, status: 'covered', judgedBy: 'check' };
    const { container } = render(<ProtocolSheet heading="h" points={points} followup={asked} seed="a" />);
    const p3 = container.querySelector('[data-point="p3"]')!;
    expect(p3.querySelector('.or-ppt-st')?.textContent?.replace(/\u00a0/g, ' ')).toBe('главный пункт · назван только после вопроса экзаменатора');
    // One status: no key-word aside on the asked point (the other points keep theirs).
    expect(p3.querySelector('.or-ppt-why')).toBeNull();
    // Half a point, as «упомянут»: the cup; the screen reader hears the same words as the line.
    expect(p3).toHaveAttribute('data-after');
    expect(p3.querySelector('svg[data-mark="cup"]')).not.toBeNull();
    expect(p3.querySelector('.or-pt-m .sr-only')?.textContent).toBe('назван только после вопроса экзаменатора');
    expect(container.querySelector('[data-point="p3"] .or-ppt-st')?.textContent).toContain('пункт\u00a0· назван');
    // The model's comment on the answer itself stays, said as the answer's: what was missing there.
    expect(p3.textContent).toContain('В ответе: назван метод, про градиент по весам не сказано.');
    // The line under the sheet: the reply without a doubled full stop, and what it did — the sheet keeps the line.
    expect(container.querySelector('.or-extra')?.textContent).toBe(
      `Дополнительный вопрос: «${followup.question}» — ответ: «${reply.slice(0, -1)}». Пункт назван после вопроса, его не считаем.`,
    );
    cleanup();

    // A point said wrong and put right in the reply keeps its error; one not named and not named in the reply says so.
    const fixed = render(<ProtocolSheet heading="h" points={points} followup={{ ...asked, pointId: 'p5' }} seed="a" />);
    const p5 = fixed.container.querySelector('[data-point="p5"]')!;
    expect(p5.querySelector('.or-ppt-st')?.textContent?.replace(/\u00a0/g, ' ')).toBe('ошибка, верно — только после вопроса экзаменатора');
    expect(p5.querySelector('svg[data-mark="cross"]')).not.toBeNull();
    fixed.unmount();
    const notNamed = render(<ProtocolSheet heading="h" points={points} followup={{ ...asked, pointId: 'p4', status: 'missing' }} seed="a" />);
    expect(notNamed.container.querySelector('[data-point="p4"] .or-ppt-st')?.textContent?.replace(/\u00a0/g, ' ')).toBe('главный пункт · не назван и после вопроса экзаменатора');
    expect(notNamed.container.querySelector('[data-point="p4"]')).not.toHaveAttribute('data-after');
    expect(notNamed.container.querySelector('.or-extra')?.textContent).toMatch(/». Пункт не назван\.$/);
    notNamed.unmount();
    // A point the answer itself had named: its status, and nothing about the sheet.
    const named = render(<ProtocolSheet heading="h" points={points} followup={{ ...asked, pointId: 'p1' }} seed="a" />);
    expect(named.container.querySelector('[data-point="p1"] .or-ppt-st')?.textContent?.replace(/\u00a0/g, ' ')).toBe('главный пункт · раскрыт');
    expect(named.container.querySelector('.or-extra')?.textContent).toMatch(/». Пункт назван\.$/);
  });

  it('labels the browser’s own marks as preliminary when the evaluation failed', () => {
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, null, new Set(['p1', 'p2']))} followup={null} seed="a" preliminary />,
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

describe('<ProtocolResult> (Ф1: no grade, no «Засчитано»)', () => {
  const points = livePoints(DEMO_RUBRIC, {
    points: [
      { id: 'p1', status: 'covered', student_quote: '', comment: '' },
      { id: 'p2', status: 'covered', student_quote: '', comment: '' },
      { id: 'p3', status: 'partial', student_quote: '', comment: '' },
      { id: 'p4', status: 'missing', student_quote: '', comment: '' },
      { id: 'p5', status: 'covered', student_quote: '', comment: '' },
    ],
    errors: [],
    verdict: '',
  });
  const sum = () => document.querySelector('.or-sum')?.textContent?.replace(/\u00a0/g, ' ');

  it('says what was named, the counts in a sentence, «Как считается» on request and who grades', () => {
    render(<ProtocolResult points={points} followup={{ pointId: 'p4', status: 'missing' }} previous="Прошлый ответ, 1 окт." />);
    // The memo's stage example: «не знаю» on the follow-up about a missing main point.
    expect(sum()).toBe('Сами назвали 2 из 4 главных пунктов');
    expect(screen.getByText('Раскрыто 3 пункта из 5, один упомянут, один не назван.')).toBeInTheDocument();
    expect(screen.getByText(SCALE_NOTE)).toBeInTheDocument();
    expect(SCALE_NOTE).toBe('Отметку ставит преподаватель по 10-\u2060балльной шкале. Meldy проверяет только, назвали ли вы пункты из своих лекций.');
    // «Итог» as the card's flag, not «Оценка».
    expect(document.querySelector('.or-grade-label')?.textContent).toBe('Итог');
    expect(document.querySelector('.or-how')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Как считается' }));
    expect(document.querySelector('.or-how')?.textContent?.replace(/\u00a0/g, ' ')).toContain('Такой пункт не считаем.');
    // The previous answer is its own line under «Как считается» (redesign critique 4, round 2).
    const row = screen.getByRole('button', { name: 'Как считается' }).closest('.or-how-row') as HTMLElement;
    expect(row.textContent).toBe('Как считается');
    expect(screen.getByText('Прошлый ответ, 1 окт.')).toHaveClass('or-prev-line');
    // Nothing of a grade: no digit, no word, no «Засчитано».
    expect(document.body.textContent).not.toMatch(/Оценка|отлично|хорошо|удовлетвор|[Зз]асчитан|→ [2-5]/);
  });

  it('keeps «10-балльной» on one line: a word joiner after the hyphen, the words as they were', () => {
    render(<ProtocolResult points={points} followup={null} />);
    // U+2060 draws nothing and allows no line break beside it; on a 360–414 px phone «10-» ended a line.
    expect(document.querySelector('.or-grade-fine')?.textContent).toContain('10-\u2060балльной');
    expect(SCALE_NOTE.match(/\u2060/g)).toHaveLength(1);
    expect(SCALE_NOTE.replace(/\u2060/g, '')).toBe(
      'Отметку ставит преподаватель по 10-балльной шкале. Meldy проверяет только, назвали ли вы пункты из своих лекций.',
    );
  });

  it('«Как считается» names in aria-controls only a panel that is there', () => {
    render(<ProtocolResult points={points} followup={null} />);
    const how = screen.getByRole('button', { name: 'Как считается' });
    // Collapsed, the panel is not rendered: no aria-controls pointing at nothing (QA 2026-10-07).
    expect(how).toHaveAttribute('aria-expanded', 'false');
    expect(how).not.toHaveAttribute('aria-controls');
    expect(danglingControls()).toEqual([]);
    fireEvent.click(how);
    expect(how).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(how.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('.or-how')).not.toBeNull();
    expect(danglingControls()).toEqual([]);
    fireEvent.click(how);
    expect(how).not.toHaveAttribute('aria-controls');
    expect(danglingControls()).toEqual([]);
  });

  it('adds the point named after the examiner’s question and the errors, only when there are any', () => {
    const wrong = points.map((point) => (point.id === 'p5' ? { ...point, status: 'wrong' as const } : point));
    render(<ProtocolResult points={wrong} followup={{ pointId: 'p4', status: 'covered' }} />);
    expect(sum()).toBe('Сами назвали 2 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора. Ошибка в 1 пункте');
    // «ещё 1» never breaks on a narrow phone: a number alone at a line's start read as a new count.
    expect(document.querySelector('.or-sum')?.textContent).toContain('ещё\u00a01');
  });

  it('says plainly when no point was judged, and lets the example put its own small lines', () => {
    const unrated = points.map((point) => ({ ...point, status: 'unrated' as const }));
    render(<ProtocolResult points={unrated} followup={null} fine={<p className="or-grade-fine">Своя строка.</p>} />);
    expect(sum()).toBe('Ни один пункт не оценён.');
    expect(document.querySelector('.or-grade-why')).toBeNull();
    expect(screen.getByText('Своя строка.')).toBeInTheDocument();
    expect(screen.queryByText(SCALE_NOTE)).toBeNull();
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
    followup: { point_id: 'p4', question: 'А что будет?', expected: 'Колебания.', status: 'covered', student_quote: 'колебания', chosen_by: 'check' },
    errors: [],
    verdict: '',
  };

  it('a point a protocol saved before release 28 lists an error for reads «ошибка», not «раскрыт» with a tick', async () => {
    // Live run 07.10 (an old protocol): point 3 «раскрыт» with a green tick and «Поправка: …» under it.
    const { protocolFromRow } = await import('../../lib/oral/ticketData');
    const row = {
      id: 'sess-old',
      kind: 'oral_ticket',
      subject: 'Базы данных',
      score: 92,
      completed_at: '2026-10-07T09:35:00Z',
      questions_json: [
        {
          question: 'Уровни изоляции транзакций',
          points: [
            { id: 'p1', title: 'Аномалии', essential: true, status: 'covered', credit: 1, student_quote: 'грязное чтение', comment: 'Названо.', live: true },
            {
              id: 'p3',
              title: 'Четыре уровня изоляции',
              essential: true,
              status: 'covered',
              credit: 1,
              student_quote: 'Стандарт SQL задаёт четыре уровня изоляции',
              comment: 'Все четыре уровня названы.',
              source_quote: 'Стандарт SQL определяет четыре уровня изоляции. Чем выше уровень, тем меньше аномалий',
              source_label: '«Нормализация и транзакции», фрагмент 14',
              source_ids: ['S14'],
              live: true,
            },
          ],
          errors: [{ point_id: 'p3', student_quote: 'чем выше уровень, тем больше аномалий', correction: 'Чем выше уровень изоляции, тем меньше аномалий.' }],
        },
      ],
    };
    const protocol = protocolFromRow(row)!;
    expect(protocol.points.map((point) => point.status)).toEqual(['covered', 'wrong']);
    // The saved errors stay as they were; the point reads the server's way since release 28.
    expect(protocol.errors).toHaveLength(1);
    const points = storedPoints(protocol, {});
    const { container } = render(<ProtocolSheet heading="Ответ от 7 окт., 12:35" points={points} followup={null} seed="sess-old" />);
    const p3 = container.querySelector('[data-point="p3"]')!;
    expect(p3.getAttribute('data-status')).toBe('wrong');
    expect(p3.querySelector('svg[data-mark="cross"]')).not.toBeNull();
    expect(p3.querySelector('svg[data-mark="tick"]')).toBeNull();
    expect(p3.querySelector('.or-ppt-st')?.textContent).toContain('ошибка');
    expect(p3.textContent).not.toContain('раскрыт');
    expect(p3.textContent).toContain('Поправка: Чем выше уровень изоляции, тем меньше аномалий.');
    expect(p3.textContent).toContain('Вы:«чем выше уровень, тем больше аномалий»');
    expect(p3.textContent).not.toContain('Все четыре уровня названы.'); // written for «раскрыт»
    cleanup();
    render(<ProtocolResult points={points} followup={null} />);
    expect(document.querySelector('.or-sum')?.textContent?.replace(/\u00a0/g, ' ')).toBe('Сами назвали 1 из 2 главных пунктов. Ошибка в 1 пункте');
  });

  it('counts the result from its saved points and follow-up, whatever grade was saved', () => {
    expect(storedPoints(stored, { p1: [['вес']] })[0]).toMatchObject({ fragments: 'фрагмент 12', anchors: [['вес']] });
    for (const grade of [5, 4, 3, 2]) {
      const { unmount } = render(
        <ProtocolResult points={storedPoints({ ...stored, grade }, {})} followup={{ pointId: 'p4', status: 'covered' }} />,
      );
      expect(document.querySelector('.or-sum')?.textContent?.replace(/\u00a0/g, ' ')).toBe('Сами назвали 2 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора');
      expect(document.body.textContent).not.toMatch(new RegExp(`Оценка|${grade} ·`));
      unmount();
    }
  });
});

describe('«Вы: в ответе не прозвучало» (live run of release 29.1)', () => {
  const point = (status: ProtocolPoint['status'], studentQuote = ''): ProtocolPoint => ({
    id: 'p1',
    number: 1,
    title: 'Аномалия обновления',
    essential: true,
    status,
    studentQuote,
    comment: status === 'partial' ? 'Названа избыточность, суть аномалии не раскрыта.' : '',
    corrections: [],
    sourceQuote: 'При смене телефона кафедры придётся изменить много строк',
    sourceLabel: '«Нормализация», фрагмент 2',
    fragments: 'фрагмент 2',
    anchors: [],
    live: true,
  });

  it('is said only of a point the status says was not named', () => {
    for (const status of ['partial', 'covered', 'wrong'] as const) {
      const { container, unmount } = render(<ProtocolSheet heading="Ответ" points={[point(status)]} followup={null} seed="s" />);
      expect(container.textContent).not.toContain('в ответе не прозвучало');
      expect(container.textContent).not.toContain('Вы:');
      unmount();
    }
    const partial = render(<ProtocolSheet heading="Ответ" points={[point('partial')]} followup={null} seed="s" />);
    // «упомянут» and what the check saw instead of a contradiction.
    expect(partial.container.textContent).toContain('упомянут');
    expect(partial.container.textContent).toContain('Названа избыточность, суть аномалии не раскрыта.');
    partial.unmount();
    for (const status of ['missing', 'unrated'] as const) {
      const { container, unmount } = render(<ProtocolSheet heading="Ответ" points={[point(status)]} followup={null} seed="s" />);
      expect(container.querySelector('.or-q2')?.textContent).toBe('Вы:в ответе не прозвучало');
      unmount();
    }
    const quoted = render(<ProtocolSheet heading="Ответ" points={[point('partial', 'вставка')]} followup={null} seed="s" />);
    expect(quoted.container.querySelector('.or-q2')?.textContent).toBe('Вы:«вставка»');
  });

  it('reads a table of the lecture in a quote as «ячейка — ячейка», the saved quote unchanged', () => {
    const table = { ...point('covered', 'четыре уровня'), sourceQuote: 'друг друга: Уровень изоляции | «Грязное» чтение | Фантомное чтение' };
    const { container } = render(<ProtocolSheet heading="Ответ" points={[table]} followup={null} seed="s" />);
    expect(container.textContent).toContain('«…друг друга: Уровень изоляции — «Грязное» чтение — Фантомное чтение»');
    expect(container.textContent).not.toContain('|');
    expect(table.sourceQuote).toContain(' | ');
  });
});

describe('<ReviewCard>', () => {
  it('puts the follow-up on an index card with «завтра» typed in its corner, no pencil handwriting', () => {
    const { container } = render(<ReviewCard question="А что будет, если взять слишком большую скорость обучения?" />);
    expect(screen.getByText('А что будет, если взять слишком большую скорость обучения?')).toBeInTheDocument();
    expect(container.querySelector('.or-rcard-when')?.textContent).toBe('завтра');
    expect(container.querySelector('.or-rcard svg')).toBeNull();
    expect(screen.getByText('Повторим завтра.')).toBeInTheDocument();
  });
});

describe('<ProtocolSheet>: round 2 of the stage critique', () => {
  it('says above the fold which point the examiner asked about and why', () => {
    stubReducedMotion(false);
    const { container, rerender } = render(
      <ProtocolSheet heading="Вопрос 12 · ответ 4 октября, 1:13" points={livePoints(DEMO_RUBRIC, evaluation)} followup={followup} seed="attempt-1" />,
    );
    const note = container.querySelector('.or-asked') as HTMLElement;
    // The wording is kept; it is a button now (Jury_Check item 9).
    expect(note.textContent).toBe('Пункт 4 не назван, о нём спросил экзаменатор.');
    expect(within(note).getByRole('button', { name: 'Пункт 4 не назван, о нём спросил экзаменатор.' })).toHaveClass('or-asked-link');
    // Right under the header, before the first point.
    expect(note.compareDocumentPosition(container.querySelector('.or-ppts') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(
      <ProtocolSheet
        heading="Вопрос 12 · ответ 4 октября, 1:13"
        points={livePoints(DEMO_RUBRIC, evaluation)}
        followup={{ ...followup, pointId: 'p5' }}
       
        seed="attempt-1"
      />,
    );
    expect(container.querySelector('.or-asked')?.textContent).toBe('В пункте 5 ошибка, о ней спросил экзаменатор.');

    rerender(<ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation)} followup={null} seed="attempt-1" />);
    expect(container.querySelector('.or-asked')).toBeNull();
  });

  describe('a point named only after the examiner’s question: every line says so (jury QA, 2026-10-11)', () => {
    // The answer named p1–p3 and p5; the examiner asked about p4 and the reply named it.
    const named: Evaluation = {
      points: [
        { id: 'p1', status: 'covered', student_quote: 'подбор весов, которые минимизируют функцию потерь', comment: '' },
        { id: 'p2', status: 'covered', student_quote: 'прямой проход через слои', comment: '' },
        { id: 'p3', status: 'covered', student_quote: 'обратное распространение', comment: '' },
        { id: 'p4', status: 'missing', student_quote: '', comment: 'Пункт про скорость обучения полностью отсутствует.' },
        { id: 'p5', status: 'covered', student_quote: 'Adam подбирает шаг', comment: '' },
      ],
      errors: [],
      verdict: '',
    };
    const reply: ProtocolFollowup = {
      pointId: 'p4',
      question: 'А что будет, если взять слишком большую скорость обучения?',
      answer: 'Начнутся колебания, и сеть может не сойтись.',
      status: 'covered',
      judgedBy: 'check',
    };
    const protocol = (evaluation: Evaluation, followup: ProtocolFollowup) => {
      // The key words lit up what the answer named, as in the example's run.
      const points = livePoints(DEMO_RUBRIC, evaluation, new Set(['p1', 'p2', 'p3', 'p5']));
      return render(
        <>
          <ProtocolSheet heading="Вопрос 12 · ответ 11 октября, 13:06" points={points} followup={followup} seed="attempt-1" />
          <ProtocolResult points={points} followup={followup} />
        </>,
      );
    };
    const text = (container: HTMLElement, selector: string) => (container.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();

    it('the header, the point, its comment, the result and the counts', () => {
      stubReducedMotion(false);
      const { container } = protocol(named, reply);
      // The header's link says what happened, not why the examiner asked.
      expect(screen.getByRole('button', { name: 'Пункт 4 назван только после вопроса экзаменатора.' })).toHaveClass('or-asked-link');
      const p4 = container.querySelector('[data-point="p4"]') as HTMLElement;
      expect(text(p4, '.or-ppt-st')).toBe('главный пункт · назван только после вопроса экзаменатора');
      // The check's comment is the answer's: «…полностью отсутствует» is not the point's last word.
      expect(text(p4, '.or-ppt-cm')).toBe('В ответе: пункт про скорость обучения полностью отсутствует.');
      expect(text(p4, '.or-q2')).toBe('Вы:в ответе не прозвучало');
      expect(text(container, '.or-sum')).toBe('Сами назвали 3 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора');
      expect(text(container, '.or-grade-why')).toBe('Раскрыто 4 пункта из 5, один назван после вопроса экзаменатора.');
      expect(text(container, '.or-extra')).toBe(
        'Дополнительный вопрос: «А что будет, если взять слишком большую скорость обучения?» — ответ: «Начнутся колебания, и сеть может не сойтись». Пункт назван после вопроса, его не считаем.',
      );
      // Nothing on the sheet says it was not named.
      expect(container.textContent).not.toContain('не назван');
    });

    it('an error put right on the question stays an error, said as one', () => {
      stubReducedMotion(false);
      const wrong: Evaluation = {
        points: named.points.map((point) => (point.id === 'p4' ? { ...point, status: 'wrong', student_quote: 'шаг не важен', comment: 'Сказано неверно.' } : point)),
        errors: [{ point_id: 'p4', student_quote: 'шаг не важен', correction: 'Большая скорость ускоряет, но может вызвать осцилляции.' }],
        verdict: '',
      };
      const { container } = protocol(wrong, reply);
      expect(screen.getByRole('button', { name: 'В пункте 4 ошибка. Верно только после вопроса экзаменатора.' })).toBeInTheDocument();
      const p4 = container.querySelector('[data-point="p4"]') as HTMLElement;
      expect(text(p4, '.or-ppt-st')).toBe('главный пункт · ошибка, верно — только после вопроса экзаменатора');
      expect(text(p4, '.or-ppt-cm')).toBe('В ответе: сказано неверно.');
      expect(text(container, '.or-grade-why')).toBe('Раскрыто 4 пункта из 5, в одном ошибка.');
    });

    it('a reply that did not name it leaves every line as it was', () => {
      stubReducedMotion(false);
      const { container } = protocol(named, { ...reply, status: 'partial' });
      expect(screen.getByRole('button', { name: 'Пункт 4 не назван, о нём спросил экзаменатор.' })).toBeInTheDocument();
      const p4 = container.querySelector('[data-point="p4"]') as HTMLElement;
      expect(text(p4, '.or-ppt-st')).toBe('главный пункт · не назван; после вопроса экзаменатора — упомянут');
      expect(text(p4, '.or-ppt-cm')).toBe('Пункт про скорость обучения полностью отсутствует.');
      expect(text(container, '.or-grade-why')).toBe('Раскрыто 4 пункта из 5, один не назван.');
    });
  });

  it('names a lecture on its first quote only', () => {
    stubReducedMotion(false);
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation)} followup={followup} seed="attempt-1" />,
    );
    const labels = Array.from(container.querySelectorAll('.or-q2-label, .or-slip-cap'))
      .map((item) => item.textContent?.replace(/\s/g, ' ') ?? '')
      .filter((text) => text.startsWith('Лекция'));
    expect(labels[0]).toBe('Лекция «Нейронные сети», фрагмент 12:');
    expect(labels.slice(1).every((text) => !text.includes('«'))).toBe(true);
    expect(labels.slice(1)).toContain('Лекция, фрагмент 14');
  });

  it('draws the point marks in lecture order', () => {
    stubReducedMotion(false);
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation)} followup={followup} seed="attempt-1" animate />,
    );
    const delays = Array.from(container.querySelectorAll('.or-ppt > .or-pt-m svg'))
      .map((svg) => svg.querySelector('mask path, path.sf-mark-fade') as SVGElement | null)
      .map((path) => parseInt(path?.style.animationDelay ?? '', 10));
    expect(delays).toHaveLength(5);
    expect(delays[0]).toBe(0);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    // 5 points: the last mark starts at 240 ms; no oval comes after it any more (Ф1).
    expect(Math.max(...delays)).toBe(4 * 60);
    expect(container.querySelector('svg[data-mark="oval"]')).toBeNull();
  });

  it('marks the rows named by key words with the provisional dot on a preliminary sheet', () => {
    stubReducedMotion(false);
    const { container } = render(
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, null, new Set(['p1', 'p2']))} followup={null} seed="attempt-1" preliminary />,
    );
    expect(container.querySelectorAll('svg[data-mark="dot"]')).toHaveLength(2);
    expect(container.querySelector('svg[data-mark="tick"], svg[data-mark="dtick"]')).toBeNull();
  });
});

describe('«Как считается» without a grade (Ф1)', () => {
  it('says what «сами», «после вопроса» and «ошибка» mean and when a question is confirmed, in words', () => {
    const { container } = render(<HowCounted />);
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Сами — пункт назван в ответе, до вопроса экзаменатора.');
    expect(text).toContain('После вопроса — пункт назван только в ответ на вопрос экзаменатора. Такой пункт не считаем.');
    expect(text).toContain('Ошибка — пункт назван неверно.');
    expect(text).toContain('Вопрос выучен, когда вы дважды, в разные дни, ответили полно');
    expect(text).toContain('С двумя ошибками ответ неполный.');
    // No digits of a grade, no formula, no «засчитано».
    expect(text).not.toMatch(/[Оо]ценк|из 100|→|[Зз]асчит|не выше [2-5]/);
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
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, stub, new Set(['p1', 'p2', 'p3', 'p5']))} followup={followup} seed="a" />,
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
    const { container } = render(<ProtocolSheet heading="h" points={storedPoints(stored, {})} followup={null} seed="s" />);
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
    const sheet = render(<ProtocolSheet heading="h" points={livePoints(twoLectures, covered)} followup={null} seed="a" />);
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
    const qa = render(<ProtocolSheet heading="h" points={livePoints(twoLectures, mixed)} followup={null} seed="a" />);
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
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation)} followup={followup} seed="a" />,
    );
    const row = container.querySelector('[data-point="p4"]') as HTMLElement;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: 900, bottom: 1000, left: 0, right: 0, width: 0, height: 100, x: 0, y: 900, toJSON: () => ({}) });
    fireEvent.click(screen.getByRole('button', { name: 'Пункт 4 не назван, о нём спросил экзаменатор.' }));
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
      <ProtocolSheet heading="h" points={livePoints(DEMO_RUBRIC, evaluation)} followup={followup} seed="a" />,
    );
    const row = container.querySelector('[data-point="p4"]') as HTMLElement;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: 640, bottom: 700, left: 0, right: 0, width: 0, height: 60, x: 0, y: 640, toJSON: () => ({}) });
    fireEvent.click(screen.getByRole('button', { name: 'Пункт 4 не назван, о нём спросил экзаменатор.' }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 640 - 16, behavior: 'instant' });
    expect(raf).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row);
    vi.restoreAllMocks();
  });
});
