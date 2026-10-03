/**
 * Matching an answer to the rubric points by key words (contracts §7.3). The same rules as
 * backend/oral.py; both are checked against frontend/src/test/fixtures/oral_match_vectors.json.
 *
 * - normalize: NFC, lower case, ё → е, every run of characters that are not letters or digits
 *   (underscore included) becomes one space, trimmed; words = split on spaces.
 * - A part of an anchor matches a word: 4+ letters → the word starts with it; 3 letters → the word
 *   starts with it and has at most 5 letters; shorter parts never match.
 * - A variant of several parts («обратн распростр»): the first part matches word i, every next part
 *   a word j with prev < j ≤ prev + 3; the match is at position i.
 * - A point is probably named when a window of 40 consecutive words (all words when fewer) holds a
 *   position of group 0 and positions of at least need(G) = ceil(3G/5) distinct groups.
 * - Explicit miss: no group-0 position anywhere and fewer than need(G) groups with any position.
 *
 * Live marks only ever add: the screen re-matches the final plus the interim text on every
 * recognition event and keeps every point that was named once. Only final words are underlined.
 */

/** Anchor groups of a point: group 0 is the notion itself, each group lists 1–4 variants. */
export type Anchors = string[][];

export interface MatchablePoint {
  id: string;
  anchors: Anchors;
}

/** Window of consecutive words in which a point has to be named (§7.3). */
export const NAMED_WINDOW = 40;
/** How far the next part of a multi-part variant may stand: prev < j ≤ prev + 3. */
const PART_REACH = 3;

const SEPARATORS = /[^\p{L}\p{N}]+/gu;
const WORD_RUN = /[\p{L}\p{N}]+/gu;

/** NFC, lower case, ё → е, separators → one space, trimmed. */
export function normalize(text: unknown): string {
  const value = typeof text === 'string' ? text : '';
  return value.normalize('NFC').toLowerCase().replace(/ё/g, 'е').replace(SEPARATORS, ' ').trim();
}

/** The normalised words of a text. */
export function words(text: unknown): string[] {
  const normalized = normalize(text);
  return normalized ? normalized.split(' ') : [];
}

/** Length in code points (Python's len), not UTF-16 units. */
function letters(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

/** A part of an anchor against one word: 4+ letters — a prefix; 3 letters — a prefix of a word of ≤ 5 letters. */
export function partMatch(part: string, word: string): boolean {
  const size = letters(part);
  if (size >= 4) return word.startsWith(part);
  if (size === 3) return word.startsWith(part) && letters(word) <= 5;
  return false;
}

/**
 * Every match of a variant: the word indexes of its parts in order. The first part picks the start,
 * each next part the nearest word within PART_REACH words after the previous one.
 */
export function variantMatches(variant: string, textWords: readonly string[]): number[][] {
  const parts = words(variant);
  if (parts.length === 0) return [];
  const total = textWords.length;
  const matches: number[][] = [];
  for (let index = 0; index < total; index += 1) {
    if (!partMatch(parts[0], textWords[index])) continue;
    const match = [index];
    let previous = index;
    let complete = true;
    for (const part of parts.slice(1)) {
      let found = -1;
      for (let j = previous + 1; j < Math.min(total, previous + PART_REACH + 1); j += 1) {
        if (partMatch(part, textWords[j])) {
          found = j;
          break;
        }
      }
      if (found < 0) {
        complete = false;
        break;
      }
      match.push(found);
      previous = found;
    }
    if (complete) matches.push(match);
  }
  return matches;
}

/** Positions (first words) of a variant's matches. */
export function variantPositions(variant: string, textWords: readonly string[]): number[] {
  return variantMatches(variant, textWords).map((match) => match[0]);
}

/** The union of a group's variant positions, sorted. */
export function groupPositions(group: readonly string[], textWords: readonly string[]): number[] {
  const positions = new Set<number>();
  for (const variant of group) for (const position of variantPositions(variant, textWords)) positions.add(position);
  return Array.from(positions).sort((a, b) => a - b);
}

/** ceil(3·G/5): how many groups have to match. */
export function need(groups: number): number {
  return Math.ceil((3 * groups) / 5);
}

/** A window of NAMED_WINDOW words with a group-0 position and positions of ≥ need(G) distinct groups. */
export function probablyNamed(anchors: Anchors, textWords: readonly string[]): boolean {
  if (!Array.isArray(anchors) || anchors.length === 0) return false;
  const positions = anchors.map((group) => groupPositions(group, textWords));
  if (positions[0].length === 0) return false;
  const required = need(anchors.length);
  const total = textWords.length;
  const lastStart = Math.max(1, total - NAMED_WINDOW + 1);
  for (let start = 0; start < lastStart; start += 1) {
    const end = start + NAMED_WINDOW;
    const inWindow = (position: number) => position >= start && position < end;
    if (!positions[0].some(inWindow)) continue;
    let groups = 0;
    for (const group of positions) if (group.some(inWindow)) groups += 1;
    if (groups >= required) return true;
  }
  return false;
}

/** No group-0 position anywhere and fewer than need(G) groups with any position. */
export function explicitMiss(anchors: Anchors, textWords: readonly string[]): boolean {
  if (!Array.isArray(anchors) || anchors.length === 0) return false;
  const positions = anchors.map((group) => groupPositions(group, textWords));
  const matched = positions.filter((group) => group.length > 0).length;
  return positions[0].length === 0 && matched < need(anchors.length);
}

/** The ids of the points that are probably named in this text, in rubric order. */
export function namedPoints(points: readonly MatchablePoint[], text: string): string[] {
  const textWords = words(text);
  if (textWords.length === 0) return [];
  return points.filter((point) => probablyNamed(point.anchors, textWords)).map((point) => point.id);
}

/**
 * Live marks: the points named in final + interim text, added to the ones named before (marks only
 * add — an interim word that later turns into something else never closes a row again).
 */
export function liveMarks(
  points: readonly MatchablePoint[],
  finalText: string,
  interimText: string,
  previous: ReadonlySet<string> = new Set(),
): Set<string> {
  const next = new Set(previous);
  const text = [finalText, interimText].filter((part) => part && part.trim()).join(' ');
  for (const id of namedPoints(points, text)) next.add(id);
  return next;
}

/** Word indexes covered by any match of any variant of these anchors (all parts of a match). */
export function anchorWordIndexes(anchors: Anchors, textWords: readonly string[]): Set<number> {
  const indexes = new Set<number>();
  for (const group of anchors) {
    for (const variant of group) {
      for (const match of variantMatches(variant, textWords)) for (const index of match) indexes.add(index);
    }
  }
  return indexes;
}

/** The final words to underline: the words that matched an anchor of a point that is named. */
export function underlinedFinalWords(
  points: readonly MatchablePoint[],
  named: ReadonlySet<string>,
  finalText: string,
): Set<number> {
  const textWords = words(finalText);
  const indexes = new Set<number>();
  for (const point of points) {
    if (!named.has(point.id)) continue;
    for (const index of anchorWordIndexes(point.anchors, textWords)) indexes.add(index);
  }
  return indexes;
}

/** A piece of displayed text: a word run (with the normalised word indexes it yields) or a separator. */
export interface TextSegment {
  text: string;
  /** Indexes into words(text); empty for separators. Usually one index per word run. */
  words: number[];
}

/**
 * Splits a text for display so that word runs line up with words(text): every run of letters and
 * digits is one segment carrying the indexes of the normalised words it produces.
 */
export function segmentText(text: string): TextSegment[] {
  const source = (typeof text === 'string' ? text : '').normalize('NFC');
  const segments: TextSegment[] = [];
  let last = 0;
  let wordIndex = 0;
  for (const match of source.matchAll(WORD_RUN)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: source.slice(last, start), words: [] });
    const count = words(match[0]).length;
    const indexes: number[] = [];
    for (let i = 0; i < count; i += 1) indexes.push(wordIndex + i);
    segments.push({ text: match[0], words: indexes });
    wordIndex += count;
    last = start + match[0].length;
  }
  if (last < source.length) segments.push({ text: source.slice(last), words: [] });
  return segments;
}

/** A display run: plain text or a stretch of words to underline (neighbouring words joined by spaces). */
export interface MarkedRun {
  text: string;
  marked: boolean;
}

/**
 * Groups a text into plain and marked runs: consecutive marked words separated only by spaces form
 * one run, so one pencil line runs under «процентного изменения» instead of two.
 */
export function markedRuns(text: string, marked: ReadonlySet<number>): MarkedRun[] {
  const segments = segmentText(text);
  const isMarked = (segment: TextSegment | undefined) =>
    Boolean(segment && segment.words.length > 0 && segment.words.some((index) => marked.has(index)));
  const isSpace = (segment: TextSegment | undefined) => Boolean(segment && segment.words.length === 0 && /^\s+$/.test(segment.text));
  const runs: MarkedRun[] = [];
  let i = 0;
  while (i < segments.length) {
    const segment = segments[i];
    if (isMarked(segment)) {
      let text = segment.text;
      let next = i + 1;
      while (isSpace(segments[next]) && isMarked(segments[next + 1])) {
        text += segments[next].text + segments[next + 1].text;
        next += 2;
      }
      runs.push({ text, marked: true });
      i = next;
      continue;
    }
    const previous = runs[runs.length - 1];
    if (previous && !previous.marked) previous.text += segment.text;
    else runs.push({ text: segment.text, marked: false });
    i += 1;
  }
  return runs;
}

/**
 * The browser's own check of an answer to the examiner's follow-up when /check did not answer
 * (§7.2, vectors `followup_fallback`): variants with a part that matches a word of the question are
 * dropped (an echo of the question proves nothing); partial when a remaining group matches the
 * answer, otherwise missing.
 */
export function followupFallback(anchors: Anchors, question: string, answer: string): 'partial' | 'missing' {
  const questionWords = words(question);
  const answerWords = words(answer);
  const kept: string[][] = [];
  for (const group of anchors) {
    const variants = group.filter(
      (variant) => !words(variant).some((part) => questionWords.some((word) => partMatch(part, word))),
    );
    if (variants.length > 0) kept.push(variants);
  }
  return kept.some((group) => groupPositions(group, answerWords).length > 0) ? 'partial' : 'missing';
}
