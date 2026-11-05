import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepOnSessionLost, rescuedFor, sessionLost, takeRescued } from './draftRescue';

const C = 'c-1';
const draft = { stem: 'Новый текст', options: [] };

afterEach(() => {
  window.sessionStorage.clear();
  vi.useRealTimers();
});

describe('draftRescue: drafts kept through a login that ran out', () => {
  it('keeps the draft of an editor holding changes when the session is lost, and gives it back once', () => {
    const stop = keepOnSessionLost(() => ({ containerId: C, itemId: 'i1', stamp: 's1', draft, at: Date.now() }));
    sessionLost();
    stop();
    expect(rescuedFor(C).map((kept) => kept.itemId)).toEqual(['i1']);
    expect(rescuedFor('other')).toEqual([]);
    expect(takeRescued(C, 'i1', 's1')).toEqual(draft);
    expect(takeRescued(C, 'i1', 's1')).toBeNull();
    expect(rescuedFor(C)).toEqual([]);
  });

  it('gives nothing back for a question changed since (another stamp), and forgets it', () => {
    const stop = keepOnSessionLost(() => ({ containerId: C, itemId: 'i1', stamp: 's1', draft, at: Date.now() }));
    sessionLost();
    stop();
    expect(takeRescued(C, 'i1', 's2')).toBeNull();
    expect(rescuedFor(C)).toEqual([]);
  });

  it('keeps nothing for an editor without changes, nor after it went', () => {
    const stopQuiet = keepOnSessionLost(() => null);
    const stopGone = keepOnSessionLost(() => ({ containerId: C, itemId: 'i2', stamp: 's', draft, at: Date.now() }));
    stopGone();
    sessionLost();
    stopQuiet();
    expect(rescuedFor(C)).toEqual([]);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('keeps a new question not added yet under its own key, and several questions at once', () => {
    const stopA = keepOnSessionLost(() => ({ containerId: C, itemId: null, stamp: '', draft, at: 1_000 }));
    const stopB = keepOnSessionLost(() => ({ containerId: C, itemId: 'i3', stamp: 's', draft, at: 2_000 }));
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    sessionLost();
    stopA();
    stopB();
    expect(rescuedFor(C).map((kept) => kept.itemId)).toEqual([null, 'i3']);
    expect(takeRescued(C, null, '')).toEqual(draft);
  });

  it('drops a draft older than a day and ignores what is not a kept draft', () => {
    const stop = keepOnSessionLost(() => ({ containerId: C, itemId: 'i1', stamp: 's', draft, at: Date.now() - 25 * 60 * 60 * 1000 }));
    sessionLost();
    stop();
    expect(rescuedFor(C)).toEqual([]);
    window.sessionStorage.setItem('meldy_rescued_drafts', '{"c-1:i9": {"containerId": "c-1", "itemId": 7}}');
    expect(rescuedFor(C)).toEqual([]);
    window.sessionStorage.setItem('meldy_rescued_drafts', 'not json');
    expect(rescuedFor(C)).toEqual([]);
    expect(takeRescued(C, 'i9', 's')).toBeNull();
  });

  it('a saver that throws keeps nothing and stops no other', () => {
    const stopBad = keepOnSessionLost(() => {
      throw new Error('gone');
    });
    const stopGood = keepOnSessionLost(() => ({ containerId: C, itemId: 'i4', stamp: 's', draft, at: Date.now() }));
    sessionLost();
    stopBad();
    stopGood();
    expect(rescuedFor(C).map((kept) => kept.itemId)).toEqual(['i4']);
  });
});
