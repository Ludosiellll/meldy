/**
 * The example of a lecture's result (/try/lecture): one real analysis of the exam example's lecture «Спрос и
 * предложение» (data/example/lecture-demand-supply.txt), made on the live site on 2026-10-12 under a test account —
 * «Разобрать лекцию» → «Текст», all five materials, the other settings as they come — and kept as the result screen
 * consumes it: results.json is the stream's `results` after api/analyzeStream (statusesFromResults, displayResults).
 * Its fragments S01–S07 are the lecture's own paragraphs, the ones the exam example quotes, so the two examples tell
 * one story. What was corrected by hand after reading it against the lecture, and why: CHANGES.md.
 *
 * The podcast's voice was made once by the same server (/api/tts, the player's own request) and lies beside the page,
 * a file a line: public/example/lecture/podcast/01.mp3… in the order the player voices them. The example asks no
 * server for anything.
 */
import type { AnalysisResults } from '../../types';
import { lectureOf } from '../example/lectures';
import results from './results.json';

export const EXAMPLE_LECTURE_RESULTS = results as unknown as AnalysisResults;

/** The lecture that was analysed: the first of the exam example. */
export const EXAMPLE_LECTURE_SOURCE = lectureOf('M1');

/** The pasted text's name (UploadZone: its first line and «.txt»); the screen's title falls back on it. */
export const EXAMPLE_LECTURE_FILE = `${EXAMPLE_LECTURE_SOURCE.title}.txt`;

/** The voice of the podcast's line at `index` (0-based, in the player's order). */
export function exampleLectureVoiceFile(index: number): string {
  return `/example/lecture/podcast/${String(index + 1).padStart(2, '0')}.mp3`;
}
