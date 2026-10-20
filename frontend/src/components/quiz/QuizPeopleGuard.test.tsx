import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ attemptAnswers: vi.fn(), resetAttempt: vi.fn(), attemptEvents: vi.fn() }));
vi.mock('../../api/quizzes', () => ({ attemptAnswers: api.attemptAnswers, resetAttempt: api.resetAttempt, attemptEvents: api.attemptEvents }));

import QuizPeople, { flagOf, statusText } from './QuizPeople';
import { QA_PEOPLE } from './copyAuthor';
import { examItems, quizRow, results, S1, S2 } from './testkit';
import { csvOf } from '../../lib/quizzes/quizModel';
import type { QuizAttemptRow, QuizGuardEventRow, QuizRow } from '../../types/quiz';
import type { TestItem } from '../../types/container';

/**
 * «Защита от списывания» on the author's side (20261020120000_quiz_protection): the mark after a name, «Только с
 * нарушениями», an attempt the strict level ended, the record of an attempt in the answers sheet, the CSV's columns.
 */

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const SUBJECTS = [
  { id: S1, title: 'Вариант 1' },
  { id: S2, title: 'Вариант 2' },
];

/** Иванов: 3 times away on attempt 2 (ended by the strict level); Борисова: clean; Петя: a copy only. */
function attempts(): QuizAttemptRow[] {
  const list = results().attempts.filter((attempt) => !attempt.own);
  const base = list[0];
  return [
    ...list.map((attempt) =>
      attempt.id === 'a2' ? { ...attempt, guard_count: 3, guard_events: 5, flagged: true, finish_reason: 'protection' as const } : { ...attempt, guard_count: 0, guard_events: 0, flagged: false },
    ),
    { ...base, id: 'g1', person: '0123456789abcdef', name: 'Петя', guest: true, n: 1, guard_count: 0, guard_events: 1, flagged: true },
  ];
}

const EVENTS: QuizGuardEventRow[] = [
  { id: 'e1', kind: 'blur', at: '2026-10-16T11:52:05Z', q: 2, ms: 4000, source: 'client' },
  { id: 'e2', kind: 'hidden', at: '2026-10-16T11:53:00Z', q: 3, ms: 75_000, source: 'client' },
  { id: 'srv-1', kind: 'reload', at: '2026-10-16T11:54:30Z', q: null, ms: null, source: 'server' },
];

function show(list: QuizAttemptRow[], wide = true) {
  return render(
    <QuizPeople quiz={quizRow({ grading: 'last' })} attempts={list} items={examItems()} subjects={SUBJECTS} offsetMs={0} wide={wide} onChanged={() => undefined} />,
  );
}
const rows = () => within(screen.getByRole('list', { name: QA_PEOPLE.title })).queryAllByRole('button');
const rowOf = (name: string) => rows().find((row) => plain(row.textContent).startsWith(name));

beforeEach(() => {
  api.attemptAnswers.mockReset().mockResolvedValue([]);
  api.attemptEvents.mockReset().mockResolvedValue({ count: 3, events: EVENTS });
});
afterEach(cleanup);

describe('the mark and the filter', () => {
  it('marks a person with a time away by the count, one with a copy only by the word; a clean one not at all', () => {
    show(attempts());
    const ivanov = rowOf('Иванов')!;
    expect(ivanov.querySelector('.qa-flag')?.textContent).toContain('3 ухода');
    expect(within(ivanov).getByText('Покидал страницу: 3 раза')).toHaveClass('qa-sr');
    expect(rowOf('Петя')!.querySelector('.qa-flag')?.textContent).toContain('копирование');
    expect(rowOf('Борисова')!.querySelector('.qa-flag')).toBeNull();
    expect(flagOf({ all: attempts().filter((a) => a.person === 'p2') })).toBeNull();
  });

  it('«Только с нарушениями» keeps the marked people', () => {
    show(attempts());
    expect(rows()).toHaveLength(3);
    fireEvent.click(screen.getByRole('checkbox', { name: QA_PEOPLE.onlyFlagged }));
    expect(rows().map((row) => plain(row.querySelector('.qa-person-name')?.firstChild?.textContent))).toEqual(['Иванов Иван', 'Петя']);
    fireEvent.click(screen.getByRole('checkbox', { name: QA_PEOPLE.onlyFlagged }));
    expect(rows()).toHaveLength(3);
  });

  it('no filter when nobody is marked', () => {
    show(attempts().map((attempt) => ({ ...attempt, flagged: false, guard_count: 0, guard_events: 0 })));
    expect(screen.queryByRole('checkbox', { name: QA_PEOPLE.onlyFlagged })).toBeNull();
  });

  it('an attempt the strict level ended says so', () => {
    const ended = attempts().find((attempt) => attempt.id === 'a2')!;
    expect(statusText(ended, 0, Date.parse('2026-10-16T12:00:00Z'))).toBe(QA_PEOPLE.guardEnded);
  });
});

describe('the record of an attempt', () => {
  it('lists what the protection recorded: time, kind, question, duration; and what a site cannot see', async () => {
    show(attempts());
    fireEvent.click(rowOf('Иванов')!);
    const dialog = await screen.findByRole('dialog');
    const record = await within(dialog).findByRole('region', { name: QA_PEOPLE.eventsTitle });
    expect(api.attemptEvents).toHaveBeenCalledWith('a2');
    expect(plain(record.textContent)).toContain(QA_PEOPLE.eventsCount(3));
    const items = within(record).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(plain(items[0].textContent)).toContain(`${QA_PEOPLE.eventKind('blur')} · вопрос 2 · 4 с`);
    expect(plain(items[1].textContent)).toContain(`${QA_PEOPLE.eventKind('hidden')} · вопрос 3 · 1 мин 15 с`);
    expect(plain(items[2].textContent)).toContain(QA_PEOPLE.eventKind('reload'));
    expect(record).toHaveTextContent(QA_PEOPLE.eventsLimits);
  });

  it('a clean attempt has no record and reads nothing', async () => {
    show(attempts());
    fireEvent.click(rowOf('Борисова')!);
    await screen.findByRole('dialog');
    expect(screen.queryByRole('region', { name: QA_PEOPLE.eventsTitle })).toBeNull();
    expect(api.attemptEvents).not.toHaveBeenCalled();
  });

  it('a failed read says so and tries again', async () => {
    api.attemptEvents.mockRejectedValueOnce(new Error('offline'));
    show(attempts());
    fireEvent.click(rowOf('Петя')!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: QA_PEOPLE.retry }));
    expect(await within(dialog).findAllByRole('listitem')).not.toHaveLength(0);
  });
});

describe('csvOf with protection', () => {
  const items = [{ id: 'i1', subject_id: 's1', position: 1, file_no: '3' }] as TestItem[];
  const row = (over: Partial<QuizAttemptRow>): QuizAttemptRow => ({ ...results().attempts[0], id: 'a1', correct: 1, total: 1, ...over });

  it('adds the times away, all records and the mark when the quiz has protection', () => {
    const csv = csvOf(
      { pass_percent: null, protection: 'strict' } as QuizRow,
      [row({ guard_count: 3, guard_events: 5, flagged: true }), row({ id: 'a2', name: 'Чистый', guard_count: 0, guard_events: 0, flagged: false })],
      [],
      items,
      [{ id: 's1', title: 'Вариант 1' }],
    );
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Имя;Попытка;Начало;Конец;Минуты;Верно;Всего;%;Порог;Уходы со страницы;Все записи защиты;Нарушения');
    expect(lines.find((line) => line.startsWith('Иванов'))?.endsWith(';3;5;да')).toBe(true);
    expect(lines.find((line) => line.startsWith('Чистый'))?.endsWith(';0;0;')).toBe(true);
  });

  it('leaves them out for a quiz without protection and without records', () => {
    const csv = csvOf({ pass_percent: null, protection: 'off' } as QuizRow, [row({})], [], items, [{ id: 's1', title: 'Вариант 1' }]);
    expect(csv.slice(1).split('\r\n')[0]).toBe('Имя;Попытка;Начало;Конец;Минуты;Верно;Всего;%;Порог');
  });
});
