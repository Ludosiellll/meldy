import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningEvent } from '../../../api/learning';
import { buildSheet, localDayOf, sheetChanges, sheetWithout, type SheetBlock, type SheetLine, type SheetQuestion } from '../../../lib/exams/cheatSheet';
import { formatShortDay } from '../../../lib/exams/format';
import CheatSheet, { animFor, changeGroups, writeMs, type CheatSheetProps, type SheetReplay } from './CheatSheet';

const plain = (text: string | null | undefined) => (text ?? '').replace(/\u00a0/g, ' ');

const NOW = new Date(2026, 9, 5, 12, 0).getTime();
const RUBRIC_A = '00000000-0000-4000-8000-00000000000a';
const RUBRIC_B = '00000000-0000-4000-8000-00000000000b';
let sequence = 0;

const POINTS = [
  { id: 'p1', title: 'Закон спроса: чем выше цена, тем меньше величина спроса', short: 'закон: цена ↑ → спрос ↓', essential: true },
  { id: 'p2', title: 'Кривая спроса имеет отрицательный наклон', short: 'кривая спроса ↘ (наклон < 0)', essential: true },
  { id: 'p3', title: 'Неценовые факторы сдвигают кривую спроса', short: '', essential: false },
];

function question(position: number, extra: Partial<SheetQuestion> = {}): SheetQuestion {
  const rubricId = position === 1 ? RUBRIC_A : RUBRIC_B;
  return {
    question_id: `q${position}`,
    position,
    label: '',
    section: null,
    text: position === 1 ? 'Спрос. Закон спроса и кривая спроса.' : 'Эластичность спроса по цене.',
    question_hash: String(position).repeat(32).slice(0, 32),
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    rubric: {
      rubric_id: rubricId,
      built_at: null,
      coverage: 'full',
      coverage_note: '',
      materials: [],
      points: POINTS.map((point) => ({ ...point, title: `${point.title}${position === 1 ? '' : ' (2)'}`, source_quote: '', source_ids: [] })),
    },
    ...extra,
  };
}

function named(q: SheetQuestion, pointId: string, at: number, isNamed = true, session = `s${(sequence += 1)}`): LearningEvent {
  const point = q.rubric!.points.find((item) => item.id === pointId)!;
  return {
    id: `e${(sequence += 1)}`,
    created_at: new Date(at).toISOString(),
    local_date: localDayOf(at),
    material_id: null,
    kind: 'oral_point',
    item_key: `oral:${q.rubric!.rubric_id}:${pointId}`,
    correct: isNamed,
    score: null,
    confidence: null,
    source_ids: [],
    session_id: session,
    payload: { v: 1, rubric_id: q.rubric!.rubric_id, point_id: pointId, question_hash: q.question_hash, title: point.title, status: isNamed ? 'covered' : 'missing' },
  };
}

const DAY = 24 * 3600 * 1000;

function props(blocks: SheetBlock[], extra: Partial<CheatSheetProps> = {}): CheatSheetProps {
  return {
    examId: 'exam-1',
    blocks,
    sectionTitles: [],
    lectureCount: 3,
    writeNotes: new Map(),
    mode: { onlyLeft: false, cover: false, zoom: false },
    freshIds: new Set(),
    selectedKey: null,
    peeked: new Map(),
    opened: new Set(),
    markedQuestionIds: new Set<string>(),
    replay: null,
    onLine: vi.fn(),
    onQuestion: vi.fn(),
    onZoomPick: vi.fn(),
    onReplayEnd: vi.fn(),
    ...extra,
  };
}

function renderSheet(p: CheatSheetProps) {
  return render(
    <MemoryRouter>
      <CheatSheet {...p} />
    </MemoryRouter>,
  );
}

describe('the cheat sheet', () => {
  beforeEach(() => {
    sequence = 0;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('moves a line by the change of its state', () => {
    expect(animFor('fresh', 'rubbed')).toBe('rub');
    expect(animFor('rubbed', 'erased')).toBe('erase');
    expect(animFor('erased', 'returned')).toBe('return');
    expect(animFor('rubbed', 'returned')).toBe('return');
    expect(animFor('fresh', 'missed')).toBe('miss');
    expect(animFor('rubbed', 'rubbed')).toBeNull();
    // A due line reads as rubbed (with its ring): it becomes due by a rub, passes its check by an erase.
    expect(animFor('fresh', 'due')).toBe('rub');
    expect(animFor('rubbed', 'due')).toBeNull();
    expect(animFor('due', 'erased')).toBe('erase');
    expect(writeMs('закон')).toBe(280);
    expect(writeMs('x'.repeat(30))).toBe(780);
    expect(writeMs('x'.repeat(80))).toBe(1000);
  });

  it('prints the questions and writes their lines; a screen reader hears the words only of readable lines', () => {
    const q1 = question(1);
    const sheet = buildSheet([q1, question(2)], [named(q1, 'p1', NOW - DAY), named(q1, 'p2', NOW - DAY, false)], NOW);
    const { container } = renderSheet(props(sheet.blocks));
    // No section titles: the questions still sit under a second-level heading of their own.
    expect(screen.getByRole('heading', { level: 2, name: 'Шпаргалка' })).toBeInTheDocument();
    const first = screen.getAllByRole('article')[0];
    // An article is named by its number, not by the whole question read twice.
    expect(first).toHaveAccessibleName('Вопрос 1.');
    expect(within(first).getByRole('heading', { level: 3 })).toHaveTextContent('Вопрос 1. 1.Спрос. Закон спроса и кривая спроса.');
    const lines = container.querySelectorAll<HTMLElement>('.cs-line');
    expect(lines).toHaveLength(6);
    expect(lines[0].dataset.state).toBe('rubbed');
    expect(lines[1].dataset.state).toBe('missed');
    expect(lines[2].dataset.state).toBe('fresh');
    const rubbed = within(lines[0]).getByRole('button');
    expect(rubbed.getAttribute('aria-label')).not.toContain('Закон спроса');
    expect(rubbed.getAttribute('aria-label')).toContain('Открыть подробности');
    // A readable line is named by the words it shows (speech input says them), described by the rest.
    expect(within(lines[2]).getByRole('button')).toHaveAccessibleName('Неценовые факторы сдвигают кривую спроса');
    expect(within(lines[2]).getByRole('button')).toHaveAccessibleDescription('Пункт.');
    expect(within(lines[1]).getByRole('button')).toHaveAccessibleDescription(/4 октября не назван\.$/);
    // The pencil note is for the eye: the description says it already.
    expect(lines[1].querySelector('.cs-note')).toHaveAttribute('aria-hidden', 'true');
    // The short line is written, its arrows drawn in ink with the character kept for copying.
    expect(lines[2].querySelector('.cs-ink')).toHaveTextContent('Неценовые факторы сдвигают кривую спроса');
    expect(lines[0].querySelectorAll('.cs-arrow')).toHaveLength(3);
    expect(lines[0].querySelector('.cs-ink')).toHaveTextContent('закон: цена ↑ → спрос ↓');
    // A missed line carries the pencil wave and the note in the protocol's words.
    expect(lines[1].querySelector('[data-mark="wave"]')).not.toBeNull();
    expect(lines[1].querySelector('.cs-note')?.textContent?.replace(/ /g, ' ')).toBe('4 окт. не назван');
  });

  it('reports a tap on a line, but rubbing it only says that the hand does not erase', () => {
    vi.useFakeTimers();
    const sheet = buildSheet([question(1)], [], NOW);
    const p = props(sheet.blocks);
    const { container } = renderSheet(p);
    const button = within(container.querySelectorAll<HTMLElement>('.cs-line')[0]).getByRole('button');
    fireEvent.click(button);
    expect(p.onLine).toHaveBeenCalledTimes(1);
    expect((p.onLine as ReturnType<typeof vi.fn>).mock.calls[0][0].pointId).toBe('p1');

    fireEvent.pointerDown(button, { clientX: 10, buttons: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(button, { clientX: 60, buttons: 1, pointerType: 'mouse' });
    fireEvent.click(button);
    expect(p.onLine).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Стирает только ответ');
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.queryByText('Стирает только ответ')).toBeNull();
  });

  it('covers readable lines in the self-test and opens the ones already opened', () => {
    const q1 = question(1);
    const sheet = buildSheet([q1], [named(q1, 'p1', NOW - DAY)], NOW);
    const opened = new Set([`${RUBRIC_A}:p3`]);
    const { container } = renderSheet(props(sheet.blocks, { mode: { onlyLeft: false, cover: true, zoom: false }, opened }));
    const lines = container.querySelectorAll<HTMLElement>('.cs-line');
    expect(lines[0].dataset.cover).toBeUndefined(); // rubbed: unreadable anyway
    expect(lines[1].dataset.cover).toBe('');
    expect(within(lines[1]).getByRole('button')).toHaveAccessibleName('Главный пункт спрятан. Открыть');
    expect(lines[1].querySelector('.cs-slot')).not.toBeNull();
    expect(lines[2].dataset.cover).toBeUndefined();
  });

  it('shows a peeked line in full with the note that it will not be erased today', () => {
    const q1 = question(1);
    const sheet = buildSheet([q1], [named(q1, 'p1', NOW - DAY)], NOW);
    const peeked = new Map([[`${RUBRIC_A}:p1`, Date.now() + 6000]]);
    const { container } = renderSheet(props(sheet.blocks, { peeked }));
    const line = container.querySelectorAll<HTMLElement>('.cs-line')[0];
    expect(line.dataset.peek).toBe('');
    expect(within(line).getByRole('button')).toHaveAccessibleName(POINTS[0].short);
    expect(within(line).getByRole('button')).toHaveAccessibleDescription(`Главный пункт. Полностью: ${POINTS[0].title}. Подсмотрели — сегодня не сотрётся.`);
    expect(line.querySelector('.cs-note')).toHaveTextContent('подсмотрели — сегодня не сотрётся');
  });

  it('«Только то, что осталось» hides erased lines and folds a question only when nothing of it is left', () => {
    const q1 = question(1);
    const events = [named(q1, 'p1', NOW - 3 * DAY), named(q1, 'p1', NOW - DAY), named(q1, 'p2', NOW - 3 * DAY), named(q1, 'p2', NOW - DAY)];
    const sheet = buildSheet([q1, question(2)], events, NOW);
    expect(sheet.blocks[0].learned).toBe(true);
    const { container, rerender } = renderSheet(props(sheet.blocks));
    expect(container.querySelectorAll('.cs-line[data-state="erased"]')).toHaveLength(2);
    expect(screen.getByText('Главные строки стёрты')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <CheatSheet {...props(sheet.blocks, { mode: { onlyLeft: true, cover: false, zoom: false } })} />
      </MemoryRouter>,
    );
    // The essential lines are gone (a tick), the secondary one is still there: it stays in view.
    const first = container.querySelector<HTMLElement>('#cs-q-q1')!;
    expect(first.dataset.folded).toBeUndefined();
    expect([...first.querySelectorAll<HTMLElement>('.cs-line')].map((line) => line.dataset.state)).toEqual(['fresh']);
    expect(container.querySelectorAll('.cs-line')).toHaveLength(4);
    // Every line erased: the question is only its printed line.
    const all = [...events, named(q1, 'p3', NOW - 3 * DAY), named(q1, 'p3', NOW - DAY)];
    const done = buildSheet([q1, question(2)], all, NOW);
    rerender(
      <MemoryRouter>
        <CheatSheet {...props(done.blocks, { mode: { onlyLeft: true, cover: false, zoom: false } })} />
      </MemoryRouter>,
    );
    expect(container.querySelector<HTMLElement>('#cs-q-q1')!.dataset.folded).toBe('');
    expect(container.querySelector('#cs-q-q1 .cs-lines')).toBeNull();
    expect(container.querySelectorAll('.cs-line')).toHaveLength(3);
  });

  it('prints section titles once and Meldy’s notes under questions without lines', () => {
    const gap = question(2, { coverage: 'none', rubric: null, section: 2 });
    const sheet = buildSheet([question(1, { section: 1 }), gap, question(3, { section: 2, coverage: 'partial', missing_note: 'товаров Гиффена' })], [], NOW);
    renderSheet(props(sheet.blocks, { sectionTitles: ['Спрос', 'Эластичность'] }));
    // A section's title is a heading of its own, before its first question.
    expect(screen.getByRole('heading', { level: 2, name: 'Спрос' })).toHaveClass('cs-sec');
    expect(screen.queryByRole('heading', { level: 2, name: 'Шпаргалка' })).toBeNull();
    expect(screen.getAllByText('Эластичность')).toHaveLength(1);
    const note = screen.getByText(/нет фрагмента об этом/);
    expect(note.textContent?.replace(/ /g, ' ')).toBe('Ни в одной из 3 лекций нет фрагмента об этом · Добавить лекцию');
    expect(within(note).getByRole('link', { name: 'Добавить лекцию' })).toHaveAttribute('href', '/exams/exam-1/edit#lectures');
    expect(screen.getByText('Не хватает: товаров Гиффена')).toBeInTheDocument();
  });

  it('when the page says «нет в лекции» once for the whole sheet, a missing question keeps only a dash in the margin', () => {
    const gaps = [question(1, { coverage: 'none', rubric: null }), question(2, { coverage: 'none', rubric: null })];
    const sheet = buildSheet(gaps, [], NOW);
    const { container } = renderSheet(props(sheet.blocks, { quietGaps: true }));
    expect(container.querySelectorAll('.cs-pnote')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Добавить лекцию' })).toBeNull();
    expect(container.querySelectorAll('.cs-gapmark svg[data-mark="dash"]')).toHaveLength(2);
    // A screen reader hears it with each question, as the printed number.
    expect(within(container.querySelector('#cs-q-q1') as HTMLElement).getByText('Ответа в лекциях нет')).toHaveClass('sr-only');
  });

  it('a failed write replaces the question’s own note', () => {
    const sheet = buildSheet([question(1, { rubric: null })], [], NOW);
    renderSheet(props(sheet.blocks, { writeNotes: new Map([['q1', 'Лимит ИИ на сегодня кончился — допишем после его обновления.']]) }));
    expect(screen.getByText('Лимит ИИ на сегодня кончился — допишем после его обновления.')).toBeInTheDocument();
  });

  it('replays an answer from the states before it, line by line, then hands over to the column', async () => {
    vi.useFakeTimers();
    const q1 = question(1);
    const earlier = [named(q1, 'p1', NOW - 2 * DAY, true, 'old')];
    const answer = [named(q1, 'p1', NOW - 60_000, true, 'last'), named(q1, 'p2', NOW - 60_000, true, 'last'), named(q1, 'p3', NOW - 60_000, false, 'last')];
    const after = buildSheet([q1], [...earlier, ...answer], NOW);
    const before = sheetWithout([q1], [...earlier, ...answer], 'last', NOW);
    const changes = sheetChanges(before, after);
    expect(changes.map((change) => `${change.from}>${change.to}`)).toEqual(['rubbed>erased', 'fresh>rubbed', 'fresh>missed']);
    const replay: SheetReplay = { token: 7, changes, focusQuestionIds: ['q1'], slow: false, waitForClick: false };
    const p = props(after.blocks, { replay, markedQuestionIds: new Set(['q1']) });
    const { container } = renderSheet(p);
    const lines = () => [...container.querySelectorAll<HTMLElement>('.cs-line')];
    // Before anything moves, the lines stand as they were before the answer.
    expect(lines().map((line) => line.dataset.state)).toEqual(['rubbed', 'fresh', 'fresh']);
    expect(container.querySelector('.cs-qm')?.hasAttribute('data-marker')).toBe(false);
    // The missed line's note will appear: its row is there already, empty, so nothing below moves.
    expect(lines()[2].querySelector('.cs-note')?.hasAttribute('data-reserve')).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700 + 250 + 450 + 10);
    });
    expect(container.querySelector('.cs-qm')?.getAttribute('data-marker')).toBe('draw');
    expect(lines().map((line) => line.dataset.state)).toEqual(['erased', 'rubbed', 'missed']);
    expect(lines().map((line) => line.dataset.anim)).toEqual(['erase', 'rub', 'miss']);
    expect(lines()[2].querySelector('.cs-note')?.hasAttribute('data-reserve')).toBe(false);
    expect(p.onReplayEnd).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(p.onReplayEnd).toHaveBeenCalledWith(7);
    expect(lines().map((line) => line.dataset.anim)).toEqual([undefined, undefined, undefined]);
    expect(container.querySelector('.cs-qm')?.getAttribute('data-marker')).toBe('still');
  });

  it('orders the changes by question: the questions answered first, each in the sheet’s order', () => {
    const change = (key: string, questionId: string) => ({ key, questionId, from: 'fresh' as const, to: 'rubbed' as const });
    const groups = changeGroups([change('a', 'q1'), change('b', 'q2'), change('c', 'q1'), change('d', 'q3')], ['q2', 'q3']);
    expect(groups.map((group) => [group.questionId, group.changes.map((item) => item.key)])).toEqual([
      ['q2', ['b']],
      ['q3', ['d']],
      ['q1', ['a', 'c']],
    ]);
  });

  it('plays both questions of a ticket in turn, each marked, the second one still as it was while the first plays', async () => {
    vi.useFakeTimers();
    const q1 = question(1);
    const q2 = question(2);
    const answer = [named(q1, 'p1', NOW - 60_000, true, 'ticket'), named(q2, 'p1', NOW - 60_000, true, 'ticket')];
    const after = buildSheet([q1, q2], answer, NOW);
    const changes = sheetChanges(sheetWithout([q1, q2], answer, 'ticket', NOW), after);
    const p = props(after.blocks, { replay: { token: 9, changes, focusQuestionIds: ['q1', 'q2'], slow: false, waitForClick: false } });
    const { container } = renderSheet(p);
    const first = () => container.querySelector<HTMLElement>('#cs-q-q1 .cs-line')!;
    const second = () => container.querySelector<HTMLElement>('#cs-q-q2 .cs-line')!;
    const marker = (id: string) => container.querySelector(`#cs-q-${id} .cs-qm`)?.getAttribute('data-marker') ?? null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700 + 250 + 450 + 10);
    });
    expect([first().dataset.state, first().dataset.anim]).toEqual(['rubbed', 'rub']);
    expect(second().dataset.state).toBe('fresh');
    expect([marker('q1'), marker('q2')]).toEqual(['draw', null]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600 + 120 + 700 + 300 + 450 + 10);
    });
    expect([second().dataset.state, second().dataset.anim]).toEqual(['rubbed', 'rub']);
    expect([marker('q1'), marker('q2')]).toEqual(['still', 'draw']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(p.onReplayEnd).toHaveBeenCalledWith(9);
  });

  it('on the projector, the page shows «Показать» where the eye is; the show waits for it', async () => {
    vi.useFakeTimers();
    const q1 = question(1);
    const answer = [named(q1, 'p1', NOW - 60_000, true, 'last')];
    const after = buildSheet([q1], answer, NOW);
    const changes = sheetChanges(sheetWithout([q1], answer, 'last', NOW), after);
    const shows: Array<(() => void) | null> = [];
    const p = props(after.blocks, { replay: { token: 3, changes, focusQuestionIds: ['q1'], slow: true, waitForClick: true }, onWaiting: (show) => shows.push(show) });
    const { container } = renderSheet(p);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // The paper's own button is not drawn: the page has one.
    expect(container.querySelector('.cs-show')).toBeNull();
    const show = shows[shows.length - 1];
    expect(typeof show).toBe('function');
    expect(container.querySelector('.cs-line')?.getAttribute('data-state')).toBe('fresh');
    act(() => show?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(shows[shows.length - 1]).toBeNull();
    // The keyboard stands on the question shown.
    expect(document.activeElement).toBe(container.querySelector('#cs-q-q1 .cs-qbtn'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(p.onReplayEnd).toHaveBeenCalledWith(3);
  });

  it('under «Только то, что осталось» a line the answer erased stays in view until the switch is turned', async () => {
    vi.useFakeTimers();
    const q1 = question(1);
    const earlier = [named(q1, 'p1', NOW - 2 * DAY, true, 'old')];
    const answer = [named(q1, 'p1', NOW - 60_000, true, 'last')];
    const after = buildSheet([q1], [...earlier, ...answer], NOW);
    const changes = sheetChanges(sheetWithout([q1], [...earlier, ...answer], 'last', NOW), after);
    const onlyLeft = { onlyLeft: true, cover: false, zoom: false };
    const p = props(after.blocks, { mode: onlyLeft, replay: { token: 5, changes, focusQuestionIds: ['q1'], slow: false, waitForClick: false } });
    const { container, rerender } = renderSheet(p);
    const states = () => [...container.querySelectorAll<HTMLElement>('.cs-line')].map((line) => line.dataset.state);
    expect(states()).toEqual(['rubbed', 'fresh', 'fresh']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(p.onReplayEnd).toHaveBeenCalledWith(5);
    // The show is over: the erased line is still there, still erased.
    expect(states()).toEqual(['erased', 'fresh', 'fresh']);
    const view = (mode: CheatSheetProps['mode']) => (
      <MemoryRouter>
        <CheatSheet {...p} mode={mode} />
      </MemoryRouter>
    );
    rerender(view({ ...onlyLeft, onlyLeft: false }));
    rerender(view(onlyLeft));
    expect(states()).toEqual(['fresh', 'fresh']);
  });

  it('any key skips the replay to its end', async () => {
    vi.useFakeTimers();
    const q1 = question(1);
    const answer = [named(q1, 'p1', NOW - 60_000, true, 'last')];
    const after = buildSheet([q1], answer, NOW);
    const changes = sheetChanges(sheetWithout([q1], answer, 'last', NOW), after);
    const p = props(after.blocks, { replay: { token: 3, changes, focusQuestionIds: ['q1'], slow: false, waitForClick: false } });
    renderSheet(p);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(p.onReplayEnd).toHaveBeenCalledWith(3);
  });

  it('on the projector the replay waits for «Показать» and goes twice as slow', async () => {
    vi.useFakeTimers();
    const q1 = question(1);
    const answer = [named(q1, 'p1', NOW - 60_000, true, 'last')];
    const after = buildSheet([q1], answer, NOW);
    const changes = sheetChanges(sheetWithout([q1], answer, 'last', NOW), after);
    const p = props(after.blocks, { replay: { token: 4, changes, focusQuestionIds: ['q1'], slow: true, waitForClick: true } });
    const { container } = renderSheet(p);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    const show = screen.getByRole('button', { name: 'Показать, что изменилось' });
    // A key or a click elsewhere does not start it.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(p.onReplayEnd).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLElement>('.cs-line')!.dataset.state).toBe('fresh');
    fireEvent.click(show);
    await act(async () => {
      await vi.advanceTimersByTimeAsync((250 + 450) * 2 + 10);
    });
    const line = container.querySelector<HTMLElement>('.cs-line')!;
    expect(line.dataset.anim).toBe('rub');
    expect(line.style.getPropertyValue('--cs-ms')).toBe('1200ms');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(p.onReplayEnd).toHaveBeenCalledWith(4);
  });

  it('writes in the lines of a question that just arrived, one after another', () => {
    const sheet = buildSheet([question(1)], [], NOW);
    const { container } = renderSheet(props(sheet.blocks, { freshIds: new Set(['q1']) }));
    const lines = [...container.querySelectorAll<HTMLElement>('.cs-line')];
    expect(lines.map((line) => line.dataset.anim)).toEqual(['write', 'write', 'write']);
    expect(lines.map((line) => line.style.getPropertyValue('--cs-delay'))).toEqual(['0ms', `${Math.round(writeMs(POINTS[0].short) * 0.9)}ms`, `${Math.round(writeMs(POINTS[0].short) * 0.9) + Math.round(writeMs(POINTS[1].short) * 0.9)}ms`]);
  });

  it('while the sheet is being written no question changes its column', () => {
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
    try {
      const unwritten = Array.from({ length: 10 }, (_, index) => question(index + 1, { rubric: null }));
      const secondColumn = (container: HTMLElement) => container.querySelectorAll('.cs-col')[1]?.querySelector<HTMLElement>('.cs-q')?.dataset.qid;
      const before = buildSheet(unwritten, [], NOW);
      const { container, rerender } = renderSheet(props(before.blocks, { holdColumns: true }));
      expect(container.querySelectorAll('.cs-col')).toHaveLength(2);
      const held = secondColumn(container);
      // The first question gets its lines with a long note under it: measured anew, the split would move up.
      const longer = unwritten.map((item, index) => (index === 0 ? question(1, { coverage: 'partial', missing_note: 'x'.repeat(400) }) : item));
      const during = buildSheet(longer, [], NOW);
      const view = (blocks: SheetBlock[], holdColumns: boolean) => (
        <MemoryRouter>
          <CheatSheet {...props(blocks, { holdColumns })} />
        </MemoryRouter>
      );
      rerender(view(during.blocks, true));
      expect(secondColumn(container)).toBe(held);
      // The writing over, the columns are balanced again.
      rerender(view(during.blocks, false));
      expect(secondColumn(container)).not.toBe(held);
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width);
    }
  });

  it('in «Вся шпаргалка» a click on a question leaves the overview there', () => {
    const sheet = buildSheet([question(1), question(2)], [], NOW);
    const p = props(sheet.blocks, { mode: { onlyLeft: false, cover: false, zoom: true } });
    const { container } = renderSheet(p);
    fireEvent.click(within(container.querySelector<HTMLElement>('#cs-q-q2')!).getAllByRole('button')[1]);
    expect(p.onZoomPick).toHaveBeenCalledWith('q2');
    expect(p.onLine).not.toHaveBeenCalled();
  });

  it('the first rubbed and the first erased line say in pencil what their look means; the others do not (EX-17)', () => {
    const q1 = question(1);
    const q2 = question(2);
    const events = [
      named(q1, 'p1', NOW - DAY),
      named(q1, 'p2', NOW - DAY),
      // Question 2's first point named on two days: erased.
      named(q2, 'p1', NOW - 3 * DAY),
      named(q2, 'p1', NOW - DAY),
      named(q2, 'p2', NOW - DAY),
    ];
    const sheet = buildSheet([q1, q2], events, NOW);
    const { container, rerender } = renderSheet(props(sheet.blocks));
    const noteOf = (id: string, index: number) => {
      const line = container.querySelectorAll<HTMLElement>(`#cs-q-${id} .cs-line`)[index];
      const note = line.querySelector<HTMLElement>('.cs-note');
      return note ? [line.dataset.state, plain(note.textContent), note.dataset.kind, note.hasAttribute('data-reserve')] : [line.dataset.state, null];
    };
    expect(noteOf('q1', 0)).toEqual(['rubbed', 'стёрта наполовину: назван 4 окт.', 'explain', false]);
    expect(noteOf('q1', 1)).toEqual(['rubbed', null]);
    expect(noteOf('q2', 0)).toEqual(['erased', 'стёрта совсем: назван в разные дни', 'explain', false]);
    // For the eye: the line's own name says its state to a screen reader.
    expect(container.querySelector('#cs-q-q1 .cs-note')).toHaveAttribute('aria-hidden', 'true');
    // «Скрыть строки, стёртые совсем»: the erased line is gone, and no other one explains in its place.
    rerender(
      <MemoryRouter>
        <CheatSheet {...props(sheet.blocks, { mode: { onlyLeft: true, cover: false, zoom: false } })} />
      </MemoryRouter>,
    );
    expect([...container.querySelectorAll<HTMLElement>('.cs-note[data-kind="explain"]')].map((note) => plain(note.textContent))).toEqual(['стёрта наполовину: назван 4 окт.']);
    // A line uncovered today keeps its own note: the next rubbed line explains.
    const peeked = new Map([[`${RUBRIC_A}:p1`, Date.now() + 6000]]);
    rerender(
      <MemoryRouter>
        <CheatSheet {...props(sheet.blocks, { peeked })} />
      </MemoryRouter>,
    );
    expect(noteOf('q1', 0)).toEqual(['rubbed', 'подсмотрели — сегодня не сотрётся', 'peek', false]);
  });

  it('while a show draws the explained line as it was, its row waits empty, so nothing moves', async () => {
    vi.useFakeTimers();
    const q1 = question(1);
    const answer = [named(q1, 'p1', NOW - 60_000, true, 'last')];
    const after = buildSheet([q1], answer, NOW);
    const changes = sheetChanges(sheetWithout([q1], answer, 'last', NOW), after);
    const p = props(after.blocks, { replay: { token: 11, changes, focusQuestionIds: ['q1'], slow: false, waitForClick: false } });
    const { container } = renderSheet(p);
    const first = () => container.querySelector<HTMLElement>('#cs-q-q1 .cs-line')!;
    expect(first().dataset.state).toBe('fresh');
    expect(first().querySelector('.cs-note')?.hasAttribute('data-reserve')).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(p.onReplayEnd).toHaveBeenCalledWith(11);
    expect(first().dataset.state).toBe('rubbed');
    expect(first().querySelector('.cs-note')?.hasAttribute('data-reserve')).toBe(false);
    expect(plain(first().querySelector('.cs-note')?.textContent)).toBe(`стёрта наполовину: назван ${plain(formatShortDay(localDayOf(NOW - 60_000)))}`);
  });

  describe('the rubbed paper under a line’s rows of words (EX-18)', () => {
    // jsdom lays nothing out: the words of a line lie in rows of the body's width (WORDS px in all), measured
    // by stubs; the observers of size are fakes the test reports through.
    const WORDS = 450;
    let bodyWidth = 600;
    let wrapWidth = 1000;
    const seen: string[] = [];
    const observers: Array<{ callback: ResizeObserverCallback; targets: Element[] }> = [];
    const rowsOf = () => {
      const out: Array<{ left: number; top: number; width: number; height: number }> = [];
      for (let left = WORDS, row = 0; left > 0; left -= bodyWidth, row += 1) out.push({ left: 0, top: row * 24, width: Math.min(bodyWidth, left), height: 24 });
      return out;
    };
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const stub = (target: object, key: string, descriptor: PropertyDescriptor) => {
      descriptors.set(`${target === Element.prototype ? 'E' : 'H'}:${key}`, Object.getOwnPropertyDescriptor(target, key));
      Object.defineProperty(target, key, { configurable: true, ...descriptor });
    };

    beforeEach(() => {
      bodyWidth = 600;
      wrapWidth = 1000;
      seen.length = 0;
      observers.length = 0;
      const rects = Element.prototype.getClientRects;
      const box = HTMLElement.prototype.getBoundingClientRect;
      stub(Element.prototype, 'getClientRects', {
        value(this: Element) {
          if (!this.classList.contains('cs-ink-t')) return rects.call(this);
          // How the paper was laid out when the line measured its words.
          seen.push(this.closest('.cs-paper')?.getAttribute('data-columns') ?? '?');
          return rowsOf().map((row) => ({ ...row, right: row.left + row.width, bottom: row.top + row.height, x: row.left, y: row.top }));
        },
      });
      stub(HTMLElement.prototype, 'getBoundingClientRect', {
        value(this: HTMLElement) {
          if (!this.classList.contains('cs-body')) return box.call(this);
          const height = rowsOf().length * 24;
          return { left: 0, top: 0, width: bodyWidth, height, right: bodyWidth, bottom: height, x: 0, y: 0, toJSON: () => null } as DOMRect;
        },
      });
      stub(HTMLElement.prototype, 'offsetWidth', { get(this: HTMLElement) { return this.classList.contains('cs-body') ? bodyWidth : 0; } });
      stub(HTMLElement.prototype, 'offsetHeight', { get(this: HTMLElement) { return this.classList.contains('cs-body') ? rowsOf().length * 24 : 0; } });
      stub(HTMLElement.prototype, 'clientWidth', { get(this: HTMLElement) { return this.classList.contains('cs-wrap') ? wrapWidth : 0; } });
      vi.stubGlobal(
        'ResizeObserver',
        class {
          entry: { callback: ResizeObserverCallback; targets: Element[] };
          constructor(callback: ResizeObserverCallback) {
            this.entry = { callback, targets: [] };
            observers.push(this.entry);
          }
          observe(target: Element) {
            this.entry.targets.push(target);
          }
          unobserve() {}
          disconnect() {
            this.entry.targets = [];
          }
        },
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      for (const [key, descriptor] of descriptors) {
        const [where, name] = key.split(':');
        const target = where === 'E' ? Element.prototype : HTMLElement.prototype;
        if (descriptor) Object.defineProperty(target, name, descriptor);
        else delete (target as unknown as Record<string, unknown>)[name];
      }
      descriptors.clear();
    });

    /** Every observer of a line's body reports (as a browser does after layout). */
    const reportBodies = async () => {
      await act(async () => {
        for (const observer of observers) if (observer.targets.some((target) => target.classList.contains('cs-body'))) observer.callback([], {} as ResizeObserver);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
    };
    const patches = (container: HTMLElement) =>
      [...container.querySelectorAll<HTMLElement>('.cs-line[data-state="rubbed"] .cs-patch')].map((patch) => ({ top: patch.style.top, width: patch.style.width }));

    it('lays the questions out in the paper’s columns before a line measures its words', () => {
      const q1 = question(1);
      const sheet = buildSheet([q1, question(2)], [named(q1, 'p1', NOW - DAY)], NOW);
      renderSheet(props(sheet.blocks));
      // A line that measured its words in a paper of one column kept strips as wide as the whole paper.
      expect(seen.length).toBeGreaterThan(0);
      expect(seen[0]).toBe('2');
    });

    it('one strip per row of words, never wider than the line’s body; measured again when the body changes, its first report too', async () => {
      const q1 = question(1);
      const sheet = buildSheet([q1, question(2)], [named(q1, 'p1', NOW - DAY)], NOW);
      const { container } = renderSheet(props(sheet.blocks));
      expect(patches(container)).toEqual([{ top: '1px', width: `${WORDS + 16}px` }]);
      // The body narrowed between the first measure and the observer's first report (the paper got its columns,
      // a font, a scrollbar): three rows of words, three strips — not the one wide strip measured before.
      bodyWidth = 200;
      await reportBodies();
      expect(patches(container)).toEqual([
        { top: '1px', width: '216px' },
        { top: '25px', width: '216px' },
        { top: '49px', width: '66px' },
      ]);
      // A report of the size already measured measures nothing again.
      const calls = seen.length;
      await reportBodies();
      expect(seen.length).toBe(calls);
    });
  });

  it('keeps line keys stable for the page', () => {
    const sheet = buildSheet([question(1)], [], NOW);
    const keys = sheet.blocks[0].lines.map((line: SheetLine) => line.key);
    expect(keys).toEqual([`${RUBRIC_A}:p1`, `${RUBRIC_A}:p2`, `${RUBRIC_A}:p3`]);
  });
});
