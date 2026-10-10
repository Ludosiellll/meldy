/**
 * «Сегодня» on the real study engine (package D2's planDay and plan words): two exam containers, their plan inputs built
 * with D2's own scenario fixtures; only package D1's hooks and package D3b's card are stood in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ContainersOverview, OverviewContainer, PlanInput } from '../types/container';
import { addDays, localDay } from '../lib/containers/time';
import { planDay } from '../lib/containers/plan';
import { shownMinutes } from '../lib/containers/words';
import { TZ, makeInput, testItems } from '../lib/containers/__fixtures__/scenarios';

const db = vi.hoisted(() => ({ tables: {} as Record<string, () => { data?: unknown; error?: unknown; count?: number }> }));
const layer = vi.hoisted(() => ({ overview: null as unknown, inputs: {} as Record<string, unknown> }));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'gte', 'lte', 'in', 'order', 'limit', 'range']) builder[method] = () => builder;
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, ...(db.tables[table]?.() ?? {}) }).then(resolve, reject);
      return builder;
    },
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1', user_metadata: { full_name: 'Алина Соколова' } }, loading: false }) }));
vi.mock('../api/flashcards', () => ({ countDueCards: async () => 0, getDueCards: async () => [], syncFlashcards: async () => ({ inserted: 0, skipped: 0 }) }));
vi.mock('../api/learning', () => ({ fetchQuestionEvents: async () => [], fetchSheetEvents: async () => [] }));
vi.mock('../api/cheatSheet', () => ({ fetchSheet: async () => ({ examId: '', mappingState: 'none', questions: [], toWrite: 0, units: 0, job: null }) }));
vi.mock('../lib/containers/hooks', () => {
  const answers = new Map<string, unknown>();
  return {
    useContainersOverview: () => layer.overview,
    useContainerData: (id: string) => {
      if (!answers.has(id)) answers.set(id, { data: { summary: {}, planInput: layer.inputs[id], items: new Map(), oralWithoutPoints: 0 }, loading: false, offline: false, unavailable: false, error: null, reload: () => undefined });
      return answers.get(id);
    },
  };
});
vi.mock('../components/containers/TodayExamCard', () => ({
  default: (props: { container: { id: string }; plan: { state: string; counts: { leftSec: number } } | null; lead: boolean }) => (
    <article data-testid="today-card" data-id={props.container.id} data-plan={props.plan?.state ?? 'none'} data-left={props.plan?.counts.leftSec ?? ''}>
      <a className={props.lead ? 'sf-primary' : 'sf-link'} href={`/exams/c/${props.container.id}/study`}>
        Начать
      </a>
    </article>
  ),
}));

import Dashboard, { PLAN_WAIT } from './Dashboard';
import { LAYER_WAIT } from './containerLayer';

const plain = (text: string | null | undefined) => (text ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

function container(id: string, title: string, date: string, items: number): OverviewContainer {
  return {
    id,
    title,
    exam_date: date,
    created_at: '2026-10-01T10:00:00Z',
    role: 'owner',
    items,
    items_updated_at: null,
    subjects: [{ id: `${id}-s1`, position: 1, title: 'Базы данных', exam_date: date, oral_exam_id: null, has_oral: false, keyed: items, no_key: 0, seen: 0, two_days: 0, open_errors: 0, seen_today: 0, doubted: 0, stale: 0 }],
    answers_today: 0,
    settings: null,
  };
}

let NOW: number;
let TODAY: string;

beforeEach(() => {
  LAYER_WAIT.ms = 40;
  PLAN_WAIT.ms = 2000;
  window.localStorage.clear();
  window.localStorage.setItem('meldy_first_steps_user-1', 'done');
  NOW = Date.now();
  TODAY = localDay(NOW, TZ);
  db.tables = { exams: () => ({ data: [] }), materials: () => ({ data: [] }), study_sessions: () => ({ data: [] }) };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  LAYER_WAIT.ms = 2500;
  PLAN_WAIT.ms = 3000;
});

describe('«Сегодня» on the real planDay', () => {
  it('the nearer container with work today leads with the one blue button; the other’s row says its minutes in the plan’s words', async () => {
    const near = addDays(TODAY, 9);
    const far = addDays(TODAY, 60);
    const nearInput: PlanInput = { ...makeInput({ now: NOW, subjects: [{ id: 'near-s1', date: near }], items: testItems('near-s1', 240), budgetMin: 45 }), containerId: 'near' };
    const farInput: PlanInput = { ...makeInput({ now: NOW, subjects: [{ id: 'far-s1', date: far }], items: testItems('far-s1', 120), budgetMin: 30 }), containerId: 'far' };
    layer.inputs = { near: nearInput, far: farInput };
    const overview: ContainersOverview = { v: 1, day: TODAY, containers: [container('far', 'Зимняя сессия', far, 120), container('near', 'Аккредитация', near, 240)], attached_exam_ids: [] };
    layer.overview = { data: overview, loading: false, offline: false, unavailable: false, error: null, reload: () => undefined };

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    const card = await screen.findByTestId('today-card');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const nearPlan = planDay(nearInput);
    const farPlan = planDay(farInput);
    expect(nearPlan.state).toBe('study');
    expect(card).toHaveAttribute('data-id', 'near');
    expect(card).toHaveAttribute('data-plan', 'study');
    expect(card).toHaveAttribute('data-left', String(nearPlan.counts.leftSec));
    expect(Array.from(document.querySelectorAll('.sf-primary'))).toEqual([within(card).getByRole('link', { name: 'Начать' })]);
    const row = within(screen.getByRole('region', { name: 'Другие экзамены' })).getByRole('link', { name: /Зимняя сессия/ });
    const minutes = shownMinutes(farPlan.counts.leftSec);
    expect(farPlan.state).toBe('study');
    expect(plain(row.querySelector('.tdc-m')?.textContent)).toMatch(new RegExp(` · сегодня около ${minutes} минуты?$`));
  });
});
