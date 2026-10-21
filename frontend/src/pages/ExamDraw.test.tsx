import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ExamBundle, ExamQuestion } from '../api/exams';
import type { LearningEvent } from '../api/learning';

const mocks = vi.hoisted(() => ({
  loadExamBundle: vi.fn(),
  prefetchRubric: vi.fn(),
  fetchQuestionEvents: vi.fn(),
  fetchSheet: vi.fn(),
  fetchSheetEvents: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../api/exams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/exams')>();
  return { ...actual, loadExamBundle: mocks.loadExamBundle, prefetchRubric: mocks.prefetchRubric };
});
vi.mock('../api/learning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/learning')>();
  return { ...actual, fetchQuestionEvents: mocks.fetchQuestionEvents, fetchSheetEvents: mocks.fetchSheetEvents };
});
// The exam's cheat sheet (GET /api/oral/sheet): «Ждут подтверждения» draws from what an answer erases on it.
vi.mock('../api/cheatSheet', () => ({ fetchSheet: mocks.fetchSheet }));

import ExamDraw, { NO_ANSWERABLE_TICKET, answerHrefOf, skippedNote } from './ExamDraw';

const hash = (n: number) => n.toString(16).padStart(32, 'b');

function question(n: number, coverage: ExamQuestion['coverage'] = 'full'): ExamQuestion {
  return {
    id: `q${n}`,
    exam_id: 'exam-1',
    position: n,
    label: String(n),
    section: null,
    text: `Вопрос номер ${n} о рынке`,
    question_hash: hash(n),
    coverage,
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    evidence: [],
    nearest: [],
    materials_fingerprint: 'fp',
    mapping_version: 1,
    mapped_at: '2026-10-03T06:40:00Z',
    created_at: '2026-10-01T06:40:00Z',
  };
}

function bundle(questions: ExamQuestion[], layout: ExamBundle['exam']['ticket_layout'] = { mode: 'random', per_ticket: 2 }): ExamBundle {
  return {
    exam: {
      id: 'exam-1',
      title: 'Микроэкономика',
      kind: 'exam',
      exam_date: null,
      source_kind: 'paste',
      source_text: '',
      ticket_layout: layout,
      mapping_state: 'done',
      mapping_started_at: null,
      mapped_at: '2026-10-03T06:40:00Z',
      mapped_material_ids: ['m1'],
      created_at: '2026-10-01T06:40:00Z',
    },
    questions,
    materialIds: ['m1'],
    materials: [{ id: 'm1', title: 'Лекция' }],
  };
}

function answer(n: number, day = '2026-10-02', correct = true): LearningEvent {
  return {
    id: `a${n}-${day}`,
    created_at: `${day}T10:00:00Z`,
    local_date: day,
    material_id: null,
    kind: 'exam_answer',
    item_key: `q:${hash(n)}`,
    correct,
    score: 0.8,
    confidence: null,
    source_ids: [],
    session_id: `s${n}`,
    payload: { grade: 4 },
  };
}

let location = '';
function Where() {
  const current = useLocation();
  location = `${current.pathname}${current.search}`;
  return null;
}

function renderDraw(path = '/exams/exam-1/draw') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams/:id/draw" element={<ExamDraw />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.loadExamBundle.mockReset();
  mocks.prefetchRubric.mockReset();
  mocks.fetchQuestionEvents.mockReset().mockResolvedValue([]);
  mocks.fetchSheet.mockReset().mockResolvedValue({ examId: 'exam-1', mappingState: 'done', questions: [], toWrite: 0, units: 0, job: null });
  mocks.fetchSheetEvents.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ExamDraw', () => {
  it('draws a ticket on arrival and opens the answer screen with its questions in exam mode', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    renderDraw();
    const card = await screen.findByRole('article', { name: /Случайный билет: вопросы 1 и 2/ });
    expect(document.title).toBe('Тянуть билет — Meldy');
    expect(card).toHaveTextContent('Вопрос номер 1 о рынке');
    expect(card).toHaveTextContent('Вопрос номер 2 о рынке');
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать' }));
    // «Как на экзамене» hands the answer screen its mode: no point marks while answering.
    expect(location).toBe('/exams/exam-1/ticket?q=q1,q2&mode=exam');
  });

  it('prepares no answer points for a question whose points cannot be built: the server would only answer 422', async () => {
    // Audit of 2026-10-08: each draw of such a ticket asked for its points, got 422 and logged an error.
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    mocks.fetchSheet.mockResolvedValue({
      examId: 'exam-1',
      mappingState: 'done',
      questions: [
        { question_id: 'q1', unwritable: false },
        { question_id: 'q2', unwritable: true },
      ],
      toWrite: 0,
      units: 0,
      job: null,
    });
    const first = renderDraw();
    await screen.findByRole('article', { name: /Случайный билет: вопросы 1 и 2/ });
    await waitFor(() => expect(mocks.prefetchRubric).toHaveBeenCalledTimes(1));
    expect(mocks.prefetchRubric).toHaveBeenCalledWith('exam-1', 'q1');
    expect(mocks.fetchSheet).toHaveBeenCalledWith('exam-1');
    first.unmount();

    // The sheet cannot be read: every question in the lectures gets its points prepared, as before.
    mocks.prefetchRubric.mockReset();
    mocks.fetchSheet.mockRejectedValue(new Error('offline'));
    renderDraw();
    await screen.findByRole('article', { name: /Случайный билет: вопросы 1 и 2/ });
    await waitFor(() => expect(mocks.prefetchRubric).toHaveBeenCalledTimes(2));
  });

  it('sends a mode only from «Как на экзамене»', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1), answer(2)]);
    renderDraw('/exams/exam-1/draw?mode=answered');
    await screen.findByRole('article', { name: /Случайный билет: вопросы 1 и 2/ });
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать' }));
    expect(location).toBe('/exams/exam-1/ticket?q=q1,q2');
    expect(answerHrefOf('e', ['a', 'b'], 7, 'exam')).toBe('/exams/e/ticket?q=a,b&n=7&mode=exam');
    expect(answerHrefOf('e', ['a'], null, 'weak')).toBe('/exams/e/ticket?q=a');
    expect(answerHrefOf('e', ['a'], null, 'awaiting')).toBe('/exams/e/ticket?q=a');
  });

  it('passes the department’s ticket number for a known ticket', async () => {
    mocks.loadExamBundle.mockResolvedValue(
      bundle([question(1), question(2), question(3), question(4)], { mode: 'fixed', per_ticket: 2, tickets: [{ number: 12, question_ids: ['q1', 'q3'] }] }),
    );
    renderDraw();
    expect(await screen.findByRole('article', { name: 'Билет 12: вопросы 1 и 3' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать' }));
    expect(location).toBe('/exams/exam-1/ticket?q=q1,q3&n=12&mode=exam');
  });

  it('keeps &n of a department’s ticket whose question missing from the lectures is left out of q, and says which one', async () => {
    mocks.loadExamBundle.mockResolvedValue(
      bundle([question(1, 'full'), question(2, 'none')], { mode: 'fixed', per_ticket: 2, tickets: [{ number: 3, question_ids: ['q1', 'q2'] }] }),
    );
    renderDraw();
    await screen.findByRole('article', { name: 'Билет 3: вопросы 1 и 2' });
    expect(mocks.prefetchRubric).toHaveBeenCalledTimes(1);
    expect(mocks.prefetchRubric).toHaveBeenCalledWith('exam-1', 'q1');
    // «Как на экзамене» has no «тяните ещё»: the card only says what the question lacks.
    expect(screen.getByText('Этого вопроса нет в ваших лекциях.')).toBeInTheDocument();
    expect(screen.getByText('Отвечать будете на один вопрос: вопроса 2 нет в ваших лекциях.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать' }));
    expect(location).toBe('/exams/exam-1/ticket?q=q1&n=3&mode=exam');
  });

  it('in exam mode a ticket without answerable questions says so and offers only another ticket', async () => {
    mocks.loadExamBundle.mockResolvedValue(
      bundle([question(1, 'none'), question(2, 'none'), question(3, 'none'), question(4, 'none'), question(5, 'full')], {
        mode: 'fixed',
        per_ticket: 2,
        tickets: [
          { number: 5, question_ids: ['q1', 'q2'] },
          { number: 6, question_ids: ['q3', 'q4'] },
        ],
      }),
    );
    renderDraw();
    await screen.findByRole('article', { name: /^Билет [56]: вопросы (1 и 2|3 и 4)$/ });
    expect(mocks.prefetchRubric).not.toHaveBeenCalled();
    expect(screen.getByText(NO_ANSWERABLE_TICKET)).toBeInTheDocument();
    expect(NO_ANSWERABLE_TICKET).toBe('В этом билете нет вопросов из ваших лекций — ответ не с чем сверить.');
    const actions = document.querySelector('.dw-acts') as HTMLElement;
    expect(Array.from(actions.querySelectorAll('button, a')).map((item) => item.textContent)).toEqual(['Тянуть другой билет']);
    expect(screen.queryByRole('button', { name: 'Отвечать' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Тянуть ещё' })).toBeNull();
  });

  it('does not offer another ticket when the department has only this one: it would just turn over again', async () => {
    mocks.loadExamBundle.mockResolvedValue(
      bundle([question(1, 'none'), question(2, 'none'), question(3, 'full'), question(4, 'full')], {
        mode: 'fixed',
        per_ticket: 2,
        tickets: [{ number: 5, question_ids: ['q1', 'q2'] }],
      }),
    );
    renderDraw();
    await screen.findByRole('article', { name: 'Билет 5: вопросы 1 и 2' });
    expect(screen.getByText(NO_ANSWERABLE_TICKET)).toBeInTheDocument();
    const actions = document.querySelector('.dw-acts') as HTMLElement;
    expect(actions.querySelectorAll('button, a')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Тянуть другой/ })).toBeNull();
    // The way of drawing stays changeable right under the card.
    expect(screen.getByRole('button', { name: /изменить/ })).toBeInTheDocument();
  });

  it('keeps «Тянуть ещё» as the only action outside exam mode when every drawn question is missing from the lectures', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1, 'none')], { mode: 'random', per_ticket: 1 }));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1)]);
    renderDraw('/exams/exam-1/draw?mode=answered');
    await screen.findByRole('article', { name: 'Вопрос 1' });
    expect(mocks.prefetchRubric).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Отвечать' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Тянуть ещё' })).toBeInTheDocument();
    expect(screen.getByText(/Этого вопроса нет в ваших лекциях — оценить ответ не по чему/)).toBeInTheDocument();
    expect(screen.queryByText(NO_ANSWERABLE_TICKET)).toBeNull();
  });

  it('a single question without material in exam mode offers «Тянуть другой вопрос»', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1, 'none'), question(2, 'none')], { mode: 'random', per_ticket: 1 }));
    renderDraw();
    await screen.findByRole('article', { name: /^Вопрос [12]$/ });
    expect(screen.getByText('Этого вопроса нет в ваших лекциях — ответ не с чем сверить.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Тянуть другой вопрос' })).toHaveClass('sf-primary');
  });

  it('has no «Тянуть ещё» beside «Отвечать» in exam mode: the drawn ticket is the one to answer', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3)]));
    renderDraw();
    await screen.findByRole('article', { name: /Случайный билет/ });
    expect(screen.getByRole('button', { name: 'Отвечать' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Тянуть ещё' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Тянуть другой/ })).toBeNull();
  });

  it('says what each way of drawing takes its questions from, under the card', async () => {
    const list = [question(1), question(2), question(3, 'none'), question(4)];
    mocks.loadExamBundle.mockResolvedValue(bundle(list));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1), answer(2), answer(4, '2026-10-01'), answer(4, '2026-10-02')]);
    const pool = () => document.querySelector('.dw-pool')?.textContent?.replace(/\u00a0/g, ' ');
    const first = renderDraw();
    await screen.findByRole('article', { name: /Случайный билет/ });
    expect(pool()).toBe('Случайно из 4 вопросов.');
    first.unmount();
    const second = renderDraw('/exams/exam-1/draw?mode=weak');
    await screen.findByRole('article', { name: /Случайный билет/ });
    expect(pool()).toBe('Чаще слабые: из 3 вопросов, кроме тех, которых нет в лекциях.');
    second.unmount();
    const third = renderDraw('/exams/exam-1/draw?mode=answered');
    await screen.findByRole('article', { name: /Случайный билет/ });
    expect(pool()).toBe('Случайно из 3 вопросов, на которые вы уже отвечали.');
    // The card under the line comes first (the line is about the card).
    const card = screen.getByRole('article', { name: /Случайный билет/ });
    expect(card.compareDocumentPosition(document.querySelector('.dw-pool') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    third.unmount();
    mocks.loadExamBundle.mockResolvedValue(
      bundle(list, { mode: 'fixed', per_ticket: 2, tickets: [{ number: 7, question_ids: ['q1', 'q2'] }, { number: 8, question_ids: ['q3', 'q4'] }] }),
    );
    renderDraw();
    await screen.findByRole('article', { name: /^Билет [78]/ });
    expect(pool()).toBe('Как на экзамене: случайный билет из 2 билетов кафедры.');
  });

  it('numbers a card «Билет N» only for the department’s ticket, never for a random pair', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(12), question(31)]));
    const random = renderDraw();
    const card = await screen.findByRole('article', { name: 'Случайный билет: вопросы 12 и 31' });
    expect(card.querySelector('.dw-face:not(.dw-face-old) .dw-no')?.textContent?.replace(/\s+/g, ' ')).toBe('Случайный билет · вопросы 12 и 31');
    expect(card.textContent).not.toMatch(/Билет \d/);
    random.unmount();
    mocks.loadExamBundle.mockResolvedValue(bundle([question(12), question(31)], { mode: 'fixed', per_ticket: 2, tickets: [{ number: 7, question_ids: ['q12', 'q31'] }] }));
    renderDraw();
    const known = await screen.findByRole('article', { name: 'Билет 7: вопросы 12 и 31' });
    expect(known.querySelector('.dw-face:not(.dw-face-old) .dw-no b')?.textContent).toBe('Билет 7');
  });

  it('offers «Тянуть ещё» only when another ticket can come out', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3)]));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1), answer(2)]);
    // Two answered questions and two per ticket: the same pair every time.
    renderDraw('/exams/exam-1/draw?mode=answered');
    await screen.findByRole('article', { name: 'Случайный билет: вопросы 1 и 2' });
    expect(screen.getByRole('button', { name: 'Отвечать' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Тянуть ещё' })).toBeNull();
  });

  describe('«Ждут подтверждения»: the questions an answer can erase a cheat-sheet line of now (Сегодня-lite)', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    const dayOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const sheetQuestion = (n: number) => ({
      question_id: `q${n}`,
      position: n,
      label: String(n),
      section: null,
      text: `Вопрос номер ${n} о рынке`,
      question_hash: hash(n),
      coverage: 'full',
      coverage_method: 'llm',
      coverage_reason: '',
      missing_note: '',
      rebuilt: false,
      rubric: {
        rubric_id: `r${n}`,
        built_at: null,
        coverage: 'full',
        coverage_note: '',
        materials: [],
        points: [{ id: 'p1', title: `Пункт вопроса ${n}`, short: '', essential: true, source_quote: '', source_ids: [] }],
      },
    });
    /** Point 1 of question n named in an answer two days ago: its line is rubbed and can be erased now. */
    const namedPoint = (n: number): LearningEvent => ({
      id: `p-${n}`,
      created_at: twoDaysAgo.toISOString(),
      local_date: dayOf(twoDaysAgo),
      material_id: null,
      kind: 'oral_point',
      item_key: `oral:r${n}:p1`,
      correct: true,
      score: null,
      confidence: null,
      source_ids: [],
      session_id: `s${n}`,
      payload: { v: 1, question_hash: hash(n), rubric_id: `r${n}`, point_id: 'p1', title: `Пункт вопроса ${n}`, status: 'covered' },
    });
    const sheet = (questions: number[]) =>
      mocks.fetchSheet.mockResolvedValue({ examId: 'exam-1', mappingState: 'done', questions: questions.map(sheetQuestion), toWrite: 0, units: 0, job: null });

    it('draws from the questions whose line an answer erases now, by the sheet — whatever the last grade was', async () => {
      mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3)], { mode: 'random', per_ticket: 1 }));
      // Question 2's last answer named too little (readiness: not passed), but it named point 1 alone two
      // days ago: that line is rubbed, and an answer now erases it.
      mocks.fetchQuestionEvents.mockResolvedValue([{ ...answer(2, dayOf(twoDaysAgo), false), created_at: twoDaysAgo.toISOString() }]);
      sheet([1, 2]);
      mocks.fetchSheetEvents.mockResolvedValue([namedPoint(2)]);
      renderDraw('/exams/exam-1/draw?mode=awaiting');
      expect(await screen.findByRole('article', { name: 'Вопрос 2' })).toBeInTheDocument();
      expect(mocks.fetchSheet).toHaveBeenCalledWith('exam-1');
      expect(mocks.fetchSheetEvents).toHaveBeenCalledWith([hash(1), hash(2)]);
      expect(document.querySelector('.dw-pool')?.textContent).toBe('Единственный вопрос, который ждёт подтверждения.');
      expect(screen.getByText('Из вопросов с одним полным ответом')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Отвечать' }));
      expect(location).toBe('/exams/exam-1/ticket?q=q2');
    });

    it('says there are none when no line can be erased now, even after a good answer today', async () => {
      mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3)], { mode: 'random', per_ticket: 1 }));
      // The readiness rule would wait for question 2; its sheet line was named an hour ago and erases tomorrow.
      const hourAgo = new Date(Date.now() - 3_600_000);
      mocks.fetchQuestionEvents.mockResolvedValue([{ ...answer(2, dayOf(twoDaysAgo)), created_at: twoDaysAgo.toISOString() }]);
      sheet([1, 2]);
      mocks.fetchSheetEvents.mockResolvedValue([{ ...namedPoint(2), created_at: hourAgo.toISOString(), local_date: dayOf(hourAgo) }]);
      renderDraw('/exams/exam-1/draw?mode=awaiting');
      expect(await screen.findByText('Сейчас нет вопросов, которые ждут подтверждения. Выберите «Как на экзамене».')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Тянуть как на экзамене' })).toBeInTheDocument();
    });

    it('waits for the sheet before drawing, and falls back to the readiness rule when the sheet cannot be read', async () => {
      mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3)], { mode: 'random', per_ticket: 1 }));
      mocks.fetchQuestionEvents.mockResolvedValue([{ ...answer(3, dayOf(twoDaysAgo)), created_at: twoDaysAgo.toISOString() }]);
      let fail: (error: Error) => void = () => {};
      mocks.fetchSheet.mockReturnValue(new Promise((_, reject) => (fail = reject)));
      renderDraw('/exams/exam-1/draw?mode=awaiting');
      expect(await screen.findByText('Смотрим, какие строки шпаргалки можно стереть…')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Отвечать|Тянуть/ })).toBeNull();
      expect(screen.queryByRole('article', { name: /Вопрос/ })).toBeNull();
      fail(new Error('offline'));
      // Question 3 passed two days ago: the readiness rule waits for it.
      expect(await screen.findByRole('article', { name: 'Вопрос 3' })).toBeInTheDocument();
      expect(screen.getByText('Шпаргалка не загрузилась: тянем вопросы, где раньше названо достаточно.')).toBeInTheDocument();
    });
  });

  it('draws only from answered questions in that mode and says the mode under the actions', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3), question(4)], { mode: 'random', per_ticket: 1 }));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(3)]);
    renderDraw('/exams/exam-1/draw?mode=answered');
    const single = await screen.findByRole('article', { name: 'Вопрос 3' });
    // One question: the card's line is the one the answer screen's card will have, said once.
    expect(single.querySelector('.dw-face:not(.dw-face-old) .dw-no')?.textContent).toBe('Вопрос 3');
    expect(single.querySelector('.dw-face:not(.dw-face-old) .dw-q-n')).toBeNull();
    // The top line names the place; the way of drawing is the line under «Отвечать» (redesign critique 8).
    expect(document.querySelector('.sf-room-bar .dw-long')?.textContent).toBe('Микроэкономика · Тянуть вопрос');
    expect(document.querySelector('.sf-room-bar .dw-short')?.textContent).toBe('Тянуть вопрос');
    expect(screen.getByText('Из вопросов, на которые вы уже отвечали')).toBeInTheDocument();
  });

  it('is a single-object screen: the card, then «Отвечать» and «Тянуть ещё», then the way of drawing (redesign critique 8)', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3)]));
    renderDraw('/exams/exam-1/draw?mode=weak');
    const card = await screen.findByRole('article', { name: /Случайный билет/ });
    const center = document.querySelector('main.dw-room > .dw-center') as HTMLElement;
    expect(center.contains(card)).toBe(true);
    const answer = screen.getByRole('button', { name: 'Отвечать' });
    expect(center.contains(answer)).toBe(true);
    expect(screen.getByRole('button', { name: 'Тянуть ещё' }).closest('.dw-acts')).toBe(answer.closest('.dw-acts'));
    expect(card.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const mode = document.querySelector('.dw-mode .ex-draw-mode') as HTMLElement;
    expect(answer.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mode.textContent?.replace(/\s+/g, ' ')).toBe('Чаще слабые · изменить');
  });

  it('keeps the question numbers on a random pair: «Случайный билет · вопросы 1 и 2», each number hung beside its question', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    renderDraw();
    const card = await screen.findByRole('article', { name: 'Случайный билет: вопросы 1 и 2' });
    const face = card.querySelector('.dw-face:not(.dw-face-old)') as HTMLElement;
    expect(face.querySelector('.dw-no')?.textContent?.replace(/\s+/g, ' ')).toBe('Случайный билет · вопросы 1 и 2');
    expect(Array.from(face.querySelectorAll('.dw-q-n')).map((item) => item.textContent)).toEqual(['1', '2']);
  });

  it('turns over from the blank back, and «Тянуть ещё» from the last ticket: the old face is shown until the card is edge-on', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3), question(4), question(5)], { mode: 'random', per_ticket: 1 }));
    renderDraw('/exams/exam-1/draw?mode=weak');
    const first = await screen.findByRole('article', { name: /Вопрос \d/ });
    const firstLabel = first.getAttribute('aria-label');
    // The first draw turns the blank back over.
    const old = first.querySelector('.dw-face-old') as HTMLElement;
    expect(old).toHaveAttribute('aria-hidden', 'true');
    expect(old).toHaveTextContent('Билеты');
    fireEvent.click(screen.getByRole('button', { name: 'Тянуть ещё' }));
    const second = screen.getByRole('article', { name: /Вопрос \d/ });
    expect(second.getAttribute('aria-label')).not.toBe(firstLabel);
    // «Тянуть ещё»: the last ticket stays on the card until it is edge-on.
    expect(second.querySelector('.dw-face-old')).toHaveTextContent(`Вопрос номер ${firstLabel?.replace('Вопрос ', '')} о рынке`);
    expect(second.querySelector('.dw-face:not(.dw-face-old)')).toHaveTextContent(`Вопрос номер ${second.getAttribute('aria-label')?.replace('Вопрос ', '')} о рынке`);
  });

  it('changes the way of drawing on the draw page itself, and draws again', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3), question(4)], { mode: 'random', per_ticket: 1 }));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(2)]);
    renderDraw();
    await screen.findByRole('article', { name: /Вопрос \d/ });
    fireEvent.click(screen.getByRole('button', { name: 'изменить' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Из вопросов, на которые вы уже отвечали/ }));
    await waitFor(() => expect(location).toBe('/exams/exam-1/draw?mode=answered'));
    expect(await screen.findByRole('article', { name: 'Вопрос 2' })).toBeInTheDocument();
    expect(screen.getByText('Из вопросов, на которые вы уже отвечали')).toBeInTheDocument();
  });

  it('opens the menu of ways upward when the window has no room for it below the link', async () => {
    // Audit of 2026-10-08 at 1532×734: the menu ran 315 px under the window's edge.
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    renderDraw();
    await screen.findByRole('article', { name: /Случайный билет/ });
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 290 });
    vi.stubGlobal('innerHeight', 734);
    try {
      // The link low in the window: 82 px below it, 588 above.
      rect.mockReturnValue({ top: 600, bottom: 640, left: 0, right: 100, width: 100, height: 40, x: 0, y: 600, toJSON: () => ({}) } as DOMRect);
      fireEvent.click(screen.getByRole('button', { name: 'изменить' }));
      expect(screen.getByRole('menu', { name: 'Как тянуть билет' })).toHaveAttribute('data-up');
      fireEvent.keyDown(screen.getByRole('menu', { name: 'Как тянуть билет' }), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      // High in the window: it opens down as before.
      rect.mockReturnValue({ top: 120, bottom: 160, left: 0, right: 100, width: 100, height: 40, x: 0, y: 120, toJSON: () => ({}) } as DOMRect);
      fireEvent.click(screen.getByRole('button', { name: 'изменить' }));
      expect(screen.getByRole('menu', { name: 'Как тянуть билет' })).not.toHaveAttribute('data-up');
    } finally {
      if (height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
      else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
  });

  it('explains an empty answered pool and offers the exam mode', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    renderDraw('/exams/exam-1/draw?mode=answered');
    expect(await screen.findByText('Вы ещё не отвечали ни на один вопрос этого экзамена. Выберите «Как на экзамене».')).toBeInTheDocument();
    expect(document.querySelector('.dw-pool')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Тянуть как на экзамене' }));
    expect(await screen.findByRole('article', { name: /Случайный билет/ })).toBeInTheDocument();
    expect(location).toBe('/exams/exam-1/draw');
  });

  it('«Тянуть ещё» never repeats the last three tickets', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3), question(4), question(5)], { mode: 'random', per_ticket: 1 }));
    renderDraw('/exams/exam-1/draw?mode=weak');
    await screen.findByRole('article', { name: /Вопрос \d/ });
    const seen: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const card = screen.getByRole('article', { name: /Вопрос \d/ });
      seen.push(card.getAttribute('aria-label') ?? '');
      fireEvent.click(screen.getByRole('button', { name: 'Тянуть ещё' }));
    }
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen.slice(Math.max(0, i - 3), i)).not.toContain(seen[i]);
    }
    const stored = JSON.parse(window.sessionStorage.getItem('meldy_exam_last_tickets_exam-1') ?? '[]');
    expect(stored).toHaveLength(3);
  });

  it('reads the way of drawing from the address chosen on the sheet', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3)]));
    renderDraw('/exams/exam-1/draw?mode=weak');
    await screen.findByRole('article', { name: /Случайный билет/ });
    expect(document.querySelector('.sf-room-bar .dw-long')?.textContent).toBe('Микроэкономика · Тянуть билет');
    expect(screen.getByText('Чаще слабые')).toBeInTheDocument();
  });

  it('voices nothing (correction 7)', async () => {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    renderDraw();
    await screen.findByRole('article', { name: /Случайный билет/ });
    expect(speak).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('tts'))).toHaveLength(0);
  });

  it('lifts the top card, except under prefers-reduced-motion', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    const first = renderDraw();
    expect(await screen.findByRole('article', { name: /Случайный билет/ })).toHaveAttribute('data-state', 'lift');
    first.unmount();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    renderDraw();
    const card = await screen.findByRole('article', { name: /Случайный билет/ });
    // Reduced motion: no lift and no turn, only a 150 ms fade.
    expect(card).toHaveAttribute('data-state', 'fade');
  });

  it('keeps the way back to the sheet in the room bar and explains a missing exam', async () => {
    mocks.loadExamBundle.mockResolvedValue(null);
    renderDraw();
    expect(await screen.findByRole('heading', { name: 'Экзамен не найден' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Лист экзамена' })).toHaveAttribute('href', '/exams/exam-1');
  });

  it('still draws when the answer history could not be read', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    mocks.fetchQuestionEvents.mockRejectedValue(new Error('offline'));
    renderDraw();
    expect(await screen.findByText('История ответов не загрузилась: тянем без неё.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('article', { name: /Случайный билет/ })).toBeInTheDocument());
  });
});

describe('skippedNote', () => {
  it('names the questions that will not be answered', () => {
    expect(skippedNote(1, ['36'])).toBe('Отвечать будете на один вопрос: вопроса 36 нет в ваших лекциях.');
    expect(skippedNote(2, ['5', '9'])).toBe('Отвечать будете на 2 вопроса: вопросов 5, 9 нет в ваших лекциях.');
  });
});
