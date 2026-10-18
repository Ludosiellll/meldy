import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import summaryJson from '../../../../contracts/container/summary.json';
import type { ContainerSummary, PlanInput } from '../../types/container';

const api = vi.hoisted(() => ({
  updateContainer: vi.fn(),
  updateSubject: vi.fn(),
  deleteSubject: vi.fn(),
  deleteContainer: vi.fn(),
  saveSettings: vi.fn(),
  leaveContainer: vi.fn(),
  createLink: vi.fn(),
  revokeLink: vi.fn(),
  fetchMembers: vi.fn(),
  removeMember: vi.fn(),
  forgetBank: vi.fn(),
  feasibility: vi.fn(),
  windowDays: vi.fn(),
  reload: vi.fn(),
  moveExamDate: vi.fn(),
  telegramExams: vi.fn(),
  setExamRemind: vi.fn(),
  setContainerKind: vi.fn(),
  fetchTelegramState: vi.fn(),
  state: { summary: null as ContainerSummary | null, plan: null as PlanInput | null, error: null as string | null, gone: false },
}));
vi.mock('../../api/containers', () => ({
  updateContainer: api.updateContainer,
  updateSubject: api.updateSubject,
  deleteSubject: api.deleteSubject,
  deleteContainer: api.deleteContainer,
  saveSettings: api.saveSettings,
  leaveContainer: api.leaveContainer,
  createLink: api.createLink,
  revokeLink: api.revokeLink,
  fetchMembers: api.fetchMembers,
  removeMember: api.removeMember,
  // Release 47: «Моя дата экзамена» and «План в Telegram по этому экзамену».
  moveExamDate: api.moveExamDate,
  telegramExams: api.telegramExams,
  setExamRemind: api.setExamRemind,
  // Release 47.3: «Это экзамен» / «Это тест».
  setContainerKind: api.setContainerKind,
  containerErrorText: (error: unknown) => (error instanceof Error && /[а-яё]/i.test(error.message) ? error.message : 'Не получилось. Попробуйте ещё раз.'),
}));
vi.mock('../../api/telegram', () => ({ fetchTelegramState: api.fetchTelegramState }));
vi.mock('../../lib/containers/bankCache', () => ({ forgetBank: api.forgetBank }));
// The rest of the plan module stays real («Все вопросы»: ALL_QUESTIONS_MIN, allQuestions, planDay).
vi.mock('../../lib/containers/plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/containers/plan')>()),
  feasibility: api.feasibility,
  windowDays: api.windowDays,
}));
vi.mock('../../lib/containers/hooks', () => ({
  useContainerData: () => ({
    data: api.state.summary ? { summary: api.state.summary, planInput: api.state.plan, items: new Map(), oralWithoutPoints: 0 } : null,
    loading: false,
    offline: false,
    unavailable: false,
    error: api.state.error,
    gone: api.state.gone,
    reload: api.reload,
  }),
}));

import SettingsPage from './SettingsPage';
import { GONE, MEMBERS, SETTINGS } from '../../components/containers/copyImport';

const SUMMARY = summaryJson as unknown as ContainerSummary;
const ID = SUMMARY.id;
const PLAN: PlanInput = {
  v: 1,
  now: 0,
  tz: 'Europe/Minsk',
  containerId: ID,
  budgetMin: 45,
  firstPlanDay: '2026-12-14',
  subjects: SUMMARY.subjects.map((subject) => ({ id: subject.id, title: subject.title, date: subject.exam_date })),
  // 960 questions with a key, all in the first subject (now = 0: every date is ahead).
  items: Array.from({ length: 960 }, (_, index) => ({ id: `i${index}`, s: SUMMARY.subjects[0].id, f: 't' as const, tp: 1, o: index + 1 })),
  today: { firstAt: null, doneSec: 0, newDone: {} },
  pace: null,
  ai: null,
};

let where = '';
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}${location.hash}`;
  return null;
}

function renderAt(path = `/exams/c/${ID}/settings`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams/c/:id/settings" element={<SettingsPage />} />
        <Route path="/exams" element={<p>Экзамены</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

// The subjects take the exam's date (no date of their own), so the page starts with one date for all.
const solo = (): ContainerSummary => ({
  ...SUMMARY,
  subjects: SUMMARY.subjects.map((subject) => ({ ...subject, exam_date: null })),
  owner: { members: 0, doubts_open: 0, links: [] },
});

beforeEach(() => {
  window.localStorage.clear();
  where = '';
  api.state.summary = solo();
  api.state.plan = PLAN;
  api.state.error = null;
  api.state.gone = false;
  for (const fn of [api.updateContainer, api.updateSubject, api.deleteSubject, api.deleteContainer, api.saveSettings, api.leaveContainer, api.forgetBank]) {
    fn.mockReset().mockResolvedValue(undefined);
  }
  api.fetchMembers.mockReset().mockResolvedValue([]);
  api.removeMember.mockReset().mockResolvedValue(0);
  api.feasibility.mockReset().mockReturnValue({ neededMin: 40, option: 45, seenByDateEst: 960 });
  api.windowDays.mockReset().mockReturnValue(4);
  api.reload.mockReset();
  api.moveExamDate.mockReset().mockImplementation(async (id: string, date: string | null) => ({ for: 'me', container_id: id, exam_date: '2027-01-12', own_exam_date: date, subjects: [] }));
  // Telegram not linked unless a test says so: no switch.
  api.fetchTelegramState.mockReset().mockResolvedValue({ linked: false });
  api.telegramExams.mockReset().mockResolvedValue([]);
  api.setExamRemind.mockReset().mockImplementation(async (id: string, on: boolean) => ({ container_id: id, tg_remind: on }));
  api.setContainerKind.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('SettingsPage: the one «Настройки» of an exam (§16 #44)', () => {
  it('saves the name, the date and the minutes a day', async () => {
    renderAt();
    expect(screen.getByRole('heading', { level: 1, name: 'Настройки' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Зимняя сессия 2027' } });
    fireEvent.change(screen.getByLabelText('Дата экзамена'), { target: { value: '2027-01-14' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Время в день' }));
    fireEvent.click(await screen.findByRole('option', { name: /^90\sминут$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.updateContainer).toHaveBeenCalledWith(ID, { title: 'Зимняя сессия 2027', exam_date: '2027-01-14' }));
    expect(api.saveSettings).toHaveBeenCalledWith(ID, { minutes_per_day: 90, study_weekdays: 127, tempo: 'date' });
    expect(await screen.findByText(SETTINGS.saved)).toBeInTheDocument();
    expect(api.reload).toHaveBeenCalled();
  });

  it('a missing name stops saving and says so', async () => {
    renderAt();
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText(SETTINGS.nameMissing)).toBeInTheDocument();
    expect(api.updateContainer).not.toHaveBeenCalled();
  });

  it('gives each subject its own date (an oral-only subject keeps the date of its oral page)', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.dates }));
    expect(screen.getByText(SETTINGS.oralDate)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Дата: История Беларуси'), { target: { value: '2027-01-18' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.updateSubject).toHaveBeenCalledWith(SUMMARY.subjects[1].id, { exam_date: '2027-01-18' }));
    expect(api.updateSubject).toHaveBeenCalledTimes(1);
  });

  it('«Одна дата для всех» clears the subjects’ own dates, so the exam’s date counts for every subject', async () => {
    api.state.summary = { ...solo(), subjects: SUMMARY.subjects };
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.oneDate }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.updateSubject).toHaveBeenCalledWith(SUMMARY.subjects[1].id, { exam_date: null }));
    // The first subject's date is the exam's already; the oral subject's date lives on its oral page.
    expect(api.updateSubject).toHaveBeenCalledTimes(1);
    expect(api.updateSubject).not.toHaveBeenCalledWith(SUMMARY.subjects[2].id, expect.anything());
  });

  it('says what the minutes need to see every question by the date (the exam page’s «Время в день» leads here)', async () => {
    api.feasibility.mockReturnValue({ neededMin: 70, option: 90, seenByDateEst: 960 });
    renderAt(`/exams/c/${ID}/settings#minutes`);
    expect(screen.getByText(/^Чтобы увидеть все 960\sвопросов к 12\sянваря, нужно около 70\sминут в день\.$/)).toBeInTheDocument();
    expect(api.feasibility).toHaveBeenLastCalledWith(expect.objectContaining({ budgetMin: SUMMARY.settings.minutes_per_day }));
    // The line follows the form: a new date counts before it is saved.
    fireEvent.change(screen.getByLabelText('Дата экзамена'), { target: { value: '2027-01-14' } });
    expect(screen.getByText(/^Чтобы увидеть все 960\sвопросов к 14\sянваря, нужно около 70\sминут в день\.$/)).toBeInTheDocument();
    const input = api.feasibility.mock.calls[api.feasibility.mock.calls.length - 1][0] as PlanInput;
    expect(input.subjects.find((subject) => subject.id === SUMMARY.subjects[0].id)?.date).toBe('2027-01-14');
    // Without a date there is nothing to count to.
    fireEvent.change(screen.getByLabelText('Дата экзамена'), { target: { value: '' } });
    expect(screen.queryByText(/Чтобы увидеть все/)).not.toBeInTheDocument();
    expect(screen.getByText(/Без даты — по 15\sновых вопросов в день на предмет\./)).toBeInTheDocument();
  });

  it('says honestly what the minutes reach when they fall short, the final window under «Подробнее»', async () => {
    api.feasibility.mockImplementation((input: PlanInput) => ({ neededMin: 75, option: 90, seenByDateEst: input.budgetMin === 30 ? 704 : 960 }));
    renderAt();
    fireEvent.click(screen.getByRole('combobox', { name: 'Время в день' }));
    fireEvent.click(await screen.findByRole('option', { name: /^30\sминут$/ }));
    expect(screen.getByText(/^При 30\sминутах к 12\sянваря вы увидите около 700 из 960\. Чтобы увидеть все, нужно около 75\sминут\./)).toBeInTheDocument();
    expect(screen.queryByText(/в день\.$/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }));
    expect(screen.getByText(/С 8\sянваря новых вопросов не будет: последние 4\sдня — только знакомые, сначала ошибки\./)).toBeInTheDocument();
  });

  it('even 90 minutes falling short is said at 90 only: at fewer minutes the line names the minutes chosen', async () => {
    api.feasibility.mockImplementation((input: PlanInput) => ({ neededMin: 120, option: null, seenByDateEst: input.budgetMin === 90 ? 812 : 455 }));
    renderAt();
    expect(screen.getByText(/^При 45\sминутах к 12\sянваря вы увидите около 450 из 960\. Чтобы увидеть все, нужно около 120\sминут\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Время в день' }));
    fireEvent.click(await screen.findByRole('option', { name: /^90\sминут$/ }));
    expect(screen.getByText(/^Даже при 90\sминутах в день к 12\sянваря вы увидите около 810 из 960\./)).toBeInTheDocument();
  });

  it('«Все вопросы» after 90 (the owner, 2026-10-14): the line says the new ones and the time a day; the save sends 300', async () => {
    api.feasibility.mockImplementation((input: PlanInput) => ({ neededMin: 120, option: null, seenByDateEst: input.budgetMin === 90 ? 812 : 455 }));
    renderAt();
    fireEvent.click(screen.getByRole('combobox', { name: 'Время в день' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Все вопросы' }));
    expect(screen.getByText(/^Все 960\sвопросов — к \d+\s\S+: около \d+ новых в\sдень, около 120\sминут в\sдень\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(ID, { minutes_per_day: 300, study_weekdays: 127, tempo: 'date' }));
  });

  it('«Как можно быстрее» (the owner, 2026-10-14): the line says the day all are seen; the save sends the tempo', async () => {
    renderAt();
    expect(screen.getByRole('combobox', { name: 'Новые вопросы' })).toHaveTextContent('Равномерно до даты');
    fireEvent.click(screen.getByRole('combobox', { name: 'Новые вопросы' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Как можно быстрее' }));
    expect(screen.getByText(/^При \d+\sминутах в\sдень все 960\sвопросов вы увидите (сегодня|завтра|к \d+\s\S+ — за \d+\s\S+ занятий)\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(ID, expect.objectContaining({ tempo: 'fast' })));
  });

  it('a saved «Как можно быстрее» comes back chosen, and nothing to save until it changes', async () => {
    api.state.summary = { ...SUMMARY, settings: { ...SUMMARY.settings, tempo: 'fast' } };
    renderAt();
    expect(screen.getByRole('combobox', { name: 'Новые вопросы' })).toHaveTextContent('Как можно быстрее');
    expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Новые вопросы' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Равномерно до даты' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(ID, expect.objectContaining({ tempo: 'date' })));
  });

  it('renames and removes a subject; the last subject is removed only with the exam', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: История Беларуси' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Переименовать' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Переименовать' }), { target: { value: 'История' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(api.updateSubject).toHaveBeenCalledWith(SUMMARY.subjects[1].id, { title: 'История' }));
    // The summary is read again (here it never comes back): the new name stays meanwhile, never the old one (n2).
    expect(api.reload).toHaveBeenCalled();
    expect(await screen.findByText('История')).toBeInTheDocument();
    expect(screen.queryByText('История Беларуси')).not.toBeInTheDocument();
    // The focus is back on the row's «⋯» (m9).
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ещё: История' })));

    fireEvent.click(screen.getByRole('button', { name: 'Ещё: История' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Убрать предмет' }));
    expect(screen.getByText(/Убрать «История»\? Его вопросы и ответы по ним пропадут\./)).toBeInTheDocument();
    // The confirm takes the focus on «Отмена»; «Отмена» gives it back to the «⋯» (m9).
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' })));
    expect(screen.getByRole('group', { name: /Убрать «История»\?/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ещё: История' })));
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: История' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Убрать предмет' }));
    fireEvent.click(screen.getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(api.deleteSubject).toHaveBeenCalledWith(SUMMARY.subjects[1].id));
    // The row goes with the next summary: the focus waits on the list's heading.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Предметы' })));

    cleanup();
    api.state.summary = { ...solo(), subjects: [SUMMARY.subjects[0]] };
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: Основы программирования' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Убрать предмет' }));
    expect(screen.getByText(SETTINGS.lastSubject)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Убрать' })).not.toBeInTheDocument();
  });

  it('removing a subject with an oral part says the oral part stays in «Экзамены»', () => {
    const oral = SUMMARY.subjects[2];
    api.state.summary = {
      ...solo(),
      subjects: [{ ...SUMMARY.subjects[0], exam_date: null, oral: { exam_id: 'e-mixed', questions: 30 } }, { ...oral, exam_date: null }],
    };
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: `Ещё: ${oral.title}` }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Убрать предмет' }));
    expect(screen.getByText(SETTINGS.removeOralAsk(oral.title))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: Основы программирования' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Убрать предмет' }));
    expect(screen.getByText(SETTINGS.removeMixedAsk('Основы программирования'))).toBeInTheDocument();
  });

  it('«Удалить экзамен» is refused while members are in (MC009) and says what to do', async () => {
    api.state.summary = { ...solo(), owner: { members: 3, doubts_open: 0, links: [] } };
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить экзамен' }));
    // The refusal is said aloud, and «Отмена» has the focus (m9).
    expect(screen.getByRole('alert').textContent).toMatch(/Сначала уберите участников: в экзамене 3\sучастника\./);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' })));
    expect(api.deleteContainer).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByText(/Сначала уберите участников/).closest('p')!).getByRole('button', { name: 'Кто вошёл' }));
    await waitFor(() => expect(api.fetchMembers).toHaveBeenCalledWith(ID));
    // The focus goes to the group's «Кто вошёл», now open, with the list under it.
    const groupWho = within(document.getElementById('settings-group')!).getByRole('button', { name: 'Кто вошёл' });
    await waitFor(() => expect(document.activeElement).toBe(groupWho));
    expect(groupWho).toHaveAttribute('aria-expanded', 'true');
    // «Отмена» closes the refusal and gives the focus back to «Удалить экзамен».
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Удалить экзамен' })));
  });

  it('deletes an exam without members; the database’s refusal (someone joined meanwhile) turns the confirm into the members’ one (m8)', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить экзамен' }));
    expect(screen.getByRole('group', { name: /Удалить «Зимняя сессия»\? Вопросы, ответы и прогресс пропадут\. Устные предметы останутся в «Экзаменах» отдельно\./ })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' })));
    expect(screen.getByText(MEMBERS.inExam(0, false))).toBeInTheDocument();
    api.deleteContainer.mockRejectedValueOnce(Object.assign(new Error('the container has members'), { code: 'MC009' }));
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.removeYes }));
    // No second «Удалить экзамен»: the members' confirm with its words (an alert), «Кто вошёл» and «Отмена» (focused).
    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toMatch(/^Сначала уберите участников: в экзамене 1\sучастник\. Тогда экзамен можно будет удалить\.$/);
    expect(screen.queryByRole('button', { name: SETTINGS.removeYes })).not.toBeInTheDocument();
    expect(within(refusal.closest('p')!).getByRole('button', { name: 'Кто вошёл' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' })));
    // The group is read again; until it comes back it says one member is in, with «Кто вошёл».
    expect(api.reload).toHaveBeenCalled();
    expect(screen.getByText(/^В экзамене 1\sучастник/)).toBeInTheDocument();
    expect(within(document.getElementById('settings-group')!).getByRole('button', { name: 'Кто вошёл' })).toBeInTheDocument();
    expect(screen.queryByText(/Пока никто не вошёл/)).not.toBeInTheDocument();

    // The new summary: the member left again, nobody is in, and the exam can go.
    api.state.summary = solo();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить экзамен' }));
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.removeYes }));
    await waitFor(() => expect(where).toBe('/exams'));
    expect(api.forgetBank).toHaveBeenCalledWith(ID);
  });

  it('a member sets only their own minutes and can leave the exam', async () => {
    api.state.summary = { ...solo(), role: 'member', owner: null };
    renderAt();
    expect(screen.queryByLabelText('Название')).not.toBeInTheDocument();
    expect(screen.getByText(SETTINGS.minutesMember)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.leave }));
    // The confirm keeps its words and takes the focus on «Отмена»; «Отмена» gives it back (m9).
    expect(screen.getByRole('group', { name: SETTINGS.leaveAsk('Зимняя сессия') })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' })));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: SETTINGS.leave })));
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.leave }));
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.leaveYes }));
    await waitFor(() => expect(api.leaveContainer).toHaveBeenCalledWith(ID));
    await waitFor(() => expect(where).toBe('/exams'));
  });

  it('the member’s «⋯ → Выйти из экзамена» opens here at the leave confirm (#leave, usability check m1)', async () => {
    api.state.summary = { ...solo(), role: 'member', owner: null };
    renderAt(`/exams/c/${ID}/settings#leave`);
    expect(screen.getByText(SETTINGS.leaveAsk('Зимняя сессия'))).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' })));
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.leaveYes }));
    await waitFor(() => expect(api.leaveContainer).toHaveBeenCalledTimes(1));
    // The author has no leave: #leave opens nothing for them.
    cleanup();
    api.state.summary = solo();
    renderAt(`/exams/c/${ID}/settings#leave`);
    expect(screen.queryByText(/Выйти из «/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить экзамен' })).toBeInTheDocument();
  });

  it('a failed leave says why in an alert and keeps the confirm', async () => {
    api.state.summary = { ...solo(), role: 'member', owner: null };
    api.leaveContainer.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { code: 'network' }));
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.leave }));
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.leaveYes }));
    expect((await screen.findByRole('alert')).textContent).toBe('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
    expect(screen.getByRole('button', { name: SETTINGS.leaveYes })).toBeInTheDocument();
    expect(where).toBe(`/exams/c/${ID}/settings`);
  });

  it('sets the days of the week, Пн–Вс, saved with the minutes (spec §3: «минуты и дни недели»)', async () => {
    renderAt();
    const days = within(screen.getByRole('group', { name: SETTINGS.days }));
    const buttons = days.getAllByRole('button');
    // Seen «Пн … Вс», read «понедельник … воскресенье».
    expect(buttons.map((button) => button.querySelector('[aria-hidden]')?.textContent)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
    expect(buttons.map((button) => button.querySelector('.sr-only')?.textContent)).toEqual(SETTINGS.dayFull);
    expect(buttons.every((button) => button.getAttribute('aria-pressed') === 'true')).toBe(true);
    fireEvent.click(days.getByRole('button', { name: 'суббота' }));
    fireEvent.click(days.getByRole('button', { name: 'воскресенье' }));
    expect(days.getByRole('button', { name: 'суббота' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    // Monday … Friday: 1 + 2 + 4 + 8 + 16; the minutes stay as they were.
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(ID, { minutes_per_day: 45, study_weekdays: 31, tempo: 'date' }));
    expect(api.updateContainer).not.toHaveBeenCalled();
  });

  it('the lines under «Время в день» count the days as the form has them, before «Сохранить»', () => {
    // The minutes reach every question on every day (saved), not on Пн–Пт.
    api.feasibility.mockImplementation((input: PlanInput) => ({ neededMin: 75, option: 90, seenByDateEst: input.studyWeekdays === 31 ? 704 : 960 }));
    renderAt();
    expect(screen.getByText(/^Чтобы увидеть все 960\sвопросов к 12\sянваря, нужно около 75\sминут в день\.$/)).toBeInTheDocument();
    const days = within(screen.getByRole('group', { name: SETTINGS.days }));
    fireEvent.click(days.getByRole('button', { name: 'суббота' }));
    fireEvent.click(days.getByRole('button', { name: 'воскресенье' }));
    expect(api.feasibility).toHaveBeenLastCalledWith(expect.objectContaining({ studyWeekdays: 31 }));
    expect(screen.getByText(/^При 45\sминутах к 12\sянваря вы увидите около 700 из 960\. Чтобы увидеть все, нужно около 75\sминут\./)).toBeInTheDocument();
    // The final 4 days are the last study days before Tuesday 12 January: 6, 7, 8 and 11 January.
    expect(api.windowDays).toHaveBeenLastCalledWith(PLAN.firstPlanDay, '2027-01-12', 31);
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }));
    expect(screen.getByText(/С 6\sянваря новых вопросов не будет: последние 4\sдня — только знакомые, сначала ошибки\./)).toBeInTheDocument();
    expect(api.saveSettings).not.toHaveBeenCalled();
    // Saturday back on (Пн–Сб): 7, 8, 9 and 11 January.
    fireEvent.click(days.getByRole('button', { name: 'суббота' }));
    expect(screen.getByText(/С 7\sянваря новых вопросов не будет/)).toBeInTheDocument();
  });

  it('keeps at least one day: the last one stays on and the page says why', () => {
    api.state.summary = { ...solo(), settings: { minutes_per_day: 45, study_weekdays: 4 } };
    renderAt();
    const days = within(screen.getByRole('group', { name: SETTINGS.days }));
    const wednesday = days.getByRole('button', { name: 'среда' });
    expect(wednesday).toHaveAttribute('aria-pressed', 'true');
    expect(wednesday).toHaveAttribute('aria-disabled', 'true');
    expect(days.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    fireEvent.click(wednesday);
    expect(wednesday).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(SETTINGS.daysLeast)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument();
    // Another day on: Wednesday can go now.
    fireEvent.click(days.getByRole('button', { name: 'пятница' }));
    fireEvent.click(wednesday);
    expect(wednesday).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
  });

  it('a member sets their own days too', async () => {
    api.state.summary = { ...solo(), role: 'member', owner: null };
    renderAt();
    fireEvent.click(within(screen.getByRole('group', { name: SETTINGS.days })).getByRole('button', { name: 'понедельник' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(ID, { minutes_per_day: 45, study_weekdays: 126, tempo: 'date' }));
  });

  it('opens «Пригласить группу» from ?invite=1 and links «Добавить предмет» to the import page', () => {
    renderAt(`/exams/c/${ID}/settings?invite=1`);
    expect(screen.getByRole('dialog', { name: 'Пригласить группу' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Добавить предмет' })).toHaveAttribute('href', `/exams/import?from=c:${ID}`);
  });
});

describe('SettingsPage: the group’s one line and «Кто вошёл» (usability checks M1, m3)', () => {
  const LINK = { id: 'link-1', created_at: '2026-10-08T10:00:00Z', expires_at: '2099-01-01T00:00:00Z', revoked_at: null, members: 0, max_members: 60, oral: 0 };
  const groupLine = () => document.querySelector<HTMLElement>('#settings-group > .st-line')!;

  it('says who is in now, not the seats of the newest link: a member who came through an older link counts', () => {
    api.state.summary = {
      ...solo(),
      owner: { members: 1, doubts_open: 0, links: [LINK, { ...LINK, id: 'link-0', created_at: '2026-10-01T10:00:00Z', revoked_at: '2026-10-02T10:00:00Z', members: 1 }] },
    };
    renderAt();
    expect(groupLine().textContent).toMatch(/^В экзамене 1\sучастник\s· Кто вошёл$/);
    expect(screen.queryByText(/Пока никто не вошёл/)).not.toBeInTheDocument();
  });

  it('nobody ever came in: «Пока никто не вошёл» and no «Кто вошёл»', () => {
    api.state.summary = { ...solo(), owner: { members: 0, doubts_open: 0, links: [LINK] } };
    renderAt();
    expect(groupLine().textContent).toBe('Пока никто не вошёл');
    expect(screen.queryByRole('button', { name: 'Кто вошёл' })).not.toBeInTheDocument();
  });

  it('the only member removed and the link closed: «Кто вошёл» stays and «Вернуть» brings them back', async () => {
    api.state.summary = { ...solo(), owner: { members: 0, doubts_open: 0, links: [{ ...LINK, revoked_at: '2026-10-09T10:00:00Z', members: 1 }] } };
    api.fetchMembers.mockResolvedValue([{ user_id: 'u-3', name: 'Вика', joined_at: '2026-10-08T15:00:00Z', left_at: null, removed_at: '2026-10-09T09:00:00Z' }]);
    renderAt();
    expect(groupLine().textContent).toMatch(/^Сейчас в экзамене никого\s· Кто вошёл$/);
    fireEvent.click(screen.getByRole('button', { name: 'Кто вошёл' }));
    const vika = (await screen.findByText('Вика')).closest('li')!;
    // One line says who is in; the list does not say «Пока никто не вошёл» again.
    expect(screen.queryByText(/Пока никто не вошёл/)).not.toBeInTheDocument();
    expect(screen.getByText('Убраны')).toBeInTheDocument();
    fireEvent.click(within(vika).getByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith(ID, 'u-3', true));
    expect(api.reload).toHaveBeenCalled();
  });

  it('an exam that is not the user’s any more (deleted, left, removed): says so, no «Повторить», the way to «Экзамены» (m2)', () => {
    api.state.summary = null;
    api.state.error = 'Не нашли — возможно, его уже удалили.';
    api.state.gone = true;
    renderAt();
    expect(screen.getByText(`${GONE.title}. ${GONE.text}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Экзамены' })).toHaveAttribute('href', '/exams');
    expect(screen.queryByRole('button', { name: SETTINGS.retry })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // A real failure keeps «Повторить».
    cleanup();
    api.state.error = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
    api.state.gone = false;
    renderAt();
    expect(screen.getByRole('alert').textContent).toContain('Нет связи с сервером.');
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.retry }));
    expect(api.reload).toHaveBeenCalled();
  });
});

describe('SettingsPage: «Моя дата экзамена» (release 47)', () => {
  /** A member of «Зимняя сессия» (12 January 2027; the summary's day is 21 December 2026). */
  const member = (over: Partial<ContainerSummary> = {}): ContainerSummary => ({ ...solo(), role: 'member', owner: null, author_exam_date: '2027-01-12', own_exam_date: null, ...over });
  const field = () => screen.getByLabelText(SETTINGS.ownDate) as HTMLInputElement;

  it('a member sets their own date: only for them, the author’s stays; «Сохранить» sends it', async () => {
    api.state.summary = member();
    renderAt();
    expect(field().type).toBe('date');
    expect(field().value).toBe('');
    expect(field().min).toBe('2026-12-21');
    expect(field().max).toBe('2028-12-20');
    expect(field()).toHaveAccessibleDescription(/^Только для вас\. У автора — 12\sянваря\.$/);
    // Nothing to take away yet.
    expect(screen.queryByRole('button', { name: SETTINGS.ownDateClear })).toBeNull();
    fireEvent.change(field(), { target: { value: '2027-01-26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.moveExamDate).toHaveBeenCalledWith(ID, '2027-01-26', 'me'));
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(api.updateContainer).not.toHaveBeenCalled();
    expect(await screen.findByText(SETTINGS.saved)).toBeInTheDocument();
    expect(api.reload).toHaveBeenCalled();
  });

  it('a member’s own date comes back filled; «Убрать» takes it away at once', async () => {
    api.state.summary = member({ exam_date: '2027-01-26', own_exam_date: '2027-01-26' });
    renderAt();
    expect(field().value).toBe('2027-01-26');
    // Their own date stands in for the summary's: the note still names the author's.
    expect(field()).toHaveAccessibleDescription(/^Только для вас\. У автора — 12\sянваря\.$/);
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.ownDateClear }));
    await waitFor(() => expect(api.moveExamDate).toHaveBeenCalledWith(ID, null, 'me'));
    expect(await screen.findByText(SETTINGS.ownDateCleared)).toBeInTheDocument();
    expect(field().value).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(field()));
    expect(api.reload).toHaveBeenCalled();
  });

  it('a date before today is said before sending; the server’s refusal of a date is said in the page’s words', async () => {
    api.state.summary = member();
    renderAt();
    fireEvent.change(field(), { target: { value: '2026-12-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(SETTINGS.ownDatePast);
    expect(api.moveExamDate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field());
    api.moveExamDate.mockRejectedValueOnce(Object.assign(new Error('date'), { code: '22023' }));
    fireEvent.change(field(), { target: { value: '2027-02-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(SETTINGS.ownDateRange));
  });

  it('the author has no «Моя дата экзамена» until they keep a date of their own', () => {
    renderAt();
    expect(screen.queryByLabelText(SETTINGS.ownDate)).toBeNull();
  });

  it('the author after «Только для меня»: their date with «Убрать», the common date as the members have it, nothing to save', () => {
    const base = solo();
    // The server's effective date: their own date stands for the exam's and the subjects'.
    api.state.summary = {
      ...base,
      exam_date: '2027-01-26',
      own_exam_date: '2027-01-26',
      author_exam_date: '2027-01-12',
      subjects: base.subjects.map((entry) => ({ ...entry, exam_date: '2027-01-26' })),
      owner: { members: 2, doubts_open: 0, links: [] },
    };
    renderAt();
    expect(field().value).toBe('2027-01-26');
    expect(field()).toHaveAccessibleDescription(/^Только для вас\. У участников — 12\sянваря\.$/);
    expect((screen.getByLabelText('Дата экзамена') as HTMLInputElement).value).toBe('2027-01-12');
    // The subjects' own dates are not known here: no «У предметов разные даты», and nothing to clear.
    expect(screen.queryByRole('button', { name: SETTINGS.dates })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    expect(screen.getByRole('button', { name: SETTINGS.ownDateClear })).toBeInTheDocument();
  });
});

describe('SettingsPage: «План в Telegram по этому экзамену» (release 47)', () => {
  const linked = (on = true) => {
    api.fetchTelegramState.mockResolvedValue({ linked: true });
    api.telegramExams.mockResolvedValue([
      { container_id: 'other', title: 'Осенняя сессия', exam_date: '2026-12-28', state: 'study', tg_remind: true },
      { container_id: ID, title: 'Зимняя сессия', exam_date: '2027-01-12', state: 'study', tg_remind: on },
    ]);
  };

  it('is there only when Telegram is linked', async () => {
    renderAt();
    await waitFor(() => expect(api.fetchTelegramState).toHaveBeenCalled());
    expect(screen.queryByRole('switch')).toBeNull();
    expect(api.telegramExams).not.toHaveBeenCalled();
  });

  it('switches this exam’s plan off and on at once, for the author', async () => {
    linked();
    renderAt();
    const toggle = await screen.findByRole('switch', { name: 'План в Telegram по этому экзамену' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    toggle.focus();
    fireEvent.click(toggle);
    await waitFor(() => expect(api.setExamRemind).toHaveBeenCalledWith(ID, false));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByText('Бот не присылает план по этому экзамену. Другие экзамены — в профиле.')).toBeInTheDocument();
    expect(document.activeElement).toBe(toggle);
    // Not part of «Сохранить».
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(api.setExamRemind).toHaveBeenLastCalledWith(ID, true));
  });

  it('a member has the same switch; a failure is said and the switch stays', async () => {
    linked(false);
    api.state.summary = { ...solo(), role: 'member', owner: null };
    api.setExamRemind.mockRejectedValueOnce(new Error('Нет сети — попробуем ещё раз, когда она появится.'));
    renderAt();
    const toggle = await screen.findByRole('switch', { name: 'План в Telegram по этому экзамену' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет сети — попробуем ещё раз, когда она появится.');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('a server without the per-exam switches: none', async () => {
    api.fetchTelegramState.mockResolvedValue({ linked: true });
    api.telegramExams.mockResolvedValue(null);
    renderAt();
    await waitFor(() => expect(api.telegramExams).toHaveBeenCalled());
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('SettingsPage: «Это экзамен» / «Это тест» (release 47.3)', () => {
  it('the author switches it, saved at once (no «Сохранить»), and the page reads the exam again', async () => {
    api.state.summary = { ...solo(), kind: 'exam' };
    renderAt();
    const group = screen.getByRole('group', { name: 'Что это' });
    expect(within(group).getByRole('radio', { name: 'Это экзамен' })).toBeChecked();
    expect(group).toHaveAccessibleDescription('Вы готовитесь сами: план на каждый день, время в день, напоминания в Telegram.');
    fireEvent.click(within(group).getByRole('radio', { name: 'Это тест' }));
    await waitFor(() => expect(api.setContainerKind).toHaveBeenCalledWith(ID, 'test'));
    expect(await within(group).findByText('Сохранено: это тест.')).toBeInTheDocument();
    expect(group).toHaveAccessibleDescription('Вы даёте вопросы другим: студия, ссылка, контрольные. В ваш план на день он не входит.');
    expect(api.reload).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    fireEvent.click(within(group).getByRole('radio', { name: 'Это экзамен' }));
    await waitFor(() => expect(api.setContainerKind).toHaveBeenLastCalledWith(ID, 'exam'));
    expect(await within(group).findByText('Сохранено: это экзамен.')).toBeInTheDocument();
  });

  it('a failure is said and the choice goes back', async () => {
    api.state.summary = { ...solo(), kind: 'exam' };
    api.setContainerKind.mockRejectedValueOnce(new Error('Нет сети — попробуем ещё раз, когда она появится.'));
    renderAt();
    const group = screen.getByRole('group', { name: 'Что это' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Это тест' }));
    expect(await within(group).findByText('Нет сети — попробуем ещё раз, когда она появится.')).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'Это экзамен' })).toBeChecked();
    expect(api.reload).not.toHaveBeenCalled();
  });

  it('the author’s own test has no plan of their own here: no minutes, days or Telegram plan; the date stays', () => {
    api.state.summary = { ...solo(), kind: 'test' };
    renderAt();
    expect(screen.getByLabelText('Дата экзамена')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Время в день' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Дни занятий' })).toBeNull();
    expect(screen.queryByText(SETTINGS.noDate)).toBeNull();
    cleanup();
    api.state.summary = { ...solo(), kind: 'exam' };
    renderAt();
    expect(screen.getByRole('combobox', { name: 'Время в день' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Дни занятий' })).toBeInTheDocument();
  });

  it('a member has no switch; an older server (no kind) neither', () => {
    api.state.summary = { ...solo(), kind: 'test', role: 'member', owner: null };
    renderAt();
    expect(screen.queryByRole('group', { name: 'Что это' })).toBeNull();
    cleanup();
    api.state.summary = solo();
    renderAt();
    expect(screen.queryByRole('group', { name: 'Что это' })).toBeNull();
  });

  it('a test says «Удалить тест» with the words of the test’s page, and «Экзамены» says it is gone', async () => {
    api.state.summary = { ...solo(), kind: 'test', title: 'Кислоты' };
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить тест' }));
    expect(screen.getByRole('group', { name: 'Удалить «Кислоты»? Вопросы, контрольные и их результаты пропадут.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить тест' }));
    await waitFor(() => expect(api.deleteContainer).toHaveBeenCalledWith(ID));
    await waitFor(() => expect(where).toBe('/exams'));
  });

  it('?who=1 (from «Кто вошёл» of the exam page’s «Удалить») opens the members', async () => {
    api.state.summary = { ...solo(), owner: { members: 2, doubts_open: 0, links: [] } };
    renderAt(`/exams/c/${ID}/settings?who=1#group`);
    await waitFor(() => expect(api.fetchMembers).toHaveBeenCalledWith(ID));
    expect(within(document.getElementById('settings-group')!).getByRole('button', { name: 'Кто вошёл' })).toHaveAttribute('aria-expanded', 'true');
  });
});
