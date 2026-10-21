import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getProfile: vi.fn(), markSeen: vi.fn() }));
vi.mock('../../api/social', () => ({
  getProfile: (...args: unknown[]) => mocks.getProfile(...args),
  markOnboardingTourSeen: (...args: unknown[]) => mocks.markSeen(...args),
}));

import Tour, { TOUR_PROFILE_KEY, tourKey, tourSteps, useStudioTour } from './Tour';
import { STUDIO } from './copyStudio';

/* The studio's tour (UX audit of 21.10, P4): after the first block, without the line the palette says, and remembered in
   the profile like the first-use tips. */

beforeEach(() => {
  window.localStorage.clear();
  mocks.getProfile.mockReset().mockResolvedValue({ onboarding_status: {} });
  mocks.markSeen.mockReset().mockResolvedValue(undefined);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useStudioTour', () => {
  it('waits for the page’s first block, then asks the profile once', async () => {
    const { result, rerender } = renderHook(({ ready }) => useStudioTour('user-1', ready), { initialProps: { ready: false } });
    expect(result.current).toBe(false);
    expect(mocks.getProfile).not.toHaveBeenCalled();
    rerender({ ready: true });
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.getProfile).toHaveBeenCalledTimes(1);
  });

  it('seen on another device: not shown, and this device remembers it', async () => {
    mocks.getProfile.mockResolvedValue({ onboarding_status: { [TOUR_PROFILE_KEY]: true } });
    const { result } = renderHook(() => useStudioTour('user-1', true));
    await waitFor(() => expect(window.localStorage.getItem(tourKey('user-1'))).toBe('1'));
    expect(result.current).toBe(false);
  });

  it('seen on this device: the profile is not asked; an unreadable profile shows nothing', async () => {
    window.localStorage.setItem(tourKey('user-1'), '1');
    renderHook(() => useStudioTour('user-1', true));
    expect(mocks.getProfile).not.toHaveBeenCalled();
    window.localStorage.clear();
    mocks.getProfile.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useStudioTour('user-2', true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
  });
});

describe('the tour', () => {
  it('a computer: three steps, «Блоки» left out (the palette’s own line says it)', () => {
    expect(tourSteps(false).map(({ step }) => step.title)).toEqual([STUDIO.tour[1].title, STUDIO.tour[2].title, STUDIO.tour[3].title]);
    expect(tourSteps(true).map(({ step }) => step.title)).toEqual([STUDIO.tourPhoneFirst.title, STUDIO.tourPhoneEdit.title, STUDIO.tour[2].title, STUDIO.tour[3].title]);
  });

  it('«Пропустить» remembers it on this device and in the profile', async () => {
    const done = vi.fn();
    render(<Tour userId="user-1" onDone={done} />);
    fireEvent.click(within(screen.getByRole('dialog', { name: STUDIO.tourLabel })).getByRole('button', { name: STUDIO.tourSkip }));
    expect(done).toHaveBeenCalled();
    expect(window.localStorage.getItem(tourKey('user-1'))).toBe('1');
    await waitFor(() => expect(mocks.markSeen).toHaveBeenCalledWith('user-1', TOUR_PROFILE_KEY));
  });
});
