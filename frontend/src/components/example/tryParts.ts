import type { ComponentType } from 'react';
import { lazyPart } from '../../lib/lazyPart';

/**
 * The example's answer room (/try/ticket) and its draw (/try/draw), files of their own (lib/lazyPart): the first screen
 * of /try is its sheet, and on a slow line it waited for the answer room's code too — the protocol, the recognition of
 * speech, the AI check (jury QA, 2026-10-11, Slow 4G). They are fetched once the sheet is idle (lib/prefetch.ts
 * likelyNext), or when a step asks for them; from then on a step shows at once, without a loading frame.
 */
export const tryTicketPart = lazyPart<ComponentType>(() => import('./ExampleTicket').then((module) => module.default));
export const tryDrawPart = lazyPart<ComponentType>(() => import('./ExampleDraw').then((module) => module.default));
