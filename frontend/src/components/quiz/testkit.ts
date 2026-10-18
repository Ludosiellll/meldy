/**
 * Fixtures of the author's quiz pages' tests (pages/quiz/*.test.tsx): an exam of two subjects with keyed questions and
 * an oral-only one, a quiz row, and quiz_results with a person writing, a person with two finished attempts and the
 * author's own try.
 */
import { item, subject, summary } from '../containers/testkit/fixtures';
import type { ContainerSummary, TestItem } from '../../types/container';
import type { QuizAttemptRow, QuizListRow, QuizResults, QuizRow } from '../../types/quiz';

export const EXAM = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
export const S1 = '69ead689-38d6-4350-bc5d-13d273f8b9b2';
export const S2 = '590a774c-7a67-4b13-a944-cf9a2f0e9d9b';
export const ORAL = '93c5b45c-df3d-4c94-b305-960744c757be';
export const QUIZ_ID = '7a3e7c1e-1d2b-4c5e-9f0a-1b2c3d4e5f60';
export const NOW = new Date('2026-10-16T12:00:00Z');

export function examSummary(over: Partial<ContainerSummary> = {}): ContainerSummary {
  return summary({
    id: EXAM,
    title: 'Зимняя сессия',
    subjects: [
      subject({ id: S1, position: 1, title: 'Вариант 1' }),
      subject({ id: S2, position: 2, title: 'Вариант 2' }),
      subject({ id: ORAL, position: 3, title: 'Билеты', keyed: 0, no_key: 0, oral: { exam_id: 'c0390f9c-787d-4d0e-a82d-9efa069bfe11', questions: 7 }, kinds: { single: 0, multiple: 0, short: 0 } }),
    ],
    ...over,
  });
}

/** Three questions people got (№ 37 one key, № 3 several, № 5 a short answer) and 15 keyed fillers a subject. */
export function examItems(): Map<string, TestItem> {
  const list: TestItem[] = [
    item({ id: 'i37', subject_id: S1, position: 37, file_no: '37', stem: 'Какой оператор сравнивает строки?', options: ['=', '==', '===', 'eq'], correct: [1] }),
    item({ id: 'i3', subject_id: S1, position: 3, file_no: '3', kind: 'multiple', stem: 'Что относится к ссылочным типам?', options: ['class', 'struct', 'string', 'int'], correct: [0, 2] }),
    item({ id: 'i5', subject_id: S2, position: 5, file_no: '5', kind: 'short', stem: 'В каком году заключена Люблинская уния?', options: [], correct: [], answers: ['1569'] }),
    item({ id: 'nokey', subject_id: S1, position: 99, file_no: '99', correct: [] }),
  ];
  for (let n = 0; n < 13; n += 1) list.push(item({ id: `f1-${n}`, subject_id: S1, position: 100 + n, file_no: String(100 + n) }));
  for (let n = 0; n < 14; n += 1) list.push(item({ id: `f2-${n}`, subject_id: S2, position: 100 + n, file_no: String(100 + n) }));
  return new Map(list.map((entry) => [entry.id, entry]));
}

export function quizRow(over: Partial<QuizRow> = {}): QuizRow {
  return {
    id: QUIZ_ID,
    container_id: EXAM,
    code: 'k7m2p9q4r8st',
    title: 'Контрольная · 16.10',
    subject_ids: [S1, S2],
    item_count: 3,
    same_set: false,
    shuffle_items: true,
    shuffle_options: true,
    time_limit_s: 1200,
    opens_at: null,
    closes_at: '2026-10-23T20:59:00+00:00',
    closed_at: null,
    attempts: 3,
    grading: 'best',
    allow_back: true,
    pass_percent: 60,
    review: 'mistakes_then_answers',
    members_only: false,
    guests: true,
    cover_path: null,
    accent: 'blue',
    offer_practice: false,
    created_at: '2026-10-16T10:00:00+00:00',
    updated_at: '2026-10-16T10:00:00+00:00',
    state: 'open',
    started: true,
    ...over,
  };
}

export function listRow(over: Partial<QuizListRow> = {}): QuizListRow {
  return { ...quizRow(), people: 7, writing: 2, finished: 5, avg_percent: 71.4, ...over };
}

function attempt(over: Partial<QuizAttemptRow> & { id: string }): QuizAttemptRow {
  return {
    person: 'p1',
    name: 'Иванов Иван',
    own: false,
    guest: false,
    n: 1,
    started_at: '2026-10-16T11:30:00Z',
    deadline_at: '2026-10-16T11:50:00Z',
    finished_at: '2026-10-16T11:48:00Z',
    finish_reason: 'sent',
    total: 3,
    answered: 3,
    correct: 1,
    ...over,
  };
}

/**
 * Иванов: two attempts, the second counts (2 of 3, 67 %); Борисова writes (2 of 3 answered, 8 min 41 s left); the
 * author tried once and got nothing right — left out of the totals and the questions.
 */
export function results(over: Partial<QuizResults> = {}): QuizResults {
  return {
    quiz: quizRow(),
    server_now: NOW.toISOString(),
    attempts: [
      attempt({ id: 'a1', n: 1, correct: 1 }),
      attempt({ id: 'a2', n: 2, started_at: '2026-10-16T11:50:00Z', deadline_at: '2026-10-16T12:10:00Z', finished_at: '2026-10-16T11:58:00Z', correct: 2 }),
      attempt({
        id: 'b1',
        person: 'p2',
        name: 'Борисова Анна',
        started_at: '2026-10-16T11:51:19Z',
        deadline_at: new Date(NOW.getTime() + 521000).toISOString(),
        finished_at: null,
        finish_reason: null,
        answered: 2,
        correct: 1,
      }),
      attempt({ id: 'c1', person: 'me', name: 'Автор Экзамена', own: true, correct: 0 }),
    ],
    items: [
      { item_id: 'i37', shown: 4, answered: 4, correct: 3, picks: [0, 3, 1, 0], wrong_texts: [] },
      { item_id: 'i5', shown: 4, answered: 3, correct: 1, picks: [], wrong_texts: [{ text: '1596', n: 2 }] },
      { item_id: 'i3', shown: 2, answered: 2, correct: 1, picks: [2, 0, 1, 1], wrong_texts: [] },
    ],
    ...over,
  };
}
