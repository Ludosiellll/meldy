import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  markSeen: vi.fn(),
  track: vi.fn(),
  load: vi.fn(),
  guide: null as null | { open: boolean },
  userId: 'user-1' as string | undefined,
}));

vi.mock('../../api/social', () => ({
  getProfile: (...args: unknown[]) => mocks.getProfile(...args),
  markOnboardingTourSeen: (...args: unknown[]) => mocks.markSeen(...args),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.userId ? { id: mocks.userId } : null }) }));
vi.mock('../../lib/telemetry', () => ({ track: (...args: unknown[]) => mocks.track(...args) }));
vi.mock('../guide/GuideContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../guide/GuideContext')>()),
  useGuide: () => mocks.guide,
}));
// The clip's file is fetched while the page settles; here it is not needed.
vi.mock('./clipPart', () => ({ tipClipPart: { load: (...args: unknown[]) => mocks.load(...args), current: () => null, subscribe: () => () => undefined } }));

import { TIP_SETTLE_MS, useFirstUseTip } from './useFirstUseTip';

function Probe({ enabled = true, visits }: { enabled?: boolean; visits?: number }) {
  const tip = useFirstUseTip('talk', { enabled, visits });
  return (
    <div>
      <p data-testid="show">{tip.show ? 'shown' : 'hidden'}</p>
      <button type="button" onClick={tip.dismiss}>
        dismiss
      </button>
      <button type="button" onClick={tip.done}>
        done
      </button>
    </div>
  );
}

const shown = () => screen.getByTestId('show').textContent === 'shown';
const profile = (flags: Record<string, boolean>) => ({ id: 'user-1', onboarding_status: flags });

/** The profile read (a promise) and the settle timer. */
async function settle(ms = TIP_SETTLE_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  mocks.getProfile.mockReset().mockResolvedValue(profile({ guide: true }));
  mocks.markSeen.mockReset().mockResolvedValue(undefined);
  mocks.track.mockReset();
  mocks.load.mockReset().mockResolvedValue(() => null);
  mocks.guide = { open: false };
  mocks.userId = 'user-1';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useFirstUseTip', () => {
  it('shows the tip once the page has settled, reads the profile once and reports tip_shown once', async () => {
    const view = render(<Probe />);
    await settle(TIP_SETTLE_MS - 50);
    expect(shown()).toBe(false);
    await settle(60);
    expect(shown()).toBe(true);
    expect(mocks.getProfile).toHaveBeenCalledTimes(1);
    expect(mocks.getProfile).toHaveBeenCalledWith('user-1');
    expect(mocks.load).toHaveBeenCalled();
    view.rerender(<Probe />);
    await settle();
    expect(mocks.getProfile).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith('tip_shown', { id: 'talk' });
  });

  it('waits for the caller: nothing is read or shown while the moment is not right', async () => {
    const view = render(<Probe enabled={false} />);
    await settle(2000);
    expect(shown()).toBe(false);
    expect(mocks.getProfile).not.toHaveBeenCalled();
    view.rerender(<Probe enabled />);
    await settle();
    expect(shown()).toBe(true);
  });

  it('stays away when the device remembers it, without reading the profile', async () => {
    window.localStorage.setItem('meldy_tip_talk', '1');
    render(<Probe />);
    await settle(2000);
    expect(shown()).toBe(false);
    expect(mocks.getProfile).not.toHaveBeenCalled();
  });

  it('stays away when the profile remembers it, and this device remembers it from then on', async () => {
    mocks.getProfile.mockResolvedValue(profile({ guide: true, tip_talk: true }));
    render(<Probe />);
    await settle(2000);
    expect(shown()).toBe(false);
    expect(window.localStorage.getItem('meldy_tip_talk')).toBe('1');
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('stays away while the profile cannot be read', async () => {
    mocks.getProfile.mockResolvedValue(null);
    render(<Probe />);
    await settle(2000);
    expect(shown()).toBe(false);
    mocks.getProfile.mockRejectedValue(new Error('offline'));
    cleanup();
    render(<Probe />);
    await settle(2000);
    expect(shown()).toBe(false);
  });

  it('never shows while the guide is open, and comes after it closes', async () => {
    mocks.guide = { open: true };
    const view = render(<Probe />);
    await settle(2000);
    expect(shown()).toBe(false);
    mocks.guide = { open: false };
    view.rerender(<Probe />);
    await settle(TIP_SETTLE_MS - 50);
    expect(shown()).toBe(false);
    await settle(60);
    expect(shown()).toBe(true);
  });

  it('waits for the guide’s first run: not seen in the profile nor on this device, no tip', async () => {
    mocks.getProfile.mockResolvedValue(profile({}));
    const view = render(<Probe />);
    await settle(2000);
    expect(shown()).toBe(false);
    // The guide closed on this device (its own mark): the tip may come now.
    window.localStorage.setItem('meldy_guide_seen', '1');
    mocks.guide = { open: true };
    view.rerender(<Probe />);
    mocks.guide = { open: false };
    view.rerender(<Probe />);
    await settle();
    expect(shown()).toBe(true);
  });

  it('«Не сейчас»: gone for good, remembered on the device and in the profile, tip_action dismiss', async () => {
    render(<Probe />);
    await settle();
    expect(shown()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));
    expect(shown()).toBe(false);
    await settle(0);
    expect(window.localStorage.getItem('meldy_tip_talk')).toBe('1');
    expect(mocks.markSeen).toHaveBeenCalledWith('user-1', 'tip_talk');
    expect(mocks.track).toHaveBeenLastCalledWith('tip_action', { id: 'talk', action: 'dismiss' });
    await settle(2000);
    expect(shown()).toBe(false);
    // A new visit: the device's mark keeps it away.
    cleanup();
    render(<Probe />);
    await settle(2000);
    expect(shown()).toBe(false);
  });

  it('used from the tip: gone for good, both marks, tip_action try', async () => {
    render(<Probe />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'done' }));
    await settle(0);
    expect(shown()).toBe(false);
    expect(window.localStorage.getItem('meldy_tip_talk')).toBe('1');
    expect(mocks.markSeen).toHaveBeenCalledWith('user-1', 'tip_talk');
    expect(mocks.track).toHaveBeenLastCalledWith('tip_action', { id: 'talk', action: 'try' });
  });

  it('used before the tip showed (the pill itself): marked done, nothing reported, no tip later', async () => {
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'done' }));
    await settle(2000);
    expect(shown()).toBe(false);
    expect(window.localStorage.getItem('meldy_tip_talk')).toBe('1');
    expect(mocks.markSeen).toHaveBeenCalledTimes(1);
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('writes the marks once, however often it is used', async () => {
    render(<Probe />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'done' }));
    fireEvent.click(screen.getByRole('button', { name: 'done' }));
    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));
    await settle(0);
    expect(mocks.markSeen).toHaveBeenCalledTimes(1);
    expect(mocks.track.mock.calls.filter(([name]) => name === 'tip_action')).toHaveLength(1);
  });

  it('seen on two visits it is put away, as if «Не сейчас» was pressed (finding LIB-4)', async () => {
    render(<Probe />);
    await settle();
    expect(shown()).toBe(true);
    await settle(0);
    // Only looked at: it comes once more.
    expect(window.localStorage.getItem('meldy_tip_talk')).toBeNull();
    expect(mocks.markSeen).not.toHaveBeenCalled();

    cleanup();
    render(<Probe />);
    await settle();
    // The second visit still shows it, and marks it seen here and in the profile.
    expect(shown()).toBe(true);
    await settle(0);
    expect(window.localStorage.getItem('meldy_tip_talk')).toBe('1');
    expect(mocks.markSeen).toHaveBeenCalledWith('user-1', 'tip_talk');
    expect(mocks.track.mock.calls.filter(([name]) => name === 'tip_action')).toHaveLength(0);

    cleanup();
    render(<Probe />);
    await settle(2000);
    expect(shown()).toBe(false);
  });

  it('needs an account', async () => {
    mocks.userId = undefined;
    render(<Probe />);
    await settle(2000);
    expect(shown()).toBe(false);
    expect(mocks.getProfile).not.toHaveBeenCalled();
  });

  it('`visits` 1: a tip shown on one visit only is put away as it shows (the test page’s «game»)', async () => {
    const view = render(<Probe visits={1} />);
    await settle();
    expect(shown()).toBe(true);
    expect(window.localStorage.getItem('meldy_tip_talk')).toBe('1');
    expect(mocks.markSeen).toHaveBeenCalledWith('user-1', 'tip_talk');
    view.unmount();
    render(<Probe visits={1} />);
    await settle();
    expect(shown()).toBe(false);
  });
});
