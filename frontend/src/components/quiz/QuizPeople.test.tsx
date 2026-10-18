import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/quizzes', () => ({ attemptAnswers: vi.fn(async () => []), resetAttempt: vi.fn() }));

import QuizPeople from './QuizPeople';
import { QA_PEOPLE } from './copyAuthor';
import { examItems, quizRow, results, S1, S2 } from './testkit';
import type { QuizAttemptRow } from '../../types/quiz';

afterEach(cleanup);

const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ');
const SUBJECTS = [
  { id: S1, title: 'Вариант 1' },
  { id: S2, title: 'Вариант 2' },
];

/** Иванов and Борисова signed in; Петя wrote without an account (two attempts in one browser). */
function attempts(withGuest: boolean): QuizAttemptRow[] {
  const list = results().attempts.filter((attempt) => !attempt.own);
  if (!withGuest) return list;
  const base = list[0];
  return [
    ...list,
    { ...base, id: 'g1', person: '0123456789abcdef', name: 'Петя', guest: true, n: 1, correct: 1 },
    { ...base, id: 'g2', person: '0123456789abcdef', name: 'Петя', guest: true, n: 2, correct: 3 },
  ];
}

function show(list: QuizAttemptRow[], wide = false) {
  return render(
    <QuizPeople quiz={quizRow()} attempts={list} items={examItems()} subjects={SUBJECTS} offsetMs={0} wide={wide} onChanged={() => undefined} />,
  );
}

describe('QuizPeople: somebody who wrote without an account (release 47 §47.1)', () => {
  it('has a quiet «без входа» after the name, once a person, and the hint under the table', () => {
    show(attempts(true));
    const list = screen.getByRole('list', { name: QA_PEOPLE.title });
    const rows = within(list).getAllByRole('button');
    const guest = rows.find((row) => plain(row.textContent).startsWith('Петя'))!;
    expect(guest).toBeDefined();
    const name = guest.querySelector('.qa-person-name')!;
    expect(plain(name.textContent)).toBe('Петя без входа');
    expect(name.querySelector('.qa-guest')?.textContent).toBe(QA_PEOPLE.guest);
    // The others signed in: no mark.
    expect(rows.filter((row) => row !== guest).every((row) => row.querySelector('.qa-guest') === null)).toBe(true);
    expect(screen.getByText('Попытки без входа считаются по браузеру.')).toBeInTheDocument();
    // Two attempts in one browser are one person.
    expect(rows.filter((row) => plain(row.textContent).startsWith('Петя'))).toHaveLength(1);
  });

  it('on a computer too, in the name column', () => {
    show(attempts(true), true);
    const guest = within(screen.getByRole('list', { name: QA_PEOPLE.title }))
      .getAllByRole('button')
      .find((row) => plain(row.textContent).startsWith('Петя'))!;
    expect(plain(guest.querySelector('.qa-person-name')?.textContent)).toBe('Петя без входа');
  });

  it('nobody without an account: no mark, no hint', () => {
    show(attempts(false));
    expect(document.querySelector('.qa-guest')).toBeNull();
    expect(screen.queryByText(QA_PEOPLE.guestHint)).toBeNull();
  });
});

describe('QuizPeople: the table of a quiz of one attempt, the time under a minute (release 47.1)', () => {
  const one = (): QuizAttemptRow[] => {
    const base = results().attempts[0];
    return [
      { ...base, id: 'x1', person: 'p1', name: 'Иванов Иван', started_at: '2026-10-16T11:30:00Z', finished_at: '2026-10-16T11:30:40Z' },
      { ...base, id: 'y1', person: 'p2', name: 'Борисова Анна', started_at: '2026-10-16T11:30:00Z', finished_at: '2026-10-16T11:48:00Z' },
    ];
  };
  const showOne = (list: QuizAttemptRow[], wide: boolean, allowed: number | null) =>
    render(
      <QuizPeople quiz={quizRow({ attempts: allowed })} attempts={list} items={examItems()} subjects={SUBJECTS} offsetMs={0} wide={wide} onChanged={() => undefined} />,
    );
  const row = (name: string) =>
    within(screen.getByRole('list', { name: QA_PEOPLE.title }))
      .getAllByRole('button')
      .find((button) => plain(button.textContent).startsWith(name))!;

  it('one attempt allowed: no «Попытки» on a computer, in the head or the rows; «Время» says «меньше минуты»', () => {
    showOne(one(), true, 1);
    const head = document.querySelector('.qa-people-head')!;
    expect(plain(head.textContent)).not.toContain(QA_PEOPLE.head.attempts);
    expect(plain(head.textContent)).toContain(QA_PEOPLE.head.minutes);
    expect(document.querySelector('.qa-people')).toHaveAttribute('data-one', '');
    expect(document.querySelectorAll('.qa-person-attempts')).toHaveLength(0);
    // Four columns and the arrow, in the head as in the rows.
    expect(head.children).toHaveLength(5);
    expect(row('Иванов').children).toHaveLength(5);
    expect(row('Иванов').querySelector('.qa-person-minutes')?.textContent).toBe('меньше минуты');
    expect(plain(row('Борисова').querySelector('.qa-person-minutes')?.textContent)).toBe('18 мин');
  });

  it('more attempts allowed: the column stays', () => {
    showOne(one(), true, 3);
    expect(plain(document.querySelector('.qa-people-head')?.textContent)).toContain(QA_PEOPLE.head.attempts);
    expect(document.querySelector('.qa-people')).not.toHaveAttribute('data-one');
    expect(plain(row('Иванов').querySelector('.qa-person-attempts')?.textContent)).toBe('попытка 1 из 3');
  });

  it('one allowed, but somebody has two (the limit was lowered later): the column comes back for them', () => {
    const list = [...one(), { ...one()[0], id: 'x2', n: 2, started_at: '2026-10-16T11:40:00Z', finished_at: '2026-10-16T11:45:00Z' }];
    showOne(list, true, 1);
    expect(plain(document.querySelector('.qa-people-head')?.textContent)).toContain(QA_PEOPLE.head.attempts);
    expect(plain(row('Иванов').querySelector('.qa-person-attempts')?.textContent)).toBe('попытка 2 из 1');
  });

  it('a phone: «меньше минуты» in the muted line, no «попытка 1 из 1»', () => {
    showOne(one(), false, 1);
    expect(plain(row('Иванов').querySelector('.qa-person-more')?.textContent)).toBe('меньше минуты');
  });
});
