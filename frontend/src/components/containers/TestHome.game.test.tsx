import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* «Провести игру» on the test's own page: the first-use tip with the guide's clip of the game, shown on one visit. */

const mocks = vi.hoisted(() => ({
  listQuizzes: vi.fn(),
  getProfile: vi.fn(),
  markSeen: vi.fn(),
}));

vi.mock('../../api/quizzes', () => ({ listQuizzes: (...args: unknown[]) => mocks.listQuizzes(...args) }));
vi.mock('../../api/social', () => ({
  getProfile: (...args: unknown[]) => mocks.getProfile(...args),
  markOnboardingTourSeen: (...args: unknown[]) => mocks.markSeen(...args),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('./actions', () => ({ useExamActions: () => ({ actions: [], dialogs: null }) }));
vi.mock('../../lib/usePhone', () => ({ usePhone: () => false }));
vi.mock('./useWide', () => ({ useWide: () => true }));
vi.mock('../guide/GuideContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../guide/GuideContext')>()),
  useGuide: () => ({ open: false }),
}));
// The clip's file is not needed here: the card keeps its frame.
vi.mock('../tips/clipPart', () => ({ tipClipPart: { load: () => Promise.resolve(() => null), current: () => null, subscribe: () => () => undefined } }));

import TestHome from './TestHome';
import { TIPS } from '../tips/tips';
import { TEST_HOME } from '../test/copyTest';
import type { ContainerData } from '../../lib/containers/hooks';

function data(keyed: number, noKey = 0): ContainerData {
  return {
    summary: { id: 'c-1', title: 'Кислоты и основания', subjects: [{ keyed, no_key: noKey }] },
    planInput: null,
  } as unknown as ContainerData;
}

function renderHome(keyed = 12, noKey = 0) {
  return render(
    <MemoryRouter>
      <TestHome containerId="c-1" data={data(keyed, noKey)} reload={vi.fn()} />
    </MemoryRouter>,
  );
}

const tipCard = () => document.querySelector('section.tp-card') as HTMLElement | null;

beforeEach(() => {
  window.localStorage.clear();
  mocks.listQuizzes.mockReset().mockResolvedValue([]);
  mocks.getProfile.mockReset().mockResolvedValue({ id: 'user-1', onboarding_status: { guide: true } });
  mocks.markSeen.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('the test’s page and the game', () => {
  it('«?» there opens «Игра в классе»: the page says it is that chapter', () => {
    renderHome();
    expect(document.querySelector('[data-guide-chapter="game"]')).not.toBeNull();
  });

  it('the first time a test can be played, a tip with the clip points at «Провести игру»; its action is the button’s', async () => {
    renderHome();
    const button = await screen.findByRole('link', { name: 'Провести игру' }, { timeout: 3000 });
    expect(button).toHaveAttribute('href', '/live/new?c=c-1');
    await waitFor(() => expect(tipCard()).not.toBeNull(), { timeout: 3000 });
    const card = tipCard()!;
    expect(within(card).getByRole('heading', { name: TIPS.game.title })).toBeInTheDocument();
    expect(card).toHaveTextContent(TIPS.game.text);
    expect(within(card).getByRole('link', { name: TIPS.game.action })).toHaveAttribute('href', '/live/new?c=c-1');
    // The clip's frame is the shape of the game's footage, 16:9 (lib/footage.ts STAND_RUN).
    expect(card.querySelector('.tp-box')).toHaveStyle({ aspectRatio: String(16 / 9) });
    // The anchor has its ring while the card is shown; the card comes right after it.
    expect(button).toHaveAttribute('data-tip-spot');
    expect(button.nextElementSibling).toBe(card);
    // Shown once: this visit put it away on the device and in the profile.
    expect(window.localStorage.getItem('meldy_tip_game')).toBe('1');
    await waitFor(() => expect(mocks.markSeen).toHaveBeenCalledWith('user-1', 'tip_game'), { timeout: 3000 });
    fireEvent.click(within(card).getByRole('button', { name: TIPS.game.later }));
    expect(tipCard()).toBeNull();
  });

  it('no tip while the test cannot be played: the button waits with the page’s reason', async () => {
    renderHome(0, 6);
    const shut = await screen.findByRole('button', { name: 'Провести игру' });
    expect(shut).toBeDisabled();
    expect(shut).toHaveAccessibleDescription(TEST_HOME.sendWhyKey);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(tipCard()).toBeNull();
    expect(mocks.getProfile).not.toHaveBeenCalled();
  });

  it('a tip put away before does not come again', async () => {
    window.localStorage.setItem('meldy_tip_game', '1');
    renderHome();
    await screen.findByRole('link', { name: 'Провести игру' });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(tipCard()).toBeNull();
  });
});
