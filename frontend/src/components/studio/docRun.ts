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
import type { DocBlock, QuestionBlock, ResultBand, TestDoc } from '../../types/testDoc';

/** What DocView needs of a question row: the words and pictures; the key only where the page grades. */
export type DocItem = Pick<TestItem, 'id' | 'kind' | 'stem' | 'options' | 'code'> &
  Partial<Pick<TestItem, 'images' | 'correct' | 'answers' | 'explanation' | 'keep_order'>>;

export interface Answer {
  /** single / multiple: the file indices chosen. */
  chosen?: number[];
  /** short: the words typed. */
  text?: string;
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
    const right = isRight(item, answers[block.item_id]);
    if (right === null) continue;
    max += block.points;
    if (right) score += block.points;
  }
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
