import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ContainerData, Loadable } from '../../lib/containers/hooks';

const mocks = vi.hoisted(() => ({
  state: null as unknown,
  confirm: vi.fn(),
  alert: vi.fn(),
  withdrawDoubt: vi.fn(),
  deleteSubject: vi.fn(),
  moveExamDate: vi.fn(),
}));

vi.mock('../../lib/containers/hooks', () => ({ useContainerData: () => mocks.state }));
vi.mock('../../lib/containers/plan', async (original) => (await import('../../components/containers/testkit/engine')).planModule(original));
vi.mock('../../lib/containers/session', async (original) => (await import('../../components/containers/testkit/engine')).sessionModule(original));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm, alert: mocks.alert }) }));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  withdrawDoubt: mocks.withdrawDoubt,
  deleteSubject: mocks.deleteSubject,
  moveExamDate: mocks.moveExamDate,
}));

import SubjectPage from './SubjectPage';
import { PHONE_QUERY } from '../../lib/usePhone';
import {
  CONTAINER,
  ORAL_EXAM,
  SUBJECT_DB,
  SUBJECT_ORAL,
  containerData,
  dbItems,
  planItemsFor,
  subject,
  summary,
  unit,
} from '../../components/containers/testkit/fixtures';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const nm = (text: string) => (name: string) => plain(name) === text;
const page = () => plain(document.body.textContent);

function loaded(data: ContainerData, extra: Partial<Loadable<ContainerData>> = {}): Loadable<ContainerData> {
  return { data, loading: false, offline: false, unavailable: false, error: null, reload: vi.fn(), ...extra };
}

function setPhone(phone: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: phone
      ? (query: string) => ({
          matches: query === PHONE_QUERY,
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        })
      : undefined,
  });
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(state: Loadable<ContainerData>, subjectId = SUBJECT_DB, phone = false, search = '') {
  mocks.state = state;
  setPhone(phone);
  return render(
    <MemoryRouter initialEntries={[`/exams/c/${CONTAINER}/s/${subjectId}${search}`]}>
      <Routes>
        <Route path="/exams/c/:id/s/:subjectId" element={<SubjectPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** «Базы данных» with two current errors and one question answered right yesterday. */
function dbData(over: Parameters<typeof containerData>[0] = {}) {
  const states = {
    'q-iso': unit({ seen: 2, wrong: 1, lastDay: '2026-10-09' }),
    'q-multi': unit({ seen: 1, wrong: 1, lastDay: '2026-10-08' }),
    'q-plain': unit({ seen: 1, seriesAt: 1, seriesDay: '2026-10-09', lastDay: '2026-10-09' }),
  };
  const data = containerData(over);
  data.planInput.items = planItemsFor(dbItems(), states);
  return data;
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.confirm.mockResolvedValue(true);
  mocks.alert.mockResolvedValue(undefined);
  mocks.withdrawDoubt.mockResolvedValue(undefined);
  mocks.deleteSubject.mockResolvedValue(undefined);
  mocks.moveExamDate.mockReset().mockImplementation(async (id: string, date: string, forWhom: string) => ({
    for: forWhom, container_id: id, exam_date: '2026-10-28', own_exam_date: forWhom === 'me' ? date : null, subjects: [],
  }));
});

afterEach(() => cleanup());

describe('a subject with variants (Concept 1 §3.4, decision 46)', () => {
  it('shows the subject’s step with «Только ошибки» and «Как на экзамене», the figure and the topics', () => {
    renderPage(loaded(dbData()));
    expect(screen.getByRole('heading', { level: 1, name: 'Базы данных' })).toBeInTheDocument();
    // The laptop crumb leads back to the exam by its name.
    expect(screen.getByRole('link', { name: 'Аккредитация' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}`);
    expect(page()).toContain('28 октября, через 18 дней · 240 вопросов');
    const card = screen.getByRole('region', { name: /Сегодня 5/ });
    // The subject's share of the day in the plan's words: its session, 180 seconds read as «около 3 минут».
    expect(plain(card.textContent)).toContain('Сегодня 5 вопросов, около 3 минут');
    expect(within(card).getByRole('link', { name: nm('Повторить 2 ошибки') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_DB}&only=errors&back=s`);
    expect(within(card).getByRole('button', { name: 'Как на экзамене' })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: nm('Начать: 5 вопросов, около 3 минут') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_DB}&back=s`);
    const figure = screen.getByRole('region', { name: 'Выученные вопросы' });
    expect(plain(figure.textContent)).toContain('40');
    expect(plain(figure.textContent)).toContain('40 из 240 выучено');
    const topics = screen.getByRole('list', { name: 'Темы' });
    const rows = within(topics).getAllByRole('button');
    // «Осталось выучить»: each topic with what is left of it.
    expect(rows.map((row) => plain(row.textContent))).toEqual(['3.1 Модель данныхОсталось 4 вопроса из 4', '3.2 Индексы1 вопрос, ещё не начинали']);
  });

  it('a topic opens its sheet with «Начать N вопросов по теме»', () => {
    renderPage(loaded(dbData()));
    fireEvent.click(screen.getByRole('button', { name: /3\.2 Индексы/ }));
    const sheet = screen.getByRole('dialog', { name: '3.2 Индексы' });
    expect(plain(sheet.textContent)).toContain('120 вопросов · выучено 10 · 4 ошибки');
    const start = within(sheet).getByRole('link', { name: nm('Начать 1 вопрос по теме') });
    expect(start.getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_DB}&topic=2&back=s`);
  });

  it('owner 21.10: a reload opens the topic’s sheet again (?topic=), and closing it takes it out of the address', () => {
    window.history.replaceState(null, '', `/exams/c/${CONTAINER}/s/${SUBJECT_DB}`);
    try {
      const first = renderPage(loaded(dbData()));
      fireEvent.click(screen.getByRole('button', { name: /3\.2 Индексы/ }));
      expect(screen.getByRole('dialog', { name: '3.2 Индексы' })).toBeInTheDocument();
      const search = window.location.search;
      expect(new URLSearchParams(search).get('topic')).toBeTruthy();
      first.unmount();

      renderPage(loaded(dbData()), SUBJECT_DB, false, search);
      const sheet = screen.getByRole('dialog', { name: '3.2 Индексы' });
      expect(plain(sheet.textContent)).toContain('120 вопросов · выучено 10 · 4 ошибки');
      fireEvent.click(within(sheet).getByRole('button', { name: /Закрыть/ }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(window.location.search).toBe('');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('«Как на экзамене» opens the setup with one line of rules and the last try, and «Начать» opens the try', () => {
    const base = summary({ mock_runs: [{ id: 'run-1', local_date: '2026-10-05', subject_ids: [SUBJECT_DB], items: 40, correct: 31 }] });
    renderPage(loaded(dbData({ summary: base })));
    fireEvent.click(screen.getByRole('button', { name: 'Как на экзамене' }));
    const sheet = screen.getByRole('dialog', { name: 'Как на экзамене' });
    expect(plain(sheet.textContent)).toContain('Ответы можно менять до конца. Результат покажем после «Завершить».');
    expect(plain(sheet.textContent)).toContain('Прошлая попытка 5 октября: 31 из 40.');
    expect(plain(sheet.textContent)).not.toMatch(/пробн/i);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Начать' }));
    expect(screen.getByTestId('where').textContent).toBe(`/exams/c/${CONTAINER}/mock?s=${SUBJECT_DB}&n=40&t=40`);
  });

  it('the subject’s own «⋯» for the author, and «Убрать предмет» after asking', async () => {
    renderPage(loaded(dbData()), SUBJECT_DB, true);
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: предмет' }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items.map((node) => node.textContent)).toEqual(['Вопросы и ключи', 'Обновить из файла', 'Настройки', 'Убрать предмет']);
    expect(items[0].getAttribute('href')).toBe(`/exams/c/${CONTAINER}/keys?s=${SUBJECT_DB}`);
    fireEvent.click(items[3]);
    await waitFor(() => expect(mocks.deleteSubject).toHaveBeenCalledWith(SUBJECT_DB));
    expect(mocks.confirm.mock.calls[0][0].title).toBe('Убрать предмет «Базы данных»?');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/exams/c/${CONTAINER}`));
  });

  it('a member’s set-aside questions come back with «Вернуть в занятия»', async () => {
    const base = summary({ role: 'member', owner: null, subjects: summary().subjects.map((s) => (s.id === SUBJECT_DB ? { ...s, doubted: 1 } : s)) });
    const data = dbData({ summary: base });
    data.planInput.items = data.planInput.items.filter((entry) => entry.id !== 'q-short');
    const state = loaded(data);
    renderPage(state);
    expect(page()).toContain('1 вопрос отложен, вы сомневаетесь в ключе.');
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть в занятия' }));
    await waitFor(() => expect(mocks.withdrawDoubt).toHaveBeenCalledWith('q-short'));
    await waitFor(() => expect(state.reload).toHaveBeenCalled());
  });

  it('a mixed subject: one quiet line leads to its oral part’s page, no sheet row', () => {
    const base = summary({ subjects: summary().subjects.map((s) => (s.id === SUBJECT_DB ? { ...s, oral: { exam_id: ORAL_EXAM, questions: 40 } } : s)) });
    renderPage(loaded(dbData({ summary: base })));
    expect(page()).not.toMatch(/Шпаргалк/);
    expect(page()).toContain('В предмете есть 40 устных вопросов.');
    expect(screen.getByRole('link', { name: 'Открыть' }).getAttribute('href')).toBe(`/exams/${ORAL_EXAM}?from=c:${CONTAINER}`);
  });

  it('an oral subject is today’s oral page, reached with the way back', () => {
    const base = summary({ subjects: [...summary().subjects, subject({ id: SUBJECT_ORAL, title: 'Право', keyed: 0, topics: [], oral: { exam_id: ORAL_EXAM, questions: 40 } })] });
    renderPage(loaded(dbData({ summary: base })), SUBJECT_ORAL);
    expect(screen.getByTestId('where').textContent).toBe(`/exams/${ORAL_EXAM}?from=c:${CONTAINER}`);
  });

  it('a subject that is not in the exam says so and leads back', () => {
    renderPage(loaded(dbData()), 'missing-subject');
    expect(page()).toContain('Такого предмета в экзамене нет.');
    expect(screen.getByRole('link', { name: 'Аккредитация' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}`);
  });
});

describe('«Перенести экзамен» on a subject’s page (release 47)', () => {
  /** «Базы данных» with its own date, 5 October, passed; the other subjects on 28 October. */
  function passedDb(role: 'owner' | 'member' = 'owner') {
    const base = summary({
      role,
      owner: role === 'owner' ? { members: 0, doubts_open: 0, links: [] } : null,
      subjects: summary().subjects.map((entry) => (entry.id === SUBJECT_DB ? { ...entry, exam_date: '2026-10-05' } : entry)),
    });
    const data = dbData({ summary: base });
    data.planInput.subjects = data.planInput.subjects.map((entry) => (entry.id === SUBJECT_DB ? { ...entry, date: '2026-10-05' } : entry));
    return data;
  }

  it('a passed subject: the blue pill moves that subject’s date, and the page reads its data again', async () => {
    const state = loaded(passedDb());
    renderPage(state);
    expect(page()).toContain('Экзамен прошёл 5 октября');
    expect(screen.queryByRole('link', { name: 'Поставить новую дату' })).toBeNull();
    const pill = screen.getByRole('button', { name: 'Перенести экзамен' });
    expect(pill).toHaveClass('sf-primary');
    fireEvent.click(pill);
    const dialog = screen.getByRole('dialog', { name: 'Перенести экзамен' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Перенести' }));
    await waitFor(() => expect(mocks.moveExamDate).toHaveBeenCalledWith(CONTAINER, '2026-10-17', 'all', SUBJECT_DB));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(state.reload).toHaveBeenCalledTimes(1);
    expect(plain(screen.getByRole('status').textContent)).toBe('Экзамен перенесён на 17 октября.');
  });

  it('a member moves their own date; the note names the author’s date of the subject', async () => {
    renderPage(loaded(passedDb('member')));
    fireEvent.click(screen.getByRole('button', { name: 'Перенести экзамен' }));
    const dialog = screen.getByRole('dialog', { name: 'Перенести экзамен' });
    expect(plain(dialog.textContent)).toContain('Это ваша дата. У автора остаётся 5 октября.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Перенести' }));
    await waitFor(() => expect(mocks.moveExamDate).toHaveBeenCalledWith(CONTAINER, '2026-10-17', 'me', SUBJECT_DB));
  });

  it('a subject before its date has no «Перенести экзамен»', () => {
    renderPage(loaded(dbData()));
    expect(screen.queryByRole('button', { name: 'Перенести экзамен' })).toBeNull();
  });
});
