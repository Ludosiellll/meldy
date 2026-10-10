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
  state: { summary: null as ContainerSummary | null, plan: null as PlanInput | null },
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
}));
vi.mock('../../lib/containers/bankCache', () => ({ forgetBank: api.forgetBank }));
vi.mock('../../lib/containers/plan', () => ({ feasibility: api.feasibility, windowDays: api.windowDays }));
vi.mock('../../lib/containers/hooks', () => ({
  useContainerData: () => ({
    data: api.state.summary ? { summary: api.state.summary, planInput: api.state.plan, items: new Map(), oralWithoutPoints: 0 } : null,
    loading: false,
    offline: false,
    unavailable: false,
    error: null,
    reload: api.reload,
  }),
}));

import SettingsPage from './SettingsPage';
import { SETTINGS } from '../../components/containers/copyImport';

const SUMMARY = summaryJson as unknown as ContainerSummary;
const ID = SUMMARY.id;
const PLAN: PlanInput = {
  v: 1,
  now: 0,
  tz: 'Europe/Minsk',
  containerId: ID,
  budgetMin: 45,
  firstPlanDay: '2026-12-14',
  subjects: [],
  items: Array.from({ length: 960 }, (_, index) => ({ id: `i${index}`, s: 's', f: 't' as const, tp: 1, o: index + 1 })),
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
  for (const fn of [api.updateContainer, api.updateSubject, api.deleteSubject, api.deleteContainer, api.saveSettings, api.leaveContainer, api.forgetBank]) {
    fn.mockReset().mockResolvedValue(undefined);
  }
  api.fetchMembers.mockReset().mockResolvedValue([]);
  api.removeMember.mockReset().mockResolvedValue(0);
  api.feasibility.mockReset().mockReturnValue({ neededMin: 40, option: 45, seenByDateEst: 960 });
  api.windowDays.mockReset().mockReturnValue(4);
  api.reload.mockReset();
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
    expect(api.saveSettings).toHaveBeenCalledWith(ID, { minutes_per_day: 90, study_weekdays: 127 });
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

  it('says honestly what the minutes reach when they fall short, the final window under «Подробнее»', async () => {
    api.feasibility.mockImplementation((input: PlanInput) => ({ neededMin: 72, option: 90, seenByDateEst: input.budgetMin === 30 ? 704 : 960 }));
    renderAt();
    fireEvent.click(screen.getByRole('combobox', { name: 'Время в день' }));
    fireEvent.click(await screen.findByRole('option', { name: /^30\sминут$/ }));
    expect(screen.getByText(/При 30\sминутах к 12\sянваря вы увидите около 700 из 960\. Чтобы увидеть все, нужно около 75\sминут\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }));
    expect(screen.getByText(/С 8\sянваря новых вопросов не будет: последние 4\sдня — только знакомые, сначала ошибки\./)).toBeInTheDocument();
  });

  it('renames and removes a subject; the last subject is removed only with the exam', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: История Беларуси' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Переименовать' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Переименовать' }), { target: { value: 'История' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(api.updateSubject).toHaveBeenCalledWith(SUMMARY.subjects[1].id, { title: 'История' }));

    fireEvent.click(screen.getByRole('button', { name: 'Ещё: История Беларуси' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Убрать предмет' }));
    expect(screen.getByText(/Убрать «История Беларуси»\? Его вопросы и ответы по ним пропадут\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(api.deleteSubject).toHaveBeenCalledWith(SUMMARY.subjects[1].id));

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
    expect(screen.getByText(/Сначала уберите участников: в экзамене 3\sучастника\./)).toBeInTheDocument();
    expect(api.deleteContainer).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByText(/Сначала уберите участников/).closest('p')!).getByRole('button', { name: 'Кто вошёл' }));
    await waitFor(() => expect(api.fetchMembers).toHaveBeenCalledWith(ID));
  });

  it('deletes an exam without members, and shows the database’s refusal when someone joined meanwhile', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить экзамен' }));
    expect(screen.getByText(/Удалить «Зимняя сессия»\? Вопросы, ответы и прогресс пропадут\. Устные предметы останутся в «Экзаменах» отдельно\./)).toBeInTheDocument();
    api.deleteContainer.mockRejectedValueOnce(Object.assign(new Error('the container has members'), { code: 'MC009' }));
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.removeYes }));
    expect(await screen.findByText(/Сначала уберите участников: в экзамене 1\sучастник\./)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.leaveYes }));
    await waitFor(() => expect(api.leaveContainer).toHaveBeenCalledWith(ID));
    await waitFor(() => expect(where).toBe('/exams'));
  });

  it('opens «Пригласить группу» from ?invite=1 and links «Добавить предмет» to the import page', () => {
    renderAt(`/exams/c/${ID}/settings?invite=1`);
    expect(screen.getByRole('dialog', { name: 'Пригласить группу' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Добавить предмет' })).toHaveAttribute('href', `/exams/import?from=c:${ID}`);
  });
});
