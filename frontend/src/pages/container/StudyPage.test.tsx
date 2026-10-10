import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AnswerInput, AnswerResult } from '../../types/container';
import type { ContainerData, Loadable } from '../../lib/containers/hooks';

const mocks = vi.hoisted(() => ({
  state: null as unknown,
  enqueue: vi.fn(),
  doubtKey: vi.fn(),
  updateItem: vi.fn(),
  fetchSheet: vi.fn(),
  recordSelfRating: vi.fn(),
  recordSheetPeek: vi.fn(),
  track: vi.fn(),
}));

vi.mock('../../lib/containers/hooks', () => ({ useContainerData: () => mocks.state }));
vi.mock('../../lib/containers/plan', async (original) => (await import('../../components/containers/testkit/engine')).planModule(original));
vi.mock('../../lib/containers/session', async (original) => (await import('../../components/containers/testkit/engine')).sessionModule(original));
vi.mock('../../lib/containers/answerQueue', () => ({ enqueueAnswers: mocks.enqueue }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../../lib/telemetry', () => ({ track: mocks.track }));
vi.mock('../../components/reminders/DailyReminder', () => ({ default: () => <button type="button">Напоминать каждый день</button> }));
vi.mock('../../components/telegram/TelegramCard', () => ({ TelegramRemindLink: ({ fallback }: { fallback?: React.ReactNode }) => <>{fallback}</> }));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  doubtKey: mocks.doubtKey,
  updateItem: mocks.updateItem,
}));
vi.mock('../../api/cheatSheet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cheatSheet')>()),
  fetchSheet: mocks.fetchSheet,
}));
vi.mock('../../api/learning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/learning')>()),
  recordSelfRating: mocks.recordSelfRating,
  recordSheetPeek: mocks.recordSheetPeek,
}));

import StudyPage from './StudyPage';
import { saveSession } from '../../components/containers/sessionStore';
import { GUIDE_LATER_KEY } from '../../components/guide/guideLater';
import {
  CONTAINER,
  ORAL_EXAM,
  SUBJECT_CS,
  SUBJECT_DB,
  SUBJECT_ORAL,
  containerData,
  dayPlan,
  dbItems,
  subject,
  summary,
} from '../../components/containers/testkit/fixtures';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const nm = (text: string) => (name: string) => plain(name) === text;
const page = () => plain(document.body.textContent);

function loaded(data: ContainerData): Loadable<ContainerData> {
  return { data, loading: false, offline: false, unavailable: false, error: null, reload: vi.fn() };
}

/** A plan whose «Базы данных» session takes these questions, in this order. */
function dataWith(ids: string[], over: Parameters<typeof containerData>[0] = {}): ContainerData {
  return containerData({
    plan: dayPlan({
      sessions: [
        { subjectId: SUBJECT_DB, kind: 'answer', ids, estSec: ids.length * 30 },
        { subjectId: SUBJECT_CS, kind: 'answer', ids: Array.from({ length: 20 }, (_, i) => `cs-${i}`), estSec: 540 },
      ],
    }),
    ...over,
  });
}

function Where() {
  const location = useLocation();
  return (
    <p data-testid="where" data-guide={(location.state as { guide?: boolean } | null)?.guide ? 'yes' : 'no'}>
      {`${location.pathname}${location.search}`}
    </p>
  );
}

function studyTree(search = `?s=${SUBJECT_DB}`) {
  return (
    <MemoryRouter initialEntries={[`/exams/c/${CONTAINER}/study${search}`]}>
      <Routes>
        <Route path="/exams/c/:id/study" element={<StudyPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderStudy(data: ContainerData, search = `?s=${SUBJECT_DB}`) {
  mocks.state = loaded(data);
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
  return render(studyTree(search));
}

const option = (text: string) => screen.getByRole('button', { name: new RegExp(text) });
const verdict = () => plain(document.querySelector('.ct-bar .ct-verdict')?.textContent);
const sent = (): AnswerInput[] => mocks.enqueue.mock.calls.flatMap((call) => call[1] as AnswerInput[]);

/** The server takes every answer and says its step. */
function serverSays(step: (input: AnswerInput) => AnswerResult['step']) {
  mocks.enqueue.mockImplementation(async (_user: string, answers: AnswerInput[]) =>
    answers.map((input) => ({ client_event_id: input.client_event_id, item_id: input.item_id, status: 'saved', correct: step(input) !== 'miss', step: step(input), rev: 1, state: null })),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  mocks.enqueue.mockResolvedValue([]);
  mocks.doubtKey.mockResolvedValue(undefined);
  mocks.updateItem.mockResolvedValue({ id: 'q-iso', rev: 2, rev_changed: true, doubts_resolved: 0 });
  mocks.recordSelfRating.mockResolvedValue(undefined);
  mocks.recordSheetPeek.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('one question at a time (Concept 1 §3.7, decisions 41–43)', () => {
  it('shows «1 из 5» on top, the subject above the question, the code as lines, and «Не знаю»', () => {
    renderStudy(dataWith(dbItems().map((entry) => entry.id)));
    const bar = screen.getByRole('banner');
    expect(plain(bar.textContent)).toContain('1 из 5');
    expect(within(bar).getByRole('button', { name: 'Закончить' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Какой уровень изоляции не допускает фантомного чтения?');
    expect(document.querySelector('.ct-ctx')?.textContent).toBe('Базы данных');
    expect(Array.from(document.querySelectorAll('.ct-code-line')).map((line) => line.textContent)).toEqual(['SET TRANSACTION ISOLATION LEVEL ...;']);
    expect(screen.getByRole('button', { name: 'Не знаю' })).toBeInTheDocument();
    // Before an answer a single choice needs no pill.
    expect(document.querySelector('.sf-primary')).toBeNull();
    expect(mocks.track).toHaveBeenCalledWith('container.session_started', { planned: 5, kind: 'plan' });
  });

  it('a wrong tap: the words on the options, the verdict in the bar above «Дальше», the row under the options; the answer leaves on «Дальше»', async () => {
    renderStudy(dataWith(dbItems().map((entry) => entry.id)));
    fireEvent.click(option('REPEATABLE READ'));
    // The key in the file's words (m2): the screen's letters are shuffled, the key panel and «Ключи» use the file's.
    expect(verdict()).toBe('Неверно. В файле — SERIALIZABLE. Вернётся через пару вопросов и завтра.');
    expect(screen.getByRole('status').closest('.ct-bar')).not.toBeNull();
    expect(plain(option('REPEATABLE READ').textContent)).toContain('Ваш ответ');
    expect(plain(option('SERIALIZABLE').textContent)).toContain('В файле');
    const under = document.querySelector('.ct-under')!;
    // The author — here a solo student, the author of their own exam — fixes the key; doubting it is a member's (n4).
    expect(within(under as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(['Нажали не туда?', 'Ключ неверный?']);
    expect(plain(document.querySelector('.ct-ctx')?.textContent)).toBe('Базы данных · № 37 · тема 3.2');
    expect(mocks.enqueue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
    const [answer] = sent();
    expect(answer).toMatchObject({ item_id: 'q-iso', chosen: 2, rev: 1, shown_order: [0, 1, 2, 3], mode: 'learn', cls: 'new_floor' });
    expect(answer.client_event_id).toMatch(/^[0-9a-f-]{36}:01$/);
    expect(answer.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(answer.local_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(answer.misclick).toBeUndefined();
    expect(answer.retry).toBeUndefined();
    expect(answer.ms).toBeGreaterThanOrEqual(0);
    expect(plain(screen.getByRole('banner').textContent)).toContain('2 из 5');
  });

  it('«Нажали не туда?» marks the answer as a misclick: no mistake, no retry in this session', async () => {
    renderStudy(dataWith(['q-iso', 'q-plain']));
    fireEvent.click(option('READ COMMITTED'));
    fireEvent.click(screen.getByRole('button', { name: 'Нажали не туда?' }));
    expect(verdict()).toBe('Ошибку не считаем. Ответ вы уже видели, поэтому вопрос вернётся завтра.');
    expect(screen.queryByRole('button', { name: 'Нажали не туда?' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(sent()[0]).toMatchObject({ item_id: 'q-iso', chosen: 1, misclick: true }));
    // The next is the plan's second question, and after it the session ends: no retry was added.
    expect(plain(screen.getByRole('banner').textContent)).toContain('2 из 2');
    fireEvent.click(option('Третья'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(page()).toContain('2 вопроса за 1 минуту');
  });

  it('a wrong answer comes back three questions later as «повтор, не в счёт», sent as a retry', async () => {
    renderStudy(dataWith(dbItems().map((entry) => entry.id)));
    fireEvent.click(option('READ UNCOMMITTED'));
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    // q-multi, q-short, q-code: «Не знаю» on each, then the retry of q-iso.
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    }
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Какой уровень изоляции не допускает фантомного чтения?');
    expect(plain(document.querySelector('.ct-ctx')?.textContent)).toBe('Базы данных · повтор, не в счёт');
    // The counter stays on the planned questions.
    expect(plain(screen.getByRole('banner').textContent)).toContain('4 из 5');
    fireEvent.click(option('SERIALIZABLE'));
    expect(verdict()).toBe('Верно.');
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(sent()).toHaveLength(5));
    expect(sent()[4]).toMatchObject({ item_id: 'q-iso', chosen: 3, retry: true });
  });

  it('«Не знаю» shows the key and sends no choice', async () => {
    renderStudy(dataWith(['q-iso']));
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(verdict()).toBe('В файле — SERIALIZABLE. Вернётся через пару вопросов и завтра.');
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(sent()[0]).toMatchObject({ item_id: 'q-iso', chosen: null }));
  });

  it('a right answer moves on by itself after a second; a tap in that second holds it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderStudy(dataWith(['q-iso', 'q-plain', 'q-code']));
    fireEvent.click(option('SERIALIZABLE'));
    expect(verdict()).toBe('Верно.');
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Какая нормальная форма требует отсутствия транзитивных зависимостей?');
    expect(sent()[0]).toMatchObject({ item_id: 'q-iso', chosen: 3 });
    // A tap that comes within 300 ms of the move answers nothing.
    fireEvent.click(option('Третья'));
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.click(option('Третья'));
    fireEvent.pointerDown(document.querySelector('main')!);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    // Held: still on the question, with «Дальше».
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Какая нормальная форма требует отсутствия транзитивных зависимостей?');
    expect(page()).toContain('В файле ответ не был выделен — ключ поставили вы.');
    expect(screen.getByRole('button', { name: 'Дальше' })).toBeInTheDocument();
  });

  it('several correct: the line in ink above the options, ticks, «Ответить», all or nothing', async () => {
    renderStudy(dataWith(['q-multi']));
    expect(page()).toContain('Верных ответов несколько — отметьте все.');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    expect(screen.getByRole('alert').textContent).toBe('Отметьте хотя бы один вариант.');
    fireEvent.click(option('CREATE'));
    fireEvent.click(option('ALTER'));
    fireEvent.click(option('DROP'));
    expect(option('ALTER').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    expect(verdict()).toBe('Верно: все 3.');
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(sent()[0]).toMatchObject({ item_id: 'q-multi', chosen: [0, 2, 3] }));
  });

  it('several correct, not all ticked: «Неверно. В файле верны: CREATE, ALTER и DROP.», the letters shown beside the boxes', () => {
    renderStudy(dataWith(['q-multi']));
    // «☐ А CREATE» (Concept 1 §3.7): the letters stay beside the boxes; the verdict names the options by their words.
    expect(Array.from(document.querySelectorAll('.ct-opt[data-multi] .ct-opt-l')).map((node) => node.textContent)).toEqual(['А', 'Б', 'В', 'Г', 'Д']);
    fireEvent.click(option('CREATE'));
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    expect(verdict()).toBe('Неверно. В файле верны: CREATE, ALTER и DROP. Вернётся через пару вопросов и завтра.');
  });

  it('a short answer: the field, «Ответить», the file’s form compared without case', async () => {
    renderStudy(dataWith(['q-short', 'q-plain']));
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    expect(screen.getByRole('alert').textContent).toBe('Впишите ответ.');
    fireEvent.change(screen.getByLabelText('Ваш ответ'), { target: { value: 'commit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    expect(verdict()).toBe('Неверно. В файле — ROLLBACK. Вернётся через пару вопросов и завтра.');
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(sent()[0]).toMatchObject({ item_id: 'q-short', text: 'commit' }));
    expect(sent()[0].shown_order).toBeUndefined();
  });

  it('code: the question’s words, then each source line on its own line', () => {
    renderStudy(dataWith(['q-code']));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Что выведет программа?');
    expect(Array.from(document.querySelectorAll('.ct-code-line')).map((line) => line.textContent)).toEqual([
      'int a = 7;',
      'int b = 2;',
      'double c = a / b;',
      'Console.WriteLine(c); // целочисленное деление выполняется до приведения к double',
    ]);
  });

  it('keys on a computer: 1–8 answer, Backspace «Нажали не туда?», Enter «Дальше», 0 «Не знаю», letters too', async () => {
    renderStudy(dataWith(['q-iso', 'q-multi', 'q-plain']));
    expect(page()).toContain('1–8 — ответ · 0 — не знаю · Enter — дальше · Backspace — нажали не туда');
    fireEvent.keyDown(window, { key: '3' });
    expect(verdict()).toBe('Неверно. В файле — SERIALIZABLE. Вернётся через пару вопросов и завтра.');
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(verdict()).toBe('Ошибку не считаем. Ответ вы уже видели, поэтому вопрос вернётся завтра.');
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(sent()[0]).toMatchObject({ item_id: 'q-iso', chosen: 2, misclick: true }));
    // Several correct: the keys tick, Enter answers.
    fireEvent.keyDown(window, { key: '1' });
    fireEvent.keyDown(window, { key: 'В' });
    fireEvent.keyDown(window, { key: '4' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(verdict()).toBe('Верно: все 3.');
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: '0' });
    expect(verdict()).toBe('В файле — Третья. Вернётся через пару вопросов и завтра.');
  });
});

describe('keys in doubt (decisions 14, 37)', () => {
  it('the author fixes the key in place, in the file’s order; the answer under the old key is not sent', async () => {
    renderStudy(dataWith(['q-iso', 'q-plain']));
    fireEvent.click(option('REPEATABLE READ'));
    fireEvent.click(screen.getByRole('button', { name: 'Ключ неверный?' }));
    const panel = screen.getByRole('region', { name: 'Ключ неверный?' });
    expect(plain(panel.textContent)).toContain('Сверьте № 37 в файле. Там другой ответ? Нажмите его.');
    fireEvent.click(within(panel).getByRole('button', { name: /REPEATABLE READ/ }));
    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalledWith('q-iso', { correct: [2] }));
    expect(within(panel).getByRole('status').textContent).toBe('Ключ изменён. Счёт по этому вопросу начнётся заново.');
    // The panel says the key changed; the answer is not sent, so neither «Нажали не туда?» nor a doubt is offered for it.
    expect(verdict()).toBe('Этот ответ в счёт не идёт.');
    expect(screen.queryByRole('button', { name: 'Нажали не туда?' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сомневаюсь в ключе' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Какая нормальная форма требует отсутствия транзитивных зависимостей?');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('a member doubts the key: a comment, the question set aside, its retry dropped', async () => {
    const data = dataWith(['q-iso', 'q-plain', 'q-multi'], { summary: summary({ role: 'member', owner: null }) });
    renderStudy(data);
    fireEvent.click(option('REPEATABLE READ'));
    expect(screen.queryByRole('button', { name: 'Ключ неверный?' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Сомневаюсь в ключе' }));
    const sheet = screen.getByRole('dialog', { name: nm('Сомневаюсь в ключе · № 37') });
    expect(sheet.textContent).toContain('Автор увидит число отметок и комментарии, но не имена.');
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'В лекции сказано иначе' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Отметить' }));
    await waitFor(() => expect(mocks.doubtKey).toHaveBeenCalledWith('q-iso', [2], 'В лекции сказано иначе'));
    expect(within(sheet).getByRole('status').textContent).toBe('Отложено. Когда автор ответит, вопрос вернётся в занятия.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Дальше' }));
    expect(screen.queryByRole('button', { name: 'Сомневаюсь в ключе' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(sent()[0]).toMatchObject({ item_id: 'q-iso', chosen: 2 }));
    fireEvent.click(option('Третья'));
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    fireEvent.click(option('CREATE'));
    fireEvent.click(option('ALTER'));
    fireEvent.click(option('DROP'));
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    // No retry of the set-aside question: the session ended after the three planned ones.
    await waitFor(() => expect(plain(screen.getByRole('heading', { level: 1 }).textContent)).toBe('3 вопроса за 1 минуту'));
    expect(sent().map((answer) => answer.item_id)).toEqual(['q-iso', 'q-plain', 'q-multi']);
  });
});

describe('the end of a session (decision 49)', () => {
  it('leads with the figure’s change, one muted paragraph, what is left today, and the next session', async () => {
    serverSays((input) => (input.item_id === 'q-plain' ? 'two_days' : 'miss'));
    renderStudy(dataWith(['q-plain', 'q-iso']));
    fireEvent.click(option('Третья'));
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    fireEvent.click(option('READ COMMITTED'));
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    // The retry of q-iso comes at the end of so short a session.
    fireEvent.click(option('SERIALIZABLE'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    await waitFor(() => expect(plain(screen.getByRole('heading', { level: 1 }).textContent)).toBe('Теперь 144 из 960 — верно в два разных дня'));
    const paragraph = plain(document.querySelector('.ct-end-p')?.textContent);
    expect(paragraph).toContain('2 вопроса и 1 повтор за 1 минуту.');
    expect(paragraph).toContain('Верно с первого раза — 1 из 2.');
    expect(paragraph).toContain('1 ошибка вернётся завтра.');
    expect(page()).not.toMatch(/засчит/i);
    expect(page()).toContain('Сегодня осталось 20 вопросов, около 9 минут.');
    expect(screen.getByRole('link', { name: nm('Дальше: Программирование на C# — 20 вопросов') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_CS}`);
    expect(screen.getByRole('button', { name: 'Напоминать каждый день' })).toBeInTheDocument();
    expect(mocks.track).toHaveBeenCalledWith('container.session_finished', { answered: 2, retries: 1, minutes: 1 });
    // «Готово» goes back to the exam.
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.getByTestId('where').textContent).toBe(`/exams/c/${CONTAINER}`);
  });

  it('the plan read again after the session does not change the screen being read (M1)', async () => {
    const view = renderStudy(dataWith(['q-plain']));
    fireEvent.click(option('Третья'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    const screenNow = () => ({
      left: plain(document.querySelector('.ct-end-next')?.textContent),
      pill: plain(document.querySelector('.ct-bar .sf-primary')?.textContent),
      links: Array.from(document.querySelectorAll('.ct-end-links a, .ct-end-links button')).map((node) => plain(node.textContent)),
    });
    const first = screenNow();
    expect(first.left).toBe('Сегодня осталось 20 вопросов, около 9 минут.');
    expect(first.pill).toBe('Дальше: Программирование на C# — 20 вопросов');
    // StudyPage's reload (onEnded) brings the plan read again: here one refitted the old way — more questions left,
    // «Базы данных» first. The end screen keeps what it said when it opened.
    mocks.state = loaded(
      containerData({
        plan: dayPlan({
          sessions: [
            { subjectId: SUBJECT_DB, kind: 'answer', ids: ['q-iso', 'q-code', 'q-multi', 'q-short', 'x1', 'x2', 'x3'], estSec: 420 },
            { subjectId: SUBJECT_CS, kind: 'answer', ids: Array.from({ length: 20 }, (_, i) => `cs-${i}`), estSec: 540 },
          ],
        }),
      }),
    );
    view.rerender(studyTree());
    await act(async () => undefined);
    expect(screenNow()).toEqual(first);
  });

  it('when the figure did not move, the headline is the session’s count and time', async () => {
    renderStudy(dataWith(['q-plain']));
    fireEvent.click(option('Третья'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    expect(plain(screen.getByRole('heading', { level: 1 }).textContent)).toBe('1 вопрос за 1 минуту');
  });

  it('after the first session of a student who came to load a file, «Готово» opens the guide (decision 33)', async () => {
    window.sessionStorage.setItem(GUIDE_LATER_KEY, '1');
    renderStudy(dataWith(['q-plain']));
    fireEvent.click(option('Третья'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Готово' })[0]);
    expect(screen.getByTestId('where').textContent).toBe(`/exams/c/${CONTAINER}`);
    expect(screen.getByTestId('where').dataset.guide).toBe('yes');
  });

  it('«Закончить» in the middle sends the answer on screen and ends', async () => {
    renderStudy(dataWith(['q-iso', 'q-plain', 'q-code']));
    fireEvent.click(option('SERIALIZABLE'));
    fireEvent.click(screen.getByRole('button', { name: 'Закончить' }));
    await waitFor(() => expect(sent()[0]).toMatchObject({ item_id: 'q-iso', chosen: 3 }));
    expect(plain(screen.getByRole('heading', { level: 1 }).textContent)).toBe('1 вопрос за 1 минуту');
  });
});

describe('a session picked up, and blocks outside the plan', () => {
  it('«Продолжить» picks the session up where it stopped, on the same day', () => {
    saveSession('user-1', {
      v: 1,
      id: '0b6f3c2e-9a1d-4e7b-8c5a-2d4e6f8a0b1c',
      containerId: CONTAINER,
      day: '2026-10-10',
      subjectId: SUBJECT_DB,
      kind: 'answer',
      topic: null,
      only: null,
      queue: dbItems().map((entry) => ({ id: entry.id, retry: 0 as const })),
      pos: 2,
      startedAt: Date.now() - 120_000,
      records: [],
    });
    renderStudy(dataWith([]), '?resume=1');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Впишите ключевое слово, которое отменяет транзакцию.');
    expect(plain(screen.getByRole('banner').textContent)).toContain('3 из 5');
  });

  it('no errors to go over: one line and the way back', () => {
    renderStudy(dataWith([]), `?s=${SUBJECT_DB}&only=errors`);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ошибок сейчас нет.');
    expect(screen.getByRole('link', { name: 'Вернуться к экзамену' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}`);
  });

  it('a topic’s block takes its questions', () => {
    renderStudy(dataWith([]), `?s=${SUBJECT_DB}&topic=2&back=s`);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Какой уровень изоляции не допускает фантомного чтения?');
    expect(plain(screen.getByRole('banner').textContent)).toContain('1 из 1');
    fireEvent.click(screen.getByRole('button', { name: 'Закончить' }));
    expect(screen.getByTestId('where').textContent).toBe(`/exams/c/${CONTAINER}/s/${SUBJECT_DB}`);
  });
});

describe('an oral self-check (decisions 19, 51)', () => {
  const sheet = {
    examId: ORAL_EXAM,
    mappingState: 'done',
    toWrite: 0,
    units: 0,
    unwritable: 0,
    job: null,
    questions: [
      {
        question_id: '11111111-1111-4111-8111-111111111111',
        position: 17,
        label: '17',
        section: null,
        text: 'Понятие и виды сделок.',
        question_hash: 'a'.repeat(32),
        coverage: 'full' as const,
        coverage_method: 'llm' as const,
        coverage_reason: '',
        missing_note: '',
        rubric: {
          rubric_id: '22222222-2222-4222-8222-222222222222',
          built_at: null,
          coverage: 'full' as const,
          coverage_note: '',
          materials: [],
          points: [
            { id: 'p1', title: 'Сделка — действие, которое создаёт, меняет или прекращает права', short: 'сделка: создаёт, меняет, прекращает права', essential: true, source_quote: '', source_ids: [] },
            { id: 'p2', title: 'Виды: односторонние, двух- и многосторонние', short: '', essential: false, source_quote: '', source_ids: [] },
          ],
        },
      },
      {
        question_id: '33333333-3333-4333-8333-333333333333',
        position: 18,
        label: '18',
        section: null,
        text: 'Форма сделки.',
        question_hash: 'b'.repeat(32),
        coverage: 'none' as const,
        coverage_method: 'llm' as const,
        coverage_reason: '',
        missing_note: '',
        rubric: null,
      },
    ],
  };

  it('recall, then the points (a peek of each line), then «Знаю · Плаваю · Не знаю» as the existing self_rating; no AI link', async () => {
    mocks.fetchSheet.mockResolvedValue(sheet);
    const base = summary({ subjects: [...summary().subjects, subject({ id: SUBJECT_ORAL, title: 'Гражданское право', keyed: 0, topics: [], oral: { exam_id: ORAL_EXAM, questions: 2 } })] });
    const data = containerData({
      summary: base,
      plan: dayPlan({ sessions: [{ subjectId: SUBJECT_ORAL, kind: 'self_check', ids: sheet.questions.map((q) => q.question_id), estSec: 120 }] }),
    });
    // An oral subject's session is a self-check even when the link does not say so.
    renderStudy(data, `?s=${SUBJECT_ORAL}`);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Понятие и виды сделок.'));
    expect(plain(screen.getByRole('banner').textContent)).toContain('1 из 2');
    expect(plain(document.querySelector('.ct-ctx')?.textContent)).toBe('Гражданское право · устно');
    expect(page()).toContain('Вспомните ответ — вслух или про себя.');
    expect(page()).not.toMatch(/проверкой Meldy/);
    fireEvent.click(screen.getByRole('button', { name: 'Показать пункты' }));
    expect(mocks.recordSheetPeek).toHaveBeenCalledTimes(2);
    expect(mocks.recordSheetPeek).toHaveBeenCalledWith(expect.objectContaining({ questionHash: 'a'.repeat(32), pointId: 'p1', examId: ORAL_EXAM }));
    const points = screen.getByRole('region', { name: 'Пункты из ваших лекций' });
    expect(within(points).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['сделка: создаёт, меняет, прекращает права', 'Виды: односторонние, двух- и многосторонние']);
    expect(page()).toContain('Самопроверка в счёт не идёт: она решает, когда вопрос вернётся.');
    fireEvent.click(screen.getByRole('button', { name: 'Знаю' }));
    await waitFor(() => expect(mocks.recordSelfRating).toHaveBeenCalledWith(expect.objectContaining({ questionHash: 'a'.repeat(32), rating: 'know', examId: ORAL_EXAM, examQuestionId: sheet.questions[0].question_id })));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Форма сделки.'));
    fireEvent.click(screen.getByRole('button', { name: 'Показать пункты' }));
    expect(page()).toContain('Пунктов пока нет: к предмету не добавлены лекции.');
    fireEvent.click(screen.getByRole('button', { name: 'Плаваю' }));
    await waitFor(() => expect(plain(screen.getByRole('heading', { level: 1 }).textContent)).toBe('2 вопроса за 1 минуту'));
    expect(plain(document.querySelector('.ct-end-p')?.textContent)).toContain('«Знаю» — 1 · «плаваю» — 1 · «не знаю» — 0.');
    // Both questions were rated: nothing of this session is offered again today, the pill is «Готово».
    expect(screen.queryByRole('link', { name: (name) => plain(name).startsWith('Ещё 1 вопрос') })).toBeNull();
    expect(document.querySelector('.ct-bar .sf-primary')?.textContent).toBe('Готово');
  });
});
