import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* The first-use tip of «Поговорить о лекции» on the lecture page (components/tips). */

type Material = {
  id: string;
  user_id: string;
  title: string;
  subject: string;
  is_public: boolean;
  created_at: string;
  original_text: string;
  summary_json: Record<string, unknown>;
  flashcards_json: unknown;
  quiz_json: unknown;
};

const state = vi.hoisted(() => ({
  material: null as unknown as Material,
  userId: 'user-1',
  getProfile: vi.fn(),
  markSeen: vi.fn(),
  track: vi.fn(),
}));

vi.mock('../api/materials', () => ({
  getMaterialById: vi.fn(async () => JSON.parse(JSON.stringify(state.material))),
  updateMaterialSubject: vi.fn(),
  updateMaterialTitle: vi.fn(),
  setMaterialVisibility: vi.fn(),
}));
vi.mock('../api/social', () => ({
  getProfile: (...args: unknown[]) => state.getProfile(...args),
  markOnboardingTourSeen: (...args: unknown[]) => state.markSeen(...args),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: state.userId } }) }));
// The count of cards from ticket answers is a request to flashcard_progress: none here.
vi.mock('../lib/followupCards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/followupCards')>()),
  followupCardsOf: vi.fn(async () => 0),
}));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), alert: vi.fn() }) }));
vi.mock('../lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/telemetry')>()),
  track: (...args: unknown[]) => state.track(...args),
}));
// The panels under the tabs have their own tests; here they only take their place.
vi.mock('../components/ResultsPanel', () => ({ default: () => <div data-testid="panel">Конспект</div> }));
vi.mock('../components/ExpressPrepView', () => ({ default: () => <div data-testid="express">Подкаст</div> }));
vi.mock('../components/tips/clipPart', async () => {
  const { lazyPart } = await import('../lib/lazyPart');
  return { tipClipPart: lazyPart(async () => () => <div data-testid="clip" />) };
});

import MaterialDetail from './MaterialDetail';
import { TIP_SETTLE_MS } from '../components/tips/useFirstUseTip';

function Room() {
  return <p data-testid="room">{useLocation().pathname}</p>;
}

function renderPage(url = '/library/m1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/library/:id" element={<MaterialDetail />} />
        <Route path="/library/:id/talk" element={<Room />} />
      </Routes>
    </MemoryRouter>,
  );
}

function lecture(patch: Partial<Material> = {}): Material {
  return {
    id: 'm1',
    user_id: 'user-1',
    title: 'Природные ресурсы',
    subject: 'Экология',
    is_public: false,
    created_at: '2026-10-05T08:00:00Z',
    original_text: 'Исчерпаемые ресурсы со временем заканчиваются, возобновляемые восстанавливаются.',
    summary_json: { content: 'Конспект', terms: [] },
    flashcards_json: {
      flashcards: [
        { id: 1, question: 'Чем исчерпаемые ресурсы отличаются от возобновляемых?', answer: 'Исчерпаемые заканчиваются.', source_ids: ['S01'] },
        { id: 2, question: 'Приведите пример возобновляемого ресурса.', answer: 'Лес.', source_ids: ['S01'] },
      ],
    },
    quiz_json: null,
    ...patch,
  };
}

/** The lecture loads, the profile is read, the page settles. */
async function settle(ms = TIP_SETTLE_MS + 50) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const tip = () => document.querySelector('.tp-card');
const talkPill = () => screen.getByRole('link', { name: /Поговорить о лекции/ });

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  state.material = lecture();
  state.userId = 'user-1';
  state.getProfile.mockReset().mockResolvedValue({ id: 'user-1', onboarding_status: { guide: true } });
  state.markSeen.mockReset().mockResolvedValue(undefined);
  state.track.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the «Поговорить о лекции» tip on the lecture page', () => {
  it('comes once the page has settled: right after the pill, the pill ringed, in the room’s own words', async () => {
    renderPage();
    await settle(10);
    expect(talkPill()).toBeInTheDocument();
    expect(tip()).toBeNull();
    await settle();
    const card = screen.getByRole('region', { name: 'Поговорить о лекции' });
    expect(talkPill().nextElementSibling).toBe(card);
    expect(talkPill()).toHaveAttribute('data-tip-spot');
    expect(card).toHaveTextContent('Meldy задаст вопросы по карточкам этой лекции');
    expect(screen.getByRole('link', { name: 'Попробовать' })).toHaveAttribute('href', '/library/m1/talk');
    expect(document.activeElement).toBe(document.body);
    expect(state.track).toHaveBeenCalledWith('tip_shown', { id: 'talk' });
  });

  it('«Попробовать» opens the room and the tip is done, here and in the profile', async () => {
    renderPage();
    await settle();
    await settle();
    fireEvent.click(screen.getByRole('link', { name: 'Попробовать' }));
    await settle(0);
    expect(screen.getByTestId('room')).toHaveTextContent('/library/m1/talk');
    expect(window.localStorage.getItem('meldy_tip_talk')).toBe('1');
    expect(state.markSeen).toHaveBeenCalledWith('user-1', 'tip_talk');
    expect(state.track).toHaveBeenCalledWith('tip_action', { id: 'talk', action: 'try' });
  });

  it('the pill itself marks the tip done', async () => {
    renderPage();
    await settle();
    await settle();
    fireEvent.click(talkPill());
    await settle(0);
    expect(screen.getByTestId('room')).toBeInTheDocument();
    expect(window.localStorage.getItem('meldy_tip_talk')).toBe('1');
    expect(state.markSeen).toHaveBeenCalledWith('user-1', 'tip_talk');
  });

  it('«Не сейчас» puts it away for good', async () => {
    renderPage();
    await settle();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }));
    await settle(0);
    expect(tip()).toBeNull();
    expect(talkPill()).not.toHaveAttribute('data-tip-spot');
    expect(state.markSeen).toHaveBeenCalledWith('user-1', 'tip_talk');
    expect(state.track).toHaveBeenCalledWith('tip_action', { id: 'talk', action: 'dismiss' });
    cleanup();
    renderPage();
    await settle(3000);
    expect(talkPill()).toBeInTheDocument();
    expect(tip()).toBeNull();
  });

  it('is not shown when the profile says it was seen on another device', async () => {
    state.getProfile.mockResolvedValue({ id: 'user-1', onboarding_status: { guide: true, tip_talk: true } });
    renderPage();
    await settle(3000);
    expect(talkPill()).toBeInTheDocument();
    expect(tip()).toBeNull();
  });

  it('steps away while the «⋯» menu is open', async () => {
    renderPage();
    await settle();
    await settle();
    expect(tip()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Действия с лекцией' }));
    expect(tip()).toBeNull();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await settle();
    expect(tip()).not.toBeNull();
  });

  it.each([
    ['a lecture without cards', () => lecture({ flashcards_json: { flashcards: [] } })],
    ['a lecture without its text', () => lecture({ original_text: '' })],
    ['someone else’s lecture', () => lecture({ user_id: 'user-2' })],
  ])('is not shown on %s', async (_name, make) => {
    state.material = make();
    renderPage();
    await settle(3000);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Природные ресурсы');
    expect(tip()).toBeNull();
    expect(state.getProfile).not.toHaveBeenCalled();
  });

  it('is not shown on «Подкаст», where the podcast plays', async () => {
    renderPage('/library/m1?mode=express&tab=podcast');
    await settle(3000);
    expect(screen.getByTestId('express')).toBeInTheDocument();
    expect(tip()).toBeNull();
  });

  describe('on a phone too short for its sheet (320×640, finding LIB-4)', () => {
    const query = '(max-width: 639px) and (max-height: 719px)';
    let matches = true;
    beforeEach(() => {
      matches = true;
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (media: string) => ({
          media,
          matches: media === query && matches,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
      });
    });
    afterEach(() => {
      delete (window as { matchMedia?: unknown }).matchMedia;
    });

    it('waits for a taller screen and reads nothing, so it counts no visit', async () => {
      renderPage();
      await settle(3000);
      expect(talkPill()).toBeInTheDocument();
      expect(tip()).toBeNull();
      expect(state.getProfile).not.toHaveBeenCalled();
      expect(window.localStorage.getItem('meldy_tip_views_talk')).toBeNull();
    });

    it('comes on a screen with room for it', async () => {
      matches = false;
      renderPage();
      await settle();
      await settle();
      expect(tip()).not.toBeNull();
    });
  });

  it('seen on two visits does not come a third time (finding LIB-4)', async () => {
    renderPage();
    await settle();
    await settle();
    expect(tip()).not.toBeNull();
    cleanup();
    renderPage();
    await settle();
    await settle();
    expect(tip()).not.toBeNull();
    expect(state.markSeen).toHaveBeenCalledWith('user-1', 'tip_talk');
    cleanup();
    renderPage();
    await settle(3000);
    expect(talkPill()).toBeInTheDocument();
    expect(tip()).toBeNull();
  });
});
