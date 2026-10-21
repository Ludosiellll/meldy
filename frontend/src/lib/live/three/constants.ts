/** Lists for pickers and checks (no three.js here). */
import type { BossKind, BossPhase } from './types';

export const BOSS_KINDS: readonly BossKind[] = ['skeleton', 'clock'];
export const BOSS_PHASES: readonly BossPhase[] = ['idle', 'warn', 'stomp', 'roar', 'stunned', 'chase'];
