/**
 * How a participant goes through a studio page (spec §47.6 «Раскладка прохождения»), pure: the page cut into steps by
 * its layout, the questions numbered, an answer checked against its key (the author's preview grades on the device;
 * the participant's page gets its grade from the server), the score in points and the result band.
 *
 * - «По одному» (one_by_one): a step per question, with the blocks that stand before it since the previous question;
 *   blocks after the last question go with it. «Новая страница» is ignored.
 * - «Одна страница» (one_page): one step with every block; «Новая страница» is ignored.
 * - «По страницам» (pages): «Новая страница» starts a step (its title heads it); a page without blocks is skipped.
 *
 * Question blocks whose row is missing are left out everywhere (DocView skips them).
 */
import type { TestItem } from '../../types/container';
import { answered as kindAnswered, gradeAnswer, type KindAnswer } from '../../lib/kinds/answer';
import type { DocBlock, QuestionBlock, ResultBand, TestDoc } from '../../types/testDoc';

/** What DocView needs of a question row: the words and pictures; the key only where the page grades. */
export type DocItem = Pick<TestItem, 'id' | 'kind' | 'stem' | 'options' | 'code'> &
  Partial<Pick<TestItem, 'images' | 'correct' | 'answers' | 'explanation' | 'keep_order' | 'tolerance' | 'unit' | 'partial'>> & {
    /** match on a participant's page: the right items in the attempt's order (release 48). */
    right?: string[];
  };

export interface Answer {
  /** single / multiple: the file indices chosen; order: the arrangement; match: per left the right's index or -1. */
  chosen?: number[];
  /** short, number, essay: the words typed. */
  text?: string;
  /** cloze: a text per gap (release 48). */
  texts?: string[];
}

/** An answer of a new kind as the kinds' fields hold it (components/kinds), and back. */
export function kindValueOf(answer: Answer | undefined): KindAnswer {
  if (!answer) return null;
  if (answer.texts) return [...answer.texts];
  if (answer.chosen) return [...answer.chosen];
  return answer.text ?? null;
}
export function answerOfKind(value: KindAnswer): Answer {
  if (value === null) return {};
  if (typeof value === 'string') return { text: value };
  if (value.length > 0 && typeof value[0] === 'string') return { texts: value as string[] };
  return { chosen: value as number[] };
}
export type Answers = Readonly<Record<string, Answer | undefined>>;

export interface Step {
  /** The page block that opens this step («По страницам»), or null. */
  page: DocBlock & { type: 'page' } | null;
  blocks: DocBlock[];
}

export interface DocResultView {
  score: number;
  max: number;
  percent: number;
  band: ResultBand | null;
}

/** The blocks a participant sees: every block but question blocks without their row. */
export function visibleBlocks(doc: TestDoc, items: ReadonlyMap<string, DocItem>): DocBlock[] {
  return doc.blocks.filter((block) => block.type !== 'question' || items.has(block.item_id));
}

/** The number of each shown question block (from 1, page order), by block id. */
export function questionNumbers(blocks: readonly DocBlock[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const block of blocks) if (block.type === 'question') numbers.set(block.id, numbers.size + 1);
  return numbers;
}

/** The page cut into the steps of its layout. */
export function stepsOf(doc: TestDoc, blocks: readonly DocBlock[]): Step[] {
  if (doc.layout === 'pages') {
    const steps: Step[] = [];
    let current: Step = { page: null, blocks: [] };
    for (const block of blocks) {
      if (block.type === 'page') {
        if (current.blocks.length > 0) steps.push(current);
        current = { page: block, blocks: [] };
      } else current.blocks.push(block);
    }
    if (current.blocks.length > 0) steps.push(current);
    return steps.length > 0 ? steps : [{ page: null, blocks: [] }];
  }
  const shown = blocks.filter((block) => block.type !== 'page');
  if (doc.layout === 'one_page') return [{ page: null, blocks: shown }];
  const steps: Step[] = [];
  let lead: DocBlock[] = [];
  for (const block of shown) {
    lead.push(block);
    if (block.type === 'question') {
      steps.push({ page: null, blocks: lead });
      lead = [];
    }
  }
  if (lead.length > 0) {
    if (steps.length > 0) steps[steps.length - 1].blocks.push(...lead);
    else steps.push({ page: null, blocks: lead });
  }
  return steps.length > 0 ? steps : [{ page: null, blocks: [] }];
}

/** The answer holds something: a choice, or words. */
export function answered(answer: Answer | undefined): boolean {
  if (!answer) return false;
  if (answer.texts || answer.chosen?.some((index) => index < 0)) return kindAnswered(kindValueOf(answer));
  return (answer.chosen?.length ?? 0) > 0 || Boolean(answer.text && answer.text.trim());
}

/** The required questions of these blocks without an answer, by their numbers. */
export function missingRequired(blocks: readonly DocBlock[], answers: Answers, numbers: ReadonlyMap<string, number>): number[] {
  return blocks.flatMap((block) => (block.type === 'question' && block.required && !answered(answers[block.item_id]) ? [numbers.get(block.id) ?? 0] : []));
}

/** A short answer as the check compares it: any case, «ё» as «е», spaces squeezed. */
export const normShort = (text: string) => text.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

/** The answer is right by the row's key; null when the row has no key here (nothing to grade). */
export function isRight(item: DocItem, answer: Answer | undefined): boolean | null {
  const credit = creditOf(item, answer);
  return credit === null ? null : credit === 1;
}

/** The answer's credit by the row's key (release 48: a share with partial credit); null when nothing can be graded here. */
export function creditOf(item: DocItem, answer: Answer | undefined): number | null {
  if (item.kind === 'essay') return null;
  if (item.kind !== 'single' && item.kind !== 'multiple' && item.kind !== 'short') {
    const answers = item.answers ?? [];
    if (item.kind !== 'order' && answers.length === 0) return null;
    return gradeAnswer({ kind: item.kind, options: item.options, correct: item.correct ?? [], answers, tolerance: item.tolerance,
                         unit: item.unit, partial: item.partial }, kindValueOf(answer)).credit;
  }
  if (item.kind === 'multiple' && item.partial && (item.correct ?? []).length > 0) {
    return gradeAnswer({ kind: 'multiple', options: item.options, correct: item.correct ?? [], answers: [], partial: true },
                       answer?.chosen && answer.chosen.length > 0 ? answer.chosen : null).credit;
  }
  const right = rightOld(item, answer);
  return right === null ? null : right ? 1 : 0;
}

function rightOld(item: DocItem, answer: Answer | undefined): boolean | null {
  if (item.kind === 'short') {
    const forms = item.answers ?? [];
    if (forms.length === 0) return null;
    const text = normShort(answer?.text ?? '');
    return text !== '' && forms.some((form) => normShort(form) === text);
  }
  const key = item.correct ?? [];
  if (key.length === 0) return null;
  const chosen = [...new Set(answer?.chosen ?? [])].sort((a, b) => a - b);
  const right = [...new Set(key)].sort((a, b) => a - b);
  return chosen.length === right.length && chosen.every((index, at) => index === right[at]);
}

/** The band whose range holds the percent. */
export function bandFor(doc: TestDoc, percent: number): ResultBand | null {
  return doc.results.bands.find((band) => band.from <= percent && percent <= band.to) ?? null;
}

/** The points of the right answers out of the points of the graded questions, the percent and the band. */
export function gradeDoc(doc: TestDoc, items: ReadonlyMap<string, DocItem>, answers: Answers): DocResultView {
  let score = 0;
  let max = 0;
  for (const block of doc.blocks) {
    if (block.type !== 'question') continue;
    const item = items.get(block.item_id);
    if (!item) continue;
    const credit = creditOf(item, answers[block.item_id]);
    if (credit === null) continue;
    max += block.points;
    score += block.points * credit;
  }
  score = Math.round(score * 100) / 100;
  const percent = max > 0 ? Math.round((100 * score) / max) : 0;
  return { score, max, percent, band: bandFor(doc, percent) };
}

export const isQuestion = (block: DocBlock): block is QuestionBlock => block.type === 'question';

/** A question as a participant meets it: its number on the page, the step that holds it, whether it is required. */
export interface PlacedQuestion {
  blockId: string;
  itemId: string;
  number: number;
  step: number;
  required: boolean;
}

export interface RunPlan {
  shown: DocBlock[];
  steps: Step[];
  numbers: Map<string, number>;
  /** In page order. */
  questions: PlacedQuestion[];
}

/** The page as the participant goes through it (what DocView answers with): the blocks, the steps, the questions. */
export function runPlan(doc: TestDoc, items: ReadonlyMap<string, DocItem>): RunPlan {
  const shown = visibleBlocks(doc, items);
  const steps = stepsOf(doc, shown);
  const numbers = questionNumbers(shown);
  const questions: PlacedQuestion[] = [];
  steps.forEach((step, at) => {
    for (const block of step.blocks) {
      if (block.type === 'question') questions.push({ blockId: block.id, itemId: block.item_id, number: numbers.get(block.id) ?? 0, step: at, required: block.required });
    }
  });
  return { shown, steps, numbers, questions };
}
