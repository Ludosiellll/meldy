/** Lists for pickers and checks (no three.js here). */
import type { BossKind, BossPhase } from './types';

export const BOSS_KINDS: readonly BossKind[] = ['skeleton', 'clock'];
export const BOSS_PHASES: readonly BossPhase[] = ['idle', 'warn', 'stomp', 'roar', 'stunned', 'chase'];

/**
 * The boss's height on the stage in the middle of mode A's arena (the server's solid circle, r 80 = 1.6 m), metres:
 * its feet stay on the stage. The projector and the phone draw it the same.
 */
export const STAGE_BOSS_HEIGHT: Readonly<Record<BossKind, number>> = { clock: 4.6, skeleton: 4.4 };

/** Zone colours by the zone's place in the map (А, Б, В, Г, then round again): the floor's tiles and the screens' letters. */
export const ZONE_COLOURS: readonly string[] = ['#ff6f61', '#4d8dff', '#ffc531', '#36c47c', '#b07cff', '#ff8fc8'];
