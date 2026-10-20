import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AnswerInput, AnswerResult, AnswerState, PlanInput, PlanItem } from '../../types/container';
import type { ContainerData, Loadable } from '../../lib/containers/hooks';

const mocks = vi.hoisted(() => ({
  state: null as unknown,
  listeners: new Set<() => void>(),
  /** One per rendered page: a reading still on its way from an earlier test never reaches this one. */
  round: 0,
  enqueue: vi.fn(),
  doubtKey: vi.fn(),
  updateItem: vi.fn(),
  fetchSheet: vi.fn(),
  recordSelfRating: vi.fn(),
  recordSheetPeek: vi.fn(),
  track: vi.fn(),
}));

// The exam's data as useContainerData gives it: StudyPage renders again when it changes (a reload brought a reading).
vi.mock('../../lib/containers/hooks', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => {
      mocks.listeners.delete(listener);
    };
  };
  return { useContainerData: () => useSyncExternalStore(subscribe, () => mocks.state) };
});
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
import { LEFT_WAIT } from '../../components/containers/SessionEnd';
import { firstCountText, titleText } from '../../components/containers/planLines';
import { planDay } from '../../lib/containers/plan';
import { emptyState } from '../../lib/containers/rule';
import { at, testItems } from '../../lib/containers/__fixtures__/scenarios';
import { classOf, inputAt, newServer, record } from '../../lib/containers/__fixtures__/server';
import { sqlStep } from '../../lib/containers/__fixtures__/sqlRule';
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
  item,
  planItemsFor,
  subject,
  summary,
  unit,
} from '../../components/containers/testkit/fixtures';
import { errorCount } from '../../components/containers/model';
import { startMiniApp, stopMiniApp } from '../../test/telegramWebApp';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const nm = (text: string) => (name: string) => plain(name) === text;
const page = () => plain(document.body.textContent);

/**
 * The exam on the page. Its reload (StudyPage's, after a session) reads it again, as the network would, a moment later:
 * `reread` gives what that reading brings, and the page renders it; without `reread` the reading never comes.
 */
function loaded(data: ContainerData, reread?: () => ContainerData): Loadable<ContainerData> {
  const reload = vi.fn(() => {
    if (reread) {
      const next = loaded(reread(), reread);
      const round = mocks.round;
      window.setTimeout(() => {
        if (mocks.round === round) act(() => show(next));
      }, 5);
    }
  });
  return { data, loading: false, offline: false, unavailable: false, error: null, reload };
}

/** The hook's answer changes: the page renders it. */
function show(state: Loadable<ContainerData>) {
  mocks.state = state;
  for (const listener of [...mocks.listeners]) listener();
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

function renderStudy(data: ContainerData, search = `?s=${SUBJECT_DB}`, reread?: () => ContainerData) {
  mocks.round += 1;
  mocks.state = loaded(data, reread);
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
  return render(studyTree(search));
}

const option = (text: string) => screen.getByRole('button', { name: new RegExp(text) });
/** The end screen's «what is left today», its pill and its links. */
const leftLine = () => plain(document.querySelector('.ct-end-next')?.textContent);
const screenNow = () => ({
  left: leftLine(),
  pill: plain(document.querySelector('.ct-bar .sf-primary')?.textContent),
  links: Array.from(document.querySelectorAll('.ct-end-links a, .ct-end-links button')).map((node) => plain(node.textContent)),
});
/** The exam read again after a session of «Базы данных»: «Программирование на C#» left — 20 questions, 9 minutes. */
const csLeft = () =>
  containerData({
    plan: dayPlan({
      sessions: [{ subjectId: SUBJECT_CS, kind: 'answer', ids: Array.from({ length: 20 }, (_, i) => `cs-${i}`), estSec: 540 }],
      counts: { ...dayPlan().counts, newItems: 0, reviews: 20, estSec: 600, leftSec: 540 },
    }),
  });
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
  LEFT_WAIT.ms = 1500;
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

  it('a key the author set (a test from «Конструктор», a key ticked in «Ключи») is no file’s: «Верный ответ» (release 47, M10)', () => {
    renderStudy(dataWith(['q-plain']));
    fireEvent.click(option('Первая'));
    expect(verdict()).toBe('Неверно. Верный ответ — Третья. Вернётся через пару вопросов и завтра.');
    expect(plain(option('Третья').textContent)).toContain('Верный ответ');
    expect(plain(option('Третья').textContent)).not.toContain('В файле');
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

  it('inside Telegram the phone answers too: success on a right answer, error on a wrong one, warning on «Не знаю»', async () => {
    const webApp = await startMiniApp();
    try {
      renderStudy(dataWith(['q-iso', 'q-plain', 'q-code']));
      fireEvent.click(option('REPEATABLE READ'));
      expect(webApp.HapticFeedback.notificationOccurred).toHaveBeenLastCalledWith('error');
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
      fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
      expect(webApp.HapticFeedback.notificationOccurred).toHaveBeenLastCalledWith('warning');
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
      // q-code, then the retry of q-iso: «Не знаю», then the right answer.
      fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
      fireEvent.click(option('SERIALIZABLE'));
      expect(verdict()).toBe('Верно.');
      expect(webApp.HapticFeedback.notificationOccurred).toHaveBeenLastCalledWith('success');
      expect(webApp.HapticFeedback.notificationOccurred).toHaveBeenCalledTimes(4);
    } finally {
      stopMiniApp();
    }
  });

  it('outside Telegram an answer touches no Telegram API', () => {
    renderStudy(dataWith(['q-iso']));
    fireEvent.click(option('SERIALIZABLE'));
    expect(verdict()).toBe('Верно.');
    expect(window.Telegram).toBeUndefined();
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
    // q-plain's key was set by the author (key_source 'manual'): no file says it (release 47, M10).
    expect(verdict()).toBe('Верный ответ — Третья. Вернётся через пару вопросов и завтра.');
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
    // What is left is the exam's plan read again after the session: «Базы данных» done, «Программирование на C#» left.
    renderStudy(dataWith(['q-plain', 'q-iso']), `?s=${SUBJECT_DB}`, csLeft);
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
    await waitFor(() => expect(leftLine()).toBe('Сегодня осталось 20 вопросов, около 9 минут.'));
    expect(screen.getByRole('link', { name: nm('Дальше: Программирование на C# — 20 вопросов') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_CS}`);
    expect(screen.getByRole('button', { name: 'Напоминать каждый день' })).toBeInTheDocument();
    expect(mocks.track).toHaveBeenCalledWith('container.session_finished', { answered: 2, retries: 1, minutes: 1 });
    // «Готово» goes back to the exam.
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.getByTestId('where').textContent).toBe(`/exams/c/${CONTAINER}`);
  });

  it('what comes back after today comes back on a study day: with Sunday off, «вернётся в понедельник»', async () => {
    serverSays(() => 'miss');
    renderStudy(dataWith(['q-iso'], { input: { studyWeekdays: 63 } })); // Пн–Сб: today is Saturday 10 October
    fireEvent.click(option('READ COMMITTED'));
    expect(verdict()).toBe('Неверно. В файле — SERIALIZABLE. Вернётся через пару вопросов и в понедельник.');
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    fireEvent.click(option('SERIALIZABLE'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    await waitFor(() => expect(document.querySelector('.ct-end-p')).not.toBeNull());
    expect(plain(document.querySelector('.ct-end-p')?.textContent)).toContain('1 ошибка вернётся в понедельник.');
  });

  it('on Friday before a day off the session and its end name the next study day, not «завтра»', async () => {
    serverSays((input) => (input.item_id === 'q-plain' ? 'start' : 'miss'));
    // Friday 9 October: the plan's day and the input's clock; Saturday off (every day but Saturday).
    const friday = (ids: string[], studyWeekdays: number) => containerData({
      plan: dayPlan({ day: '2026-10-09', sessions: [{ subjectId: SUBJECT_DB, kind: 'answer', ids, estSec: ids.length * 30 }] }),
      input: { now: Date.parse('2026-10-09T18:00:00+03:00'), studyWeekdays },
    });
    const view = renderStudy(friday(['q-iso', 'q-short', 'q-plain'], 127 - 32));
    // A wrong tap, then «Нажали не туда?»: no mistake, the question still comes back.
    fireEvent.click(option('READ COMMITTED'));
    expect(verdict()).toBe('Неверно. В файле — SERIALIZABLE. Вернётся через пару вопросов и в воскресенье.');
    fireEvent.click(screen.getByRole('button', { name: 'Нажали не туда?' }));
    expect(verdict()).toBe('Ошибку не считаем. Ответ вы уже видели, поэтому вопрос вернётся в воскресенье.');
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    // «Не знаю» on a short answer: the one mistake of the session.
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(verdict()).toBe('В файле — ROLLBACK. Вернётся через пару вопросов и в воскресенье.');
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    fireEvent.click(option('Третья'));
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    // Its retry, right: the session ends.
    fireEvent.change(screen.getByLabelText('Ваш ответ'), { target: { value: 'rollback' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    await waitFor(() => expect(document.querySelector('.ct-end-p')).not.toBeNull());
    expect(plain(document.querySelector('.ct-end-p')?.textContent)).toContain('1 ошибка вернётся в воскресенье.');
    // Saturday and Sunday off: Monday.
    view.unmount();
    window.localStorage.clear();
    renderStudy(friday(['q-iso'], 31));
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(verdict()).toBe('В файле — SERIALIZABLE. Вернётся через пару вопросов и в понедельник.');
  });

  it('what is left comes from the plan read once the session’s answers have left: held in its place till then, never changed after (M1, D2)', async () => {
    // The answer stays on its way until the test lets it go.
    let arrive: () => void = () => undefined;
    mocks.enqueue.mockImplementation(
      (_user: string, answers: AnswerInput[]) =>
        new Promise((resolve) => {
          arrive = () => resolve(answers.map((input) => ({ client_event_id: input.client_event_id, item_id: input.item_id, status: 'saved', correct: true, step: 'start', rev: 1, state: null })));
        }),
    );
    // A later reading, refitted the old way: more questions left, «Базы данных» first.
    const refitted = () =>
      containerData({
        plan: dayPlan({
          sessions: [
            { subjectId: SUBJECT_DB, kind: 'answer', ids: ['q-iso', 'q-code', 'q-multi', 'q-short', 'x1', 'x2', 'x3'], estSec: 420 },
            { subjectId: SUBJECT_CS, kind: 'answer', ids: Array.from({ length: 20 }, (_, i) => `cs-${i}`), estSec: 540 },
          ],
          counts: { ...dayPlan().counts, newItems: 0, reviews: 27, estSec: 1020, leftSec: 960 },
        }),
      });
    renderStudy(dataWith(['q-plain']), `?s=${SUBJECT_DB}`, csLeft);
    const reload = (mocks.state as Loadable<ContainerData>).reload;
    fireEvent.click(option('Третья'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    // The answer has not left yet: nothing is read again; what is left keeps its place, unseen and out of reach.
    expect(reload).not.toHaveBeenCalled();
    const held = document.querySelector('.ct-end-next') as HTMLElement;
    expect(held).toHaveAttribute('aria-hidden', 'true');
    expect(held.style.visibility).toBe('hidden');
    expect((document.querySelector('.ct-bar-row') as HTMLElement).style.visibility).toBe('hidden');
    expect(screen.queryByRole('link', { name: (name) => plain(name).startsWith('Дальше:') })).toBeNull();
    // It has left: the plan is read again, and its numbers appear in the same place.
    await act(async () => arrive());
    await waitFor(() => expect(screen.getByRole('link', { name: nm('Дальше: Программирование на C# — 20 вопросов') })).toBeInTheDocument());
    expect(reload).toHaveBeenCalledTimes(1);
    const line = document.querySelector('.ct-end-next') as HTMLElement;
    expect(line).toBe(held);
    expect(line).not.toHaveAttribute('aria-hidden');
    expect(line.style.visibility).toBe('');
    const first = screenNow();
    expect(first.left).toBe('Сегодня осталось 20 вопросов, около 9 минут.');
    expect(first.pill).toBe('Дальше: Программирование на C# — 20 вопросов');
    // A later reading of the plan does not change the screen being read.
    act(() => show(loaded(refitted())));
    await act(async () => undefined);
    expect(screenNow()).toEqual(first);
  });

  /**
   * The live re-check of 2026-10-11: the headline said «Теперь 5 из 960» and, half a second later, «Теперь 6 из 960» —
   * the last answer's result came after the screen opened. Here the session's only counted question is its last answer:
   * «2 вопроса за 1 минуту» would turn into «Теперь 144 из 960 …» under the finger.
   */
  function lastResultLate() {
    const late: Array<() => void> = [];
    mocks.enqueue.mockImplementation((_user: string, answers: AnswerInput[]) => {
      const results = answers.map((input) => ({ client_event_id: input.client_event_id, item_id: input.item_id, status: 'saved', correct: true, step: input.item_id === 'q-plain' ? 'two_days' : 'start', rev: 1, state: null }));
      return answers.some((input) => input.item_id === 'q-plain') ? new Promise((resolve) => late.push(() => resolve(results))) : Promise.resolve(results);
    });
    renderStudy(dataWith(['q-iso', 'q-plain']));
    return late;
  }

  async function answerBoth() {
    fireEvent.click(option('SERIALIZABLE'));
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    fireEvent.click(option('Третья'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
  }

  it('the headline says the server’s figure once the session’s answers have all come back: a result inside the hold is said, and the headline takes the focus then', async () => {
    const late = lastResultLate();
    await answerBoth();
    // The last result is on its way: the headline and the paragraph keep their place, unseen, and nothing has the focus.
    const heading = document.querySelector('h1.ct-end-h') as HTMLElement;
    expect(heading).toHaveAttribute('aria-hidden', 'true');
    expect(heading.style.visibility).toBe('hidden');
    expect((document.querySelector('.ct-end-p') as HTMLElement).style.visibility).toBe('hidden');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(document.activeElement).not.toBe(heading);
    // It comes: the headline says it the first time it is seen, and takes the focus.
    await act(async () => {
      for (const go of late.splice(0)) go();
    });
    const shown = await screen.findByRole('heading', { level: 1 });
    expect(shown).toBe(heading);
    expect(plain(shown.textContent)).toBe('Теперь 144 из 960 — верно в два разных дня');
    expect(plain(document.querySelector('.ct-end-p')?.textContent)).toBe('2 вопроса за 1 минуту. Верно с первого раза — 2 из 2.');
    expect(document.activeElement).toBe(shown);
  });

  it('a server result that comes after the headline was shown changes nothing: after LEFT_WAIT it says what was known', async () => {
    LEFT_WAIT.ms = 30;
    const late = lastResultLate();
    await answerBoth();
    const shown = await screen.findByRole('heading', { level: 1 });
    expect(plain(shown.textContent)).toBe('2 вопроса за 1 минуту');
    expect(document.activeElement).toBe(shown);
    const paragraph = plain(document.querySelector('.ct-end-p')?.textContent);
    // The last result comes now: before the fix the headline turned into «Теперь 144 из 960 …» here.
    await act(async () => {
      for (const go of late.splice(0)) go();
    });
    await act(async () => undefined);
    expect(plain(screen.getByRole('heading', { level: 1 }).textContent)).toBe('2 вопроса за 1 минуту');
    expect(plain(document.querySelector('.ct-end-p')?.textContent)).toBe(paragraph);
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
    renderStudy(dataWith(['q-plain']), `?s=${SUBJECT_DB}`, csLeft);
    fireEvent.click(option('Третья'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Готово' }))[0]);
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

/**
 * Account B of the live check of 2026-10-11, through the database's side (lib/containers/__fixtures__/server.ts:
 * answers through the rule, plan_inputs with the day's start and pace, decoded as the site decodes them; the plan is
 * the real one): «Программирование на C#», 60 minutes a day; yesterday 17 mistakes and 4 series begun at 18:35, which
 * count today after 14:35. On Sunday at 10:48 the exam page says «Сегодня 86 вопросов, около 60 минут»: 82 now and
 * «Ещё 4 вопроса — после 14:35». Each answer takes 8 s.
 */
function liveB(o: { questions?: number; mistakes?: number } = {}) {
  const items = testItems(SUBJECT_CS, o.questions ?? 200);
  const server = newServer({ subjects: [{ id: SUBJECT_CS, date: '2026-10-30' }], items, budgetMin: 60, firstPlanDay: '2026-10-08' });
  const mistakes = o.mistakes ?? 17;
  const yesterday = (entry: PlanItem, hhmm: string, correct: boolean) =>
    server.states.set(entry.id, sqlStep(emptyState(), { at: at('2026-10-10', hhmm), day: '2026-10-10', correct }, '2026-10-30').state);
  items.slice(0, mistakes).forEach((entry) => yesterday(entry, '12:00', false));
  items.slice(mistakes, mistakes + 4).forEach((entry) => yesterday(entry, '18:35', true));
  const bank = items.map((entry) =>
    item({ id: entry.id, subject_id: SUBJECT_CS, position: entry.o, file_no: String(entry.o), topic: entry.tp, stem: `Вопрос ${entry.o}`, options: ['Первый ответ', 'Второй ответ'], correct: [0] }),
  );
  let clock = at('2026-10-11', '10:48');
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  // The server takes the answers as record_test_answers does, and says each one's state.
  const take = (answers: AnswerInput[]): AnswerResult[] =>
    answers.map((answer) => {
      clock += 8000;
      const correct = answer.chosen === 0;
      record(server, answer.item_id, { at: clock, correct, ms: 8000, cls: classOf(server.states.get(answer.item_id), false) });
      const u = server.states.get(answer.item_id) ?? emptyState();
      const state: AnswerState = {
        item_rev: 1, seen: u.seen, right: u.seen - u.wrong, wrong: u.wrong, last_result: correct ? 'right' : 'wrong', first_seen_day: u.firstDay,
        last_answer_day: u.lastDay, streak_at: iso(u.seriesAt), streak_day: u.seriesDay, two_days_at: iso(u.twoDaysAt), two_days_day: null,
        named_at: iso(u.namedAt), checks: u.checks, peek_day: u.peekDay, was_two_days: u.wasTwoDays, clean_ok_at: iso(u.cleanOkAt),
      };
      return { client_event_id: answer.client_event_id, item_id: answer.item_id, status: 'saved', correct, step: correct ? 'start' : 'miss', rev: 1, state };
    });
  mocks.enqueue.mockImplementation(async (_user: string, answers: AnswerInput[]) => take(answers));
  /** The exam as a page reads it now. */
  const read = (): ContainerData => {
    clock += 1000;
    return {
      summary: summary({ day: '2026-10-11', subjects: [subject({ exam_date: '2026-10-30' })] }),
      planInput: inputAt(server, clock),
      items: new Map(bank.map((entry) => [entry.id, entry])),
      oralWithoutPoints: 0,
    };
  };
  /** The exam page's title, as the page reads the exam now (words.ts planTitle). */
  const pageTitle = () => plain(titleText(planDay(read().planInput)));
  return { read, pageTitle, take };
}

/** Right answers in a row, then «Закончить» when the session has not ended by itself. */
async function answerRight(n: number) {
  for (let k = 0; k < n; k += 1) {
    fireEvent.click(option('Первый ответ'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
  }
  const finish = screen.queryByRole('button', { name: 'Закончить' });
  if (finish) {
    await act(async () => {
      fireEvent.click(finish);
    });
  }
}

/** The end screen has said what is left (no longer held). */
const spoken = () => waitFor(() => expect(document.querySelector('.ct-end-next')).not.toHaveAttribute('aria-hidden'));

describe('the end of a session says what the exam page says next (usability check 2026-10-11: D2, D3, N1)', () => {
  it('three sessions of B: the end screen says 79/55, 73/55, 68/50 — the page right after says the same — and each pill opens what it names', async () => {
    const b = liveB();
    expect(b.pageTitle()).toBe('Сегодня 86 вопросов, около 60 минут');
    renderStudy(b.read(), `?s=${SUBJECT_CS}`, b.read);
    expect(plain(screen.getByRole('banner').textContent)).toContain('1 из 20');
    const seen: Array<{ end: string; page: string; pill: string; opened: string }> = [];
    for (const n of [7, 6, 5]) {
      await answerRight(n);
      await spoken();
      const end = leftLine();
      const title = b.pageTitle();
      const pill = screen.getByRole('link', { name: (name) => plain(name).startsWith('Ещё') });
      const label = plain(pill.textContent);
      // The pill opens the next session: «1 из N», N as it named (D3: «Ещё 13 вопросов» opened 18).
      fireEvent.click(pill);
      const opened = plain(screen.getByRole('banner').textContent).replace(/^.*(1 из \d+).*$/, '$1');
      seen.push({ end, page: title, pill: label, opened });
    }
    // Before the fix the end screen counted only the questions ready now — 75, 69, 64 while the page said 79, 73, 68 —
    // and its pill named the rest of the plan's first session («Ещё 13 вопросов»).
    expect(seen).toEqual([
      { end: 'Сегодня осталось 79 вопросов, около 55 минут.', page: 'Сегодня осталось 79 вопросов, около 55 минут', pill: 'Ещё 20 вопросов', opened: '1 из 20' },
      { end: 'Сегодня осталось 73 вопроса, около 55 минут.', page: 'Сегодня осталось 73 вопроса, около 55 минут', pill: 'Ещё 20 вопросов', opened: '1 из 20' },
      { end: 'Сегодня осталось 68 вопросов, около 50 минут.', page: 'Сегодня осталось 68 вопросов, около 50 минут', pill: 'Ещё 20 вопросов', opened: '1 из 20' },
    ]);
  });

  it('the plan read after the session comes late: the plan as the session ended, its later questions counted — never lower than the page then', async () => {
    LEFT_WAIT.ms = 30;
    const b = liveB();
    // The answers stay on their way (a slow network) until the test lets them go.
    const waiting: Array<() => void> = [];
    mocks.enqueue.mockImplementation(
      (_user: string, answers: AnswerInput[]) => new Promise((resolve) => waiting.push(() => resolve(b.take(answers)))),
    );
    renderStudy(b.read(), `?s=${SUBJECT_CS}`, b.read);
    const reload = (mocks.state as Loadable<ContainerData>).reload;
    await answerRight(7);
    await spoken();
    // 86 − 7 = 79, the 4 of «после 14:35» among them; the minutes the plan had (60), not fewer than the page's.
    const end = { left: leftLine(), pill: plain(document.querySelector('.ct-bar .sf-primary')?.textContent) };
    expect(end).toEqual({ left: 'Сегодня осталось 79 вопросов, около 60 минут.', pill: 'Ещё 20 вопросов' });
    // The exam is read again anyway (for the next session), and once more when the answers have left.
    expect(reload).toHaveBeenCalledTimes(1);
    await act(async () => {
      for (const go of waiting.splice(0)) go();
    });
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    expect(b.pageTitle()).toBe('Сегодня осталось 79 вопросов, около 55 минут');
    expect({ left: leftLine(), pill: plain(document.querySelector('.ct-bar .sf-primary')?.textContent) }).toEqual(end);
  });

  it('everything ready answered, questions later today: the plan’s «Ещё 4 вопроса — после 14:35.», not the line from before the session', async () => {
    const b = liveB({ questions: 7, mistakes: 3 });
    expect(b.pageTitle()).toBe('Сегодня 7 вопросов, около 3 минут');
    renderStudy(b.read(), `?s=${SUBJECT_CS}`, b.read);
    await answerRight(3);
    await spoken();
    // Before the fix: «Сегодня около 3 минут: 7 знакомых», the pre-session plan's line.
    expect(leftLine()).toBe('Ещё 4 вопроса — после 14:35.');
    expect(b.pageTitle()).toBe('Сегодня осталось 4 вопроса, около 2 минут');
    expect(plain(document.querySelector('.ct-bar .sf-primary')?.textContent)).toBe('Готово');
  });

  it('figure 0 and confirmations later today: the end screen says when the first questions count as the page then does — «сегодня после 14:35», not «завтра после 6:50»', async () => {
    const b = liveB();
    renderStudy(b.read(), `?s=${SUBJECT_CS}`, b.read);
    await answerRight(7);
    // The page right after: its figure line (FigureBlock), the plan's first count — the 4 confirmations after 14:35.
    const pageFirst = plain(firstCountText(planDay(b.read().planInput)));
    expect(pageFirst).toBe('Первые войдут в счёт сегодня после 14:35 — если снова ответите верно');
    // Before the fix: «… Первые войдут в счёт завтра после 6:50 — если снова ответите верно.», from this session's
    // answers alone (each counts from tomorrow), though the plan's confirmations count earlier.
    await waitFor(() => expect(plain(document.querySelector('.ct-end-p')?.textContent)).toBe(`Верно с первого раза — 7 из 7. ${pageFirst}.`));
  });

  it('the first count is held with what is left until the plan read after the session comes, and never changes after', async () => {
    const b = liveB();
    // The answers stay on their way until the test lets them go.
    const waiting: Array<() => void> = [];
    mocks.enqueue.mockImplementation(
      (_user: string, answers: AnswerInput[]) => new Promise((resolve) => waiting.push(() => resolve(b.take(answers)))),
    );
    renderStudy(b.read(), `?s=${SUBJECT_CS}`, b.read);
    await answerRight(7);
    const paragraph = () => plain(document.querySelector('.ct-end-p')?.textContent);
    // Not said yet: the end of the paragraph and all below it are held (the reminder too, so nothing seen moves).
    const held = document.querySelector('.ct-end-p span');
    expect(held === null || held.getAttribute('aria-hidden') === 'true').toBe(true);
    expect(screen.queryByRole('button', { name: 'Напоминать каждый день' })).toBeNull();
    await act(async () => {
      for (const go of waiting.splice(0)) go();
    });
    await spoken();
    expect(paragraph()).toBe('Верно с первого раза — 7 из 7. Первые войдут в счёт сегодня после 14:35 — если снова ответите верно.');
    expect(document.querySelector('.ct-end-p span')).not.toHaveAttribute('aria-hidden');
    expect(screen.getByRole('button', { name: 'Напоминать каждый день' })).toBeInTheDocument();
    // A later reading (here one whose first count is tomorrow) does not change it.
    const said = paragraph();
    const later = b.read();
    const tomorrow = dayPlan({
      day: '2026-10-11',
      figure: { inPlan: 200, twoDays: 0, seen: 28, errors: 10, selfKnow: 0 },
      firstCountDay: '2026-10-12',
      lines: [{ key: 'first_count', n: [1], day: '2026-10-12' }],
    });
    act(() => show(loaded({ ...later, planInput: { ...later.planInput, __plan: tomorrow } as PlanInput })));
    await act(async () => undefined);
    expect(paragraph()).toBe(said);
  });

  it('the plan read after the session comes late: the first count from the session’s own answers, as before', async () => {
    LEFT_WAIT.ms = 30;
    const b = liveB();
    renderStudy(b.read(), `?s=${SUBJECT_CS}`);
    await answerRight(7);
    await spoken();
    expect(plain(document.querySelector('.ct-end-p')?.textContent)).toBe(
      'Верно с первого раза — 7 из 7. Первые войдут в счёт завтра после 6:50 — если снова ответите верно.',
    );
  });

  it('a session read late with nothing ready left: the plan’s later line too, from the plan as the session ended', async () => {
    LEFT_WAIT.ms = 30;
    const b = liveB({ questions: 7, mistakes: 3 });
    renderStudy(b.read(), `?s=${SUBJECT_CS}`);
    await answerRight(3);
    await spoken();
    expect(leftLine()).toBe('Ещё 4 вопроса — после 14:35.');
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
    // Each rating was saved before the next question: the headline is final as the screen opens, and has the focus.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    // The plan is read again as the session ends.
    await waitFor(() => expect((mocks.state as Loadable<ContainerData>).reload).toHaveBeenCalledTimes(1));
    expect(plain(document.querySelector('.ct-end-p')?.textContent)).toContain('«Знаю» — 1 · «плаваю» — 1 · «не знаю» — 0.');
    // Both questions were rated: nothing of this session is offered again today, the pill is «Готово».
    expect(screen.queryByRole('link', { name: (name) => plain(name).startsWith('Ещё 1 вопрос') })).toBeNull();
    expect(document.querySelector('.ct-bar .sf-primary')?.textContent).toBe('Готово');
  });
});

describe('the author’s explanation after an answer (release 47, spec §47.3)', () => {
  const explained = (text: string) => dbItems().map((entry) => (entry.id === 'q-iso' ? { ...entry, explanation: text } : entry));
  const explanation = () => document.querySelector('.kq-explain');

  it('comes under the question after an answer, not before; the bar keeps only the verdict and «Дальше»', () => {
    renderStudy(dataWith(['q-iso', 'q-plain'], { items: explained('Фантомы не допускает только SERIALIZABLE.\nREPEATABLE READ их пропускает.') }));
    expect(screen.queryByText('Пояснение')).toBeNull();
    fireEvent.click(option('REPEATABLE READ'));
    const block = explanation() as HTMLElement;
    expect(block).not.toBeNull();
    expect(within(block).getByText('Пояснение')).toBeInTheDocument();
    expect(block.querySelector('.kq-explain-t')?.textContent).toBe('Фантомы не допускает только SERIALIZABLE.\nREPEATABLE READ их пропускает.');
    // In the page's flow above the row of links, outside the pinned bar.
    expect(block.closest('.ct-bar')).toBeNull();
    expect(block.parentElement).toBe(document.querySelector('main.ct-study'));
    expect(block.compareDocumentPosition(document.querySelector('.ct-under')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(verdict()).toBe('Неверно. В файле — SERIALIZABLE. Вернётся через пару вопросов и завтра.');
  });

  it('after «Не знаю» too; a question without one shows none', async () => {
    renderStudy(dataWith(['q-iso', 'q-plain'], { items: explained('Только SERIALIZABLE.') }));
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(plain(explanation()?.textContent)).toContain('Только SERIALIZABLE.');
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Какая нормальная форма требует отсутствия транзитивных зависимостей?'));
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(explanation()).toBeNull();
  });

  it('a right answer shows it as well and waits for «Дальше» instead of moving on after a second', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderStudy(dataWith(['q-iso', 'q-plain'], { items: explained('Только SERIALIZABLE.') }));
    fireEvent.click(option('SERIALIZABLE'));
    expect(verdict()).toBe('Верно.');
    expect(plain(explanation()?.textContent)).toContain('Только SERIALIZABLE.');
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Какой уровень изоляции не допускает фантомного чтения?');
    expect(mocks.enqueue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(sent()[0]).toMatchObject({ item_id: 'q-iso', chosen: 3 }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Какая нормальная форма требует отсутствия транзитивных зависимостей?');
  });
});

describe('owner 2026-10-20: no lit option after a move, and «Только ошибки: N» opens the N', () => {
  it('after a right answer moves on, no option of the next question is the button that was tapped', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Both keys at the file's third place: the tapped button, kept, would be the next question's right answer.
    renderStudy(dataWith(['q-plain', 'q-code']));
    const tapped = option('Третья');
    fireEvent.click(tapped);
    expect(verdict()).toBe('Верно.');
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(plain(screen.getByRole('banner').textContent)).toContain('2 из 2');
    const now = Array.from(document.querySelectorAll('.ct-opt'));
    expect(now).toHaveLength(4);
    expect(now.includes(tapped)).toBe(false);
    expect(tapped.isConnected).toBe(false);
  });

  it('mistakes made today: «Только ошибки» opens them, as many as the link says', () => {
    const wrongToday = unit({ seen: 1, wrong: 1, firstDay: '2026-10-10', lastDay: '2026-10-10' });
    const data = dataWith([]);
    const input = { ...data.planInput, items: planItemsFor(dbItems(), { 'q-iso': wrongToday, 'q-plain': wrongToday, 'q-code': wrongToday }) };
    expect(errorCount(input, SUBJECT_DB)).toBe(3);
    renderStudy({ ...data, planInput: input }, `?s=${SUBJECT_DB}&only=errors`);
    expect(page()).not.toContain('Ошибок сейчас нет.');
    expect(plain(screen.getByRole('banner').textContent)).toContain('1 из 3');
  });
});
