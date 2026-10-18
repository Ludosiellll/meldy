/**
 * «Настройки», the line under «Время в день» of an exam whose plan holds fewer questions than the exam (usability check
 * 2026-10-10, m6: «Чтобы увидеть все 50 вопросов…» under an exam of 54). The exam's size rides on the plan input
 * (hooks.ts buildData sets `examQuestions`); the page's own copy of the input, with the form's dates and days, keeps it.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import summaryJson from '../../../../contracts/container/summary.json';
import type { ContainerSummary, PlanInput } from '../../types/container';

const api = vi.hoisted(() => ({
  feasibility: vi.fn(),
  windowDays: vi.fn(),
  state: { summary: null as ContainerSummary | null, plan: null as PlanInput | null },
}));
vi.mock('../../api/containers', () => ({
  updateContainer: vi.fn(),
  updateSubject: vi.fn(),
  deleteSubject: vi.fn(),
  deleteContainer: vi.fn(),
  saveSettings: vi.fn(),
  leaveContainer: vi.fn(),
  createLink: vi.fn(),
  revokeLink: vi.fn(),
  fetchMembers: vi.fn().mockResolvedValue([]),
  removeMember: vi.fn(),
  moveExamDate: vi.fn(),
  telegramExams: vi.fn().mockResolvedValue(null),
  setExamRemind: vi.fn(),
  containerErrorText: () => 'Не получилось. Попробуйте ещё раз.',
}));
// «План в Telegram по этому экзамену» (release 47) is not what this file checks: Telegram is not linked.
vi.mock('../../api/telegram', () => ({ fetchTelegramState: vi.fn().mockResolvedValue(null) }));
vi.mock('../../lib/containers/bankCache', () => ({ forgetBank: vi.fn() }));
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
    error: null,
    reload: vi.fn(),
  }),
}));

import SettingsPage from './SettingsPage';

const SUMMARY = summaryJson as unknown as ContainerSummary;
const ID = SUMMARY.id;
// 18 questions with variants and an oral part of 7 (the sample summary): 25 in all; the plan holds 18 + 2 oral.
const PLAN: PlanInput = {
  v: 1,
  now: 0,
  tz: 'Europe/Minsk',
  containerId: ID,
  budgetMin: 45,
  firstPlanDay: '2026-12-14',
  subjects: SUMMARY.subjects.map((subject) => ({ id: subject.id, title: subject.title, date: subject.exam_date })),
  items: [
    ...Array.from({ length: 18 }, (_, index) => ({ id: `i${index}`, s: SUMMARY.subjects[0].id, f: 't' as const, tp: 1, o: index + 1 })),
    ...Array.from({ length: 2 }, (_, index) => ({ id: `o${index}`, s: SUMMARY.subjects[2].id, f: 'o' as const, tp: null, o: index + 1 })),
  ],
  today: { firstAt: null, doneSec: 0, newDone: {} },
  pace: null,
  ai: null,
  examQuestions: 25,
};
const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ');

beforeEach(() => {
  api.state.summary = { ...SUMMARY, subjects: SUMMARY.subjects.map((subject) => ({ ...subject, exam_date: null })), owner: { members: 0, doubts_open: 0, links: [] } };
  api.state.plan = PLAN;
  api.feasibility.mockReset().mockReturnValue({ neededMin: 20, option: 30, seenByDateEst: 20 });
  api.windowDays.mockReset().mockReturnValue(4);
});
afterEach(() => cleanup());

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/exams/c/${ID}/settings`]}>
      <Routes>
        <Route path="/exams/c/:id/settings" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const minutesLine = () => Array.from(document.querySelectorAll('.im-hint')).map((node) => plain(node.textContent)).find((text) => text.startsWith('Чтобы') || text.startsWith('При')) ?? '';

describe('«Настройки»: what the minutes reach names its count when the exam holds more', () => {
  it('«все 20 вопросов в плане» under an exam of 25, and still after the date changes in the form', () => {
    renderPage();
    expect(minutesLine()).toMatch(/^Чтобы увидеть все 20 вопросов в плане к \d+ \S+, нужно около 20 минут в день\./);
    expect(api.feasibility).toHaveBeenLastCalledWith(expect.objectContaining({ examQuestions: 25 }));
    // A new date in the form: the page's own copy of the input keeps the exam's size (the oral subject keeps its date).
    fireEvent.change(screen.getByLabelText('Дата экзамена'), { target: { value: '2027-01-14' } });
    const input = api.feasibility.mock.calls[api.feasibility.mock.calls.length - 1][0] as PlanInput;
    expect(input.subjects.find((subject) => subject.id === SUMMARY.subjects[0].id)?.date).toBe('2027-01-14');
    expect(input.examQuestions).toBe(25);
    expect(minutesLine()).toMatch(/^Чтобы увидеть все 20 вопросов в плане к \d+ \S+, нужно около 20 минут в день\./);
  });

  it('every question of the exam in the plan: the words as before', () => {
    api.state.plan = { ...PLAN, examQuestions: 20 };
    renderPage();
    expect(minutesLine()).toMatch(/^Чтобы увидеть все 20 вопросов к \d+ \S+, нужно около 20 минут в день\./);
  });
});
