import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  markSeen: vi.fn(),
  track: vi.fn(),
  moveExamDate: vi.fn(),
}));

vi.mock('../../api/social', () => ({
  getProfile: (...args: unknown[]) => mocks.getProfile(...args),
  markOnboardingTourSeen: (...args: unknown[]) => mocks.markSeen(...args),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../../lib/telemetry', () => ({ track: (...args: unknown[]) => mocks.track(...args) }));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  fetchSummary: vi.fn(),
  moveExamDate: (...args: unknown[]) => mocks.moveExamDate(...args),
}));

import MoveExamDialog from '../containers/MoveExamDialog';
import { TIPS } from './tips';
import { STEP_CLIPS } from '../clips';

/* «Перенести экзамен»'s first-use tip: the clip of a move at the top of the dialog, the first time it opens. */

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

const profile = (flags: Record<string, boolean>) => ({ id: 'user-1', onboarding_status: flags });

function show() {
  const onClose = vi.fn();
  const onMoved = vi.fn();
  const view = render(
    <MoveExamDialog containerId="c-1" role="owner" today="2026-10-18" facts={{ members: 0, authorDate: '2026-10-18' }} onClose={onClose} onMoved={onMoved} />,
  );
  return { ...view, onMoved, dialog: () => screen.getByRole('dialog', { name: 'Перенести экзамен' }) };
}

const tip = () => document.querySelector('section.mvt') as HTMLElement | null;
/** The profile read (a promise) and the effects after it. */
const read = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(260);
  stubReducedMotion(false);
  window.localStorage.clear();
  window.localStorage.setItem('meldy_guide_seen', '1');
  mocks.getProfile.mockReset().mockResolvedValue(profile({ guide: true }));
  mocks.markSeen.mockReset().mockResolvedValue(undefined);
  mocks.track.mockReset();
  mocks.moveExamDate.mockReset().mockImplementation(async (id: string, date: string) => ({ for: 'all', container_id: id, exam_date: date, own_exam_date: null, subjects: [] }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the move dialog’s tip', () => {
  it('comes the first time the dialog opens, at the top of its form, with the clip of a move; the first choice keeps the focus', async () => {
    const view = show();
    await read();
    const card = tip()!;
    expect(card).not.toBeNull();
    expect(view.dialog().querySelector('form')!.firstElementChild).toBe(card);
    expect(within(card).getByRole('heading', { name: TIPS.move.title })).toBeInTheDocument();
    expect(card).toHaveTextContent(TIPS.move.text);
    expect(within(card).getByRole('button', { name: 'Не сейчас' })).toHaveAttribute('type', 'button');
    await waitFor(() => expect(card.querySelector('.sc-cap-t')).toHaveTextContent(STEP_CLIPS.move.steps[0].caption));
    expect(card.querySelector('.sc')).toHaveAttribute('data-compact', '');
    expect(card.querySelector('.sc')).toHaveAttribute('data-playing', 'true');
    expect(screen.getByRole('radio', { name: /Через неделю/ })).toHaveFocus();
    expect(mocks.getProfile).toHaveBeenCalledWith('user-1');
    expect(mocks.track).toHaveBeenCalledWith('tip_shown', { id: 'move' });
  });

  it('«Не сейчас» puts it away for good, on this device and in the profile, and gives the focus to the choices', async () => {
    show();
    await read();
    fireEvent.click(within(tip()!).getByRole('button', { name: 'Не сейчас' }));
    expect(tip()).toBeNull();
    expect(window.localStorage.getItem('meldy_tip_move')).toBe('1');
    await waitFor(() => expect(mocks.markSeen).toHaveBeenCalledWith('user-1', 'tip_move'));
    expect(mocks.track).toHaveBeenCalledWith('tip_action', { id: 'move', action: 'dismiss' });
    expect(screen.getByRole('radio', { name: /Через неделю/ })).toHaveFocus();
    cleanup();
    show();
    await read();
    expect(tip()).toBeNull();
  });

  it('a move sent from the dialog is the tip used: it does not come again', async () => {
    const view = show();
    await read();
    expect(tip()).not.toBeNull();
    fireEvent.click(within(view.dialog()).getByRole('button', { name: 'Перенести' }));
    await waitFor(() => expect(view.onMoved).toHaveBeenCalledWith('2026-10-25', expect.anything()));
    expect(window.localStorage.getItem('meldy_tip_move')).toBe('1');
    expect(mocks.track).toHaveBeenCalledWith('tip_action', { id: 'move', action: 'try' });
  });

  it('only looked at, it comes once more and then no more (two visits)', async () => {
    show();
    await read();
    expect(tip()).not.toBeNull();
    cleanup();
    show();
    await read();
    expect(tip()).not.toBeNull();
    cleanup();
    show();
    await read();
    expect(tip()).toBeNull();
  });

  it('put away on another device, it never shows; while the profile is read its room is held, so the choices do not jump', async () => {
    let answer: (value: unknown) => void = () => undefined;
    mocks.getProfile.mockReset().mockReturnValue(new Promise((resolve) => (answer = resolve)));
    show();
    await read();
    // The profile is on its way: the card's room is there, its clip a still frame.
    expect(tip()).not.toBeNull();
    expect(tip()!.querySelector('.sc')).toHaveAttribute('data-playing', 'false');
    await act(async () => {
      answer(profile({ guide: true, tip_move: true }));
      await Promise.resolve();
    });
    expect(tip()).toBeNull();
    expect(window.localStorage.getItem('meldy_tip_move')).toBe('1');
  });

  it('waits for the guide’s first run: the app as a whole first', async () => {
    window.localStorage.removeItem('meldy_guide_seen');
    mocks.getProfile.mockReset().mockResolvedValue(profile({}));
    show();
    await read();
    expect(tip()).toBeNull();
  });

  it('with reduced motion its clip stands on the first step until «Смотреть»', async () => {
    stubReducedMotion(true);
    show();
    await read();
    await waitFor(() => expect(tip()!.querySelector('.sc-cap-t')).toHaveTextContent(STEP_CLIPS.move.steps[0].caption));
    expect(tip()!.querySelector('.sc')).toHaveAttribute('data-playing', 'false');
    expect(within(tip()!).getByRole('button', { name: /Смотреть/ })).toBeInTheDocument();
  });
});
