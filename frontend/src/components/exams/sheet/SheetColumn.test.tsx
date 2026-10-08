import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

import type { SheetWriteState } from '../../../api/cheatSheet';
import { localDayOf, type HistoryFrame, type LineState, type LineStatus, type SheetBlock, type SheetCounts, type SheetLine } from '../../../lib/exams/cheatSheet';
import { formatShortDay } from '../../../lib/exams/format';
import { historyResult, LinePanel, outcomeLine, quoteText, SheetSummaryCard, SheetWriteCard, unwritableLine, type SheetSummaryProps, type SheetWriteProps } from './SheetColumn';
import { examSheetLinks } from './useSheetPage';
import { SHEET_RULE } from './copy';

afterEach(() => {
  cleanup();
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
});

const plain = (text: string | null | undefined) => (text ?? '').replace(/\u00a0/g, ' ');
/** An accessible name as read, with the non-breaking spaces of glue() read as spaces. */
const named = (text: string) => (name: string) => plain(name) === text;

const COUNTS: SheetCounts = {
  total: 47,
  left: 39,
  essentialTotal: 27,
  essentialLeft: 21,
  rubbed: 5,
  erased: 8,
  due: 3,
  readable: 31,
  learned: 2,
  withoutLines: 9,
  gaps: 4,
  unwritten: 3,
  rebuilt: 0,
  unmapped: 1,
  unverified: 1,
  questions: 30,
};

const MODE = { onlyLeft: false, cover: false, zoom: false };

function summary(extra: Partial<SheetSummaryProps> = {}) {
  const props: SheetSummaryProps = {
    counts: COUNTS,
    left: 39,
    roll: false,
    shareLine: '35 % билетов, где оба вопроса есть в лекциях',
    changeLine: 'После ответа: 2 строки стёрлись, 1 — наполовину.',
    mode: MODE,
    onMode: vi.fn(),
    onReplay: vi.fn(),
    onHistory: vi.fn(),
    history: null,
    onHistoryStop: vi.fn(),
    ...extra,
  };
  render(<SheetSummaryCard {...props} />);
  return props;
}

describe('SheetSummaryCard', () => {
  it('full: the flag with «Весь лист на экране», the count with its details, the change, the rule with how a line looks, the share, two switches and the links', () => {
    const props = summary();
    expect(screen.getByText('Шпаргалка')).toBeTruthy();
    expect(document.querySelector('.cs-big')?.textContent).toBe('39');
    expect(plain(document.querySelector('.cs-count-l')?.textContent)).toBe('строк осталось из 47');
    expect(plain(document.querySelector('.cs-sub')?.textContent)).toBe('главных строк — 21 из 27 · стёрты наполовину — 5 · пора проверить — 3 · у 6 вопросов нет пунктов ответа');
    // The rule, word for word, with a piece of the paper after «наполовину» and «совсем» (EX-17): for the eye only.
    const rule = document.querySelector('.cs-rule') as HTMLElement;
    expect(plain(rule.textContent)).toBe(SHEET_RULE);
    expect([...rule.querySelectorAll<HTMLElement>('.cs-swatch')].map((swatch) => [swatch.dataset.state, swatch.getAttribute('aria-hidden')])).toEqual([
      ['rubbed', 'true'],
      ['erased', 'true'],
    ]);
    expect(rule.querySelector('.cs-swatch .cs-line[data-state="rubbed"] .cs-patch')).not.toBeNull();
    // The rolling digits are hidden from a screen reader; the count is read once, whole.
    expect(plain(document.querySelector('.cs-count .sr-only')?.textContent)).toBe('39 строк осталось из 47');
    expect(plain(document.querySelector('.cs-change')?.textContent)).toBe('После ответа: 2 строки стёрлись, 1 — наполовину.');
    expect(plain(document.querySelector('.cs-share')?.textContent)).toContain('35 % билетов');
    // Two switches by their names (EX-14); what «Спрятать строки» is for is said under it, and is its description.
    const switches = screen.getAllByRole('switch');
    expect(switches.map((item) => item.querySelector('.cs-toggle-t')?.textContent)).toEqual(['Скрыть строки, стёртые совсем', 'Спрятать строки']);
    expect(switches.every((item) => item.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(switches[0]).toHaveAccessibleName('Скрыть строки, стёртые совсем');
    expect(switches[0]).not.toHaveAttribute('aria-disabled');
    expect(switches[1]).toHaveAccessibleName('Спрятать строки');
    expect(switches[1]).toHaveAccessibleDescription(/^и\sпроверить,\sчто\sпомните\sих$/);
    expect(switches[1]).not.toHaveAttribute('title');
    fireEvent.click(switches[0]);
    expect(props.onMode).toHaveBeenCalledWith({ ...MODE, onlyLeft: true });
    // «Вся шпаргалка» is a zoom: a button by the flag with a magnifier, named by what it does.
    const zoom = screen.getByRole('button', { name: 'Весь лист на экране' });
    expect(zoom.closest('.cs-head')?.querySelector('.cs-flag')).not.toBeNull();
    expect(zoom.querySelector('svg.cs-zoom-i')).not.toBeNull();
    fireEvent.click(zoom);
    expect(props.onMode).toHaveBeenCalledWith({ ...MODE, zoom: true });
    fireEvent.click(screen.getByRole('button', { name: 'Показать последний ответ' }));
    expect(props.onReplay).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'История шпаргалки' }));
    expect(props.onHistory).toHaveBeenCalledTimes(1);
  });

  it('zoomed: the button says how to go back; the self-test switch on: its note replaces the hint', () => {
    const props = summary({ mode: { ...MODE, zoom: true, cover: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Обычный размер' }));
    expect(props.onMode).toHaveBeenCalledWith({ ...MODE, cover: true, zoom: false });
    const cover = screen.getByRole('switch', { name: 'Спрятать строки' });
    expect(cover).toHaveAttribute('aria-checked', 'true');
    expect(cover.querySelector('.cs-toggle-hint')).toBeNull();
    expect(document.querySelector('.cs-cover-note')).not.toBeNull();
  });

  it('nothing erased yet: «Скрыть строки, стёртые совсем» says so and cannot be turned (PUB-16); a phone leaves it out', () => {
    const none = { ...COUNTS, erased: 0 };
    const props = summary({ counts: none });
    const only = screen.getByRole('switch', { name: 'Скрыть строки, стёртые совсем' });
    expect(only).toHaveAttribute('aria-disabled', 'true');
    expect(only).toHaveAttribute('aria-checked', 'false');
    expect(only).toHaveAccessibleDescription('Таких строк пока нет');
    fireEvent.click(only);
    expect(props.onMode).not.toHaveBeenCalled();
    cleanup();
    // The page's own words (the example names the answer that erases), even when the switch was on by itself.
    summary({ counts: none, mode: { ...MODE, onlyLeft: true }, onlyLeftNone: 'Таких строк пока нет: ответьте на вопрос 5' });
    const page = screen.getByRole('switch', { name: 'Скрыть строки, стёртые совсем' });
    expect(page).toHaveAttribute('aria-checked', 'false');
    expect(page).toHaveAccessibleDescription(/^Таких\sстрок\sпока\sнет:\sответьте\sна\sвопрос\s5$/);
    cleanup();
    summary({ counts: none, variant: 'top' });
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('the page’s next step stands in the column’s card under the change, before the rule; not on a phone', () => {
    summary({ next: <a href="/register?next=%2Fexams%2Fnew">Начать со своего списка</a> });
    const next = document.querySelector('.cs-next') as HTMLElement;
    expect(within(next).getByRole('link', { name: 'Начать со своего списка' })).toBeTruthy();
    const order = [...(document.querySelector('.cs-sum') as HTMLElement).children].map((child) => child.className);
    expect(order.indexOf('cs-change')).toBeLessThan(order.indexOf('cs-next'));
    expect(order.indexOf('cs-next')).toBeLessThan(order.indexOf('cs-rule'));
    cleanup();
    summary({ variant: 'after', next: <a href="/register">Начать со своего списка</a> });
    expect(document.querySelector('.cs-next')).toBeNull();
  });

  it('top (a phone, above the paper): the count and «Только то, что осталось» in one row, so the paper’s lines are on the first screen', () => {
    summary({ variant: 'top', mode: { ...MODE, onlyLeft: true } });
    expect(screen.queryByText('Шпаргалка')).toBeNull();
    expect(document.querySelector('.cs-big')?.textContent).toBe('39');
    expect(document.querySelector('.cs-count .cs-count-switch')).not.toBeNull();
    expect(document.querySelector('.cs-sub')).toBeNull();
    expect(document.querySelector('.cs-change')).toBeNull();
    expect(document.querySelector('.cs-rule')).toBeNull();
    expect(document.querySelector('.cs-share')).toBeNull();
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(1);
    expect(switches[0].getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Показать последний ответ' })).toBeNull();
  });

  it('after (a phone, under the paper): what the count means, the change, the rule, the share, the self-test and the links', () => {
    summary({ variant: 'after', changeNote: 'Подсмотренное сегодня ответ не стирает.' });
    expect(document.querySelector('.cs-big')).toBeNull();
    expect(plain(document.querySelector('.cs-sub')?.textContent)).toBe('главных строк — 21 из 27 · стёрты наполовину — 5 · пора проверить — 3 · у 6 вопросов нет пунктов ответа');
    expect(plain(document.querySelector('.cs-change')?.textContent)).toBe('После ответа: 2 строки стёрлись, 1 — наполовину.');
    expect(plain(document.querySelector('.cs-change-note')?.textContent)).toBe('Подсмотренное сегодня ответ не стирает.');
    expect(document.querySelector('.cs-rule')).toBeTruthy();
    expect(document.querySelector('.cs-rule .cs-swatch')).toBeTruthy();
    expect(document.querySelector('.cs-share')).toBeTruthy();
    expect(screen.getAllByRole('switch').map((item) => item.querySelector('.cs-toggle-t')?.textContent)).toEqual(['Спрятать строки']);
    expect(screen.queryByRole('button', { name: 'Весь лист на экране' })).toBeNull();
    expect(screen.getByRole('button', { name: 'История шпаргалки' })).toBeTruthy();
  });

  it('on the projector, «Показать, что изменилось» stands where the links are, as the column’s filled pill', () => {
    const onShow = vi.fn();
    summary({ onShow });
    expect(screen.queryByRole('button', { name: 'Показать последний ответ' })).toBeNull();
    const show = screen.getByRole('button', { name: 'Показать, что изменилось' });
    expect(show).toHaveClass('sf-primary');
    expect(document.activeElement).toBe(show);
    fireEvent.click(show);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('no links without an answer or a history, and no switches on an empty sheet', () => {
    summary({ onReplay: null, onHistory: null, counts: { ...COUNTS, total: 0, left: 0 } });
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(document.querySelector('.cs-acts')).toBeNull();
    expect(document.querySelector('.cs-big')).toBeNull();
  });

  it('the whole rule on the phone too, under the paper; while the first lines are written the count says how many are written', () => {
    summary({ variant: 'after' });
    expect(plain(document.querySelector('.cs-rule')?.textContent)).toBe('Строки стирают только ответы: назвали пункт — наполовину, назвали снова в другой день — совсем.');
    cleanup();
    summary({ writing: true, counts: { ...COUNTS, left: 12, total: 12, rubbed: 0 }, left: 12 });
    expect(document.querySelector('.cs-big')?.textContent).toBe('12');
    expect(plain(document.querySelector('.cs-count-l')?.textContent)).toBe('строк написано');
    cleanup();
    // Once an answer has touched the sheet the count is the usual one, even while more is written.
    summary({ writing: true });
    expect(plain(document.querySelector('.cs-count-l')?.textContent)).toBe('строк осталось из 47');
  });

  it('closed lines: a note says what a tap does; while the history plays the switches and notes step aside', () => {
    summary({ mode: { ...MODE, cover: true } });
    expect(plain(document.querySelector('.cs-cover-note')?.textContent)).toBe('Нажмите на спрятанную строку, чтобы открыть её. Это не «Подсмотреть»: ответ стирает её как обычно.');
    cleanup();
    const first: HistoryFrame = { day: '2026-09-01', at: 0, left: 180, total: 180 };
    summary({ mode: { ...MODE, cover: true }, history: { frame: first, first, lowest: first.left, running: true } });
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(document.querySelector('.cs-cover-note')).toBeNull();
    expect(document.querySelector('.cs-rule')).toBeNull();
    expect(document.querySelector('.cs-share')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Показать последний ответ' })).toBeNull();
  });

  it('the history: its day while it plays with «Остановить», then the result and «Закрыть историю»', () => {
    const first: HistoryFrame = { day: '2026-09-01', at: 0, left: 180, total: 180 };
    const frame: HistoryFrame = { day: '2026-09-15', at: 0, left: 120, total: 180 };
    const props = summary({ history: { frame, first, lowest: Math.min(first.left, frame.left), running: true } });
    expect(document.querySelector('.cs-big')?.textContent).toBe('120');
    expect(plain(document.querySelector('.cs-count-l')?.textContent)).toBe('строк осталось из 180');
    expect(document.querySelector('.cs-change')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Остановить' }));
    expect(props.onHistoryStop).toHaveBeenCalledTimes(1);
    cleanup();
    const last: HistoryFrame = { day: '2026-10-06', at: 0, left: 61, total: 180 };
    summary({ history: { frame: last, first, lowest: Math.min(first.left, last.left), running: false } });
    expect(plain(document.querySelector('.cs-sub')?.textContent)).toBe('180 → 61 строка за 5 недель');
    expect(screen.getByRole('button', { name: 'Закрыть историю' })).toBeTruthy();
  });
});

describe('historyResult', () => {
  it('counts days under two weeks and weeks after', () => {
    const at = (day: string, left: number): HistoryFrame => ({ day, at: 0, left, total: 180 });
    expect(plain(historyResult(at('2026-10-01', 47), at('2026-10-02', 45)))).toBe('47 → 45 строк за 1 день');
    expect(plain(historyResult(at('2026-10-01', 47), at('2026-10-04', 42)))).toBe('47 → 42 строки за 3 дня');
    expect(plain(historyResult(at('2026-09-20', 47), at('2026-10-01', 21)))).toBe('47 → 21 строка за 11 дней');
    // Lines that went and came back are not «nothing erased»: the lowest count is said too.
    expect(plain(historyResult(at('2026-10-01', 1), at('2026-10-06', 1), 0))).toBe('1 → 0 → 1 строка за 5 дней');
    expect(plain(historyResult(at('2026-10-01', 5), at('2026-10-06', 5), 5))).toBe('За 5 дней ни одна строка не стёрлась совсем');
    expect(plain(historyResult(at('2026-09-01', 180), at('2026-10-06', 61)))).toBe('180 → 61 строка за 5 недель');
    expect(plain(historyResult(at('2026-09-01', 180), at('2026-09-22', 100)))).toBe('180 → 100 строк за 3 недели');
  });
});

function idle(extra: Partial<SheetWriteState> = {}): SheetWriteState {
  return { examId: 'exam-1', phase: 'idle', done: 0, total: 0, written: 0, failed: 0, unverifiable: 0, busy: 0, capped: 0, limit: false, results: {}, message: null, seq: 0, stopping: false, ...extra };
}

function writeCard(extra: Partial<SheetWriteProps> = {}) {
  const props: SheetWriteProps = {
    written: 0,
    toWrite: 3,
    units: 3,
    unitsLeft: 40,
    write: idle(),
    onWrite: vi.fn(),
    onStop: vi.fn(),
    mappingRunning: false,
    unmapped: false,
    ...extra,
  };
  const view = render(<SheetWriteCard {...props} />);
  return { props, view };
}

describe('SheetWriteCard', () => {
  it('the first write: what the sheet is, the filled button, its price', () => {
    const { props } = writeCard();
    expect(screen.getByRole('heading', { name: named('Шпаргалка ещё не написана') })).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Написать шпаргалку' });
    expect(button.className).toBe('sf-primary');
    expect(plain(document.querySelector('.cs-write')?.textContent)).toContain('3 вопроса — 3 единицы ИИ · сегодня осталось 40');
    fireEvent.click(button);
    expect(props.onWrite).toHaveBeenCalledWith(undefined);
  });

  it('a short first write on a phone, and a quiet «Дописать» once something is written', () => {
    writeCard({ compact: true });
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.querySelector('.cs-write-short')).toBeTruthy();
    cleanup();
    writeCard({ written: 5, toWrite: 2, units: 2 });
    const button = screen.getByRole('button', { name: named('Дописать 2 вопроса') });
    expect(button.className).toBe('ex-secondary');
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('leaves the button and the price to the page’s status block when it offers them, and says what the sheet is', () => {
    writeCard({ hideAction: true });
    expect(screen.getByRole('heading', { name: named('Шпаргалка ещё не написана') })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(plain(document.querySelector('.cs-write')?.textContent)).not.toContain('единицы ИИ');
    cleanup();
    // «Дописать» offered by the status: nothing left for the card to say.
    writeCard({ written: 5, toWrite: 2, units: 2, hideAction: true });
    expect(document.querySelector('.cs-write')).toBeNull();
  });

  it('writes what today’s units allow and says when the rest comes', () => {
    const { props } = writeCard({ written: 2, toWrite: 5, units: 5, unitsLeft: 2 });
    fireEvent.click(screen.getByRole('button', { name: named('Написать 2 вопроса') }));
    expect(props.onWrite).toHaveBeenCalledWith(2);
    expect(plain(document.querySelector('.cs-write')?.textContent)).toMatch(/Ещё 3 вопроса — после обновления лимита в/);
    cleanup();
    writeCard({ unitsLeft: 0 });
    expect(screen.queryByRole('button')).toBeNull();
    expect(plain(document.querySelector('.cs-write')?.textContent)).toMatch(/Дневной лимит ИИ кончился/);
  });

  it('while it writes: the progress and «Остановить», then what stopping means', () => {
    const { props, view } = writeCard({ write: idle({ phase: 'running', done: 1, total: 3 }) });
    expect(plain(document.querySelector('.cs-write .ex-stmt')?.textContent)).toBe('Пишем шпаргалку: 1 из 3 · можно закрыть страницу — допишется');
    // A screen reader hears the progress every ten questions, without «Остановить» in it.
    expect(plain(screen.getByRole('status').textContent)).toBe('Пишем шпаргалку: 0 из 3');
    expect(within(screen.getByRole('status')).queryByRole('button')).toBeNull();
    view.rerender(<SheetWriteCard {...props} write={idle({ phase: 'running', done: 12, total: 31 })} />);
    expect(plain(screen.getByRole('status').textContent)).toBe('Пишем шпаргалку: 10 из 31');
    view.rerender(<SheetWriteCard {...props} write={idle({ phase: 'running', done: 1, total: 3 })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Остановить' }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
    view.rerender(<SheetWriteCard {...props} write={idle({ phase: 'running', done: 1, total: 3, stopping: true })} />);
    expect(screen.queryByRole('button', { name: 'Остановить' })).toBeNull();
    expect(screen.getByText('Новые вопросы не начнутся. Начатые допишутся — единицы за них спишутся.')).toBeTruthy();
    // A new run after that: «Остановить» is back.
    view.rerender(<SheetWriteCard {...props} write={idle({ phase: 'running', done: 0, total: 2 })} />);
    expect(screen.getByRole('button', { name: 'Остановить' })).toBeTruthy();
  });

  it('waits for the mapping, and says the outcome when nothing is left', () => {
    writeCard({ mappingRunning: true });
    expect(screen.getByText(/когда закончится сверка с лекциями/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    writeCard({ toWrite: 0, units: 0, written: 7, write: idle({ phase: 'done', written: 3, total: 3 }) });
    expect(plain(document.querySelector('.cs-write')?.textContent)).toBe('Шпаргалка написана');
    cleanup();
    const { view } = writeCard({ toWrite: 0, units: 0, written: 7 });
    expect(view.container.firstChild).toBeNull();
  });
});

describe('SheetWriteCard: questions that cannot be written', () => {
  // Live run of 2026-10-07: two questions whose points failed the quote check twice kept «2 вопроса — 2 единицы» on
  // the author's sheet for good. They are not to write any more; the card says so plainly and offers nothing.
  it('nothing left to write: the plain line, no button, no price', () => {
    writeCard({ written: 16, toWrite: 0, units: 0, unwritable: 2 });
    expect(plain(document.querySelector('.cs-write')?.textContent)).toBe('У 2 вопросов пункты не записаны: Meldy не смог подтвердить их цитатами из лекций');
    expect(screen.queryByRole('button')).toBeNull();
    expect(plain(document.querySelector('.cs-write')?.textContent)).not.toMatch(/единиц/);
  });

  it('with something to write: the button and the price count only that, the line under it', () => {
    writeCard({ written: 14, toWrite: 1, units: 1, unwritable: 2 });
    expect(screen.getByRole('button', { name: named('Дописать 1 вопрос') })).toBeTruthy();
    const text = plain(document.querySelector('.cs-write')?.textContent);
    expect(text).toContain('1 вопрос — 1 единица ИИ');
    expect(text).toContain('У 2 вопросов пункты не записаны: Meldy не смог подтвердить их цитатами из лекций');
  });

  it('after a run they are not «можно попробовать ещё раз»', () => {
    writeCard({ written: 16, toWrite: 0, units: 0, unwritable: 2, write: idle({ phase: 'done', written: 3, failed: 2, unverifiable: 2, total: 5 }) });
    const text = plain(document.querySelector('.cs-write')?.textContent);
    expect(text).toBe('Шпаргалка написанаУ 2 вопросов пункты не записаны: Meldy не смог подтвердить их цитатами из лекций');
    expect(text).not.toContain('попробовать ещё раз');
  });

  it('says one, two and five', () => {
    expect(plain(unwritableLine(1))).toBe('У 1 вопроса пункты не записаны: Meldy не смог подтвердить их цитатами из лекций');
    expect(plain(unwritableLine(5))).toBe('У 5 вопросов пункты не записаны: Meldy не смог подтвердить их цитатами из лекций');
    expect(plain(unwritableLine(21))).toBe('У 21 вопроса пункты не записаны: Meldy не смог подтвердить их цитатами из лекций');
  });
});

describe('outcomeLine', () => {
  it('says the limit, what failed, and the message of a broken run', () => {
    expect(plain(outcomeLine(idle({ phase: 'done', written: 4, total: 6, limit: true }), 2))).toBe('Написано 4 из 6: дневной лимит ИИ кончился');
    expect(plain(outcomeLine(idle({ phase: 'done', written: 4, failed: 1, busy: 1, total: 6 }), 2))).toBe('2 вопроса не удалось написать — можно попробовать ещё раз');
    expect(outcomeLine(idle({ phase: 'interrupted', message: 'Связь прервалась.' }), 2)).toBe('Связь прервалась.');
    // The server's own daily cap, not the AI: said as such, with when it lifts.
    expect(plain(outcomeLine(idle({ phase: 'done', written: 4, capped: 2, total: 6 }), 2))).toMatch(/^Написано 4 из 6: сервер на сегодня исчерпал запись шпаргалок — остальное можно дописать после \d{1,2}:\d\d$/);
    expect(outcomeLine(idle({ phase: 'done', written: 3, total: 3 }), 2)).toBeNull();
    expect(outcomeLine(idle(), 2)).toBeNull();
    // Unverifiable ones are in the server's failed count, but another try would not change them.
    expect(plain(outcomeLine(idle({ phase: 'done', written: 4, failed: 3, unverifiable: 1, total: 7 }), 2))).toBe('2 вопроса не удалось написать — можно попробовать ещё раз');
    expect(outcomeLine(idle({ phase: 'done', written: 4, failed: 2, unverifiable: 2, total: 6 }), 0)).toBe('Шпаргалка написана');
  });
});

function status(state: LineState, extra: Partial<LineStatus> = {}): LineStatus {
  return { state, history: [], erasableFrom: null, erasedAt: null, erasedOn: null, lastNamedAt: null, dueAt: null, wasErasedOn: null, wasErasedAt: null, peekedToday: false, checks: 0, ...extra };
}

function lineOf(state: LineState, extra: Partial<LineStatus> = {}): SheetLine {
  return {
    key: 'r1:p1',
    questionId: 'q25',
    questionHash: 'h'.repeat(32),
    rubricId: 'r1',
    pointId: 'p1',
    text: 'мультипликатор = масса / база',
    title: 'Мультипликатор — отношение денежной массы к денежной базе',
    essential: true,
    quote: 'Денежный мультипликатор показывает, во сколько раз…',
    sourceIds: ['M1:S12'],
    status: status(state, extra),
  };
}

function blockOf(line: SheetLine): SheetBlock {
  return {
    questionId: 'q25',
    number: '25',
    section: null,
    text: 'Денежный мультипликатор.',
    kind: 'lines',
    coverage: 'full',
    coverageMethod: 'llm',
    coverageReason: '',
    missing: '',
    partial: false,
    materials: [{ key: 'M1', material_id: 'm-1', title: 'Денежный рынок' }],
    lines: [line],
    learned: false,
  };
}

function panel(line: SheetLine, extra: { peeked?: boolean; variant?: 'column' | 'sheet'; state?: LineState } = {}) {
  const onPeek = vi.fn();
  const onClose = vi.fn();
  const tree = (peeked: boolean) => (
    <MemoryRouter>
      <LinePanel
        links={examSheetLinks('exam-1')}
        line={line}
        block={blockOf(line)}
        state={extra.state ?? line.status.state}
        peeked={peeked}
        onPeek={onPeek}
        onClose={onClose}
        variant={extra.variant ?? 'column'}
        headingId="cs-lp-h"
      />
    </MemoryRouter>
  );
  const view = render(tree(extra.peeked ?? false));
  return { onPeek, onClose, view, peek: () => view.rerender(tree(true)) };
}

describe('LinePanel', () => {
  it('a rubbed line: hidden words, when it erases, «Подсмотреть», the way to answer; Escape closes', () => {
    const { onPeek, onClose } = panel(lineOf('rubbed', { erasableFrom: new Date(Date.now() + 86_400_000).toISOString() }));
    expect(screen.getByRole('heading', { name: named('Строка стёрта наполовину') })).toBeTruthy();
    expect(screen.queryByText(/отношение денежной массы/)).toBeNull();
    expect(plain(screen.getByText(/^Сотрётся совсем, если назовёте пункт снова/).textContent)).toMatch(/после \d{1,2} [а-я]+\.?, \d{1,2}:\d\d\.$|\d{1,2} [а-я]+\.? или позже\.$/);
    expect(plain(screen.getByText(/^Вопрос 25/).textContent)).toBe('Вопрос 25 · пункт 1 · главный');
    expect(screen.getByText('Если подсмотреть, сегодня ответ её не сотрёт.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Подсмотреть' }));
    expect(onPeek).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Ответить на этот вопрос' }).getAttribute('href')).toBe('/exams/exam-1/ticket?q=q25');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('once peeked: the words, the lecture and fragment of the quote, and that today it will not erase', () => {
    panel(lineOf('rubbed'), { peeked: true });
    expect(screen.getByRole('heading', { name: named('Мультипликатор — отношение денежной массы к денежной базе') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Подсмотреть' })).toBeNull();
    expect(screen.getByText('Подсмотрели — сегодня ответ её не сотрёт.')).toBeTruthy();
    expect(plain(document.querySelector('.ex-slip-cap')?.textContent)).toBe('Лекция «Денежный рынок», фрагмент 12');
    expect(document.querySelector('.cs-lp-quote')?.textContent).toMatch(/Денежный мультипликатор показывает/);
  });

  it('an erased line cannot be peeked: the way back is an answer', () => {
    panel(lineOf('erased', { erasedOn: '2026-10-05' }));
    expect(screen.getByRole('heading', { name: named('Строка стёрта') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Подсмотреть' })).toBeNull();
    expect(plain(screen.getByText(/^Стёртую строку не подсмотреть/).textContent)).toBe('Стёртую строку не подсмотреть. Она вернётся, если в ответе этот пункт не будет назван.');
  });

  it('a line due for a check: what an answer will do to it, and it can be peeked', () => {
    panel(lineOf('due', { dueAt: '2026-10-06T08:00:00Z', erasedOn: '2026-09-20' }));
    expect(screen.getByRole('heading', { name: named('Строка стёрта — пора проверить') })).toBeTruthy();
    expect(plain(screen.getByText(/^Назовите этот пункт/).textContent)).toBe('Назовите этот пункт в ответе: назовёте — строка снова сотрётся, не назовёте — вернётся.');
    expect(screen.getByRole('button', { name: 'Подсмотреть' })).toBeTruthy();
  });

  it('a due line peeked earlier today: one paragraph says what today’s answer can and cannot do', () => {
    panel(lineOf('due', { dueAt: '2026-10-06T08:00:00Z', erasedOn: '2026-09-20', peekedToday: true }));
    expect(plain(screen.getByText(/^Сегодня вы подсматривали/).textContent)).toBe(
      'Сегодня вы подсматривали эту строку: сегодняшний ответ её не сотрёт, а если пункт не назвать — строка вернётся. Назовите его в ответе в другой день — снова сотрётся.',
    );
    expect(screen.queryByText(/^Назовите этот пункт/)).toBeNull();
    // Peeking again changes nothing today, so the panel does not warn about it.
    expect(screen.queryByText('Если подсмотреть, сегодня ответ её не сотрёт.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Подсмотреть' })).toBeTruthy();
  });

  it('a line peeked earlier today says so; after «Подсмотреть» the heading with the words takes the focus', async () => {
    // A peek moves the moment to the next midnight.
    const midnight = new Date(new Date().setHours(24, 0, 0, 0));
    const { onPeek, peek } = panel(lineOf('rubbed', { peekedToday: true, erasableFrom: midnight.toISOString() }));
    // One paragraph: why today's answer will not erase it, then what will.
    expect(plain(screen.getByText(/^Сегодня вы подсматривали/).textContent)).toBe(
      `Сегодня вы подсматривали эту строку, поэтому сегодняшний ответ её не сотрёт. Сотрётся совсем, если назовёте пункт снова ${formatShortDay(localDayOf(midnight.getTime()))} или позже.`,
    );
    expect(screen.queryByText('Если подсмотреть, сегодня ответ её не сотрёт.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Подсмотреть' }));
    expect(onPeek).toHaveBeenCalledTimes(1);
    peek();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const heading = screen.getByRole('heading', { name: named('Мультипликатор — отношение денежной массы к денежной базе') });
    expect(document.activeElement).toBe(heading);
    // Once open, the morning's peek is not repeated: one sentence says it.
    expect(screen.queryByText(/^Сегодня вы подсматривали/)).toBeNull();
  });

  it('a missed line says when it was missed, and its history links to the protocols', () => {
    const history = [
      { at: '2026-10-04T16:40:00Z', date: '2026-10-04', outcome: 'named' as const, word: 'named' as const, sessionId: 's1' },
      { at: '2026-10-06T09:10:00Z', date: '2026-10-06', outcome: 'missed' as const, word: 'missing' as const, sessionId: null },
    ];
    panel(lineOf('missed', { history }));
    expect(screen.getByText(/6 окт\. не назван/)).toBeTruthy();
    const list = document.querySelector('.cs-lp-history') as HTMLElement;
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // Newest first; an answer with a protocol is a link to it.
    expect(within(items[0]).queryByRole('link')).toBeNull();
    expect(within(items[1]).getByRole('link').getAttribute('href')).toBe('/exams/exam-1/ticket?session=s1');
  });

  it('leads where its links say: the example’s answers carry their note and open nowhere else', () => {
    const history = [{ at: '2026-10-05T07:05:00Z', date: '2026-10-05', outcome: 'named' as const, word: 'named' as const, sessionId: 'try-seed-q5' }];
    render(
      <MemoryRouter>
        <LinePanel
          links={{ answer: (id) => `/try/ticket?q=${id}`, session: () => null, sessionNote: (id) => (id.startsWith('try-seed') ? 'ответ примера' : null) }}
          line={lineOf('missed', { history })}
          block={blockOf(lineOf('missed', { history }))}
          state="missed"
          peeked={false}
          onPeek={vi.fn()}
          onClose={vi.fn()}
          variant="column"
          headingId="cs-lp-h"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Ответить на этот вопрос' })).toHaveAttribute('href', '/try/ticket?q=q25');
    const item = within(document.querySelector('.cs-lp-history') as HTMLElement).getByRole('listitem');
    expect(within(item).queryByRole('link')).toBeNull();
    expect(plain(item.textContent)).toMatch(/— назван \(ответ примера\)$/);
  });

  it('a phone bottom sheet: a dialog that takes the focus to its heading, holds the page and keeps Tab inside', () => {
    const { view } = panel(lineOf('rubbed'), { variant: 'sheet' });
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const close = within(dialog).getByRole('button', { name: 'Закрыть' });
    // The heading takes the focus (a screen reader starts at what the line is); Tab goes on to the buttons.
    expect(document.activeElement).toBe(within(dialog).getByRole('heading'));
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    const answer = within(dialog).getByRole('link', { name: 'Ответить на этот вопрос' });
    answer.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(answer);
    view.unmount();
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
  });
});

describe('quoteText', () => {
  it('drops the fragment heading and marks a quote cut mid-sentence with «…»', () => {
    expect(quoteText('Денежный мультипликатор показывает, во сколько раз')).toBe('Денежный мультипликатор показывает, во сколько раз…');
    expect(quoteText('Спрос растёт, когда цена падает.')).toBe('Спрос растёт, когда цена падает.');
    expect(quoteText('Эластичность спроса\nКоэффициент показывает, на сколько процентов изменится величина спроса при изменении цены.')).toBe(
      'Коэффициент показывает, на сколько процентов изменится величина спроса при изменении цены.',
    );
  });
});
