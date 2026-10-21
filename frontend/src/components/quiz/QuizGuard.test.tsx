import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { QuizAttempt, QuizAttemptItem, QuizProtection, QuizResult } from '../../types/quiz';

const api = vi.hoisted(() => ({
  sendAnswers: vi.fn(),
  finishQuiz: vi.fn(),
  quizResult: vi.fn(),
  sendGuardEvents: vi.fn(),
  track: vi.fn(),
}));
vi.mock('../../api/quizzes', () => ({
  sendAnswers: api.sendAnswers,
  finishQuiz: api.finishQuiz,
  quizResult: api.quizResult,
  sendGuardEvents: api.sendGuardEvents,
}));
vi.mock('../../lib/telemetry', () => ({ track: api.track }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), storage: { from: vi.fn() } } }));

import QuizRun from './QuizRun';
import { GUARD, RUN } from './copyTake';
import { ContainerApiError } from '../../api/containers';
import { guardKey, HIDDEN_SEND_MS, SEND_DELAY_MS, SEND_GAP_MS, type GuardEvent } from '../../lib/quizzes/guard';

/**
 * «Защита от списывания» on the attempt (useGuard through QuizRun): the cover comes in the same task as the signal (so
 * the next frame has it), goes when the page is back, one time away is one event, events go in batches and survive a
 * failure, the strict level blocks copying and ends the attempt at its limit, the normal level only records.
 */

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const SERVER_NOW = '2026-10-20T10:00:00.000Z';
const DEVICE_NOW = Date.parse(SERVER_NOW);

const ITEMS: QuizAttemptItem[] = [
  { id: 'i1', kind: 'single', stem: 'Сколько будет 2 + 2?', options: ['3', '4'], code: false, keep_order: false, images: null },
  { id: 'i2', kind: 'short', stem: 'Столица Франции', options: [], code: false, keep_order: false, images: null },
];

function attempt(protection: QuizProtection, over: Partial<QuizAttempt> = {}): QuizAttempt {
  return {
    attempt_id: 'att-g',
    n: 1,
    quiz_title: 'Контрольная',
    server_now: SERVER_NOW,
    started_at: SERVER_NOW,
    deadline_at: null,
    allow_back: true,
    shuffle_options: false,
    items: ITEMS,
    answers: [],
    taker_name: 'Вера Иванова',
    protection,
    protection_limit: 2,
    guard_count: 0,
    ...over,
  };
}

const RESULT: QuizResult = {
  attempt_id: 'att-g',
  n: 1,
  quiz_title: 'Контрольная',
  code: 'abcd2fghjkmn',
  started_at: SERVER_NOW,
  finished_at: SERVER_NOW,
  finish_reason: 'protection',
  correct: 0,
  total: 2,
  percent: 0,
  pass_percent: null,
  passed: null,
  review_now: 'score',
  answers_after: null,
  attempts_left: 0,
  can_retry: false,
  items: [],
  guard: { level: 'strict', count: 2, limit: 2 },
};

let focused = true;
let visibility: DocumentVisibilityState = 'visible';
let onResult: Mock<(result: QuizResult) => void>;
let sent: GuardEvent[][];
let serverCount: number;

const cover = () => document.querySelector<HTMLElement>('.qg-cover');
const covered = () => cover()?.hasAttribute('data-on') === true;
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** The page loses the focus to something over it (an assistant, the shade): window blur, document.hasFocus() false. */
function loseFocus() {
  focused = false;
  act(() => {
    window.dispatchEvent(new FocusEvent('blur'));
  });
}
function regainFocus() {
  focused = true;
  act(() => {
    window.dispatchEvent(new FocusEvent('focus'));
  });
}
function hide() {
  visibility = 'hidden';
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
function show() {
  visibility = 'visible';
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function renderRun(value: QuizAttempt, token: string | null = null) {
  return render(<QuizRun attempt={value} token={token} onResult={onResult} onLost={vi.fn()} />);
}

beforeEach(() => {
  vi.useFakeTimers({ now: DEVICE_NOW });
  window.localStorage.clear();
  focused = true;
  visibility = 'visible';
  sent = [];
  serverCount = 0;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  onResult = vi.fn<(result: QuizResult) => void>();
  api.sendAnswers.mockReset().mockImplementation(async () => ({ saved: 1, server_now: new Date().toISOString(), deadline_at: null }));
  api.finishQuiz.mockReset().mockResolvedValue(RESULT);
  api.quizResult.mockReset().mockResolvedValue(RESULT);
  api.sendGuardEvents.mockReset().mockImplementation(async (_id: string, events: GuardEvent[]) => {
    sent.push(events.map((event) => ({ ...event })));
    const ids = new Set(sent.flat().filter((event) => ['hidden', 'blur', 'split', 'fullscreen'].includes(event.kind)).map((event) => event.id));
    serverCount = ids.size;
    return { accepted: events.length, count: serverCount, limit: 2, finished: false, reason: null };
  });
  api.track.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the cover', () => {
  it('is in the page and off at the start; the question shows', () => {
    renderRun(attempt('normal'));
    expect(cover()).not.toBeNull();
    expect(covered()).toBe(false);
    expect(cover()).toHaveAttribute('aria-hidden', 'true');
    expect(document.documentElement.getAttribute('data-qg')).toBe('normal');
    expect(screen.getByText('Сколько будет 2 + 2?')).toBeInTheDocument();
  });

  it('comes in the same task as the focus loss (the next frame has it) and hides the question; goes on the return', () => {
    renderRun(attempt('normal'));
    loseFocus();
    // no timer ran, no frame passed: the handler itself turned it on
    expect(covered()).toBe(true);
    expect(cover()?.dataset.reason).toBe('away');
    expect(document.documentElement.hasAttribute('data-qg-away')).toBe(true);
    expect(cover()).not.toHaveAttribute('aria-hidden');
    expect(cover()).toHaveTextContent(GUARD.awayTitle);
    vi.setSystemTime(DEVICE_NOW + 12_000);
    regainFocus();
    expect(covered()).toBe(false);
    expect(document.documentElement.hasAttribute('data-qg-away')).toBe(false);
    expect(plain(screen.getByText(/Вы уходили со страницы/).textContent)).toBe(plain(GUARD.line(1, 'normal', 2, 12_000)));
  });

  it('a focus moved into the page’s own frame (a video) is not a loss, until the whole page loses it', async () => {
    renderRun(attempt('normal'));
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(frame);
    act(() => {
      window.dispatchEvent(new FocusEvent('blur'));
    });
    expect(covered()).toBe(false);
    focused = false;
    await advance(600);
    expect(covered()).toBe(true);
    frame.remove();
  });

  it('a hidden page is covered and its event goes a second later (not after the batch delay)', async () => {
    renderRun(attempt('normal'));
    hide();
    expect(covered()).toBe(true);
    await advance(HIDDEN_SEND_MS - 1);
    expect(api.sendGuardEvents).not.toHaveBeenCalled();
    await advance(1);
    expect(api.sendGuardEvents).toHaveBeenCalledTimes(1);
    expect(sent[0]).toEqual([expect.objectContaining({ kind: 'hidden', q: 1, ms: null })]);
  });
});

describe('one time away is one event', () => {
  it('an app switch (blur, then hidden, then back) is one event of kind hidden with its duration', async () => {
    renderRun(attempt('normal'));
    loseFocus();
    hide();
    await advance(0);
    vi.setSystemTime(DEVICE_NOW + 30_000);
    show();
    regainFocus();
    expect(covered()).toBe(false);
    await advance(SEND_DELAY_MS + SEND_GAP_MS);
    const all = sent.flat();
    expect(new Set(all.map((event) => event.id)).size).toBe(1);
    expect(all[all.length - 1]).toMatchObject({ kind: 'hidden', ms: expect.any(Number) });
    expect(all[all.length - 1].ms).toBeGreaterThanOrEqual(30_000);
    expect(plain(screen.getByText(/Вы уходили со страницы/).textContent)).toContain('1 раз.');
  });

  it('a second time away later is a second event', async () => {
    renderRun(attempt('normal'));
    loseFocus();
    regainFocus();
    await advance(5000);
    loseFocus();
    regainFocus();
    await advance(SEND_DELAY_MS + SEND_GAP_MS);
    expect(new Set(sent.flat().map((event) => event.id)).size).toBe(2);
    expect(plain(screen.getByText(/Вы уходили со страницы/).textContent)).toContain('2 раза.');
  });
});

describe('a reload is not a time away', () => {
  it('the page that hides for a reload sends nothing; the next load drops that episode (the server writes reload)', async () => {
    const { unmount } = renderRun(attempt('normal'));
    hide();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    // the page is gone before the second of the hidden send
    unmount();
    expect(api.sendGuardEvents).not.toHaveBeenCalled();
    const kept = JSON.parse(window.localStorage.getItem(guardKey('att-g')) ?? '[]') as GuardEvent[];
    expect(kept).toEqual([expect.objectContaining({ kind: 'hidden', ms: null })]);
    // the new page loads a moment later
    vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(Date.parse(kept[0].at) + 800);
    visibility = 'visible';
    renderRun(attempt('normal'));
    await advance(SEND_DELAY_MS * 2);
    expect(api.sendGuardEvents).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(guardKey('att-g'))).toBeNull();
    expect(screen.queryByText(/Вы уходили со страницы/)).toBeNull();
  });

  it('a page left for a minute and then reloaded keeps that time away, with its duration', async () => {
    const { unmount } = renderRun(attempt('normal'));
    hide();
    unmount();
    const kept = JSON.parse(window.localStorage.getItem(guardKey('att-g')) ?? '[]') as GuardEvent[];
    vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(Date.parse(kept[0].at) + 60_000);
    visibility = 'visible';
    renderRun(attempt('normal'));
    await advance(0);
    expect(api.sendGuardEvents).toHaveBeenCalledWith('att-g', [expect.objectContaining({ kind: 'hidden', ms: 60_000 })], null);
  });
});

describe('sending', () => {
  it('waits for more events, then sends one batch', async () => {
    renderRun(attempt('normal'));
    loseFocus();
    regainFocus();
    expect(api.sendGuardEvents).not.toHaveBeenCalled();
    await advance(SEND_DELAY_MS);
    expect(api.sendGuardEvents).toHaveBeenCalledTimes(1);
    expect(api.sendGuardEvents.mock.calls[0][0]).toBe('att-g');
    expect(sent[0]).toHaveLength(1);
    expect(window.localStorage.getItem(guardKey('att-g'))).toBeNull();
  });

  it('keeps the events on the device when the send fails and sends them again (also after a reload)', async () => {
    api.sendGuardEvents.mockRejectedValue(new ContainerApiError('network', 'Нет связи'));
    const { unmount } = renderRun(attempt('normal'));
    loseFocus();
    regainFocus();
    await advance(SEND_DELAY_MS);
    expect(api.sendGuardEvents).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(guardKey('att-g'))).toContain('"kind":"blur"');
    unmount();
    api.sendGuardEvents.mockReset().mockResolvedValue({ accepted: 1, count: 1, limit: null, finished: false, reason: null });
    renderRun(attempt('normal', { guard_count: 0 }));
    await advance(0);
    expect(api.sendGuardEvents).toHaveBeenCalledWith('att-g', [expect.objectContaining({ kind: 'blur' })], null);
    expect(window.localStorage.getItem(guardKey('att-g'))).toBeNull();
  });

  it('a guest’s events go with the device’s token', async () => {
    const token = 'A'.repeat(42) + 'g';
    renderRun(attempt('normal'), token);
    hide();
    await advance(HIDDEN_SEND_MS);
    expect(api.sendGuardEvents.mock.calls[0][2]).toBe(token);
  });
});

describe('copy and paste', () => {
  it('the strict level refuses a copy of the question and says so; the event is recorded', async () => {
    renderRun(attempt('strict'));
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    act(() => {
      screen.getByText('Сколько будет 2 + 2?').dispatchEvent(copy);
    });
    expect(copy.defaultPrevented).toBe(true);
    expect(screen.getByText(GUARD.noCopy)).toBeInTheDocument();
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      screen.getByText('Сколько будет 2 + 2?').dispatchEvent(menu);
    });
    expect(menu.defaultPrevented).toBe(true);
    await advance(SEND_DELAY_MS);
    expect(sent.flat()).toEqual([expect.objectContaining({ kind: 'copy', q: 1 })]);
    // a copy is not a time away
    expect(screen.queryByText(/Вы уходили со страницы/)).toBeNull();
  });

  it('the normal level lets a copy through and records it', async () => {
    renderRun(attempt('normal'));
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    act(() => {
      screen.getByText('Сколько будет 2 + 2?').dispatchEvent(copy);
    });
    expect(copy.defaultPrevented).toBe(false);
    await advance(SEND_DELAY_MS);
    expect(sent.flat()).toEqual([expect.objectContaining({ kind: 'copy' })]);
  });

  it('a paste into an answer is recorded, not refused', async () => {
    renderRun(attempt('strict'));
    fireEvent.click(screen.getByRole('button', { name: RUN.next }));
    const field = screen.getByRole('textbox');
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    act(() => {
      field.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(false);
    await advance(SEND_DELAY_MS);
    expect(sent.flat()).toEqual([expect.objectContaining({ kind: 'paste', q: 2 })]);
  });
});

describe('the strict level', () => {
  it('draws the participant’s name as a watermark and says the count with what is left', () => {
    renderRun(attempt('strict', { protection_limit: 3 }));
    const mark = document.querySelector<HTMLElement>('.qg-mark');
    expect(mark).not.toBeNull();
    expect(decodeURIComponent(mark?.style.maskImage ?? mark?.style.getPropertyValue('-webkit-mask-image') ?? '')).toContain('Вера Иванова');
    loseFocus();
    regainFocus();
    expect(plain(screen.getByText(/Вы уходили со страницы/).textContent)).toContain('Ещё 2 ухода, и попытка завершится.');
  });

  it('ends the attempt at the limit: the waiting events go first, then the result', async () => {
    renderRun(attempt('strict'));
    loseFocus();
    regainFocus();
    await advance(6000);
    loseFocus();
    // the second time away reaches the limit of 2: the events go at once, then the end
    await advance(0);
    expect(api.sendGuardEvents).toHaveBeenCalled();
    expect(plain(document.body.textContent)).toContain(plain(RUN.guardEnd(2)));
    await advance(1000);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-g', null);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ finish_reason: 'protection' }));
    // the cover is off once the attempt ends
    expect(covered()).toBe(false);
  });

  it('ends the attempt when the server says it did (another tab reached the limit)', async () => {
    api.sendGuardEvents.mockResolvedValue({ accepted: 1, count: 2, limit: 2, finished: true, reason: 'protection' });
    renderRun(attempt('strict', { guard_count: 1 }));
    hide();
    await advance(HIDDEN_SEND_MS + 1000);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ finish_reason: 'protection' }));
  });

  it('a limit reached while the page is hidden is decided when it is back (a reload’s own hiding never ends it)', async () => {
    renderRun(attempt('strict', { guard_count: 1 }));
    hide();
    await advance(HIDDEN_SEND_MS + 2000);
    expect(api.finishQuiz).not.toHaveBeenCalled();
    show();
    regainFocus();
    await advance(1000);
    expect(api.finishQuiz).toHaveBeenCalledWith('att-g', null);
  });

  it('the normal level never ends the attempt', async () => {
    renderRun(attempt('normal'));
    for (let i = 0; i < 4; i += 1) {
      loseFocus();
      regainFocus();
      await advance(5000);
    }
    expect(api.finishQuiz).not.toHaveBeenCalled();
    expect(plain(screen.getByText(/Вы уходили со страницы/).textContent)).toContain('4 раза.');
  });
});

describe('off', () => {
  it('a quiz without protection has no cover and records nothing', async () => {
    renderRun(attempt('off'));
    expect(cover()).toBeNull();
    expect(document.documentElement.hasAttribute('data-qg')).toBe(false);
    loseFocus();
    hide();
    await advance(SEND_DELAY_MS * 2);
    expect(api.sendGuardEvents).not.toHaveBeenCalled();
  });
});
