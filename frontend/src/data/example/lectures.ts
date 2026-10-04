/**
 * The three lectures of «Попробовать на примере» (/try): an original short course in microeconomics,
 * standard textbook material written for Meldy. Each file is plain text as a student would upload it:
 * the title on the first line, then paragraphs separated by a blank line, each under its own heading
 * line (the shape of data/demo/lecture.txt).
 *
 * Fragments follow the backend's rule (utils.build_source_chunks): a paragraph is a fragment, numbered
 * S01, S02… in order (every paragraph here is under its 850-character limit), so «фрагмент 3» on the
 * example's sheet is the same thing it is in a real exam.
 */
import demandSupply from './lecture-demand-supply.txt?raw';
import elasticity from './lecture-elasticity.txt?raw';
import costs from './lecture-costs.txt?raw';

export type LectureKey = 'M1' | 'M2' | 'M3';

export interface ExampleFragment {
  /** «S01», «S02»… */
  id: string;
  text: string;
}

export interface ExampleLecture {
  /** The lecture's key in an answer point's source ids: «M1:S02». */
  key: LectureKey;
  /** A stable id of the example's own; it never leaves the page. */
  materialId: string;
  title: string;
  /** The whole lecture as it was «uploaded». */
  text: string;
  fragments: ExampleFragment[];
}

/** The backend's fragment limit (utils.build_source_chunks chunk_chars). */
export const FRAGMENT_CHARS = 850;

/** Paragraphs separated by a blank line, numbered S01, S02… (utils.build_source_chunks). */
export function fragmentsOf(text: string): ExampleFragment[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => ({ id: `S${String(index + 1).padStart(2, '0')}`, text: part }));
}

function lecture(key: LectureKey, raw: string): ExampleLecture {
  const text = raw.trim();
  return {
    key,
    materialId: `example-lecture-${key.slice(1)}`,
    title: text.split('\n')[0].trim(),
    text,
    fragments: fragmentsOf(text),
  };
}

export const EXAMPLE_LECTURES: readonly ExampleLecture[] = [lecture('M1', demandSupply), lecture('M2', elasticity), lecture('M3', costs)];

export function lectureOf(key: LectureKey): ExampleLecture {
  const found = EXAMPLE_LECTURES.find((item) => item.key === key);
  if (!found) throw new Error(`Unknown example lecture ${key}`);
  return found;
}

/** The text of a lecture's fragment («S03»), or '' when there is no such fragment. */
export function fragmentText(key: LectureKey, fragment: string): string {
  return lectureOf(key).fragments.find((item) => item.id === fragment)?.text ?? '';
}
