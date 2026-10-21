import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import TicketAloud from './TicketAloud';
import { TICKET_TALK } from './copy3';
import { CUES, FINAL_FRAME, LOOP_MS, ticketFrame, untilNextCue } from './ticketLoop';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the ticket aloud, as a timeline', () => {
  it('names the parts in the order the student says them, the examiner asks about the missed one, the answer lights it', () => {
    expect(ticketFrame(0)).toEqual({ lines: 0, points: ['wait', 'wait', 'wait', 'wait'], speaker: null, protocol: false, fading: false });
    expect(ticketFrame(2000).points).toEqual(['ok', 'wait', 'wait', 'wait']);
    expect(ticketFrame(6000)).toMatchObject({ lines: 3, points: ['ok', 'ok', 'wait', 'ok'], speaker: 'you' });
    expect(ticketFrame(7000)).toMatchObject({ lines: 4, points: ['ok', 'ok', 'asked', 'ok'], speaker: 'examiner' });
    expect(ticketFrame(10500)).toMatchObject({ lines: 5, points: ['ok', 'ok', 'after', 'ok'], speaker: 'you', protocol: false });
    expect(ticketFrame(12000)).toMatchObject({ lines: 5, speaker: null, protocol: true, fading: false });
    expect(ticketFrame(14600).fading).toBe(true);
  });

  it('loops, and its still frame is the answer as it ends', () => {
    expect(ticketFrame(LOOP_MS + 2000)).toEqual(ticketFrame(2000));
    expect(FINAL_FRAME).toEqual({ lines: 5, points: ['ok', 'ok', 'after', 'ok'], speaker: null, protocol: true, fading: false });
  });

  it('wakes only at its cues: the frame is the same all the way to the next one', () => {
    for (const t of [0, 1, 1899, 2400, 9999, 14399, 14999]) {
      const wait = untilNextCue(t);
      expect(wait).toBeGreaterThan(0);
      expect(ticketFrame(t + wait - 1)).toEqual(ticketFrame(t));
    }
    expect(CUES.length).toBeLessThan(16);
  });
});

/** An observer that says the card is on screen, or not, when told. */
function stubObserver() {
  const seen: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
  class Observer {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      seen.push(callback);
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  return (on: boolean) => act(() => seen.forEach((callback) => callback([{ isIntersecting: on }])));
}

const line = (text: string) => screen.getByText((_, el) => el?.tagName === 'LI' && (el.textContent ?? '').includes(text));

describe('the ticket aloud on the page', () => {
  it('stands on the last frame, with no button, when less motion is asked for', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));
    stubObserver();
    render(<TicketAloud />);
    expect(line(TICKET_TALK.answer)).toHaveClass('is-on');
    expect(screen.getByText(TICKET_TALK.result)).toHaveClass('is-on');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('plays on screen, holds off screen, and stops and starts on its button', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    const show = stubObserver();
    render(<TicketAloud />);
    const first = line(TICKET_TALK.said[0]);
    act(() => vi.advanceTimersByTime(3000));
    expect(first).not.toHaveClass('is-on'); // not seen yet
    show(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(first).toHaveClass('is-on');
    show(false);
    act(() => vi.advanceTimersByTime(8000));
    expect(line(TICKET_TALK.said[2])).not.toHaveClass('is-on'); // held while away
    show(true);
    fireEvent.click(screen.getByRole('button', { name: TICKET_TALK.pause }));
    act(() => vi.advanceTimersByTime(8000));
    expect(line(TICKET_TALK.said[2])).not.toHaveClass('is-on'); // stopped
    fireEvent.click(screen.getByRole('button', { name: TICKET_TALK.play }));
    act(() => vi.advanceTimersByTime(4000));
    expect(line(TICKET_TALK.said[2])).toHaveClass('is-on');
  });
});
