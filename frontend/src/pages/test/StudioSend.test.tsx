import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestDoc } from '../../types/testDoc';

/**
 * Why «Отправить по ссылке» waits (UX audit of 21.10, P3): said on the page, not only in a tooltip, and the button stays
 * on a phone. StudioPage with its data mocked as in StudioPhone.test.tsx.
 */
const api = vi.hoisted(() => ({
  fetchTestDoc: vi.fn(),
  saveTestDoc: vi.fn(),
  state: { summary: null as unknown, items: null as unknown },
}));

vi.mock('../../api/containers', () => ({
  addItems: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  reorderItems: vi.fn(),
  isGone: () => false,
  isOffline: () => false,
}));
vi.mock('../../api/testDocs', () => ({
  fetchTestDoc: api.fetchTestDoc,
  saveTestDoc: api.saveTestDoc,
  isStale: () => false,
  refusedRule: () => null,
}));
vi.mock('../../lib/containers/hooks', () => ({
  useContainerData: () => ({
    data: { summary: api.state.summary, items: api.state.items, planInput: null, oralWithoutPoints: 0 },
    loading: false,
    offline: false,
    unavailable: false,
    error: null,
    gone: false,
    reload: vi.fn(),
  }),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, session: null, loading: false }) }));

import StudioPage from './StudioPage';
import { item, subject, summary } from '../../components/containers/testkit/fixtures';
import { STUDIO } from '../../components/studio/copyStudio';
import { STUDIO_PASTE } from '../../components/quick/copyQuick';
import { emptyDoc } from '../../lib/studio/doc';

const EXAM = '11111111-2222-4333-8444-555555555555';
const SUBJ = '22222222-3333-4444-8555-666666666666';
const base = { container_id: EXAM, subject_id: SUBJ, topic: null, key_source: 'manual' as const, images: null };
const UNKEYED = item({ ...base, id: 'c0000000-0000-4000-8000-000000000001', position: 1, file_no: '1', stem: 'Столица Франции?', options: ['Париж', 'Лион'], correct: [] });

function doc(): TestDoc {
  return {
    ...emptyDoc('Тест'),
    layout: 'one_page',
    blocks: [{ type: 'question', id: 'qblock000001', item_id: UNKEYED.id, points: 1, required: false }],
  };
}

async function open(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc: doc(), rev: 3, updated_at: '2026-10-19T08:00:00Z' });
  render(
    <MemoryRouter initialEntries={[`/exams/c/${EXAM}/studio`]}>
      <Routes>
        <Route path="/exams/c/:id/studio" element={<StudioPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.findByText(STUDIO.sendWhy);
}

beforeEach(() => {
  api.state.summary = summary({
    id: EXAM,
    title: 'Тест',
    exam_date: null,
    subjects: [subject({ id: SUBJ, title: 'Вопросы', exam_date: null, oral: null, topic_titles: [], topics: [], kinds: { single: 1, multiple: 0, short: 0 } })],
    owner: { members: 0, doubts_open: 0, links: [] },
  });
  api.state.items = new Map([[UNKEYED.id, UNKEYED]]);
  api.saveTestDoc.mockReset().mockImplementation(async (_id: string, _doc: TestDoc, rev: number) => ({ rev: rev + 1, updated_at: '2026-10-19T08:00:01Z' }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('«Отправить по ссылке» waits, and says why', () => {
  it('on a computer: the line is on the page and the button points to it', async () => {
    const line = await open(1440);
    expect(line).not.toHaveClass('sr-only');
    const send = screen.getByRole('button', { name: STUDIO.send });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription(STUDIO.sendWhy);
  });

  it('on a phone the button stays in the bottom bar, shut, with the same line', async () => {
    await open(390);
    const send = document.querySelector('.st-phonebar .st-send') as HTMLButtonElement;
    expect(send).not.toBeNull();
    expect(send).toBeDisabled();
  });
});
