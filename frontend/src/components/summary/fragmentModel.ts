import { normalizeForMatch, wordStem } from '../conversation/visuals';

/**
 * The summary next to its lecture (redesign spec 5.3): which lecture fragments stand by each
 * section of the summary.
 *
 * The summary keeps only the fragment ids of the whole text, but the model often names fragments in
 * the text itself: «…информационных щитах [S01, S02].» Those marks are the section's own
 * references. A section without marks gets the fragments nearest to it by word stems (the same
 * Russian endings as «Разговор» uses), and is labelled so: a word match is not a confirmation.
 */

export interface SourceFragment {
  id: string;
  text: string;
}

export type RefKind = 'marked' | 'near';

export interface SummarySection {
  /** Position in the summary: the scroll position and the margin follow it. */
  index: number;
  /** null for the text before the first heading. */
  title: string | null;
  /** Markdown without the fragment marks. */
  body: string;
  /** Fragment ids, in the order the section names them (at most MAX_REFS). */
  refs: string[];
  refKind: RefKind | null;
  /** Word stems of the section: the slip underlines the ones the fragment shares. */
  stems: string[];
}

const MAX_REFS = 4;
const MARK = String.raw`\[\s*S\d{1,3}(?:\s*[,;]\s*S?\d{1,3})*\s*\]`;
const MARK_ONE = new RegExp(MARK, 'g');
const MARK_RUN = new RegExp(String.raw`[ \t]*${MARK}(?:[ \t]*,?[ \t]*${MARK})*`, 'g');
const PICTOGRAPHS = /[\p{Extended_Pictographic}️]/gu;

// Frequent words that say nothing about the topic (four letters and longer: shorter ones are skipped anyway).
const STOP_WORDS = new Set(
  (
    'это этот эта эти этого этой этому этим этих того тому тем тех также такой такая такое такие такого ' +
    'который которая которое которые которого которой которых котором можно может могут нужно надо если ' +
    'когда чтобы потому поэтому более менее между через после перед только очень всего всех весь вся ' +
    'всем всегда иногда часто одна один одно одни один свой своя свое свои своих себя были было будет ' +
    'быть есть является являются являться является содержит используется используются например ' +
    'именно однако кроме также либо даже уже ещё еще здесь там затем тоже где куда откуда какой какая ' +
    'какие каких каждый каждая каждое данный данная данные данных этом этой своей своем своём'
  ).split(' '),
);

/** Drops «[S02]», «[S01, S03]» and runs like «[S04], [S05]» the model copied from its input. */
export function stripSourceMarkers(text: string): string {
  return text.replace(MARK_RUN, '');
}

/** «S04» → 4. */
export function fragmentNumber(id: string): number | null {
  const match = /S0*(\d+)$/i.exec(id.trim());
  return match ? Number(match[1]) : null;
}

/** The fragment numbers the text names, in order and without repeats: «[S01, S03] … [S01]» → [1, 3]. */
export function markedFragmentNumbers(text: string): number[] {
  const numbers: number[] = [];
  for (const mark of text.matchAll(MARK_ONE)) {
    for (const digits of mark[0].matchAll(/\d{1,3}/g)) {
      const value = Number(digits[0]);
      if (value > 0 && !numbers.includes(value)) numbers.push(value);
    }
  }
  return numbers;
}

/** Stems of the meaningful words (four letters and longer, no numbers, no filler words). */
export function stemsOf(text: string): Set<string> {
  const stems = new Set<string>();
  for (const word of normalizeForMatch(text).split(' ')) {
    if (word.length < 4 || /^\d+$/.test(word) || STOP_WORDS.has(word)) continue;
    stems.add(wordStem(word));
  }
  return stems;
}

export interface NearFragment {
  id: string;
  score: number;
  shared: string[];
}

/**
 * The fragments nearest to a text by shared word stems: a stem every fragment has weighs less than
 * a rare one. At least two shared stems, otherwise it is not «ближайший», just any.
 */
export function nearestFragments(text: string, sources: SourceFragment[], limit = 2): NearFragment[] {
  const wanted = stemsOf(text);
  if (wanted.size === 0 || sources.length === 0) return [];
  const sourceStems = sources.map((source) => stemsOf(source.text));
  const seenIn = new Map<string, number>();
  for (const stems of sourceStems) for (const stem of stems) seenIn.set(stem, (seenIn.get(stem) ?? 0) + 1);
  const count = sources.length;
  return sources
    .map((source, index) => {
      const shared = [...wanted].filter((stem) => sourceStems[index].has(stem));
      const score = shared.reduce((sum, stem) => sum + Math.log(1 + count / (seenIn.get(stem) ?? 1)), 0);
      return { id: source.id, score, shared };
    })
    .filter((item) => item.shared.length >= 2)
    .sort((a, b) => b.score - a.score || (fragmentNumber(a.id) ?? 0) - (fragmentNumber(b.id) ?? 0))
    .slice(0, limit);
}

/** The summary in sections, each with its fragments. */
export function buildSections(content: string, sources: SourceFragment[]): SummarySection[] {
  const byNumber = new Map<number, string>();
  for (const source of sources) {
    const number = fragmentNumber(source.id);
    if (number !== null && !byNumber.has(number)) byNumber.set(number, source.id);
  }
  const parts = content.split(/(?=^## )/gm).filter((part) => stripSourceMarkers(part).trim());
  return parts.map((part, index) => {
    const heading = /^## (.+)/.exec(part);
    const title = heading ? heading[1].replace(PICTOGRAPHS, '').trim() || null : null;
    const rawBody = heading ? part.replace(/^## .+\n?/, '') : part;
    const body = stripSourceMarkers(rawBody).trim();
    const plain = `${title ?? ''}\n${body}`;
    let refs = markedFragmentNumbers(rawBody)
      .map((number) => byNumber.get(number))
      .filter((id): id is string => Boolean(id))
      .slice(0, MAX_REFS);
    let refKind: RefKind | null = refs.length > 0 ? 'marked' : null;
    if (refs.length === 0 && sources.length > 0) {
      refs = nearestFragments(plain, sources, 2).map((item) => item.id);
      refKind = refs.length > 0 ? 'near' : null;
    }
    return { index, title, body, refs, refKind, stems: [...stemsOf(plain)] };
  });
}

/**
 * The words of a fragment to underline: those sharing a stem with the section, the longest stems
 * first (they say the most), at most `limit` different stems.
 */
export function underlineStems(fragmentText: string, sectionStems: Iterable<string>, limit = 6): Set<string> {
  const wanted = new Set(sectionStems);
  const shared = [...stemsOf(fragmentText)].filter((stem) => wanted.has(stem));
  shared.sort((a, b) => b.length - a.length || a.localeCompare(b, 'ru'));
  return new Set(shared.slice(0, limit));
}

/** «фрагмент 4» for an id, or the id itself when it is not an «S…» label. */
export function fragmentWord(id: string): string {
  const number = fragmentNumber(id);
  return `фрагмент ${number ?? id}`;
}
