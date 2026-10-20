/**
 * Test helpers for the player (vitest only): a fake server on vitest's fake clock (the fake's realClock calls the
 * global timers and Date.now, which vitest replaces), a recording platform, and `until` to move time until a condition.
 */
import { vi } from 'vitest';
import { createFakeServer } from '../../../lib/live/fake';
import type { LiveApi } from '../../../lib/live/types';
import { PlayerController } from './controller';
import { webPlatform, type HapticKind, type PlayerPlatform, type ShareCard } from './platform';

export type FakeApi = ReturnType<typeof createFakeServer>;

export function fakeApi(options: { bots?: number; seed?: number } = {}): FakeApi {
  return createFakeServer({ bots: options.bots ?? 3, fastBots: true, autoHost: true, demoPin: '482913', latencyMs: 0, seed: options.seed ?? 11 });
}

export interface Recorder {
  haptics: HapticKind[];
  shares: ShareCard[];
  playing: boolean[];
}

/** The site's platform, with haptics, sharing and the «in a game» switch recorded. */
export function recordingPlatform(rec: Recorder, base: PlayerPlatform = webPlatform()): PlayerPlatform {
  return {
    ...base,
    haptic: (kind) => {
      rec.haptics.push(kind);
    },
    setPlaying: (on) => {
      rec.playing.push(on);
      base.setPlaying(on);
    },
    share: async (card) => {
      rec.shares.push(card);
      return 'shared';
    },
  };
}

export function newRecorder(): Recorder {
  return { haptics: [], shares: [], playing: [] };
}

export function controller(api: LiveApi, platform: PlayerPlatform): PlayerController {
  return new PlayerController({ api, platform, profile: 'test' });
}

/** Moves the fake clock in steps until `cond()` holds (or throws after `maxMs`). */
export async function until(cond: () => boolean, maxMs = 90_000, step = 100): Promise<void> {
  for (let t = 0; t <= maxMs; t += step) {
    if (cond()) return;
    await vi.advanceTimersByTimeAsync(step);
  }
  if (!cond()) throw new Error(`condition not met in ${maxMs} ms`);
}

/** The shown index of the current question's key (the fake keeps it; the client never sees it before the close). */
export function keyOf(api: FakeApi, gameId: string): number {
  const g = api.peek(gameId);
  if (!g) throw new Error('no game');
  return g.questions[g.qi].key;
}

export function useGameClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: Date.UTC(2026, 9, 21, 9, 0, 0) });
}
