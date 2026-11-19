/**
 * «Разложить по темам» (owner 19.11: «…и раскладывает вопросы по темам» — «первое и второе точно нужно»): for a file
 * whose questions have no topics, the model reads them in the file's order and marks where each new topic starts —
 * the headings the file does not have (POST /api/exams/suggest-topics). Topics follow one another, so nothing moves:
 * the questions keep their order and numbers, and the file's result gets topics as if it had the headings.
 */
import type { BankParseResult } from '../../../types/container';
import type { DraftSubject } from './importModel';

/** The server's bounds (backend/explain_api.py TOPICS_MIN_QUESTIONS, TOPICS_MAX_QUESTIONS). */
export const TOPICS_MIN = 12;
export const TOPICS_MAX = 300;

/** A topic the model marked: its name and the first of its questions (1-based, in the list that was sent). */
export interface TopicPart {
  title: string;
  from: number;
}

/**
 * The subject's questions as the model reads them, in the file's order; null — not offered: the subject has topics
 * (or oral sections) already, is made of several files or variants, is one part of a long oral list, or is too short
 * or too long.
 */
export function topicCandidates(subject: DraftSubject): Array<{ position: number; text: string }> | null {
  if (subject.removed || subject.variants || subject.files.length !== 1 || subject.part !== null) return null;
  if (subject.topicsTotal > 0 || subject.oralSections.length > 0) return null;
  const items = [...subject.test, ...subject.blocked, ...subject.oral]
    .map((item) => ({ position: item.position, text: item.text.replace(/\s+/g, ' ').trim() }))
    .filter((item) => item.text.length > 0)
    .sort((a, b) => a.position - b.position);
  return items.length >= TOPICS_MIN && items.length <= TOPICS_MAX ? items : null;
}

/**
 * The file's result with the model's topics: part i starts at the question `positions[from - 1]` and runs to the next
 * part's first question. Every question of the subject (the ones left out of the list too) falls into the part its
 * place in the file is in. A part list that does not fit the positions changes nothing.
 */
export function withTopics(result: BankParseResult, positions: readonly number[], parts: readonly TopicPart[]): BankParseResult {
  const sent = new Set(positions);
  const subjects = new Set(result.items.filter((item) => sent.has(item.position)).map((item) => item.subject));
  const starts = parts.map((part) => positions[part.from - 1]);
  if (subjects.size === 0 || parts.length < 2 || starts.some((start) => start === undefined)) return result;
  if (starts.some((start, index) => index > 0 && start <= starts[index - 1])) return result;
  const base = result.topics.reduce((max, topic) => Math.max(max, topic.index), 0);
  const counts = parts.map(() => 0);
  const subjectOf = parts.map(() => 0);
  const items = result.items.map((item) => {
    if (!subjects.has(item.subject)) return item;
    let at = 0;
    for (let index = 1; index < starts.length; index += 1) if (item.position >= starts[index]) at = index;
    if (counts[at] === 0) subjectOf[at] = item.subject;
    counts[at] += 1;
    return { ...item, topic: base + 1 + at };
  });
  const topics = parts.map((part, index) => ({ index: base + 1 + index, title: part.title, subject: subjectOf[index], items: counts[index] }));
  return { ...result, items, topics: [...result.topics, ...topics] };
}
