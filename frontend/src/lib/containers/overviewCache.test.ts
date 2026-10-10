import { beforeEach, describe, expect, it } from 'vitest';
import type { ContainerSummary, ContainersOverview, PlanInputsWire } from '../../types/container';
import overviewJson from '../../../../contracts/container/overview.json';
import summaryJson from '../../../../contracts/container/summary.json';
import planInputsJson from '../../../../contracts/container/plan_inputs.json';
import { devicePut, resetDeviceDbForTests } from './deviceDb';
import { OVERVIEW_CACHE_VERSION, lastContainer, lastOverview, rememberContainer, rememberOverview } from './overviewCache';
import type { OralPlanPart } from './oralPlan';

const overview = overviewJson as unknown as ContainersOverview;
const summary = summaryJson as unknown as ContainerSummary;
const plan = planInputsJson as unknown as PlanInputsWire;
const C1 = summary.id;
const A = 'user-a';
const B = 'user-b';
const oral: OralPlanPart[] = [{ examId: 'c0390f9c-787d-4d0e-a82d-9efa069bfe11', subjectId: summary.subjects[2].id, items: [], withoutPoints: 7, examDate: '2027-01-20' }];

beforeEach(() => {
  resetDeviceDbForTests();
});

describe('the overview of an account', () => {
  it('is kept per account', async () => {
    expect(await lastOverview(A)).toBeNull();
    await rememberOverview(A, overview, plan);
    const kept = await lastOverview(A);
    expect(kept?.overview).toEqual(overview);
    expect(kept?.plan).toEqual(plan);
    expect(typeof kept?.savedAt).toBe('number');
    expect(await lastOverview(B)).toBeNull();
    expect(await lastOverview('')).toBeNull();
  });

  it('an overview without plan inputs keeps the ones read before; new plan inputs replace them', async () => {
    await rememberOverview(A, overview, plan);
    const later = { ...overview, day: '2026-12-22' };
    await rememberOverview(A, later, null);
    expect((await lastOverview(A))?.overview.day).toBe('2026-12-22');
    expect((await lastOverview(A))?.plan).toEqual(plan);
    const newer = { ...plan, day: '2026-12-22' };
    await rememberOverview(A, later, newer);
    expect((await lastOverview(A))?.plan?.day).toBe('2026-12-22');
    await rememberOverview(B, overview, null);
    expect((await lastOverview(B))?.plan).toBeNull();
  });

  it('a record of another layout version is not read', async () => {
    await devicePut('overviews', A, { v: OVERVIEW_CACHE_VERSION + 1, overview, plan: null, savedAt: 1 });
    expect(await lastOverview(A)).toBeNull();
    await devicePut('overviews', A, { v: OVERVIEW_CACHE_VERSION, overview: { nope: true }, plan: null, savedAt: 1 });
    expect(await lastOverview(A)).toBeNull();
  });
});

describe('one exam of an account', () => {
  it('keeps the summary, its plan inputs and the oral items, per account and exam', async () => {
    await rememberContainer(A, C1, { summary, plan, oral });
    expect(await lastContainer(A, C1)).toEqual({ summary, plan, oral, savedAt: expect.any(Number) });
    expect(await lastContainer(B, C1)).toBeNull();
    expect(await lastContainer(A, 'another')).toBeNull();
  });

  it('a broken or older record is not read', async () => {
    await devicePut('containers', `${A}:${C1}`, { v: OVERVIEW_CACHE_VERSION, summary, plan: { items: 'x' }, oral, savedAt: 1 });
    expect(await lastContainer(A, C1)).toBeNull();
    await devicePut('containers', `${A}:${C1}`, { v: 0, summary, plan, oral, savedAt: 1 });
    expect(await lastContainer(A, C1)).toBeNull();
  });
});
