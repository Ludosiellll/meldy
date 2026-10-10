import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerSummary, ContainersOverview, PlanInputsWire, PlanItem, TestItem } from '../../types/container';
import overviewJson from '../../../../contracts/container/overview.json';
import summaryJson from '../../../../contracts/container/summary.json';
import planInputsJson from '../../../../contracts/container/plan_inputs.json';
import itemsPageJson from '../../../../contracts/container/items_page.json';

const auth = vi.hoisted(() => ({ current: { user: { id: 'user-a' } as { id: string } | null, loading: false } }));
const api = vi.hoisted(() => ({ fetchOverview: vi.fn(), fetchSummary: vi.fn(), fetchPlanInputs: vi.fn() }));
const titles = vi.hoisted(() => ({ rememberContainerTitle: vi.fn(), rememberAttachedExams: vi.fn() }));
const queue = vi.hoisted(() => ({ flushAnswers: vi.fn(), pendingAnswers: vi.fn() }));
const bank = vi.hoisted(() => ({ loadBank: vi.fn(), getBank: vi.fn() }));
const oral = vi.hoisted(() => ({ loadOralPlanItems: vi.fn() }));

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth.current }));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  fetchOverview: api.fetchOverview,
  fetchSummary: api.fetchSummary,
  fetchPlanInputs: api.fetchPlanInputs,
}));
vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('./titleCache', () => titles);
vi.mock('./answerQueue', () => queue);
vi.mock('./bankCache', async (importOriginal) => ({ ...(await importOriginal<typeof import('./bankCache')>()), ...bank }));
vi.mock('./oralPlan', () => oral);
// Package D2's day arithmetic and pace blend, as their contracts say (stubs until D2 lands).
vi.mock('./time', () => ({
  addDays: (day: string, n: number) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  },
  localDay: (ms: number, tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms),
}));
vi.mock('./pace', () => ({ paceFrom: (_rows: unknown, count: number) => Array.from({ length: count }, () => null) }));

import { CONTAINER_ERROR_TEXT, ContainerApiError } from '../../api/containers';
import { resetDeviceDbForTests } from './deviceDb';
import { attachedFrom, useContainerData, useContainersOverview } from './hooks';
import { lastContainer, lastOverview, rememberContainer, rememberOverview } from './overviewCache';
import type { OralPlanPart } from './oralPlan';

const overview = overviewJson as unknown as ContainersOverview;
const summary = summaryJson as unknown as ContainerSummary;
const wire = planInputsJson as unknown as PlanInputsWire;
const items = itemsPageJson as unknown as TestItem[];
const A = 'user-a';
const C1 = summary.id;
const ORAL = 'c0390f9c-787d-4d0e-a82d-9efa069bfe11';
const [S1, S2, S3] = summary.subjects.map((subject) => subject.id);
const OTHER = '0b6f3c2e-9a1d-4e7b-8c5a-2d4e6f8a0b1c';
const OTHER_ORAL = '5d1e7a9c-3b2f-4c6d-9e8a-1f0b2c3d4e5f';

const oralItem: PlanItem = { id: 'oral-q1', s: S3, f: 'o', tp: null, o: 1, l: [], m: { sc: null, rating: 0, ac: null, prepared: false } };
const oralParts: OralPlanPart[] = [{ examId: ORAL, subjectId: S3, items: [oralItem], withoutPoints: 6, examDate: '2027-01-25' }];
const networkDown = () => new ContainerApiError('network', CONTAINER_ERROR_TEXT.network, { status: 0 });

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(wire.now * 1000);
  resetDeviceDbForTests();
  auth.current = { user: { id: A }, loading: false };
  setOnline(true);
  api.fetchOverview.mockReset().mockResolvedValue(overview);
  api.fetchSummary.mockReset().mockResolvedValue(summary);
  api.fetchPlanInputs.mockReset().mockResolvedValue(wire);
  bank.loadBank.mockReset().mockResolvedValue(items);
  bank.getBank.mockReset().mockResolvedValue({ stamp: 'old', items });
  oral.loadOralPlanItems.mockReset().mockResolvedValue(oralParts);
  queue.flushAnswers.mockReset().mockResolvedValue(undefined);
  queue.pendingAnswers.mockReset().mockReturnValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'onLine');
});

describe('useContainersOverview', () => {
  it('loads the overview for the device’s day, remembers titles and attached exams, keeps it on the device', async () => {
    const { result } = renderHook(() => useContainersOverview());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ data: overview, offline: false, unavailable: false, error: null });
    expect(api.fetchOverview).toHaveBeenCalledWith('2026-12-21');
    expect(titles.rememberContainerTitle).toHaveBeenCalledWith(C1, 'Зимняя сессия');
    expect(titles.rememberAttachedExams).toHaveBeenCalledWith({ [ORAL]: { containerId: C1, title: 'Зимняя сессия' } });
    expect(queue.flushAnswers).toHaveBeenCalledWith(A);
    expect((await lastOverview(A))?.overview).toEqual(overview);
  });

  it('without network draws the last overview of this account, marked offline, and remembers its titles too', async () => {
    await rememberOverview(A, overview, null);
    api.fetchOverview.mockRejectedValue(networkDown());
    const { result } = renderHook(() => useContainersOverview());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ data: overview, offline: true, unavailable: false, error: null });
    expect(titles.rememberAttachedExams).toHaveBeenCalledWith({ [ORAL]: { containerId: C1, title: 'Зимняя сессия' } });
  });

  it('when the browser says it is offline, no request is made', async () => {
    await rememberOverview(A, overview, null);
    setOnline(false);
    const { result } = renderHook(() => useContainersOverview());
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(api.fetchOverview).not.toHaveBeenCalled();
    expect(result.current.data).toEqual(overview);
  });

  it('without network and nothing kept: offline with the Russian line, no data', async () => {
    api.fetchOverview.mockRejectedValue(networkDown());
    const { result } = renderHook(() => useContainersOverview());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ data: null, offline: true, error: CONTAINER_ERROR_TEXT.network });
  });

  it('a database without the container functions is unavailable, never offline', async () => {
    api.fetchOverview.mockResolvedValue(null);
    const { result } = renderHook(() => useContainersOverview());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ data: null, unavailable: true, offline: false, error: null });
    expect(titles.rememberAttachedExams).not.toHaveBeenCalled();
  });

  it('another failure is an error, not the cache', async () => {
    await rememberOverview(A, overview, null);
    api.fetchOverview.mockRejectedValue(new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown, { status: 500 }));
    const { result } = renderHook(() => useContainersOverview());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ data: null, offline: false, unavailable: false, error: CONTAINER_ERROR_TEXT.unknown });
  });

  it('signed out: nothing is read; while the session is read: loading', () => {
    auth.current = { user: null, loading: true };
    const { result, rerender } = renderHook(() => useContainersOverview());
    expect(result.current.loading).toBe(true);
    auth.current = { user: null, loading: false };
    rerender();
    expect(result.current).toMatchObject({ data: null, loading: false, error: null });
    expect(api.fetchOverview).not.toHaveBeenCalled();
  });

  it('reload reads again; the network coming back after an offline read reads again by itself', async () => {
    await rememberOverview(A, overview, null);
    api.fetchOverview.mockRejectedValueOnce(networkDown());
    const { result } = renderHook(() => useContainersOverview());
    await waitFor(() => expect(result.current.offline).toBe(true));
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.offline).toBe(false));
    expect(api.fetchOverview).toHaveBeenCalledTimes(2);
    act(() => result.current.reload());
    await waitFor(() => expect(api.fetchOverview).toHaveBeenCalledTimes(3));
  });
});

describe('useContainerData', () => {
  it('loads the summary, the plan input with oral questions and the bank, and remembers the title', async () => {
    const { result } = renderHook(() => useContainerData(C1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const data = result.current.data!;
    expect(result.current).toMatchObject({ offline: false, unavailable: false, error: null });
    expect(api.fetchSummary).toHaveBeenCalledWith(C1, '2026-12-21');
    expect(api.fetchPlanInputs).toHaveBeenCalledWith('2026-12-21', C1);
    expect(bank.loadBank).toHaveBeenCalledWith(C1, '18:2026-12-14T16:03:05.069454+00:00', [S1, S2, S3]);
    expect(oral.loadOralPlanItems).toHaveBeenCalledWith([{ examId: ORAL, subjectId: S3 }], wire.now * 1000, expect.any(String));
    expect(data.summary).toEqual(summary);
    expect(data.items.get(items[0].id)).toEqual(items[0]);
    expect(data.items.size).toBe(items.length);
    expect(data.oralWithoutPoints).toBe(6);
    expect(data.planInput).toMatchObject({ containerId: C1, budgetMin: 45, firstPlanDay: '2026-12-14' });
    expect(data.planInput.items).toHaveLength(19);
    expect(data.planInput.items[18]).toEqual(oralItem);
    expect(titles.rememberContainerTitle).toHaveBeenCalledWith(C1, 'Зимняя сессия');
    expect(queue.flushAnswers).toHaveBeenCalledWith(A);
    expect((await lastContainer(A, C1))?.oral).toEqual(oralParts);
  });

  it('a subject with only an oral part in the plan takes its oral exam’s date; test subjects keep theirs', async () => {
    const { result } = renderHook(() => useContainerData(C1));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data!.planInput.subjects.map((subject) => subject.date)).toEqual(['2027-01-12', '2027-01-16', '2027-01-25']);
  });

  it('merges its oral exams into the attached map the last overview gave, replacing its own entries', async () => {
    const other = { ...overview.containers[0], id: OTHER, title: 'Летняя сессия', subjects: [{ ...overview.containers[0].subjects[2], oral_exam_id: OTHER_ORAL }] };
    const stale = { ...overview, containers: [{ ...overview.containers[0], subjects: [{ ...overview.containers[0].subjects[2], oral_exam_id: 'gone-oral' }] }, other] };
    await rememberOverview(A, stale, null);
    const { result } = renderHook(() => useContainerData(C1));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(titles.rememberAttachedExams).toHaveBeenLastCalledWith({
      [OTHER_ORAL]: { containerId: OTHER, title: 'Летняя сессия' },
      [ORAL]: { containerId: C1, title: 'Зимняя сессия' },
    });
  });

  it('answers waiting in the queue are answered today in the plan input', async () => {
    queue.pendingAnswers.mockReturnValue([{ client_event_id: 'offline:1', item_id: wire.items[11][0], chosen: 0, ms: 20_000 }]);
    const { result } = renderHook(() => useContainerData(C1));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const input = result.current.data!.planInput;
    expect(queue.pendingAnswers).toHaveBeenCalledWith(A);
    expect(input.items.find((item) => item.id === wire.items[11][0])?.u?.lastDay).toBe('2026-12-21');
    expect(input.today.doneSec).toBe(119 + 20);
  });

  it('without network draws the last summary, plan inputs and oral items with the bank on the device', async () => {
    await rememberContainer(A, C1, { summary, plan: wire, oral: oralParts });
    api.fetchSummary.mockRejectedValue(networkDown());
    const { result } = renderHook(() => useContainerData(C1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.offline).toBe(true);
    expect(result.current.data?.summary).toEqual(summary);
    expect(result.current.data?.items.size).toBe(items.length);
    expect(result.current.data?.planInput.items).toHaveLength(19);
    expect(bank.getBank).toHaveBeenCalledWith(C1);
    expect(titles.rememberContainerTitle).toHaveBeenCalledWith(C1, 'Зимняя сессия');
  });

  it('without network and nothing kept: offline with the Russian line', async () => {
    api.fetchPlanInputs.mockRejectedValue(networkDown());
    const { result } = renderHook(() => useContainerData(C1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ data: null, offline: true, error: CONTAINER_ERROR_TEXT.network });
  });

  it('the oral sheet failing alone keeps the last oral items; the rest is fresh', async () => {
    await rememberContainer(A, C1, { summary, plan: wire, oral: oralParts });
    oral.loadOralPlanItems.mockRejectedValue(new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown, { status: 502 }));
    const { result } = renderHook(() => useContainerData(C1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.offline).toBe(false);
    expect(result.current.data?.oralWithoutPoints).toBe(6);
    expect(result.current.data?.planInput.items).toHaveLength(19);
  });

  it('a database without the container functions is unavailable; another failure is an error', async () => {
    api.fetchSummary.mockRejectedValue(new ContainerApiError('unavailable', CONTAINER_ERROR_TEXT.unavailable, { status: 404 }));
    const { result } = renderHook(() => useContainerData(C1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ data: null, unavailable: true, offline: false });
    api.fetchSummary.mockRejectedValue(new ContainerApiError('P0002', CONTAINER_ERROR_TEXT.P0002, { status: 500 }));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe(CONTAINER_ERROR_TEXT.P0002));
    expect(result.current.unavailable).toBe(false);
    // Not the user's any more (deleted, left, removed: P0002 comes as HTTP 500): gone, which another try cannot change.
    expect(result.current.gone).toBe(true);
    api.fetchSummary.mockRejectedValue(new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown, { status: 502 }));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe(CONTAINER_ERROR_TEXT.unknown));
    expect(result.current.gone).toBe(false);
  });

  it('no network is never gone, even for an exam not kept on the device', async () => {
    api.fetchSummary.mockRejectedValue(networkDown());
    const { result } = renderHook(() => useContainerData(C1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ data: null, offline: true, error: CONTAINER_ERROR_TEXT.network });
    expect(result.current.gone).toBeFalsy();
  });

  it('another exam id reads that exam', async () => {
    const { result, rerender } = renderHook(({ id }) => useContainerData(id), { initialProps: { id: C1 } });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    api.fetchSummary.mockResolvedValue({ ...summary, id: OTHER, title: 'Летняя сессия' });
    api.fetchPlanInputs.mockResolvedValue({ ...wire, containers: [{ ...wire.containers[0], id: OTHER }] });
    rerender({ id: OTHER });
    await waitFor(() => expect(result.current.data?.summary.id).toBe(OTHER));
    expect(api.fetchSummary).toHaveBeenLastCalledWith(OTHER, '2026-12-21');
  });
});

describe('attachedFrom', () => {
  it('maps every oral exam of the overview to its container and title', () => {
    expect(attachedFrom(overview)).toEqual({ [ORAL]: { containerId: C1, title: 'Зимняя сессия' } });
    expect(attachedFrom({ ...overview, containers: [] })).toEqual({});
  });
});
