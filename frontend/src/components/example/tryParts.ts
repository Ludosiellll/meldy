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

/**
 * The example's «Разбор лекции» (/try/lecture), a file of its own too: the analysis result screen with its parts (the
 * summary with formulas, the cards, the test, the podcast's player) weighs several times the sheet. Not fetched ahead:
 * when the sheet's link to it is pointed at, or when it is opened. Its import() is here, in the app's first file, for
 * the list Vite writes into the file that holds an import(): the forty-odd files the screen brings. The app's first
 * file names them already (the analysis page has the same panel); in /try's own file they were forty new names on its
 * first screen (1.5 KB).
 */
export const tryLecturePart = lazyPart<ComponentType>(() => import('./ExampleLecture').then((module) => module.default));
