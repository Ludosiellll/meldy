import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

import type { SheetWriteState } from '../../../api/cheatSheet';
import type { HistoryFrame, LineState, LineStatus, SheetBlock, SheetCounts, SheetLine } from '../../../lib/exams/cheatSheet';
import { historyResult, LinePanel, outcomeLine, SheetSummaryCard, SheetWriteCard, type SheetSummaryProps, type SheetWriteProps } from './SheetColumn';

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
  it('full: the flag, the count with its details, the change, the share, three switches and the links', () => {
    const props = summary();
    expect(screen.getByText('Шпаргалка')).toBeTruthy();
    expect(document.querySelector('.cs-big')?.textContent).toBe('39');
    expect(plain(document.querySelector('.cs-count-l')?.textContent)).toBe('строк осталось из 47');
    expect(plain(document.querySelector('.cs-sub')?.textContent)).toBe('главных — 21 · пора проверить — 3 · 9 вопросов без пунктов');
    expect(plain(document.querySelector('.cs-change')?.textContent)).toBe('После ответа: 2 строки стёрлись, 1 — наполовину.');
    expect(plain(document.querySelector('.cs-share')?.textContent)).toContain('35 % билетов');
    const switches = screen.getAllByRole('switch');
    expect(switches.map((item) => item.textContent)).toEqual(['Только то, что осталось', 'Закрыть строки', 'Весь лист']);
    expect(switches.every((item) => item.getAttribute('aria-checked') === 'false')).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Весь лист' }));
    expect(props.onMode).toHaveBeenCalledWith({ ...MODE, zoom: true });
    fireEvent.click(screen.getByRole('button', { name: 'Показать последний ответ' }));
    expect(props.onReplay).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'История листа' }));
    expect(props.onHistory).toHaveBeenCalledTimes(1);
  });

  it('top (a phone, above the paper): the count, its details, the change and «Только то, что осталось» only', () => {
    summary({ variant: 'top', mode: { ...MODE, onlyLeft: true } });
    expect(screen.queryByText('Шпаргалка')).toBeNull();
    expect(document.querySelector('.cs-big')?.textContent).toBe('39');
    expect(document.querySelector('.cs-change')).toBeTruthy();
    expect(document.querySelector('.cs-share')).toBeNull();
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(1);
    expect(switches[0].getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Показать последний ответ' })).toBeNull();
  });

  it('after (a phone, under the paper): the share, the self-test switch and the links, no count', () => {
    summary({ variant: 'after' });
    expect(document.querySelector('.cs-big')).toBeNull();
    expect(document.querySelector('.cs-change')).toBeNull();
    expect(document.querySelector('.cs-share')).toBeTruthy();
    expect(screen.getAllByRole('switch').map((item) => item.textContent)).toEqual(['Закрыть строки']);
    expect(screen.getByRole('button', { name: 'История листа' })).toBeTruthy();
  });

  it('no links without an answer or a history, and no switches on an empty sheet', () => {
    summary({ onReplay: null, onHistory: null, counts: { ...COUNTS, total: 0, left: 0 } });
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(document.querySelector('.cs-acts')).toBeNull();
    expect(document.querySelector('.cs-big')).toBeNull();
  });

  it('the history: its day while it plays with «Остановить», then the result and «Вернуться к сегодня»', () => {
    const first: HistoryFrame = { day: '2026-09-01', at: 0, left: 180, total: 180 };
    const frame: HistoryFrame = { day: '2026-09-15', at: 0, left: 120, total: 180 };
    const props = summary({ history: { frame, first, running: true } });
    expect(document.querySelector('.cs-big')?.textContent).toBe('120');
    expect(plain(document.querySelector('.cs-count-l')?.textContent)).toBe('строк осталось из 180');
    expect(document.querySelector('.cs-change')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Остановить' }));
    expect(props.onHistoryStop).toHaveBeenCalledTimes(1);
    cleanup();
    const last: HistoryFrame = { day: '2026-10-06', at: 0, left: 61, total: 180 };
    summary({ history: { frame: last, first, running: false } });
    expect(plain(document.querySelector('.cs-sub')?.textContent)).toBe('180 → 61 строка за 5 недель');
    expect(screen.getByRole('button', { name: 'Вернуться к сегодня' })).toBeTruthy();
  });
});

describe('historyResult', () => {
  it('counts days under two weeks and weeks after', () => {
    const at = (day: string, left: number): HistoryFrame => ({ day, at: 0, left, total: 180 });
    expect(plain(historyResult(at('2026-10-01', 47), at('2026-10-02', 45)))).toBe('47 → 45 строк за 1 день');
    expect(plain(historyResult(at('2026-10-01', 47), at('2026-10-04', 42)))).toBe('47 → 42 строки за 3 дня');
    expect(plain(historyResult(at('2026-09-20', 47), at('2026-10-01', 21)))).toBe('47 → 21 строка за 11 дней');
    expect(plain(historyResult(at('2026-09-01', 180), at('2026-10-06', 61)))).toBe('180 → 61 строка за 5 недель');
    expect(plain(historyResult(at('2026-09-01', 180), at('2026-09-22', 100)))).toBe('180 → 100 строк за 3 недели');
  });
});

function idle(extra: Partial<SheetWriteState> = {}): SheetWriteState {
  return { examId: 'exam-1', phase: 'idle', done: 0, total: 0, written: 0, failed: 0, busy: 0, limit: false, results: {}, message: null, seq: 0, stopping: false, ...extra };
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

  it('writes what today’s units allow and says when the rest comes', () => {
    const { props } = writeCard({ written: 2, toWrite: 5, units: 5, unitsLeft: 2 });
    fireEvent.click(screen.getByRole('button', { name: named('Написать 2 вопроса') }));
    expect(props.onWrite).toHaveBeenCalledWith(2);
    expect(plain(document.querySelector('.cs-write')?.textContent)).toMatch(/Остальные 3 — после обновления лимита в/);
    cleanup();
    writeCard({ unitsLeft: 0 });
    expect(screen.queryByRole('button')).toBeNull();
    expect(plain(document.querySelector('.cs-write')?.textContent)).toMatch(/Дневной лимит ИИ кончился/);
  });

  it('while it writes: the progress and «Остановить», then what stopping means', () => {
    const { props, view } = writeCard({ write: idle({ phase: 'running', done: 1, total: 3 }) });
    expect(plain(screen.getByRole('status').textContent)).toMatch(/Пишем шпаргалку: 1 из 3/);
    fireEvent.click(screen.getByRole('button', { name: 'Остановить' }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
    view.rerender(<SheetWriteCard {...props} write={idle({ phase: 'running', done: 1, total: 3, stopping: true })} />);
    expect(screen.queryByRole('button', { name: 'Остановить' })).toBeNull();
    expect(screen.getByText(/Уже начатые допишутся и будут списаны/)).toBeTruthy();
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

describe('outcomeLine', () => {
  it('says the limit, what failed, and the message of a broken run', () => {
    expect(plain(outcomeLine(idle({ phase: 'done', written: 4, total: 6, limit: true }), 2))).toBe('Написано 4 из 6: лимит ИИ на сегодня кончился');
    expect(plain(outcomeLine(idle({ phase: 'done', written: 4, failed: 1, busy: 1, total: 6 }), 2))).toBe('2 вопроса не удалось написать — можно попробовать ещё раз');
    expect(outcomeLine(idle({ phase: 'interrupted', message: 'Связь прервалась.' }), 2)).toBe('Связь прервалась.');
    expect(outcomeLine(idle({ phase: 'done', written: 3, total: 3 }), 2)).toBeNull();
    expect(outcomeLine(idle(), 2)).toBeNull();
  });
});

function status(state: LineState, extra: Partial<LineStatus> = {}): LineStatus {
  return { state, history: [], erasableFrom: null, erasedAt: null, erasedOn: null, lastNamedAt: null, dueAt: null, wasErasedOn: null, peekedToday: false, checks: 0, ...extra };
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
  const view = render(
    <MemoryRouter>
      <LinePanel
        examId="exam-1"
        line={line}
        block={blockOf(line)}
        state={extra.state ?? line.status.state}
        peeked={extra.peeked ?? false}
        onPeek={onPeek}
        onClose={onClose}
        variant={extra.variant ?? 'column'}
        headingId="cs-lp-h"
      />
    </MemoryRouter>,
  );
  return { onPeek, onClose, view };
}

describe('LinePanel', () => {
  it('a rubbed line: hidden words, when it erases, «Подсмотреть», the way to answer; Escape closes', () => {
    const { onPeek, onClose } = panel(lineOf('rubbed', { erasableFrom: '2026-10-07T12:40:00Z' }));
    expect(screen.getByRole('heading', { name: named('Строка стёрта наполовину') })).toBeTruthy();
    expect(screen.queryByText(/отношение денежной массы/)).toBeNull();
    expect(plain(screen.getByText(/Сотрётся, если назовёте снова после/).textContent)).toMatch(/7 окт\./);
    expect(plain(screen.getByText(/^Вопрос 25/).textContent)).toBe('Вопрос 25 · главный пункт');
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
    expect(screen.getByText('Подсмотрели — сегодня эта строка не сотрётся.')).toBeTruthy();
    expect(plain(document.querySelector('.ex-slip-cap')?.textContent)).toBe('Лекция «Денежный рынок», фрагмент 12');
    expect(document.querySelector('.cs-lp-quote')?.textContent).toMatch(/Денежный мультипликатор показывает/);
  });

  it('an erased line cannot be peeked: the way back is an answer', () => {
    panel(lineOf('erased', { erasedOn: '2026-10-05' }));
    expect(screen.getByRole('heading', { name: named('Строка стёрта') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Подсмотреть' })).toBeNull();
    expect(screen.getByText(/строка вернётся, если пункт не прозвучит/)).toBeTruthy();
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

  it('a phone bottom sheet: a dialog that takes the focus, holds the page and keeps Tab inside', () => {
    const { view } = panel(lineOf('rubbed'), { variant: 'sheet' });
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const close = within(dialog).getByRole('button', { name: 'Закрыть' });
    expect(document.activeElement).toBe(close);
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
