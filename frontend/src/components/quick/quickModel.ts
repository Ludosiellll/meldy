/**
 * «Быстрая контрольная» without React (UX audit of 21.10, P1): the pasted text's parse (POST /api/tests/paste, the
 * exam import's own rules) as the questions the teacher sees, the teacher's taps on the right variant laid over it, the
 * questions as they are saved (ItemInput of container_items_add), and the few settings as a quiz's (quiz_create).
 *
 * A question with variants is the import's own draftItem (components/containers/import/importModel.ts): its options,
 * its key and what is wrong with it. A tap is that model's fix (`correct` in the parse's option indices), kept by the
 * question's text, so it survives the next parse of the same question. A question without variants with an «Ответ: …»
 * line is a short answer (forms split by «;»). One without either cannot be saved: it is shown, and left out.
 */
import type { BankItem, BankParseResult, ItemInput } from '../../types/container';
import type { QuizSettings } from '../../types/quiz';
import { draftItem, newImportId, shortNorm, type DraftItem } from '../containers/import/importModel';
import { allQuestions } from '../quiz/setupModel';
import { defaultSettings, MAX_ITEMS } from '../../lib/quizzes/quizModel';

export type QuickKind = 'single' | 'multiple' | 'short' | 'none';
export type QuickState = 'ok' | 'no_key' | 'blocked';

export interface QuickQuestion {
  /** Stable while the question's text stays: React's key and the tap's key. */
  key: string;
  /** 1.. in the order found. */
  number: number;
  stem: string;
  kind: QuickKind;
  /** The options as saved. */
  options: string[];
  /** The key, indices into `options`. */
  correct: number[];
  /** A short answer's accepted forms. */
  answers: string[];
  state: QuickState;
  /** The teacher marked the right variant here (not the text). */
  tapped: boolean;
  /** The import's model of the question (with variants); null for a short answer or a question that cannot be saved. */
  draft: DraftItem | null;
}

/** The teacher's taps: question key → the right options, in the parse's option indices. */
export type QuickTaps = Readonly<Record<string, number[]>>;

const SHORT_FORMS_MAX = 10;
const SHORT_FORM_CHARS = 200;
const STEM_CHARS = 4000;

/** The question's key: its text and its variants, as the teacher wrote them (case and spaces aside). */
export function questionKey(item: Pick<BankItem, 'text' | 'options'>): string {
  return [item.text, ...item.options].map((part) => part.toLowerCase().replace(/\s+/g, ' ').trim()).join('\u0001');
}

/** The accepted forms of an «Ответ: …» line: split by «;», each short enough for the database. */
export function answerForms(answer: string | null): string[] {
  if (!answer) return [];
  const forms = answer
    .split(/\s*;\s*/)
    .map((form) => form.trim())
    .filter((form) => form && shortNorm(form) !== '');
  if (forms.length > SHORT_FORMS_MAX || forms.some((form) => form.length > SHORT_FORM_CHARS)) return [];
  return forms;
}

/** The parse as the questions the teacher sees, with the taps laid over it. */
export function quickQuestions(result: BankParseResult | null, taps: QuickTaps = {}): QuickQuestion[] {
  if (!result) return [];
  const seen = new Map<string, number>();
  return result.items.map((item, at) => {
    const base = questionKey(item);
    // The same question twice: each its own key.
    const twice = seen.get(base) ?? 0;
    seen.set(base, twice + 1);
    const key = twice ? `${base}\u0002${twice}` : base;
    const stem = item.text.trim().slice(0, STEM_CHARS);
    const number = at + 1;
    if (item.options.length === 0) {
      const answers = answerForms(item.answer);
      return {
        key,
        number,
        stem,
        kind: answers.length ? 'short' : 'none',
        options: [],
        correct: [],
        answers,
        state: answers.length && stem ? 'ok' : 'blocked',
        tapped: false,
        draft: null,
      };
    }
    const tap = taps[key];
    const multiple = item.kind === 'multiple' || (tap ? tap.length > 1 : false);
    const fix = tap ? { correct: [...tap], kind: multiple ? ('multiple' as const) : ('single' as const) } : {};
    const draft = draftItem(item, { fileId: 'quick', signal: 'auto', fix, twin: null });
    const blocked = draft.blocked || draft.kind === 'short';
    const keyed = !blocked && draft.correct.length > 0 && !draft.problems.includes('several');
    return {
      key,
      number,
      stem,
      kind: blocked ? 'none' : draft.kind === 'multiple' || multiple ? 'multiple' : 'single',
      options: draft.options,
      correct: draft.correct,
      answers: [],
      state: blocked ? 'blocked' : keyed ? 'ok' : 'no_key',
      tapped: Boolean(tap),
      draft: blocked ? null : draft,
    };
  });
}

/**
 * A tap on saved option `index` of the question: one answer takes it as the right one; a question of several answers
 * adds or takes it away. The new taps (the parse's indices).
 */
export function tapOption(taps: QuickTaps, question: QuickQuestion, index: number): QuickTaps {
  const draft = question.draft;
  if (!draft) return taps;
  const fileIndex = draft.optionMap[index];
  if (fileIndex === undefined) return taps;
  const current = draft.correct.map((at) => draft.optionMap[at]);
  let next: number[];
  if (question.kind === 'multiple') {
    next = current.includes(fileIndex) ? current.filter((at) => at !== fileIndex) : [...current, fileIndex].sort((a, b) => a - b);
  } else {
    next = [fileIndex];
  }
  return { ...taps, [question.key]: next };
}

/** Questions that go into the quiz (with their answer). */
export const readyOf = (list: readonly QuickQuestion[]) => list.filter((question) => question.state === 'ok');

/** The questions as container_items_add takes them: every question that can be saved, keyed or not. */
export function quickInputs(list: readonly QuickQuestion[], importId: string = newImportId()): ItemInput[] {
  const out: ItemInput[] = [];
  for (const question of list) {
    if (question.state === 'blocked') continue;
    const ref = `${importId}:${out.length + 1}`;
    if (question.kind === 'short') {
      out.push({ ref, stem: question.stem, options: [], correct: [], answers: question.answers, kind: 'short', key_source: 'answer_line' });
      continue;
    }
    const draft = question.draft;
    if (!draft) continue;
    const keyed = question.state === 'ok';
    out.push({
      ref,
      stem: question.stem,
      options: question.options,
      correct: keyed ? question.correct : [],
      kind: question.kind === 'multiple' ? 'multiple' : 'single',
      key_source: !keyed ? 'none' : question.tapped ? 'manual' : draft.keySource,
      keep_order: draft.keepOrder,
      flags: keyed ? draft.flags.filter((flag) => flag !== 'no_key') : draft.flags,
    });
  }
  return out;
}

// ───────────────────────────────────────── the settings

export type QuickWho = 'guests' | 'link';

export interface QuickSettings {
  who: QuickWho;
  /** null — no timer. */
  minutes: number | null;
  /** How many days it stays open; null — no end. */
  days: number | null;
  /** null — as many as the student likes. */
  attempts: number | null;
}

export const QUICK_DEFAULTS: QuickSettings = { who: 'guests', minutes: null, days: 7, attempts: 1 };
export const QUICK_MINUTES: readonly (number | null)[] = [null, 10, 15, 20, 30, 45, 60];
export const QUICK_DAYS: readonly (number | null)[] = [1, 3, 7, 14, null];
export const QUICK_ATTEMPTS: readonly (number | null)[] = [1, 2, 3, null];

/** The day `days` from now, at 23:59 on the device's clock. */
export function closesAfter(days: number, now: Date): string {
  const end = new Date(now.getTime() + days * 86400000);
  end.setHours(23, 59, 0, 0);
  return end.toISOString();
}

/** The quiz of every keyed question of the test, in the order written, with the few settings chosen. */
export function quickQuizSettings(title: string, subjectId: string, count: number, quick: QuickSettings, now: Date = new Date()): QuizSettings {
  const all = allQuestions(defaultSettings([subjectId], count, now), Math.min(count, MAX_ITEMS), title);
  return {
    ...all,
    time_limit_min: quick.minutes,
    closes_at: quick.days === null ? null : closesAfter(quick.days, now),
    opens_at: null,
    attempts: quick.attempts,
    guests: quick.who === 'guests',
    members_only: false,
  };
}

/** What «Ещё настройки» hands the full form: only what the chips decide. */
export function quickPreset(quick: QuickSettings, now: Date = new Date()): Partial<QuizSettings> {
  return {
    time_limit_min: quick.minutes,
    closes_at: quick.days === null ? null : closesAfter(quick.days, now),
    attempts: quick.attempts,
    guests: quick.who === 'guests',
    members_only: false,
  };
}
