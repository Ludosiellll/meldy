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
