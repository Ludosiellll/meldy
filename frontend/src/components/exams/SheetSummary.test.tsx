import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { TicketLayout } from '../../api/exams';
import type { SheetCoverage } from './marks';
import { CoverageSummary, PeakSummary, ReadinessBlock, peakCountLine, type PeakView } from './SheetSummary';
import { closedPartialShares, confirmedShares, coverageCounts, coverageShares, type SheetFilter, type ShareSubject } from './sheetModel';

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
    onRecheck: null,
    filter: 'all' as SheetFilter,
    onFilter,
    seedKey: 'exam-1',
    ...extra,
  };
  const view = render(<CoverageSummary {...props} />);
  return { ...view, onFilter, props };
}

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

describe('peak 1: (a) the questions in no lecture', () => {
  it('shows «9» at the size of the percentages with its label, and filters the sheet to them', () => {
    const { onFilter, rerender, props } = renderSummary(seeded());
    const figure = screen.getByRole('button', { name: named('9 вопросов нет ни в одной лекции. Показать их') });
    expect(figure).toHaveTextContent('9');
    expect(figure).toHaveClass('ex-big');
    expect(figure).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('вопросов нет ни в одной лекции')).toBeInTheDocument();
    fireEvent.click(figure);
    expect(onFilter).toHaveBeenCalledWith('cov:none');
    rerender(<CoverageSummary {...props} filter="cov:none" />);
    const pressed = screen.getByRole('button', { name: named('9 вопросов нет ни в одной лекции. Показать их') });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pressed);
    expect(onFilter).toHaveBeenLastCalledWith('all');
  });

  it('is not shown when every question is somewhere in the lectures', () => {
    renderSummary(seeded((position) => (NONE.has(position) ? 'partial' : null)));
    expect(screen.queryByRole('button', { name: /нет ни в одной лекции/ })).toBeNull();
  });
});

describe('peak 1: (b) the question share struck through beside the ticket share', () => {
  it('strikes «60 %» with an aria-hidden pencil stroke and says «вместо 60 % вопросов» in words', () => {
    stubReducedMotion(false);
    const { container } = renderSummary(seeded());
    const was = container.querySelector('.ex-figs-was') as HTMLElement;
    expect(plain(was.textContent)).toBe('60 %');
    expect(was).toHaveAttribute('aria-hidden', 'true');
    const strike = was.querySelector('svg[data-mark="strike"]') as SVGElement;
    expect(strike).toHaveAttribute('aria-hidden', 'true');
    // A saved mapping: the stroke is simply there.
    expect(strike).toHaveAttribute('data-drawn', 'still');
    expect(plain(container.querySelector('.ex-figs .ex-sr')?.textContent)).toBe('вместо 60 % вопросов — ');
    expect(plain(container.querySelector('.ex-figs-now')?.textContent)).toBe('35 %');
    expect(screen.getByText('билетов, где оба вопроса есть в лекциях')).toBeInTheDocument();
    expect(screen.getByText(named('24 из 40 · частично — 7'))).toBeInTheDocument();
  });

  it('draws the stroke in only right after a mapping run on this page, and never under reduced motion', () => {
    stubReducedMotion(false);
    const live = renderSummary(seeded(), RANDOM, { strikeLive: true });
    expect(live.container.querySelector('svg[data-mark="strike"]')).toHaveAttribute('data-drawn', 'live');
    live.unmount();
    stubReducedMotion(true);
    const reduced = renderSummary(seeded(), RANDOM, { strikeLive: true });
    expect(reduced.container.querySelector('svg[data-mark="strike"]')).toHaveAttribute('data-drawn', 'still');
  });

  it('strikes nothing for one question per ticket or when both shares are the same', () => {
    const single = renderSummary(seeded(), { mode: 'random', per_ticket: 1 });
    expect(single.container.querySelector('[data-mark="strike"]')).toBeNull();
    expect(plain(single.container.querySelector('.ex-figs-now')?.textContent)).toBe('60 %');
    expect(screen.getByText('вопросов есть в ваших лекциях')).toBeInTheDocument();
    expect(screen.getByText('Билет — один вопрос, поэтому доля билетов та же.')).toBeInTheDocument();
    single.unmount();
    const all = renderSummary(seeded(() => 'full'));
    expect(all.container.querySelector('[data-mark="strike"]')).toBeNull();
    expect(plain(all.container.querySelector('.ex-figs-now')?.textContent)).toBe('100 %');
  });

  it('gives the question share as a range with unverified and unmapped questions, struck the same way', () => {
    // 24 «есть», 4 not checked yet, 12 «нет»: 60–70 % of questions.
    const { container } = renderSummary(seeded((position) => (position >= 21 && position <= 24 ? 'unmapped' : PARTIAL.has(position) ? 'none' : null)));
    expect(plain(container.querySelector('.ex-figs-was')?.textContent)).toMatch(/^\d+–\d+ %$/);
    expect(container.querySelector('.ex-figs')).toHaveAttribute('data-range');
    expect(plain(container.querySelector('.ex-figs .ex-sr')?.textContent)).toMatch(/^вместо \d+–\d+ % вопросов — $/);
    cleanup();
    const unknown = renderSummary(
      Array.from({ length: 40 }, (_, index) => ({ id: `q${index}`, section: null, coverage: (index < 17 ? 'full' : index < 27 ? 'unverified' : 'none') as SheetCoverage })),
    );
    expect(plain(unknown.container.querySelector('.ex-figs-was')?.textContent)).toBe('43–68 %');
  });
});

describe('peak 1: (c) and the action line follow the exam’s layout', () => {
  it('random pairs: «в 15 % …» and «… в 60 % билетов»', () => {
    const { container, onFilter } = renderSummary(seeded());
    expect(screen.getByText(named('в 15 % билетов нет ни одного вопроса с отметкой «есть»'))).toBeInTheDocument();
    expect(plain(container.textContent)).not.toContain('хотя бы один');
    const action = container.querySelector('.ex-act') as HTMLElement;
    expect(plain(action.textContent)).toBe('Закройте 7 вопросов «частично» — оба вопроса будут в лекциях в 60 % билетов.');
    // Right under «Как считается».
    expect(screen.getByRole('button', { name: 'Как считается' }).nextElementSibling).toBe(action);
    fireEvent.click(within(action).getByRole('button', { name: named('7 вопросов «частично»') }));
    expect(onFilter).toHaveBeenCalledWith('cov:partial');
  });

  it('one question per section: «в 16 % …», 36 %, and 60 % with «частично» closed', () => {
    const { container } = renderSummary(seeded(), { mode: 'sections', per_ticket: 2 });
    expect(plain(container.querySelector('.ex-figs-now')?.textContent)).toBe('36 %');
    expect(screen.getByText(named('в 16 % билетов нет ни одного вопроса с отметкой «есть»'))).toBeInTheDocument();
    expect(plain(container.querySelector('.ex-act')?.textContent)).toBe('Закройте 7 вопросов «частично» — оба вопроса будут в лекциях в 60 % билетов.');
    expect(plain(container.querySelector('.ex-caveat[data-full]')?.textContent)).toBe(
      'Это доля билетов, а не вероятность сдать: считаем, что в билете по одному случайному вопросу из каждого раздела.',
    );
  });

  it('the department’s tickets: direct counts', () => {
    const tickets = Array.from({ length: 20 }, (_, index) => ({ number: index + 1, question_ids: [`q${index + 1}`, `q${index + 21}`] }));
    const { container } = renderSummary(seeded(), { mode: 'fixed', per_ticket: 2, tickets });
    expect(plain(container.querySelector('.ex-figs-now')?.textContent)).toBe('30 %');
    expect(screen.getByText('билетов, где все вопросы есть в лекциях')).toBeInTheDocument();
    expect(screen.getByText(named('24 из 40 · частично — 7 · 6 из 20 билетов'))).toBeInTheDocument();
    expect(screen.getByText(named('в 2 из 20 билетов нет ни одного вопроса с отметкой «есть»'))).toBeInTheDocument();
    expect(plain(container.querySelector('.ex-act')?.textContent)).toBe('Закройте 7 вопросов «частично» — все вопросы будут в лекциях в 11 из 20 билетов.');
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

  it('one question per ticket speaks of questions, without line (c)', () => {
    const { container } = renderSummary(seeded(), { mode: 'random', per_ticket: 1 });
    expect(plain(container.querySelector('.ex-act')?.textContent)).toBe('Закройте 7 вопросов «частично» — в лекциях будет 78 % вопросов.');
    expect(container.querySelector('.ex-gapline')).toBeNull();
  });
});

describe('peak 1 on phones and tablets', () => {
  it('keeps (a) and (b) above the sheet with the short caveat, and (c) with the action line under it', () => {
    const head = renderSummary(seeded(), RANDOM, { part: 'head' });
    const pairs = head.container.querySelector('.ex-pairs') as HTMLElement;
    expect(pairs).toHaveAttribute('data-compact');
    expect(pairs).toHaveAttribute('data-count', '2');
    expect(head.container.querySelector('.ex-gap-n')).toHaveTextContent('9');
    expect(head.container.querySelector('.ex-figs-now')).toHaveTextContent('35');
    expect(head.container.querySelector('.ex-gapline')).toBeNull();
    expect(head.container.querySelector('.ex-act')).toBeNull();
    expect(plain(head.container.querySelector('.ex-caveat[data-inline]')?.textContent)).toBe('Это доля билетов, а не вероятность сдать. Как считается');
    head.unmount();
    const rest = renderSummary(seeded(), RANDOM, { part: 'rest' });
    expect(rest.container.querySelector('.ex-pairs')).toBeNull();
    const children = Array.from(rest.container.querySelector('.ex-summary')?.children ?? []).map((item) => item.className);
    expect(children).toEqual(['ex-gapline', 'ex-act']);
  });

  it('says nothing under the sheet while a mapping run is going', () => {
    const { container } = renderSummary(seeded(), RANDOM, { part: 'rest', checking: { checked: 3, total: 40 } });
    expect(container.textContent).toBe('');
  });
});

describe('the readiness block', () => {
  const summary = { total: 40, confirmed: 7, once: 3, notPassed: 2, untested: 28, since: '2026-10-01', stale: 2 };
  const confidence = { ratedKnow: 0, ratedKnowAnswered: 0, ratedKnowPassed: 0, enoughData: false };

  it('says the growth from history, what is «пора проверить» and the second answer, with the new labels', () => {
    const shares = confirmedShares(
      Array.from({ length: 40 }, (_, index) => ({ id: `q${index}`, section: null, readiness: index < 7 ? 'confirmed' : 'untested' })),
      RANDOM,
    );
    const { container } = render(
      <ReadinessBlock
        summary={summary}
        confirmedShares={shares}
        perTicket={2}
        confidence={confidence}
        answers="ready"
        answersError={null}
        filter="all"
        onFilter={vi.fn()}
        onRateMode={vi.fn()}
        growth="С 1 октября: 0 → 7 за 3 дня."
        staleLine="Пора проверить: 2 — подтверждены больше 14 дней назад."
        secondAnswer="Второй ответ после разбора: по 5 вопросам в первый раз раскрыто 48 % пунктов, во второй — 81 %."
      />,
    );
    const lines = Array.from(container.querySelectorAll('.ex-blk > p')).map((item) => plain(item.textContent));
    expect(lines.slice(0, 5)).toEqual([
      'Подтверждено ответами — 7 из 40.',
      'С 1 октября: 0 → 7 за 3 дня.',
      'Пора проверить: 2 — подтверждены больше 14 дней назад.',
      'Подтверждено — значит, дважды, в разные дни, в ответе названо достаточно пунктов. Билетов, где подтверждены оба вопроса, — 3 %.',
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
