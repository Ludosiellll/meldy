import type { ComponentType } from 'react';
import { lazyPart } from '../../lib/lazyPart';

/**
 * The example's answer room and its check (/try/ticket), a file of its own (lib/lazyPart): the first screen of /try is
 * the list of questions, and on a slow line it must not wait for the answer room's code — the speech recognition, the
 * AI check, the examiner (jury QA, 2026-10-11, Slow 4G). It is fetched once the list is idle (lib/prefetch.ts
 * likelyNext), or when a question is pointed at; from then on the step shows at once, without a loading frame.
 */
export const tryTicketPart = lazyPart<ComponentType>(() => import('./ExampleTicket').then((module) => module.default));

/**
 * The example's «Разбор лекции» (/try/lecture), a file of its own too: the analysis result screen with its parts (the
 * summary with formulas, the cards, the test, the podcast's player) weighs several times the list. Not fetched ahead:
 * when a link to it is pointed at, or when it is opened. Its import() is here, in the app's first file, for the list
 * Vite writes into the file that holds an import(): the forty-odd files the screen brings. The app's first file names
 * them already (the analysis page has the same panel); in /try's own file they were forty new names on its first
 * screen (1.5 KB).
 */
export const tryLecturePart = lazyPart<ComponentType>(() => import('./ExampleLecture').then((module) => module.default));
