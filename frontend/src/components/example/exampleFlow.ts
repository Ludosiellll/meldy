/**
 * The example's key-word checking (/try): the same rules as a real ticket, with the key words standing
 * in for the AI — when the AI check of the answer (tryCheck.ts) is not there, and always for the answer
 * to the follow-up. Pure; the page runs it on the device.
 *
 * - A point is «раскрыт» when its key words named it during the answer (the live marks of
 *   rubricMatch.ts — what the student saw light up), otherwise «не назван». Key words cannot tell a
 *   wrong statement, so «ошибка» never comes up here.
 * - The examiner's follow-up is chosen by followup.ts: the browser's candidate (the first main point
 *   with an explicit miss), confirmed or changed by the key-word statuses in place of the quick check —
 *   main points first, then the others (chooseFollowup, §7.5).
 * - The answer to the follow-up: «не знаю» (said, typed or the button) does not name the point; anything else
 *   is judged by the AI on the server, by the point, as a real ticket's reply is (tryCheck.checkTryFollowup) —
 *   and when the AI is not there, by the browser's key-word rule (followupFallback, the one a real ticket
 *   uses when the check does not answer in time), labelled «по ключевым словам» in the check. The key
 *   words never say «назван», so only the AI can name a point after the examiner's question (PUB-2).
 * - The grade is oralGrade.gradeAnswer, the app's formula.
 */
import { browserCandidate, chooseFollowup, decideFollowup, saysDontKnow, type FollowupChoice } from '../../lib/oral/followup';
import { followupFallback, openingMatch, segmentText, words, type Anchors } from '../../lib/oral/rubricMatch';
import type { CheckStatus, Evaluation, RubricPoint } from '../../lib/oral/oralApi';
import type { TryFollowupCheck } from './tryCheck';

/** The longest piece of the answer quoted in the protocol (backend oral.STUDENT_QUOTE_CHARS). */
export const STUDENT_QUOTE_CHARS = 160;

const SENTENCE_END = /[.!?…\n]/;

/**
 * The words of the answer that named a point, for «Вы: «…»» in the protocol: the sentence around the
 * point's opening match (without its final stop: the protocol sets it in «»), or — in speech without
 * punctuation, or a very long sentence — the words around it, cut at word boundaries with «…». ''
 * when this text does not name the point.
 */
export function answerQuote(text: string, anchors: Anchors, max = STUDENT_QUOTE_CHARS): string {
  const source = (typeof text === 'string' ? text : '').normalize('NFC');
  const textWords = words(source);
  const match = openingMatch(anchors, textWords);
  if (!match) return '';
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  for (const segment of segmentText(source)) {
    for (const index of segment.words) ranges[index] = [offset, offset + segment.text.length];
    offset += segment.text.length;
  }
  const firstMatched = match[0];
  const lastMatched = match[match.length - 1];
  if (!ranges[firstMatched] || !ranges[lastMatched]) return '';
  let start = ranges[firstMatched][0];
  while (start > 0 && !SENTENCE_END.test(source[start - 1])) start -= 1;
  let end = ranges[lastMatched][1];
  while (end < source.length && !SENTENCE_END.test(source[end])) end += 1;
  const sentence = source.slice(start, end).trim();
  if (sentence.length <= max) return sentence;
  // A window of words inside the sentence: up to five words before the match and as many after it as
  // fit in max - 2 characters (room for the «…»).
  const fits = (from: number, to: number) => Math.min(ranges[to][1], end) - Math.max(ranges[from][0], start) <= max - 2;
  let first = firstMatched;
  let last = lastMatched;
  for (let step = 0; step < 5 && first > 0 && ranges[first - 1][0] >= start && fits(first - 1, last); step += 1) first -= 1;
  while (last + 1 < ranges.length && ranges[last + 1][1] <= end && fits(first, last + 1)) last += 1;
  const from = Math.max(ranges[first][0], start);
  const to = Math.min(ranges[last][1], end);
  const piece = source.slice(from, to).trim().slice(0, max - 2);
  return `${from > start ? '…' : ''}${piece}${to < end ? '…' : ''}`;
}

/**
 * The example's check of the answer: a point named by its key words (the live set) is covered, any
 * other is missing; the student's words for each named point come from the final answer or, when
 * they were only in words recognised earlier, from the text in which the point lit up.
 */
export function keywordEvaluation(
  points: readonly RubricPoint[],
  named: ReadonlySet<string>,
  finalText: string,
  namedIn: Readonly<Record<string, string>> = {},
): Evaluation {
  return {
    points: points.map((point) => {
      if (!named.has(point.id)) return { id: point.id, status: 'missing', student_quote: '', comment: '' };
      const quote = answerQuote(finalText, point.anchors) || answerQuote(namedIn[point.id] ?? '', point.anchors);
      return { id: point.id, status: 'covered', student_quote: quote, comment: '' };
    }),
    errors: [],
    verdict: '',
  };
}

/** Who gets the follow-up (followup.ts), with the key-word statuses in place of the model's quick check. */
export function exampleFollowup(points: ReadonlyArray<RubricPoint>, snapshot: string, evaluation: Evaluation): FollowupChoice | null {
  const statuses: Record<string, string> = {};
  for (const point of evaluation.points) statuses[point.id] = point.status;
  return decideFollowup(browserCandidate(points, snapshot), { statuses, ask: chooseFollowup(points, statuses) });
}

export interface FollowupVerdict {
  status: CheckStatus;
  /**
   * null — «не знаю»: an honest answer, trusted as the button is; check — the AI judged the reply (as a real
   * ticket's quick check); keywords — the browser's key-word rule.
   */
  judgedBy: 'check' | 'keywords' | null;
}

/**
 * The answer to the follow-up: «не знаю» is not counted; otherwise the AI's judgement of the reply when it
 * came (`reply`, tryCheck.checkTryFollowup), else the key-word rule.
 */
export function judgeFollowupAnswer(
  point: Pick<RubricPoint, 'anchors'>,
  question: string,
  answer: string,
  reply: TryFollowupCheck | null = null,
): FollowupVerdict {
  if (saysDontKnow(answer)) return { status: 'missing', judgedBy: null };
  if (reply?.by === 'ai') return { status: reply.status, judgedBy: 'check' };
  return { status: followupFallback(point.anchors, question, answer), judgedBy: 'keywords' };
}
