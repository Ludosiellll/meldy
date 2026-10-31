import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuizAnalysis, QuizAnalysisAttempt, QuizAnalysisCell, QuizAttemptRow } from '../../types/quiz';

const api = vi.hoisted(() => ({
  quizResults: vi.fn(),
  quizMarks: vi.fn(),
  attemptAnswers: vi.fn(),
  resetAttempt: vi.fn(),
  closeQuiz: vi.fn(),
  deleteQuiz: vi.fn(),
  quizAnalysis: vi.fn(),
  quizCompare: vi.fn(),
  sendMistakes: vi.fn(),
  sendAllMistakes: vi.fn(),
  quizTelegramState: vi.fn(),
  state: { summary: null as unknown, items: null as unknown },
}));
vi.mock('../../api/quizzes', () => ({
  quizResults: api.quizResults,
  quizMarks: api.quizMarks,
  attemptAnswers: api.attemptAnswers,
  resetAttempt: api.resetAttempt,
  closeQuiz: api.closeQuiz,
  deleteQuiz: api.deleteQuiz,
  quizAnalysis: api.quizAnalysis,
  quizCompare: api.quizCompare,
  sendMistakes: api.sendMistakes,
  sendAllMistakes: api.sendAllMistakes,
  // release 49: Telegram on the page (its own tests: QuizTelegram.test.tsx); an older server without it
  quizTelegramState: api.quizTelegramState,
  setQuizNotice: vi.fn(),
  shareQuizToGroup: vi.fn(),
}));
vi.mock('../../lib/containers/hooks', () => ({
  useContainerData: () => ({
    data: { summary: api.state.summary, items: api.state.items, planInput: null, oralWithoutPoints: 0 },
    loading: false,
    offline: false,
    unavailable: false,
    error: null,
    gone: false,
    reload: vi.fn(),
  }),
}));

import QuizStatsPage from './QuizStatsPage';
import { QA_ANALYSIS, QA_PEOPLE, QA_REPEAT, QA_STATS } from '../../components/quiz/copyAuthor';
import { EXAM, examItems, examSummary, NOW, QUIZ_ID, quizRow, results } from '../../components/quiz/testkit';

/**
 * Release 49 on the author's stats page (quiz_analysis, lib/quizzes/analysis.ts): «Вопросы» says how well each question
 * tells those who know apart (from 15 attempts), the trap and the usual time, compares with another quiz of the exam;
 * «Повторить» lists who repeats what and sends the mistakes to training; «Участники» marks the very fast ones, with
 * the line that a mark is not a proof.
 */

const plain = (text: string | null | undefined) => (text ?? '').replace(/\u00a0/g, ' ');
const page = () => plain(document.body.textContent);

function renderPage(width = 1532, search = '') {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  return render(
    <MemoryRouter initialEntries={[`/exams/c/${EXAM}/quizzes/${QUIZ_ID}${search}`]}>
      <Routes>
        <Route path="/exams/c/:id/quizzes/:quizId" element={<QuizStatsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * `n` people of rising strength s: № 37 right from the middle up (it tells them apart), № 3 right on every other one
 * (it does not), № 5 right from a quarter up. 20 s on № 37 each. The last person is a guest, the one before is outside
 * the exam; s = 0 answered all five in 10 s.
 */
function classOf(n: number): { analysis: QuizAnalysis; attempts: QuizAttemptRow[] } {
  const attempts: QuizAnalysisAttempt[] = [];
  const rows: QuizAttemptRow[] = [];
  for (let s = 0; s < n; s += 1) {
    const cells: QuizAnalysisCell[] = [
      [0, s >= n / 2 ? 1 : 0, s === 0 ? 2 : 20],
      [1, s % 2, s === 0 ? 2 : 30],
      [2, s >= n / 4 ? 1 : 0, s === 0 ? 2 : 40],
      // two easy questions everybody gets right (not among the stats' rows); s = 0 answers all five in 2 s each
      [3, 1, s === 0 ? 2 : 15],
      [4, 1, s === 0 ? 2 : 15],
    ];
    attempts.push({
      id: `x${s}`,
      person: `p${s}`,
      n: 1,
      guest: s === n - 1,
      member: s < n - 2,
      sent: false,
      started_at: '2026-10-16T11:00:00Z',
      finished_at: '2026-10-16T11:20:00Z',
      cells,
    });
    rows.push({
      id: `x${s}`,
      person: `p${s}`,
      name: `Ученик ${String(s).padStart(2, '0')}`,
      own: false,
      guest: s === n - 1,
      n: 1,
      started_at: '2026-10-16T11:00:00Z',
      deadline_at: null,
      finished_at: '2026-10-16T11:20:00Z',
      finish_reason: 'sent',
      total: 3,
      answered: 3,
      correct: cells.filter((c) => c[1] === 1 && c[0] < 3).length,
    });
  }
  return {
    analysis: {
      quiz_id: QUIZ_ID,
      server_now: NOW.toISOString(),
      items: ['i37', 'i3', 'i5', 'f1-0', 'f1-1'],
      attempts,
      others: [{ id: 'o1', title: '9Б', created_at: '2026-10-10T10:00:00Z', closed: true, attempts: 12 }],
    },
    attempts: rows,
  };
}

function serve(n: number) {
  const { analysis, attempts } = classOf(n);
  api.quizResults.mockImplementation(async () =>
    results({
      attempts,
      items: [
        { item_id: 'i37', shown: n, answered: n, correct: n / 2, picks: [2, n / 2, n / 2 - 2, 0], wrong_texts: [] },
        { item_id: 'i3', shown: n, answered: n, correct: n / 2, picks: [n / 2, 2, n / 2, 0], wrong_texts: [] },
        { item_id: 'i5', shown: n, answered: n, correct: n - n / 4, picks: [], wrong_texts: [] },
      ],
    }),
  );
  api.quizAnalysis.mockResolvedValue(analysis);
}

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  api.state.summary = examSummary();
  api.state.items = examItems();
  api.quizResults.mockReset();
  api.quizMarks.mockReset().mockResolvedValue([]);
  api.quizAnalysis.mockReset();
  api.sendMistakes.mockReset();
  api.sendAllMistakes.mockReset();
  api.quizCompare.mockReset().mockResolvedValue({ id: 'o1', title: '9Б', attempts: 12, capped: false, items: [['i37', 12, 3], ['i5', 12, 12]] });
  api.quizTelegramState.mockReset().mockRejectedValue(new Error('PGRST202'));
  serve(20);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('«Вопросы»: how well a question tells those who know apart', () => {
  it('a verdict from 15 attempts, «стоит переписать» on top, the trap and the usual time', async () => {
    renderPage(1532, '?tab=questions');
    await waitFor(() => expect(page()).toContain(QA_ANALYSIS.verdict.good));
    expect(page()).toContain(QA_ANALYSIS.verdict.poor);
    expect(page()).toContain(QA_ANALYSIS.rewrite('№ 3'));
    expect(page()).toContain(QA_ANALYSIS.how);
    // № 37: the key is Б; В was chosen by 8 of 20 — the trap, said in words beside its bar
    expect(page()).toContain(QA_ANALYSIS.trap('В', 8, 20));
    expect(screen.getAllByText(QA_ANALYSIS.trapWord).length).toBeGreaterThan(0);
    expect(page()).toContain(QA_ANALYSIS.time('20 с'));
    expect(page()).toContain('Из сильных верно 100 %, из слабых — 0 %.');
    expect(api.quizAnalysis).toHaveBeenCalledWith(QUIZ_ID);
  });

  it('under 15 finished attempts: no verdict, only when it will come', async () => {
    serve(8);
    renderPage(1532, '?tab=questions');
    await waitFor(() => expect(page()).toContain(QA_ANALYSIS.wait(15, 8)));
    expect(page()).not.toContain(QA_ANALYSIS.verdict.good);
    expect(page()).not.toContain(QA_ANALYSIS.verdict.poor);
  });

  it('another quiz of the same exam: the share on the common questions, and beside each of them', async () => {
    renderPage(1532, '?tab=questions');
    await waitFor(() => expect(page()).toContain(QA_ANALYSIS.compareHint));
    fireEvent.click(screen.getByRole('combobox', { name: QA_ANALYSIS.compare }));
    fireEvent.click(screen.getByRole('option', { name: QA_ANALYSIS.compareOption('9Б', 12) }));
    // read when picked (quiz_compare), not with the analysis
    await waitFor(() => expect(api.quizCompare).toHaveBeenCalledWith(QUIZ_ID, 'o1'));
    // here № 37 10 of 20 and № 5 15 of 20 → 63 %; there 3 of 12 and 12 of 12 → 63 %
    await waitFor(() => expect(page()).toContain(QA_ANALYSIS.compareLine('9Б', 2, 63, 63)));
    expect(page()).toContain(QA_ANALYSIS.compareItem('9Б', 25, 12));
    expect(page()).toContain(QA_ANALYSIS.compareItem('9Б', 100, 12));
  });

  it('the analysis cannot be read: the results stay, a quiet line offers to try again', async () => {
    api.quizAnalysis.mockReset().mockRejectedValueOnce(new Error('down')).mockResolvedValue(classOf(20).analysis);
    renderPage(1532, '?tab=questions');
    await waitFor(() => expect(page()).toContain(QA_ANALYSIS.failed));
    fireEvent.click(screen.getByRole('button', { name: QA_ANALYSIS.retry }));
    await waitFor(() => expect(page()).toContain(QA_ANALYSIS.verdict.good));
  });
});

describe('«Повторить»: who repeats what, and the mistakes into training', () => {
  it('a row a person with the question numbers; guests and people outside the exam are told apart', async () => {
    renderPage(390, '?tab=repeat');
    await waitFor(() => expect(screen.getByRole('tab', { name: QA_STATS.tabRepeat })).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(screen.getByRole('list', { name: QA_REPEAT.title })).toBeInTheDocument());
    expect(page()).toContain('Ученик 00');
    expect(page()).toContain(`${QA_REPEAT.count(3)}: № 37, № 3, № 5`);
    expect(page()).toContain(QA_REPEAT.allRight);
    expect(page()).toContain(QA_REPEAT.guests(1));
    expect(page()).toContain(QA_REPEAT.outsideNoPractice(1, false));
    expect(page()).toContain(QA_REPEAT.sendHow(false));
  });

  it('one press sends in batches: «Отправляем: 50 из 120…» meanwhile, then how many; the analysis read again', async () => {
    let finish: (value: unknown) => void = () => undefined;
    api.sendAllMistakes.mockImplementation(async (_id: string, onBatch?: (done: number, total: number) => void) => {
      onBatch?.(50, 120);
      await new Promise((resolve) => {
        finish = resolve;
      });
      return { people: 2, answers: 5, again: 0, clean: 1, learned: 3, outside: 1, guests: 1, practice: false, total: 120, left: 0, next: null };
    });
    renderPage(1532, '?tab=repeat');
    const button = await screen.findByRole('button', { name: QA_REPEAT.send });
    const before = api.quizAnalysis.mock.calls.length;
    fireEvent.click(button);
    await waitFor(() => expect(page()).toContain(QA_REPEAT.progress(50, 120)));
    expect(screen.getByRole('button', { name: QA_REPEAT.sending })).toBeDisabled();
    finish(null);
    await waitFor(() => expect(page()).toContain(QA_REPEAT.done(2, 5)));
    expect(page()).toContain(QA_REPEAT.learned(3));
    expect(api.sendAllMistakes).toHaveBeenCalledWith(QUIZ_ID, expect.any(Function));
    await waitFor(() => expect(api.quizAnalysis.mock.calls.length).toBeGreaterThan(before));
  });

  it('a second press with nothing new says so', async () => {
    api.sendAllMistakes.mockResolvedValue({ people: 0, answers: 0, again: 3, clean: 1, learned: 0, outside: 1, guests: 1, practice: true, total: 5, left: 0, next: null });
    renderPage(1532, '?tab=repeat');
    fireEvent.click(await screen.findByRole('button', { name: QA_REPEAT.send }));
    await waitFor(() => expect(page()).toContain(QA_REPEAT.nothingNew));
  });

  it('nobody has finished: nothing to read, the empty words', async () => {
    api.quizResults.mockImplementation(async () => results({ attempts: [] }));
    renderPage(1532, '?tab=repeat');
    await waitFor(() => expect(page()).toContain(QA_REPEAT.empty));
    expect(api.quizAnalysis).not.toHaveBeenCalled();
  });
});

describe('«Участники»: signals, not accusations', () => {
  it('many answers in very little time get a mark with its words, and the line that it is not a proof', async () => {
    renderPage(1532);
    await waitFor(() => expect(page()).toContain(QA_PEOPLE.fastLabel(5, 10)));
    expect(screen.getAllByText(QA_PEOPLE.fast)).toHaveLength(1);
    expect(page()).toContain(QA_PEOPLE.notProof);
    fireEvent.click(screen.getByRole('checkbox', { name: QA_PEOPLE.onlyFlagged }));
    expect(screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('Ученик'))).toHaveLength(1);
  });

  it('the quiz row is the same: an older server without the analysis changes nothing else', async () => {
    api.quizAnalysis.mockReset().mockRejectedValue(new Error('PGRST202'));
    api.quizResults.mockImplementation(async () => results({ quiz: quizRow() }));
    renderPage(1532);
    await waitFor(() => expect(page()).toContain('Иванов Иван'));
    expect(page()).not.toContain(QA_PEOPLE.notProof);
  });
});
