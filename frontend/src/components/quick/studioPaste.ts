/**
 * The studio's paste that gave no questions (UX audit of 21.10, P3; mockup m6). «Текст» reads only its own marks
 * («+ / -»), so a test pasted from Word («1.», «а) б) в)», «*», «Ответ: б») became paragraphs and «Применить» said
 * «Применено.». Now the paragraphs that look like such questions are noticed before they are applied, and «Сделать
 * вопросами» reads them with the quick test's parse (POST /api/tests/paste, the exam import's rules) and writes them
 * back in the marks of «Текст» (lib/studio/textFormat questionMarkup).
 */
import type { BankParseResult } from '../../types/container';
import type { TestDoc } from '../../types/testDoc';
import { questionMarkup } from '../../lib/studio/textFormat';
import { quickQuestions } from './quickModel';

const NUMBERED = /^\s*(?:вопрос\s*)?\d{1,3}\s*[.)]\s*\S/i;
const VARIANT = /^\s*[*+]?\s*[а-зa-hА-ЗA-H]\s*[).]\s*\S/;
const INLINE_VARIANTS = /(?:^|\s)[а-зa-hА-ЗA-H]\)\s*\S.*\s[а-зa-hА-ЗA-H]\)\s*\S/;
const ANSWER_LINE = /^\s*\(?\s*(?:правильный\s+)?(?:ответ|answer)\s*[:\-–—]/i;

/** A paragraph that reads like a numbered question with variants or with an «Ответ: …» line. */
export function looksLikeQuestion(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length < 2 || !lines.some((line) => NUMBERED.test(line))) return false;
  const variants = lines.filter((line) => VARIANT.test(line)).length;
  return variants >= 2 || lines.some((line) => INLINE_VARIANTS.test(line)) || lines.some((line) => ANSWER_LINE.test(line));
}

/** A paragraph's lines kept as words: a line that «Текст» would read as a mark gets a backslash in front. */
function plain(text: string): string {
  return text
    .split('\n')
    .map((line) => (/^(?:#|!|[+=>-](?:\s|$)|-{3,}|={3,}|\[|\\)/.test(line) ? `\\${line}` : line))
    .join('\n');
}

export interface StudioQuestions {
  /** The questions in the marks of «Текст», an empty line between them. */
  markup: string;
  /** Questions found. */
  found: number;
  /** Of them, without a marked answer: «Текст» asks for a «+» on each. */
  noKey: number;
}

/**
 * The parse of the pasted paragraphs as text in the marks of «Текст». A question without variants and without an
 * answer is left as the paragraph it was (it cannot be a question of the test); the lines that are not questions stay
 * too, as a paragraph before them.
 */
export function studioMarkup(result: BankParseResult): StudioQuestions {
  const questions = quickQuestions(result);
  // Lines that are not questions (the class, «Удачи!») are kept, as one paragraph before the questions.
  const parts: string[] = result.skipped.length > 0 ? [plain(result.skipped.join('\n'))] : [];
  let found = 0;
  let noKey = 0;
  for (const question of questions) {
    if (question.state === 'blocked') {
      if (question.stem) parts.push(plain(question.stem));
      continue;
    }
    found += 1;
    if (question.state === 'no_key') noKey += 1;
    parts.push(questionMarkup({ stem: question.stem, options: question.options, correct: question.correct, forms: question.answers }));
  }
  return { markup: parts.join('\n\n'), found, noKey };
}

/**
 * The text with the pasted paragraphs replaced by the questions: the first of them takes the questions' place, the
 * others go (a paste is one run of paragraphs). Each paragraph is found where it starts a line, as the field holds it.
 */
export function replaceParagraphs(text: string, paragraphs: readonly string[], markup: string): string {
  let out = text;
  let placed = false;
  for (const paragraph of paragraphs) {
    const at = findParagraph(out, paragraph);
    if (at < 0) continue;
    const end = at + paragraph.length;
    // The paragraph's own line break after it goes with it, so no empty line is left twice.
    const tail = out.slice(end).replace(/^\n(?=\n|$)/, '');
    out = `${out.slice(0, at)}${placed ? '' : markup}${tail}`;
    placed = true;
  }
  if (!placed) return text ? `${text.replace(/\n*$/, '')}\n\n${markup}\n` : `${markup}\n`;
  return out.replace(/\n{3,}/g, '\n\n');
}

function findParagraph(text: string, paragraph: string): number {
  let from = 0;
  for (;;) {
    const at = text.indexOf(paragraph, from);
    if (at < 0) return -1;
    if (at === 0 || text[at - 1] === '\n') return at;
    from = at + 1;
  }
}

/**
 * The paragraphs «Применить» would add to the page (text blocks it did not have) when, together, they read like
 * questions from Word; [] otherwise. Variants split from their question by empty lines are seen together.
 */
export function questionParagraphs(before: TestDoc, after: TestDoc): string[] {
  const had = new Set(before.blocks.map((block) => block.id));
  const fresh = after.blocks.flatMap((block) => (block.type === 'text' && !had.has(block.id) ? [block.text] : []));
  return fresh.length > 0 && looksLikeQuestion(fresh.join('\n')) ? fresh : [];
}
