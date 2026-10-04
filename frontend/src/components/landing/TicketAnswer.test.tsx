import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import TicketAnswer, { TICKET_COPY, cutQuote } from './TicketAnswer';
import { DEMO_SHEET, EXAM, HERO_PAGE, KEY_SENTENCE, LECTURE_FRAGMENTS, TICKET, fragmentOf } from './lecture';

const plain = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

function mockMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

/** IntersectionObserver whose reports the test controls. */
class ControlledObserver {
  static all: ControlledObserver[] = [];
  readonly targets: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: IntersectionObserverCallback) { ControlledObserver.all.push(this); }
  observe(target: Element) { this.targets.push(target); }
  unobserve() {}
  disconnect() { this.disconnected = true; }
  takeRecords() { return []; }
  report(ratio: number) {
    if (this.disconnected) return;
    this.callback(this.targets.map(target => ({ isIntersecting: ratio > 0, intersectionRatio: ratio, target }) as unknown as IntersectionObserverEntry), this as unknown as IntersectionObserver);
  }
}
const reportAll = (ratio: number) => act(() => { for (const o of ControlledObserver.all) o.report(ratio); });

const rows = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLLIElement>('.lp-tk-pts > li'));
const braceWrap = (root: ParentNode) => root.querySelector<HTMLElement>('.lp-tk-brace');
/** Position of the lecture paragraph that holds the quote, counted here without fragmentOf(). */
const paragraphOf = (quote: string) => LECTURE_FRAGMENTS.findIndex(p => plain(p).includes(plain(quote))) + 1;

describe('TicketAnswer', () => {
  beforeEach(() => {
    ControlledObserver.all = [];
    vi.stubGlobal('IntersectionObserver', ControlledObserver);
    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.unstubAllGlobals();
  });

  it('puts the ticket question on a card and five rows on the answer sheet: four named, one closed', () => {
    const { container } = render(<TicketAnswer />);
    expect(screen.getByRole('heading', { level: 2, name: 'Ответ на билет' })).toBeInTheDocument();
    expect(plain(screen.getByRole('heading', { level: 3 }).textContent)).toBe(plain(EXAM.question));
    expect(TICKET.question).toBe(EXAM.question);
    expect(plain(container.querySelector('.lp-tk-no')?.textContent)).toBe('Случайный билет · вопрос 1 из 2');

    const list = screen.getByRole('list', { name: 'Пункты эталона' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    const named = rows(container).filter(row => row.hasAttribute('data-named'));
    const closed = rows(container).filter(row => row.hasAttribute('data-closed'));
    expect(named).toHaveLength(4);
    expect(closed).toHaveLength(1);
    // a named row: the pencil dot (named by key words), never the protocol's tick
    for (const row of named) {
      expect(row.querySelectorAll('svg[data-mark="dot"]')).toHaveLength(1);
      expect(row.querySelector('svg[data-mark="tick"], svg[data-mark="dtick"]')).toBeNull();
    }
    // the closed row: a number and a dotted line, nothing to read
    expect(closed[0].querySelector('.lp-tk-blank')).not.toBeNull();
    expect(closed[0].querySelector('svg[data-mark="dot"]')).toBeNull();
  });

  it('builds the lecture fragments from the page’s own texts, in their order', () => {
    expect(LECTURE_FRAGMENTS).toEqual([
      `${HERO_PAGE.p1}${HERO_PAGE.p1more}`,
      KEY_SENTENCE,
      HERO_PAGE.more,
      `${DEMO_SHEET.sources[0]} ${DEMO_SHEET.aside}`,
      DEMO_SHEET.sources[1],
      DEMO_SHEET.sources[2],
    ]);
  });

  it('quotes the lecture verbatim: each quote is a piece of one paragraph, never a whole sentence', () => {
    const sentences = LECTURE_FRAGMENTS.flatMap(p => plain(p).split(/(?<=[.!?])\s+/)).map(s => s.replace(/[.!?]$/, ''));
    expect(TICKET.points).toHaveLength(5);
    for (const point of TICKET.points) {
      const quote = plain(point.quote);
      const holders = LECTURE_FRAGMENTS.filter(p => plain(p).includes(quote));
      expect(holders, quote).toHaveLength(1);
      expect(sentences, quote).not.toContain(quote);
    }
    const { container } = render(<TicketAnswer />);
    const shown = rows(container).filter(row => row.hasAttribute('data-named')).map(row => plain(row.querySelector('.lp-tk-quote')?.textContent));
    const expected = TICKET.points.filter(point => point.named).map(point => `«${plain(cutQuote(point.quote))}»`);
    expect(shown).toEqual(expected);
    // a quote cut mid-sentence starts with «…», as on the answer sheet
    expect(shown[0].startsWith('«…легко найти замену')).toBe(true);
    expect(shown[1].startsWith('«Хлеб и лекарства')).toBe(true);
  });

  it('numbers «фрагмент N» by the quoted paragraph’s position in the lecture', () => {
    const { container } = render(<TicketAnswer />);
    const named = TICKET.points.filter(point => point.named);
    const notes = rows(container).filter(row => row.hasAttribute('data-named')).map(row => plain(row.querySelector('.lp-tk-src')?.textContent));
    expect(notes).toEqual(named.map(point => `фрагмент ${paragraphOf(point.quote)}`));
    expect(notes).toEqual(['фрагмент 3', 'фрагмент 3', 'фрагмент 5', 'фрагмент 6']);
    for (const point of TICKET.points) expect(fragmentOf(point.quote)).toBe(paragraphOf(point.quote));
    expect(fragmentOf('этого в лекции нет')).toBe(0);
  });

  it('marks the one closed row with a brace and «вопрос экзаменатора» and puts the examiner’s question beside it', () => {
    const { container } = render(<TicketAnswer />);
    const closed = rows(container).find(row => row.hasAttribute('data-closed'))!;
    expect(closed.dataset.point).toBe(TICKET.examiner.point);
    expect(closed.querySelectorAll('svg[data-mark="brace"]')).toHaveLength(1);
    expect(plain(closed.textContent)).toContain('вопрос экзаменатора');
    expect(container.querySelectorAll('svg[data-mark="brace"]')).toHaveLength(1);
    // the point that was not named stays off the page: it cannot prompt
    const missed = TICKET.points.find(point => point.id === TICKET.examiner.point)!;
    expect(plain(container.textContent)).not.toContain(plain(missed.quote));
    expect(plain(container.textContent)).not.toContain(plain(missed.title));

    const examiner = container.querySelector('.lp-tk-examiner')!;
    expect(plain(examiner.querySelector('.lp-tk-who')?.textContent)).toBe('Экзаменатор');
    expect(plain(examiner.querySelector('.lp-tk-ask')?.textContent)).toBe('«Хорошо. А когда спрос называют эластичным?»');
  });

  it('shows one point of the protocol: the tick of «раскрыт», «Вы» and «Лекция, фрагмент N», the same words underlined', () => {
    const { container } = render(<TicketAnswer />);
    const protocol = container.querySelector<HTMLElement>('.lp-tk-proto')!;
    const point = TICKET.points.find(p => p.id === TICKET.protocol.point)!;
    const n = paragraphOf(point.quote);
    expect(n).toBe(3);
    expect(plain(protocol.querySelector('.lp-tk-sh')?.textContent)).toBe('Протокол ответа');
    expect(protocol.querySelectorAll('svg[data-mark="tick"]')).toHaveLength(1);
    expect(plain(protocol.querySelector('.lp-tk-ptitle')?.textContent)).toBe(`Пункт 2: ${plain(point.title)}`);
    expect(plain(protocol.querySelector('.lp-tk-pst')?.textContent)).toBe(`раскрыт · фрагмент ${n}`);

    const you = protocol.querySelector<HTMLElement>('[data-line="you"]')!;
    const lecture = protocol.querySelector<HTMLElement>('[data-line="lecture"]')!;
    expect(plain(you.textContent)).toBe(`Вы: «${plain(TICKET.protocol.said)}»`);
    expect(plain(lecture.textContent)).toBe(`Лекция, фрагмент ${n}: «${plain(cutQuote(point.quote))}»`);
    const marked = (line: HTMLElement) => Array.from(line.querySelectorAll('.sf-under')).map(el => el.textContent);
    expect(marked(you)).toEqual(['кофе', 'замен']);
    expect(marked(lecture)).toEqual(['замену', 'кофе']);
  });

  it('states the rule in words: the quote is checked by code, the row opens when named, one question about the main point first', () => {
    render(<TicketAnswer />);
    const lead = plain(TICKET_COPY.lead);
    expect(lead).toBe('У каждого пункта эталона — дословная цитата из ваших лекций, её сверяет код. Строка открывается, когда вы называете пункт. Если вы пропустили пункт, экзаменатор задаст один вопрос — прежде всего о главном.');
    expect(screen.getByText(text => plain(text) === lead)).toHaveClass('lp-lead');
    expect(lead).not.toMatch(/спросит отдельно|о каждом/);
  });

  it('labels the example with its lecture in a plain caption', () => {
    const { container } = render(<TicketAnswer />);
    const caption = container.querySelector('figure.lp-tk-ex > figcaption')!;
    expect(plain(caption.textContent)).toBe('Пример на лекции «Эластичность спроса»');
    expect(caption).toHaveClass('lp-tk-cap');
  });

  it('keeps every mark aria-hidden and says what it means in words', () => {
    const { container } = render(<TicketAnswer />);
    const marks = Array.from(container.querySelectorAll('svg'));
    expect(marks.length).toBeGreaterThan(0);
    for (const svg of marks) expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
    // the dot: the sheet says the rows were marked by key words while the answer went on
    expect(plain(container.querySelector('.lp-tk-sheet > .lp-tk-sh')?.textContent)).toBe('Во время ответа · по ключевым словам');
    const named = rows(container).filter(row => row.hasAttribute('data-named'));
    named.forEach(row => expect(plain(row.querySelector('.sr-only')?.textContent)).toMatch(/^Пункт \d назван:$/));
    const closed = rows(container).find(row => row.hasAttribute('data-closed'))!;
    expect(plain(closed.querySelector('.sr-only')?.textContent)).toBe('Пункт 1 не назван, об этом спросил экзаменатор.');
    expect(plain(container.querySelector('.lp-tk-pst')?.textContent)).toContain('раскрыт');
    // no symbol stands in for a mark
    expect(container.textContent).not.toMatch(/[✓✗●◡⋯]/);
  });

  it('draws one pencil mark, once: the brace, when its row comes into view', () => {
    const { container } = render(<TicketAnswer />);
    expect(braceWrap(container)?.dataset.draw).toBe('wait');
    expect(container.querySelectorAll('svg[data-drawn="live"]')).toHaveLength(0);
    expect(ControlledObserver.all).toHaveLength(1);
    expect(ControlledObserver.all[0].targets[0]).toHaveAttribute('data-closed');

    reportAll(0.4);
    expect(braceWrap(container)?.dataset.draw).toBe('wait');
    reportAll(1);
    expect(braceWrap(container)?.dataset.draw).toBe('draw');
    const live = container.querySelectorAll('svg[data-drawn="live"]');
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveAttribute('data-mark', 'brace');
    expect(ControlledObserver.all.every(o => o.disconnected)).toBe(true);
  });

  it('draws nothing under reduced motion: the brace is simply there', () => {
    mockMatchMedia(true);
    const { container } = render(<TicketAnswer />);
    expect(braceWrap(container)?.dataset.draw).toBe('still');
    expect(container.querySelectorAll('svg[data-drawn="live"]')).toHaveLength(0);
    expect(ControlledObserver.all).toHaveLength(0);
  });

  it('shows the brace at once where nothing reports what is in view', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(<TicketAnswer />);
    expect(braceWrap(container)?.dataset.draw).toBe('still');
    expect(container.querySelector('svg[data-mark="brace"]')).toHaveAttribute('data-drawn', 'still');
  });

  it('plays nothing by itself', () => {
    vi.useFakeTimers();
    const { container } = render(<TicketAnswer />);
    const before = container.innerHTML;
    act(() => { vi.advanceTimersByTime(20000); });
    expect(container.innerHTML).toBe(before);
  });
});
