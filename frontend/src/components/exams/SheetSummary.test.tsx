import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { TicketLayout } from '../../api/exams';
import type { SheetCoverage } from './marks';
import { confirmedCountWords, CoverageSummary, PeakSummary, PhoneSummary, ReadinessBlock, ReadinessLegend, peakCountLine, readinessCounts, type PeakView } from './SheetSummary';
import { closedPartialShares, coverageCounts, coverageShares, type SheetFilter, type ShareSubject } from './sheetModel';

/** The seeded stage list: 24 «есть», 7 «частично», 9 «нет»; sections 13 · 4 · 3 and 11 · 3 · 6. */
const NONE = new Set([5, 8, 17, 22, 26, 29, 35, 38, 40]);
const PARTIAL = new Set([3, 9, 14, 19, 24, 33, 37]);

function seeded(override: (position: number) => SheetCoverage | null = () => null): ShareSubject[] {
  return Array.from({ length: 40 }, (_, index) => {
    const position = index + 1;
    const coverage: SheetCoverage = override(position) ?? (NONE.has(position) ? 'none' : PARTIAL.has(position) ? 'partial' : 'full');
    return { id: `q${position}`, section: position <= 20 ? 1 : 2, coverage };
  });
}

const RANDOM: TicketLayout = { mode: 'random', per_ticket: 2 };
const plain = (text: string | null | undefined) => (text ?? '').replace(/[  ]/g, ' ');
const named = (text: string) => (name: string) => plain(name) === text;

function renderSummary(
  questions: ShareSubject[],
  layout: TicketLayout = RANDOM,
  extra: Partial<Parameters<typeof CoverageSummary>[0]> = {},
) {
  const onFilter = vi.fn();
  const props = {
    counts: coverageCounts(questions),
    checking: null,
    shares: coverageShares(questions, layout),
    closed: closedPartialShares(questions, layout),
    layout,
    howOpen: false,
    onHow: vi.fn(),
    howId: 'how',
    filter: 'all' as SheetFilter,
    onFilter,
    ...extra,
  };
  const view = render(<CoverageSummary {...props} />);
  return { ...view, onFilter, props };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('peak 1, simplified: one figure, the rest behind «Как считается» (owner, 2026-10-07)', () => {
  it('shows the ticket share with its label, the short caveat with «Как считается», and no second number', () => {
    const { container } = renderSummary(seeded());
    expect(plain(container.querySelector('.ex-figs-now')?.textContent)).toBe('35 %');
    expect(container.querySelectorAll('.ex-big')).toHaveLength(1);
    expect(screen.getByText('билетов, где оба вопроса есть в лекциях')).toBeInTheDocument();
    expect(plain(container.querySelector('.ex-caveat[data-inline]')?.textContent)).toBe('Это доля билетов, а не вероятность сдать. Как считается');
    // No struck question share, no count of the gap, no line (c) on the card itself.
    expect(container.querySelector('.ex-figs-was, [data-mark="strike"], .ex-gap-n, .ex-gapline, .ex-pairs')).toBeNull();
    expect(plain(container.textContent)).not.toMatch(/нет ни в одной лекции|в 15 % билетов|24 из 40/);
  });

  it('opens the numbers behind it: the questions in the lectures, the tickets without «есть», the assumption, the formulas', () => {
    const { container } = renderSummary(seeded(), RANDOM, { howOpen: true });
    const calc = container.querySelector('.ex-calc') as HTMLElement;
    const lines = Array.from(calc.querySelectorAll(':scope > p.ex-fine')).map((item) => plain(item.textContent));
    expect(lines.slice(0, 3)).toEqual([
      'В лекциях есть 24 вопроса из 40 (60 %), частично — 7, ни в одной лекции — 9.',
      'В 15 % билетов нет ни одного вопроса с отметкой «есть».',
      'Это доля билетов, а не вероятность сдать: считаем, что билет — два случайных вопроса из 40.',
    ]);
    expect(within(calc).getAllByRole('math')).toHaveLength(2);
  });

  it('keeps the action line right under «Как считается»; its link filters the sheet to «частично»', () => {
    const { container, onFilter } = renderSummary(seeded());
    const action = container.querySelector('.ex-act') as HTMLElement;
    expect(plain(action.textContent)).toBe('7 вопросов «частично»: добавьте к ним материал — тогда оба вопроса будут в лекциях в 60 % билетов.');
    expect(screen.getByRole('button', { name: 'Как считается' }).closest('.ex-caveat')?.nextElementSibling).toBe(action);
    fireEvent.click(within(action).getByRole('button', { name: named('7 вопросов «частично»') }));
    expect(onFilter).toHaveBeenCalledWith('cov:partial');
  });

  it('one question per section: 36 %, and 60 % with «частично» closed; the assumption of sections inside', () => {
    const { container } = renderSummary(seeded(), { mode: 'sections', per_ticket: 2 }, { howOpen: true });
    expect(plain(container.querySelector('.ex-figs-now')?.textContent)).toBe('36 %');
    expect(plain(container.querySelector('.ex-act')?.textContent)).toBe('7 вопросов «частично»: добавьте к ним материал — тогда оба вопроса будут в лекциях в 60 % билетов.');
    expect(screen.getByText(named('В 16 % билетов нет ни одного вопроса с отметкой «есть».'))).toBeInTheDocument();
    expect(plain(container.querySelector('.ex-calc-assume')?.textContent)).toBe(
      'Это доля билетов, а не вероятность сдать: считаем, что в билете по одному случайному вопросу из каждого раздела.',
    );
  });

  it('the department’s tickets: direct counts', () => {
    const tickets = Array.from({ length: 20 }, (_, index) => ({ number: index + 1, question_ids: [`q${index + 1}`, `q${index + 21}`] }));
    const { container } = renderSummary(seeded(), { mode: 'fixed', per_ticket: 2, tickets }, { howOpen: true });
    expect(plain(container.querySelector('.ex-figs-now')?.textContent)).toBe('30 %');
    expect(screen.getByText('билетов, где все вопросы есть в лекциях')).toBeInTheDocument();
    expect(screen.getByText(named('Билетов кафедры, где все вопросы есть в лекциях, — 6 из 20.'))).toBeInTheDocument();
    expect(screen.getByText(named('В 2 из 20 билетов нет ни одного вопроса с отметкой «есть».'))).toBeInTheDocument();
    expect(plain(container.querySelector('.ex-act')?.textContent)).toBe('7 вопросов «частично»: добавьте к ним материал — тогда все вопросы будут в лекциях в 11 из 20 билетов.');
  });

  it('one question per ticket: the share of questions, no line about tickets without «есть»', () => {
    const { container } = renderSummary(seeded(), { mode: 'random', per_ticket: 1 }, { howOpen: true });
    expect(plain(container.querySelector('.ex-figs-now')?.textContent)).toBe('60 %');
    expect(screen.getByText('вопросов есть в ваших лекциях')).toBeInTheDocument();
    expect(plain(container.querySelector('.ex-act')?.textContent)).toBe('7 вопросов «частично»: добавьте к ним материал — тогда в лекциях будет 78 % вопросов.');
    expect(plain(container.textContent)).not.toContain('нет ни одного вопроса с отметкой «есть»');
  });

  it('a range while questions are found only by words; «Как считается» says how many', () => {
    const list = Array.from({ length: 40 }, (_, index) => ({ id: `q${index}`, section: null, coverage: (index < 17 ? 'full' : index < 27 ? 'unverified' : 'none') as SheetCoverage }));
    const { container } = renderSummary(list, RANDOM, { howOpen: true });
    expect(container.querySelector('.ex-figs')).toHaveAttribute('data-range');
    expect(plain(container.querySelector('.ex-calc-q')?.textContent)).toBe('В лекциях есть 17 вопросов из 40 (43–68 %), ни в одной лекции — 13, только по словам — 10.');
    expect(plain(container.querySelector('.ex-calc')?.textContent)).toContain('10 вопросов проверены только по словам — доля билетов:');
  });

  it('hides the action line without «частично» questions or when closing them raises nothing', () => {
    const none = renderSummary(seeded((position) => (PARTIAL.has(position) ? 'none' : null)));
    expect(none.container.querySelector('.ex-act')).toBeNull();
    none.unmount();
    // Three per ticket with one «есть»: closing the one «частично» still leaves no complete ticket.
    const list: ShareSubject[] = Array.from({ length: 30 }, (_, index) => ({
      id: `q${index}`,
      section: null,
      coverage: (index === 0 ? 'full' : index === 1 ? 'partial' : 'none') as SheetCoverage,
    }));
    const flat = renderSummary(list, { mode: 'random', per_ticket: 3 });
    expect(flat.container.querySelector('.ex-act')).toBeNull();
  });

  it('says nothing before a question is checked: the status block above the page says it', () => {
    const { container } = renderSummary(seeded(() => 'unmapped'));
    expect(container.textContent).toBe('');
  });
});

describe('peak 1 on phones and tablets', () => {
  it('keeps the figure with «Как считается» above the sheet and the action line under it', () => {
    const head = renderSummary(seeded(), RANDOM, { part: 'head' });
    expect(head.container.querySelector('.ex-figs-now')).toHaveTextContent('35');
    expect(head.container.querySelector('.ex-act')).toBeNull();
    expect(plain(head.container.querySelector('.ex-caveat[data-inline]')?.textContent)).toBe('Это доля билетов, а не вероятность сдать. Как считается');
    head.unmount();
    const rest = renderSummary(seeded(), RANDOM, { part: 'rest' });
    expect(rest.container.querySelector('.ex-figs')).toBeNull();
    const children = Array.from(rest.container.querySelector('.ex-summary')?.children ?? []).map((item) => item.className);
    expect(children).toEqual(['ex-act']);
  });

  it('says nothing under the sheet while a mapping run is going', () => {
    const { container } = renderSummary(seeded(), RANDOM, { part: 'rest', checking: { checked: 3, total: 40 } });
    expect(container.textContent).toBe('');
  });
});

describe('the readiness block', () => {
  const summary = { total: 40, confirmed: 7, once: 3, notPassed: 2, untested: 28, since: '2026-10-01', stale: 2 };
  const confidence = { ratedKnow: 0, ratedKnowAnswered: 0, ratedKnowPassed: 0, enoughData: false };
  const block = (props: Partial<Parameters<typeof ReadinessBlock>[0]> = {}) =>
    render(
      <ReadinessBlock
        summary={summary}
        confidence={confidence}
        answers="ready"
        answersError={null}
        filter="all"
        onFilter={vi.fn()}
        onRateMode={vi.fn()}
        growth="С 1 октября: 0 → 7 за 3 дня."
        staleLine="Пора проверить: 2 — подтверждены больше 14 дней назад."
        secondAnswer="Второй ответ после разбора: по 5 вопросам в первый раз раскрыто 48 % пунктов, во второй — 81 %."
        {...props}
      />,
    );

  it('says the one number, the growth from history, what is «пора проверить», what «подтверждено» means and the second answer', () => {
    const { container } = block();
    const lines = Array.from(container.querySelectorAll('.ex-blk > p')).map((item) => plain(item.textContent));
    expect(lines).toEqual([
      'Подтверждено ответами — 7 из 40.',
      'С 1 октября: 0 → 7 за 3 дня.',
      'Пора проверить: 2 — подтверждены больше 14 дней назад.',
      'Подтверждено — значит, дважды, в разные дни, в ответе названо достаточно пунктов.',
      'Второй ответ после разбора: по 5 вопросам в первый раз раскрыто 48 % пунктов, во второй — 81 %.',
    ]);
    const legend = screen.getByRole('list', { name: 'Показать вопросы по ответам' });
    expect(within(legend).getAllByRole('button').map((item) => plain(item.textContent).replace(/^12/, ''))).toEqual([
      'подтверждено 7',
      'названо достаточно, не подтверждено 3',
      'названо недостаточно 2',
      'не проверялось 28',
    ]);
  });

  it('compares confidence with the answers only for a student who has used «Самооценка»', () => {
    const quiet = block();
    expect(plain(quiet.container.textContent)).not.toContain('Сравнить уверенность');
    expect(screen.queryByRole('button', { name: 'Самооценка' })).toBeNull();
    quiet.unmount();
    block({ selfRated: true });
    expect(screen.getByText(/Сравнить уверенность с ответами пока нельзя/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Самооценка' })).toBeInTheDocument();
  });

  it('says nothing before the first answer', () => {
    const { container } = block({ summary: { ...summary, confirmed: 0, once: 0, notPassed: 0, untested: 40, stale: 0 } });
    expect(container.textContent).toBe('');
  });
});

describe('the summary on a phone (Phone_Declutter_2026-10-08)', () => {
  const answers = {
    summary: { total: 40, confirmed: 7, once: 3, notPassed: 2, untested: 28, since: '2026-10-01', stale: 0 },
    confidence: { ratedKnow: 0, ratedKnowAnswered: 0, ratedKnowPassed: 0, enoughData: false },
    answers: 'ready' as const,
    answersError: null,
    filter: 'all' as SheetFilter,
    onFilter: vi.fn(),
    onRateMode: vi.fn(),
  };
  function phone(extra: Partial<Parameters<typeof PhoneSummary>[0]> = {}) {
    const questions = seeded();
    const onFilter = vi.fn();
    const onToggle = vi.fn();
    const props = {
      coverage: { counts: coverageCounts(questions), shares: coverageShares(questions, RANDOM), closed: closedPartialShares(questions, RANDOM), layout: RANDOM },
      readiness: answers,
      facts: '2 лекции · сверка от 7 октября, 15:39',
      filter: 'all' as SheetFilter,
      onFilter,
      open: false,
      onToggle,
      id: 'how',
      ...extra,
    };
    const view = render(<PhoneSummary {...props} />);
    return { ...view, onFilter, onToggle };
  }

  it('the figure in one line with «Как считается» (muted: it explains), the answers’ count; nothing else until it opens', () => {
    const { container, onToggle } = phone();
    // A sentence, then the link — no «·» glue outside a meta line.
    expect(plain(container.querySelector('.ex-psum-fig')?.textContent)).toBe('35 % билетов, где оба вопроса есть в лекциях. Как считается');
    expect(plain(container.querySelector('.ex-psum-line')?.textContent)).toBe('Подтверждено ответами — 7 вопросов из 40');
    expect(container.querySelector('.ex-calc')).toBeNull();
    const how = screen.getByRole('button', { name: 'Как считается' });
    expect(how).toHaveAttribute('data-muted');
    expect(how).toHaveAttribute('aria-expanded', 'false');
    expect(how).not.toHaveAttribute('aria-controls');
    fireEvent.click(how);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('names what is counted, in its plural: 1, 2, 5, 21', () => {
    expect(confirmedCountWords(0, 20).replace(/\u00a0/g, ' ')).toBe('0 вопросов из 20');
    expect(confirmedCountWords(1, 20).replace(/\u00a0/g, ' ')).toBe('1 вопрос из 20');
    expect(confirmedCountWords(2, 20).replace(/\u00a0/g, ' ')).toBe('2 вопроса из 20');
    expect(confirmedCountWords(5, 20).replace(/\u00a0/g, ' ')).toBe('5 вопросов из 20');
    expect(confirmedCountWords(11, 40).replace(/\u00a0/g, ' ')).toBe('11 вопросов из 40');
    expect(confirmedCountWords(21, 40).replace(/\u00a0/g, ' ')).toBe('21 вопрос из 40');
  });

  it('what asks for an answer now stays in sight: «Пора проверить» and «Второй ответ после разбора», a muted line each under the count', () => {
    const second = 'Второй ответ после разбора: по 3 вопросам в первый раз раскрыто 40 % пунктов, во второй — 70 %.';
    const stale = 'Пора проверить: 2 — подтверждены больше 14 дней назад.';
    const { container } = phone({ readiness: { ...answers, staleLine: stale, secondAnswer: second } });
    expect(Array.from(container.querySelectorAll('.ex-psum-line')).map((item) => plain(item.textContent))).toEqual([
      'Подтверждено ответами — 7 вопросов из 40',
      stale,
      second,
    ]);
    expect(container.querySelectorAll('.ex-psum-note')).toHaveLength(2);
    cleanup();
    // Not said twice behind «Как считается».
    const open = phone({ open: true, readiness: { ...answers, staleLine: stale, secondAnswer: second } });
    const panel = open.container.querySelector('#how') as HTMLElement;
    expect(plain(panel.textContent)).not.toContain('Пора проверить');
    expect(plain(panel.textContent)).not.toContain('Второй ответ после разбора');
  });

  it('open: the facts of the meta line, the numbers, the action line, the assumption, the formulas, then what «подтверждено» means — the legend is «Обозначения» over the list', () => {
    const { container, onFilter } = phone({ open: true });
    const panel = container.querySelector('#how') as HTMLElement;
    const lines = Array.from(panel.querySelectorAll(':scope > p.ex-fine, :scope > p.ex-act')).map((item) => plain(item.textContent));
    expect(lines.slice(0, 5)).toEqual([
      '2 лекции · сверка от 7 октября, 15:39',
      'В лекциях есть 24 вопроса из 40 (60 %), частично — 7, ни в одной лекции — 9.',
      'В 15 % билетов нет ни одного вопроса с отметкой «есть».',
      '7 вопросов «частично»: добавьте к ним материал — тогда оба вопроса будут в лекциях в 60 % билетов.',
      'Это доля билетов, а не вероятность сдать: считаем, что билет — два случайных вопроса из 40.',
    ]);
    expect(panel.querySelector('.ex-formula')).not.toBeNull();
    expect(plain(panel.querySelector('.ex-blk')?.textContent)).toContain('Подтверждено — значит, дважды, в разные дни, в ответе названо достаточно пунктов.');
    fireEvent.click(within(panel).getByRole('button', { name: named('7 вопросов «частично»') }));
    expect(onFilter).toHaveBeenCalledWith('cov:partial');
    expect(within(panel).queryByRole('list', { name: 'Показать вопросы по ответам' })).toBeNull();
  });

  it('only the answers while the share says nothing, only the share before the first answer, nothing with neither', () => {
    const { container } = phone({ coverage: null });
    expect(container.querySelector('.ex-psum-fig')).toBeNull();
    expect(plain(container.querySelector('.ex-psum-line')?.textContent)).toBe('Подтверждено ответами — 7 вопросов из 40. Как считается');
    cleanup();
    const first = phone({ readiness: null });
    expect(first.container.querySelector('.ex-psum-line')).toBeNull();
    cleanup();
    const none = phone({ coverage: null, readiness: null });
    expect(none.container.textContent).toBe('');
  });
});

describe('the readiness legend (the key to the number circles)', () => {
  it('four marks with their words and counts; a row shows those questions, a second press all again', () => {
    const onFilter = vi.fn();
    const counts = readinessCounts({ confirmed: 7, once: 3, notPassed: 2, untested: 28 });
    const view = render(<ReadinessLegend counts={counts} filter="all" onFilter={onFilter} />);
    const list = screen.getByRole('list', { name: 'Показать вопросы по ответам' });
    expect(within(list).getAllByRole('button').map((item) => plain(item.textContent))).toEqual([
      'подтверждено 7',
      'названо достаточно, не подтверждено 3',
      'названо недостаточно 2',
      'не проверялось 28',
    ]);
    fireEvent.click(within(list).getByRole('button', { name: /^названо недостаточно/ }));
    expect(onFilter).toHaveBeenCalledWith('rd:not_passed');
    view.rerender(<ReadinessLegend counts={counts} filter="rd:not_passed" onFilter={onFilter} />);
    const pressed = within(list).getByRole('button', { name: /^названо недостаточно/ });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pressed);
    expect(onFilter).toHaveBeenLastCalledWith('all');
  });
});

describe('peak 3 column', () => {
  const base: PeakView = { title: 'Подтверждено ответами', before: 6, after: 7, total: 40, statement: 'Вопрос 12 подтверждён ответом, который вы дали только что.', fine: [] };

  it('shows the growth from history, the days and the net change of the day', () => {
    const { container } = render(<PeakSummary peak={{ ...base, growth: { to: 7, total: 40, days: 3, today: 1 }, second: 'Второй ответ после разбора: …' }} confidence={null} onClose={vi.fn()} />);
    expect(plain(container.querySelector('.ex-peak-big .ex-now')?.textContent)).toBe('0 → 7 из 40');
    expect(plain(container.querySelector('.ex-peak-growth')?.textContent)).toBe('за 3 дня+1 сегодня');
    expect(plain(container.querySelector('.ex-peak-big .ex-sr')?.textContent)).toBe(
      'Подтверждено ответами: 7 из 40, было 6. Подтверждено ответами: от 0 до 7 из 40 за 3 дня, плюс 1 сегодня.',
    );
    expect(Array.from(container.querySelectorAll('.ex-peak-stmt')).map((item) => plain(item.textContent))).toEqual([
      'Вопрос 12 подтверждён ответом, который вы дали только что.',
      'Второй ответ после разбора: …',
    ]);
  });

  it('keeps the count of the transition when nothing is confirmed: never «0 → 0»', () => {
    const view = { ...base, title: 'Названо достаточно, не подтверждено', before: 2, after: 3, total: null, growth: null };
    const { container } = render(<PeakSummary peak={view} confidence={null} onClose={vi.fn()} />);
    expect(plain(container.querySelector('.ex-now')?.textContent)).toBe('3');
    expect(plain(container.querySelector('.ex-was')?.textContent)).toBe('было 2');
    expect(container.textContent).not.toContain('→');
    expect(peakCountLine(view)).toBe('Названо достаточно, не подтверждено: 3, было 2.');
  });

  it('after a 3 names the transition and still shows the growth, without «+1»', () => {
    const view = { ...base, title: 'Названо недостаточно', before: 1, after: 2, total: null, growth: { to: 7, total: 40, days: 3, today: 0 } };
    const { container } = render(<PeakSummary peak={view} confidence={null} onClose={vi.fn()} />);
    expect(screen.getByText('Названо недостаточно')).toBeInTheDocument();
    expect(plain(container.querySelector('.ex-now')?.textContent)).toBe('0 → 7 из 40');
    expect(plain(container.querySelector('.ex-peak-growth')?.textContent)).toBe('подтвержденоза 3 дня');
    expect(container.querySelector('.ex-peak-growth b')).toBeNull();
  });
});
